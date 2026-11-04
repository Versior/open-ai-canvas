package app

import (
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
