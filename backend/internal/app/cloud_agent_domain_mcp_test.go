package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/domainmcp/packs/commerce"
	"infinite-canvas/backend/internal/model"
)

type cloudAgentDomainMCPFixtureHandler struct {
	manifest domainmcp.ToolManifest
	result   domainmcp.Result
	input    json.RawMessage
}

func (h *cloudAgentDomainMCPFixtureHandler) Manifest() domainmcp.ToolManifest { return h.manifest }

func (h *cloudAgentDomainMCPFixtureHandler) Call(_ context.Context, input json.RawMessage) (domainmcp.Result, error) {
	h.input = append(json.RawMessage(nil), input...)
	return h.result, nil
}

func TestCloudAgentDomainMCPToolsExposeOnlyTheEnabledHubCatalog(t *testing.T) {
	svc, _, _, _ := creationTestService(t)
	fixture := installCloudAgentDomainMCPFixture(t, svc)
	state := &cloudAgentRuntime{Request: agentTestRequest()}
	run := &model.CloudAgentExecution{ID: "run-domain-list", UserID: "user"}

	call := cloudAgentCall{ID: "domain-list"}
	call.Function.Name = "domain_mcp_list_tools"
	call.Function.Arguments = `{}`
	result, err := svc.cloudAgentDomainMCPTool(context.Background(), run, state, call)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), commerce.ToolProductAnalyze) || strings.Contains(string(encoded), "commerce.competitor_compare") {
		t.Fatalf("list exposed tools outside the enabled Hub: %s", encoded)
	}
	if fixture.input != nil {
		t.Fatal("listing tools executed a provider handler")
	}

	canonical := cloudAgentCanonical("system", nil, state.Request.Prompt, state.Request)
	for _, name := range []string{"domain_mcp_list_tools", "domain_mcp_call"} {
		if !canonicalHasTool(canonical, name) {
			t.Fatalf("canonical tools missing %s", name)
		}
	}
	description := canonicalToolDescription(canonical, "domain_mcp_call")
	if !strings.Contains(description, "数据") || !strings.Contains(description, "指令") {
		t.Fatalf("domain tool description does not mark retrieved content as data: %q", description)
	}
}

func TestCloudAgentDomainMCPCallStoresScopedBundleWithoutTranscriptPayload(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	fixture := installCloudAgentDomainMCPFixture(t, svc)
	state := &cloudAgentRuntime{Request: agentTestRequest(), Events: []CloudAgentEvent{}, Canonical: canonicalAgentRequest{Messages: []map[string]any{}}}
	run := &model.CloudAgentExecution{ID: "run-domain-call", UserID: "user"}
	call := cloudAgentCall{ID: "domain-call"}
	call.Function.Name = "domain_mcp_call"
	call.Function.Arguments = `{"toolName":"commerce.product_analyze","arguments":{"productName":"防晒衣"}}`

	result, err := svc.cloudAgentDomainMCPTool(context.Background(), run, state, call)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if !strings.Contains(string(encoded), `"bundleId"`) || !strings.Contains(string(encoded), `"evidenceIds"`) || !strings.Contains(string(encoded), `"sources"`) {
		t.Fatalf("model-facing result lost bundle or evidence links: %s", encoded)
	}
	if strings.Contains(string(encoded), "ARTIFACT-PAYLOAD-MUST-STAY-OUT-OF-TRANSCRIPT") || strings.Contains(string(encoded), `"artifacts"`) {
		t.Fatalf("artifact payload leaked into model-facing result: %s", encoded)
	}
	if string(fixture.input) != `{"productName":"防晒衣"}` {
		t.Fatalf("hub received wrong input: %s", fixture.input)
	}
	if len(state.ArtifactBundles) != 1 {
		t.Fatalf("bundle not stored in checkpoint: %#v", state.ArtifactBundles)
	}
	var bundleID string
	for id, bundle := range state.ArtifactBundles {
		bundleID = id
		if err := bundle.ValidateScope("user", "agent-canvas", run.ID); err != nil {
			t.Fatalf("bundle scope = %+v: %v", bundle, err)
		}
		stored, _ := json.Marshal(bundle.Artifacts)
		if !strings.Contains(string(stored), "ARTIFACT-PAYLOAD-MUST-STAY-OUT-OF-TRANSCRIPT") {
			t.Fatalf("checkpoint lost full artifact payload: %s", stored)
		}
	}

	cloudAgentToolResult(run.ID, state, call, result, nil)
	transcript, _ := json.Marshal(state.Canonical.Messages)
	events, _ := json.Marshal(state.Events)
	if strings.Contains(string(transcript), "ARTIFACT-PAYLOAD-MUST-STAY-OUT-OF-TRANSCRIPT") || strings.Contains(string(events), "ARTIFACT-PAYLOAD-MUST-STAY-OUT-OF-TRANSCRIPT") {
		t.Fatalf("artifact payload leaked into transcript or event: transcript=%s events=%s", transcript, events)
	}

	apply := cloudAgentCall{ID: "cross-run-apply"}
	apply.Function.Name = "canvas_apply_artifact_bundle"
	apply.Function.Arguments = `{"bundleId":"` + bundleID + `"}`
	if _, err := prepareCloudAgentArtifactBundleMutation(svc.repo, "user", "agent-canvas", "another-run", state, apply, time.Now().UTC()); !errors.Is(err, domainmcp.ErrPolicyBlocked) {
		t.Fatalf("cross-run bundle apply should be policy-blocked, got %v", err)
	}
}

