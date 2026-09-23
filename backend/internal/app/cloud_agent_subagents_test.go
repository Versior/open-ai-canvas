package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentSubagentBudgetControlsToolAvailability(t *testing.T) {
	req := agentTestRequest()
	if canonicalHasTool(cloudAgentCanonical("system", nil, req.Prompt, req), "delegate_task") {
		t.Fatal("delegate_task should be absent when maxSubagents is zero")
	}
	req.Budget.MaxSubagents = 3
	if !canonicalHasTool(cloudAgentCanonical("system", nil, req.Prompt, req), "delegate_task") {
		t.Fatal("delegate_task missing when subagent budget is enabled")
	}
	req.Budget.MaxSubagents = 9
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("maxSubagents above limit accepted")
	}
}

func TestCloudAgentSubagentOutputIsBoundedBeforeParentInjection(t *testing.T) {
	text, truncated := cloudAgentSubagentOutput(strings.Repeat("界", cloudAgentSubagentOutputRunes+1))
	if !truncated || len([]rune(text)) != cloudAgentSubagentOutputRunes {
		t.Fatalf("bounded output: runes=%d truncated=%v", len([]rune(text)), truncated)
	}
}

func TestCloudAgentDelegationRunsAsDurableReadOnlyTaskAndReturnsResult(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.Budget.MaxSubagents = 1
	req.IdempotencyKey = "subagent-success"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	arguments := `{"role":"continuity_reviewer","task":"检查镜头连续性","context":"镜头1白衣，镜头2黑衣","expectedOutput":"列出问题和修改建议"}`
	call := cloudAgentCall{ID: "delegate-1"}
	call.Function.Name = "delegate_task"
	call.Function.Arguments = arguments
	markAgentTaskSucceededWithCalls(t, db, root.ID, []cloudAgentCall{call})
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	// The durable state machine first records the delegation, then creates the
	// child task in a separate transition so no provider/billing work is nested
	// inside the tool-result transaction.
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	execution, _ := s.repo.CloudAgent("user", root.ID)
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	if state.Delegation == nil || state.Delegation.TaskID == "" || state.Delegation.Role != "continuity_reviewer" {
		t.Fatalf("delegation = %#v", state.Delegation)
	}
	var child model.Task
	if err := db.First(&child, "id = ?", state.Delegation.TaskID).Error; err != nil {
		t.Fatal(err)
	}
	if child.Operation != "cloud_agent_subagent" || child.AgentRunID != root.ID {
		t.Fatalf("child task = %#v", child)
	}
	var input struct {
		AgentRequests struct {
			Canonical canonicalAgentRequest `json:"canonical"`
		} `json:"agentRequests"`
	}
	if err := json.Unmarshal([]byte(child.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.AgentRequests.Canonical.Tools) != 0 || input.AgentRequests.Canonical.ToolChoice != "none" {
		t.Fatalf("subagent received tools: %#v", input.AgentRequests.Canonical)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", child.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"服装颜色跨镜头不一致，应统一为白衣"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	execution, _ = s.repo.CloudAgent("user", root.ID)
	state, _ = cloudAgentDecode(execution)
	if state.Delegation != nil || state.SubagentsUsed != 1 || state.CallIndex != 1 {
		t.Fatalf("state after delegation = %#v", state)
	}
	last := state.Canonical.Messages[len(state.Canonical.Messages)-1]
	if last["role"] != "tool" || !stringsContain(last["content"], "服装颜色跨镜头不一致") {
		t.Fatalf("delegation result missing from model context: %#v", last)
	}
}

func TestCloudAgentDelegationFailureReturnsToolErrorWithoutFailingParent(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.Budget.MaxSubagents = 1
	req.IdempotencyKey = "subagent-failure"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	arguments := `{"role":"researcher","task":"整理参考信息","context":"已有资料","expectedOutput":"三条结论"}`
	call := cloudAgentCall{ID: "delegate-fail"}
	call.Function.Name = "delegate_task"
	call.Function.Arguments = arguments
	markAgentTaskSucceededWithCalls(t, db, root.ID, []cloudAgentCall{call})
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	execution, _ := s.repo.CloudAgent("user", root.ID)
	state, _ := cloudAgentDecode(execution)
	if state.Delegation == nil {
		t.Fatal("delegation not started")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", state.Delegation.TaskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "provider unavailable"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	execution, _ = s.repo.CloudAgent("user", root.ID)
	state, _ = cloudAgentDecode(execution)
	if execution.Status != "running" || state.Delegation != nil || state.CallIndex != 1 {
		t.Fatalf("parent should continue after child failure: run=%#v state=%#v", execution, state)
	}
	last := state.Canonical.Messages[len(state.Canonical.Messages)-1]
	if !stringsContain(last["content"], "工具执行失败") {
		t.Fatalf("failure not returned as tool result: %#v", last)
	}
	if len(state.Events) == 0 || state.Events[len(state.Events)-1].Type != "subagent_failed" || !stringsContain(state.Events[len(state.Events)-1].Payload["text"], "子智能体任务失败") {
		t.Fatalf("specific subagent failure event missing: %#v", state.Events)
	}
}

func TestCloudAgentCancellationCancelsActiveSubagent(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.Budget.MaxSubagents = 1
	req.IdempotencyKey = "subagent-cancel"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: "delegate-cancel"}
	call.Function.Name = "delegate_task"
	call.Function.Arguments = `{"role":"researcher","task":"整理参考信息","context":"已有资料","expectedOutput":"三条结论"}`
	markAgentTaskSucceededWithCalls(t, db, root.ID, []cloudAgentCall{call})
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	execution, _ := s.repo.CloudAgent("user", root.ID)
	state, _ := cloudAgentDecode(execution)
	if state.Delegation == nil || state.Delegation.TaskID == "" {
		t.Fatal("active subagent missing")
	}
	childID := state.Delegation.TaskID
	if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	child, err := s.repo.TaskForUser("user", childID)
	if err != nil {
		t.Fatal(err)
	}
	if child.Status != model.TaskStatusCancelled {
		t.Fatalf("subagent status = %s", child.Status)
	}
}

func markAgentTaskSucceededWithCalls(t *testing.T, db *gorm.DB, taskID string, calls []cloudAgentCall) {
	t.Helper()
	result, _ := json.Marshal(map[string]any{"toolCalls": calls})
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
}

func stringsContain(value any, fragment string) bool {
	text, _ := value.(string)
	return strings.Contains(text, fragment)
}
