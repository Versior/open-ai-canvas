package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/trends"
)

type videoTrendTransport func(*http.Request) (*http.Response, error)

func (fn videoTrendTransport) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }

func TestVideoTrendSitePublicationAndEncryptedCredentials(t *testing.T) {
	svc, _, _, admin := newAdminStorageDeleteTestService(t)
	oldClient := videoTrendHTTPClient
	t.Cleanup(func() { videoTrendHTTPClient = oldClient })
	rejected, requests := false, 0
	videoTrendHTTPClient = func(time.Duration) *http.Client {
		return &http.Client{Transport: videoTrendTransport(func(req *http.Request) (*http.Response, error) {
			requests++
			raw := `{"code":0,"data":{"list":[{"filename":"测试素材","url":"https://www.douyin.com/video/123"}]}}`
			if rejected {
				raw = `{"code":401,"message":"EXAMPLE_ACCESS"}`
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(raw))}, nil
		})}
	}
	input := VideoTrendConnectionRequest{AdvertiserID: "123", AccessToken: "EXAMPLE_ACCESS"}
	if _, err := svc.ConnectVideoCreationTrends(context.Background(), nil, "qianchuan", input); err == nil {
		t.Fatal("anonymous connection accepted")
	}
	board, err := svc.ConnectVideoCreationTrends(context.Background(), admin, "qianchuan", input)
	if err != nil || len(board.Topics) != 1 {
		t.Fatalf("connection failed: %v", err)
	}
	row, err := svc.repo.SystemSettingOptional(videoTrendSiteKey("qianchuan"))
	if err != nil || row == nil || strings.Contains(row.ValueJSON, input.AccessToken) {
		t.Fatal("plaintext credential stored")
	}
	value, err := svc.readVideoTrendConnection("qianchuan")
	if err != nil || value.AccessToken != input.AccessToken {
		t.Fatal("credential cannot be decrypted")
	}
	state, err := svc.VideoCreationTrendConnection(admin, "qianchuan")
	raw, _ := json.Marshal(state)
	if err != nil || !state.Configured || state.Enabled || state.AdvertiserID != "123" || strings.Contains(string(raw), "accessToken") {
		t.Fatal("invalid admin preview")
	}
	viewer := &model.User{ID: "viewer", Role: model.UserRoleUser}
	loaded, err := svc.VideoCreationTrends(context.Background(), viewer, "qianchuan")
	if err != nil || loaded.Status != "unavailable" || len(loaded.Topics) != 0 {
		t.Fatal("unpublished account content visible")
	}
	if _, err = svc.SetAdminVideoTrendVisibility(context.Background(), admin, "qianchuan", true); err != nil {
		t.Fatal(err)
	}
	for _, user := range []*model.User{viewer, {ID: "another-viewer", Role: model.UserRoleUser}} {
		loaded, err = svc.VideoCreationTrends(context.Background(), user, "qianchuan")
		raw, _ = json.Marshal(loaded)
		if err != nil || loaded.Status != "api" || len(loaded.Topics) != 1 || requests != 1 || strings.Contains(string(raw), "advertiserId") || strings.Contains(string(raw), "EXAMPLE_ACCESS") {
			t.Fatal("shared read leaked account data or repeated upstream request")
		}
	}
	rejected = true
	before, _ := svc.repo.SystemSettingOptional(videoTrendSiteKey("qianchuan"))
	input.AdvertiserID = "456"
	if _, err := svc.ConnectVideoCreationTrends(context.Background(), admin, "qianchuan", input); err == nil || strings.Contains(err.Error(), input.AccessToken) {
		t.Fatal("unsafe platform denial")
	}
	after, _ := svc.repo.SystemSettingOptional(videoTrendSiteKey("qianchuan"))
	if after.ValueJSON != before.ValueJSON {
		t.Fatal("failed validation overwrote working account")
	}
	if _, err := svc.RefreshAdminVideoTrends(context.Background(), admin, "qianchuan"); err == nil {
		t.Fatal("failed refresh reported success")
	}
	loaded, err = svc.VideoCreationTrends(context.Background(), viewer, "qianchuan")
	if err != nil || loaded.Status != "stale" || len(loaded.Topics) != 1 {
		t.Fatal("failed refresh discarded published content")
	}
	if _, err := svc.SetAdminVideoTrendVisibility(context.Background(), admin, "qianchuan", false); err != nil {
		t.Fatal(err)
	}
	loaded, _ = svc.VideoCreationTrends(context.Background(), viewer, "qianchuan")
	if loaded.Status != "unavailable" || len(loaded.Topics) != 0 {
		t.Fatal("disabled content visible")
	}
	if err := svc.DisconnectAdminVideoTrends(admin, "qianchuan"); err != nil {
		t.Fatal(err)
	}
	stored, _ := svc.readVideoTrendSite("qianchuan")
	if stored.Connection.AccessToken != "" || stored.Board != nil || stored.Enabled {
		t.Fatal("disconnect retained account data")
	}
}

