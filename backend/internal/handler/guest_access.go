package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// RegisterGuestAccessRoutes 注册游客也能读的展示接口：功能开关、模型目录与 LibTV 公开作品。
// 只读、无凭证、带应用层短缓存；生成、上传、保存、报价与导入仍走要求登录的原接口。
func RegisterGuestAccessRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/public/features", func(c *gin.Context) {
		if !enforceGuestReadLimit(c, "features", 60, 1200) {
			return
		}
		value, err := svc.GuestFeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"features": value})
	})
	r.GET("/public/model-catalog", func(c *gin.Context) {
		if !enforceGuestReadLimit(c, "model-catalog", 30, 600) {
			return
		}
		catalog, err := svc.GuestModelCatalog()
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, catalog)
	})
	r.GET("/public/libtv/gallery", func(c *gin.Context) {
		var req service.LibTVGalleryRequest
		if err := c.ShouldBindQuery(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if !enforceGuestReadLimit(c, "libtv", 20, 200) {
			return
		}
		result, err := svc.GuestLibTVGallery(c.Request.Context(), req)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
	r.GET("/public/libtv/works/:uuid", func(c *gin.Context) {
		if !enforceGuestReadLimit(c, "libtv", 20, 200) {
			return
		}
		result, err := svc.GuestLibTVWork(c.Request.Context(), c.Param("uuid"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
}

// enforceGuestReadLimit 给游客读接口两层限流：每个来源地址一份，再加全站游客共用一份。
// c.ClientIP() 会采信 X-Forwarded-For，可被伪造，所以真正兜底的是全站上限；单地址上限只挡普通的反复刷新。
func enforceGuestReadLimit(c *gin.Context, scope string, perClient, global int) bool {
	return enforceRateLimit(c, "guest-"+scope+":ip:"+c.ClientIP(), perClient, time.Minute) &&
		enforceRateLimit(c, "guest-"+scope+":all", global, time.Minute)
}
