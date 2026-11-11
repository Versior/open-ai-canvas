package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/trends"
)

type trendOAuthConfig struct{ id, secret, authorizeURL, callback string }
type VideoTrendAuthorization struct {
	URL string `json:"url"`
}
type trendOAuthState struct {
	Hash      string    `json:"hash"`
	UserID    string    `json:"userId"`
	Source    string    `json:"source"`
	AppID     string    `json:"appId"`
	ExpiresAt time.Time `json:"expiresAt"`
	Consumed  bool      `json:"consumed"`
}

func trendOAuthApp(source string) (trendOAuthConfig, error) {
	if !trends.MarketingSource(source) {
		return trendOAuthConfig{}, BadAuthRequest("该来源不支持巨量应用授权")
	}
	prefix := "CANVAS_" + strings.ToUpper(source)
	app := trendOAuthConfig{id: strings.TrimSpace(os.Getenv(prefix + "_APP_ID")), secret: strings.TrimSpace(os.Getenv(prefix + "_APP_SECRET")), authorizeURL: strings.TrimSpace(os.Getenv(prefix + "_AUTHORIZE_URL"))}
	id, err := strconv.ParseInt(app.id, 10, 64)
	base, baseErr := url.Parse(strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_PUBLIC_BASE_URL")), "/"))
	authURL, authErr := url.Parse(app.authorizeURL)
	host, path := "open.oceanengine.com", "/audit/oauth.html"
	if source == "qianchuan" {
		host, path = "qianchuan.jinritemai.com", "/openapi/qc/audit/oauth.html"
	}
	if err != nil || id <= 0 || app.secret == "" || len(app.secret) > 4096 || strings.ContainsAny(app.secret, "\x00\r\n") || baseErr != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || base.Path != "" || authErr != nil || authURL.Scheme != "https" || authURL.Host != host || authURL.Path != path || authURL.User != nil || authURL.Fragment != "" {
		return trendOAuthConfig{}, kernel.NewAppError(http.StatusServiceUnavailable, "管理员尚未配置该平台的授权应用、官方授权链接和HTTPS公网回调地址")
	}
	query := authURL.Query()
	for key := range query {
		if !slices.Contains([]string{"app_id", "rid", "material_auth", "state", "redirect_uri"}, key) || len(query[key]) != 1 {
			return trendOAuthConfig{}, kernel.NewAppError(http.StatusServiceUnavailable, "官方授权链接配置无效")
		}
	}
	if query.Get("app_id") != app.id {
		return trendOAuthConfig{}, kernel.NewAppError(http.StatusServiceUnavailable, "授权链接与应用ID不一致")
	}
	app.callback = base.String() + "/api/admin/video-replication/trends/" + source + "/oauth/callback"
	return app, nil
}

func trendStateHash(state string) string {
	hash := sha256.Sum256([]byte(state))
	return hex.EncodeToString(hash[:])
}
func trendStateKey(user, source string) string {
	return "video_trend_admin_oauth:" + user + ":" + source
}
func (s *Service) StartVideoTrendAuthorization(actor *model.User, source string) (VideoTrendAuthorization, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return VideoTrendAuthorization{}, err
	}
	app, err := trendOAuthApp(source)
	if err != nil {
		return VideoTrendAuthorization{}, err
	}
	nonce := make([]byte, 32)
	if _, err = rand.Read(nonce); err != nil {
		return VideoTrendAuthorization{}, kernel.NewAppError(http.StatusInternalServerError, "创建授权状态失败")
	}
	state := hex.EncodeToString(nonce)
	_, err = updateSettingJSON(s, trendStateKey(actor.ID, source), actor.ID, func(value *trendOAuthState) error {
		*value = trendOAuthState{Hash: trendStateHash(state), UserID: actor.ID, Source: source, AppID: app.id, ExpiresAt: time.Now().Add(10 * time.Minute)}
		return nil
	})
	if err != nil {
		return VideoTrendAuthorization{}, err
	}
	u, _ := url.Parse(app.authorizeURL)
	query := u.Query()
	query.Set("state", state)
	query.Set("redirect_uri", app.callback)
	u.RawQuery = query.Encode()
	return VideoTrendAuthorization{URL: u.String()}, nil
}
func (s *Service) CompleteVideoTrendAuthorization(ctx context.Context, actor *model.User, source, state, code string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	app, err := trendOAuthApp(source)
	if err != nil {
		return err
	}
	if len(state) != 64 || code == "" || len(code) > 4096 {
		return BadAuthRequest("授权回调无效，请重新发起")
	}
	if _, err := hex.DecodeString(state); err != nil {
		return BadAuthRequest("授权状态无效")
	}
	// Consumed is persisted with CAS before exchange, so callbacks cannot race or replay across replicas.
	_, err = updateSettingJSON(s, trendStateKey(actor.ID, source), actor.ID, func(value *trendOAuthState) error {
		if value.Consumed || value.Hash != trendStateHash(state) || value.UserID != actor.ID || value.Source != source || value.AppID != app.id || !value.ExpiresAt.After(time.Now()) {
			return BadAuthRequest("授权状态已过期、已使用或与当前账号不匹配")
		}
		value.Consumed = true
		return nil
	})
	if err != nil {
		return err
	}
	token, err := trends.ExchangeOAuth(ctx, app.id, app.secret, code, videoTrendHTTPClient(8*time.Second))
	if err != nil {
		return kernel.NewAppError(http.StatusBadGateway, err.Error())
	}
	if len(token.AdvertiserIDs) == 0 {
		return BadAuthRequest("平台未返回授权广告主，请检查应用和账户授权范围")
	}
	connection := tokenConnection(app.id, token)
	if len(connection.AdvertiserIDs) == 1 {
		connection.AdvertiserID = connection.AdvertiserIDs[0]
	}
	return s.saveVideoTrendConnection(actor.ID, source, connection)
}
func tokenConnection(appID string, token trends.OAuthToken) trends.MarketingConnection {
	value := trends.MarketingConnection{AppID: appID, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, ExpiresAt: time.Now().Add(time.Duration(token.ExpiresIn) * time.Second), RefreshExpiresAt: time.Now().Add(time.Duration(token.RefreshExpiresIn) * time.Second)}
	for _, id := range token.AdvertiserIDs {
		value.AdvertiserIDs = append(value.AdvertiserIDs, strconv.FormatInt(id, 10))
	}
	return value
}
func (s *Service) encryptVideoTrendConnection(value trends.MarketingConnection) (trends.MarketingConnection, error) {
	var err error
	value.AccessToken, err = s.encryptSettingSecret(value.AccessToken)
	if err == nil && value.RefreshToken != "" {
		value.RefreshToken, err = s.encryptSettingSecret(value.RefreshToken)
	}
	if err != nil {
		return value, kernel.NewAppError(http.StatusInternalServerError, "保存授权凭据失败")
	}
	return value, nil
}
func (s *Service) saveVideoTrendConnection(user, source string, value trends.MarketingConnection) error {
	value, err := s.encryptVideoTrendConnection(value)
	if err != nil {
		return err
	}
	_, err = updateSettingJSON(s, videoTrendSiteKey(source), user, func(current *videoTrendSite) error {
		current.Connection = value
		current.Enabled, current.Board, current.LastError = false, nil, ""
		current.Version++
		current.ReadLease = time.Time{}
		return nil
	})
	return err
}
func (s *Service) usableVideoTrendConnection(ctx context.Context, user, source string) (*trends.MarketingConnection, error) {
	value, err := s.readVideoTrendConnection(source)
	if err != nil || value == nil || value.RefreshToken == "" {
		return value, err
	}
	app, err := trendOAuthApp(source)
	if err != nil {
		return nil, err
	}
	if value.AppID != app.id || !value.RefreshExpiresAt.After(time.Now()) {
		return nil, BadAuthRequest("平台授权已过期或应用已更换，请重新授权")
	}
	if value.ExpiresAt.After(time.Now().Add(time.Minute)) {
		return value, nil
	}
	lease := time.Now().Add(30 * time.Second)
	_, err = updateSettingJSON(s, videoTrendSiteKey(source), user, func(current *videoTrendSite) error {
		if current.Connection.RefreshLease.After(time.Now()) {
			return kernel.NewAppError(http.StatusConflict, "平台授权正在刷新，请稍后重试")
		}
		refresh, decryptErr := s.decryptSettingSecret(current.Connection.RefreshToken)
		if decryptErr != nil || refresh != value.RefreshToken {
			return kernel.NewAppError(http.StatusConflict, "授权已被更新，请重新读取")
		}
		current.Connection.RefreshLease = lease
		return nil
	})
	if err != nil {
		return nil, err
	}
	token, refreshErr := trends.RefreshOAuth(ctx, app.id, app.secret, value.RefreshToken, videoTrendHTTPClient(8*time.Second))
	var next trends.MarketingConnection
	if refreshErr == nil {
		next = tokenConnection(app.id, token)
		if len(next.AdvertiserIDs) == 0 {
			next.AdvertiserIDs = value.AdvertiserIDs
		}
		if value.AdvertiserID != "" && !slices.Contains(next.AdvertiserIDs, value.AdvertiserID) {
			refreshErr = fmt.Errorf("平台授权账户已改变，请重新授权")
		}
		next.AdvertiserID, next.ProjectID = value.AdvertiserID, value.ProjectID
		if refreshErr == nil {
			next, refreshErr = s.encryptVideoTrendConnection(next)
		}
	}
	_, saveErr := updateSettingJSON(s, videoTrendSiteKey(source), user, func(current *videoTrendSite) error {
		if !current.Connection.RefreshLease.Equal(lease) {
			return kernel.NewAppError(http.StatusConflict, "授权已被更新，请重新读取")
		}
		if refreshErr == nil {
			current.Connection = next
		} else {
			current.Connection.RefreshLease = time.Time{}
		}
		return nil
	})
	if saveErr != nil {
		return nil, saveErr
	}
	if refreshErr != nil {
		return nil, kernel.NewAppError(http.StatusBadGateway, refreshErr.Error())
	}
	return s.readVideoTrendConnection(source)
}
