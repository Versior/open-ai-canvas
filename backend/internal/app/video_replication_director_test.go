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
