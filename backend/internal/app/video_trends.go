package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/trends"
)

var videoTrendHTTPClient = outbound.OutboundHTTPClient

// The credential, preview and publication flag share one CAS record. Changing
// an account invalidates in-flight reads before its data can reach site users.
type videoTrendSite struct {
	Connection trends.MarketingConnection `json:"connection"`
	Cookie     string                     `json:"cookie,omitempty"`
	Enabled    bool                       `json:"enabled"`
	Version    int64                      `json:"version"`
	Board      *trends.Board              `json:"board,omitempty"`
	LastError  string                     `json:"lastError,omitempty"`
	ReadLease  time.Time                  `json:"readLease,omitzero"`
	ReadAt     time.Time                  `json:"readAt,omitzero"`
}

type VideoTrendConnectionRequest struct {
	AdvertiserID string `json:"advertiserId,omitempty"`
	ProjectID    string `json:"projectId,omitempty"`
	AccessToken  string `json:"accessToken,omitempty"`
	Cookie       string `json:"cookie,omitempty"`
	Enabled      bool   `json:"enabled"`
}
type VideoTrendConnection struct {
	Source           string        `json:"source"`
	Enabled          bool          `json:"enabled"`
	Configured       bool          `json:"configured"`
	AdvertiserID     string        `json:"advertiserId,omitempty"`
	ProjectID        string        `json:"projectId,omitempty"`
	OAuthAvailable   bool          `json:"oauthAvailable"`
	Authorized       bool          `json:"authorized"`
	AdvertiserIDs    []string      `json:"advertiserIds,omitempty"`
	ExpiresAt        time.Time     `json:"expiresAt,omitzero"`
	CookieConfigured bool          `json:"cookieConfigured"`
	Board            *trends.Board `json:"board,omitempty"`
	LastError        string        `json:"lastError,omitempty"`
}

func videoTrendSiteKey(source string) string { return "video_trend_site:" + source }

func (s *Service) readVideoTrendSite(source string) (videoTrendSite, error) {
	row, err := s.repo.SystemSettingOptional(videoTrendSiteKey(source))
	if err != nil || row == nil {
		return videoTrendSite{}, err
	}
	var value videoTrendSite
	if json.Unmarshal([]byte(row.ValueJSON), &value) != nil || (value.Board != nil && (value.Board.Source != source || value.Board.FetchedAt.IsZero())) {
		return videoTrendSite{}, kernel.NewAppError(http.StatusInternalServerError, "读取平台账号配置失败")
	}
	return value, nil
}

func (s *Service) readVideoTrendConnection(source string) (*trends.MarketingConnection, error) {
	stored, err := s.readVideoTrendSite(source)
	if err != nil || stored.Connection.AccessToken == "" {
		return nil, err
	}
	value := stored.Connection
	value.AccessToken, err = s.decryptSettingSecret(value.AccessToken)
	if err == nil && value.RefreshToken != "" {
		value.RefreshToken, err = s.decryptSettingSecret(value.RefreshToken)
	}
	if err != nil {
		return nil, kernel.NewAppError(http.StatusInternalServerError, "读取平台授权凭据失败")
	}
	return &value, nil
}

func (s *Service) VideoCreationTrendConnection(actor *model.User, source string) (VideoTrendConnection, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return VideoTrendConnection{}, err
	}
	if !trends.PlatformSource(source) {
		return VideoTrendConnection{}, BadAuthRequest("不支持的平台账号来源")
	}
	stored, err := s.readVideoTrendSite(source)
	if err != nil {
		return VideoTrendConnection{}, err
	}
	public := VideoTrendConnection{Source: source, Enabled: stored.Enabled, Board: stored.Board, LastError: stored.LastError}
	if source == "douhot" {
		public.CookieConfigured = stored.Cookie != "" || strings.TrimSpace(os.Getenv("CANVAS_DOUHOT_COOKIE")) != ""
		public.Configured = public.CookieConfigured
		return public, nil
	}
	app, appErr := trendOAuthApp(source)
	public.OAuthAvailable = appErr == nil
	value, err := s.readVideoTrendConnection(source)
	if err != nil || value == nil {
		return public, err
	}
	public.AdvertiserID, public.ProjectID = value.AdvertiserID, value.ProjectID
	public.Authorized = appErr == nil && value.AppID == app.id && value.RefreshToken != "" && value.RefreshExpiresAt.After(time.Now())
	public.Configured = trends.ValidateConnection(source, *value) == nil && (value.RefreshToken == "" || public.Authorized)
	public.AdvertiserIDs, public.ExpiresAt = value.AdvertiserIDs, value.ExpiresAt
	return public, nil
}

