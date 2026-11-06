package app

import (
	"encoding/json"
	"slices"
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
	// 知识段是一行 JSON；同类爆款套图参考排在它后面。
	var knowledge []map[string]string
	line := ""
	for _, item := range strings.Split(prompt, "\n") {
		if strings.HasPrefix(item, "[{") {
			line = item
			break
		}
	}
	if err := json.Unmarshal([]byte(line), &knowledge); err != nil {
		t.Fatalf("knowledge block is not JSON: %v", err)
	}
	if !strings.Contains(prompt, "内置爆款套图库") || strings.Index(prompt, "内置爆款套图库") < strings.Index(prompt, line) {
		t.Fatalf("viral references should follow the knowledge block: %s", prompt)
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

	// 主图套图和单张图的策划按各自的创作类型取规则，不带详情页的逐屏叙事。
	for kind, rule := range map[string]string{"main": "电商主副图层级", "single": "单图独立叙事"} {
		scoped := task("detail-plan")
		scoped.Metadata["studioPlanKind"] = kind
		if err := svc.applyEcommerceAnalysisInstruction(&scoped); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(scoped.Config.SystemPrompt, rule) || strings.Contains(scoped.Config.SystemPrompt, "详情页逐屏连贯叙事") || !strings.Contains(scoped.Config.SystemPrompt, "耳机棚拍布光") {
			t.Fatalf("%s plan knowledge is wrong: %s", kind, scoped.Config.SystemPrompt)
		}
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

func TestEcommerceStudioPlanViralReferences(t *testing.T) {
	// 同类：保温杯取到套图库里的 3 套保温杯，带视觉语法和逐屏结构，文案槽位换成「文案」。
	refs := ecommerceStudioViralReferences("保温杯", "一杯装下一整天", "home")
	if len(refs) != ecommerceStudioReferenceLimit {
		t.Fatalf("expected %d suites, got %d", ecommerceStudioReferenceLimit, len(refs))
	}
	for _, ref := range refs {
		if !ref.related || !strings.Contains(ref.doc.Name+ref.doc.Category.Leaf+strings.Join(ref.doc.Category.Keywords, " "), "保温杯") {
			t.Fatalf("unrelated suite picked for 保温杯: %s", ref.doc.Name)
		}
	}
	prompt := ecommerceStudioViralReferencePrompt("保温杯", "一杯装下一整天", "home")
	for _, text := range []string{"内置爆款套图库", "1.【同类】「" + refs[0].doc.Name, "视觉语法：", "色板 ", "逐屏：", "inspiration"} {
		if !strings.Contains(prompt, text) {
			t.Fatalf("reference prompt is missing %q: %s", text, prompt)
		}
	}
	if strings.Contains(prompt, "{callout") || strings.Contains(prompt, "{product}") {
		t.Fatalf("suite placeholders leaked into the planner prompt: %s", prompt)
	}

	// 儿童眼镜：按中心词「眼镜」对上套图库里的眼镜，不够 3 套时按人群推断的母婴玩具大类补，结果稳定。
	refs = ecommerceStudioViralReferences("儿童眼镜", "透明椭圆框儿童眼镜", "generic")
	if len(refs) != ecommerceStudioReferenceLimit {
		t.Fatalf("expected the list to be filled to %d, got %d", ecommerceStudioReferenceLimit, len(refs))
	}
	baby := map[string]bool{}
	for _, l1 := range ecommerceStudioFamilyCatalogL1["baby-toys"] {
		baby[l1] = true
	}
	again := ecommerceStudioViralReferences("儿童眼镜", "透明椭圆框儿童眼镜", "generic")
	related := 0
	for index, ref := range refs {
		if ref.related {
			related++
			if !strings.Contains(ref.doc.Category.Leaf+ref.doc.Name, "镜") {
				t.Fatalf("related suite is not eyewear: %s", ref.doc.Name)
			}
		} else if !baby[ref.doc.Category.L1] {
			t.Fatalf("family fill should come from 母婴玩具: %s", ref.doc.Category.L1)
		}
		if again[index].doc.ID != ref.doc.ID {
			t.Fatal("reference choice must be stable for the same product")
		}
	}
	if related == 0 || related == ecommerceStudioReferenceLimit {
		t.Fatalf("expected a mix of eyewear and family suites, got %d related", related)
	}
	if !strings.Contains(ecommerceStudioViralReferencePrompt("儿童眼镜", "透明椭圆框儿童眼镜", "generic"), "【同大类】") {
		t.Fatal("family fill must be tagged so the planner only borrows layout and visual system")
	}

	// 没有商品类型和名称、也对不上大类时不附参考。
	if ecommerceStudioViralReferencePrompt("", "", "") != "" || ecommerceStudioViralReferencePrompt("量子纠缠仪", "", "") != "" {
		t.Fatal("no reference expected without a category match")
	}
}

func TestEcommerceStudioDesignPlaybook(t *testing.T) {
	// 按商品挑：医用凝胶取到医用护理打法和质地、软管布光；儿童眼镜取到儿童和眼镜两条打法与透明布光；对不上时用通用打法。
	gel := ecommerceStudioPlaybookIDs("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "管身 白色塑料软管；质地 透明凝胶")
	for _, id := range []string{kb20MethodID, "kb20-category-medical", "kb20-light-texture", "kb20-light-gloss", kb20LayoutID, kb20CopyID} {
		if !slices.Contains(gel, id) {
			t.Fatalf("gel playbook is missing %s: %v", id, gel)
		}
	}
	kids := ecommerceStudioPlaybookIDs("儿童眼镜", "透明椭圆框儿童眼镜", "generic", "镜框颜色 透明")
	for _, id := range []string{"kb20-category-kids", "kb20-category-eyewear", "kb20-light-transparent"} {
		if !slices.Contains(kids, id) {
			t.Fatalf("kids eyewear playbook is missing %s: %v", id, kids)
		}
	}
	if other := ecommerceStudioPlaybookIDs("量子纠缠仪", "", "", ""); !slices.Contains(other, kb20GenericID) || len(other) != 4 {
		t.Fatalf("unmatched product should get method, generic, layout and copy: %v", other)
	}
	if byFamily := ecommerceStudioPlaybookIDs("精华水", "", "beauty", ""); !slices.Contains(byFamily, "kb20-category-skincare") {
		t.Fatalf("family should pick the skincare playbook: %v", byFamily)
	}

	svc, db, _, _ := ecommerceCreationTestService(t)
	// 数据库里还没有 KB20：用内置原文。
	before := svc.ecommerceStudioDesignPlaybook("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "白色塑料软管；透明凝胶")
	for _, text := range []string{"电商设计策划知识库（KB20）", "【视觉策划五步：先从同质化里跳出来】", "【品类打法 · 医用护理与医疗器械】", "【布光 · 凝胶、乳霜和液体质地】", "非天籁，不入耳", "该有的，都写在身上"} {
		if !strings.Contains(before, text) {
			t.Fatalf("builtin playbook is missing %q: %s", text, before)
		}
	}
	// 写入知识库后按数据库：驳回一条就不带那一条，停用来源整段不带。
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	if got := svc.ecommerceStudioDesignPlaybook("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "白色塑料软管；透明凝胶"); got != before {
		t.Fatalf("database playbook should match the builtin text before edits:\n%s\n---\n%s", got, before)
	}
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", "kb20-category-medical").Update("review_status", "rejected").Error; err != nil {
		t.Fatal(err)
	}
	if got := svc.ecommerceStudioDesignPlaybook("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", ""); strings.Contains(got, "医用护理与医疗器械") || !strings.Contains(got, "视觉策划五步") {
		t.Fatalf("rejected entry should be skipped: %s", got)
	}
	if err := db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", ecommerceBuiltinSourceID(ecommerceKB20Domain)).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	if got := svc.ecommerceStudioDesignPlaybook("医用凝胶", "", "beauty", ""); got != "" {
		t.Fatalf("disabled KB20 source must not reach the planner: %s", got)
	}
}
