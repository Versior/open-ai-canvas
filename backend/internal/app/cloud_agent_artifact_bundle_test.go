package app

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func testCloudAgentArtifactBundle(t *testing.T, id, userID, canvasID, runID string, now time.Time) domainmcp.ArtifactBundle {
	t.Helper()
	bundle, err := domainmcp.NewArtifactBundle(id, userID, canvasID, runID, "commerce.product_analysis", domainmcp.Result{
		Summary: "已生成商品分析报告",
		Artifacts: []domainmcp.Artifact{{
			Type:  domainmcp.ArtifactRecipe,
			Title: "商品分析画布",
			Content: domainmcp.CanvasRecipe{Layout: "columns", Nodes: []domainmcp.CanvasRecipeNode{
				{Key: "report", Type: domainmcp.ArtifactCommerceProductReport, Title: "商品分析", Content: "## 已验证事实\n- 材质：棉", Column: 0, Row: 0},
				{Key: "actions", Type: domainmcp.ArtifactText, Title: "下一步", Content: "补充价格带证据", Column: 1, Row: 0},
			}},
		}},
	}, now, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return bundle
}

func TestCloudAgentArtifactBundleToolFollowsCanvasWritePermissions(t *testing.T) {
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	if !cloudAgentToolAllowed(req, "canvas_apply_artifact_bundle") || !cloudAgentWrite("canvas_apply_artifact_bundle") {
		t.Fatal("Artifact Bundle apply tool should be an approval-aware canvas write")
	}
	req.PermissionMode = "read_only"
	if cloudAgentToolAllowed(req, "canvas_apply_artifact_bundle") {
		t.Fatal("read-only Agent exposed Artifact Bundle write tool")
	}
}

func TestValidateCloudAgentArtifactBundlesRejectsCrossScopeState(t *testing.T) {
	now := time.Now().UTC()
	run := &model.CloudAgentExecution{ID: "run-a", UserID: "user-a"}
	state := &cloudAgentRuntime{
		RuntimeRunID: "run-a",
		Request:      CloudAgentRequest{CanvasID: "canvas-a"},
		ArtifactBundles: map[string]domainmcp.ArtifactBundle{
			"bundle-a": testCloudAgentArtifactBundle(t, "bundle-a", "user-b", "canvas-a", "run-a", now),
		},
	}
	if err := validateCloudAgentArtifactBundles(run, state); err == nil {
		t.Fatal("cross-user Artifact Bundle survived runtime validation")
	}
	state.ArtifactBundles["bundle-a"] = testCloudAgentArtifactBundle(t, "bundle-a", "user-a", "canvas-a", "run-b", now)
	if err := validateCloudAgentArtifactBundles(run, state); err == nil {
		t.Fatal("cross-run Artifact Bundle survived runtime validation")
	}
}

func TestPrepareCloudAgentArtifactBundlePinsCanvasSnapshotAndRejectsExpiry(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	state := cloudAgentRuntime{RuntimeRunID: "run-a", Request: CloudAgentRequest{CanvasID: canvas.ID}}
	state.ArtifactBundles = map[string]domainmcp.ArtifactBundle{
		"bundle-a": testCloudAgentArtifactBundle(t, "bundle-a", "user", canvas.ID, "run-a", now),
	}
	call := cloudAgentCall{ID: "bundle-call"}
	call.Function.Name = "canvas_apply_artifact_bundle"
	call.Function.Arguments = `{"bundleId":"bundle-a"}`
	plan, err := prepareCloudAgentArtifactBundleMutation(s.repo, "user", canvas.ID, "run-a", &state, call, now)
	if err != nil {
		t.Fatal(err)
	}
	if plan.CanvasPlan == nil || len(plan.CanvasPlan.Args.Ops) != 2 || plan.Preview.Kind == "" {
		t.Fatalf("bundle was not compiled through the canvas planner: %+v", plan)
	}
	var pinned cloudAgentArtifactBundleArgs
	if err := json.Unmarshal([]byte(plan.Call.Function.Arguments), &pinned); err != nil {
		t.Fatal(err)
	}
	if pinned.BundleID != "bundle-a" || pinned.SnapshotHash == "" {
		t.Fatalf("approval call did not pin the canvas snapshot: %+v", pinned)
	}

	expired := testCloudAgentArtifactBundle(t, "expired", "user", canvas.ID, "run-a", now.Add(-2*time.Hour))
	state.ArtifactBundles["expired"] = expired
	call.Function.Arguments = `{"bundleId":"expired"}`
	if _, err := prepareCloudAgentArtifactBundleMutation(s.repo, "user", canvas.ID, "run-a", &state, call, now); !errors.Is(err, domainmcp.ErrPolicyBlocked) {
		t.Fatalf("expired bundle should be policy-blocked, got %v", err)
	}
}

func TestApplyCloudAgentArtifactBundleIsAtomicAndUndoable(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CloudAgentRun("user", run.ID); err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	state.ArtifactBundles = map[string]domainmcp.ArtifactBundle{
		"bundle-a": testCloudAgentArtifactBundle(t, "bundle-a", "user", canvas.ID, run.ID, now),
	}
	call := cloudAgentCall{ID: "bundle-call"}
	call.Function.Name = "canvas_apply_artifact_bundle"
	call.Function.Arguments = `{"bundleId":"bundle-a"}`
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	var result any
	if err := s.repo.MutateCloudAgent("user", run.ID, execution.Revision, func(_ *model.CloudAgentExecution, repo *repository.Repository) error {
		result, err = applyCloudAgentArtifactBundle(repo, "user", canvas.ID, run.ID, &state, call, policy, now, cloudAgentMutationRecorderForRun(run.ID))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	fields, ok := result.(map[string]any)
	if !ok || fields["snapshotHash"] == "" || fields["bundleId"] != "bundle-a" {
		t.Fatalf("unexpected apply result: %#v", result)
	}
	mutated, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(mutated.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	if nodes := creationMaps(doc["nodes"]); len(nodes) != 2 {
		t.Fatalf("bundle should create two nodes in one write, got %d", len(nodes))
	}
	mutation, err := s.repo.LatestCloudAgentCanvasMutation("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mutation.Operation != "canvas_apply_artifact_bundle" || mutation.StepID != call.ID {
		t.Fatalf("bundle did not create one dedicated undo record: %+v", mutation)
	}
	undo, err := s.UndoCloudAgentCanvas("user", run.ID, call.ID, fields["snapshotHash"].(string), "撤销能力包结果")
	if err != nil || undo["accepted"] != true {
		t.Fatalf("bundle mutation was not undoable: result=%+v err=%v", undo, err)
	}
	restored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.PayloadJSON != canvas.PayloadJSON {
		t.Fatal("undo did not restore the exact pre-bundle canvas")
	}
}