func (s *Service) AdminVideoTrendSources(actor *model.User) ([]VideoTrendConnection, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	items := make([]VideoTrendConnection, 0, 3)
	for _, source := range []string{"douhot", "qianchuan", "oceanengine"} {
		value, err := s.VideoCreationTrendConnection(actor, source)
		if err != nil {
			return nil, err
		}
		items = append(items, value)
	}
	return items, nil
}

func (s *Service) ConnectVideoCreationTrends(ctx context.Context, actor *model.User, source string, req VideoTrendConnectionRequest) (trends.Board, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return trends.Board{}, err
	}
	if !trends.PlatformSource(source) {
		return trends.Board{}, BadAuthRequest("不支持的平台账号来源")
	}
	initial, err := s.readVideoTrendSite(source)
	if err != nil {
		return trends.Board{}, err
	}
	var board trends.Board
	var connection trends.MarketingConnection
	var cookie string
	req.AccessToken, req.Cookie = strings.TrimSpace(req.AccessToken), strings.TrimSpace(req.Cookie)
	if source == "douhot" {
		if req.AccessToken != "" || req.AdvertiserID != "" || req.ProjectID != "" {
			return trends.Board{}, BadAuthRequest("热点宝只接受站点登录凭据")
		}
		cookie = req.Cookie
		if cookie == "" {
			stored, readErr := s.readVideoTrendSite(source)
			if readErr != nil {
				return trends.Board{}, readErr
			}
			cookie, err = s.decryptSettingSecret(stored.Cookie)
			if err != nil {
				return trends.Board{}, kernel.NewAppError(http.StatusInternalServerError, "读取热点宝登录凭据失败")
			}
			if cookie == "" {
				cookie = strings.TrimSpace(os.Getenv("CANVAS_DOUHOT_COOKIE"))
			}
		}
		board, err = trends.FetchDouhot(ctx, cookie, videoTrendHTTPClient(8*time.Second))
	} else {
		if req.Cookie != "" {
			return trends.Board{}, BadAuthRequest("官方素材接口不接受网页Cookie")
		}
		connection = trends.MarketingConnection{AdvertiserID: strings.TrimSpace(req.AdvertiserID), ProjectID: strings.TrimSpace(req.ProjectID), AccessToken: req.AccessToken}
		if req.AccessToken == "" {
			grant, readErr := s.usableVideoTrendConnection(ctx, actor.ID, source)
			if readErr != nil {
				return trends.Board{}, readErr
			}
			if grant == nil || grant.RefreshToken == "" || !slices.Contains(grant.AdvertiserIDs, connection.AdvertiserID) {
				return trends.Board{}, BadAuthRequest("请选择站点授权允许的广告主账户")
			}
			connection = *grant
			connection.AdvertiserID, connection.ProjectID = strings.TrimSpace(req.AdvertiserID), strings.TrimSpace(req.ProjectID)
		}
		if err := trends.ValidateConnection(source, connection); err != nil {
			return trends.Board{}, BadAuthRequest(err.Error())
		}
		board, err = trends.FetchMarketing(ctx, source, connection, videoTrendHTTPClient(8*time.Second))
	}
	if err != nil {
		return trends.Board{}, kernel.NewAppError(http.StatusBadGateway, err.Error())
	}
	accessToken := connection.AccessToken
	if source == "douhot" {
		cookie, err = s.encryptSettingSecret(cookie)
	} else {
		connection, err = s.encryptVideoTrendConnection(connection)
	}
	if err != nil {
		return trends.Board{}, kernel.NewAppError(http.StatusInternalServerError, "保存平台凭据失败")
	}
	_, err = updateSettingJSON(s, videoTrendSiteKey(source), actor.ID, func(current *videoTrendSite) error {
		if current.Version != initial.Version {
			return kernel.NewAppError(http.StatusConflict, "平台配置已更新，请重新连接")
		}
		if source != "douhot" && req.AccessToken == "" {
			token, decryptErr := s.decryptSettingSecret(current.Connection.AccessToken)
			if decryptErr != nil || token != accessToken || current.Connection.RefreshLease.After(time.Now()) {
				return kernel.NewAppError(http.StatusConflict, "平台授权已更新，请重新选择账户")
			}
		}
		current.Connection, current.Cookie = connection, cookie
		current.Enabled, current.Board, current.LastError = req.Enabled, &board, ""
		current.Version++
		current.ReadLease = time.Time{}
		current.ReadAt = board.FetchedAt
		return nil
	})
	return board, err
}

