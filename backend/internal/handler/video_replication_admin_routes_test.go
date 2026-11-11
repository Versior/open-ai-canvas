package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func TestVideoReplicationAdminRoutesAndOpenAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterVideoReplicationAdminRoutes(router.Group("/api"), &service.Service{})
	RegisterVideoTrendRoutes(router.Group("/api"), &service.Service{})
	RegisterTaskRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]string{
		"GET /api/admin/video-replication/trends":                        "/admin/video-replication/trends",
		"POST /api/admin/video-replication/trends/:source/oauth":         "/admin/video-replication/trends/{source}/oauth",
		"GET /api/admin/video-replication/trends/:source/oauth/callback": "/admin/video-replication/trends/{source}/oauth/callback",
		"GET /api/video-creation/trends":                                 "/video-creation/trends",
		"PUT /api/admin/video-replication/trends/:source/connection":     "/admin/video-replication/trends/{source}/connection",
		"DELETE /api/admin/video-replication/trends/:source/connection":  "/admin/video-replication/trends/{source}/connection",
		"POST /api/admin/video-replication/trends/:source/refresh":       "/admin/video-replication/trends/{source}/refresh",
		"PATCH /api/admin/video-replication/trends/:source":              "/admin/video-replication/trends/{source}",
		"GET /api/video-replication/config":                              "/video-replication/config",
		"GET /api/admin/video-replication/overview":                      "/admin/video-replication/overview",
		"GET /api/admin/video-replication/teardowns":                     "/admin/video-replication/teardowns",
		"GET /api/admin/video-replication/teardowns/:id":                 "/admin/video-replication/teardowns/{id}",
		"DELETE /api/admin/video-replication/teardowns/:id":              "/admin/video-replication/teardowns/{id}",
		"GET /api/admin/video-replication/settings":                      "/admin/video-replication/settings",
		"PATCH /api/admin/video-replication/settings":                    "/admin/video-replication/settings",
		"POST /api/video-replication/teardowns":                          "/video-replication/teardowns",
		"GET /api/video-replication/teardowns":                           "/video-replication/teardowns",
		"GET /api/video-replication/teardowns/:id":                       "/video-replication/teardowns/{id}",
		"PUT /api/video-replication/teardowns/:id/analysis":              "/video-replication/teardowns/{id}/analysis",
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

func TestVideoReplicationAdminHTTPFlow(t *testing.T) {
	t.Setenv("CANVAS_QIANCHUAN_APP_ID", "")
	t.Setenv("CANVAS_OCEANENGINE_APP_ID", "")
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
		&model.User{ID: "vr-admin", Username: "vr-admin", Email: "vr-admin@example.invalid", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.User{ID: "vr-user", Username: "vr-user", Email: "vr-user@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "vr-admin-session", UserID: "vr-admin", TokenHash: auth.HashToken("admin-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "vr-user-session", UserID: "vr-user", TokenHash: auth.HashToken("user-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Task{ID: "vt-http-1", UserID: "vr-user", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusFailed, Error: "无法识别视频文件", CreatedAt: time.Now()},
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
	api := router.Group("/api")
	RegisterFeatureAvailabilityRoutes(api, svc)
	RegisterVideoReplicationAdminRoutes(api, svc)
	RegisterVideoTrendRoutes(api, svc)
	RegisterTaskRoutes(api, svc)
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
	const admin, user = "vr-admin-session.admin-token", "vr-user-session.user-token"
	if response := call(http.MethodPost, "/api/admin/video-replication/trends/qianchuan/oauth", "", ""); response.Code != http.StatusUnauthorized {
		t.Fatal("anonymous authorization accepted")
	}
	if response := call(http.MethodPost, "/api/admin/video-replication/trends/qianchuan/oauth", "", admin); response.Code != http.StatusServiceUnavailable {
		t.Fatal("unconfigured authorization accepted")
	}
	if response := call(http.MethodPost, "/api/admin/video-replication/trends/douhot/oauth", "", admin); response.Code != http.StatusBadRequest {
		t.Fatal("unsupported platform authorization accepted")
	}
	if response := call(http.MethodGet, "/api/admin/video-replication/trends/qianchuan/oauth/callback?auth_code=FAKE_CODE&state=FAKE_STATE", "", admin); response.Code != http.StatusBadRequest || strings.Contains(response.Body.String(), "FAKE_CODE") || response.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("invalid callback accepted or leaked")
	}
	t.Run("configured official authorization start", func(t *testing.T) {
		t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
		t.Setenv("CANVAS_QIANCHUAN_APP_ID", "123")
		t.Setenv("CANVAS_QIANCHUAN_APP_SECRET", "EXAMPLE_APP_SECRET")
		t.Setenv("CANVAS_QIANCHUAN_AUTHORIZE_URL", "https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html?app_id=123")
		response := call(http.MethodPost, "/api/admin/video-replication/trends/qianchuan/oauth", "{}", admin)
		var result struct {
			Data service.VideoTrendAuthorization `json:"data"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatal("configured authorization start failed")
		}
		u, err := url.Parse(result.Data.URL)
		if err != nil || u.Host != "qianchuan.jinritemai.com" || len(u.Query().Get("state")) != 64 || u.Query().Get("redirect_uri") != "https://canvas.example.test/api/admin/video-replication/trends/qianchuan/oauth/callback" || strings.Contains(result.Data.URL, "EXAMPLE_APP_SECRET") {
			t.Fatal("invalid server authorization response")
		}
	})
	if response := call(http.MethodGet, "/api/video-creation/trends", "", ""); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous trends status = %d", response.Code)
	}
	if response := call(http.MethodGet, "/api/video-creation/trends?source=unknown", "", user); response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"reason":"invalid_argument"`) {
		t.Fatalf("invalid trends source = %d %s", response.Code, response.Body.String())
	}
	for _, source := range []string{"douhot", "qianchuan", "oceanengine"} {
		response := call(http.MethodGet, "/api/video-creation/trends?source="+source, "", user)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"unavailable"`) || !strings.Contains(response.Body.String(), `"topics":[]`) || strings.Contains(response.Body.String(), "fetchedAt") {
			t.Fatalf("business source authorization status = %d %s", response.Code, response.Body.String())
		}
	}
	for _, operation := range []struct{ method, path string }{
		{http.MethodGet, "/api/admin/video-replication/trends"},
		{http.MethodPost, "/api/admin/video-replication/trends/qianchuan/oauth"},
		{http.MethodGet, "/api/admin/video-replication/trends/qianchuan/oauth/callback"},
		{http.MethodPut, "/api/admin/video-replication/trends/douhot/connection"},
		{http.MethodPost, "/api/admin/video-replication/trends/douhot/refresh"},
		{http.MethodPatch, "/api/admin/video-replication/trends/douhot"},
		{http.MethodDelete, "/api/admin/video-replication/trends/douhot/connection"},
	} {
		if response := call(operation.method, operation.path, "{}", user); response.Code != http.StatusForbidden {
			t.Fatal("ordinary user accessed site account")
		}
	}
	if response := call(http.MethodGet, "/api/admin/video-replication/trends", "", admin); response.Code != http.StatusOK || strings.Contains(response.Body.String(), "accessToken") {
		t.Fatal("invalid admin account response")
	}
	if response := call(http.MethodPut, "/api/video-creation/trends/douhot", "{}", user); response.Code != http.StatusNotFound {
		t.Fatal("old public write route still registered")
	}
	for _, input := range []string{`{"advertiserId":"1","accessToken":"YOUR_API_KEY_HERE","cookie":"FAKE"}`, `{"advertiserId":"0","accessToken":"YOUR_API_KEY_HERE"}`, `{"advertiserId":"1","accessToken":"YOUR_API_KEY_HERE"} {}`} {
		if response := call(http.MethodPut, "/api/admin/video-replication/trends/oceanengine/connection", input, admin); response.Code != http.StatusBadRequest || strings.Contains(response.Body.String(), "YOUR_API_KEY_HERE") {
			t.Fatal("invalid connection accepted")
		}
	}
	if response := call(http.MethodPatch, "/api/admin/video-replication/trends/douhot", "{}", admin); response.Code != http.StatusBadRequest {
		t.Fatal("missing visibility accepted")
	}
	if response := call(http.MethodPatch, "/api/admin/video-replication/trends/douhot", `{"enabled":true}`, admin); response.Code == http.StatusOK {
		t.Fatal("unvalidated account published")
	}
	if response := call(http.MethodDelete, "/api/admin/video-replication/trends/douhot/connection", "", admin); response.Code != http.StatusOK {
		t.Fatal("admin disconnect failed")
	}

	for _, path := range []string{"/api/admin/video-replication/overview", "/api/admin/video-replication/teardowns", "/api/admin/video-replication/teardowns/vt-http-1", "/api/admin/video-replication/settings"} {
		if response := call(http.MethodGet, path, "", user); response.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s status = %d, body = %s", path, response.Code, response.Body.String())
		}
	}
	if response := call(http.MethodPatch, "/api/admin/video-replication/settings", `{"maxShots":20}`, user); response.Code != http.StatusForbidden {
		t.Fatalf("non-admin settings status = %d", response.Code)
	}
	// 设置页单独读取：默认设置和口播识别状态（测试环境没配转写服务）。
	initial := call(http.MethodGet, "/api/admin/video-replication/settings", "", admin)
	if initial.Code != http.StatusOK || !strings.Contains(initial.Body.String(), `"maxShots":60`) || !strings.Contains(initial.Body.String(), `"serviceConfigured":false`) || !strings.Contains(initial.Body.String(), `"available":false`) {
		t.Fatalf("settings read = %d %s", initial.Code, initial.Body.String())
	}
	saved := call(http.MethodPatch, "/api/admin/video-replication/settings", `{"maxShots":20}`, admin)
	if saved.Code != http.StatusOK || !strings.Contains(saved.Body.String(), `"maxShots":20`) || !strings.Contains(saved.Body.String(), `"maxDurationSeconds":180`) || !strings.Contains(saved.Body.String(), `"transcription":{`) {
		t.Fatalf("settings status = %d, body = %s", saved.Code, saved.Body.String())
	}
	if invalid := call(http.MethodPatch, "/api/admin/video-replication/settings", `{"maxDurationSeconds":5}`, admin); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid settings status = %d, body = %s", invalid.Code, invalid.Body.String())
	}
	if unknown := call(http.MethodPatch, "/api/admin/video-replication/settings", `{"maxShots":"many"}`, admin); unknown.Code != http.StatusBadRequest {
		t.Fatalf("malformed settings status = %d", unknown.Code)
	}

	list := call(http.MethodGet, "/api/admin/video-replication/teardowns?status=failed&keyword=vr-user", "", admin)
	var page struct {
		Data struct {
			Records []struct {
				ID    string `json:"id"`
				Error string `json:"error"`
				User  struct {
					Username string `json:"username"`
				} `json:"user"`
			} `json:"records"`
			Total    int64 `json:"total"`
			PageSize int   `json:"pageSize"`
		} `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil || list.Code != http.StatusOK || page.Data.Total != 1 || page.Data.Records[0].User.Username != "vr-user" || page.Data.Records[0].Error != "无法识别视频文件" || page.Data.PageSize != 20 {
		t.Fatalf("list = %d %s, %v", list.Code, list.Body.String(), err)
	}
	if bad := call(http.MethodGet, "/api/admin/video-replication/teardowns?page=0", "", admin); bad.Code != http.StatusBadRequest {
		t.Fatalf("bad page status = %d", bad.Code)
	}
	if detail := call(http.MethodGet, "/api/admin/video-replication/teardowns/vt-http-1", "", admin); detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), `"username":"vr-user"`) {
		t.Fatalf("detail = %d %s", detail.Code, detail.Body.String())
	}
	if overview := call(http.MethodGet, "/api/admin/video-replication/overview", "", admin); overview.Code != http.StatusOK || !strings.Contains(overview.Body.String(), `"failed":1`) {
		t.Fatalf("overview = %d %s", overview.Code, overview.Body.String())
	}

	config := call(http.MethodGet, "/api/video-replication/config", "", user)
	if config.Code != http.StatusOK || !strings.Contains(config.Body.String(), `"maxShots":20`) {
		t.Fatalf("config = %d %s", config.Code, config.Body.String())
	}
	if closed := call(http.MethodPatch, "/api/admin/settings/features", `{"videoReplicationEnabled":false}`, admin); closed.Code != http.StatusOK || !strings.Contains(closed.Body.String(), `"videoReplicationEnabled":false`) || !strings.Contains(closed.Body.String(), `"socialVideoImportEnabled":true`) {
		t.Fatalf("close feature = %d %s", closed.Code, closed.Body.String())
	}
	for _, path := range []string{"/api/video-replication/config", "/api/video-replication/teardowns", "/api/video-creation/trends"} {
		if response := call(http.MethodGet, path, "", user); response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "视频创作暂未开放") {
			t.Fatalf("%s with the feature off = %d %s", path, response.Code, response.Body.String())
		}
	}
	// 后台管理不受功能开关影响。
	for _, path := range []string{"/api/admin/video-replication/teardowns", "/api/admin/video-replication/settings", "/api/admin/video-replication/trends"} {
		if response := call(http.MethodGet, path, "", admin); response.Code != http.StatusOK {
			t.Fatalf("admin %s with the feature off = %d", path, response.Code)
		}
	}
	// 删除记录：只有管理员能删，删了以后详情 404。
	if response := call(http.MethodDelete, "/api/admin/video-replication/teardowns/vt-http-1", "", user); response.Code != http.StatusForbidden {
		t.Fatalf("non-admin delete = %d", response.Code)
	}
	if deleted := call(http.MethodDelete, "/api/admin/video-replication/teardowns/vt-http-1", "", admin); deleted.Code != http.StatusOK || !strings.Contains(deleted.Body.String(), `"deletedResources":[]`) {
		t.Fatalf("delete = %d %s", deleted.Code, deleted.Body.String())
	}
	if gone := call(http.MethodGet, "/api/admin/video-replication/teardowns/vt-http-1", "", admin); gone.Code != http.StatusNotFound {
		t.Fatalf("detail after delete = %d", gone.Code)
	}
}
