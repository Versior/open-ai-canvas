package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
		{
			name:     "xiaohongshu http short link is upgraded",
			text:     "复制后打开【小红书】查看笔记！ http://xhslink.com/a/AbCdEf12",
			platform: "xiaohongshu",
			wantURL:  "https://xhslink.com/a/AbCdEf12",
		},
		{
			name:     "xiaohongshu ios share uses the cn short domain",
			text:     "看看这篇笔记 https://xhslink.cn/o/AxnRePgIokn 复制后打开【小红书】",
			platform: "xiaohongshu",
			wantURL:  "https://xhslink.cn/o/AxnRePgIokn",
		},
		{
			name:     "bilibili short link",
			text:     "【开箱】 https://b23.tv/Ab12Cd",
			platform: "bilibili",
			wantURL:  "https://b23.tv/Ab12Cd",
		},
		{
			name:     "youtube watch link keeps query",
			text:     "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			platform: "youtube",
			wantURL:  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
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

func TestSocialVideoAPIURLDropsShareTrackingParameters(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ platform, resolved, want string }{
		{"douyin", "https://www.iesdouyin.com/share/video/7525380501322911011/?region=CN&mid=1&u_code=abc&did=2&share_sign=x", "https://www.douyin.com/video/7525380501322911011"},
		{"douyin", "https://www.douyin.com/video/7391234567890123456?previous_page=web_code_link", "https://www.douyin.com/video/7391234567890123456"},
		{"tiktok", "https://www.tiktok.com/@shop/video/7461234567890123456?_r=1&_t=ZT-abc", "https://www.tiktok.com/@shop/video/7461234567890123456"},
	} {
		if got := socialVideoAPIURL(test.platform, test.resolved); got != test.want {
			t.Errorf("socialVideoAPIURL(%s, %s) = %s, want %s", test.platform, test.resolved, got, test.want)
		}
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
		{name: "unknown platform", text: "https://example.com/video/7391234567890123456"},
		{name: "kuaishou without video path", text: "https://v.kuaishou.com/"},
		{name: "plain HTTP on strict platform", text: "http://www.tiktok.com/@shop/video/7461234567890123456"},
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
	seedSocialVideoParseAPIs(t, svc, socialVideoParseAPI{ID: "api-douyin", Name: "测试接口", Platforms: []string{"douyin"}, Enabled: true, Method: "GET", URL: "https://parse.example.com/?url={url}"})
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

func TestCreateSocialVideoImportTaskRequiresEnabledParseAPI(t *testing.T) {
	svc, db := newSocialVideoImportTestService(t)
	svc.socialVideoURLValidator = url.Parse
	seedSocialVideoParseAPIs(t, svc, socialVideoParseAPI{ID: "api-off", Name: "停用的接口", Platforms: []string{"douyin"}, Enabled: false, Method: "GET", URL: "https://parse.example.com/?url={url}"})
	_, err := svc.CreateSocialVideoImportTask("user-a", "request-key-0002", SocialVideoImportRequest{URL: "https://www.douyin.com/video/7391234567890123456"})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusBadRequest || appErr.Reason != ReasonFailedPrecondition || !strings.Contains(appErr.Message, "抖音") {
		t.Fatalf("error = %#v, want failed precondition naming the platform", err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("task count = %d, %v", count, err)
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

func seedSocialVideoParseAPIs(t *testing.T, svc *Service, apis ...socialVideoParseAPI) {
	t.Helper()
	raw, err := json.Marshal(apis)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: socialVideoParseAPIsKey, ValueJSON: string(raw)}); err != nil {
		t.Fatal(err)
	}
}

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
