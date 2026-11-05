package assets

import "testing"

func TestCollectDocumentResourceReferencesIncludesNestedVideoPreview(t *testing.T) {
	raw := `{"nodes":[{"id":"node-video","metadata":{"videoPreview":{"storageKey":"resource:poster-1","source":{"id":"nested-not-node","url":"/api/resources/poster-2/file"}}}}]}`
	refs, err := CollectDocumentResourceReferences(raw)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]DocumentResourceReference{}
	for _, ref := range refs {
		got[ref.ResourceID] = ref
	}
	if ref := got["poster-1"]; ref.Path != "nodes[node-video].metadata.videoPreview.storageKey" || ref.NodeID != "node-video" || ref.ReferenceType != "storageKey" {
		t.Fatalf("nested storageKey reference = %#v", ref)
	}
	if ref := got["poster-2"]; ref.Path != "nodes[node-video].metadata.videoPreview.source.url" || ref.NodeID != "node-video" {
		t.Fatalf("nested URL reference = %#v", ref)
	}
}

func TestCollectDocumentResourceReferencesUsesExplicitFieldsOnly(t *testing.T) {
	raw := `{"nodes":[{"id":"node-1","metadata":{"label":"resource:not-a-reference","videoPreview":{"resourceId":"poster-3"}}}],"log":"/api/resources/log-1/file"}`
	refs, err := CollectDocumentResourceReferences(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].ResourceID != "poster-3" || refs[0].NodeID != "node-1" || refs[0].ReferenceType != "resourceId" {
		t.Fatalf("references = %#v", refs)
	}
}

// 视频复刻的拆解结果：原视频、每镜关键帧和宫格都要算作引用，否则关键帧会被游离资源清理删掉。
func TestCollectDocumentResourceReferencesIncludesTeardownKeyframes(t *testing.T) {
	raw := `{"version":1,"source":{"resourceId":"res-src"},"shots":[{"index":1,"keyframeResourceId":"res-key-1"},{"index":2,"keyframeResourceId":"res-key-2"}],"grids":[{"resourceId":"res-grid-1","shotIndexes":[1,2]}]}`
	found := DocumentReferencedIDs(raw, map[string]struct{}{"res-src": {}, "res-key-1": {}, "res-key-2": {}, "res-grid-1": {}, "res-other": {}})
	for _, id := range []string{"res-src", "res-key-1", "res-key-2", "res-grid-1"} {
		if _, ok := found[id]; !ok {
			t.Fatalf("teardown bundle reference %s missing: %v", id, found)
		}
	}
	if _, ok := found["res-other"]; ok || len(found) != 4 {
		t.Fatalf("references = %v", found)
	}
}

func TestCollectDocumentResourceReferencesReportsInvalidJSON(t *testing.T) {
	if _, err := CollectDocumentResourceReferences(`{"nodes":`); err == nil {
		t.Fatal("expected malformed document to be rejected")
	}
}
