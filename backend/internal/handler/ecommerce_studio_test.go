package handler

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceStudioHTTPRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "studio.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"studio-owner", "studio-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		session := model.AuthSession{ID: id + "-session", UserID: id, TokenHash: auth.HashToken(id + "-token"), ExpiresAt: time.Now().Add(time.Hour)}
		if err := db.Create(&session).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"ecommerceStudioEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterEcommerceStudioRoutes(router.Group("/api"), svc)
	owner := "studio-owner-session.studio-owner-token"
	other := "studio-other-session.studio-other-token"

	type studioEnvelope struct {
		Data struct {
			Revision int64             `json:"revision"`
			Products []json.RawMessage `json:"products"`
		} `json:"data"`
	}
	read := func(cookie string) studioEnvelope {
		t.Helper()
		response := profileRequest(router, "GET", "/api/ecommerce/studio", "", cookie)
		var envelope studioEnvelope
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &envelope) != nil {
			t.Fatalf("read studio: %d %s", response.Code, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("studio read must not be cached")
		}
		return envelope
	}

	body := `{"product":{"id":"product_aaa","name":"陶瓷马克杯","photos":[{"resourceId":"res_photo_1"}]}}`
	response := profileRequest(router, "PUT", "/api/ecommerce/studio/products/product_aaa", body, owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("save: %d %s", response.Code, response.Body.String())
	}
	if got := read(owner); got.Data.Revision != 1 || len(got.Data.Products) != 1 {
		t.Fatalf("owner studio: %+v", got.Data)
	}
	if got := read(other); got.Data.Revision != 0 || len(got.Data.Products) != 0 {
		t.Fatal("studio data leaked across users")
	}
	response = profileRequest(router, "GET", "/api/ecommerce/studio/products/product_aaa", "", owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("read one product: %d %s", response.Code, response.Body.String())
	}
	if response = profileRequest(router, "GET", "/api/ecommerce/studio/products/product_aaa", "", other); response.Code != http.StatusNotFound {
		t.Fatalf("another user must not read the product: %d", response.Code)
	}
	response = profileRequest(router, "PUT", "/api/ecommerce/studio/products/product_aaa", `{"product":{"id":"product_aaa","name":"过期"},"expectedRevision":0}`, owner)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"reason":"studio_product_conflict"`) || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("stale save must be refused with the current revision: %d %s", response.Code, response.Body.String())
	}
	response = profileRequest(router, "PUT", "/api/ecommerce/studio/products/product_aaa", `{"product":{"id":"product_aaa","name":"陶瓷马克杯 350ml"},"expectedRevision":1}`, owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":2`) {
		t.Fatalf("save with the current revision: %d %s", response.Code, response.Body.String())
	}
	for name, invalid := range map[string]string{
		"unknown envelope field": `{"product":{"id":"product_aaa"},"extra":true}`,
		"trailing object":        `{"product":{"id":"product_aaa"}}{}`,
		"id mismatch":            `{"product":{"id":"product_bbb"}}`,
	} {
		response = profileRequest(router, "PUT", "/api/ecommerce/studio/products/product_aaa", invalid, owner)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d", name, response.Code)
		}
	}
	response = profileRequest(router, "DELETE", "/api/ecommerce/studio/products/product_aaa", "", owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":3`) {
		t.Fatalf("delete: %d %s", response.Code, response.Body.String())
	}
	if got := read(owner); len(got.Data.Products) != 0 {
		t.Fatal("deleted product still listed")
	}
}

func TestEcommerceStudioRoutesRequireAuthenticationAndFeature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterEcommerceStudioRoutes(router.Group("/api"), &service.Service{})
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/ecommerce/studio"}, {"GET", "/api/ecommerce/studio/products/product_aaa"},
		{"PUT", "/api/ecommerce/studio/products/product_aaa"}, {"DELETE", "/api/ecommerce/studio/products/product_aaa"},
	} {
		response := profileRequest(router, tc.method, tc.path, "", "")
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: %d", tc.method, tc.path, response.Code)
		}
	}

	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "studio-closed.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "studio-closed", Username: "studio-closed", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "studio-closed-session", UserID: "studio-closed", TokenHash: auth.HashToken("studio-closed-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	closed := gin.New()
	RegisterEcommerceStudioRoutes(closed.Group("/api"), svc)
	// 功能开放里没开「电商生图台」时，登录用户也读不到、写不进。
	response := profileRequest(closed, "GET", "/api/ecommerce/studio", "", "studio-closed-session.studio-closed-token")
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "电商生图台暂未开放") {
		t.Fatalf("closed studio: %d %s", response.Code, response.Body.String())
	}
}