func TestCloudAgentDomainMCPBundleApplyUsesExistingApprovalFlow(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	installCloudAgentDomainMCPFixture(t, svc)
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	req.IdempotencyKey = "domain-bundle-approval"
	created, err := svc.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := svc.repo.CloudAgent("user", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.RuntimeRunID = run.ID
	domainCall := cloudAgentCall{ID: "domain-call"}
	domainCall.Function.Name = "domain_mcp_call"
	domainCall.Function.Arguments = `{"toolName":"commerce.product_analyze","arguments":{"productName":"防晒衣"}}`
	domainResult, err := svc.cloudAgentDomainMCPTool(context.Background(), run, &state, domainCall)
	if err != nil {
		t.Fatal(err)
	}
	fields, _ := domainResult.(map[string]any)
	bundleID, _ := fields["bundleId"].(string)
	if bundleID == "" {
		t.Fatalf("domain result missing bundle: %#v", domainResult)
	}

	apply := cloudAgentCall{ID: "bundle-apply"}
	apply.Function.Name = "canvas_apply_artifact_bundle"
	apply.Function.Arguments = `{"bundleId":"` + bundleID + `"}`
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{apply}
	state.CallIndex = 0
	if err := svc.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	reloaded, err := svc.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	reloadedState, err := cloudAgentDecode(reloaded)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Status != "waiting_approval" || reloadedState.Approval == nil || reloadedState.Approval.Preview.Kind != "artifact_bundle" {
		t.Fatalf("bundle apply bypassed approval: status=%s approval=%#v", reloaded.Status, reloadedState.Approval)
	}
}

func installCloudAgentDomainMCPFixture(t *testing.T, svc *Service) *cloudAgentDomainMCPFixtureHandler {
	t.Helper()
	catalog, err := domainmcp.NewCatalog(domainmcp.BuiltinPacks()...)
	if err != nil {
		t.Fatal(err)
	}
	manifest := commerce.ProductInsightManifest().Tools[0]
	now := time.Now().UTC()
	fixture := &cloudAgentDomainMCPFixtureHandler{manifest: manifest, result: domainmcp.Result{
		Summary:  "已生成防晒衣商品洞察",
		Findings: []domainmcp.Finding{{Title: "轻薄需求", Detail: "公开资料显示用户关注轻薄与防晒场景", Confidence: 0.8, EvidenceIDs: []string{"source-1"}, External: true}},
		Sources:  []domainmcp.Evidence{{ID: "source-1", Title: "公开商品资料", URL: "https://example.com/product", Snippet: "用户关注轻薄与防晒", Provider: "fixture", RetrievedAt: now}},
		Artifacts: []domainmcp.Artifact{
			{Type: domainmcp.ArtifactCommerceProductReport, Title: "完整商品报告", Content: "ARTIFACT-PAYLOAD-MUST-STAY-OUT-OF-TRANSCRIPT"},
			{Type: domainmcp.ArtifactRecipe, Title: "商品洞察画布", Content: domainmcp.CanvasRecipe{Layout: "columns", Nodes: []domainmcp.CanvasRecipeNode{{Key: "report", Type: domainmcp.ArtifactCommerceProductReport, Title: "防晒衣商品洞察", Content: "ARTIFACT-PAYLOAD-MUST-STAY-OUT-OF-TRANSCRIPT", Column: 0, Row: 0}}}},
		},
		Warnings:    []string{"公网信号不等于平台官方榜单"},
		NextActions: []string{"核验商品检测报告"},
	}}
	hub, err := domainmcp.NewHub(catalog, []domainmcp.Installation{{PackID: commerce.PackIDProductInsight, Enabled: true, AllowedTools: []string{commerce.ToolProductAnalyze}}}, fixture)
	if err != nil {
		t.Fatal(err)
	}
	svc.swapDomainMCPRuntime(&domainMCPRuntimeSnapshot{Hub: hub, Connections: map[string]domainMCPConnectionRuntime{}}, nil)
	return fixture
}

func canonicalToolDescription(request canonicalAgentRequest, name string) string {
	for _, item := range request.Tools {
		function, _ := item["function"].(map[string]any)
		if function["name"] == name {
			text, _ := function["description"].(string)
			return text
		}
	}
	return ""
}
