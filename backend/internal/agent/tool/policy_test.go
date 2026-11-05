package tool

import (
	"reflect"
	"sort"
	"testing"
)

// 迁移前散落在 app 包里的分类表，逐字抄录用于证明注册表推导结果等价。
var (
	legacyWrite      = []string{"canvas_apply_ops", "canvas_arrange_nodes", "generate_media", "image_layer_split", "canvas_create_storyboard", "canvas_edit_storyboard", "canvas_edit_batch_table", "canvas_create_character", "previs_scene_create", "previs_apply_patch", "drama_adopt_canvas_media", "generate_media_batch", "canvas_build_board", "studio_plan_shots", "studio_update_dossier"}
	legacyCacheable  = []string{"agent_profile_read", "canvas_get_state", "canvas_read_storyboard", "previs_scene_read", "skill_read_file", "model_list"}
	legacyReadOnly   = []string{"agent_profile_read", "canvas_get_state", "canvas_read_text", "canvas_read_storyboard", "previs_scene_read", "canvas_read_batch_table", "canvas_list_node_types", "skill_read_file", "skill_search", "skill_market_search", "model_list", "task_get", "drama_get_context", "canvas_preflight", "studio_get_state"}
	legacyCanvasRev  = []string{"canvas_get_state", "canvas_read_text", "canvas_read_storyboard", "previs_scene_read"}
	legacyOffsetNorm = []string{"skill_read_file", "canvas_get_state", "canvas_read_text", "canvas_read_storyboard", "canvas_read_batch_table"}
	legacyMedia      = []string{"generate_media", "image_layer_split", "generate_media_batch"}
)

func pick(pred func(Policy) bool) []string {
	out := []string{}
	for _, name := range Names() {
		if pred(Of(name)) {
			out = append(out, name)
		}
	}
	return out
}

func sorted(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func TestRegistryMatchesLegacyClassification(t *testing.T) {
	cases := []struct {
		name string
		want []string
		pred func(Policy) bool
	}{
		{"write", legacyWrite, Policy.Write},
		{"cacheable", legacyCacheable, func(p Policy) bool { return p.Cacheable }},
		{"readOnly", legacyReadOnly, Policy.ReadOnly},
		{"canvasRevision", legacyCanvasRev, func(p Policy) bool { return p.CacheScope == CacheCanvasRevision }},
		{"offsetDefaults", legacyOffsetNorm, func(p Policy) bool { return len(p.OffsetDefaults) > 0 }},
		{"media", legacyMedia, Policy.Media},
	}
	for _, tc := range cases {
		if got := pick(tc.pred); !reflect.DeepEqual(got, sorted(tc.want)) {
			t.Errorf("%s: got %v want %v", tc.name, got, sorted(tc.want))
		}
	}
}

func TestCacheableToolsAreReadOnly(t *testing.T) {
	for _, name := range Names() {
		p := Of(name)
		if p.Cacheable && !p.ReadOnly() {
			t.Errorf("%s 可缓存但不是只读工具", name)
		}
	}
}

func TestMarketplaceSkillDiscoveryRunsOutsideCheckpointTransaction(t *testing.T) {
	if !Of(SkillSearch).OutsideTransaction {
		t.Fatal("skill_search performs catalog and package IO inside the checkpoint transaction")
	}
}

// 生图台工具只在服务端校验过商品归属的 studio 范围里出现；画布范围看不到它们，
// 出图请求在只读模式下隐藏，且任何生图台工具都不是收费媒体工具。
func TestStudioToolsFollowStudioScope(t *testing.T) {
	for _, name := range []string{StudioGetState, StudioUpdateDossier, StudioPlanShots, StudioRequestGeneration} {
		if Of(name).Allowed(Scope{Canvas: true, Skills: true, Vision: true, Memory: true, IncludeProfile: true}) {
			t.Errorf("%s exposed in a canvas run", name)
		}
		if !Of(name).Allowed(Scope{Studio: true, IncludeProfile: true}) {
			t.Errorf("%s hidden in a studio run", name)
		}
		if Of(name).Media() || Of(name).ApprovalRequired("auto") {
			t.Errorf("%s must not be a billed media tool", name)
		}
	}
	if Of(StudioInspectPhotos).Allowed(Scope{Studio: true}) || !Of(StudioInspectPhotos).Allowed(Scope{Studio: true, Vision: true}) {
		t.Error("studio_inspect_photos must follow the run's vision capability")
	}
	readOnly := Scope{Studio: true, ReadOnly: true}
	if !Of(StudioGetState).Allowed(readOnly) || Of(StudioUpdateDossier).Allowed(readOnly) || Of(StudioPlanShots).Allowed(readOnly) || Of(StudioRequestGeneration).Allowed(readOnly) {
		t.Error("read_only studio runs may read but never write or request generation")
	}
	for _, name := range []string{CanvasGetState, CanvasApplyOps, GenerateMedia, ModelList} {
		if Of(name).Allowed(Scope{Studio: true, Vision: true, Skills: true}) {
			t.Errorf("canvas tool %s leaked into a studio run", name)
		}
	}
}

// 技能工具的可见性只由服务端推导的 Scope.Skills 决定，不由模型或预装状态决定。
func TestSkillVisibilityFollowsServerScope(t *testing.T) {
	for _, name := range []string{SkillReadFile, SkillSearch} {
		if Of(name).Allowed(Scope{Canvas: true, IncludeProfile: true}) {
			t.Errorf("%s exposed without server-derived skills scope", name)
		}
		if !Of(name).Allowed(Scope{Canvas: true, IncludeProfile: true, Skills: true}) {
			t.Errorf("%s hidden despite server-derived skills scope", name)
		}
	}
}
