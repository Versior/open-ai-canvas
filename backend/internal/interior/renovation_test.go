package interior

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func renovationFixture() RenovationSpec {
	return RenovationSpec{Scope: "wall", Stage: "renovation", WidthMM: 3600, HeightMM: 2600, Material: "marble", Finish: "honed", Pattern: "bookmatch", SlabWidthMM: 1800, SlabHeightMM: 2600, SeamMM: 2, WastePercent: 10, Lighting: "daylight", Preserve: "保留门窗"}
}

func TestRenovationValidationAndPrompt(t *testing.T) {
	spec := renovationFixture()
	if err := spec.Validate(); err != nil {
		t.Fatal(err)
	}
	prompt := spec.RenderPrompt()
	for _, want := range []string{"3600.0×2600.0 mm", "天然大理石", "左右对纹", "保留门窗", "不宣称工厂"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt lacks %s", want)
		}
	}
	for _, edit := range []func(*RenovationSpec){func(s *RenovationSpec) { s.WidthMM = math.NaN() }, func(s *RenovationSpec) { s.SeamMM = -1 }, func(s *RenovationSpec) { s.Material = "unknown" }, func(s *RenovationSpec) { s.Budget = -1 }, func(s *RenovationSpec) { s.Preserve = strings.Repeat("字", 301) }} {
		bad := spec
		edit(&bad)
		if bad.Validate() == nil {
			t.Fatal("invalid input accepted")
		}
	}
}

func TestProjectDocumentValidatesRenovation(t *testing.T) {
	spec := renovationFixture()
	payload, _ := json.Marshal(map[string]any{"version": 1, "rounds": []any{}, "professional": spec})
	if _, err := NormalizeProjectDocument(payload); err != nil {
		t.Fatal(err)
	}
	spec.SlabWidthMM = 0
	payload, _ = json.Marshal(map[string]any{"version": 1, "rounds": []any{}, "professional": spec})
	if _, err := NormalizeProjectDocument(payload); err == nil {
		t.Fatal("invalid renovation persisted")
	}
	payload, _ = json.Marshal(map[string]any{"version": 1, "rounds": []any{map[string]any{"professional": spec}}})
	if _, err := NormalizeProjectDocument(payload); err == nil {
		t.Fatal("invalid historical renovation persisted")
	}
}
