// 第三方视频解析接口池：后台管理（接口、订阅源、设置、测试、导入导出）与给前端识别链接用的平台列表。
package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func bindSocialVideoParseJSON(c *gin.Context, limit int64, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	if err := c.ShouldBindJSON(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, http.StatusRequestEntityTooLarge, errors.New("请求正文太大"))
			return false
		}
		fail(c, http.StatusBadRequest, err)
		return false
	}
	return true
}

func RegisterSocialVideoParseRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/social-video/platforms", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		platforms, err := svc.SocialVideoPlatforms()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"platforms": platforms})
	})
	r.GET("/admin/social-video/parse", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.AdminSocialVideoParseOverview(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})
	r.PATCH("/admin/social-video/parse/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SocialVideoParseSettings
		if !bindSocialVideoParseJSON(c, 64<<10, &req) {
			return
		}
		settings, err := svc.UpdateSocialVideoParseSettings(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"settings": settings})
	})
	r.POST("/admin/social-video/parse-apis", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SocialVideoParseAPIRequest
		if !bindSocialVideoParseJSON(c, 64<<10, &req) {
			return
		}
		api, err := svc.CreateSocialVideoParseAPI(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"api": api})
	})
	r.PATCH("/admin/social-video/parse-apis/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SocialVideoParseAPIRequest
		if !bindSocialVideoParseJSON(c, 64<<10, &req) {
			return
		}
		api, err := svc.UpdateSocialVideoParseAPI(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"api": api})
	})
	r.PUT("/admin/social-video/parse-apis/:id/enabled", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Enabled bool `json:"enabled"`
		}
		if !bindSocialVideoParseJSON(c, 4<<10, &req) {
			return
		}
		api, err := svc.SetSocialVideoParseAPIEnabled(user, c.Param("id"), req.Enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"api": api})
	})
	r.POST("/admin/social-video/parse-apis/:id/duplicate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		api, err := svc.DuplicateSocialVideoParseAPI(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"api": api})
	})
	r.POST("/admin/social-video/parse-apis/:id/reset", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		api, err := svc.ResetSocialVideoParseAPI(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"api": api})
	})
	r.DELETE("/admin/social-video/parse-apis/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSocialVideoParseAPI(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.POST("/admin/social-video/parse-apis/test", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "admin-social-video-parse-test:"+user.ID, 30, time.Minute) {
			return
		}
		var req service.SocialVideoParseTestRequest
		if !bindSocialVideoParseJSON(c, 64<<10, &req) {
			return
		}
		result, err := svc.TestSocialVideoParseAPI(c.Request.Context(), user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/social-video/parse-apis/test-all", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "admin-social-video-parse-test-all:"+user.ID, 4, time.Minute) {
			return
		}
		var req service.SocialVideoParseBatchTestRequest
		if !bindSocialVideoParseJSON(c, 16<<10, &req) {
			return
		}
		result, err := svc.TestSocialVideoParseAPIs(c.Request.Context(), user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/social-video/parse-apis/export", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			IDs []string `json:"ids"`
		}
		if !bindSocialVideoParseJSON(c, 16<<10, &req) {
			return
		}
		document, err := svc.ExportSocialVideoParseAPIs(user, req.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, document)
	})
	r.POST("/admin/social-video/parse-apis/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "admin-social-video-parse-import:"+user.ID, 6, time.Minute) {
			return
		}
		var req service.SocialVideoParseImportRequest
		if !bindSocialVideoParseJSON(c, 2<<20, &req) {
			return
		}
		result, err := svc.ImportSocialVideoParseAPIs(c.Request.Context(), user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/social-video/parse-sources", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SocialVideoParseSourceRequest
		if !bindSocialVideoParseJSON(c, 16<<10, &req) {
			return
		}
		source, err := svc.CreateSocialVideoParseSource(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"source": source})
	})
	r.PATCH("/admin/social-video/parse-sources/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SocialVideoParseSourceRequest
		if !bindSocialVideoParseJSON(c, 16<<10, &req) {
			return
		}
		source, err := svc.UpdateSocialVideoParseSource(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"source": source})
	})
	r.DELETE("/admin/social-video/parse-sources/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSocialVideoParseSource(user, c.Param("id"), c.Query("removeApis") == "1"); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.POST("/admin/social-video/parse-sources/:id/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "admin-social-video-parse-sync:"+user.ID, 6, time.Minute) {
			return
		}
		result, err := svc.SyncSocialVideoParseSource(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
