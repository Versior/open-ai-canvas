package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestParseSocialVideoShareText(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name     string
		text     string
		platform string
		wantURL  string
	}{
		{
			name:     "douyin share text",
			text:     "5.23 复制打开抖音，看看【商品展示】 https://v.douyin.com/iR4aBcD/ 09/12 AbC:/",
			platform: "douyin",
			wantURL:  "https://v.douyin.com/iR4aBcD/",
		},
		{
			name:     "douyin canonical video",
			text:     "https://www.douyin.com/video/7391234567890123456?previous_page=web_code_link",
			platform: "douyin",
			wantURL:  "https://www.douyin.com/video/7391234567890123456?previous_page=web_code_link",
		},
		{
			name:     "tiktok canonical video",
			text:     "Try this https://www.tiktok.com/@shop/video/7461234567890123456",
			platform: "tiktok",
			wantURL:  "https://www.tiktok.com/@shop/video/7461234567890123456",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			parsed, err := parseSocialVideoShareText(test.text)
			if err != nil {
				t.Fatalf("parseSocialVideoShareText() error = %v", err)
			}
			if parsed.Platform != test.platform || parsed.URL != test.wantURL {
				t.Fatalf("parseSocialVideoShareText() = %#v", parsed)
			}
		})
	}
}

func TestParseSocialVideoShareTextRejectsUnsafeOrAmbiguousURLs(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name string
		text string
	}{
		{name: "missing URL", text: "复制打开抖音看看商品"},
		{name: "multiple URLs", text: "https://v.douyin.com/abc/ https://vm.tiktok.com/xyz/"},
		{name: "plain HTTP", text: "http://v.douyin.com/abc/"},
		{name: "spoofed suffix", text: "https://v.douyin.com.attacker.invalid/abc/"},
		{name: "embedded credentials", text: "https://user:pass@v.douyin.com/abc/"},
		{name: "non standard port", text: "https://v.douyin.com:444/abc/"},
		{name: "missing short token", text: "https://v.douyin.com/"},
		{name: "unsupported douyin path", text: "https://www.douyin.com/user/123"},
		{name: "unsupported tiktok path", text: "https://www.tiktok.com/@shop"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if parsed, err := parseSocialVideoShareText(test.text); err == nil {
				t.Fatalf("parseSocialVideoShareText() = %#v, want error", parsed)
			}
		})
	}
}

func TestCreateSocialVideoImportTaskIsAccountScopedAndIdempotent(t *testing.T) {
	svc, db := newSocialVideoImportTestService(t)
	validated := 0
	svc.socialVideoURLValidator = func(raw string) (*url.URL, error) {
		validated++
		return url.Parse(raw)
	}

	req := SocialVideoImportRequest{URL: "https://www.douyin.com/video/7391234567890123456"}
	first, err := svc.CreateSocialVideoImportTask("user-a", "request-key-0001", req)
	if err != nil {
		t.Fatalf("CreateSocialVideoImportTask() error = %v", err)
	}
	if first.ID != socialVideoTaskID("user-a", "request-key-0001") {
		t.Fatalf("task ID = %q, want deterministic account-scoped ID", first.ID)
	}
	if first.Type != model.TaskTypeSocialVideoImport || first.Status != model.TaskStatusQueued {
		t.Fatalf("task = %#v", first)
	}
	if first.BillingOrderID != "" {
		t.Fatalf("billing order = %q, want non-billable task", first.BillingOrderID)
	}

	replay, err := svc.CreateSocialVideoImportTask("user-a", "request-key-0001", req)
	if err != nil {
		t.Fatalf("idempotent replay error = %v", err)
	}
	if replay.ID != first.ID {
		t.Fatalf("replay ID = %q, want %q", replay.ID, first.ID)
	}

	_, err = svc.CreateSocialVideoImportTask("user-a", "request-key-0001", SocialVideoImportRequest{URL: "https://www.douyin.com/video/7391234567890123457"})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Code != CodeIdempotencyConflict {
		t.Fatalf("conflicting replay error = %#v, want code %d", err, CodeIdempotencyConflict)
	}

	other, err := svc.CreateSocialVideoImportTask("user-b", "request-key-0001", req)
	if err != nil {
		t.Fatalf("other account create error = %v", err)
	}
	if other.ID == first.ID {
		t.Fatal("different accounts shared the same task ID")
	}

	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("task count = %d, want 2", count)
	}
	if validated != 4 {
		t.Fatalf("outbound validator calls = %d, want one per request", validated)
	}
}

