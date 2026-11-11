package app

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

func TestStudioPlatformKnowledgeSurvivesVisualLimit(t *testing.T) {
	ranked := []model.EcommerceKnowledgeEntry{}
	for _, kind := range []string{"detail_page_pattern", "layout_pattern", "photography", "scene_pattern", "model_casting_pattern", "visual_style", "prompt_pattern", "quality_rule", "copywriting_pattern"} {
		for i := 0; i < 3; i++ {
			ranked = append(ranked, model.EcommerceKnowledgeEntry{ID: fmt.Sprintf("%s-%d", kind, i), KnowledgeType: kind})
		}
	}
	ranked = append(ranked, model.EcommerceKnowledgeEntry{ID: "platform", KnowledgeType: "platform_rule"}, model.EcommerceKnowledgeEntry{ID: "scope", KnowledgeType: "creation_type_rule"})
	selected := selectEcommerceStudioPlanKnowledge(ranked)
	ids := map[string]bool{}
	for _, entry := range selected {
		ids[entry.ID] = true
	}
	if len(selected) > ecommerceStudioPlanKnowledgeLimit || !ids["platform"] || !ids["scope"] {
		t.Fatalf("platform and scope constraints were squeezed out: %v", ids)
	}
	if ranked[0].ID != "detail_page_pattern-0" {
		t.Fatal("selection mutated the caller's ranking")
	}
}

func TestStudioExpandedDesignKnowledgeReachesWorker(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	input := canvasGenerationInput{Mode: "text", Prompt: "策划儿童眼镜", Metadata: map[string]any{
		"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan",
		"studioProductName": "儿童眼镜", "studioCategory": "眼镜", "studioPlatform": "taobao", "studioPlanKind": "detail", "studioDetailScreens": 4,
	}}
	if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"商品、人群与背景色分别判断", "微距压边", "生活分镜", "灰色镜腿", "用户选择 4 屏", "4.5:1", "字块、主图轮廓与留白", "说明紧邻对应证据", "不固定标题与注解比例", "视觉策划：内容、证据与阅读路径"} {
		if !strings.Contains(input.Config.SystemPrompt, text) {
			t.Fatalf("worker system prompt lost %q", text)
		}
	}
	if strings.Contains(input.Config.SystemPrompt, "注解约标题字号的三分之一") {
		t.Fatal("worker still imposes the obsolete headline ratio")
	}
}

func TestStudioSharedPosterMethodReachesDifferentProductWorkers(t *testing.T) {
	catalog, err := ecommerceagent.ReadStudioDesignCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if catalog.PosterDesign.Hero == "" || catalog.PosterDesign.Principles == "" {
		t.Fatal("shared poster methods are missing")
	}
	svc, _, _, _ := ecommerceCreationTestService(t)
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	for _, product := range []struct{ name, family string }{
		{"儿童眼镜", "generic"}, {"机械键盘", "electronics"}, {"曲奇饼干", "food"}, {"护理精华", "beauty"}, {"衬衫", "apparel"}, {"陶瓷杯", "home"},
	} {
		for _, kind := range []string{"detail", "main", "single"} {
			t.Run(product.name+"/"+kind, func(t *testing.T) {
				input := canvasGenerationInput{Mode: "text", Prompt: "策划", Metadata: map[string]any{
					"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan",
					"studioProductName": product.name, "studioCategory": product.name, "studioFamily": product.family,
					"studioPlatform": "taobao", "studioPlanKind": kind, "studioPlanTargets": "poster", "studioDetailScreens": 2,
				}}
				if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
					t.Fatal(err)
				}
				for _, method := range []string{catalog.PosterDesign.Principles, catalog.PosterDesign.Hero, "标题中的实际词组", "不能只换背景"} {
					if !strings.Contains(input.Config.SystemPrompt, method) {
						t.Fatalf("worker lost shared method for %s/%s", product.name, kind)
					}
				}
			})
		}
	}
}

