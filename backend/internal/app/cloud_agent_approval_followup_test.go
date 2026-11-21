package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// approvalFollowUpFixture 准备一轮停在审批上的画布写入：模型请求把节点改名，等待用户批准。
// 数据只写临时数据库，不启动 Pi、不调用收费模型。
func approvalFollowUpFixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	db := agentPermissionsDB(t)
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db), dataDir: t.TempDir(), disablePiRuntime: true}
	t.Cleanup(s.closeCloudAgentApprovalFollowUps)
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{"nodes": []any{map[string]any{"id": "story", "type": "text", "title": "原标题", "content": "正文"}}, "connections": []any{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	profile := mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel("chat-completion", "text-test"))
	for _, row := range []any{
		&model.User{ID: "user", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)},
		&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Name: "测试", Enabled: true},
		&model.ChannelModel{ID: "cm", ChannelID: "channel", ModelKey: "text-test", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: profile, BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.CreditAccount{UserID: "user", AvailableMicrocredits: 10000},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	call := cloudAgentCall{ID: "rename-story"}
	call.Function.Name = "canvas_apply_ops"
	args, err := json.Marshal(map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "ops": []any{map[string]any{"type": "update_node", "id": "story", "patch": map[string]any{"title": "新标题"}}}})
	if err != nil {
		t.Fatal(err)
	}
	call.Function.Arguments = string(args)
	state.Calls = []cloudAgentCall{call}
	state.CallIndex = 0
	run.Status = "running"
	approvalPauseSaveState(t, s, db, run, &state)
	run, state = agentInterjectionState(t, s, root.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "waiting_approval" || state.Approval == nil {
		t.Fatalf("fixture did not pause for approval: status=%s", run.Status)
	}
	return s, root.ID, state.Approval.ID
}

func approvalFollowUpCanvas(t *testing.T, s *Service) (string, int64) {
	t.Helper()
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	title, _ := creationMaps(doc["nodes"])[0]["title"].(string)
	return title, canvas.Revision
}

func TestCloudAgentLateStopKeepsSettledRejectionAndCancellation(t *testing.T) {
	for _, terminal := range []string{"rejected", "cancelled"} {
		t.Run(terminal, func(t *testing.T) {
			s, runID, approvalID := approvalFollowUpFixture(t)
			if terminal == "rejected" {
				if err := s.DecideCloudAgentApproval("user", runID, approvalID, "reject", ""); err != nil {
					t.Fatal(err)
				}
			} else if err := s.CancelCloudAgent(context.Background(), "user", runID); err != nil {
				t.Fatal(err)
			}
			before, err := s.CloudAgentRun("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			if before.Status != terminal || before.CleanupPending {
				t.Fatalf("not settled: %s/%v", before.Status, before.CleanupPending)
			}
			if terminal == "cancelled" {
				var conflict *AppError
				if decisionErr := s.DecideCloudAgentApproval("user", runID, approvalID, "reject", ""); !errors.As(decisionErr, &conflict) || conflict.Status != 409 {
					t.Fatalf("late approval must not rewrite a cancelled run: %v", decisionErr)
				}
			}
			if err := s.CancelCloudAgent(context.Background(), "user", runID); err != nil {
				t.Fatal(err)
			}
			after, err := s.CloudAgentRun("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			if after.Status != before.Status || after.Revision != before.Revision || after.EventCount != before.EventCount || after.CleanupPending {
				t.Fatalf("late stop rewrote %s: %s/rev%d/events%d → %s/rev%d/events%d", terminal, before.Status, before.Revision, before.EventCount, after.Status, after.Revision, after.EventCount)
			}
		})
	}
}

func TestCloudAgentApprovalReasonCodePoints(t *testing.T) {
	for _, char := range []string{"a", "中", "🎬"} {
		t.Run(char, func(t *testing.T) {
			s, runID, approvalID := approvalFollowUpFixture(t)
			reason := strings.Repeat(char, 2000)
			if err := s.DecideCloudAgentApproval("user", runID, approvalID, "reject", reason+char); err == nil {
				t.Fatal("accepted 2001 characters")
			}
			if err := s.DecideCloudAgentApproval("user", runID, approvalID, "reject", reason); err != nil {
				t.Fatal(err)
			}
			run, err := s.CloudAgentRun("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range run.Events {
				if event.Type == "approval_decided" && event.Payload["reason"] == reason {
					return
				}
			}
			t.Fatal("approval lost the original reason")
		})
	}
}

