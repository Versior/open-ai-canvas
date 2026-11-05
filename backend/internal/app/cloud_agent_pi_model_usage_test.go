package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type cloudAgentPiStepOutcome struct {
	result any
	err    error
}

// startCloudAgentPiStepForUsage 发起一次普通 Pi 模型步骤，返回已入队的步骤任务 ID 与结果通道。
func startCloudAgentPiStepForUsage(t *testing.T, s *Service, ctx context.Context, runID string) (string, <-chan cloudAgentPiStepOutcome) {
	t.Helper()
	payload := map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"user","content":"继续"}]`), "thinkingLevel": json.RawMessage(`"off"`)}
	done := make(chan cloudAgentPiStepOutcome, 1)
	go func() {
		result, err := s.cloudAgentPiModel(ctx, "user", runID, payload)
		done <- cloudAgentPiStepOutcome{result: result, err: err}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		stored, err := s.repo.CloudAgent("user", runID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(stored)
		if err != nil {
			t.Fatal(err)
		}
		if state.ActiveTaskID != "" {
			task, err := s.repo.TaskForUser("user", state.ActiveTaskID)
			if err != nil {
				t.Fatal(err)
			}
			if task.Operation == cloudAgentStepOperation {
				return state.ActiveTaskID, done
			}
		}
		select {
		case got := <-done:
			t.Fatalf("model bridge returned before scheduling: result=%v err=%v", got.result, got.err)
		case <-time.After(25 * time.Millisecond):
		}
	}
	t.Fatal("model step was never scheduled")
	return "", nil
}

// finishCloudAgentPiStepForUsage 把步骤任务标成成功并等模型桥接返回，返回最新运行状态。
func finishCloudAgentPiStepForUsage(t *testing.T, s *Service, db *gorm.DB, ctx context.Context, runID, taskID string, done <-chan cloudAgentPiStepOutcome, updates map[string]any) cloudAgentRuntime {
	t.Helper()
	updates["status"] = model.TaskStatusSucceeded
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(updates).Error; err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("model bridge failed: %v", got.err)
		}
	case <-ctx.Done():
		t.Fatal("model bridge did not return")
	}
	stored, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

// cloudAgentModelUsageEvent 返回该任务唯一的 model_usage 事件，并要求它排在同一任务的 assistant_message 之后。
func cloudAgentModelUsageEvent(t *testing.T, state cloudAgentRuntime, taskID string) map[string]any {
	t.Helper()
	assistantIndex, usageIndex, usageCount := -1, -1, 0
	for index, event := range state.Events {
		switch {
		case event.Type == "assistant_message" && stringField(event.Payload, "messageId") == taskID:
			assistantIndex = index
		case event.Type == "model_usage" && stringField(event.Payload, "taskId") == taskID:
			usageIndex = index
			usageCount++
		}
	}
	if usageCount != 1 {
		t.Fatalf("model_usage events for %s = %d, want 1: %#v", taskID, usageCount, state.Events)
	}
	if assistantIndex < 0 || usageIndex < assistantIndex {
		t.Fatalf("model_usage (index %d) must follow assistant_message (index %d)", usageIndex, assistantIndex)
	}
	return state.Events[usageIndex].Payload
}

func TestCloudAgentPiModelUsageSumsTaskAPICallLogs(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	taskID, done := startCloudAgentPiStepForUsage(t, s, ctx, root.ID)

	// 同一任务两次上游调用：先失败（无用量）再成功。耗时都计入，token 只取回传了用量的那次。
	startedAt := time.Now().Add(-10 * time.Second)
	for _, call := range []model.ApiCallLog{
		{ID: "usage-log-failed", UserID: "user", TaskID: taskID, Capability: "text", RequestKind: "create", Model: "text-test", Status: model.ApiCallStatusFailed, StatusCode: 502, DurationMs: 300, CreatedAt: startedAt},
		{ID: "usage-log-ok", UserID: "user", TaskID: taskID, Capability: "text", RequestKind: "create", Model: "text-test-upstream", Status: model.ApiCallStatusSucceeded, StatusCode: 200, DurationMs: 6800, InputTokens: 1200, OutputTokens: 483, CachedTokens: 900, UsageAvailable: true, CreatedAt: startedAt.Add(time.Second)},
		// 其他用户的同 ID 日志不能混进来。
		{ID: "usage-log-foreign", UserID: "other", TaskID: taskID, Capability: "text", RequestKind: "create", Model: "foreign", Status: model.ApiCallStatusSucceeded, DurationMs: 99999, InputTokens: 99999, UsageAvailable: true, CreatedAt: startedAt.Add(2 * time.Second)},
	} {
		if err := db.Create(&call).Error; err != nil {
			t.Fatal(err)
		}
	}

	state := finishCloudAgentPiStepForUsage(t, s, db, ctx, root.ID, taskID, done, map[string]any{"result_json": `{"text":"已完成分析","toolCalls":[]}`})
	payload := cloudAgentModelUsageEvent(t, state, taskID)
	want := map[string]any{"taskId": taskID, "model": "text-test-upstream", "inputTokens": float64(1200), "outputTokens": float64(483), "cachedTokens": float64(900), "usageAvailable": true, "durationMs": float64(7100)}
	for key, value := range want {
		if payload[key] != value {
			t.Fatalf("model_usage[%s] = %#v, want %#v (payload %#v)", key, payload[key], value, payload)
		}
	}
}

func TestCloudAgentPiModelUsageWithoutAPICallLogUsesTaskTimes(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	taskID, done := startCloudAgentPiStepForUsage(t, s, ctx, root.ID)

	completedAt := time.Now().Truncate(time.Millisecond)
	startedAt := completedAt.Add(-2500 * time.Millisecond)
	state := finishCloudAgentPiStepForUsage(t, s, db, ctx, root.ID, taskID, done, map[string]any{
		"result_json":  `{"text":"没有上游日志也能完成","toolCalls":[]}`,
		"started_at":   startedAt,
		"completed_at": completedAt,
	})
	payload := cloudAgentModelUsageEvent(t, state, taskID)
	if payload["usageAvailable"] != false || payload["inputTokens"] != float64(0) || payload["outputTokens"] != float64(0) {
		t.Fatalf("usage must be unavailable without API call logs: %#v", payload)
	}
	if payload["durationMs"] != float64(2500) {
		t.Fatalf("durationMs = %#v, want task duration 2500", payload["durationMs"])
	}
	if payload["model"] != "text-test" {
		t.Fatalf("model = %#v, want task model", payload["model"])
	}
}
