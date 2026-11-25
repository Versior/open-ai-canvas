package app

import (
	"context"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestStudioDetailDesignKnowledgeReachesPromptOnlyProtocol(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	adapter, err := protocol.LoadManifest([]byte(`{
		"apiVersion":"yingce.plugin/v2","id":"openai-images","version":"2.2.0","name":"OpenAI Images",
		"contributes":{"providers":[{
			"id":"openai-image","label":"OpenAI Images","capabilities":["image"],"scopes":["canvas"],
			"create":{"method":"POST","path":"/v1/images/edits","contentType":"multipart/form-data","body":{"prompt":{"$ref":"request.prompt"}}},
			"response":{"status":"succeeded","images":{"$ref":"response.data"}}
		}]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	const brief = "第 3/6 屏。以日文写短文案，展示机械键盘边缘与接口。"
	input := canvasGenerationInput{Mode: "image", Prompt: brief, Metadata: map[string]any{
		"source": ecommerceStudioSource, "studioStep": "image", "studioPlanKind": "detail", studioDetailContractKey: studioDetailContract,
		"studioUseDesignKnowledge": true, "studioProductName": "机械键盘", "studioCategory": "键盘", "studioFamily": "electronics", "studioMaterials": "铝合金",
	}}
	if ids := svc.applyEcommerceStudioImageDesign(&input); !slices.Contains(ids, kb20LayoutID) {
		t.Fatalf("no layout guidance applied: %v", ids)
	}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{BaseURL: "https://example.com", Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := spec.Body.(map[string]any)
	prompt, _ := body["prompt"].(string)
	if !strings.HasPrefix(prompt, brief) || !strings.Contains(prompt, "文字与摄影共同构图") || strings.Contains(prompt, "简体中文") || strings.Contains(prompt, "本屏购买问题：") {
		t.Fatalf("prompt-only protocol did not preserve the brief and add only the design reference: %q", prompt)
	}
	if !ecommercePrivateInstruction(input.Metadata) {
		t.Fatal("worker-only knowledge requires private request diagnostics")
	}
}

func TestStudioDetailImageDesignRespectsBudgetAndModeration(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	const brief = "完成这一屏日文详情页成品"
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: brief,
		Config: providerConfig{SystemPrompt: "PROVIDER_BASE"},
		Metadata: map[string]any{
			"source": ecommerceStudioSource, "studioDetailContract": float64(studioDetailContract), "studioStep": "image", "studioPlanKind": "detail",
			"studioUseDesignKnowledge": true, "studioProductName": "电吹风机", "studioCategory": "吹风机", "studioFamily": "electronics", "studioMaterials": "亮面塑料",
		},
	}
	ids := svc.applyEcommerceStudioImageDesign(&input)
	if !slices.Contains(ids, kb20LayoutID) || !slices.Contains(ids, "kb20-light-gloss") {
		t.Fatalf("missing design methods selected for this product: %v", ids)
	}
	if input.Config.SystemPrompt != "PROVIDER_BASE" || !strings.HasPrefix(input.Prompt, brief) || utf8.RuneCountInString(input.Prompt) > utf8.RuneCountInString(brief)+650 || strings.Contains(input.Prompt, "主视觉常用几何展台") {
		t.Fatalf("unexpected change beyond optional guidance: %q", input.Prompt)
	}
	profile := DefaultModelCapabilityConfigForModel("openai-image", "gpt-image-2")
	profile.Image.References.PromptMaxChars = utf8.RuneCountInString(withSystemPrompt(input.Config, brief))
	input.Config.CapabilityConfig, input.Prompt = profile, brief
	if ids := svc.applyEcommerceStudioImageDesign(&input); len(ids) > 0 || input.Prompt != brief {
		t.Fatalf("optional guidance exceeded the model's input limit: %v %q", ids, input.Prompt)
	}
	input.Config.CapabilityConfig = nil
	if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", kb20LayoutID).Update("review_status", "rejected").Error; err != nil {
		t.Fatal(err)
	}
	if ids := svc.applyEcommerceStudioImageDesign(&input); slices.Contains(ids, kb20LayoutID) || strings.Contains(input.Prompt, "文字与摄影共同构图") {
		t.Fatal("worker used a rejected design entry")
	}
	if err := db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", ecommerceBuiltinSourceID(ecommerceKB20Domain)).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	input.Prompt = brief
	if ids := svc.applyEcommerceStudioImageDesign(&input); len(ids) != 0 || input.Prompt != brief {
		t.Fatal("worker used guidance from a disabled knowledge source")
	}
}

func TestStudioImageKnowledgeOnlyAppliesToOptedInStudioArtwork(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	const prompt = "完成商品图"
	for _, test := range []struct {
		name, source, step, kind string
		optIn, want              bool
	}{
		{"detail", ecommerceStudioSource, "image", "detail", true, true},
		{"main", ecommerceStudioSource, "image", "main", true, true},
		{"single", ecommerceStudioSource, "image", "single", true, true},
		{"no opt-in", ecommerceStudioSource, "image", "single", false, false},
		{"no kind", ecommerceStudioSource, "image", "", true, false},
		{"analysis", ecommerceStudioSource, "plan", "detail", true, false},
		{"ecommerce agent", "ecommerce-agent", "image", "main", true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := canvasGenerationInput{
				Mode: "image", Prompt: prompt,
				Metadata: map[string]any{"source": test.source, "studioStep": test.step, "studioPlanKind": test.kind},
			}
			if test.optIn {
				input.Metadata["studioUseDesignKnowledge"] = true
			}
			if ids := svc.applyEcommerceStudioImageDesign(&input); (len(ids) > 0) != test.want || (input.Prompt != prompt) != test.want {
				t.Fatalf("want injected=%v, got entry IDs %v", test.want, ids)
			}
			if got := ecommercePrivateInstruction(input.Metadata); got != test.want {
				t.Fatalf("private diagnostics = %v, want %v", got, test.want)
			}
		})
	}
}
