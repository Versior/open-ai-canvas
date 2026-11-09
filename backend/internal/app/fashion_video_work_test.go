package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func fashionVideoTestWork() map[string]any {
	var work map[string]any
	_ = json.Unmarshal([]byte(`{"id":"fashion_video_aaa","kind":"fashion-video","title":"视频换装","createdAt":"2026-11-09T00:00:00Z","model":"video-model","ratio":"9:16","resolution":"720p","draft":{"tool":"tryon","source":{"resourceId":"source_aaa","name":"原片","durationMs":12000,"width":720,"height":1280},"startMs":2000,"seconds":5,"models":[],"garments":[{"resourceId":"garment_aaa","name":"衣物"}],"faces":[],"region":"upper","audio":"mute","motion":"","note":"","authorized":true},"units":[{"id":"unit_aaa","title":"换装","prompt":"原视频换装","status":"pending","references":[{"resourceId":"garment_aaa","name":"衣物"}]}]}`), &work)
	return work
}
func fashionVideoRaw(t *testing.T, work map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(work)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func TestFashionVideoContract(t *testing.T) {
	if err := validateFashionWork(fashionVideoRaw(t, fashionVideoTestWork())); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"missing video": func(w map[string]any) { delete(w["draft"].(map[string]any), "source") },
		"out of range":  func(w map[string]any) { w["draft"].(map[string]any)["startMs"] = 10000 },
		"unauthorized":  func(w map[string]any) { w["draft"].(map[string]any)["authorized"] = false },
		"unpaired": func(w map[string]any) {
			w["units"].([]any)[0].(map[string]any)["references"] = []any{map[string]any{"resourceId": "other_image", "name": "wrong"}}
		},
		"unrendered success": func(w map[string]any) { w["units"].([]any)[0].(map[string]any)["status"] = "succeeded" },
		"invalid render": func(w map[string]any) {
			w["units"].([]any)[0].(map[string]any)["render"] = map[string]any{"started": true, "resourceId": "bad/id"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			work := fashionVideoTestWork()
			mutate(work)
			if validateFashionWork(fashionVideoRaw(t, work)) == nil {
				t.Fatal("invalid work accepted")
			}
		})
	}
}
func TestFashionVideoSaveReadRevisionAndResourceKinds(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	for id, kind := range map[string]string{"source_aaa": "video", "clip_aaa": "video", "garment_aaa": "image", "generated_aaa": "video", "rendered_aaa": "video"} {
		if err := db.Create(&model.Resource{ID: id, UserID: owner.ID, Kind: kind, Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	w := fashionVideoTestWork()
	w["clip"] = map[string]any{"key": "cut_aaa", "taskId": "split_aaa", "resourceId": "clip_aaa", "hasAudio": true}
	u := w["units"].([]any)[0].(map[string]any)
	u["resourceId"], u["status"], u["durationMs"], u["width"], u["height"] = "generated_aaa", "succeeded", 5000, 720, 1280
	u["render"] = map[string]any{"started": true, "taskId": "render_aaa", "resourceId": "rendered_aaa"}
	zero, one := int64(0), int64(1)
	raw := fashionVideoRaw(t, w)
	if _, err := svc.SaveProductVideo(owner, "fashion_video_aaa", raw, &zero); err != nil {
		t.Fatal(err)
	}
	listed, err := svc.ProductVideos(owner)
	if err != nil || len(listed.Items) != 1 {
		t.Fatalf("saved work not readable: %v", err)
	}
	if _, err := svc.SaveProductVideo(owner, "fashion_video_aaa", raw, &zero); err == nil {
		t.Fatal("stale revision accepted")
	}
	if _, err := svc.SaveProductVideo(&model.User{ID: "other-user"}, "another_work", raw, &zero); err == nil {
		t.Fatal("foreign media accepted")
	}
	for _, id := range []string{"source_aaa", "clip_aaa", "generated_aaa", "rendered_aaa"} {
		if err := db.Model(&model.Resource{}).Where("id = ?", id).Update("kind", "image").Error; err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SaveProductVideo(owner, "fashion_video_aaa", raw, &one); err == nil {
			t.Fatalf("%s image accepted as video", id)
		}
		if err := db.Model(&model.Resource{}).Where("id = ?", id).Update("kind", "video").Error; err != nil {
			t.Fatal(err)
		}
	}
}