func TestStudioDesignKnowledgeUpgradePreservesAdminChoices(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	previous := shippedWith(t, func(entries []model.EcommerceKnowledgeEntry) []model.EcommerceKnowledgeEntry {
		for _, id := range []string{kb20LayoutID, kb20MethodID, "kb20-single-hero"} {
			bumpEntry(&entries[indexOfEntry(t, entries, id)], "kb20-v7-20261111", "旧版设计方法")
		}
		return entries
	})
	if _, err := svc.ensureBuiltinEcommerceKnowledge(previous); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", kb20MethodID).Update("content_json", `{"guidance":"管理员自定阅读方法"}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", "kb20-single-hero").Update("review_status", "rejected").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", ecommerceBuiltinSourceID(ecommerceKB20Domain)).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	report, err := svc.EnsureBuiltinEcommerceKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(report.Updated, kb20LayoutID) || !slices.Contains(report.PreservedLocal, kb20MethodID) {
		t.Fatalf("new layout must upgrade and local method must be preserved: updated=%v preserved=%v", report.Updated, report.PreservedLocal)
	}
	layout, err := svc.repo.EcommerceKnowledgeEntryByID(kb20LayoutID)
	if err != nil || layout.Version != ecommerceKB20Version || !strings.Contains(layout.ContentJSON, "核心词与支持词") {
		t.Fatal("stored layout did not receive the new design method")
	}
	hero, err := svc.repo.EcommerceKnowledgeEntryByID("kb20-single-hero")
	if err != nil || hero.ReviewStatus != "rejected" {
		t.Fatal("design upgrade changed the admin review status")
	}
	method, err := svc.repo.EcommerceKnowledgeEntryByID(kb20MethodID)
	if err != nil || !strings.Contains(method.ContentJSON, "管理员自定阅读方法") {
		t.Fatal("design upgrade overwrote the local method")
	}
	if got := svc.ecommerceStudioDesignPlaybook("餐椅", "弧背餐椅", "home", "", "single", []string{"poster"}); got != "" {
		t.Fatal("design upgrade re-enabled a disabled source")
	}
}

