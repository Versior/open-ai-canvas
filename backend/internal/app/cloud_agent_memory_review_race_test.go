package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestMemoryReviewInterleavedDecisionsAndReceipts(t *testing.T) {
	const original, proposed, edited = "暖色", "偏冷的蓝调", "用户手改为黑白"
	for _, scenario := range []struct {
		name, delayed, intervening, status, text string
		advance                                  int64
	}{
		{"approve after approve", "approve", "approve", "applied", proposed, 1},
		{"approve after reject", "approve", "reject", "rejected", original, 0},
		{"reject after approve", "reject", "approve", "applied", proposed, 1},
		{"approve after same-entry edit", "approve", "edit", "pending", edited, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			const user, run, call = "user", "memory-run", "memory-call"
			service, db, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
			initial, err := service.UpdateAgentMemoryDocumentSettings(user, AgentMemoryDocSettingsRequest{Mode: "review"})
			if err != nil {
				t.Fatal(err)
			}
			base, err := service.UpdateAgentMemoryDocument(user, AgentMemoryDocUpdateRequest{Revision: initial.Revision, Entries: []AgentMemoryEntryInput{{Section: "notes", Text: original}}})
			if err != nil {
				t.Fatal(err)
			}
			entryID := base.Entries[0].ID
			operations := []agentMemoryOperation{{Action: "replace", ID: entryID, Text: proposed}}
			proposal, _, err := service.agentMemoryAgentWrite(user, run, call, operations, "")
			if err != nil {
				t.Fatal(err)
			}
			preview, err := service.AgentMemoryDocumentRevisions(user, "pending", 10)
			if err != nil || len(preview) != 1 || preview[0].ID != proposal.RevisionID || preview[0].ReviewHash == "" {
				t.Fatalf("missing initial review: %+v %v", preview, err)
			}
			decide := func(decision string) error {
				_, err := service.DecideAgentMemoryRevision(user, proposal.RevisionID, AgentMemoryDocDecisionRequest{Decision: decision, ReviewHash: preview[0].ReviewHash})
				return err
			}

			read, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			resume := sync.OnceFunc(func() { close(release) })
			var reached atomic.Bool
			const callback = "test:pause-memory-review-after-read"
			if err := db.Callback().Query().After("gorm:query").Register(callback, func(query *gorm.DB) {
				var matched bool
				switch row := query.Statement.Dest.(type) {
				case *model.AgentMemoryDocument:
					matched = scenario.delayed == "approve" && row.UserID == user && row.Revision == base.Revision
				case *model.AgentMemoryDocumentRevision:
					matched = scenario.delayed == "reject" && row.ID == proposal.RevisionID && row.Status == model.AgentMemoryRevisionPending
				}
				if matched && reached.CompareAndSwap(false, true) {
					close(read)
					<-release
				}
			}); err != nil {
				t.Fatal(err)
			}
			var delayedErr error
			go func() { delayedErr = decide(scenario.delayed); close(done) }()
			t.Cleanup(func() { resume(); <-done; _ = db.Callback().Query().Remove(callback) })
			select {
			case <-read:
			case <-done:
				t.Fatalf("decision finished before reading review state: %v", delayedErr)
			case <-time.After(10 * time.Second):
				t.Fatal("decision never reached the overlapping read")
			}
			if scenario.intervening == "edit" {
				_, err = service.UpdateAgentMemoryDocument(user, AgentMemoryDocUpdateRequest{Revision: base.Revision, Entries: []AgentMemoryEntryInput{{ID: entryID, Section: "notes", Text: edited}}})
			} else {
				err = decide(scenario.intervening)
			}
			if err != nil {
				t.Fatalf("intervening %s: %v", scenario.intervening, err)
			}
			resume()
			<-done
			var conflict *kernel.AppError
			if !errors.As(delayedErr, &conflict) || conflict.Status != 409 {
				t.Fatalf("stale %s: want conflict, got %v", scenario.delayed, delayedErr)
			}

			args, err := json.Marshal(map[string]any{"operations": operations})
			if err != nil {
				t.Fatal(err)
			}
			state := cloudAgentRuntime{RuntimeRunID: run}
			state.Request.MemoryMode = "review"
			result, err := cloudAgentHandleMemoryUpdate(service.repo, user, &state, memoryUpdateCall(call, string(args)), service)
			if err != nil {
				t.Fatal(err)
			}
			doc, err := service.AgentMemoryDocument(user)
			if err != nil || len(doc.Entries) != 1 || doc.Entries[0].ID != entryID || doc.Entries[0].Text != scenario.text || doc.Revision != base.Revision+scenario.advance {
				t.Fatalf("stored document disagrees with winner: %+v %v", doc, err)
			}
			var pending int64
			receiptStatus := scenario.status
			if scenario.status == "pending" {
				pending, receiptStatus = 1, "pending_review"
			}
			if doc.PendingCount != pending || doc.CharCount != utf8.RuneCountInString(scenario.text) {
				t.Fatalf("inconsistent usage or pending count: %+v", doc)
			}
			var rows []model.AgentMemoryDocumentRevision
			if err := db.Where("user_id = ? AND call_id = ?", user, call).Find(&rows).Error; err != nil || len(rows) != 1 {
				t.Fatalf("decision/replay created more than one revision: rows=%d err=%v", len(rows), err)
			}
			row := rows[0]
			revision := base.Revision
			if scenario.status == "applied" {
				revision++
			}
			if row.ID != proposal.RevisionID || row.Status != scenario.status || row.BaseRevision != base.Revision || row.Revision != revision || (row.DecidedAt == nil) != (pending == 1) || row.RestoredAt != nil {
				t.Fatalf("decision history disagrees with document: %+v", row)
			}
			receipt := result.(map[string]any)
			if receipt["status"] != receiptStatus || receipt["usage"] != fmt.Sprintf("%d/%d", doc.CharCount, doc.Capacity) || len(state.Events) != 1 {
				t.Fatalf("wrong replay receipt: %+v events=%+v", receipt, state.Events)
			}
			event := state.Events[0]
			if event.Type != "memory_updated" || event.Payload["status"] != receiptStatus || event.Payload["revisionId"] != row.ID || event.Payload["charCount"] != doc.CharCount {
				t.Fatalf("wrong replay event: %+v", event)
			}
			if receiptStatus == "rejected" && (!strings.Contains(receipt["text"].(string), "拒绝") || !strings.Contains(event.Payload["text"].(string), "拒绝")) {
				t.Fatalf("replay hides the winning rejection: %+v %+v", receipt, event)
			}
		})
	}
}
