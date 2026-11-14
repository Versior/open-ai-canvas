package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/packaging"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestPackagingHTTPPersistencePermissionsAndCatalog(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "packaging.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"pack-owner", "pack-other", "pack-admin"} {
		role := model.UserRoleUser
		if id == "pack-admin" {
			role = model.UserRoleAdmin
		}
		if err = db.Create(&model.User{ID: id, Username: id, Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err = db.Create(&model.AuthSession{ID: id + "-session", UserID: id, TokenHash: auth.HashToken(id + "-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { svc.Close(); sqlDB, _ := db.DB(); sqlDB.Close() })
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	router := gin.New()
	RegisterPackagingRoutes(router.Group("/api"), svc)
	cookie := func(id string) string { return id + "-session." + id + "-token" }
	call := func(method, path, body, who string) (int, string) {
		r := profileRequest(router, method, path, body, cookie(who))
		return r.Code, r.Body.String()
	}
	if code, _ := call("GET", "/api/admin/packaging/catalog", "", "pack-owner"); code != 403 {
		t.Fatal("user can access admin catalog")
	}
	c := packaging.DefaultCatalog()
	d := packaging.Document{Version: 1, Template: c.Templates[0], Parameters: c.Templates[0].Defaults, Material: c.Materials[0], Artworks: []packaging.Artwork{}, View: packaging.View{Fold: 1, Layout: "split", Background: "dark", Projection: "perspective", Finish: "paper", Light: 1}}
	input := map[string]any{"name": "包装测试", "expectedRevision": 0, "document": d}
	raw, _ := json.Marshal(input)
	code, body := call("POST", "/api/packaging/projects", string(raw), "pack-owner")
	if code != 200 {
		t.Fatalf("create: %d %s", code, body)
	}
	var result struct {
		Data struct {
			ID       string `json:"id"`
			Revision int64  `json:"revision"`
		} `json:"data"`
	}
	if err = json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatal(err)
	}
	id := result.Data.ID
	if id == "" || result.Data.Revision != 1 {
		t.Fatal("invalid saved project")
	}
	if code, _ = call("GET", "/api/packaging/projects/"+id, "", "pack-other"); code != 404 {
		t.Fatal("project leaked across accounts")
	}
	if code, _ = call("GET", "/api/admin/packaging/projects/"+id, "", "pack-admin"); code != 200 {
		t.Fatal("admin cannot inspect project")
	}
	if code, _ = call("GET", "/api/packaging/projects/"+id+"/mockups", "", "pack-other"); code != 404 {
		t.Fatal("mockup history leaked across accounts")
	}
	if code, body = call("GET", "/api/packaging/projects/"+id+"/mockups?page=1&pageSize=12", "", "pack-owner"); code != 200 || !strings.Contains(body, `"items":[]`) {
		t.Fatalf("owner mockup history: %d %s", code, body)
	}
	if code, _ = call("GET", "/api/admin/packaging/projects/"+id+"/mockups", "", "pack-owner"); code != 403 {
		t.Fatal("ordinary user accessed admin mockup history")
	}
	if code, _ = call("GET", "/api/admin/packaging/projects/"+id+"/mockups", "", "pack-admin"); code != 200 {
		t.Fatal("admin cannot read mockup history")
	}
	input["expectedRevision"] = 1
	input["name"] = "更新方案"
	raw, _ = json.Marshal(input)
	if code, body = call("PUT", "/api/packaging/projects/"+id, string(raw), "pack-owner"); code != 200 {
		t.Fatalf("update: %s", body)
	}
	if code, body = call("PUT", "/api/packaging/projects/"+id, string(raw), "pack-owner"); code != 409 || !strings.Contains(body, "packaging_project_conflict") {
		t.Fatal("stale save overwrote newer revision")
	}
	if code, _ = call("DELETE", "/api/packaging/projects/"+id+"?expectedRevision=1", "", "pack-owner"); code != 409 {
		t.Fatal("stale delete succeeded")
	}
	if code, _ = call("GET", "/api/admin/packaging/overview", "", "pack-admin"); code != http.StatusOK {
		t.Fatal("overview unavailable")
	}
	c.Enabled = false
	raw, _ = json.Marshal(map[string]any{"expectedRevision": 0, "catalog": c})
	if code, body = call("PUT", "/api/admin/packaging/catalog", string(raw), "pack-admin"); code != 200 {
		t.Fatalf("catalog: %s", body)
	}
	if code, _ = call("PUT", "/api/admin/packaging/catalog", string(raw), "pack-admin"); code != 409 {
		t.Fatal("stale catalog overwrote newer version")
	}
	input["expectedRevision"] = 2
	raw, _ = json.Marshal(input)
	if code, _ = call("PUT", "/api/packaging/projects/"+id, string(raw), "pack-owner"); code != 403 {
		t.Fatal("disabled module allowed save")
	}
	if code, _ = call("GET", "/api/packaging/projects/"+id, "", "pack-owner"); code != 200 {
		t.Fatal("disable destroyed access to saved project")
	}
	if code, _ = call("DELETE", "/api/admin/packaging/projects/"+id+"?expectedRevision=2", "", "pack-other"); code != 403 {
		t.Fatal("non-admin can delete another user's project")
	}
	if code, _ = call("DELETE", "/api/admin/packaging/projects/"+id+"?expectedRevision=1", "", "pack-admin"); code != 409 {
		t.Fatal("admin stale delete succeeded")
	}
	if code, _ = call("DELETE", "/api/admin/packaging/projects/"+id+"?expectedRevision=2", "", "pack-admin"); code != 200 {
		t.Fatal("delete failed")
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "packaging.project.delete").Count(&audits).Error; err != nil || audits != 1 {
		t.Fatal("admin deletion audit missing")
	}
}
