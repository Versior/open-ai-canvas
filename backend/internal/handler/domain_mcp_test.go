package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/domainmcp/packs/commerce"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDomainMCPAdminRoutesEnforceAuthorizationAndRedactCredentials(t *testing.T) {
	router, _, call := newDomainMCPHandlerTest(t)
	RegisterDomainMCPRoutes(router.Group("/api"), call.service)

	payload := []byte(`{"packId":"commerce.product-insight","apiKey":"do-not-return-this-secret"}`)
	for _, role := range []string{"", "user"} {
		response := call.request(role, http.MethodPost, "/api/admin/domain-mcp/installations", payload, nil)
		want := http.StatusForbidden
		if role == "" {
			want = http.StatusUnauthorized
		}
		if response.Code != want {
			t.Fatalf("role %q: got %d body=%s", role, response.Code, response.Body.String())
		}
	}

	created := call.request("admin", http.MethodPost, "/api/admin/domain-mcp/installations", payload, nil)
	if created.Code != http.StatusOK {
		t.Fatalf("install: got %d body=%s", created.Code, created.Body.String())
	}
	assertDomainMCPSecretRedacted(t, created.Body.String())
	if !strings.Contains(created.Body.String(), `"credentialConfigured":true`) {
		t.Fatalf("credential state missing: %s", created.Body.String())
	}

	listed := call.request("admin", http.MethodGet, "/api/admin/domain-mcp/installations", nil, nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("list: got %d body=%s", listed.Code, listed.Body.String())
	}
	assertDomainMCPSecretRedacted(t, listed.Body.String())
	if !strings.Contains(listed.Body.String(), commerce.PackIDProductInsight) {
		t.Fatalf("installed pack missing: %s", listed.Body.String())
	}

	catalog := call.request("admin", http.MethodGet, "/api/admin/domain-mcp/catalog", nil, nil)
	if catalog.Code != http.StatusOK || !strings.Contains(catalog.Body.String(), `"installed":true`) {
		t.Fatalf("catalog: got %d body=%s", catalog.Code, catalog.Body.String())
	}
}

func TestDomainMCPAdminRoutesRejectUnknownFieldsAndOversizedBodies(t *testing.T) {
	router, _, call := newDomainMCPHandlerTest(t)
	RegisterDomainMCPRoutes(router.Group("/api"), call.service)

	unknown := call.request("admin", http.MethodPost, "/api/admin/domain-mcp/installations", []byte(`{"packId":"commerce.product-insight","apiKey":"secret","unexpected":true}`), nil)
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown field: got %d body=%s", unknown.Code, unknown.Body.String())
	}

	large := []byte(`{"packId":"commerce.product-insight","apiKey":"` + strings.Repeat("x", 70<<10) + `"}`)
	oversized := call.request("admin", http.MethodPost, "/api/admin/domain-mcp/installations", large, nil)
	if oversized.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body: got %d body=%s", oversized.Code, oversized.Body.String())
	}

	listed := call.request("admin", http.MethodGet, "/api/admin/domain-mcp/installations", nil, nil)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), `"data":[]`) {
		t.Fatalf("invalid requests mutated settings: %d %s", listed.Code, listed.Body.String())
	}
}

