package app

import (
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func referenceReplicationDocument(t *testing.T, mode string) map[string]any {
	t.Helper()
	original := []any{map[string]any{"index": 1, "startMs": 0, "endMs": 4000, "keyframeResourceId": "source_frame_1"}, map[string]any{"index": 2, "startMs": 4000, "endMs": 8000, "keyframeResourceId": "source_frame_2"}}
	shots := []any{}
	ranges := [][2]int{{0, 4000}, {4000, 8000}}
	if mode == "style" {
		ranges = [][2]int{{0, 2000}, {2000, 5000}, {5000, 8000}}
	}
	for index, span := range ranges {
		shots = append(shots, map[string]any{"index": index + 1, "startMs": span[0], "endMs": span[1], "keyframeResourceId": "", "dialogue": "", "speaker": false, "treatment": "remake", "director": map[string]any{"beat": "demo", "framing": "close", "camera": "locked", "transition": "cut", "purpose": "展示木制扶手", "start": "椅子稳定置于窗边", "action": "展示木制扶手", "end": "木纹清晰可见", "lighting": "窗边侧光", "sound": "环境声", "evidence": "木制扶手"}})
	}
	source := map[string]any{"resourceId": "source_video", "teardownId": "source_teardown", "durationMs": 8000, "width": 720, "height": 1280}
	product := map[string]any{"name": "扶手椅", "sellingPoints": "木制扶手", "images": []any{map[string]any{"id": "target_image", "resourceId": "target_image"}}}
	input := map[string]any{"source": source, "mode": mode, "sourceShots": original, "targetDurationMs": 8000, "brief": "展示目标扶手", "people": "none", "audio": "mute", "language": "zh", "product": product}
	snapshot, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	style := map[string]any{}
	for _, key := range []string{"palette", "lighting", "texture", "composition", "camera", "editing", "sound"} {
		style[key] = "明确的参考风格与目标设计"
	}
	plan := map[string]any{"id": "reference_plan", "title": "扶手椅改编", "input": string(snapshot), "model": "vision_model", "createdAt": "2026-01-01T00:00:00Z", "style": style, "beats": []any{map[string]any{"shotNumber": 1, "purpose": "交代使用情境", "adaptation": "目标椅子稳定放置"}, map[string]any{"shotNumber": 2, "purpose": "展示细节", "adaptation": "改拍目标扶手"}}, "shots": shots}
	return map[string]any{"id": "reference_work", "version": 2, "title": "参考复刻", "source": source, "people": "none", "audio": "mute", "language": "zh", "product": product, "shots": shots, "replication": map[string]any{"mode": mode, "sourceShots": original, "targetDurationMs": 8000, "brief": "展示目标扶手", "confirmed": true, "plan": plan}}
}

func marshalReferenceReplication(t *testing.T, work map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(work)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestReferenceReplicationContractAndTargetTimeline(t *testing.T) {
	for _, mode := range []string{"structure", "style"} {
		if _, err := normalizeProductVideoItem("reference_work", marshalReferenceReplication(t, referenceReplicationDocument(t, mode))); err != nil {
			t.Fatal(mode, err)
		}
	}
	for _, name := range []string{"missing-style", "missing-beat", "structure-cut", "style-duration", "illegal-treatment", "missing-action", "false-proof", "original-audio", "missing-plan", "stale-subject", "current-false-proof", "bad-frozen-input"} {
		t.Run(name, func(t *testing.T) {
			mode := "structure"
			if name == "style-duration" {
				mode = "style"
			}
			work := referenceReplicationDocument(t, mode)
			r := work["replication"].(map[string]any)
			p := r["plan"].(map[string]any)
			shot := p["shots"].([]any)[0].(map[string]any)
			switch name {
			case "missing-style":
				delete(p["style"].(map[string]any), "lighting")
			case "missing-beat":
				p["beats"] = p["beats"].([]any)[:1]
			case "structure-cut":
				shot["endMs"] = 3000
			case "style-duration":
				r["targetDurationMs"] = 9000
			case "illegal-treatment":
				shot["treatment"] = "replace"
			case "missing-action":
				shot["director"].(map[string]any)["start"] = ""
			case "false-proof":
				shot["director"].(map[string]any)["evidence"] = "安全舒适"
			case "original-audio":
				work["audio"] = "original"
			case "missing-plan":
				delete(r, "plan")
			case "stale-subject":
				var product map[string]any
				data, _ := json.Marshal(work["product"])
				_ = json.Unmarshal(data, &product)
				product["name"] = "另一把椅子"
				work["product"] = product
			case "current-false-proof":
				current, _ := json.Marshal(work["shots"])
				var edited []map[string]any
				_ = json.Unmarshal(current, &edited)
				edited[0]["director"].(map[string]any)["evidence"] = "未经证实的性能"
				work["shots"] = edited
			case "bad-frozen-input":
				p["input"] = `{"mode":"structure","sourceShots":[{}]}`
			}
			if _, err := normalizeProductVideoItem("reference_work", marshalReferenceReplication(t, work)); err == nil {
				t.Fatal("invalid reference contract accepted")
			}
		})
	}
}

func TestReferenceReplicationSaveResourcesAndCAS(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	work := referenceReplicationDocument(t, "structure")
	raw := marshalReferenceReplication(t, work)
	zero := int64(0)
	if _, err := svc.SaveProductVideo(owner, "reference_work", raw, &zero); err == nil {
		t.Fatal("missing resources accepted")
	}
	for _, id := range []string{"source_video", "source_frame_1", "source_frame_2", "target_image"} {
		kind := "image"
		if id == "source_video" {
			kind = "video"
		}
		if err := db.Create(&model.Resource{ID: id, UserID: owner.ID, Kind: kind, Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SaveProductVideo(owner, "reference_work", raw, &zero); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "reference_work", raw, &zero); err == nil {
		t.Fatal("stale revision accepted")
	}
	if _, err := svc.SaveProductVideo(&model.User{ID: "other-user"}, "reference_work", raw, &zero); err == nil {
		t.Fatal("foreign reference images accepted")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "source_frame_2").Update("kind", "video").Error; err != nil {
		t.Fatal(err)
	}
	one := int64(1)
	if _, err := svc.SaveProductVideo(owner, "reference_work", raw, &one); err == nil {
		t.Fatal("video accepted as analysis keyframe")
	}
}

func TestReferenceReplicationRejectsForeignPlanningTask(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	for _, id := range []string{"source_video", "source_frame_1", "source_frame_2", "target_image"} {
		kind := "image"
		if id == "source_video" {
			kind = "video"
		}
		if err := db.Create(&model.Resource{ID: id, UserID: owner.ID, Kind: kind, Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Task{ID: "foreign_task", UserID: "other-user", Type: "canvas_text", Status: "queued"}).Error; err != nil {
		t.Fatal(err)
	}
	work := referenceReplicationDocument(t, "structure")
	r := work["replication"].(map[string]any)
	r["confirmed"] = false
	r["run"] = map[string]any{"key": "reference_run", "input": r["plan"].(map[string]any)["input"], "model": "vision_model", "imageCount": 2, "targetImageCount": 1, "requestSignature": strings.Repeat("a", 64), "createdAt": "2026-01-01T00:00:00Z", "taskId": "foreign_task"}
	zero := int64(0)
	if _, err := svc.SaveProductVideo(owner, "reference_work", marshalReferenceReplication(t, work), &zero); err == nil {
		t.Fatal("foreign planning task accepted")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "foreign_task").Updates(map[string]any{"user_id": owner.ID, "type": "canvas_video"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "reference_work", marshalReferenceReplication(t, work), &zero); err == nil {
		t.Fatal("video accepted as planning task")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "foreign_task").Update("type", "canvas_text").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "reference_work", marshalReferenceReplication(t, work), &zero); err != nil {
		t.Fatal(err)
	}
}

func TestReferenceReplicationFrozenResourcesCannotBypassOwnership(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	for _, id := range []string{"source_video", "source_frame_1", "source_frame_2", "target_image"} {
		kind := "image"
		if id == "source_video" {
			kind = "video"
		}
		if err := db.Create(&model.Resource{ID: id, UserID: owner.ID, Kind: kind, Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	work := referenceReplicationDocument(t, "structure")
	r := work["replication"].(map[string]any)
	r["confirmed"] = false
	p := r["plan"].(map[string]any)
	p["input"] = strings.ReplaceAll(p["input"].(string), "target_image", "foreign_image")
	if err := db.Create(&model.Resource{ID: "foreign_image", UserID: "other-user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	zero := int64(0)
	if _, err := svc.SaveProductVideo(owner, "reference_work", marshalReferenceReplication(t, work), &zero); err == nil {
		t.Fatal("foreign frozen image accepted")
	}
}
