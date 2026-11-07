package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func fashionTestWork(tool string) json.RawMessage {
	return json.RawMessage(`{"id":"fashion_aaa","kind":"fashion","title":"换装","createdAt":"2026-11-07T00:00:00Z","model":"image-model","draft":{"tool":"` + tool + `","models":[{"resourceId":"model_aaa","name":"模特"}],"garments":[{"resourceId":"garment_aaa","name":"衣物"}],"faces":[],"poses":[],"note":""},"units":[{"id":"unit_aaa","title":"模特换装","prompt":"换装","status":"pending","references":[{"resourceId":"model_aaa","name":"模特"},{"resourceId":"garment_aaa","name":"衣物"}]}]}`)
}

func TestFashionWorkRejectsAmbiguousOrIncompleteInputs(t *testing.T) {
	if err := validateFashionWork(fashionTestWork("tryon")); err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"multi-model", "multi-garment", "face", "pose", "missing"} {
		if validateFashionWork(fashionTestWork(tool)) == nil {
			t.Fatalf("invalid %s accepted", tool)
		}
	}
	if err := validateFashionWork(json.RawMessage(`{"id":"video_aaa","title":"legacy"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestFashionSaveRequiresOwnedReadyImageResources(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	zero := int64(0)
	raw := fashionTestWork("tryon")
	if _, err := svc.SaveProductVideo(owner, "fashion_aaa", raw, &zero); err == nil {
		t.Fatal("missing resources accepted")
	}
	for _, id := range []string{"model_aaa", "garment_aaa"} {
		if err := db.Create(&model.Resource{ID: id, UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SaveProductVideo(owner, "fashion_aaa", raw, &zero); err != nil {
		t.Fatal(err)
	}
	var duplicate map[string]any
	if err := json.Unmarshal(raw, &duplicate); err != nil {
		t.Fatal(err)
	}
	unit := duplicate["units"].([]any)[0].(map[string]any)
	unit["resourceId"] = "model_aaa"
	unit["video"] = map[string]any{"model": "video-model", "seconds": 5, "prompt": "展示", "status": "succeeded", "resourceId": "model_aaa"}
	invalidVideo, _ := json.Marshal(duplicate)
	one := int64(1)
	if _, err := svc.SaveProductVideo(owner, "fashion_aaa", invalidVideo, &one); err == nil {
		t.Fatal("same image ID accepted as video output")
	}
	other := &model.User{ID: "another-user"}
	if _, err := svc.SaveProductVideo(other, "fashion_aaa", raw, &zero); err == nil {
		t.Fatal("cross-user images accepted")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "model_aaa").Update("kind", "video").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "fashion_aaa", raw, &one); err == nil {
		t.Fatal("video accepted as face reference")
	}
}
