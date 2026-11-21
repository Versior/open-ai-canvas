package app

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestAgentMemoryRevisionStatusesTrackUndoWithoutChangingRun(t *testing.T) {
	svc, db, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	request := agentTestRequest()
	request.PermissionMode = "auto"
	run, err := svc.CreateCloudAgentRun("user", request, "")
	if err != nil {
		t.Fatal(err)
	}
	stored, state := agentInterjectionState(t, svc, run.ID)
	_, err = cloudAgentHandleMemoryUpdate(svc.repo, "user", &state, memoryUpdateCall("memory-status-test", `{"operations":[{"action":"add","section":"notes","text":"偏好冷色调"}],"reason":"测试偏好"}`), svc)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.MutateCloudAgent("user", run.ID, stored.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	finishConversationTestRun(t, db, run.ID)
	history, err := svc.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var revisionID string
	for _, event := range history.Events {
		if event.Type == "memory_updated" && event.Payload["status"] == "applied" {
			revisionID, _ = event.Payload["revisionId"].(string)
		}
	}
	if revisionID == "" {
		t.Fatal("missing applied memory revision in journal")
	}
	if statuses, err := svc.AgentMemoryRevisionStatuses("user", []string{revisionID}); err != nil || statuses[revisionID] != "applied" {
		t.Fatalf("before undo: %v, %v", statuses, err)
	}
	if _, err := svc.UndoAgentMemoryRevision("user", revisionID); err != nil {
		t.Fatal(err)
	}
	reader := &Service{repo: repository.New(db)}
	if statuses, err := reader.AgentMemoryRevisionStatuses("user", []string{revisionID}); err != nil || statuses[revisionID] != "undone" {
		t.Fatalf("fresh reader after undo: %v, %v", statuses, err)
	}
	after, err := reader.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != history.Revision || after.Status != "completed" || !reflect.DeepEqual(after.Events, history.Events) {
		t.Fatal("undo changed the completed run or its immutable journal")
	}
}

type memoryStatusQueryTrace struct {
	logger.Interface
	statements []string
}

func (trace *memoryStatusQueryTrace) Trace(_ context.Context, _ time.Time, statement func() (string, int64), _ error) {
	query, _ := statement()
	trace.statements = append(trace.statements, query)
}

func TestAgentMemoryRevisionStatusesRespectRetentionAndUseOneQuery(t *testing.T) {
	db := agentPermissionsDB(t)
	if err := db.AutoMigrate(&model.AgentMemoryDocument{}, &model.AgentMemoryDocumentRevision{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	stamp := time.Now().UTC().Add(-time.Hour)
	doc, err := repo.CreateAgentMemoryDocument(&model.AgentMemoryDocument{UserID: "owner", Revision: 1, EntriesJSON: "[]", NextEntrySeq: 1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	rows := []model.AgentMemoryDocumentRevision{{ID: "pending", UserID: doc.UserID, Status: model.AgentMemoryRevisionPending, CreatedAt: stamp}}
	for index := 0; index < agentMemoryRevisionKeep; index++ {
		rows = append(rows, model.AgentMemoryDocumentRevision{ID: fmt.Sprintf("rev-%03d", index), UserID: doc.UserID, Status: model.AgentMemoryRevisionApplied, CreatedAt: stamp.Add(time.Duration(index) * time.Second)})
	}
	if err := db.CreateInBatches(rows, 40).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	_, err = repo.WriteAgentMemoryDocument(repository.AgentMemoryDocumentWrite{UserID: doc.UserID, ExpectedRevision: doc.Revision, EntriesJSON: "[]", NextEntrySeq: doc.NextEntrySeq, Now: now, Keep: agentMemoryRevisionKeep, Revision: &model.AgentMemoryDocumentRevision{ID: "newest", Actor: model.AgentMemoryActorUser, CreatedAt: now}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AgentMemoryDocumentRevision(doc.UserID, "rev-000"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("fixture did not prune oldest completed revision: %v", err)
	}
	trace := &memoryStatusQueryTrace{Interface: logger.Discard}
	reader := &Service{repo: repository.New(db.Session(&gorm.Session{Logger: trace}))}
	ids := []string{"pending", "rev-000", "newest", "pending"}
	for index := 1; len(ids) < 100; index++ {
		ids = append(ids, fmt.Sprintf("rev-%03d", index))
	}
	statuses, err := reader.AgentMemoryRevisionStatuses(doc.UserID, ids)
	if err != nil || len(statuses) != 99 || statuses["pending"] != "pending" || statuses["rev-000"] != "unavailable" || statuses["newest"] != "applied" {
		t.Fatalf("status projection after retention: %v, err=%v", statuses, err)
	}
	if len(trace.statements) != 1 {
		t.Fatalf("100 requested IDs took %d SQL statements, want 1", len(trace.statements))
	}
	query := strings.NewReplacer("`", "", `"`, "", " ", "").Replace(strings.ToLower(trace.statements[0]))
	if !strings.HasPrefix(query, "selectid,status,restored_atfrom") || strings.Count(query, "pending") != 1 {
		t.Fatalf("query read other columns or duplicated the same ID: %s", trace.statements[0])
	}
	t.Logf("%s: 100 input IDs, 99 unique, 1 SELECT (id, status, restored_at)", db.Dialector.Name())
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	reader.repo = repo.WithContext(cancelled)
	if failed, readErr := reader.AgentMemoryRevisionStatuses(doc.UserID, ids); !errors.Is(readErr, context.Canceled) || failed != nil {
		t.Fatalf("failed query must not return unavailable statuses: %v, %v", failed, readErr)
	}
}
