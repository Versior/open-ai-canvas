package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestCreativeCastRejectsMissingPersonAndVoice(t *testing.T) {
	for _, value := range []struct {
		scene, people, audio string
		identity             bool
	}{{"selling", "none", "mute", false}, {"selling", "model", "rewrite", false}, {"selling", "model", "mute", true}, {"documentary", "none", "mute", false}} {
		if validateCreativeCast(value.scene, value.people, value.audio, value.identity) == nil {
			t.Fatal("invalid scene cast accepted")
		}
	}
	if err := validateCreativeCast("selling", "model", "rewrite", true); err != nil {
		t.Fatal(err)
	}
	if err := validateCreativeCast("showcase", "none", "mute", false); err != nil {
		t.Fatal(err)
	}
}
func TestSellingPlanMustContainActualSpeakingShot(t *testing.T) {
	work := productCreativeDocument(t)
	raw, _ := json.Marshal(work["creative"].(map[string]any)["plans"].([]any)[0])
	var plan productCreativePlan
	if err := json.Unmarshal(raw, &plan); err != nil {
		t.Fatal(err)
	}
	var input []any
	_ = json.Unmarshal([]byte(plan.Input), &input)
	input[1].(map[string]any)["scene"] = "selling"
	input[3] = "model"
	input[4] = []any{[]string{"face_image", "face"}}
	input[6] = "rewrite"
	snapshot, _ := json.Marshal(input)
	plan.Input = string(snapshot)
	if plan.validate() == nil {
		t.Fatal("silent selling plan accepted")
	}
	plan.Shots[0].Speaker = true
	plan.Shots[0].Dialogue = "看看杯身"
	if err := plan.validate(); err != nil {
		t.Fatal(err)
	}
}

