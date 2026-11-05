package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

var errStudioModelRequestInvalid = errors.New("请求格式无效")

func studioModelPageQuery(c *gin.Context) (int, int, bool) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil {
		fail(c, http.StatusBadRequest, errStudioModelRequestInvalid)
		return 0, 0, false
	}
	size, err := strconv.Atoi(c.DefaultQuery("pageSize", "24"))
	if err != nil {
		fail(c, http.StatusBadRequest, errStudioModelRequestInvalid)
		return 0, 0, false
	}
	return page, size, true
}

// RegisterStudioModelRoutes 注册电商生图台的模特库：用户端浏览、看图与选用，后台导入、修改与批量上下架。
func RegisterStudioModelRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/ecommerce/studio/models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, size, valid := studioModelPageQuery(c)
		if !valid {
			return
		}
		value, err := svc.StudioModels(actor, c.Query("kind"), c.Query("q"), c.Query("category"), c.Query("gender"), page, size)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-cache")
		ok(c, value)
	})
	r.GET("/ecommerce/studio/models/:id/image", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		img, err := svc.OpenStudioModelImage(actor, c.Param("id"), c.Query("variant") == "thumb")
		if err != nil {
			failService(c, err)
			return
		}
		defer img.Body.Close()
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "default-src 'none'")
		// 地址带当前版本时内容不会变；不带或版本过期时每次协商。
		if c.Query("v") == img.Revision {
			c.Header("Cache-Control", "private, max-age=86400")
		} else {
			c.Header("Cache-Control", "private, no-cache")
		}
		c.DataFromReader(http.StatusOK, img.Size, img.MimeType, img.Body, nil)
	})
	r.POST("/ecommerce/studio/models/:id/attach", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "studio-model-attach:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		value, err := svc.AttachStudioModel(actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.GET("/admin/studio-models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, size, valid := studioModelPageQuery(c)
		if !valid {
			return
		}
		value, err := svc.AdminStudioModels(actor, c.Query("kind"), c.Query("q"), page, size)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.POST("/admin/studio-models/import", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-studio-model-import:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.StudioModelImportMaxBytes+(1<<20))
		if err := c.Request.ParseMultipartForm(1 << 20); err != nil {
			fail(c, http.StatusBadRequest, errors.New("请选择不超过 12 MiB 的图片"))
			return
		}
		defer c.Request.MultipartForm.RemoveAll()
		input := service.AdminStudioModelInput{
			Kind:     c.PostForm("kind"),
			Name:     c.PostForm("name"),
			Category: c.PostForm("category"),
			Gender:   c.PostForm("gender"),
			Tags:     service.ParseStudioModelTags(c.PostForm("tags")),
			Prompt:   c.PostForm("prompt"),
			Consent:  c.PostForm("consent") == "true",
			Enabled:  c.PostForm("enabled") == "true",
		}
		file, err := c.FormFile("file")
		if errors.Is(err, http.ErrMissingFile) {
			file = nil
		} else if err != nil {
			fail(c, http.StatusBadRequest, errors.New("图片读取失败，请重新选择"))
			return
		}
		value, err := svc.ImportStudioModel(actor, input, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"item": value})
	})
	r.PUT("/admin/studio-models/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var input service.AdminStudioModelInput
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, errStudioModelRequestInvalid)
			return
		}
		value, err := svc.UpdateStudioModel(actor, c.Param("id"), input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"item": value})
	})
	r.POST("/admin/studio-models/batch", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var input service.AdminStudioModelBatchInput
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, errStudioModelRequestInvalid)
			return
		}
		value, err := svc.BatchStudioModels(actor, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.DELETE("/admin/studio-models/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.BatchStudioModels(actor, service.AdminStudioModelBatchInput{IDs: []string{c.Param("id")}, Action: "delete"})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
}
