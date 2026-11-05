package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommerceStudioDossierUsesSharedKnowledge(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	if err := db.Create(&model.EcommerceKnowledgeSource{ID: "ready", Name: "审核库", Status: "ready"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ id, review, category, platform string }{
		{"耳机卖点写法", "approved", "tech", "[]"},
		{"未审核耳机文案", "pending", "tech", "[]"},
		{"美妆品类文案", "approved", "beauty", "[]"},
		{"亚马逊专属规则", "approved", "tech", `["amazon"]`},
	} {
		entry := model.EcommerceKnowledgeEntry{ID: tc.id, DedupHash: tc.id, SourceID: "ready", Title: tc.id, KnowledgeType: "copywriting_pattern", Category: tc.category, ReviewStatus: tc.review, PlatformsJSON: tc.platform, TrustLevel: "reviewed_community", ContentJSON: `{"guidance":"` + tc.id + `的方法"}`}
		if err := db.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}
	studio := func(metadata map[string]any) canvasGenerationInput {
		base := map[string]any{"ecommerceCapability": "dossier", "ecommerceAnalysisFlow": "cap:dossier"}
		for key, value := range metadata {
			base[key] = value
		}
		return canvasGenerationInput{Mode: "text", Prompt: "识别商品", Metadata: base}
	}

	input := studio(map[string]any{"source": "ecommerce-studio", "studioProductName": "头戴式耳机", "studioCategory": "耳机", "studioPlatform": "taobao"})
	if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(input.Config.SystemPrompt, defaultEcommerceCapabilityPrompt("dossier")) {
		t.Fatal("dossier instruction must stay first")
	}
	if !strings.Contains(input.Config.SystemPrompt, "电商知识库") || !strings.Contains(input.Config.SystemPrompt, "耳机卖点写法") {
		t.Fatalf("studio dossier must read the shared knowledge base: %s", input.Config.SystemPrompt)
	}
	for _, text := range []string{"未审核耳机文案", "美妆品类文案", "亚马逊专属规则"} {
		if strings.Contains(input.Config.SystemPrompt, text) {
			t.Fatalf("inapplicable knowledge reached the studio prompt: %s", text)
		}
	}
	if input.Prompt != "识别商品" {
		t.Fatal("knowledge must not be written into the user prompt")
	}

	// 同一能力从其他来源提交时不附加生图台知识。
	other := studio(map[string]any{"source": "canvas"})
	if err := svc.applyEcommerceAnalysisInstruction(&other); err != nil {
		t.Fatal(err)
	}
	if other.Config.SystemPrompt != defaultEcommerceCapabilityPrompt("dossier") {
		t.Fatalf("non-studio dossier task changed: %s", other.Config.SystemPrompt)
	}
}

func TestEcommerceStudioDetailPlanUsesVisualKnowledge(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	if err := db.Create(&model.EcommerceKnowledgeSource{ID: "ready", Name: "审核库", Status: "ready"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ id, kind string }{
		{"耳机详情页版式一", "layout_pattern"}, {"耳机详情页版式二", "layout_pattern"}, {"耳机详情页版式三", "layout_pattern"}, {"耳机详情页版式四", "layout_pattern"},
		{"耳机棚拍布光", "photography"}, {"耳机通勤场景", "scene_pattern"}, {"耳机卖点写法", "copywriting_pattern"}, {"耳机行业趋势", "trend"},
	} {
		entry := model.EcommerceKnowledgeEntry{ID: tc.id, DedupHash: tc.id, SourceID: "ready", Title: tc.id, KnowledgeType: tc.kind, Category: "tech", ReviewStatus: "approved", PlatformsJSON: "[]", TrustLevel: "reviewed_community", ContentJSON: `{"guidance":"` + tc.id + `的方法"}`}
		if err := db.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}
	task := func(capability string) canvasGenerationInput {
		return canvasGenerationInput{Mode: "text", Prompt: "排详情页", Metadata: map[string]any{
			"source": "ecommerce-studio", "studioProductName": "头戴式耳机", "studioCategory": "耳机", "studioPlatform": "taobao",
			"ecommerceCapability": capability, "ecommerceAnalysisFlow": "cap:" + capability,
		}}
	}

	plan := task("detail-plan")
	if err := svc.applyEcommerceAnalysisInstruction(&plan); err != nil {
		t.Fatal(err)
	}
	prompt := plan.Config.SystemPrompt
	if !strings.HasPrefix(prompt, defaultEcommerceCapabilityPrompt("detail-plan")) || plan.Prompt != "排详情页" {
		t.Fatal("detail plan instruction must stay first and leave the user prompt alone")
	}
	for _, text := range []string{"详情页、版式、摄影", "耳机棚拍布光", "耳机通勤场景", "耳机卖点写法", "详情页逐屏连贯叙事"} {
		if !strings.Contains(prompt, text) {
			t.Fatalf("detail plan is missing %q: %s", text, prompt)
		}
	}
	if strings.Contains(prompt, "耳机行业趋势") {
		t.Fatal("knowledge types outside the plan list reached the prompt")
	}
	var knowledge []map[string]string
	if err := json.Unmarshal([]byte(prompt[strings.LastIndex(prompt, "\n")+1:]), &knowledge); err != nil {
		t.Fatalf("knowledge block is not JSON: %v", err)
	}
	layouts := 0
	for _, entry := range knowledge {
		if entry["type"] == "layout_pattern" {
			layouts++
		}
	}
	if layouts != 3 || len(knowledge) > ecommerceStudioPlanKnowledgeLimit {
		t.Fatalf("layout knowledge should be capped at 3 of %d entries, got %d", len(knowledge), layouts)
	}

	// 商品档案仍只拿文案类知识，版式和摄影留给详情页策划。
	dossier := task("dossier")
	if err := svc.applyEcommerceAnalysisInstruction(&dossier); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dossier.Config.SystemPrompt, "耳机卖点写法") || strings.Contains(dossier.Config.SystemPrompt, "耳机棚拍布光") || strings.Contains(dossier.Config.SystemPrompt, "耳机详情页版式") {
		t.Fatalf("dossier knowledge types changed: %s", dossier.Config.SystemPrompt)
	}
}
