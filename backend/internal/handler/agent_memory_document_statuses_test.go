package handler

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestAgentMemoryRevisionStatusesHTTP(t *testing.T) {
	t.Setenv("REDIS_URL", "")
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
	now := time.Now().UTC()
	for _, row := range []any{
		&model.User{ID: "card-user", Username: "card-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "card-session", UserID: "card-user", TokenHash: auth.HashToken("test"), ExpiresAt: now.Add(time.Hour)},
		&model.AgentMemoryDocumentRevision{ID: "recent", UserID: "card-user", Status: model.AgentMemoryRevisionApplied, BeforeJSON: "sensitive-fixture"},
		&model.AgentMemoryDocumentRevision{ID: "proposal", UserID: "card-user", Status: model.AgentMemoryRevisionPending},
		&model.AgentMemoryDocumentRevision{ID: "declined", UserID: "card-user", Status: model.AgentMemoryRevisionRejected},
		&model.AgentMemoryDocumentRevision{ID: "restored", UserID: "card-user", Status: model.AgentMemoryRevisionApplied, RestoredAt: &now},
		&model.AgentMemoryDocumentRevision{ID: "external", UserID: "another-user", Status: model.AgentMemoryRevisionApplied},
		&model.AgentMemoryDocumentRevision{ID: "unrecognised", UserID: "card-user", Status: "invalid-stored-state"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	router := gin.New()
	RegisterAgentMemoryRoutes(router.Group("/api"), svc)
	post := func(t *testing.T, body string, authenticated bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/agent/memory/revisions/statuses", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if authenticated {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "card-session.test"})
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("status=%d, want %d: %s", res.Code, want, res.Body.String())
		}
		return res
	}
	post(t, "invalid", false, http.StatusUnauthorized)
	got := post(t, `{"revisionIds":["recent","proposal","declined","restored","external","missing","proposal"]}`, true, http.StatusOK)
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Statuses map[string]string `json:"statuses"`
		} `json:"data"`
	}
	if err := json.Unmarshal(got.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{"recent": "applied", "proposal": "pending", "declined": "rejected", "restored": "undone", "external": "unavailable", "missing": "unavailable"}
	if envelope.Code != 0 || !maps.Equal(envelope.Data.Statuses, expected) || strings.Contains(got.Body.String(), "sensitive-fixture") {
		t.Fatalf("incorrect status response: %+v", envelope)
	}
	for _, body := range []string{`{}`, `{"revisionIds":null}`, `{"revisionIds":[]}`, `{"revisionIds":[""]}`, `{"revisionIds":[" recent"]}`, `{"revisionIds":["a\u0000b"]}`, `{"revisionIds":["` + strings.Repeat("x", 37) + `"]}`, `{"revisionIds":[1]}`, `{"revisionIds":["recent"],"userId":"another-user"}`, `{"revisionIds":["recent"]} {}`, strings.Repeat(" ", 65<<10) + `{"revisionIds":["recent"]}`} {
		post(t, body, true, http.StatusBadRequest)
	}
	for _, amount := range []int{100, 101} {
		raw, err := json.Marshal(map[string]any{"revisionIds": slices.Repeat([]string{"recent"}, amount)})
		if err != nil {
			t.Fatal(err)
		}
		want := http.StatusOK
		if amount > 100 {
			want = http.StatusBadRequest
		}
		post(t, string(raw), true, want)
	}
	failed := post(t, `{"revisionIds":["recent","unrecognised"]}`, true, http.StatusInternalServerError)
	if strings.Contains(failed.Body.String(), `"statuses"`) || strings.Contains(failed.Body.String(), "invalid-stored-state") {
		t.Fatal("invalid stored status was exposed or disguised as a partial success")
	}
}
