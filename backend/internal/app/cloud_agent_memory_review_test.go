package app

import (
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestMemoryApprovalUsesThePreviewedEntry(t *testing.T) {
	for _, action := range []string{"replace", "remove"} {
		t.Run(action, func(t *testing.T) {
			service, _, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
			const user = "user"
			doc, err := service.UpdateAgentMemoryDocumentSettings(user, AgentMemoryDocSettingsRequest{Mode: "review"})
			if err != nil {
				t.Fatal(err)
			}
			edit := func(entries []AgentMemoryEntryInput) {
				t.Helper()
				doc, err = service.UpdateAgentMemoryDocument(user, AgentMemoryDocUpdateRequest{Revision: doc.Revision, Entries: entries})
				if err != nil {
					t.Fatal(err)
				}
			}
			edit([]AgentMemoryEntryInput{{Section: "notes", Text: "默认暖色"}})
			id := doc.Entries[0].ID
			outcome, _, err := service.agentMemoryAgentWrite(user, "run", "call", []agentMemoryOperation{{Action: action, ID: id, Text: "默认冷色"}}, "")
			if err != nil {
				t.Fatal(err)
			}
			preview := func() AgentMemoryDocRevisionView {
				t.Helper()
				rows, err := service.AgentMemoryDocumentRevisions(user, "pending", 20)
				if err != nil || len(rows) != 1 || len(rows[0].Changes) != 1 {
					t.Fatalf("preview: %+v %v", rows, err)
				}
				return rows[0]
			}
			original := preview()
			if original.Changes[0].Before != "默认暖色" || original.ReviewHash == "" {
				t.Fatalf("original preview: %+v", original)
			}
			edit([]AgentMemoryEntryInput{{ID: id, Section: "notes", Text: "手改黑白"}})
			decide := func(hash string) error {
				_, err := service.DecideAgentMemoryRevision(user, outcome.RevisionID, AgentMemoryDocDecisionRequest{Decision: "approve", ReviewHash: hash})
				return err
			}
			for _, hash := range []string{"", original.ReviewHash} {
				var conflict *kernel.AppError
				if err := decide(hash); !errors.As(err, &conflict) || conflict.Status != 409 {
					t.Fatalf("stale decision did not conflict: %v", err)
				}
			}
			newView := preview()
			if newView.Changes[0].Before != "手改黑白" || newView.ReviewHash == original.ReviewHash {
				t.Fatalf("stale prose: %+v", newView)
			}
			edit([]AgentMemoryEntryInput{{ID: id, Section: "user", Text: "手改黑白"}})
			if decide(newView.ReviewHash) == nil {
				t.Fatal("section-only edit wasn't protected")
			}
			latest := preview()
			edit([]AgentMemoryEntryInput{{ID: id, Section: "user", Text: "手改黑白"}, {Section: "notes", Text: "不相关的条目"}})
			if err := decide(latest.ReviewHash); err != nil {
				t.Fatalf("unrelated edit blocked reviewed change: %v", err)
			}
			final, err := service.AgentMemoryDocument(user)
			if err != nil || final.PendingCount != 0 || len(final.Entries) == 0 || final.Entries[len(final.Entries)-1].Text != "不相关的条目" {
				t.Fatalf("final: %+v %v", final, err)
			}
			if action == "remove" && len(final.Entries) != 1 || action == "replace" && (len(final.Entries) != 2 || final.Entries[0].Text != "默认冷色") {
				t.Fatalf("wrong result: %+v", final)
			}
			if decide(latest.ReviewHash) == nil {
				t.Fatal("pending revision applied twice")
			}
		})
	}
}

func TestMemoryReviewAdditionIgnoresSequenceButNotLossOfItsEffect(t *testing.T) {
	for _, manualText := range []string{"其他偏好", "默认暖色"} {
		t.Run(manualText, func(t *testing.T) {
			service, _, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
			doc, err := service.UpdateAgentMemoryDocumentSettings("user", AgentMemoryDocSettingsRequest{Mode: "review"})
			if err != nil {
				t.Fatal(err)
			}
			proposal, _, err := service.agentMemoryAgentWrite("user", "run", "call", []agentMemoryOperation{{Action: "add", Section: "notes", Text: "默认暖色"}}, "")
			if err != nil {
				t.Fatal(err)
			}
			read := func() AgentMemoryDocRevisionView {
				t.Helper()
				views, err := service.AgentMemoryDocumentRevisions("user", "pending", 20)
				if err != nil || len(views) != 1 {
					t.Fatalf("pending proposal: %+v %v", views, err)
				}
				return views[0]
			}
			first := read()
			if _, err = service.UpdateAgentMemoryDocument("user", AgentMemoryDocUpdateRequest{Revision: doc.Revision, Entries: []AgentMemoryEntryInput{{Section: "notes", Text: manualText}}}); err != nil {
				t.Fatal(err)
			}
			second := read()
			accepted, err := service.DecideAgentMemoryRevision("user", proposal.RevisionID, AgentMemoryDocDecisionRequest{Decision: "approve", ReviewHash: first.ReviewHash})
			if manualText == "其他偏好" {
				if err != nil || first.ReviewHash == "" || first.ReviewHash != second.ReviewHash || len(accepted.Entries) != 2 || accepted.Entries[0].Text != manualText || accepted.Entries[1].Text != "默认暖色" {
					t.Fatalf("unrelated addition: %+v %+v %+v %v", first, second, accepted, err)
				}
				return
			}
			if err == nil || second.ReviewError == "" || second.ReviewHash != "" || len(second.Changes) != 0 || read().Status != "pending" {
				t.Fatalf("empty approval recorded a decision: %+v %v", second, err)
			}
			rejected, err := service.DecideAgentMemoryRevision("user", proposal.RevisionID, AgentMemoryDocDecisionRequest{Decision: "reject"})
			if err != nil || rejected.PendingCount != 0 || len(rejected.Entries) != 1 {
				t.Fatalf("explicit rejection: %+v %v", rejected, err)
			}
		})
	}
}

func TestMemoryReplayUsesPersistedDispositionAndUsage(t *testing.T) {
	for _, outcome := range []string{"rejected", "undone"} {
		t.Run(outcome, func(t *testing.T) {
			service, _, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
			mode := "review"
			if outcome == "undone" {
				mode = "auto"
			}
			if _, err := service.UpdateAgentMemoryDocumentSettings("user", AgentMemoryDocSettingsRequest{Mode: mode}); err != nil {
				t.Fatal(err)
			}
			ops := []agentMemoryOperation{{Action: "add", Section: "notes", Text: "默认晴天"}}
			first, _, err := service.agentMemoryAgentWrite("user", "run", "call", ops, "")
			if err != nil {
				t.Fatal(err)
			}
			if outcome == "rejected" {
				_, err = service.DecideAgentMemoryRevision("user", first.RevisionID, AgentMemoryDocDecisionRequest{Decision: "reject"})
			} else {
				_, err = service.UndoAgentMemoryRevision("user", first.RevisionID)
			}
			if err != nil {
				t.Fatal(err)
			}
			replay, _, err := service.agentMemoryAgentWrite("user", "run", "call", ops, "")
			if err != nil || replay.Status != outcome || replay.CharCount != 0 || replay.RevisionID != first.RevisionID {
				t.Fatalf("replayed receipt: %+v %v", replay, err)
			}
			state := cloudAgentRuntime{RuntimeRunID: "run"}
			state.Request.MemoryMode = mode
			result, err := cloudAgentHandleMemoryUpdate(service.repo, "user", &state, memoryUpdateCall("call", `{"operations":[{"action":"add","section":"notes","text":"默认晴天"}]}`), service)
			if err != nil {
				t.Fatal(err)
			}
			receipt := result.(map[string]any)
			if receipt["status"] != outcome || receipt["usage"] != "0/5000" || len(state.Events) != 1 {
				t.Fatalf("tool replay: %+v events=%+v", receipt, state.Events)
			}
			event := state.Events[0]
			label := "拒绝"
			if outcome == "undone" {
				label = "撤销"
			}
			if event.Type != "memory_updated" || event.Payload["status"] != outcome || event.Payload["revisionId"] != first.RevisionID || !strings.Contains(receipt["text"].(string), label) || event.Payload["text"] != receipt["text"] {
				t.Fatalf("misleading receipt: %+v %+v", receipt, event)
			}
			row, err := service.repo.AgentMemoryDocumentRevision("user", first.RevisionID)
			if err != nil || (outcome == "rejected" && row.Status != model.AgentMemoryRevisionRejected) || (outcome == "undone" && (row.Status != model.AgentMemoryRevisionApplied || row.RestoredAt == nil)) {
				t.Fatalf("history changed by replay: %+v %v", row, err)
			}
			doc, err := service.AgentMemoryDocument("user")
			if err != nil || len(doc.Entries) != 0 || doc.PendingCount != 0 {
				t.Fatalf("replayed write: %+v %v", doc, err)
			}
		})
	}
}