func TestCreateSocialVideoImportTaskValidatesIdempotencyKey(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	svc.socialVideoURLValidator = url.Parse
	req := SocialVideoImportRequest{URL: "https://v.douyin.com/abc123/"}

	for _, key := range []string{"", "short", string(make([]byte, 129))} {
		if task, err := svc.CreateSocialVideoImportTask("user", key, req); err == nil {
			t.Fatalf("key length %d created task %#v", len(key), task)
		}
	}
}

func TestParseSocialVideoMetadata(t *testing.T) {
	t.Parallel()
	raw := []byte(`{"extractor":"TikTok","id":"7461234567890123456","title":"商品展示","duration":15.25,"filesize_approx":1024000}`)
	metadata, err := parseSocialVideoMetadata(raw, "tiktok", 2<<20)
	if err != nil {
		t.Fatalf("parseSocialVideoMetadata() error = %v", err)
	}
	if metadata.CanonicalID != "7461234567890123456" || metadata.Title != "商品展示" || metadata.Duration != 15.25 {
		t.Fatalf("metadata = %#v", metadata)
	}
}

func TestParseSocialVideoMetadataAcceptsRealExtractorKey(t *testing.T) {
	t.Parallel()
	raw := []byte(`{"extractor":"TikTok","extractor_key":"TikTok","id":"7461234567890123456","duration":15}`)
	if _, err := parseSocialVideoMetadata(raw, "tiktok", 2<<20); err != nil {
		t.Fatalf("parseSocialVideoMetadata() error = %v", err)
	}
	raw = []byte(`{"extractor":"generic","extractor_key":"TikTok","id":"7461234567890123456","duration":15}`)
	if _, err := parseSocialVideoMetadata(raw, "tiktok", 2<<20); err == nil {
		t.Fatal("generic extractor with forged extractor_key should be rejected")
	}
}

func TestParseSocialVideoMetadataRejectsUnsafeResults(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		raw  map[string]any
	}{
		{name: "generic extractor", raw: map[string]any{"extractor": "generic", "id": "1", "duration": 10}},
		{name: "wrong platform", raw: map[string]any{"extractor": "Douyin", "id": "1", "duration": 10}},
		{name: "playlist", raw: map[string]any{"extractor": "TikTok", "id": "1", "duration": 10, "entries": []any{map[string]any{"id": "1"}}}},
		{name: "missing id", raw: map[string]any{"extractor": "TikTok", "duration": 10}},
		{name: "duration limit", raw: map[string]any{"extractor": "TikTok", "id": "1", "duration": 181}},
		{name: "declared size limit", raw: map[string]any{"extractor": "TikTok", "id": "1", "duration": 10, "filesize": 2049}},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, err := json.Marshal(test.raw)
			if err != nil {
				t.Fatal(err)
			}
			if metadata, err := parseSocialVideoMetadata(raw, "tiktok", 2048); err == nil {
				t.Fatalf("parseSocialVideoMetadata() = %#v, want error", metadata)
			}
		})
	}
}

