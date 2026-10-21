package protocol

import (
	"context"
	"encoding/json"
	"testing"
)

func TestImageParametersValidationReplacementKeepsOtherRules(t *testing.T) {
	request := GenerationRequest{Capability: CapabilityImage, Model: "example", ImageParameters: map[string]any{"amount": 150}, ImageParameterSchema: []ImageParameter{{Name: "amount", Label: "Amount", Type: "number", Binding: "providerOptions.example.amount"}}}
	for _, item := range []struct {
		assert  string
		replace bool
	}{
		{`{"$lte":[{"$ref":"request.providerOptions.example.amount"},100]}`, true},
		{`{"$gt":[{"$len":{"$ref":"request.prompt"}},0]}`, false},
		{`{"$in":[{"$ref":"request.model"},["example"]]}`, false},
		{`{"$lte":[{"$len":{"$ref":"request.images"}},1]}`, false},
		{`{"$eq":[{"$ref":"request.providerOptions.example.amount"},{"$ref":"request.prompt"}]}`, false},
		{`{"$eq":[{"$ref":"request.providerOptions.example.amount"},"{{request.prompt}}"]}`, false},
	} {
		var assert any
		if err := json.Unmarshal([]byte(item.assert), &assert); err != nil {
			t.Fatal(err)
		}
		if got := modelImageParametersReplaceValidation(assert, request); got != item.replace {
			t.Fatalf("replace %s = %v", item.assert, got)
		}
	}
	delete(request.ImageParameters, "amount")
	if modelImageParametersReplaceValidation(map[string]any{"$ref": "request.providerOptions.example.amount"}, request) {
		t.Fatal("unsupplied value bypassed validation")
	}
}

func TestImageParametersEmptyEnumSurvivesJSONRoundTrip(t *testing.T) {
	definitions := []ImageParameter{{Name: "size", Label: "Size", Type: "string", Values: []any{"1:1"}, Binding: "aspectRatio"}}
	configured := []ImageParameter{{Name: "size", Values: []any{}}}
	data, err := json.Marshal(configured)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &configured); err != nil {
		t.Fatal(err)
	}
	resolved, err := ResolveImageParameters(definitions, configured, "example")
	if err != nil || !resolved[0].Accepts("17:11") {
		t.Fatalf("free input reverted to plugin enum: %v", err)
	}
}

func TestImageParametersPluginRequestPreservesValuesAndModelScope(t *testing.T) {
	adapter := officialPackageAdapter(t, "kacang-midjourney.yingce-plugin", "kacang-midjourney")
	if len(adapter.Metadata().ImageParameters) == 0 {
		t.Fatal("packaged plugin is missing image parameter declarations")
	}
	request := GenerationRequest{Capability: CapabilityImage, Model: "mj-v8.2", Prompt: "portrait", ImageParameters: map[string]any{
		"size": "1:1", "count": 1, "seed": 0, "raw": false, "chaos": 0, "stylize": 450, "mjQuality": 0.5,
	}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	for name, expected := range map[string]any{"size": "1:1", "seed": float64(0), "raw": false, "chaos": float64(0), "stylize": float64(450), "quality": 0.5} {
		if body[name] != expected {
			t.Fatalf("%s = %#v, want %#v", name, body[name], expected)
		}
	}
	request.Model = "Midjourney v8.2 高速"
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("fast model accepted unsupported stable-only parameters")
	}
	request.Model = "mj-v8.2"
	request.ImageParameters["stylize"] = 1001
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("out of range value accepted")
	}
}

func TestImageParametersModelBoundsOverrideDefaultsButKeepBindings(t *testing.T) {
	minimum, maximum := 0.0, 100.0
	definitions := []ImageParameter{{Name: "amount", Label: "Amount", Type: "number", Min: &minimum, Max: &maximum, Binding: "providerOptions.example.amount"}}
	expanded := 101.0
	if resolved, err := ResolveImageParameters(definitions, []ImageParameter{{Name: "amount", Max: &expanded}}, "model"); err != nil || *resolved[0].Max != expanded {
		t.Fatalf("model bounds were not applied: %#v, %v", resolved, err)
	}
	resolved, err := ResolveImageParameters(definitions, []ImageParameter{{Name: "amount", Binding: "providerOptions.evil.amount", Pricing: true, Default: 0}}, "model")
	if err != nil {
		t.Fatal(err)
	}
	if resolved[0].Binding != definitions[0].Binding || resolved[0].Pricing {
		t.Fatalf("channel replaced trusted metadata: %#v", resolved[0])
	}
	if _, err := ResolveImageParameters(definitions, []ImageParameter{{Name: "invented"}}, "model"); err == nil {
		t.Fatal("undeclared field accepted")
	}
}

func TestImageParametersConfiguredValuesReachProvider(t *testing.T) {
	adapter := officialPackageAdapter(t, "kacang-midjourney.yingce-plugin", "kacang-midjourney")
	configured := append([]ImageParameter(nil), adapter.Metadata().ImageParameters...)
	maximum := 2000.0
	for i := range configured {
		if configured[i].Name == "stylize" {
			configured[i].Max = &maximum
		}
	}
	request := GenerationRequest{Capability: CapabilityImage, Model: "mj-v8.2", Prompt: "portrait", ImageParameters: map[string]any{"stylize": 1500}, ImageParameterSchema: configured}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if manifestTestBody(t, spec)["stylize"] != float64(1500) {
		t.Fatal("configured value lost before provider request")
	}
	request.ImageParameters["stylize"] = 2001
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("model bounds were not enforced")
	}
}

func TestImageParametersGeminiResolutionIsIndependentFromStaleQuality(t *testing.T) {
	adapter := officialPackageAdapter(t, "google-gemini-image.yingce-plugin", "gemini-image")
	request := GenerationRequest{Capability: CapabilityImage, Model: "image-model", Prompt: "portrait", ImageParameters: map[string]any{"imageResolution": "2k", "seed": 0}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	config := manifestTestBody(t, spec)["generationConfig"].(map[string]any)
	if config["imageConfig"].(map[string]any)["imageSize"] != "2K" || config["seed"] != float64(0) {
		t.Fatalf("mapped request: %#v", config)
	}
}