func TestStudioCatalogBootstrapsSharedDesignMethods(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	var entries []model.EcommerceKnowledgeEntry
	if err := db.Where("knowledge_domain = ?", "KB20").Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if len(entries) != 81 {
		t.Fatalf("expected original methods plus 24 layouts, 18 compositions and 10 platform guides, got %d", len(entries))
	}
	var platform model.EcommerceKnowledgeEntry
	if err := db.First(&platform, "id = ?", "kb20-studio-platform-amazon").Error; err != nil {
		t.Fatal(err)
	}
	if platform.PlatformsJSON != `["amazon"]` || !strings.Contains(platform.ContentJSON, "A+") {
		t.Fatal("platform method lost its retrieval scope or content")
	}
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("knowledge_domain = ?", "KB20").Count(&count).Error; err != nil || count != 81 {
		t.Fatal("repeated bootstrap duplicated shared design methods")
	}
}

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
	plan.Metadata["studioPlanKind"] = "detail"
	plan.Metadata["studioDetailScreens"] = float64(4)
	plan.Metadata["studioTextMode"] = "model"
	if err := svc.applyEcommerceAnalysisInstruction(&plan); err != nil {
		t.Fatal(err)
	}
	prompt := plan.Config.SystemPrompt
	if !strings.Contains(prompt, "用户选择 4 屏") || !strings.Contains(prompt, "JSON screens 正好 4 项") || !strings.Contains(prompt, "图片模型整体设计图文") || !strings.Contains(prompt, "designAnalysis") {
		t.Fatal("requested screen count and rendering contract must reach the actual worker system prompt")
	}
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
	gel := ecommerceStudioPlaybookIDs("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "管身 白色塑料软管；质地 透明凝胶", "detail", nil)
	for _, id := range []string{kb20MethodID, "kb20-category-medical", "kb20-light-texture", "kb20-light-gloss", kb20LayoutID, kb20CopyID} {
		if !slices.Contains(gel, id) {
			t.Fatalf("gel playbook is missing %s: %v", id, gel)
		}
	}
	if chair := ecommerceStudioPlaybookIDs("餐椅", "奶油白餐椅", "home", "颜色 奶油白；黑框", "detail", nil); slices.Contains(chair, "kb20-light-texture") {
		t.Fatal("chair color must not unlock gel lighting in the worker")
	}
	kids := ecommerceStudioPlaybookIDs("儿童眼镜", "透明椭圆框儿童眼镜", "generic", "镜框颜色 透明", "detail", nil)
	for _, id := range []string{"kb20-category-kids", "kb20-category-eyewear", "kb20-light-transparent"} {
		if !slices.Contains(kids, id) {
			t.Fatalf("kids eyewear playbook is missing %s: %v", id, kids)
		}
	}
	if other := ecommerceStudioPlaybookIDs("量子纠缠仪", "", "", "", "detail", nil); !slices.Contains(other, kb20GenericID) || len(other) != 6 {
		t.Fatalf("unmatched product should get method, generic, layout and copy: %v", other)
	}
	if byFamily := ecommerceStudioPlaybookIDs("精华水", "", "beauty", "", "detail", nil); !slices.Contains(byFamily, "kb20-category-skincare") {
		t.Fatalf("family should pick the skincare playbook: %v", byFamily)
	}

	// 主图套图带主图打法；单张图按选中的类型带打法（同一条只带一次，最多两条）。
	if main := ecommerceStudioPlaybookIDs("保温杯", "", "home", "", "main", nil); !slices.Contains(main, kb20MainID) {
		t.Fatalf("main set should include the main playbook: %v", main)
	}
	single := ecommerceStudioPlaybookIDs("保温杯", "", "home", "", "single", []string{"poster", "campaign", "seeding", "white"})
	if !slices.Contains(single, "kb20-single-hero") || !slices.Contains(single, "kb20-single-lifestyle") || slices.Contains(single, "kb20-single-white") || slices.Contains(single, kb20MainID) {
		t.Fatalf("single playbooks are wrong: %v", single)
	}
	if detail := ecommerceStudioPlaybookIDs("保温杯", "", "home", "", "detail", nil); slices.Contains(detail, kb20MainID) || slices.Contains(detail, "kb20-single-hero") {
		t.Fatalf("detail plan should not carry main or single playbooks: %v", detail)
	}

	svc, db, _, _ := ecommerceCreationTestService(t)
	// 数据库里还没有 KB20：用内置原文。
	before := svc.ecommerceStudioDesignPlaybook("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "白色塑料软管；透明凝胶", "detail", nil)
	for _, text := range []string{"电商设计策划知识库（KB20）", "【视觉策划：内容、证据与阅读路径】", "【品类打法 · 医用护理与医疗器械】", "【布光 · 凝胶、乳霜和液体质地】", "不能从透明框推导视力改善", "参数屏可以罗列已确认规格", "项目｜数值与条件"} {
		if !strings.Contains(before, text) {
			t.Fatalf("builtin playbook is missing %q: %s", text, before)
		}
	}
	if strings.Contains(before, "戴上它，世界清清楚楚") || strings.Contains(before, "不罗列外观和规格") {
		t.Fatal("copy guidance must not replace visible facts with invented benefits")
	}
	// 写入知识库后按数据库：驳回一条就不带那一条，停用来源整段不带。
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	if got := svc.ecommerceStudioDesignPlaybook("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "白色塑料软管；透明凝胶", "detail", nil); got != before {
		t.Fatalf("database playbook should match the builtin text before edits:\n%s\n---\n%s", got, before)
	}
	for _, scope := range []string{"main", "detail"} {
		got := svc.ecommerceStudioDesignPlaybook("量子纠缠仪", "", "", "", scope, nil)
		if !strings.Contains(got, "图文重心") || strings.Contains(got, "位置、字号和颜色每屏一致") || strings.Contains(got, "同一个版头（") || strings.Contains(got, "每屏同一个栏目头。") {
			t.Fatalf("stored %s playbook must vary composition within a shared visual identity", scope)
		}
	}
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", "kb20-category-medical").Update("review_status", "rejected").Error; err != nil {
		t.Fatal(err)
	}
	if got := svc.ecommerceStudioDesignPlaybook("医用凝胶", "医用重组胶原蛋白凝胶", "beauty", "", "detail", nil); strings.Contains(got, "医用护理与医疗器械") || !strings.Contains(got, "视觉策划：内容、证据与阅读路径") {
		t.Fatalf("rejected entry should be skipped: %s", got)
	}
	if err := db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", ecommerceBuiltinSourceID(ecommerceKB20Domain)).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	if got := svc.ecommerceStudioDesignPlaybook("医用凝胶", "", "beauty", "", "detail", nil); got != "" {
		t.Fatalf("disabled KB20 source must not reach the planner: %s", got)
	}
}