func (s *Service) refreshVideoTrendSite(ctx context.Context, actorID, source string) (trends.Board, error) {
	stored, err := s.readVideoTrendSite(source)
	if err != nil {
		return trends.Board{}, err
	}
	lease := time.Now().Add(30 * time.Second)
	_, err = updateSettingJSON(s, videoTrendSiteKey(source), actorID, func(current *videoTrendSite) error {
		if current.Version != stored.Version || current.ReadLease.After(time.Now()) {
			return kernel.NewAppError(http.StatusConflict, "平台数据正在更新，请稍后重试")
		}
		current.ReadLease = lease
		current.ReadAt = time.Now()
		return nil
	})
	if err != nil {
		return trends.Board{}, err
	}
	var board trends.Board
	if source == "douhot" {
		cookie, decryptErr := s.decryptSettingSecret(stored.Cookie)
		if decryptErr != nil {
			err = kernel.NewAppError(http.StatusInternalServerError, "读取热点宝登录凭据失败")
		}
		if err == nil {
			if cookie == "" {
				cookie = strings.TrimSpace(os.Getenv("CANVAS_DOUHOT_COOKIE"))
			}
			board, err = trends.FetchDouhot(ctx, cookie, videoTrendHTTPClient(8*time.Second))
		}
	} else {
		var connection *trends.MarketingConnection
		connection, err = s.usableVideoTrendConnection(ctx, actorID, source)
		if err == nil && connection == nil {
			err = BadAuthRequest("请先在后台连接平台账号")
		}
		if err == nil {
			board, err = trends.FetchMarketing(ctx, source, *connection, videoTrendHTTPClient(8*time.Second))
		}
	}
	_, saveErr := updateSettingJSON(s, videoTrendSiteKey(source), actorID, func(current *videoTrendSite) error {
		if current.Version != stored.Version || !current.ReadLease.Equal(lease) {
			return kernel.NewAppError(http.StatusConflict, "平台配置已改变，已忽略旧读取结果")
		}
		current.ReadLease = time.Time{}
		if err != nil {
			current.LastError = err.Error()
		} else {
			current.Board, current.LastError = &board, ""
		}
		return nil
	})
	if saveErr != nil {
		return trends.Board{}, saveErr
	}
	if err != nil {
		return trends.Board{}, kernel.NewAppError(http.StatusBadGateway, err.Error())
	}
	return board, nil
}

func (s *Service) RefreshAdminVideoTrends(ctx context.Context, actor *model.User, source string) (trends.Board, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return trends.Board{}, err
	}
	if !trends.PlatformSource(source) {
		return trends.Board{}, BadAuthRequest("不支持的平台账号来源")
	}
	return s.refreshVideoTrendSite(ctx, actor.ID, source)
}

