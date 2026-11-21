package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func agentHTTPRunFixture(t *testing.T) (*gin.Engine, *gorm.DB, string, int) {
	t.Helper()
	t.Setenv("REDIS_URL", "")
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "events.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	profile, err := json.Marshal(service.DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "session", UserID: "user", TokenHash: auth.HashToken("test"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "test", Enabled: true},
		&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: string(profile), BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	// 此处只验证 HTTP 读取。关停后台 runner 后创建真实的运行检查点，不访问模型。
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAgentRoutes(router.Group("/api"), svc)
	req := service.CloudAgentRequest{Prompt: "测试", Model: "text-test", ChannelID: "channel", ChannelModelKey: "text-test", PermissionMode: "read_only", IdempotencyKey: "journal-test-key"}
	req.Budget.MaxCredits = 1
	run, err := svc.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	return router, db, run.ID, run.EventCount
}

func TestAgentHTTPApprovalReasonUnicodeBody(t *testing.T) {
	router, _, runID, _ := agentHTTPRunFixture(t)
	for _, tc := range []struct {
		name, encoded string
		status        int
	}{{"Chinese", strings.Repeat("影", 2000), 409}, {"emoji", strings.Repeat("🎬", 2000), 409}, {"escaped", strings.Repeat(`\ud83c\udfac`, 2000), 409}, {"too many", strings.Repeat("🎬", 2001), 400}} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/api/agent/runs/"+runID+"/approvals/no-pending-approval/decision", strings.NewReader(`{"decision":"reject","reason":"`+tc.encoded+`"}`))
			request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.test"})
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, request)
			if rec.Code != tc.status {
				t.Fatalf("got %d, want %d: %s", rec.Code, tc.status, rec.Body.String())
			}
		})
	}
}

func TestAgentHTTPEventReplayDrainsBeforeFinalSnapshot(t *testing.T) {
	router, db, runID, initialCount := agentHTTPRunFixture(t)
	seed := func(from, to int, status string) {
		t.Helper()
		err := db.Transaction(func(tx *gorm.DB) error {
			rows := make([]model.CloudAgentEventRecord, 0, to-from)
			for seq := from + 1; seq <= to; seq++ {
				id := fmt.Sprintf("%s:%d", runID, seq)
				raw, err := json.Marshal(map[string]any{"eventId": id, "runId": runID, "seq": seq, "type": "tool_completed", "payload": map[string]any{"toolName": "canvas_get_state"}, "createdAt": time.Now()})
				if err != nil {
					return err
				}
				rows = append(rows, model.CloudAgentEventRecord{RunID: runID, UserID: "user", Sequence: seq, EventJSON: string(raw)})
			}
			if len(rows) > 0 {
				if err := tx.CreateInBatches(rows, 100).Error; err != nil {
					return err
				}
			}
			return tx.Model(&model.CloudAgentExecution{}).Where("id = ?", runID).Updates(map[string]any{"event_count": to, "status": status, "revision": gorm.Expr("revision + 1")}).Error
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	request := func(query string) *http.Request {
		r := httptest.NewRequest("GET", "/api/agent/runs/"+runID+"/events"+query, nil)
		r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.test"})
		return r
	}
	check := func(t *testing.T, response *httptest.ResponseRecorder, first, last int, snapshots int) {
		t.Helper()
		if response.Code != 200 {
			t.Fatalf("stream status %d: %s", response.Code, response.Body.String())
		}
		next, observed := first, 0
		for _, frame := range strings.Split(strings.TrimSpace(response.Body.String()), "\n\n") {
			lines := strings.Split(frame, "\n")
			if strings.HasPrefix(lines[0], "id: ") {
				seq, err := strconv.Atoi(strings.TrimPrefix(lines[0], "id: "))
				if err != nil || seq != next {
					t.Fatalf("got seq=%d, want %d", seq, next)
				}
				next++
			} else if lines[0] == "event: run_snapshot" {
				observed++
				var snap struct {
					Status string `json:"status"`
				}
				if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[1], "data: ")), &snap); err != nil {
					t.Fatal(err)
				}
				if snap.Status == "completed" && next != last+1 {
					t.Fatalf("terminal snapshot before backlog drained: through %d, want %d", next-1, last)
				}
			} else {
				t.Fatalf("unexpected frame: %s", lines[0])
			}
		}
		if next != last+1 || observed != snapshots {
			t.Fatalf("last=%d snapshots=%d, want %d/%d", next-1, observed, last, snapshots)
		}
	}
	count := initialCount
	for _, total := range []int{499, 500, 501, 620} {
		seed(count, total, "completed")
		count = total
		for _, after := range []int{0, 1, total} {
			t.Run(fmt.Sprintf("total=%d/after=%d", total, after), func(t *testing.T) {
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, request(fmt.Sprintf("?after=%d", after)))
				check(t, rec, after+1, total, 1)
			})
		}
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, request(""))
	check(t, rec, count-repository.CloudAgentJournalWindow+1, count, 1)
	seed(count, count, "running")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream := &agentSnapshotRecorder{ResponseRecorder: httptest.NewRecorder(), firstSnapshot: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		defer close(done)
		r := request("?after=0").WithContext(ctx)
		r.Header.Set("Last-Event-ID", "1")
		router.ServeHTTP(stream, r)
	}()
	select {
	case <-stream.firstSnapshot:
	case <-done:
		t.Fatal("stream stopped before running snapshot")
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	seed(count, count+501, "completed")
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	check(t, stream.ResponseRecorder, 2, count+501, 2)
}

type agentSnapshotRecorder struct {
	*httptest.ResponseRecorder
	firstSnapshot chan struct{}
}

func (w *agentSnapshotRecorder) Write(data []byte) (int, error) {
	n, err := w.ResponseRecorder.Write(data)
	if strings.HasPrefix(string(data), "event: run_snapshot\n") {
		select {
		case <-w.firstSnapshot:
		default:
			close(w.firstSnapshot)
		}
	}
	return n, err
}
