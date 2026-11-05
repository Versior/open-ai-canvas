package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestSocialVideoParseRoutesAndOpenAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterSocialVideoParseRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]string{
		"GET /api/social-video/platforms":                       "/social-video/platforms",
		"GET /api/admin/social-video/parse":                     "/admin/social-video/parse",
		"PATCH /api/admin/social-video/parse/settings":          "/admin/social-video/parse/settings",
		"POST /api/admin/social-video/parse-apis":               "/admin/social-video/parse-apis",
		"PATCH /api/admin/social-video/parse-apis/:id":          "/admin/social-video/parse-apis/{id}",
		"DELETE /api/admin/social-video/parse-apis/:id":         "/admin/social-video/parse-apis/{id}",
		"PUT /api/admin/social-video/parse-apis/:id/enabled":    "/admin/social-video/parse-apis/{id}/enabled",
		"POST /api/admin/social-video/parse-apis/:id/duplicate": "/admin/social-video/parse-apis/{id}/duplicate",
		"POST /api/admin/social-video/parse-apis/:id/reset":     "/admin/social-video/parse-apis/{id}/reset",
		"POST /api/admin/social-video/parse-apis/test":          "/admin/social-video/parse-apis/test",
		"POST /api/admin/social-video/parse-apis/test-all":      "/admin/social-video/parse-apis/test-all",
		"POST /api/admin/social-video/parse-apis/export":        "/admin/social-video/parse-apis/export",
		"POST /api/admin/social-video/parse-apis/import":        "/admin/social-video/parse-apis/import",
		"POST /api/admin/social-video/parse-sources":            "/admin/social-video/parse-sources",
		"PATCH /api/admin/social-video/parse-sources/:id":       "/admin/social-video/parse-sources/{id}",
		"DELETE /api/admin/social-video/parse-sources/:id":      "/admin/social-video/parse-sources/{id}",
		"POST /api/admin/social-video/parse-sources/:id/sync":   "/admin/social-video/parse-sources/{id}/sync",
	}
	registered := map[string]bool{}
	for _, route := range router.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	var spec struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	for route, path := range wanted {
		if !registered[route] {
			t.Errorf("route %s is not registered", route)
		}
		method := strings.ToLower(strings.SplitN(route, " ", 2)[0])
		if spec.Paths[path][method] == nil {
			t.Errorf("OpenAPI missing %s %s", method, path)
		}
	}
}

func TestSocialVideoParseHTTPFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, item := range []any{
		&model.User{ID: "parse-admin", Username: "parse-admin", Email: "parse-admin@example.invalid", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.User{ID: "parse-user", Username: "parse-user", Email: "parse-user@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "parse-admin-session", UserID: "parse-admin", TokenHash: auth.HashToken("admin-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "parse-user-session", UserID: "parse-user", TokenHash: auth.HashToken("user-token"), ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	RegisterSocialVideoParseRoutes(router.Group("/api"), svc)
	call := func(method, path, body, cookie string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: cookie})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	const admin, user = "parse-admin-session.admin-token", "parse-user-session.user-token"

	if response := call(http.MethodGet, "/api/social-video/platforms", "", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous platforms status = %d", response.Code)
	}
	if response := call(http.MethodGet, "/api/admin/social-video/parse", "", user); response.Code != http.StatusForbidden {
		t.Fatalf("non-admin overview status = %d, body = %s", response.Code, response.Body.String())
	}
	created := call(http.MethodPost, "/api/admin/social-video/parse-apis", `{"name":"快手接口","platforms":["kuaishou"],"enabled":true,"url":"https://parse.example.com/ks?url={url}&key={key}","secret":"sk-handler-secret"}`, admin)
	if created.Code != http.StatusOK || strings.Contains(created.Body.String(), "sk-handler-secret") {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body.String())
	}
	invalid := call(http.MethodPost, "/api/admin/social-video/parse-apis", `{"name":"缺变量","platforms":["kuaishou"],"url":"https://parse.example.com/ks"}`, admin)
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "{url}") {
		t.Fatalf("invalid create status = %d, body = %s", invalid.Code, invalid.Body.String())
	}
	platforms := call(http.MethodGet, "/api/social-video/platforms", "", user)
	var envelope struct {
		Data struct {
			Platforms []struct {
				ID        string `json:"id"`
				Available bool   `json:"available"`
			} `json:"platforms"`
		} `json:"data"`
	}
	if err := json.Unmarshal(platforms.Body.Bytes(), &envelope); err != nil || platforms.Code != http.StatusOK {
		t.Fatalf("platforms = %s, %v", platforms.Body.String(), err)
	}
	available := map[string]bool{}
	for _, platform := range envelope.Data.Platforms {
		available[platform.ID] = platform.Available
	}
	if !available["kuaishou"] || available["douyin"] {
		t.Fatalf("availability = %#v", available)
	}
	overview := call(http.MethodGet, "/api/admin/social-video/parse", "", admin)
	if overview.Code != http.StatusOK || !strings.Contains(overview.Body.String(), `"hasSecret":true`) || strings.Contains(overview.Body.String(), "sk-handler-secret") {
		t.Fatalf("overview status = %d, body = %s", overview.Code, overview.Body.String())
	}
	settings := call(http.MethodPatch, "/api/admin/social-video/parse/settings", `{"strategy":"round_robin","maxAttempts":2,"failureThreshold":4,"autoRecover":true,"sampleLinks":{"kuaishou":"https://v.kuaishou.com/AbCd12"}}`, admin)
	if settings.Code != http.StatusOK || !strings.Contains(settings.Body.String(), `"strategy":"round_robin"`) {
		t.Fatalf("settings status = %d, body = %s", settings.Code, settings.Body.String())
	}
	wrongSample := call(http.MethodPatch, "/api/admin/social-video/parse/settings", `{"sampleLinks":{"kuaishou":"https://www.douyin.com/video/7391234567890123456"}}`, admin)
	if wrongSample.Code != http.StatusBadRequest {
		t.Fatalf("mismatched sample link status = %d, body = %s", wrongSample.Code, wrongSample.Body.String())
	}
	exported := call(http.MethodPost, "/api/admin/social-video/parse-apis/export", `{}`, admin)
	if exported.Code != http.StatusOK || !strings.Contains(exported.Body.String(), "yingce.social-video-parse-apis") || strings.Contains(exported.Body.String(), "sk-handler-secret") {
		t.Fatalf("export status = %d, body = %s", exported.Code, exported.Body.String())
	}
}
