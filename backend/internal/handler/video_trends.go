package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func videoTrendAdmin(c *gin.Context, svc *service.Service) (*model.User, bool) {
	user, err := currentUser(c, svc)
	if err == nil {
		err = svc.RequireAdmin(user)
	}
	if err != nil {
		failService(c, err)
		return nil, false
	}
	return user, true
}

func bindVideoTrendJSON(c *gin.Context, target any, limit int64) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, limit))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		failService(c, service.BadAuthRequest("平台设置格式无效"))
		return false
	}
	return true
}

func RegisterVideoTrendRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/video-creation/trends", RequireFeature(svc, service.FeatureVideoReplication), func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "video-trends:"+user.ID, 20, time.Minute) {
			return
		}
		board, err := svc.VideoCreationTrends(c.Request.Context(), user, c.DefaultQuery("source", "baidu"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, board)
	})
	admin := r.Group("/admin/video-replication/trends")
	admin.GET("", func(c *gin.Context) {
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		items, err := svc.AdminVideoTrendSources(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, items)
	})
	admin.POST("/:source/oauth", func(c *gin.Context) {
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		if !enforceRateLimit(c, "video-trend-authorize:"+user.ID, 5, time.Minute) {
			return
		}
		value, err := svc.StartVideoTrendAuthorization(user, c.Param("source"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	admin.GET("/:source/oauth/callback", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		if !enforceRateLimit(c, "video-trend-callback:"+user.ID, 5, time.Minute) {
			return
		}
		query := c.Request.URL.Query()
		if len(query["auth_code"]) != 1 || len(query["state"]) != 1 || query.Get("error") != "" {
			c.String(http.StatusBadRequest, "平台授权未完成，请返回后台重新发起。")
			return
		}
		if err := svc.CompleteVideoTrendAuthorization(c.Request.Context(), user, c.Param("source"), query.Get("state"), query.Get("auth_code")); err != nil {
			c.String(http.StatusBadRequest, "平台授权未完成，请检查应用、账户权限与回调配置后返回后台重新授权。")
			return
		}
		c.Redirect(http.StatusSeeOther, "/admin/video-replication?tab=trends&source="+c.Param("source"))
	})
	admin.PUT("/:source/connection", func(c *gin.Context) {
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		if !enforceRateLimit(c, "video-trend-connect:"+user.ID, 5, time.Minute) {
			return
		}
		var req service.VideoTrendConnectionRequest
		if !bindVideoTrendJSON(c, &req, 24<<10) {
			return
		}
		board, err := svc.ConnectVideoCreationTrends(c.Request.Context(), user, c.Param("source"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, board)
	})
	admin.POST("/:source/refresh", func(c *gin.Context) {
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		if !enforceRateLimit(c, "video-trend-refresh:"+user.ID, 5, time.Minute) {
			return
		}
		board, err := svc.RefreshAdminVideoTrends(c.Request.Context(), user, c.Param("source"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, board)
	})
	admin.PATCH("/:source", func(c *gin.Context) {
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if !bindVideoTrendJSON(c, &req, 1024) {
			return
		}
		if req.Enabled == nil {
			failService(c, service.BadAuthRequest("请指定前台展示状态"))
			return
		}
		value, err := svc.SetAdminVideoTrendVisibility(c.Request.Context(), user, c.Param("source"), *req.Enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	admin.DELETE("/:source/connection", func(c *gin.Context) {
		user, valid := videoTrendAdmin(c, svc)
		if !valid {
			return
		}
		if err := svc.DisconnectAdminVideoTrends(user, c.Param("source")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"disconnected": true})
	})
}
