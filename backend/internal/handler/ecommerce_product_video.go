package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// 单条作品上限 128 KiB，外加信封留白。
const productVideoRequestBytes = (128 << 10) + (16 << 10)

// RegisterProductVideoRoutes 注册视频复刻 · 元素替换的作品读写与参考视频切段接口，受「视频复刻」开关控制。
func RegisterProductVideoRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/ecommerce/product-videos", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureVideoReplication); err != nil {
			failService(c, err)
			return
		}
		value, err := svc.ProductVideos(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.GET("/ecommerce/product-videos/:videoId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureVideoReplication); err != nil {
			failService(c, err)
			return
		}
		value, err := svc.ProductVideo(actor, c.Param("videoId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.PUT("/ecommerce/product-videos/:videoId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureVideoReplication); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "product-video-write:"+actor.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		var req struct {
			Item json.RawMessage `json:"item"`
			// ExpectedRevision 是浏览器上次确认的作品 revision（新作品为 0）；不一致返回 409。
			ExpectedRevision *int64 `json:"expectedRevision"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, productVideoRequestBytes)
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			fail(c, http.StatusBadRequest, errors.New("请求格式无效或超过 128KB"))
			return
		}
		value, err := svc.SaveProductVideo(actor, c.Param("videoId"), req.Item, req.ExpectedRevision)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.DELETE("/ecommerce/product-videos/:videoId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureVideoReplication); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "product-video-write:"+actor.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		value, err := svc.DeleteProductVideo(actor, c.Param("videoId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.POST("/ecommerce/product-videos/splits", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "product-video-splits:"+actor.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req service.ProductVideoSplitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				fail(c, http.StatusRequestEntityTooLarge, errors.New("请求正文不能超过 4 KiB"))
				return
			}
			fail(c, http.StatusBadRequest, err)
			return
		}
		task, err := svc.CreateProductVideoSplitTask(actor.ID, c.GetHeader("X-Idempotency-Key"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})
}
