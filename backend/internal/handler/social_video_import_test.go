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

func TestSocialVideoImportOpenAPI(t *testing.T) {
	var spec struct {
		Paths      map[string]map[string]any `yaml:"paths"`
		Components struct {
			Schemas map[string]any `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	if spec.Paths["/social-video/imports"]["post"] == nil {
		t.Fatal("OpenAPI missing POST /social-video/imports")
	}
	if spec.Components.Schemas["SocialVideoImportRequest"] == nil || spec.Components.Schemas["Task"] == nil {
		t.Fatal("OpenAPI missing social video request or task schema")
	}
}

func TestSocialVideoImportHTTPContract(t *testing.T) {
	router, cookie := newSocialVideoImportHandler(t)

	request := func(body, key string, authenticated bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/social-video/imports", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("X-Idempotency-Key", key)
		}
		if authenticated {
			req.AddCookie(cookie)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}

	body := `{"url":"https://www.douyin.com/video/7391234567890123456"}`
	if response := request(body, "request-key-0001", false); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, body = %s", response.Code, response.Body.String())
	}
	if response := request(body, "", true); response.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency key status = %d, body = %s", response.Code, response.Body.String())
	}
	if response := request(`{"url":"`+strings.Repeat("x", 5<<10)+`"}`, "request-key-0002", true); response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body status = %d, body = %s", response.Code, response.Body.String())
	}
	if response := request(body, "request-key-0003", true); response.Code != http.StatusOK {
		t.Fatalf("valid request status = %d, body = %s", response.Code, response.Body.String())
	}

	response := request(`{"url":"https://www.douyin.com/video/7391234567890123457"}`, "request-key-0003", true)
	if response.Code != http.StatusConflict {
		t.Fatalf("idempotency conflict status = %d, body = %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.Code != service.CodeIdempotencyConflict {
		t.Fatalf("idempotency conflict response = %s, error = %v", response.Body.String(), err)
	}
}

func newSocialVideoImportHandler(t *testing.T) (*gin.Engine, *http.Cookie) {
	t.Helper()
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
		&model.User{ID: "social-video-user", Username: "social-video-user", Email: "social-video@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "social-video-session", UserID: "social-video-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
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
	RegisterTaskRoutes(router.Group("/api"), svc)
	return router, &http.Cookie{Name: service.SessionCookieName, Value: "social-video-session.test-token"}
}
