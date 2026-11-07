package app

import (
	"testing"

	"yingce/backend/internal/interior"
)

func TestInteriorBothSurfacesHonorChosenModel(t *testing.T) {
	defaultModel := interior.ModelRef{LogicalModelID: "default", Model: "default-model"}
	chosen := interior.ModelRef{LogicalModelID: "chosen", Model: "chosen-model"}
	invalid := interior.ModelRef{LogicalModelID: "not-allowed", Model: "invalid-model"}
	for _, surface := range []string{interior.SurfaceQuick, interior.SurfacePro} {
		t.Run(surface, func(t *testing.T) {
			got, err := interiorModelChoice(surface, &chosen, &defaultModel, nil, []interior.ModelRef{chosen})
			if err != nil || !got.Same(chosen) {
				t.Fatalf("selected model was replaced: got=%+v err=%v", got, err)
			}
			if _, err := interiorModelChoice(surface, &invalid, &defaultModel, nil, []interior.ModelRef{chosen}); err == nil {
				t.Fatal("unavailable choice silently fell back to a paid default")
			}
			got, err = interiorModelChoice(surface, nil, &defaultModel, nil, []interior.ModelRef{chosen})
			if err != nil || !got.Same(defaultModel) {
				t.Fatalf("missing selection should use recommendation: got=%+v err=%v", got, err)
			}
		})
	}
}
