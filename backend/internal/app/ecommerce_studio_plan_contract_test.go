package app

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestStudioDetailPlanContractAdaptsPurchasePathToExplicitCount(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	for _, tc := range []struct {
		count    int
		guidance string
	}{
		{4, "合并相邻职责"},
		{6, "认货、给理由、看证据、看使用、做选择、消顾虑"},
		{13, "屏数不等于卖点数"},
	} {
		t.Run(fmt.Sprintf("%d screens", tc.count), func(t *testing.T) {
			input := canvasGenerationInput{Mode: "text", Metadata: map[string]any{
				"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan", "studioStep": "plan",
				"studioPlanKind": "detail", "studioPlanScope": "detail", "studioPlanCount": tc.count, "studioPlanRoles": []string{"detail-hero", "detail-scene", "detail-closing"},
				"studioPlanIncludeAlternatives": true,
				"studioProductName":             "餐椅", "studioCategory": "家具", "studioFamily": "home",
			}}
			if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
				t.Fatal(err)
			}
			prompt := input.Config.SystemPrompt
			method := strings.LastIndex(prompt, "【详情页购买路径】")
			knowledge := strings.Index(prompt, "购买决策与合规方法")
			if knowledge < 0 || method <= knowledge {
				t.Fatal("trusted purchase path must follow retrieved buying and compliance methods in the worker prompt")
			}
			for _, expected := range []string{
				fmt.Sprintf("JSON screens 正好 %d 项", tc.count), tc.guidance, "不是固定屏序和版式", "同一个基本动作只占一屏", "佩戴效果可前置", "把能展示真实用途的画面放在零件描述之前", "生鲜可展现不改实物状态的备料关系", "末屏可以用最后一项实物证据结束", "没有真实活动不安排促销屏", "由图片模型整体设计图文",
			} {
				if !strings.Contains(prompt, expected) {
					t.Errorf("missing purchase path contract %q", expected)
				}
			}
			if !strings.Contains(prompt, "依次返回 summary、screens 和 alternatives 三个键") || !strings.Contains(prompt, "没有可证实的候补则写空数组") || !strings.Contains(prompt, "再放大、换容器或摆放环境不算新答案") {
				t.Fatal("a requested alternatives array must be part of the same answer, without introducing unsupported screens")
			}
			delete(input.Metadata, "studioPlanIncludeAlternatives")
			without, err := ecommerceStudioPlanContract(input.Metadata)
			if err != nil || strings.Contains(without, "alternatives") {
				t.Fatalf("seller-directed plan should not request replacements: %v", err)
			}
		})
	}
}

func TestStudioDetailPlanWorkerUsesPurchaseKnowledgeWithoutDesignPresets(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	const buyingRule = "先写买家尚未得到答案的实际问题。"
	const preset = "全套用指定青色、固定上方大字和相同布景。"
	const wrongPlacement = "列表首图固定纯白，无图内标题。"
	if err := db.Create(&model.EcommerceKnowledgeSource{ID: "reviewed-plan", Name: "审核知识", Status: "ready"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, example := range []struct{ id, kind, guidance string }{
		{"buying-questions", "marketing_strategy", buyingRule},
		{"default-layout", "layout_pattern", preset},
		{"listings-platform-style", "platform_rule", wrongPlacement},
	} {
		entry := model.EcommerceKnowledgeEntry{
			ID: example.id, DedupHash: example.id, SourceID: "reviewed-plan", Title: example.id,
			KnowledgeType: example.kind, Category: "general", ReviewStatus: "approved",
			PlatformsJSON: `["taobao"]`, TrustLevel: "reviewed_community", ContentJSON: fmt.Sprintf(`{"guidance":%q}`, example.guidance),
		}
		if err := db.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, product := range []struct{ name, family string }{{"抽纸", "home"}, {"电吹风机", "electronics"}} {
		t.Run(product.name, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "text", Metadata: map[string]any{
				"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan", "studioStep": "plan",
				"studioPlanKind": "detail", "studioPlanScope": "detail", "studioPlanCount": 10, "studioPlanRoles": []string{"detail-hero", "detail-scene", "detail-closeup", "detail-closing"},
				"studioProductName": product.name, "studioCategory": product.name, "studioFamily": product.family, "studioPlatform": "taobao",
			}}
			if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
				t.Fatal(err)
			}
			knowledge, contract, found := strings.Cut(input.Config.SystemPrompt, "【本次策划合同，优先于上述示例方法】")
			ids, _ := input.Metadata[ecommercePlanningKnowledgeIDsKey].([]string)
			if !found || !strings.Contains(knowledge, buyingRule) || !slices.Contains(ids, "buying-questions") {
				t.Fatal("trusted contract must follow real buying guidance retrieved from the reviewed knowledge base")
			}
			for _, example := range []string{"提炼商品专属的视觉方向", "artDirection", "visualWorld", "screenVariationPlan", "内置爆款套图库", "版式与字体：让字成为设计的一部分", preset, wrongPlacement} {
				if strings.Contains(input.Config.SystemPrompt, example) {
					t.Errorf("ordinary detail planning received automatic design guidance: %q", example)
				}
			}
			if slices.Contains(ids, "default-layout") || slices.Contains(ids, "listings-platform-style") || slices.Contains(ids, kb20LayoutID) {
				t.Errorf("knowledge receipt includes presets that were not supplied: %v", ids)
			}
			for _, expected := range []string{"JSON screens 正好 10 项", "先找决定买不买的真实问题，再选屏型", "合并同一包装", "visualBeat 写本屏独有的实物状态", "同一表面的斑点、色泽和反光优先同屏", "只示意已知用法，不推断使用结果", "同一 role 可以复用", "由图片模型整体设计图文"} {
				if !strings.Contains(contract, expected) {
					t.Errorf("missing detail-focused worker contract %q", expected)
				}
			}
			for _, evidenceBoundary := range []string{"只有实拍中的工作关系或卖家确认资料能辨明作用端", "单侧照片不能推定进出方向", "区分使用情境、主要动作与可见证据", "情境可以独立成屏", "evidence 只引用请求里确实支持本屏的资料编号", "photo 用本次附图序号（如图1）", "原图取证坐标，不是对成品布局的指令", "整品、纯情境或看不清的局部省略"} {
				if !strings.Contains(contract, evidenceBoundary) {
					t.Errorf("ordinary detail plan dropped the source/role boundary %q", evidenceBoundary)
				}
			}
			if strings.Contains(contract, "动作要用可见形状或位置指认实际作用的部件") {
				t.Fatal("a shape alone cannot prove a working direction")
			}
		})
	}
}

