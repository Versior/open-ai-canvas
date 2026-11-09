package app

import (
	"bytes"
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestInteriorDrawingBaselineMatchesOwnedBytesAcrossUploads(t *testing.T) {
	s, _ := newTimelineTaskTestService(t)
	s.dataDir = t.TempDir()
	owner := &model.User{ID: "synthetic-owner"}
	store := func(user, name string, data []byte, mime string) string {
		t.Helper()
		resource, _, err := s.storeResource(user, "file", name, mime, int64(len(data)), 1, 1, 0, bytes.NewReader(data), nil, false)
		if err != nil {
			t.Fatal(err)
		}
		return resource.ID
	}
	image := []byte("synthetic drawing pixels")
	original := store(owner.ID, "plan.png", image, "image/png")
	reupload := store(owner.ID, "renamed.png", image, "image/png")
	different := store(owner.ID, "other.png", []byte("other drawing pixels"), "image/png")
	foreign := store("synthetic-foreign", "foreign.png", image, "image/png")
	scene := store(owner.ID, "scene.json", []byte(`{"version":2,"spec":{"grid":{"source":"drawing"}}}`), "application/json")
	input := InteriorProjectInput{Name: "Measured layout", Kind: "home"}
	input.Document, _ = json.Marshal(map[string]any{"version": 1, "rounds": []any{}, "scenes": []any{map[string]any{
		"id": "synthetic-scene", "status": "succeeded", "title": "Measured", "drawingBaseline": true,
		"reference": map[string]string{"resourceId": original}, "sceneFile": map[string]string{"resourceId": scene},
	}}})
	project, err := s.CreateInteriorProject(owner, input)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := s.InteriorDrawingBaseline(owner, reupload)
	if err != nil || baseline == nil || baseline.ProjectID != project.ID || baseline.SceneFile.ResourceID != scene {
		t.Fatalf("same bytes did not resolve approved baseline: %v", err)
	}
	if baseline, err = s.InteriorDrawingBaseline(owner, different); err != nil || baseline != nil {
		t.Fatal("different drawing reused geometry", err)
	}
	if _, err = s.InteriorDrawingBaseline(owner, foreign); err == nil {
		t.Fatal("foreign source bypassed ownership")
	}
	if _, err = s.InteriorDrawingBaseline(nil, reupload); err == nil {
		t.Fatal("anonymous lookup allowed")
	}
	if baseline, err = s.InteriorDrawingBaseline(&model.User{ID: "synthetic-foreign"}, foreign); err != nil || baseline != nil {
		t.Fatal("cross-user baseline exposed", err)
	}
	input.ExpectedRevision = &project.Revision
	input.Document, _ = json.Marshal(map[string]any{"version": 1, "rounds": []any{}, "scenes": []any{map[string]any{
		"id": "synthetic-scene", "status": "succeeded", "drawingBaseline": false,
		"reference": map[string]string{"resourceId": original}, "sceneFile": map[string]string{"resourceId": scene},
	}}})
	if _, err = s.SaveInteriorProject(owner, project.ID, input); err != nil {
		t.Fatal(err)
	}
	if baseline, err = s.InteriorDrawingBaseline(owner, reupload); err != nil || baseline != nil {
		t.Fatal("unapproved generated scene reused", err)
	}
}