func TestDomainMCPProtocolEndpointRequiresDeploymentTokenNotCookie(t *testing.T) {
	router, _, call := newDomainMCPHandlerTest(t)
	RegisterDomainMCPProtocolRoute(router, call.service)

	discover := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"domain-mcp-test","version":"1"}}}`)

	t.Run("disabled without token", func(t *testing.T) {
		t.Setenv("CANVAS_DOMAIN_MCP_TOKEN", "")
		response := call.request("", http.MethodPost, "/mcp/domain", discover, nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("got %d body=%s", response.Code, response.Body.String())
		}
	})

	t.Run("cookie cannot authorize", func(t *testing.T) {
		t.Setenv("CANVAS_DOMAIN_MCP_TOKEN", "deployment-secret")
		response := call.request("admin", http.MethodPost, "/mcp/domain", discover, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("got %d body=%s", response.Code, response.Body.String())
		}
	})
}

func TestDomainMCPProtocolSequenceInitializeListAndCall(t *testing.T) {
	t.Setenv("CANVAS_DOMAIN_MCP_TOKEN", "deployment-secret")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := newDomainMCPAnySearchFixture(t)
	defer upstream.Close()

	router, admin, call := newDomainMCPHandlerTest(t)
	if _, err := call.service.InstallDomainMCPPack(admin, service.InstallDomainMCPRequest{
		PackID:   commerce.PackIDProductInsight,
		APIKey:   "upstream-secret",
		Endpoint: upstream.URL,
	}); err != nil {
		t.Fatal(err)
	}
	RegisterDomainMCPProtocolRoute(router, call.service)

	headers := map[string]string{
		"Authorization": "Bearer deployment-secret",
		"Accept":        "application/json, text/event-stream",
	}
	initialize := call.request("", http.MethodPost, "/mcp/domain", []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"domain-mcp-test","version":"1"}}}`), headers)
	if initialize.Code != http.StatusOK || !strings.Contains(initialize.Body.String(), `"serverInfo"`) {
		t.Fatalf("initialize: got %d body=%s", initialize.Code, initialize.Body.String())
	}

	listed := call.request("", http.MethodPost, "/mcp/domain", []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`), headers)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), commerce.ToolProductAnalyze) {
		t.Fatalf("tools/list: got %d body=%s", listed.Code, listed.Body.String())
	}

	called := call.request("", http.MethodPost, "/mcp/domain", []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"commerce.product_analyze","arguments":{"productName":"测试商品","productFacts":["棉质面料"]}}}`), headers)
	if called.Code != http.StatusOK || !strings.Contains(called.Body.String(), "测试商品") || !strings.Contains(called.Body.String(), `"structuredContent"`) || strings.Contains(called.Body.String(), `"isError":true`) {
		t.Fatalf("tools/call: got %d body=%s", called.Code, called.Body.String())
	}
}

type domainMCPHandlerCall struct {
	service *service.Service
	router  *gin.Engine
}

func (c domainMCPHandlerCall) request(role, method, path string, payload []byte, headers map[string]string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	if role != "" {
		request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test-token"})
	}
	response := httptest.NewRecorder()
	c.router.ServeHTTP(response, request)
	return response
}

func newDomainMCPHandlerTest(t *testing.T) (*gin.Engine, *model.User, domainMCPHandlerCall) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.AdminAuditEvent{}, &model.IDSequence{}); err != nil {
		t.Fatal(err)
	}
	var admin *model.User
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		user := &model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
		if role == model.UserRoleAdmin {
			admin = user
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	return router, admin, domainMCPHandlerCall{service: svc, router: router}
}

func assertDomainMCPSecretRedacted(t *testing.T, body string) {
	t.Helper()
	for _, forbidden := range []string{"do-not-return-this-secret", "upstream-secret", "apiKey", "credentialCipher", "enc:v1:"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response leaked secret field or material %q: %s", forbidden, body)
		}
	}
}

func newDomainMCPAnySearchFixture(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if r.Header.Get("Authorization") != "Bearer upstream-secret" {
			t.Errorf("unexpected upstream authorization")
		}
		var request struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode upstream request: %v", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		var result any
		switch request.Method {
		case "server/discover":
			result = map[string]any{"resultType": "complete", "protocolVersions": []string{"2026-07-28"}}
		case "tools/list":
			result = map[string]any{"resultType": "complete", "tools": []any{
				map[string]any{"name": "search", "inputSchema": map[string]any{"type": "object"}},
				map[string]any{"name": "extract", "inputSchema": map[string]any{"type": "object"}},
			}}
		case "tools/call":
			result = map[string]any{
				"resultType": "complete",
				"structuredContent": map[string]any{"results": []any{map[string]any{
					"title": "测试商品公开资料", "url": "https://example.com/product", "snippet": "公开市场资料与用户关注点摘要",
				}}},
				"content": []any{map[string]any{"type": "text", "text": "[测试商品公开资料](https://example.com/product)"}},
			}
		default:
			t.Errorf("unexpected upstream method %q params=%s", request.Method, request.Params)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
	}))
}
