package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDirectorPlanSaveValidatesStrategy(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedSucceededTeardownTask(t, db, "usr-a", 1)
	var payload map[string]any
	if err := json.Unmarshal(replicationPlanPayload(false, nil, "remake"), &payload); err != nil {
		t.Fatal(err)
	}
	payload["campaign"] = videoReplicaCampaign{Platform: "douyin", Goal: "conversion", Style: "demo", Continuity: "商品一致"}
	raw, _ := json.Marshal(payload)
	if _, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, raw); err != nil {
		t.Fatal(err)
	}
	payload["campaign"] = videoReplicaCampaign{Platform: "bogus", Goal: "conversion", Style: "demo"}
	raw, _ = json.Marshal(payload)
	if _, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, raw); err == nil {
		t.Fatal("invalid platform saved")
	}
	d := videoReplicaDirection{Beat: "proof", Framing: "close", Camera: "locked", Transition: "cut", Action: strings.Repeat("字", 301)}
	if d.validate() == nil {
		t.Fatal("overlong action accepted")
	}
}

func TestProductVideoDirectorSaveValidation(t *testing.T) {
	for _, test := range []struct {
		raw   string
		valid bool
	}{
		{`{"id":"video-a","version":2,"campaign":{"platform":"amazon","goal":"education","style":"studio","continuity":"商品一致"},"shots":[]}`, true},
		{`{"id":"video-a","version":2,"campaign":{"platform":"invalid","goal":"education","style":"studio"}}`, false},
		{`{"id":"video-a","shots":[{"director":{"beat":"proof","framing":"invalid","camera":"locked","transition":"cut"}}]}`, false},
		{`{"id":"video-a","shots":[]}`, true},
	} {
		_, err := normalizeProductVideoItem("video-a", []byte(test.raw))
		if (err == nil) != test.valid {
			t.Fatalf("validation result: valid=%v err=%v", test.valid, err)
		}
	}
}

func TestExpandedDirectorChoicesAndStructuredPlanning(t *testing.T) {
	for _, platform := range videoDirectorPlatforms {
		for _, style := range videoDirectorStyles {
			if err := (videoReplicaCampaign{Platform: platform, Goal: "consideration", Style: style, Narrative: "objection", Audience: "家长", Focus: "佩戴步骤"}).validate(); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := (videoReplicaCampaign{Platform: "douyin", Goal: "education", Style: "tutorial", Audience: strings.Repeat("字", 201)}).validate(); err == nil {
		t.Fatal("overlong audience accepted")
	}
	strategy := videoReplicaStrategy{Audience: "家长", Insight: "如何调节", Proposition: "可调节鼻托", Hook: "调节动作", Method: "tutorial", Narrative: "howto", Rationale: "说明步骤", Visual: "浅暖色", Sound: "环境声", CTA: "核对尺寸"}
	var plan videoDirectorPlan
	if err := json.Unmarshal([]byte(`{"id":"synthetic-plan","input":"[]","lines":[{"shotNumber":1,"dialogue":"看步骤","director":{"beat":"proof","framing":"macro","camera":"topdown","transition":"cut","action":"轻压后松开","evidence":"柔软镜腿","purpose":"解释用法","start":"展开镜架","end":"回到原位","lighting":"柔和侧光"}}]}`), &plan); err != nil {
		t.Fatal(err)
	}
	plan.Strategy = strategy
	input, _ := json.Marshal([]any{map[string]string{"sellingPoints": "- 柔软镜腿\n12 小时保温"}, nil, "none", []any{}, []any{}, "rewrite", "zh", "", []any{map[string]any{"index": 1, "treatment": "remake"}}})
	plan.Input = string(input)
	raw, _ := json.Marshal(map[string]any{"id": "video_synthetic", "version": 2, "directorPlans": []videoDirectorPlan{plan}, "activeDirectorPlanId": plan.ID})
	if err := validateProductVideoDirector(raw); err != nil {
		t.Fatal(err)
	}
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	zero := int64(0)
	if _, err := s.SaveProductVideo(admin, "video_synthetic", raw, &zero); err != nil {
		t.Fatal("structured planning could not be saved", err)
	}
	loaded, err := s.ProductVideo(admin, "video_synthetic")
	if err != nil || !strings.Contains(string(loaded.Item), `"activeDirectorPlanId":"synthetic-plan"`) || !strings.Contains(string(loaded.Item), `"rationale":"说明步骤"`) {
		t.Fatal("structured planning lost on reload", err)
	}
	if _, err := s.SaveProductVideo(admin, "video_synthetic", raw, &zero); err == nil {
		t.Fatal("planning save bypassed revision conflict")
	}
	plan.Lines[0].Director.Evidence = "12 小时保温"
	if err := plan.validate(); err != nil {
		t.Fatal("numeric fact prefix was removed", err)
	}
	plan.Lines[0].Director.Evidence = "不存在的事实"
	if err := plan.validate(); err == nil {
		t.Fatal("invented proof accepted")
	}
	plan.Lines[0].Director.Evidence = "柔软镜腿"
	plan.Strategy.Rationale = ""
	raw, _ = json.Marshal(map[string]any{"directorPlans": []videoDirectorPlan{plan}})
	if err := validateProductVideoDirector(raw); err == nil {
		t.Fatal("incomplete strategy accepted")
	}
}
