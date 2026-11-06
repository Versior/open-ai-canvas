package handler

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestProductVideoHTTPRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "product-video.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"pv-owner", "pv-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id + "-session", UserID: id, TokenHash: auth.HashToken(id + "-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 元素替换跟视频复刻开关走，电商生图台关着也能用。
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"videoReplicationEnabled":true,"ecommerceStudioEnabled":false}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterProductVideoRoutes(router.Group("/api"), svc)
	owner := "pv-owner-session.pv-owner-token"
	other := "pv-other-session.pv-other-token"

	response := profileRequest(router, "PUT", "/api/ecommerce/product-videos/video_aaa", `{"item":{"id":"video_aaa","title":"保温杯"}}`, owner)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("save without expectedRevision: %d %s", response.Code, response.Body.String())
	}
	response = profileRequest(router, "PUT", "/api/ecommerce/product-videos/video_aaa", `{"item":{"id":"video_aaa","title":"保温杯"},"expectedRevision":0}`, owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("save: %d %s", response.Code, response.Body.String())
	}
	response = profileRequest(router, "GET", "/api/ecommerce/product-videos", "", owner)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "video_aaa") || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("list: %d %s", response.Code, response.Body.String())
	}
	if response = profileRequest(router, "GET", "/api/ecommerce/product-videos", "", other); strings.Contains(response.Body.String(), "video_aaa") {
		t.Fatal("product videos leaked across users")
	}
	if response = profileRequest(router, "GET", "/api/ecommerce/product-videos/video_aaa", "", other); response.Code != http.StatusNotFound {
		t.Fatalf("another user must not read the item: %d", response.Code)
	}
	response = profileRequest(router, "PUT", "/api/ecommerce/product-videos/video_aaa", `{"item":{"id":"video_aaa","title":"过期"},"expectedRevision":0}`, owner)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"reason":"product_video_conflict"`) {
		t.Fatalf("stale save: %d %s", response.Code, response.Body.String())
	}
	if response = profileRequest(router, "PUT", "/api/ecommerce/product-videos/video_aaa", `{"item":{"id":"video_aaa"},"extra":1}`, owner); response.Code != http.StatusBadRequest {
		t.Fatalf("unknown envelope field: %d", response.Code)
	}
	response = profileRequest(router, "POST", "/api/ecommerce/product-videos/splits", `{"resourceId":"missing","endMs":10000}`, owner)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "X-Idempotency-Key") {
		t.Fatalf("split without idempotency key: %d %s", response.Code, response.Body.String())
	}
	response = profileRequest(router, "DELETE", "/api/ecommerce/product-videos/video_aaa", "", owner)
	if response.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", response.Code, response.Body.String())
	}
	if response = profileRequest(router, "GET", "/api/ecommerce/product-videos", "", owner); strings.Contains(response.Body.String(), "video_aaa") {
		t.Fatal("deleted item still listed")
	}
}

func TestProductVideoRoutesRequireAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterProductVideoRoutes(router.Group("/api"), &service.Service{})
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/ecommerce/product-videos"}, {"GET", "/api/ecommerce/product-videos/video_aaa"},
		{"PUT", "/api/ecommerce/product-videos/video_aaa"}, {"DELETE", "/api/ecommerce/product-videos/video_aaa"},
		{"POST", "/api/ecommerce/product-videos/splits"},
	} {
		if response := profileRequest(router, tc.method, tc.path, "", ""); response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: %d", tc.method, tc.path, response.Code)
		}
	}
}

func TestProductVideoOpenAPIPaths(t *testing.T) {
	var spec struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	for path, methods := range map[string][]string{
		"/ecommerce/product-videos": {"get"}, "/ecommerce/product-videos/{videoId}": {"get", "put", "delete"},
		"/ecommerce/product-videos/splits": {"post"},
	} {
		for _, method := range methods {
			if spec.Paths[path][method] == nil {
				t.Fatalf("OpenAPI missing %s %s", method, path)
			}
		}
	}
}
