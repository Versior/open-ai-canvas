package app

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentPiCannotCompleteOnEmptyAssistantOrCounterAlone(t *testing.T) {
	service, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, service, root.ID)
	run.Status = "running"
	interjectionSaveState(t, service, db, run, &state)
	for _, message := range []string{
		`{"role":"assistant","stopReason":"stop","content":[]}`,
		`{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"  "}]}`,
		`{"role":"assistant","stopReason":"stop","content":[{"type":"thinking","thinking":"private"}]}`,
		`{"role":"assistant","stopReason":"error","content":[{"type":"text","text":"partial"}]}`,
		`{"role":"assistant","stopReason":"toolUse","content":[{"type":"toolCall","name":"read"}]}`,
		`{"role":"assistant","stopReason":"toolUse","content":[{"type":"toolCall","id":"call","name":"read","arguments":"invalid"}]}`,
	} {
		_, err := service.cloudAgentPiEvent(t.Context(), "user", root.ID, map[string]json.RawMessage{"type": json.RawMessage(`"message_end"`), "message": json.RawMessage(message)})
		if err == nil {
			t.Fatalf("invalid message was acknowledged: %s", message)
		}
	}
	run, state = agentInterjectionState(t, service, root.ID)
	if state.PiAssistantResponses != 0 {
		t.Fatal("invalid messages were counted")
	}
	state.PiAssistantResponses = 1
	interjectionSaveState(t, service, db, run, &state)
	if err := service.completeCloudAgentPiRun("user", root.ID); err == nil {
		t.Fatal("counter without durable output completed the run")
	}
	run, state = agentInterjectionState(t, service, root.ID)
	if run.Status != "running" || agentHasEvent(state, "run_completed") {
		t.Fatalf("expected uncompleted state; got %s", run.Status)
	}
}

func TestCloudAgentPiCanCompleteWithCommittedToolOnlyOutput(t *testing.T) {
	service, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, service, root.ID)
	run.Status = "running"
	call := cloudAgentCall{ID: "call-original"}
	call.Function.Name, call.Function.Arguments = "canvas_get_state", "{}"
	state.Calls = []cloudAgentCall{call}
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "", "tool_calls": state.Calls})
	interjectionSaveState(t, service, db, run, &state)
	if _, err := service.cloudAgentPiEvent(t.Context(), "user", root.ID, map[string]json.RawMessage{
		"type":    json.RawMessage(`"message_end"`),
		"message": json.RawMessage(`{"role":"assistant","stopReason":"toolUse","content":[{"type":"toolCall","id":"call-original","name":"canvas_get_state","arguments":{}}]}`),
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.completeCloudAgentPiRun("user", root.ID); err == nil {
		t.Fatal("unanswered tool declaration passed the completion gate")
	}
	for attempt := 0; attempt < 2; attempt++ {
		result, err := service.executeCloudAgentRuntimeTool(t.Context(), "user", root.ID, call)
		if err != nil || result.(map[string]any)["isError"] != false {
			t.Fatalf("read/replay: %v %v", result, err)
		}
	}
	if err := service.completeCloudAgentPiRun("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, service, root.ID)
	receipts := 0
	for _, message := range state.Canonical.Messages {
		if message["role"] == "tool" && message["tool_call_id"] == call.ID {
			receipts++
		}
	}
	if run.Status != "completed" || !agentHasEvent(state, "run_completed") || receipts != 1 || state.PiAssistantResponses != 1 {
		t.Fatalf("status=%s receipts=%d assistants=%d", run.Status, receipts, state.PiAssistantResponses)
	}
}

func TestCloudAgentPiRestartsFromToolCheckpointAndAdoptsNextTask(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	t.Setenv("YINGCE_AGENT_URL", "")
	t.Setenv("YINGCE_AGENT_TEMP_DIR", filepath.Join(t.TempDir(), "runs"))
	service, db, root := interjectionPiRoot(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	first, stop := context.WithCancel(ctx)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- service.runCloudAgentPiSession(first, "user", root.ID) }()
	const id = "read-once"
	const toolOutput = `{"toolCalls":[{"id":"read-once","function":{"name":"canvas_get_state","arguments":"{}"}}]}`
	step1 := waitCloudAgentModelTask(t, ctx, service, root.ID, "", done)
	if err := db.Model(&model.Task{}).Where("id = ?", step1).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": toolOutput}).Error; err != nil {
		t.Fatal(err)
	}
	step2 := waitCloudAgentModelTask(t, ctx, service, root.ID, step1, done)
	saved, err := service.repo.CloudAgentPiSession("user", root.ID)
	if err != nil || saved == nil {
		t.Fatalf("step two started without a database checkpoint: %v", err)
	}
	last := lastPiSessionMessage(saved.SessionJSONL)
	if last["role"] != "toolResult" || last["toolCallId"] != id || last["isError"] != false {
		t.Fatalf("checkpoint lacks original successful tool receipt: role=%v id=%v error=%v", last["role"], last["toolCallId"], last["isError"])
	}
	stop()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupted runtime = %v", err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", step2).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"已恢复 🎬"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.runCloudAgentPiSession(ctx, "user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, service, root.ID)
	saved, err = service.repo.CloudAgentPiSession("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	var receipts, originals, deltas, visibleAnswers int
	for _, line := range strings.Split(strings.TrimSpace(saved.SessionJSONL), "\n") {
		message := lastPiSessionMessage(line)
		if message["role"] == "toolResult" && message["toolCallId"] == id {
			receipts++
		}
		if message["role"] == "user" && runtimeContentText(message["content"]) == state.Request.Prompt {
			originals++
		}
	}
	for _, event := range state.Events {
		if event.Type == "message_delta" && event.Payload["messageId"] == step2 && event.Payload["delta"] == "已恢复 🎬" {
			deltas++
		}
		if event.Type == "assistant_message" && event.Payload["messageId"] == step2 && event.Payload["text"] == "已恢复 🎬" {
			visibleAnswers++
		}
	}
	var steps int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", root.ID, cloudAgentStepOperation).Count(&steps).Error; err != nil {
		t.Fatal(err)
	}
	if run.Status != "completed" || steps != 2 || receipts != 1 || originals != 1 || deltas != 1 || visibleAnswers != 1 {
		t.Fatalf("status=%s steps=%d receipts=%d originalUserPrompts=%d batches=%d visibleAnswers=%d", run.Status, steps, receipts, originals, deltas, visibleAnswers)
	}
}
