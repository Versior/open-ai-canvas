package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"yingce/backend/internal/service"
)

// RegisterEcommerceCanvasRoutes 注册电商生图台的后台配置（商品档案指令、套图模板）与 EcomGen 模板目录。
// 旧版电商画布已下线，公开配置、公共模特图片上传与读取接口随之删除。
func RegisterEcommerceCanvasRoutes(r *gin.RouterGroup, svc *service.Service) {
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
	r.GET("/ecommerce/studio/prompts", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		prompts, err := svc.EcommerceStudioPrompts(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-cache")
		ok(c, gin.H{"prompts": prompts})
	})
	r.GET("/ecommerce/studio/templates", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		templates, err := svc.EcommerceStudioTemplates(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-cache")
		ok(c, gin.H{"templates": templates})
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
}
