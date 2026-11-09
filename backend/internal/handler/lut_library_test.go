package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestLUTLibraryHTTPManagementAndVisibility(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "lut.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	for _, role := range []string{"admin", "user"} {
		if err := db.Create(&model.User{ID: "lut-" + role, Username: "lut-" + role, Role: model.UserRole(role), Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: "lut-" + role + "-session", UserID: "lut-" + role, TokenHash: auth.HashToken(role + "-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterLUTLibraryRoutes(router.Group("/api"), svc)
	admin := "lut-admin-session.admin-token"
	user := "lut-user-session.user-token"
	var body = map[string]any{"name": "暖光自定义", "category": "人像", "description": "亲子柔肤", "enabled": true, "defaultStrength": 0.6, "sortOrder": 0, "cube": map[string]any{"size": 2, "values": []int{0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1}, "domainMin": []int{0, 0, 0}, "domainMax": []int{1, 1, 1}}}
	request := func(method, path, cookie string, body any) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		if body == nil {
			data = nil
		}
		return profileRequest(router, method, "/api"+path, string(data), cookie)
	}
	for _, call := range []struct{ method, path string }{{"GET", "/admin/lut-library/items"}, {"GET", "/admin/lut-library/items/lut-builtin-warm"}, {"POST", "/admin/lut-library/items"}, {"PUT", "/admin/lut-library/items/lut-builtin-warm"}, {"DELETE", "/admin/lut-library/items/lut-builtin-warm?version=1"}} {
		if r := request(call.method, call.path, user, body); r.Code != http.StatusForbidden {
			t.Fatalf("user can manage LUT: %s %d", call.method, r.Code)
		}
	}
	if r := request("GET", "/lut-library/items", "", nil); r.Code != http.StatusUnauthorized {
		t.Fatal("anonymous LUT access accepted")
	}
	r := request("GET", "/lut-library/items", user, nil)
	var list struct {
		Data struct {
			Items []model.LUTLibraryItem `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if r.Code != 200 || len(list.Data.Items) != 6 {
		t.Fatalf("builtin catalog: %d %d", r.Code, len(list.Data.Items))
	}
	r = request("GET", "/lut-library/items/lut-builtin-warm", user, nil)
	var snapshot struct {
		Data struct {
			Lut struct {
				Preset string `json:"preset"`
				Cube   struct {
					Values []float64 `json:"values"`
				} `json:"cube"`
			} `json:"lut"`
		} `json:"data"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if r.Code != 200 || snapshot.Data.Lut.Preset != "" || len(snapshot.Data.Lut.Cube.Values) != 17*17*17*3 {
		t.Fatal("builtin selection must materialize a standalone cube")
	}
	r = request("POST", "/admin/lut-library/items", admin, body)
	var created struct {
		Data struct {
			Item model.LUTLibraryItem `json:"item"`
		} `json:"data"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	item := created.Data.Item
	if r.Code != 200 || item.ID == "" || item.Version != 1 {
		t.Fatalf("create: %d %s", r.Code, r.Body.String())
	}
	path := "/admin/lut-library/items/" + item.ID
	r = request("GET", "/lut-library/items/"+item.ID, user, nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"libraryVersion":1`) || !strings.Contains(r.Body.String(), `"strength":0.6`) {
		t.Fatal("user snapshot missing")
	}
	r = request("GET", "/lut-library/items", user, nil)
	if strings.Contains(r.Body.String(), `"values"`) {
		t.Fatal("summary list must not expose full cubes")
	}
	body["expectedVersion"] = 1
	body["enabled"] = false
	body["name"] = "修改名称"
	body["sortOrder"] = 30
	delete(body, "cube")
	if r = request("PUT", path, admin, body); r.Code != 200 {
		t.Fatalf("update: %d %s", r.Code, r.Body.String())
	}
	if r = request("PUT", path, admin, body); r.Code != 409 {
		t.Fatal("stale version overwrote LUT")
	}
	if r = request("GET", "/lut-library/items/"+item.ID, user, nil); r.Code != 404 {
		t.Fatal("disabled LUT selectable")
	}
	if r = request("GET", path, admin, nil); r.Code != 200 || !strings.Contains(r.Body.String(), `"values"`) {
		t.Fatal("metadata edit lost color table")
	}
	if r = request("DELETE", path+"?version=1", admin, nil); r.Code != 409 {
		t.Fatal("stale delete accepted")
	}
	if r = request("DELETE", path+"?version=2", admin, nil); r.Code != 200 {
		t.Fatal("delete failed")
	}
	if r = request("GET", path, admin, nil); r.Code != 404 {
		t.Fatal("delete not persisted")
	}
	body["cube"] = map[string]any{"size": 64}
	body["enabled"] = true
	if r = request("POST", "/admin/lut-library/items", admin, body); r.Code != 400 {
		t.Fatal("invalid cube accepted")
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("target_type = ?", "lut_library").Count(&audits).Error; err != nil || audits != 3 {
		t.Fatalf("audit trail: %d %v", audits, err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("lut:reject_audit", func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "AdminAuditEvent" {
			tx.AddError(errors.New("simulated audit failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove("lut:reject_audit") })
	body["expectedVersion"] = 1
	delete(body, "cube")
	if r = request("PUT", "/admin/lut-library/items/lut-builtin-warm", admin, body); r.Code != 500 {
		t.Fatal("audit failure not surfaced")
	}
	if r = request("DELETE", "/admin/lut-library/items/lut-builtin-warm?version=1", admin, nil); r.Code != 500 {
		t.Fatal("delete audit failure not surfaced")
	}
	var unchanged model.LUTLibraryItem
	if err := db.First(&unchanged, "id = ?", "lut-builtin-warm").Error; err != nil || unchanged.Version != 1 || unchanged.Name != "暖阳柔肤" {
		t.Fatalf("failed audited mutation committed: %+v %v", unchanged, err)
	}
	body["cube"] = map[string]any{"size": 2, "values": make([]float64, 24), "domainMin": []int{0, 0, 0}, "domainMax": []int{1, 1, 1}}
	if r = request("POST", "/admin/lut-library/items", admin, body); r.Code != 500 {
		t.Fatal("create audit failure not surfaced")
	}
	var remaining int64
	if err := db.Model(&model.LUTLibraryItem{}).Count(&remaining).Error; err != nil || remaining != 6 {
		t.Fatalf("failed create committed: %d %v", remaining, err)
	}
}
