package assets

import (
	"encoding/json"
	"testing"
)

func TestReferenceReplicationFrozenResourcesRemainReferenced(t *testing.T) {
	snapshot, _ := json.Marshal(map[string]any{"source": map[string]any{"resourceId": "reference_video"}, "product": map[string]any{"images": []any{map[string]any{"resourceId": "old_target_image"}}}})
	raw, _ := json.Marshal(map[string]any{"replication": map[string]any{"plan": map[string]any{"input": string(snapshot)}, "run": map[string]any{"input": string(snapshot)}}})
	references, err := CollectDocumentResourceReferences(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 4 {
		t.Fatalf("frozen plan and run references lost: %v", references)
	}
	for _, ref := range references {
		if ref.ResourceID != "reference_video" && ref.ResourceID != "old_target_image" {
			t.Fatal(ref)
		}
	}
}
