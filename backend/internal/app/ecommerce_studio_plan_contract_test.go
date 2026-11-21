package app

import (
	"strings"
	"testing"
)

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
	for _, expected := range []string{"JSON screens 正好 11 项", "detail-hero、detail-scene", "第 N 项必须对应模板第 N 项"} {
		if !strings.Contains(input.Config.SystemPrompt, expected) {
			t.Fatalf("missing final contract %q", expected)
		}
	}
	if strings.Contains(input.Config.SystemPrompt, "逐屏：HERO ") {
		t.Fatal("opaque reference roles leaked into worker instructions")
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
