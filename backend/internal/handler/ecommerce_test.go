package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
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
	RegisterEcommerceRoutes(router.Group("/api"), &service.Service{})
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/ecommerce/settings"}, {"GET", "/api/admin/settings/ecommerce"},
		{"GET", "/api/admin/settings/ecommerce/defaults"},
		{"GET", "/api/ecommerce/templates"}, {"GET", "/api/ecommerce/templates/missing"},
		{"PUT", "/api/admin/settings/ecommerce"}, {"GET", "/api/admin/settings/ecommerce/previous"},
		{"POST", "/api/admin/settings/ecommerce/images"}, {"GET", "/api/ecommerce/models/model/images/image"},
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
	RegisterEcommerceRoutes(router.Group("/api"), svc)
	cookie := "fixture-session.fixture-token"
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/admin/settings/ecommerce"}, {"PUT", "/api/admin/settings/ecommerce"},
		{"GET", "/api/admin/settings/ecommerce/defaults"},
		{"GET", "/api/admin/settings/ecommerce/previous"}, {"POST", "/api/admin/settings/ecommerce/images"},
	} {
		result := profileRequest(router, tc.method, tc.path, "{}", cookie)
		if result.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s: %d", tc.path, result.Code)
		}
	}
	response := profileRequest(router, "GET", "/api/ecommerce/settings", "", cookie)
	if response.Code != 200 {
		t.Fatalf("public settings: %d", response.Code)
	}
	if err := db.Model(&user).Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	response = profileRequest(router, "GET", "/api/admin/settings/ecommerce", "", cookie)
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
	if err := json.Unmarshal(response.Body.Bytes(), &defaults); err != nil || response.Code != 200 || len(defaults.Data.Defaults) != 12 || defaults.Data.Defaults["cap:planning"] == "" {
		t.Fatal("default instruction HTTP contract incomplete")
	}
	response = profileRequest(router, "GET", "/api/ecommerce/templates?q=&page=1&pageSize=20", "", cookie)
	var catalog struct {
		Data struct {
			Total int `json:"total"`
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil || response.Code != 200 || catalog.Data.Total != 1173 || len(catalog.Data.Items) != 20 {
		t.Fatal("catalog HTTP contract failed")
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
	if spec.Paths["/ecommerce/library"] != nil {
		t.Fatal("removed private library endpoint remains in OpenAPI")
	}
	for path, methods := range map[string][]string{
		"/admin/settings/ecommerce/defaults": {"get"}, "/ecommerce/templates": {"get"}, "/ecommerce/templates/{templateId}": {"get"},
		"/ecommerce/settings": {"get"}, "/admin/settings/ecommerce": {"get", "put"},
		"/admin/settings/ecommerce/previous": {"get"}, "/admin/settings/ecommerce/images": {"post"},
		"/ecommerce/models/{modelId}/images/{resourceId}": {"get"},
	} {
		for _, method := range methods {
			if spec.Paths[path][method] == nil {
				t.Fatalf("OpenAPI missing %s %s", method, path)
			}
		}
	}
}

func TestEcommercePrivateLibraryRoutesRemoved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterEcommerceRoutes(router.Group("/api"), &service.Service{})
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, "/api/ecommerce/library", nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("removed endpoint %s returned %d", method, response.Code)
		}
	}
}
