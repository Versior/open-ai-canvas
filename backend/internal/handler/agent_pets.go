package handler

import (
	"bytes"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

var errAgentPetRequestInvalid = errors.New("请求格式无效")

// RegisterAgentPetRoutes 注册智能体形象：用户端列表、选择、购买和图集，后台形象库管理。
func RegisterAgentPetRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/agent-pets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		catalog, err := svc.AgentPetCatalog(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, catalog)
	})
	r.GET("/agent-pets/selection", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		pet, err := svc.AgentPetSelection(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pet": pet})
	})
	r.PUT("/agent-pets/selection", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			PetID string `json:"petId"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errAgentPetRequestInvalid)
			return
		}
		pet, err := svc.SelectAgentPet(actor, req.PetID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pet": pet})
	})
	r.POST("/agent-pets/:id/purchase", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			ExpectedPriceMicrocredits int64 `json:"expectedPriceMicrocredits"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errAgentPetRequestInvalid)
			return
		}
		result, err := svc.PurchaseAgentPet(actor, c.Param("id"), req.ExpectedPriceMicrocredits)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/agent-pets/:id/spritesheet", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		sheet, err := svc.AgentPetSpritesheet(actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "default-src 'none'")
		c.Header("Content-Type", sheet.MimeType)
		c.Header("ETag", `"`+sheet.Revision+`"`)
		// URL 带当前版本时内容不可变；不带或版本过期时每次协商。
		if c.Query("v") == sheet.Revision {
			c.Header("Cache-Control", "private, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "private, no-cache")
		}
		http.ServeContent(c.Writer, c.Request, "spritesheet", time.Time{}, bytes.NewReader(sheet.Data))
	})

	r.GET("/admin/agent-pets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		pets, err := svc.AdminAgentPets(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pets": pets})
	})
	r.PUT("/admin/agent-pets/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AdminAgentPetInput
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errAgentPetRequestInvalid)
			return
		}
		pet, err := svc.UpdateAdminAgentPet(actor, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pet": pet})
	})
	r.POST("/admin/agent-pets/import", func(c *gin.Context) {
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
		if !available || !enforceRateLimit(c, "admin-agent-pet-import:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.AgentPetImportMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("请选择不超过 32 MiB 的形象文件"))
			return
		}
		pet, err := svc.ImportAgentPet(actor, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pet": pet})
	})
	r.POST("/admin/agent-pets/batch", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AdminAgentPetBatchInput
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errAgentPetRequestInvalid)
			return
		}
		result, err := svc.BatchUpdateAdminAgentPets(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/agent-pets/batch-delete", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			IDs []string `json:"ids"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, errAgentPetRequestInvalid)
			return
		}
		result, err := svc.BatchDeleteAdminAgentPets(actor, req.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.DELETE("/admin/agent-pets/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteAdminAgentPet(actor, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})
}
