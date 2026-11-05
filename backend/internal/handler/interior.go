package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

// 项目文档上限 1 MiB，外加信封留白。
const interiorRequestBytes = (1 << 20) + (64 << 10)

// RegisterInteriorRoutes 注册室内设计的前台接口和后台管理接口。
// 前台接口受「室内设计」开关控制；后台接口只校验管理员，方便开放前先配置好内容。
func RegisterInteriorRoutes(r *gin.RouterGroup, svc *service.Service) {
	user := func(c *gin.Context) (*model.User, bool) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return nil, false
		}
		if err := svc.RequireFeature(service.FeatureInterior); err != nil {
			failService(c, err)
			return nil, false
		}
		return actor, true
	}
	writeLimited := func(c *gin.Context, actor *model.User) bool {
		policy, available := loadRuntimePolicy(c, svc)
		return available && enforceRateLimit(c, "interior-write:"+actor.ID, policy.Request.CanvasWritePerMinute, time.Minute)
	}

	r.GET("/interior/catalog", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed {
			return
		}
		value, err := svc.InteriorCatalog(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.POST("/interior/generate", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed {
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+actor.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		var req service.InteriorGenerateInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.GenerateInterior(actor, req, TraceID(c), RequestID(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.GET("/interior/projects", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed {
			return
		}
		items, err := svc.InteriorProjects(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"projects": items})
	})
	r.POST("/interior/projects", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed || !writeLimited(c, actor) {
			return
		}
		var req service.InteriorProjectInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.CreateInteriorProject(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.GET("/interior/projects/:projectId", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed {
			return
		}
		value, err := svc.InteriorProject(actor, c.Param("projectId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.PUT("/interior/projects/:projectId", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed || !writeLimited(c, actor) {
			return
		}
		var req service.InteriorProjectInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SaveInteriorProject(actor, c.Param("projectId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.DELETE("/interior/projects/:projectId", func(c *gin.Context) {
		actor, allowed := user(c)
		if !allowed || !writeLimited(c, actor) {
			return
		}
		if err := svc.DeleteInteriorProject(actor, c.Param("projectId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	admin := r.Group("/admin/interior")
	admin.GET("/modes", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminInteriorModes(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"modes": items})
	})
	admin.POST("/modes", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InteriorModeInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.CreateInteriorMode(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"mode": item})
	})
	admin.PUT("/modes/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InteriorModeInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdateInteriorMode(actor, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"mode": item})
	})
	admin.GET("/presets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminInteriorPresets(actor, c.Query("type"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"presets": items})
	})
	admin.POST("/presets", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InteriorPresetInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.CreateInteriorPreset(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preset": item})
	})
	admin.PUT("/presets/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InteriorPresetInput
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdateInteriorPreset(actor, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preset": item})
	})
	admin.GET("/settings", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.AdminInteriorSettings(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	admin.PUT("/settings", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.InteriorSettings
		if err := decodeInteriorJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.UpdateInteriorSettings(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
}

func decodeInteriorJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, interiorRequestBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("请求格式无效或超过 1MB")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("请求必须只包含一个 JSON 对象")
	}
	return nil
}
