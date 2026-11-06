package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func replicationPlanPayload(authorized bool, images []string, treatments ...string) []byte {
	shots := make([]map[string]any, 0, len(treatments))
	for index, treatment := range treatments {
		shots = append(shots, map[string]any{"shotNumber": index + 1, "treatment": treatment, "dialogue": "新台词"})
	}
	productImages := make([]map[string]any, 0, len(images))
	for _, id := range images {
		productImages = append(productImages, map[string]any{"resourceId": id, "width": 800, "height": 800})
	}
	payload, _ := json.Marshal(map[string]any{"version": 1, "authorized": authorized, "product": map[string]any{"name": "保温杯", "images": productImages}, "shots": shots})
	return payload
}

func TestVideoReplicationPlanSaveAndDetail(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedSucceededTeardownTask(t, db, "usr-a", 3)
	image := &model.Resource{ID: "res-product-a", UserID: "usr-a", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", CreatedAt: time.Now()}
	if err := db.Create(image).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, replicationPlanPayload(false, []string{"res-product-a"}, "product", "remake", "skip")); err != nil {
		t.Fatalf("save: %v", err)
	}
	saved, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, replicationPlanPayload(true, nil, "original", "remake", "product"))
	if err != nil {
		t.Fatalf("resave: %v", err)
	}
	if !strings.Contains(string(saved.Plan), `"original"`) || saved.PlanUpdatedAt == nil {
		t.Fatalf("saved = %+v", saved)
	}
	results, err := svc.repo.TaskResultsByKind("usr-a", []string{task.ID}, videoReplicationPlanKind)
	if err != nil || len(results) != 1 {
		t.Fatalf("plans = %d, %v", len(results), err)
	}
	detail, err := svc.VideoReplication("usr-a", task.ID)
	if err != nil || !strings.Contains(string(detail.Plan), `"original"`) || len(detail.Analysis) != 0 {
		t.Fatalf("detail = %+v, %v", detail, err)
	}

	// 记下按方案建的画布：列表里带方案时间和画布数。
	var withCanvas map[string]any
	_ = json.Unmarshal(replicationPlanPayload(true, nil, "original", "remake", "product"), &withCanvas)
	withCanvas["canvases"] = []map[string]any{{"id": "canvas-1", "title": "复刻 · 测试", "createdAt": "2026-11-06T00:00:00Z"}}
	payload, _ := json.Marshal(withCanvas)
	if _, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, payload); err != nil {
		t.Fatalf("save with canvas: %v", err)
	}
	records, err := svc.VideoReplications("usr-a")
	if err != nil || len(records) != 1 || records[0].PlanUpdatedAt == nil || records[0].CanvasCount != 1 {
		t.Fatalf("records = %+v, %v", records, err)
	}
	withCanvas["canvases"] = []map[string]any{{"id": ""}}
	payload, _ = json.Marshal(withCanvas)
	var authErr *AuthError
	if _, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, payload); !errors.As(err, &authErr) {
		t.Fatalf("empty canvas id err = %v", err)
	}
}

func TestVideoReplicationPlanRejectsInvalidPlans(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedSucceededTeardownTask(t, db, "usr-a", 2)
	foreign := &model.Resource{ID: "res-product-b", UserID: "usr-b", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", CreatedAt: time.Now()}
	video := &model.Resource{ID: "res-video-a", UserID: "usr-a", Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4", CreatedAt: time.Now()}
	if err := db.Create([]*model.Resource{foreign, video}).Error; err != nil {
		t.Fatal(err)
	}
	cases := map[string][]byte{
		"missing shot":       replicationPlanPayload(false, nil, "remake"),
		"bad treatment":      replicationPlanPayload(false, nil, "remake", "keep"),
		"unauthorized reuse": replicationPlanPayload(false, nil, "original", "remake"),
		"all skipped":        replicationPlanPayload(false, nil, "skip", "skip"),
		"foreign image":      replicationPlanPayload(false, []string{"res-product-b"}, "product", "remake"),
		"not an image":       replicationPlanPayload(false, []string{"res-video-a"}, "product", "remake"),
		"too many images":    replicationPlanPayload(false, []string{"a", "b", "c", "d", "e"}, "product", "remake"),
		"bad version":        []byte(`{"version":2,"shots":[{"shotNumber":1,"treatment":"remake"},{"shotNumber":2,"treatment":"remake"}]}`),
		"duplicate shot":     []byte(`{"version":1,"shots":[{"shotNumber":1,"treatment":"remake"},{"shotNumber":1,"treatment":"remake"}]}`),
	}
	for name, payload := range cases {
		var authErr *AuthError
		if _, err := svc.SaveVideoReplicationPlan("usr-a", task.ID, payload); !errors.As(err, &authErr) {
			t.Fatalf("%s: err = %v, want a validation error", name, err)
		}
	}
	var notFound *AuthError
	if _, err := svc.SaveVideoReplicationPlan("usr-b", task.ID, replicationPlanPayload(false, nil, "remake", "remake")); !errors.As(err, &notFound) {
		t.Fatalf("foreign task err = %v", err)
	}
}