func TestVideoTrendDouhotRequiresAdminValidationAndPublication(t *testing.T) {
	t.Setenv("CANVAS_DOUHOT_COOKIE", "sessionid=EXAMPLE_SERVER_SESSION")
	svc, _, _, admin := newAdminStorageDeleteTestService(t)
	old := videoTrendHTTPClient
	t.Cleanup(func() { videoTrendHTTPClient = old })
	requests := 0
	videoTrendHTTPClient = func(time.Duration) *http.Client {
		return &http.Client{Transport: videoTrendTransport(func(req *http.Request) (*http.Response, error) {
			requests++
			if req.Method != http.MethodPost || req.URL.String() != "https://douhot.douyin.com/douhot/v1/material/video_billboard" || req.Header.Get("Cookie") == "" {
				t.Fatal("invalid server-side request")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"objs":[{"item_title":"服务器榜单合同","item_id":"123"}]}}`))}, nil
		})}
	}
	viewer := &model.User{ID: "viewer", Role: model.UserRoleUser}
	board, err := svc.VideoCreationTrends(context.Background(), viewer, "douhot")
	if err != nil || requests != 0 || board.Status != "unavailable" {
		t.Fatal("environment cookie implicitly published")
	}
	board, err = svc.ConnectVideoCreationTrends(context.Background(), admin, "douhot", VideoTrendConnectionRequest{})
	if err != nil || requests != 1 || board.Status != "web_api" || len(board.Topics) != 1 {
		t.Fatal("admin connection failed")
	}
	if _, err := svc.SetAdminVideoTrendVisibility(context.Background(), admin, "douhot", true); err != nil {
		t.Fatal(err)
	}
	board, err = svc.VideoCreationTrends(context.Background(), viewer, "douhot")
	raw, _ := json.Marshal(board)
	if err != nil || requests != 1 || len(board.Topics) != 1 || strings.Contains(string(raw), "EXAMPLE_SERVER_SESSION") {
		t.Fatal("invalid published douhot data")
	}
	row, _ := svc.repo.SystemSettingOptional(videoTrendSiteKey("douhot"))
	if strings.Contains(row.ValueJSON, "EXAMPLE_SERVER_SESSION") {
		t.Fatal("plaintext cookie persisted")
	}
}

func TestVideoTrendInflightReadCannotRepublishAfterDisable(t *testing.T) {
	svc, _, _, admin := newAdminStorageDeleteTestService(t)
	old := videoTrendHTTPClient
	t.Cleanup(func() { videoTrendHTTPClient = old })
	entered, release := make(chan struct{}), make(chan struct{})
	videoTrendHTTPClient = func(time.Duration) *http.Client {
		return &http.Client{Transport: videoTrendTransport(func(*http.Request) (*http.Response, error) {
			close(entered)
			<-release
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"list":[{"filename":"旧读取结果","url":"https://www.douyin.com/video/123"}]}}`))}, nil
		})}
	}
	credential, _ := svc.encryptSettingSecret("EXAMPLE_ACCESS")
	_, err := updateSettingJSON(svc, videoTrendSiteKey("qianchuan"), admin.ID, func(value *videoTrendSite) error {
		value.Enabled = true
		value.Connection.AdvertiserID = "123"
		value.Connection.AccessToken = credential
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := svc.RefreshAdminVideoTrends(context.Background(), admin, "qianchuan"); done <- err }()
	<-entered
	if _, err := svc.RefreshAdminVideoTrends(context.Background(), admin, "qianchuan"); err == nil {
		t.Fatal("duplicate upstream refresh accepted")
	}
	if _, err := svc.SetAdminVideoTrendVisibility(context.Background(), admin, "qianchuan", false); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("old read committed after configuration change")
	}
	stored, _ := svc.readVideoTrendSite("qianchuan")
	if stored.Enabled || stored.Board != nil {
		t.Fatal("old read republished content")
	}
}

func TestVideoTrendPrivateLegacyDataIsNotShared(t *testing.T) {
	svc, _, _, admin := newAdminStorageDeleteTestService(t)
	viewer := &model.User{ID: "legacy-viewer", Role: model.UserRoleUser}
	_, err := updateSettingJSON(svc, "video_trend_board:"+viewer.ID+":douhot", admin.ID, func(board *trends.Board) error {
		*board = trends.Board{Source: "douhot", Status: "synced", FetchedAt: time.Now(), Topics: []trends.Topic{{Title: "私人旧选题", URL: "https://www.douyin.com/video/123", Rank: 1}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	board, err := svc.VideoCreationTrends(context.Background(), viewer, "douhot")
	if err != nil || board.Status != "unavailable" || len(board.Topics) != 0 {
		t.Fatal("private legacy board implicitly shared")
	}
	old, _ := svc.repo.SystemSettingOptional("video_trend_board:" + viewer.ID + ":douhot")
	if old == nil || !strings.Contains(old.ValueJSON, "私人旧选题") {
		t.Fatal("legacy data destroyed")
	}
}
