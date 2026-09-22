package domainmcp

import (
	"reflect"
	"testing"
)

func TestBuiltinCatalogContainsAllApprovedCapabilityPacks(t *testing.T) {
	catalog, err := NewCatalog(BuiltinPacks()...)
	if err != nil {
		t.Fatal(err)
	}

	want := map[string][]string{
		"commerce.product-insight": {"commerce.product_analyze", "commerce.competitor_compare", "commerce.selling_point_matrix", "commerce.audience_insights"},
		"social.xhs-trends":        {"social.xhs_trends", "social.xhs_topic_clusters", "social.xhs_content_plan", "social.xhs_post_review"},
		"social.douyin-trends":     {"social.douyin_trends", "social.douyin_hook_analysis", "social.douyin_content_plan", "social.douyin_video_review"},
		"film.references":          {"film.reference_search", "film.title_research", "film.lookbook_research", "film.character_reference", "film.scene_reference"},
		"brand.review":             {"brand.policy_compile", "brand.copy_compliance", "brand.visual_compliance", "brand.campaign_audit"},
		"commerce.hero-image":      {"commerce.hero_image_plan", "commerce.hero_image_variants", "commerce.hero_image_review"},
		"commerce.detail-page":     {"commerce.detail_page_plan", "commerce.detail_section_prompts", "commerce.detail_page_review"},
		"story.script":             {"story.premise_develop", "story.character_arc", "story.script_develop", "story.script_review", "story.continuity_check"},
		"story.short-motion":       {"story.short_drama_plan", "story.motion_comic_plan", "story.episode_outline", "story.episode_script", "story.storyboard_recipe", "story.episode_review"},
	}

	if got := len(catalog.Packs()); got != len(want) {
		t.Fatalf("catalog pack count = %d, want %d", got, len(want))
	}
	for packID, toolNames := range want {
		pack, ok := catalog.Pack(packID)
		if !ok {
			t.Fatalf("missing pack %q", packID)
		}
		gotNames := make([]string, 0, len(pack.Tools))
		for _, tool := range pack.Tools {
			if tool.Permission != PermissionReadOnly {
				t.Fatalf("tool %s permission = %q", tool.Name, tool.Permission)
			}
			gotNames = append(gotNames, tool.Name)
		}
		if !reflect.DeepEqual(gotNames, toolNames) {
			t.Fatalf("pack %s tools = %#v, want %#v", packID, gotNames, toolNames)
		}
	}
}

func TestCatalogRejectsDuplicatePacksAndTools(t *testing.T) {
	base := PackManifest{
		ID:          "pack.one",
		DisplayName: "Pack One",
		Version:     "1.0.0",
		Tools:       []ToolManifest{{Name: "pack.tool", Description: "A tool", Permission: PermissionReadOnly}},
	}
	if _, err := NewCatalog(base, base); err == nil {
		t.Fatal("duplicate pack ID accepted")
	}

	duplicateTool := base
	duplicateTool.ID = "pack.two"
	duplicateTool.DisplayName = "Pack Two"
	if _, err := NewCatalog(base, duplicateTool); err == nil {
		t.Fatal("duplicate tool name accepted")
	}
}

func TestCatalogReturnsDefensiveCopies(t *testing.T) {
	catalog, err := NewCatalog(PackManifest{
		ID:                   "pack.one",
		DisplayName:          "Pack One",
		Version:              "1.0.0",
		ProviderRequirements: []string{"search"},
		Tools: []ToolManifest{{
			Name:        "pack.tool",
			Description: "A tool",
			Permission:  PermissionReadOnly,
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	first := catalog.Packs()
	first[0].DisplayName = "mutated"
	first[0].ProviderRequirements[0] = "mutated-provider"
	first[0].Tools[0].Name = "mutated.tool"
	first[0].Tools[0].InputSchema["properties"].(map[string]any)["query"].(map[string]any)["type"] = "number"
	second := catalog.Packs()
	querySchema := second[0].Tools[0].InputSchema["properties"].(map[string]any)["query"].(map[string]any)
	if second[0].DisplayName != "Pack One" || second[0].ProviderRequirements[0] != "search" || second[0].Tools[0].Name != "pack.tool" || querySchema["type"] != "string" {
		t.Fatalf("catalog was mutated through public view: %#v", second)
	}
}
