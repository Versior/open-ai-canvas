package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// 单个商品上限 1 MiB，外加信封留白。
const ecommerceStudioRequestBytes = (1 << 20) + (64 << 10)

// RegisterEcommerceStudioRoutes 注册电商生图台的商品读写接口；生图台独立于电商 Agent，受「电商生图台」开关控制。
func RegisterEcommerceStudioRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/ecommerce/studio", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureEcommerceStudio); err != nil {
			failService(c, err)
			return
		}
		value, err := svc.EcommerceStudio(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.GET("/ecommerce/studio/products/:productId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureEcommerceStudio); err != nil {
			failService(c, err)
			return
		}
		value, err := svc.EcommerceStudioProduct(actor, c.Param("productId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, value)
	})
	r.PUT("/ecommerce/studio/products/:productId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureEcommerceStudio); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "ecommerce-studio-write:"+actor.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		var req struct {
			Product json.RawMessage `json:"product"`
			// ExpectedRevision 是浏览器上次确认的商品 revision（新商品为 0）；不一致返回 409。
			ExpectedRevision *int64 `json:"expectedRevision"`
		}
		if err := decodeEcommerceStudioJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SaveEcommerceStudioProduct(actor, c.Param("productId"), req.Product, req.ExpectedRevision)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.DELETE("/ecommerce/studio/products/:productId", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureEcommerceStudio); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "ecommerce-studio-write:"+actor.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		value, err := svc.DeleteEcommerceStudioProduct(actor, c.Param("productId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
}

func decodeEcommerceStudioJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, ecommerceStudioRequestBytes)
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
