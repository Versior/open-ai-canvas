package assets

import "testing"

func TestProductVideoFrozenInputsProtectReferences(t *testing.T) {
	refs, err := CollectDocumentResourceReferences(`{"creative":{"run":{"imageResourceIds":["input_image"]}},"units":[{"clipResourceId":"clip_video","input":{"imageResourceIds":["old_image"],"videoResourceId":"input_video"}}]}`)
	if err != nil || len(refs) != 4 {
		t.Fatalf("frozen inputs not protected: %+v %v", refs, err)
	}
}