func TestStudioMainAndSinglePlanWorkerLeavesArtworkToImageModel(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		scope, guidance string
		count           int
		roles           []string
	}{
		{"main", "第 1 张负责搜索列表的商品识别", 5, []string{"main-white", "main-selling", "main-scene"}},
		{"single", "按用户所选的图位顺序逐张输出", 18, []string{"main-selling", "detail-hero", "detail-steps"}},
	} {
		t.Run(test.scope, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "text", Prompt: "策划卖家选定的图位", Metadata: map[string]any{
				"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan", "studioStep": "plan",
				"studioPlanKind": test.scope, "studioPlanScope": test.scope, "studioPlanCount": test.count, "studioPlanRoles": test.roles,
				"studioProductName": "电吹风机", "studioCategory": "吹风机", "studioFamily": "electronics", "studioPlatform": "taobao",
			}}
			if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
				t.Fatal(err)
			}
			prompt := input.Config.SystemPrompt
			for _, required := range []string{fmt.Sprintf("JSON screens 正好 %d 项", test.count), test.guidance, "只输出 summary 和 screens", "购买决策与合规方法", "由图片模型整体设计图文"} {
				if !strings.Contains(prompt, required) {
					t.Errorf("worker did not receive the content-only contract: %s", required)
				}
			}
			for _, forbidden := range []string{"artDirection", "visualWorld", "screenVariationPlan", "内置爆款套图库", "提炼商品专属的视觉方向", "版式与字体：让字成为设计的一部分", "【详情页购买路径】", "detailSource"} {
				if strings.Contains(prompt, forbidden) {
					t.Errorf("automatic visual preset reached the planner: %s", forbidden)
				}
			}
			ids, _ := input.Metadata[ecommercePlanningKnowledgeIDsKey].([]string)
			if len(ids) == 0 || slices.Contains(ids, kb20LayoutID) || input.Prompt != "策划卖家选定的图位" {
				t.Errorf("planning must receive applicable knowledge, but not KB20 design presets: %v", ids)
			}
		})
	}
}

func TestStudioPlanContractIsSpecificToFinalPlan(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	input := canvasGenerationInput{Mode: "text", Prompt: "买家提供的模板", Metadata: map[string]any{
		"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan", "studioStep": "plan",
		"studioPlanKind": "detail", "studioPlanScope": "template", "studioTemplateId": "selected-suite", "studioTemplateSource": "library", "studioPlanCount": float64(11), "studioPlanRoles": []any{"detail-hero", "detail-scene"},
		"studioProductName": "保温杯", "studioCategory": "保温杯",
	}}
	if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"JSON screens 正好 11 项", "detail-hero、detail-scene", "第 N 项对应模板第 N 项的用途", "purchaseQuestion、displayContent、evidence", "由图片模型整体设计图文"} {
		if !strings.Contains(input.Config.SystemPrompt, expected) {
			t.Fatalf("missing final contract %q", expected)
		}
	}
	if strings.Contains(input.Config.SystemPrompt, "逐屏：HERO ") {
		t.Fatal("opaque reference roles leaked into worker instructions")
	}
	if strings.Contains(input.Config.SystemPrompt, "【详情页购买路径】") {
		t.Fatal("a detail template must keep its own screen sequence")
	}
	if !strings.Contains(input.Config.SystemPrompt, "样本第1屏") {
		t.Fatal("template planning must retain the existing case formatting")
	}
	for _, step := range []string{"ask", "directions", "recognize"} {
		input.Metadata["studioStep"] = step
		if err := svc.applyEcommerceAnalysisInstruction(&input); err != nil || strings.Contains(input.Config.SystemPrompt, "JSON screens 正好") {
			t.Fatalf("%s must not get a final screen-count contract: %v", step, err)
		}
	}
	input.Metadata["studioStep"] = "plan"
	for _, invalid := range []struct {
		key   string
		value any
	}{{"studioTemplateId", ""}, {"studioTemplateSource", "other"}, {"studioPlanCount", 2.5}, {"studioPlanCount", 31}, {"studioPlanRoles", []any{"HERO"}}} {
		previous := input.Metadata[invalid.key]
		input.Metadata[invalid.key] = invalid.value
		if err := svc.validateEcommerceCapability(&input); err == nil {
			t.Errorf("admitted invalid %s: %v", invalid.key, invalid.value)
		}
		input.Metadata[invalid.key] = previous
	}
}