func TestParseSocialVideoProbeRequiresBoundedVideo(t *testing.T) {
	t.Parallel()
	probe, err := parseSocialVideoProbe([]byte(`{"streams":[{"codec_type":"video","width":1080,"height":1920}],"format":{"duration":"15.125"}}`))
	if err != nil {
		t.Fatalf("parseSocialVideoProbe() error = %v", err)
	}
	if probe.Width != 1080 || probe.Height != 1920 || probe.DurationMs != 15125 {
		t.Fatalf("probe = %#v", probe)
	}
	for _, raw := range []string{
		`{"streams":[{"codec_type":"audio"}],"format":{"duration":"15"}}`,
		`{"streams":[{"codec_type":"video","width":0,"height":1920}],"format":{"duration":"15"}}`,
		`{"streams":[{"codec_type":"video","width":1080,"height":1920}],"format":{"duration":"N/A"}}`,
		`{"streams":[{"codec_type":"video","width":1080,"height":1920}],"format":{"duration":"181"}}`,
	} {
		if result, err := parseSocialVideoProbe([]byte(raw)); err == nil {
			t.Fatalf("parseSocialVideoProbe(%s) = %#v, want error", raw, result)
		}
	}
}

func TestSocialVideoCommandArgumentsAreNonInteractiveAndSingleVideo(t *testing.T) {
	t.Parallel()
	videoURL := "https://www.tiktok.com/@shop/video/7461234567890123456"
	if got, want := socialVideoMetadataArgs(videoURL), []string{
		"--ignore-config", "--no-playlist", "--no-netrc", "--no-cache-dir", "--skip-download", "--dump-single-json",
		"--socket-timeout", "15", "--retries", "2", "--", videoURL,
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("metadata args = %#v", got)
	}
	if got, want := socialVideoDownloadArgs(videoURL, "/tmp/job/video.%(ext)s", 52428800), []string{
		"--ignore-config", "--no-playlist", "--no-netrc", "--no-cache-dir", "--no-overwrites",
		"--socket-timeout", "15", "--retries", "2", "--fragment-retries", "2", "--max-filesize", "52428800",
		"-f", "b[ext=mp4]/b", "-o", "/tmp/job/video.%(ext)s", "--", videoURL,
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("download args = %#v", got)
	}
}

func TestSocialVideoTaskTimeoutIsTenMinutes(t *testing.T) {
	t.Parallel()
	if got := taskExecutionTimeoutWithPolicy(model.TaskTypeSocialVideoImport, RuntimeTaskPolicy{}); got != 10*time.Minute {
		t.Fatalf("taskExecutionTimeoutWithPolicy() = %v, want 10m", got)
	}
}

func TestResolveSocialVideoURLValidatesEveryRedirectAndStopsAtCanonicalVideo(t *testing.T) {
	t.Parallel()
	requests := 0
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		if req.URL.String() != "https://v.douyin.com/abc123/" {
			t.Fatalf("unexpected request URL %q", req.URL)
		}
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": {"https://www.douyin.com/video/7391234567890123456"}},
			Body:       io.NopCloser(strings.NewReader("ignored")),
			Request:    req,
		}, nil
	})}
	validated := []string{}
	validator := func(raw string) (*url.URL, error) {
		validated = append(validated, raw)
		return url.Parse(raw)
	}
	got, err := resolveSocialVideoURL(context.Background(), socialVideoURL{URL: "https://v.douyin.com/abc123/", Platform: "douyin"}, client, validator)
	if err != nil {
		t.Fatalf("resolveSocialVideoURL() error = %v", err)
	}
	if got != "https://www.douyin.com/video/7391234567890123456" || requests != 1 || len(validated) != 2 {
		t.Fatalf("got=%q requests=%d validated=%#v", got, requests, validated)
	}
}

func TestResolveSocialVideoURLRejectsCrossPlatformRedirect(t *testing.T) {
	t.Parallel()
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": {"https://www.tiktok.com/@shop/video/7461234567890123456"}},
			Body:       io.NopCloser(strings.NewReader("")),
			Request:    req,
		}, nil
	})}
	if got, err := resolveSocialVideoURL(context.Background(), socialVideoURL{URL: "https://v.douyin.com/abc123/", Platform: "douyin"}, client, url.Parse); err == nil {
		t.Fatalf("resolveSocialVideoURL() = %q, want error", got)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }

func newSocialVideoImportTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	return &Service{repo: repository.New(db), dataDir: t.TempDir(), activeCancels: make(map[string]context.CancelFunc)}, db
}
