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
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestAgentPetRoutesAndOpenAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAgentPetRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]bool{
		"GET /api/agent-pets":                     false,
		"GET /api/agent-pets/selection":           false,
		"PUT /api/agent-pets/selection":           false,
		"POST /api/agent-pets/:id/purchase":       false,
		"GET /api/agent-pets/:id/spritesheet":     false,
		"GET /api/agent-pets/:id/preview":         false,
		"GET /api/admin/agent-pets":               false,
		"POST /api/admin/agent-pets/import":       false,
		"POST /api/admin/agent-pets/batch":        false,
		"POST /api/admin/agent-pets/batch-delete": false,
		"PUT /api/admin/agent-pets/:id":           false,
		"DELETE /api/admin/agent-pets/:id":        false,
	}
	for _, route := range router.Routes() {
		if _, exists := wanted[route.Method+" "+route.Path]; exists {
			wanted[route.Method+" "+route.Path] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}
	var spec struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	for path, methods := range map[string][]string{
		"/agent-pets": {"get"}, "/agent-pets/selection": {"get", "put"}, "/agent-pets/{id}/purchase": {"post"},
		"/agent-pets/{id}/spritesheet": {"get"}, "/agent-pets/{id}/preview": {"get"}, "/admin/agent-pets": {"get"}, "/admin/agent-pets/import": {"post"},
		"/admin/agent-pets/{id}": {"put", "delete"}, "/admin/agent-pets/batch": {"post"}, "/admin/agent-pets/batch-delete": {"post"},
	} {
		for _, method := range methods {
			if spec.Paths[path][method] == nil {
				t.Errorf("OpenAPI missing %s %s", method, path)
			}
		}
	}
}

func TestAgentPetHTTPFlow(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:agent-pet-http?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "pet-admin", Username: "pet-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "pet-member", Username: "pet-member", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, row := range []any{admin, user, &model.AuthSession{ID: "pet-session", UserID: user.ID, TokenHash: auth.HashToken("pet-token"), ExpiresAt: time.Now().Add(time.Hour)}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	if _, err := svc.UpdateAdminAgentPet(admin, "pingo", service.AdminAgentPetInput{Name: "企鹅", Enabled: true, Access: "free"}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAgentPetRoutes(router.Group("/api"), svc)
	call := func(method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		if headers["anonymous"] == "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "pet-session.pet-token"})
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}

	if w := call(http.MethodGet, "/api/agent-pets", "", map[string]string{"anonymous": "1"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous list status = %d", w.Code)
	}
	w := call(http.MethodGet, "/api/agent-pets", "", nil)
	var listed struct {
		Code int `json:"code"`
		Data struct {
			Pets []struct {
				ID       string `json:"id"`
				Revision string `json:"revision"`
			} `json:"pets"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listed); err != nil || w.Code != http.StatusOK || len(listed.Data.Pets) != 1 || listed.Data.Pets[0].ID != "pingo" {
		t.Fatalf("list status=%d body=%s err=%v", w.Code, w.Body.String(), err)
	}
	revision := listed.Data.Pets[0].Revision

	w = call(http.MethodGet, "/api/agent-pets/pingo/spritesheet?v="+revision, "", nil)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/webp" || w.Header().Get("ETag") != `"`+revision+`"` || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("sheet status=%d headers=%v", w.Code, w.Header())
	}
	if w = call(http.MethodGet, "/api/agent-pets/pingo/spritesheet", "", map[string]string{"If-None-Match": `"` + revision + `"`}); w.Code != http.StatusNotModified || !strings.Contains(w.Header().Get("Cache-Control"), "no-cache") {
		t.Fatalf("conditional sheet status=%d headers=%v", w.Code, w.Header())
	}
	if w = call(http.MethodGet, "/api/agent-pets/vika/spritesheet", "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("unlisted sheet status = %d", w.Code)
	}
	// 列表缩略图：一帧 PNG，比整张图集小得多，缓存规则相同。
	w = call(http.MethodGet, "/api/agent-pets/pingo/preview?v="+revision, "", nil)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/png" || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Body.Len() == 0 {
		t.Fatalf("preview status=%d headers=%v", w.Code, w.Header())
	}
	if w = call(http.MethodGet, "/api/agent-pets/pingo/preview", "", map[string]string{"If-None-Match": `"preview-` + revision + `"`}); w.Code != http.StatusNotModified {
		t.Fatalf("conditional preview status=%d", w.Code)
	}
	if w = call(http.MethodGet, "/api/agent-pets/vika/preview", "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("unlisted preview status = %d", w.Code)
	}
	if w = call(http.MethodPut, "/api/agent-pets/selection", `{"petId":"pingo"}`, nil); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"id":"pingo"`) {
		t.Fatalf("select status=%d body=%s", w.Code, w.Body.String())
	}
	if w = call(http.MethodGet, "/api/agent-pets/selection", "", nil); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"id":"pingo"`) {
		t.Fatalf("selection status=%d body=%s", w.Code, w.Body.String())
	}
	if w = call(http.MethodPost, "/api/agent-pets/pingo/purchase", `{"expectedPriceMicrocredits":0}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("buying a free pet status = %d", w.Code)
	}
	if w = call(http.MethodGet, "/api/admin/agent-pets", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-admin library status = %d", w.Code)
	}
}