func (s *Service) SetAdminVideoTrendVisibility(ctx context.Context, actor *model.User, source string, enabled bool) (VideoTrendConnection, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return VideoTrendConnection{}, err
	}
	if !trends.PlatformSource(source) {
		return VideoTrendConnection{}, BadAuthRequest("不支持的平台账号来源")
	}
	if enabled {
		state, err := s.VideoCreationTrendConnection(actor, source)
		if err != nil {
			return VideoTrendConnection{}, err
		}
		if !state.Configured {
			return VideoTrendConnection{}, BadAuthRequest("先连接有效的平台账号并完成账户配置")
		}
	}
	stored, err := s.readVideoTrendSite(source)
	if err != nil {
		return VideoTrendConnection{}, err
	}
	if enabled && (stored.Board == nil || stored.LastError != "" || time.Since(stored.Board.FetchedAt) > 5*time.Minute) {
		if _, err := s.refreshVideoTrendSite(ctx, actor.ID, source); err != nil {
			return VideoTrendConnection{}, err
		}
	}
	_, err = updateSettingJSON(s, videoTrendSiteKey(source), actor.ID, func(current *videoTrendSite) error {
		if current.Version != stored.Version {
			return kernel.NewAppError(http.StatusConflict, "平台配置已更新，请重新读取")
		}
		if enabled && (current.Board == nil || current.LastError != "") {
			return BadAuthRequest("先验证账号并同步数据，再开启前台展示")
		}
		current.Enabled = enabled
		current.Version++
		current.ReadLease = time.Time{}
		return nil
	})
	if err != nil {
		return VideoTrendConnection{}, err
	}
	return s.VideoCreationTrendConnection(actor, source)
}

func (s *Service) DisconnectAdminVideoTrends(actor *model.User, source string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if !trends.PlatformSource(source) {
		return BadAuthRequest("不支持的平台账号来源")
	}
	_, err := updateSettingJSON(s, videoTrendSiteKey(source), actor.ID, func(current *videoTrendSite) error {
		*current = videoTrendSite{Version: current.Version + 1}
		return nil
	})
	return err
}

func (s *Service) VideoCreationTrends(ctx context.Context, actor *model.User, source string) (trends.Board, error) {
	if actor == nil {
		return trends.Board{}, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return trends.Board{}, err
	}
	if !trends.Supported(source) {
		return trends.Board{}, BadAuthRequest("不支持的热点来源")
	}
	if !trends.PlatformSource(source) {
		board, err := trends.Fetch(ctx, source)
		if err != nil {
			return trends.Board{}, kernel.NewAppError(http.StatusBadGateway, err.Error())
		}
		return board, nil
	}
	stored, err := s.readVideoTrendSite(source)
	if err != nil {
		return trends.Board{}, err
	}
	unavailable := trends.Board{Source: source, Status: "unavailable", Topics: []trends.Topic{}}
	if !stored.Enabled {
		return unavailable, nil
	}
	if (stored.Board == nil || time.Since(stored.Board.FetchedAt) > 5*time.Minute) && time.Since(stored.ReadAt) > time.Minute {
		// One shared lease prevents visitors from issuing one platform request each.
		// A failed display read can retain the last published data; writes above cannot.
		if _, refreshErr := s.refreshVideoTrendSite(ctx, actor.ID, source); refreshErr != nil {
			slog.Warn("site video trend refresh failed", "source", source)
		}
		stored, err = s.readVideoTrendSite(source)
		if err != nil {
			return trends.Board{}, err
		}
	}
	if !stored.Enabled || stored.Board == nil {
		return unavailable, nil
	}
	board := *stored.Board
	if stored.LastError != "" || time.Since(board.FetchedAt) > 5*time.Minute {
		board.Status = "stale"
	}
	if source == "qianchuan" {
		board.Description = "千川素材灵感"
	}
	if source == "oceanengine" {
		board.Description = "巨量广告项目推荐"
	}
	return board, nil
}