func TestCloudAgentLateStopRepairsUnmarkedLegacyChild(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	child := model.Task{ID: "orphan-during-stop", UserID: "user", ProjectID: "agent-canvas", Type: "canvas_text", Status: model.TaskStatusQueued}
	if err := db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = child.ID
	state.TaskIDs = append(state.TaskIDs, child.ID)
	if err := s.repo.MutateCloudAgent("user", root.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Update("status", model.TaskStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": "cancelled", "cleanup_pending": false, "active_task_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	updated, err := s.repo.TaskForUser("user", child.ID)
	if err != nil || updated.Status != model.TaskStatusCancelled {
		t.Fatalf("unmarked child remains %s: %v", updated.Status, err)
	}
	before, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	after, err := s.repo.CloudAgent("user", root.ID)
	if err != nil || after.Revision != before.Revision || after.CleanupPending {
		t.Fatal("replayed stop reopened completed cleanup", err)
	}
}

// 决定落库后、被批准的调用执行前，运行已经是 running。这段间隙里启动的 Pi 会话
// （恢复扫描、幂等重放）不能开一轮模型；决定请求还在收尾时只让出，请求在落库后
// 失败时由会话接手收尾，调用只执行一次并把结果交回 Pi。
func TestCloudAgentPiSessionYieldsApprovedCallToApprovalFollowUp(t *testing.T) {
	s, runID, approvalID := approvalFollowUpFixture(t)
	key := cloudAgentApprovalFollowUpKey(runID, approvalID)

	// 测试先占住收尾登记，模拟另一个决定请求正在收尾：本次决定只落库、不执行。
	if !s.claimCloudAgentApprovalFollowUp(key) {
		t.Fatal("follow-up claim was not available")
	}
	if err := s.DecideCloudAgentApproval("user", runID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, runID)
	if !cloudAgentApprovedCallPending(run, &state, approvalID) {
		t.Fatalf("decision without the follow-up claim executed the call: status=%s approval=%+v", run.Status, state.Approval)
	}

	if err := s.runCloudAgentPiSession(context.Background(), "user", runID); err != nil {
		t.Fatal(err)
	}
	s.approvalFollowUpWg.Wait()
	run, state = agentInterjectionState(t, s, runID)
	if !cloudAgentApprovedCallPending(run, &state, approvalID) || state.ActiveTaskID != "" {
		t.Fatalf("Pi session ran while the decision request owned the approval: status=%s activeTask=%q", run.Status, state.ActiveTaskID)
	}
	if title, revision := approvalFollowUpCanvas(t, s); title != "原标题" || revision != 1 {
		t.Fatalf("canvas changed before the approved call was executed: title=%q revision=%d", title, revision)
	}

	// 决定请求在落库后退出（收尾失败或进程重启）：下一个 Pi 会话接手收尾。
	s.releaseCloudAgentApprovalFollowUp(key)
	if err := s.runCloudAgentPiSession(context.Background(), "user", runID); err != nil {
		t.Fatal(err)
	}
	s.approvalFollowUpWg.Wait()
	run, state = agentInterjectionState(t, s, runID)
	if run.Status != "running" || state.Approval != nil || state.CallIndex != 1 || state.ActiveTaskID != "" {
		t.Fatalf("follow-up did not execute the approved call once: status=%s approval=%+v callIndex=%d activeTask=%q", run.Status, state.Approval, state.CallIndex, state.ActiveTaskID)
	}
	if state.PiResumePrompt == "" {
		t.Fatal("follow-up did not hand the approved result back to Pi")
	}
	if title, revision := approvalFollowUpCanvas(t, s); title != "新标题" || revision != 2 {
		t.Fatalf("approved canvas write missing: title=%q revision=%d", title, revision)
	}

	// 调用已执行：再次收尾与重送同一决定都不能再写画布。
	if err := s.continueApprovedCloudAgentCall("user", runID, approvalID); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", runID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if _, revision := approvalFollowUpCanvas(t, s); revision != 2 {
		t.Fatalf("approved call executed twice: canvas revision=%d", revision)
	}
}

// 关闭后不再接手新的收尾，未执行的审批留给下次启动。
func TestCloudAgentApprovalFollowUpStopsAfterClose(t *testing.T) {
	s, runID, approvalID := approvalFollowUpFixture(t)
	key := cloudAgentApprovalFollowUpKey(runID, approvalID)
	if !s.claimCloudAgentApprovalFollowUp(key) {
		t.Fatal("follow-up claim was not available")
	}
	if err := s.DecideCloudAgentApproval("user", runID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	s.releaseCloudAgentApprovalFollowUp(key)
	s.closeCloudAgentApprovalFollowUps()

	s.startCloudAgentApprovalFollowUp("user", runID, approvalID)
	s.approvalFollowUpWg.Wait()
	run, state := agentInterjectionState(t, s, runID)
	if !cloudAgentApprovedCallPending(run, &state, approvalID) {
		t.Fatalf("closed service still executed the approved call: status=%s", run.Status)
	}
}
