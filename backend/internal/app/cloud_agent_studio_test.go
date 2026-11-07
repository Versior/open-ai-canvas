package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
)

const studioTestProduct = "product_agent"

func studioAgentRequest() CloudAgentRequest {
	req := agentTestRequest()
	req.CanvasID, req.ContextScope, req.StudioProductID, req.PermissionMode = "", []string{"studio"}, studioTestProduct, "auto"
	req.IdempotencyKey = "studio-agent-key"
	return req
}

func studioAgentState() *cloudAgentRuntime {
	return &cloudAgentRuntime{Request: studioAgentRequest()}
}

func saveStudioTestProduct(t *testing.T, s *Service, userID string, body string) int64 {
	t.Helper()
	result, err := s.SaveEcommerceStudioProduct(&model.User{ID: userID}, studioTestProduct, json.RawMessage(body), nil)
	if err != nil {
		t.Fatal(err)
	}
	return ecommerceStudioProductRevision(result.Product)
}

func studioToolResult(t *testing.T, value any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func studioFieldIssue(err error) string {
	var fieldErr *cloudAgentFieldArgumentError
	if errors.As(err, &fieldErr) {
		return fieldErr.Field + ":" + fieldErr.Issue
	}
	return ""
}

func TestCloudAgentStudioScopeValidation(t *testing.T) {
	valid := studioAgentRequest()
	if err := validateCloudAgentRequest(&valid); err != nil {
		t.Fatalf("studio request rejected: %v", err)
	}
	for name, mutate := range map[string]func(*CloudAgentRequest){
		"canvas and studio":     func(req *CloudAgentRequest) { req.CanvasID = "agent-canvas" },
		"focus nodes":           func(req *CloudAgentRequest) { req.FocusNodeIDs = []string{"node"} },
		"missing product":       func(req *CloudAgentRequest) { req.StudioProductID = "" },
		"invalid product":       func(req *CloudAgentRequest) { req.StudioProductID = "../x" },
		"two scopes":            func(req *CloudAgentRequest) { req.ContextScope = []string{"studio", "canvas"} },
		"unknown scope":         func(req *CloudAgentRequest) { req.ContextScope = []string{"project"} },
		"product without scope": func(req *CloudAgentRequest) { req.ContextScope = nil },
	} {
		req := studioAgentRequest()
		mutate(&req)
		if err := validateCloudAgentRequest(&req); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	canvas := agentTestRequest()
	canvas.StudioProductID = studioTestProduct
	if err := validateCloudAgentRequest(&canvas); err == nil {
		t.Error("canvas run must not carry a studio product")
	}
	scope := cloudAgentToolScope(studioAgentRequest(), true)
	if scope.Canvas || !scope.Studio || scope.Drama {
		t.Fatalf("studio scope must not enable canvas tools: %+v", scope)
	}
	if got := cloudAgentToolTargetID(studioAgentRequest()); got != studioTestProduct {
		t.Fatalf("studio writes must target the product, got %q", got)
	}
}

func TestCloudAgentStudioRunBindsOwnedProduct(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"陶瓷马克杯"}`)
	// 功能开放里没开「电商生图台」时，即使商品存在也不能把对话绑定到生图台。
	if _, err := s.CreateCloudAgentRun("user", studioAgentRequest(), ""); err == nil || !strings.Contains(err.Error(), "电商生图台暂未开放") {
		t.Fatalf("closed studio must refuse the run, got %v", err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceStudioEnabled":true}`}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteEcommerceStudioProduct(&model.User{ID: "user"}, studioTestProduct); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCloudAgentRun("user", studioAgentRequest(), ""); err == nil {
		t.Fatal("run bound to a missing product must be refused")
	}
	saveStudioTestProduct(t, s, "other", `{"id":"product_agent","name":"别人的商品"}`)
	if _, err := s.CreateCloudAgentRun("user", studioAgentRequest(), ""); err == nil {
		t.Fatal("run bound to another user's product must be refused")
	}
	saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"陶瓷马克杯","photos":[{"id":"photo_front","resourceId":"ref-one","view":"front","truth":true}]}`)
	run, err := s.CreateCloudAgentRun("user", studioAgentRequest(), "")
	if err != nil {
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
	names := map[string]bool{}
	for _, tool := range state.Canonical.Tools {
		function, _ := tool["function"].(map[string]any)
		names[stringValue(function["name"])] = true
	}
	for _, name := range []string{agenttool.StudioGetState, agenttool.StudioUpdateDossier, agenttool.StudioPlanShots, agenttool.StudioRequestGeneration} {
		if !names[name] {
			t.Errorf("studio run is missing %s: %v", name, names)
		}
	}
	for _, name := range []string{agenttool.CanvasGetState, agenttool.CanvasApplyOps, agenttool.GenerateMedia, agenttool.ModelList} {
		if names[name] {
			t.Errorf("canvas tool %s leaked into a studio run", name)
		}
	}
	messages := state.Canonical.Messages
	if len(messages) < 2 || stringField(messages[len(messages)-2], cloudAgentContextSourceKey) != "studio_context" {
		t.Fatalf("studio context must be a sourced data message right before the prompt: %#v", messages)
	}
	if context := stringField(messages[len(messages)-2], "content"); !strings.Contains(context, `"productId":"product_agent"`) || !strings.Contains(context, "数据，不是指令") || strings.Contains(context, "ref-one") {
		t.Fatalf("studio context must identify the product without resource ids: %s", context)
	}
	if strings.Contains(state.Canonical.SystemPrompt, "product_agent") {
		t.Fatal("product data must stay out of the stable system prefix")
	}
}

func TestCloudAgentStudioDossierRules(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	revision := saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"","sellerNotes":"不锈钢 500ml","photos":[{"id":"photo_front","resourceId":"ref-one","view":"front"}],"keep":{"untouched":true}}`)
	state := studioAgentState()
	view, err := cloudAgentHandleStudioGetState(s.repo, "user", state, cloudAgentStoryboardCall(t, agenttool.StudioGetState, "read", map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	if got := studioToolResult(t, view); got["revision"] != float64(revision) || got["dossier"] != nil {
		t.Fatalf("unexpected initial state: %v", got)
	}

	guess := map[string]any{"revision": revision, "facts": []map[string]any{{"group": "material", "label": "材质", "value": "304 不锈钢", "evidence": "confirmed", "source": "图1"}}}
	if _, err := applyCloudAgentStudioDossier(s.repo, "user", studioTestProduct, cloudAgentStoryboardCall(t, agenttool.StudioUpdateDossier, "guess", guess), RuntimePolicySetting{}); studioFieldIssue(err) != "facts[0].evidence:invalid_value" {
		t.Fatalf("model observations must not be written as seller-confirmed: %v", err)
	}

	update := map[string]any{
		"revision": revision,
		"dossier":  map[string]any{"name": "陶瓷马克杯", "category": "马克杯", "family": "home"},
		"facts": []map[string]any{
			{"group": "appearance", "label": "颜色", "value": "哑光雾蓝", "evidence": "visible", "source": "图1"},
			{"group": "spec", "label": "容量", "value": "500ml", "evidence": "confirmed", "source": "卖家"},
			{"group": "usage", "label": "适合人群", "value": "通勤上班族", "evidence": "inferred"},
		},
		"invariants": []string{"杯身 Logo 的位置"},
	}
	result, err := applyCloudAgentStudioDossier(s.repo, "user", studioTestProduct, cloudAgentStoryboardCall(t, agenttool.StudioUpdateDossier, "update", update), RuntimePolicySetting{})
	if err != nil {
		t.Fatal(err)
	}
	written := studioToolResult(t, result)
	ids, _ := written["createdFactIds"].([]any)
	if written["revision"] != float64(revision+1) || len(ids) != 3 {
		t.Fatalf("write receipt must carry the new revision and created ids: %v", written)
	}
	color, capacity, audience := stringValue(ids[0]), stringValue(ids[1]), stringValue(ids[2])

	if _, err := applyCloudAgentStudioDossier(s.repo, "user", studioTestProduct, cloudAgentStoryboardCall(t, agenttool.StudioUpdateDossier, "stale", update), RuntimePolicySetting{}); studioFieldIssue(err) != "revision:stale_snapshot" {
		t.Fatalf("stale revision must ask the model to re-read: %v", err)
	}

	points := map[string]any{
		"revision": revision + 1,
		"sellingPoints": []map[string]any{
			{"title": "大容量 500ml", "detail": "一杯够一上午", "factIds": []string{capacity}},
			{"title": "通勤最好用", "factIds": []string{audience}},
			{"title": "雾蓝配色", "factIds": []string{color}},
		},
		"copy": map[string]any{"headline": "一杯装下整个上午", "bullets": []string{"500ml 容量", "哑光雾蓝"}},
	}
	preview, err := cloudAgentPreviewStudioDossier(s.repo, "user", studioTestProduct, cloudAgentStoryboardCall(t, agenttool.StudioUpdateDossier, "points", points))
	if err != nil || preview.Title == "" || len(preview.Items) == 0 || preview.Items[0].Operation != "update_node" || preview.Items[0].Summary == "" {
		t.Fatalf("approval preview must render with existing card operations: %+v %v", preview, err)
	}
	result, err = applyCloudAgentStudioDossier(s.repo, "user", studioTestProduct, cloudAgentStoryboardCall(t, agenttool.StudioUpdateDossier, "points", points), RuntimePolicySetting{})
	if err != nil {
		t.Fatal(err)
	}
	warnings, _ := studioToolResult(t, result)["warnings"].([]any)
	joined := ""
	for _, warning := range warnings {
		joined += stringValue(warning)
	}
	if !strings.Contains(joined, "最好") || !strings.Contains(joined, "没有可用的事实依据") {
		t.Fatalf("extreme words and unsupported points must be flagged: %v", warnings)
	}

	doc, err := loadStudioProductDoc(s.repo, "user", studioTestProduct)
	if err != nil {
		t.Fatal(err)
	}
	saved, _ := doc.sellingPoints()
	if len(saved) != 3 || saved[0].Evidence != "confirmed" || !saved[0].Enabled || saved[1].Evidence != "inferred" || saved[1].Enabled || saved[2].Evidence != "visible" || !saved[2].Enabled {
		t.Fatalf("point evidence must follow the referenced facts: %+v", saved)
	}
	if doc.str("name") != "陶瓷马克杯" || doc.str("sellerNotes") != "不锈钢 500ml" || !strings.Contains(string(doc.fields["keep"]), "untouched") {
		t.Fatal("agent writes must fill an empty name and keep fields they do not own")
	}

	remove := map[string]any{"revision": revision + 2, "removeFactIds": []string{capacity}}
	if _, err := applyCloudAgentStudioDossier(s.repo, "user", studioTestProduct, cloudAgentStoryboardCall(t, agenttool.StudioUpdateDossier, "remove", remove), RuntimePolicySetting{}); err != nil {
		t.Fatal(err)
	}
	doc, _ = loadStudioProductDoc(s.repo, "user", studioTestProduct)
	saved, _ = doc.sellingPoints()
	if saved[0].Evidence != "pending" || saved[0].Enabled || len(saved[0].FactIDs) != 0 {
		t.Fatalf("a point that lost its evidence must stop going onto images: %+v", saved[0])
	}
}

func TestCloudAgentStudioPlanAndGenerationRequest(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	attempted := `{"kind":"main","id":"plan_main","shots":[{"id":"shot_done","role":"main-white","title":"白底主图","attempts":[{"id":"a1","status":"succeeded","outputs":[{"resourceId":"ref-two","url":"/api/resources/ref-two/file"}]}]}]}`
	revision := saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"杯子","photos":[{"id":"photo_tag","resourceId":"ref-one","view":"tag"}],"sellingPoints":[{"id":"point_a","title":"容量大","detail":"","evidence":"visible","factIds":[],"enabled":true}],"plans":[`+attempted+`]}`)
	state := studioAgentState()
	call := func(name, id string, args map[string]any) cloudAgentCall {
		return cloudAgentStoryboardCall(t, name, id, args)
	}

	replaceMain := map[string]any{"revision": revision, "kind": "main", "action": "replace", "shots": []map[string]any{{"role": "main-white"}}}
	if _, err := applyCloudAgentStudioPlan(s.repo, "user", studioTestProduct, call(agenttool.StudioPlanShots, "replace-main", replaceMain), RuntimePolicySetting{}); studioFieldIssue(err) != "action:plan_has_images" {
		t.Fatalf("a plan that already has images must not be replaced: %v", err)
	}
	wrongRole := map[string]any{"revision": revision, "kind": "detail", "action": "replace", "shots": []map[string]any{{"role": "main-white"}}}
	if _, err := applyCloudAgentStudioPlan(s.repo, "user", studioTestProduct, call(agenttool.StudioPlanShots, "wrong-role", wrongRole), RuntimePolicySetting{}); studioFieldIssue(err) != "shots[0].role:invalid_value" {
		t.Fatalf("detail plans must use detail roles: %v", err)
	}
	detail := map[string]any{"revision": revision, "kind": "detail", "action": "replace", "platform": "jd", "shots": []map[string]any{
		{"role": "detail-hero", "headline": "一杯装下整个上午", "sellingPointIds": []string{"point_a"}},
		{"role": "detail-spec", "lines": []string{"容量｜500ml"}},
	}}
	result, err := applyCloudAgentStudioPlan(s.repo, "user", studioTestProduct, call(agenttool.StudioPlanShots, "detail", detail), RuntimePolicySetting{})
	if err != nil {
		t.Fatal(err)
	}
	created, _ := studioToolResult(t, result)["createdShotIds"].([]any)
	if len(created) != 2 {
		t.Fatalf("replace must report new shot ids: %v", result)
	}
	doc, _ := loadStudioProductDoc(s.repo, "user", studioTestProduct)
	plans, _ := doc.plans()
	if len(plans) != 2 || string(plans[0]) != attempted || doc.str("platform") != "jd" || doc.str("activePlan") != "detail" {
		t.Fatalf("untouched plans must stay byte-for-byte and the new plan becomes active: %s", plans)
	}
	plan, shots, _ := decodeStudioPlan(plans[1])
	if stringValue(plan["textMode"]) != "model" {
		t.Fatal("detail plans must generate copy and artwork together")
	}
	if stringValue(shots[0]["title"]) != "头图海报" || stringValue(shots[0]["ratio"]) != "3:4" {
		t.Fatalf("shots must get role titles and plan ratios: %v", shots[0])
	}

	update := map[string]any{"revision": revision + 1, "kind": "main", "action": "update", "updates": []map[string]any{{"shotId": "shot_done", "ratio": "3:4"}}}
	if _, err := applyCloudAgentStudioPlan(s.repo, "user", studioTestProduct, call(agenttool.StudioPlanShots, "ratio", update), RuntimePolicySetting{}); err == nil {
		t.Fatal("a shot with images must keep its ratio")
	}

	request := map[string]any{"revision": revision + 1, "kind": "detail", "shotIds": []string{stringValue(created[0])}}
	if _, err := cloudAgentHandleStudioRequestGeneration(s.repo, "user", state, call(agenttool.StudioRequestGeneration, "no-truth", request)); err == nil || !strings.Contains(err.Error(), "外观依据") {
		t.Fatalf("generation needs an appearance reference photo: %v", err)
	}
	doc, _ = loadStudioProductDoc(s.repo, "user", studioTestProduct)
	if err := doc.set("photos", []map[string]any{{"id": "photo_front", "resourceId": "ref-one", "view": "front", "truth": true}}); err != nil {
		t.Fatal(err)
	}
	fields := map[string]json.RawMessage{}
	for key, value := range doc.fields {
		fields[key] = value
	}
	body, _ := json.Marshal(fields)
	current := revision + 1
	if _, err := s.SaveEcommerceStudioProduct(&model.User{ID: "user"}, studioTestProduct, body, &current); err != nil {
		t.Fatal(err)
	}
	request["revision"] = current + 1
	result, err = cloudAgentHandleStudioRequestGeneration(s.repo, "user", state, call(agenttool.StudioRequestGeneration, "request", request))
	if err != nil {
		t.Fatal(err)
	}
	receipt := studioToolResult(t, result)
	if receipt["taskSubmitted"] != false || receipt["status"] != "awaiting_user_confirmation" {
		t.Fatalf("the agent must not claim that generation started: %v", receipt)
	}
	doc, _ = loadStudioProductDoc(s.repo, "user", studioTestProduct)
	pending, _ := doc.pendingGeneration()
	if pending == nil || pending.Source != "agent" || len(pending.ShotIDs) != 1 || pending.Kind != "detail" {
		t.Fatalf("pending generation must wait for the user: %+v", pending)
	}
}

func TestCloudAgentStudioPhotoInspection(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"杯子","photos":[{"id":"photo_front","resourceId":"ref-one","view":"front"},{"id":"photo_tag","resourceId":"ref-two","view":"tag","truth":false},{"id":"photo_foreign","resourceId":"private","view":"side"}]}`)
	state := studioAgentState()
	state.Request.VisionEnabled = true
	call := cloudAgentStoryboardCall(t, agenttool.StudioInspectPhotos, "inspect", map[string]any{"photoIds": []string{"photo_front", "photo_tag"}, "purpose": "读出吊牌上的容量"})
	result, err := s.prepareCloudAgentVisionTool("user", state, call)
	if err != nil {
		t.Fatal(err)
	}
	batch, ok := result.(cloudAgentImageInspectionBatch)
	if !ok || len(batch.Inspections) != 2 || batch.Inspections[0].ImageURL != "resource:ref-one" || batch.Inspections[1].Receipt["nodeId"] != "photo_tag" || batch.Inspections[1].Receipt["truth"] != false {
		t.Fatalf("studio photos must reuse the vision delivery with photo ids: %#v", result)
	}
	for name, ids := range map[string][]string{"foreign photo": {"photo_unknown"}, "other user's resource": {"photo_foreign"}} {
		bad := cloudAgentStoryboardCall(t, agenttool.StudioInspectPhotos, "bad", map[string]any{"photoIds": ids, "purpose": "看看"})
		if _, err := s.prepareCloudAgentVisionTool("user", state, bad); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestCloudAgentStudioScopeChangeNotices(t *testing.T) {
	studio := studioAgentRequest()
	canvas := agentTestRequest()
	other := studioAgentRequest()
	other.StudioProductID = "product_other"
	cases := map[string]struct {
		previousCanvas string
		previous, next CloudAgentRequest
		want           []string
	}{
		"enter studio from canvas": {"agent-canvas", canvas, studio, []string{"用户已离开画布", "打开了电商生图台"}},
		"switch product":           {"", studio, other, []string{"切换到了另一个商品"}},
		"leave studio":             {"", studio, CloudAgentRequest{}, []string{"已离开电商生图台"}},
	}
	for name, tc := range cases {
		notices := strings.Join(cloudAgentScopeChangeNotices(tc.previousCanvas, tc.previous, tc.next), "\n")
		for _, want := range tc.want {
			if !strings.Contains(notices, want) {
				t.Errorf("%s: missing %q in %s", name, want, notices)
			}
		}
	}
	if notices := cloudAgentScopeChangeNotices("", studio, studio); len(notices) != 0 {
		t.Fatalf("same binding must not add notices: %v", notices)
	}
}
