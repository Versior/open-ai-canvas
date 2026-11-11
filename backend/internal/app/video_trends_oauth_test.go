package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/trends"
)

func setupTrendOAuth(t *testing.T) {
	t.Helper()
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	t.Setenv("CANVAS_QIANCHUAN_APP_ID", "123")
	t.Setenv("CANVAS_QIANCHUAN_APP_SECRET", "EXAMPLE_APP_SECRET")
	t.Setenv("CANVAS_QIANCHUAN_AUTHORIZE_URL", "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html?app_id=123&rid=EXAMPLE_RID")
}
func TestTrendServerOAuthCallbackIsolatedSingleUseEncrypted(t *testing.T) {
	setupTrendOAuth(t)
	svc, _, _, actor := newAdminStorageDeleteTestService(t)
	old := videoTrendHTTPClient
	t.Cleanup(func() { videoTrendHTTPClient = old })
	requests := 0
	videoTrendHTTPClient = func(time.Duration) *http.Client {
		return &http.Client{Transport: videoTrendTransport(func(req *http.Request) (*http.Response, error) {
			requests++
			if strings.Contains(req.URL.Path, "/video/get/") {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"list":[{"filename":"OAuth账户素材","url":"https://www.douyin.com/video/123"}]}}`))}, nil
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"access_token":"EXAMPLE_ACCESS","refresh_token":"EXAMPLE_REFRESH","expires_in":7200,"refresh_token_expires_in":2592000,"advertiser_ids":[456,789]}}`))}, nil
		})}
	}
	authorization, err := svc.StartVideoTrendAuthorization(actor, "qianchuan")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(authorization.URL)
	state := u.Query().Get("state")
	if u.Query().Get("redirect_uri") != "https://canvas.example.test/api/admin/video-replication/trends/qianchuan/oauth/callback" || u.Query().Get("rid") != "EXAMPLE_RID" || strings.Contains(authorization.URL, "SECRET") {
		t.Fatal("invalid server authorization URL")
	}
	if err := svc.CompleteVideoTrendAuthorization(context.Background(), &model.User{ID: "other", Role: model.UserRoleAdmin}, "qianchuan", state, "EXAMPLE_CODE"); err == nil || requests != 0 {
		t.Fatal("authorization crossed user boundary")
	}
	if err := svc.CompleteVideoTrendAuthorization(context.Background(), actor, "qianchuan", state, "EXAMPLE_CODE"); err != nil {
		t.Fatal(err)
	}
	if err := svc.CompleteVideoTrendAuthorization(context.Background(), actor, "qianchuan", state, "EXAMPLE_CODE"); err == nil || requests != 1 {
		t.Fatal("authorization replay accepted")
	}
	row, _ := svc.repo.SystemSettingOptional(videoTrendSiteKey("qianchuan"))
	if strings.Contains(row.ValueJSON, "EXAMPLE_ACCESS") || strings.Contains(row.ValueJSON, "EXAMPLE_REFRESH") {
		t.Fatal("plaintext grant persisted")
	}
	public, err := svc.VideoCreationTrendConnection(actor, "qianchuan")
	encoded, _ := json.Marshal(public)
	if err != nil || !public.Authorized || !public.OAuthAvailable || len(public.AdvertiserIDs) != 2 || public.Configured || strings.Contains(string(encoded), "Token") {
		t.Fatal("invalid public grant state")
	}
	if _, err := svc.ConnectVideoCreationTrends(context.Background(), actor, "qianchuan", VideoTrendConnectionRequest{AdvertiserID: "999"}); err == nil || requests != 1 {
		t.Fatal("unauthorized advertiser selected")
	}
	board, err := svc.ConnectVideoCreationTrends(context.Background(), actor, "qianchuan", VideoTrendConnectionRequest{AdvertiserID: "456"})
	if err != nil || len(board.Topics) != 1 || requests != 2 {
		t.Fatalf("authorized account selection failed: %v", err)
	}
	stored, _ := svc.readVideoTrendSite("qianchuan")
	if stored.Enabled || stored.Board == nil {
		t.Fatal("OAuth account selection published without review")
	}
}
func TestTrendOAuthExpiryAndRefreshLease(t *testing.T) {
	setupTrendOAuth(t)
	svc, _, _, actor := newAdminStorageDeleteTestService(t)
	grant := trends.MarketingConnection{AppID: "123", AdvertiserID: "456", AdvertiserIDs: []string{"456"}, AccessToken: "EXAMPLE_OLD_ACCESS", RefreshToken: "EXAMPLE_OLD_REFRESH", ExpiresAt: time.Now().Add(-time.Minute), RefreshExpiresAt: time.Now().Add(time.Hour)}
	if err := svc.saveVideoTrendConnection(actor.ID, "qianchuan", grant); err != nil {
		t.Fatal(err)
	}
	old := videoTrendHTTPClient
	t.Cleanup(func() { videoTrendHTTPClient = old })
	entered, release := make(chan struct{}), make(chan struct{})
	videoTrendHTTPClient = func(time.Duration) *http.Client {
		return &http.Client{Transport: videoTrendTransport(func(req *http.Request) (*http.Response, error) {
			if !strings.HasSuffix(req.URL.Path, "/oauth2/refresh_token/") {
				t.Fatal("invalid refresh endpoint")
			}
			close(entered)
			<-release
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0,"data":{"access_token":"EXAMPLE_NEW_ACCESS","refresh_token":"EXAMPLE_NEW_REFRESH","expires_in":7200,"refresh_token_expires_in":2592000}}`))}, nil
		})}
	}
	done := make(chan error, 1)
	go func() {
		_, err := svc.usableVideoTrendConnection(context.Background(), actor.ID, "qianchuan")
		done <- err
	}()
	<-entered
	_, err := svc.usableVideoTrendConnection(context.Background(), actor.ID, "qianchuan")
	close(release)
	if err == nil {
		t.Fatal("concurrent refresh reused single-use refresh token")
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	value, err := svc.usableVideoTrendConnection(context.Background(), actor.ID, "qianchuan")
	if err != nil || value.AccessToken != "EXAMPLE_NEW_ACCESS" || value.AdvertiserID != "456" {
		t.Fatal("refreshed grant not reused")
	}
	authorization, err := svc.StartVideoTrendAuthorization(actor, "qianchuan")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(authorization.URL)
	_, err = updateSettingJSON(svc, trendStateKey(actor.ID, "qianchuan"), actor.ID, func(value *trendOAuthState) error { value.ExpiresAt = time.Now().Add(-time.Minute); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if err = svc.CompleteVideoTrendAuthorization(context.Background(), actor, "qianchuan", u.Query().Get("state"), "EXAMPLE_CODE"); err == nil {
		t.Fatal("expired state accepted")
	}
}
func TestTrendOAuthRequiresApprovedOfficialURLAndHTTPSCallback(t *testing.T) {
	setupTrendOAuth(t)
	t.Setenv("CANVAS_QIANCHUAN_AUTHORIZE_URL", "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html?app_id=123&state=platform_template&redirect_uri=https%3A%2F%2Fold.example.test")
	svc, _, _, actor := newAdminStorageDeleteTestService(t)
	value, err := svc.StartVideoTrendAuthorization(actor, "qianchuan")
	if err != nil {
		t.Fatal("official link with template state rejected")
	}
	u, _ := url.Parse(value.URL)
	if len(u.Query().Get("state")) != 64 || u.Query().Get("state") == "platform_template" || u.Query().Get("redirect_uri") != "https://canvas.example.test/api/admin/video-replication/trends/qianchuan/oauth/callback" {
		t.Fatal("platform template state or callback not replaced")
	}
	for _, value := range []string{"https://evil.example/?app_id=123", "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html?app_id=456", "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html?app_id=123&access_token=EXAMPLE_TOKEN"} {
		t.Setenv("CANVAS_QIANCHUAN_AUTHORIZE_URL", value)
		if _, err := trendOAuthApp("qianchuan"); err == nil || strings.Contains(err.Error(), "EXAMPLE_TOKEN") {
			t.Fatal("untrusted authorize URL accepted or leaked")
		}
	}
	setupTrendOAuth(t)
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "http://canvas.example.test")
	if _, err := trendOAuthApp("qianchuan"); err == nil {
		t.Fatal("non-HTTPS callback accepted")
	}
}

func TestTrendOAuthChangedApplicationAndIncompleteProjectAreNotConnected(t *testing.T) {
	setupTrendOAuth(t)
	svc, _, _, actor := newAdminStorageDeleteTestService(t)
	grant := trends.MarketingConnection{AppID: "123", AdvertiserID: "456", AdvertiserIDs: []string{"456"}, AccessToken: "EXAMPLE_ACCESS", RefreshToken: "EXAMPLE_REFRESH", ExpiresAt: time.Now().Add(time.Hour), RefreshExpiresAt: time.Now().Add(time.Hour)}
	if err := svc.saveVideoTrendConnection(actor.ID, "qianchuan", grant); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_QIANCHUAN_APP_ID", "789")
	t.Setenv("CANVAS_QIANCHUAN_AUTHORIZE_URL", "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html?app_id=789")
	public, err := svc.VideoCreationTrendConnection(actor, "qianchuan")
	if err != nil || !public.OAuthAvailable || public.Authorized || public.Configured {
		t.Fatal("changed application still shown as connected")
	}
	if _, err := svc.SetAdminVideoTrendVisibility(context.Background(), actor, "qianchuan", true); err == nil {
		t.Fatal("changed application published")
	}
	t.Setenv("CANVAS_OCEANENGINE_APP_ID", "123")
	t.Setenv("CANVAS_OCEANENGINE_APP_SECRET", "EXAMPLE_APP_SECRET")
	t.Setenv("CANVAS_OCEANENGINE_AUTHORIZE_URL", "https://open.oceanengine.com/audit/oauth.html?app_id=123")
	if err := svc.saveVideoTrendConnection(actor.ID, "oceanengine", grant); err != nil {
		t.Fatal(err)
	}
	public, err = svc.VideoCreationTrendConnection(actor, "oceanengine")
	if err != nil || !public.Authorized || public.Configured {
		t.Fatal("missing project shown as connected")
	}
	board, err := svc.VideoCreationTrends(context.Background(), actor, "oceanengine")
	if err != nil || board.Status != "unavailable" || len(board.Topics) != 0 {
		t.Fatal("unconfigured project visible on public page")
	}
}
