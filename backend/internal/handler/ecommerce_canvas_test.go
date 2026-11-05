package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestEcommerceRoutesRequireAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterEcommerceCanvasRoutes(router.Group("/api"), &service.Service{})
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/admin/settings/ecommerce"},
		{"GET", "/api/admin/settings/ecommerce/defaults"},
		{"GET", "/api/ecommerce/templates"}, {"GET", "/api/ecommerce/templates/missing"},
		{"PUT", "/api/admin/settings/ecommerce"}, {"GET", "/api/admin/settings/ecommerce/previous"},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: %d", tc.method, tc.path, response.Code)
		}
	}
}

func TestEcommerceHTTPPermissionsAndSave(t *testing.T) {
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "ecommerce.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "ecommerce-user", Username: "ecommerce-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	session := model.AuthSession{ID: "fixture-session", UserID: user.ID, TokenHash: auth.HashToken("fixture-token"), ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	router := gin.New()
	RegisterEcommerceCanvasRoutes(router.Group("/api"), svc)
	cookie := "fixture-session.fixture-token"
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/admin/settings/ecommerce"}, {"PUT", "/api/admin/settings/ecommerce"},
		{"GET", "/api/admin/settings/ecommerce/defaults"},
		{"GET", "/api/admin/settings/ecommerce/previous"},
	} {
		result := profileRequest(router, tc.method, tc.path, "{}", cookie)
		if result.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s: %d", tc.path, result.Code)
		}
	}
	if err := db.Model(&user).Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	response := profileRequest(router, "GET", "/api/admin/settings/ecommerce", "", cookie)
	var envelope struct {
		Data struct {
			Setting service.EcommerceSetting `json:"setting"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != 200 {
		t.Fatalf("admin read: %d %v", response.Code, err)
	}
	value := envelope.Data.Setting
	response = profileRequest(router, "GET", "/api/admin/settings/ecommerce/defaults", "", cookie)
	var defaults struct {
		Data struct {
			Defaults map[string]string `json:"defaults"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &defaults); err != nil || response.Code != 200 || len(defaults.Data.Defaults) != 14 || defaults.Data.Defaults["cap:planning"] == "" || defaults.Data.Defaults["cap:dossier"] == "" || defaults.Data.Defaults["cap:detail-plan"] == "" {
		t.Fatal("default instruction HTTP contract incomplete")
	}
	response = profileRequest(router, "GET", "/api/ecommerce/templates?q=&page=1&pageSize=20", "", cookie)
	var catalog struct {
		Data struct {
			Total int `json:"total"`
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
			Categories []struct {
				Name  string `json:"name"`
				Count int    `json:"count"`
			} `json:"categories"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil || response.Code != 200 || catalog.Data.Total != 1173 || len(catalog.Data.Items) != 20 || len(catalog.Data.Categories) != 24 {
		t.Fatal("catalog HTTP contract failed")
	}
	first := catalog.Data.Categories[0]
	response = profileRequest(router, "GET", "/api/ecommerce/templates?q=&category="+url.QueryEscape(first.Name)+"&page=1&pageSize=20", "", cookie)
	var byCategory struct {
		Data struct {
			Total int `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &byCategory); err != nil || response.Code != 200 || byCategory.Data.Total != first.Count {
		t.Fatalf("catalog category filter: %d %v total=%d want %d", response.Code, err, byCategory.Data.Total, first.Count)
	}
	response = profileRequest(router, "GET", "/api/ecommerce/templates/"+catalog.Data.Items[0].ID, "", cookie)
	var detail struct {
		Data struct {
			Template service.EcommerceSuiteTemplate `json:"template"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil || response.Code != 200 || len(detail.Data.Template.Shots) == 0 {
		t.Fatal("catalog detail failed")
	}
	value.Enabled = false
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	response = profileRequest(router, "PUT", "/api/admin/settings/ecommerce", string(encoded), cookie)
	if response.Code != 200 {
		t.Fatalf("admin save: %d", response.Code)
	}
	response = profileRequest(router, "GET", "/api/admin/settings/ecommerce/previous", "", cookie)
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || response.Code != 200 || !envelope.Data.Setting.Enabled {
		t.Fatalf("previous configuration: %d %v", response.Code, err)
	}
}

func TestEcommerceOpenAPIPaths(t *testing.T) {
	var spec struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	for _, removed := range []string{"/ecommerce/library", "/ecommerce/settings", "/admin/settings/ecommerce/images", "/ecommerce/models/{modelId}/images/{resourceId}"} {
		if spec.Paths[removed] != nil {
			t.Fatalf("removed endpoint %s remains in OpenAPI", removed)
		}
	}
	for path, methods := range map[string][]string{
		"/admin/settings/ecommerce/defaults": {"get"}, "/ecommerce/templates": {"get"}, "/ecommerce/templates/{templateId}": {"get"},
		"/admin/settings/ecommerce": {"get", "put"}, "/admin/settings/ecommerce/previous": {"get"},
		"/ecommerce/studio": {"get"}, "/ecommerce/studio/products/{productId}": {"put", "delete"},
	} {
		for _, method := range methods {
			if spec.Paths[path][method] == nil {
				t.Fatalf("OpenAPI missing %s %s", method, path)
			}
		}
	}
}

// 旧版电商画布下线：私有素材库、公开配置与公共模特图片接口都不再注册。
func TestEcommerceRetiredCanvasRoutesRemoved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterEcommerceCanvasRoutes(router.Group("/api"), &service.Service{})
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/ecommerce/library"}, {http.MethodPut, "/api/ecommerce/library"},
		{http.MethodGet, "/api/ecommerce/settings"},
		{http.MethodPost, "/api/admin/settings/ecommerce/images"},
		{http.MethodGet, "/api/ecommerce/models/model/images/image"},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("removed endpoint %s %s returned %d", tc.method, tc.path, response.Code)
		}
	}
}
