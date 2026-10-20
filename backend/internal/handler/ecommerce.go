package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"time"
	"yingce/backend/internal/service"
)

func RegisterEcommerceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/ecommerce/templates", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		size, err := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.EcommerceCatalog(actor, c.Query("q"), page, size)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-cache")
		ok(c, value)
	})
	r.GET("/ecommerce/templates/:templateId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.EcommerceCatalogTemplate(actor, c.Param("templateId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-cache")
		ok(c, gin.H{"template": value})
	})
	r.GET("/admin/settings/ecommerce/defaults", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.AdminEcommerceDefaults(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"defaults": value})
	})
	r.GET("/ecommerce/settings", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.EcommerceSetting(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"setting": value})
	})
	r.GET("/admin/settings/ecommerce", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.AdminEcommerceSetting(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": value})
	})
	r.GET("/admin/settings/ecommerce/previous", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.PreviousEcommerceSetting(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": value})
	})
	r.PUT("/admin/settings/ecommerce", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.EcommerceSetting
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.UpdateEcommerceSetting(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": value})
	})
	r.POST("/admin/settings/ecommerce/images", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 11<<20)
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-ecommerce-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		resource, err := svc.UploadEcommerceModelImage(actor, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
	r.GET("/ecommerce/models/:modelId/images/:resourceId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.PrepareEcommerceModelDelivery(actor, c.Param("modelId"), c.Param("resourceId"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, value, "private, no-cache", "")
	})
}