func productCreativeDocument(t *testing.T) map[string]any {
	t.Helper()
	brief := map[string]any{"scene": "showcase", "tone": "natural", "seconds": 8, "audience": "", "objective": "", "brand": ""}
	facts, _ := json.Marshal([]any{"测试杯", "容量500ml", []string{"product_image"}})
	input, _ := json.Marshal([]any{string(facts), brief, map[string]string{"platform": "douyin", "goal": "conversion", "style": "auto", "narrative": "auto", "continuity": "一致"}, "none", []any{}, []any{}, "mute", "zh", ""})
	shots := []any{}
	for index := range 2 {
		shots = append(shots, map[string]any{"index": index + 1, "startMs": index * 4000, "endMs": (index + 1) * 4000, "plot": "拿起杯子", "dialogue": "", "onScreenText": "", "treatment": "remake", "director": map[string]any{"beat": "demo", "framing": "close", "camera": "locked", "action": "拿起杯子", "evidence": "", "sound": "环境声", "transition": "cut", "purpose": "展示", "start": "静置", "end": "拿起", "lighting": "自然光"}})
	}
	strategy := map[string]any{"audience": "通勤人群", "insight": "了解用法", "proposition": "展示商品", "hook": "拿起杯子", "method": "demo", "narrative": "howto", "rationale": "操作清楚", "visual": "自然光", "sound": "环境声", "cta": "了解条件", "missing": []any{}}
	plan := map[string]any{"id": "plan_test", "input": string(input), "title": "商品操作", "strategy": strategy, "shots": shots}
	return map[string]any{"id": "creative_test", "title": "商品视频", "version": 2, "people": "none", "audio": "mute", "language": "zh", "product": map[string]any{"name": "测试杯", "sellingPoints": "容量500ml", "images": []any{map[string]string{"resourceId": "product_image"}}}, "shots": shots, "units": []any{}, "creative": map[string]any{"brief": brief, "plans": []any{plan}, "activePlanId": "plan_test", "confirmedInput": string(facts)}}
}
func marshalCreative(t *testing.T, work map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(work)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestCreativeTopicOfficialSources(t *testing.T) {
	for _, source := range []string{"douhot", "qianchuan", "oceanengine"} {
		raw, _ := json.Marshal(map[string]any{"scene": "selling", "tone": "natural", "seconds": 15, "topic": map[string]string{"source": source, "title": "示例使用教程", "url": "https://www.douyin.com/video/123", "fetchedAt": "2026-11-10T00:00:00Z"}})
		var brief productCreativeBrief
		if err := json.Unmarshal(raw, &brief); err != nil {
			t.Fatal(err)
		}
		if err := brief.validate(); err != nil {
			t.Fatal(err)
		}
		brief.Topic.URL = "https://www.douyin.com.evil.test/video/123"
		if brief.validate() == nil {
			t.Fatal("untrusted source saved")
		}
	}
}
func TestProductCreativeContractRejectsInvalidScript(t *testing.T) {
	if err := validateProductVideoCreative(marshalCreative(t, productCreativeDocument(t))); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"source", "timing", "proof", "speech", "missing", "scene", "frozen-style", "frozen-images"} {
		t.Run(name, func(t *testing.T) {
			work := productCreativeDocument(t)
			shot := work["shots"].([]any)[0].(map[string]any)
			switch name {
			case "source":
				work["source"] = map[string]string{"resourceId": "fake_source"}
			case "timing":
				shot["endMs"] = 3500
			case "proof":
				shot["director"].(map[string]any)["evidence"] = "未经确认的保温效果"
			case "speech":
				shot["dialogue"] = "静音模式不能有台词"
			case "missing":
				shot["director"].(map[string]any)["start"] = ""
			case "scene":
				work["creative"].(map[string]any)["brief"].(map[string]any)["scene"] = "invented"
			case "frozen-style", "frozen-images":
				plan := work["creative"].(map[string]any)["plans"].([]any)[0].(map[string]any)
				var input []any
				if err := json.Unmarshal([]byte(plan["input"].(string)), &input); err != nil {
					t.Fatal(err)
				}
				if name == "frozen-style" {
					input[2].(map[string]any)["style"] = "studio"
				} else {
					input[5] = []string{"invalid/image"}
				}
				encoded, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				plan["input"] = string(encoded)
			}
			if validateProductVideoCreative(marshalCreative(t, work)) == nil {
				t.Fatal("invalid creative accepted")
			}
		})
	}
}
func TestProductCreativeExpandedBriefAndTopic(t *testing.T) {
	for _, scene := range productCreativeScenes {
		for _, tone := range productCreativeTones {
			if err := (productCreativeBrief{Scene: scene, Tone: tone, Seconds: 15}).validate(); err != nil {
				t.Fatal(err)
			}
		}
	}
	work := productCreativeDocument(t)
	brief := work["creative"].(map[string]any)["brief"].(map[string]any)
	brief["topic"] = map[string]string{"source": "baidu", "title": "工艺记录", "url": "https://www.baidu.com/s?wd=test", "fetchedAt": "2026-11-10T00:00:00Z"}
	if err := validateProductVideoCreative(marshalCreative(t, work)); err != nil {
		t.Fatal(err)
	}
	brief["topic"].(map[string]string)["url"] = "https://example.com/trend"
	if validateProductVideoCreative(marshalCreative(t, work)) == nil {
		t.Fatal("invalid topic URL accepted")
	}
}
func TestProductCreativeRejectsMalformedOrWrongPurposeReferences(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	if err := db.Create(&model.Resource{ID: "product_image", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"model-id", "background-id", "audio-kind", "video-kind", "task-type", "object-id"} {
		t.Run(name, func(t *testing.T) {
			work := productCreativeDocument(t)
			switch name {
			case "model-id":
				work["models"] = []any{map[string]any{"resourceId": "invalid/image"}}
			case "background-id":
				work["backgrounds"] = []any{map[string]any{"resourceId": 17}}
			case "audio-kind":
				work["music"] = map[string]any{"resourceId": "product_image"}
			case "video-kind":
				work["render"] = map[string]any{"resourceId": "product_image"}
			case "task-type":
				work["render"] = map[string]any{"taskId": 17}
			case "object-id":
				work["backgrounds"] = []any{map[string]any{"resourceId": map[string]string{"id": "product_image"}}}
			}
			zero := int64(0)
			if _, err := svc.SaveProductVideo(owner, "creative_test", marshalCreative(t, work), &zero); err == nil {
				t.Fatal("invalid reference accepted")
			}
		})
	}
}
func TestProductCreativeSaveCASAndResourceIsolation(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	raw := marshalCreative(t, productCreativeDocument(t))
	zero := int64(0)
	if _, err := svc.SaveProductVideo(owner, "creative_test", raw, &zero); err == nil {
		t.Fatal("missing image accepted")
	}
	if err := db.Create(&model.Resource{ID: "product_image", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "creative_test", raw, &zero); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "creative_test", raw, &zero); err == nil {
		t.Fatal("stale revision accepted")
	}
	if _, err := svc.SaveProductVideo(&model.User{ID: "other-user"}, "creative_test", raw, &zero); err == nil {
		t.Fatal("cross-user image accepted")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "product_image").Update("kind", "video").Error; err != nil {
		t.Fatal(err)
	}
	one := int64(1)
	if _, err := svc.SaveProductVideo(owner, "creative_test", raw, &one); err == nil {
		t.Fatal("video accepted as product image")
	}
}
func TestProductCreativeTaskOwnership(t *testing.T) {
	svc, db, _, owner := newAdminStorageDeleteTestService(t)
	if err := db.Create(&model.Resource{ID: "product_image", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	work := productCreativeDocument(t)
	work["creative"].(map[string]any)["run"] = map[string]any{"id": "creative_run", "kind": "analysis", "input": "snapshot", "prompt": "分析", "model": "text", "imageResourceIds": []string{"product_image"}, "count": 2, "status": "running", "settled": false, "taskId": "task_other"}
	zero := int64(0)
	if err := db.Create(&model.Task{ID: "task_other", UserID: "other-user", Type: "canvas_text", Status: "queued"}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveProductVideo(owner, "creative_test", marshalCreative(t, work), &zero); err == nil {
		t.Fatal("cross-user task accepted")
	}
}
