package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-yaml"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func newGuestAccessTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "guest.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"ecommerceStudioEnabled":true}`, UpdatedBy: "secret-admin"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]model.Skill{
		{ID: "public-skill", Name: "公开技能", Status: 1, Instruction: "PUBLIC_INSTRUCTION", ShowcaseMediaJSON: "[]"},
		{ID: "private-skill", Name: "私有技能", Status: 1, IsPrivate: true, Instruction: "PRIVATE_INSTRUCTION", ShowcaseMediaJSON: "[]"},
		{ID: "disabled-skill", Name: "下架技能", Status: 0, Instruction: "DISABLED_INSTRUCTION", ShowcaseMediaJSON: "[]"},
	}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterGuestAccessRoutes(router.Group("/api"), svc)
	RegisterSkillRoutes(router.Group("/api"), svc)
	return router
}

func guestRequest(router *gin.Engine, path, clientIP string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.RemoteAddr = clientIP + ":1234"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestGuestWorkspaceCatalogsKeepPrivateActionsProtected(t *testing.T) {
	router := newGuestAccessTestRouter(t)
	for _, path := range []string{"/api/public/workbench/tools?kind=image", "/api/public/workbench/tools?kind=video", "/api/public/interior/catalog", "/api/public/packaging/catalog", "/api/public/skills/curation"} {
		response := guestRequest(router, path, "198.51.100.20")
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
	}
	list := guestRequest(router, "/api/public/skills", "198.51.100.20")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "public-skill") || strings.Contains(list.Body.String(), "private-skill") || strings.Contains(list.Body.String(), "disabled-skill") || strings.Contains(list.Body.String(), `"isOwner":true`) {
		t.Fatalf("public skills: %d %s", list.Code, list.Body.String())
	}
	public := guestRequest(router, "/api/public/skills/public-skill", "198.51.100.20")
	if public.Code != http.StatusOK || !strings.Contains(public.Body.String(), "PUBLIC_INSTRUCTION") {
		t.Fatalf("public detail: %d %s", public.Code, public.Body.String())
	}
	private := guestRequest(router, "/api/public/skills/private-skill", "198.51.100.20")
	if private.Code != http.StatusForbidden || strings.Contains(private.Body.String(), "PRIVATE_INSTRUCTION") {
		t.Fatalf("private detail: %d %s", private.Code, private.Body.String())
	}
	for _, path := range []string{"/api/public/skills?scope=mine", "/api/public/skills?scope=created", "/api/public/skills?scope=favorites", "/api/public/skills?libraryCategoryId=private"} {
		if response := guestRequest(router, path, "198.51.100.20"); response.Code != http.StatusUnauthorized {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/api/skills/public-skill/like", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("guest write: %d %s", recorder.Code, recorder.Body.String())
	}
}

// 游客不带登录 Cookie 也能读功能开关与模型目录，响应不缓存、不含操作人信息。
func TestGuestAccessRoutesServeAnonymousReaders(t *testing.T) {
	router := newGuestAccessTestRouter(t)
	features := guestRequest(router, "/api/public/features", "198.51.100.1")
	if features.Code != http.StatusOK || features.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("features = %d %s", features.Code, features.Body.String())
	}
	var envelope struct {
		Data struct {
			Features map[string]any `json:"features"`
		} `json:"data"`
	}
	if err := json.Unmarshal(features.Body.Bytes(), &envelope); err != nil || envelope.Data.Features["ecommerceStudioEnabled"] != true || envelope.Data.Features["configured"] != true {
		t.Fatalf("features payload = %s %v", features.Body.String(), err)
	}
	if strings.Contains(features.Body.String(), "secret-admin") || strings.Contains(features.Body.String(), "updatedAt") {
		t.Fatalf("guest features leaked operator fields: %s", features.Body.String())
	}
	catalog := guestRequest(router, "/api/public/model-catalog", "198.51.100.1")
	if catalog.Code != http.StatusOK || !strings.Contains(catalog.Body.String(), `"source":"system"`) || catalog.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("catalog = %d %s", catalog.Code, catalog.Body.String())
	}
}

// LibTV 公开作品的参数校验在访问上游之前完成；游客读接口按来源地址限流。
func TestGuestAccessRoutesValidateAndRateLimit(t *testing.T) {
	router := newGuestAccessTestRouter(t)
	if response := guestRequest(router, "/api/public/libtv/works/not-a-uuid", "198.51.100.2"); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid uuid = %d %s", response.Code, response.Body.String())
	}
	if response := guestRequest(router, "/api/public/libtv/gallery?pageSize=999", "198.51.100.3"); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid gallery query = %d %s", response.Code, response.Body.String())
	}
	limited := false
	for index := 0; index < 31; index++ {
		response := guestRequest(router, "/api/public/model-catalog", "198.51.100.4")
		if response.Code == http.StatusTooManyRequests {
			limited = response.Header().Get("Retry-After") != ""
			break
		}
	}
	if !limited {
		t.Fatal("guest model catalog should be rate limited per client address")
	}
	if response := guestRequest(router, "/api/public/model-catalog", "198.51.100.5"); response.Code != http.StatusOK {
		t.Fatalf("another client should not share the per-address bucket: %d", response.Code)
	}
}

func TestGuestAccessOpenAPIPaths(t *testing.T) {
	var spec struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/public/features", "/public/model-catalog", "/public/libtv/gallery", "/public/libtv/works/{uuid}", "/public/workbench/tools", "/public/interior/catalog", "/public/packaging/catalog", "/public/skills", "/public/skills/curation", "/public/skills/{id}"} {
		if spec.Paths[path]["get"] == nil {
			t.Fatalf("OpenAPI missing get %s", path)
		}
	}
}
