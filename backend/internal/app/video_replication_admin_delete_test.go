package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 真实拆解出 3 个关键帧和 1 张宫格，其中第 1 帧被画布用到：删记录时任务、分析、日志一起删，
// 没被用到的图删掉，被画布用到的那张保留并说明在哪用到，原视频不动。
func TestDeleteAdminVideoReplicationRemovesTheRecordAndUnusedImages(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	source := seedTeardownVideoResource(t, svc, "usr-teardown")
	inputJSON, _ := json.Marshal(videoTeardownInput{Version: 1, ResourceID: source.ID, Transcribe: false, MaxShots: 60, Fingerprint: "fp"})
	task := &model.Task{ID: "vt-admin-delete", UserID: "usr-teardown", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusRunning, Stage: "已领取", InputJSON: string(inputJSON)}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	if err := newTaskWorkerCoordinator(svc).processReplicationTeardown(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil || stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("teardown = %+v, %v", stored, err)
	}
	var bundle videoTeardownBundle
	if err := json.Unmarshal([]byte(stored.ResultJSON), &bundle); err != nil || len(bundle.Shots) != 3 || len(bundle.Grids) != 1 {
		t.Fatalf("bundle = %+v, %v", bundle, err)
	}
	if _, err := svc.SaveVideoReplicationAnalysis("usr-teardown", task.ID, teardownAnalysisPayload("要删的", 1, 2, 3)); err != nil {
		t.Fatal(err)
	}
	used := bundle.Shots[0].KeyframeResourceID
	if err := db.Create(&model.CanvasProject{ID: "canvas-uses-keyframe", UserID: "usr-teardown", Title: "拆解 · 测试", PayloadJSON: fmt.Sprintf(`{"nodes":[{"id":"frame-1","metadata":{"storageKey":"resource:%s"}}]}`, used)}).Error; err != nil {
		t.Fatal(err)
	}
	running := &model.Task{ID: "vt-admin-running", UserID: "usr-teardown", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusRunning}
	if err := db.Create(running).Error; err != nil {
		t.Fatal(err)
	}

	var authErr *AuthError
	if _, err := svc.DeleteAdminVideoReplication(&model.User{ID: "usr-teardown", Role: model.UserRoleUser}, task.ID); !errors.As(err, &authErr) || authErr.Status != 403 {
		t.Fatalf("non-admin delete err = %v", err)
	}
	if _, err := svc.DeleteAdminVideoReplication(videoReplicationTestAdmin, running.ID); !errors.As(err, &authErr) || authErr.Status != 400 {
		t.Fatalf("running delete err = %v", err)
	}
	for _, id := range []string{"missing", ""} {
		if _, err := svc.DeleteAdminVideoReplication(videoReplicationTestAdmin, id); !errors.As(err, &authErr) || authErr.Status != 404 {
			t.Fatalf("delete %q err = %v", id, err)
		}
	}

	result, err := svc.DeleteAdminVideoReplication(videoReplicationTestAdmin, task.ID)
	if err != nil || result.ImagesError != "" {
		t.Fatalf("delete = %+v, %v", result, err)
	}
	if len(result.DeletedResources) != 3 || len(result.KeptResources) != 1 || result.KeptResources[0].ID != used || len(result.KeptResources[0].References) == 0 || result.KeptResources[0].References[0].Kind != "画布" {
		t.Fatalf("deleted = %v, kept = %+v", result.DeletedResources, result.KeptResources)
	}
	if _, err := svc.repo.Task(task.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("task still readable: %v", err)
	}
	for name, query := range map[string]*gorm.DB{
		"results":   db.Model(&model.Result{}).Where("task_id = ?", task.ID),
		"task logs": db.Model(&model.TaskLog{}).Where("task_id = ?", task.ID),
		"images":    db.Model(&model.Resource{}).Where("id IN ?", result.DeletedResources),
	} {
		var count int64
		if err := query.Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("%s left = %d, %v", name, count, err)
		}
	}
	for _, id := range []string{source.ID, used} {
		if _, err := svc.repo.ResourceForUser("usr-teardown", id); err != nil {
			t.Fatalf("resource %s should be kept: %v", id, err)
		}
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ? AND target_id = ?", "video_replication.teardown.delete", task.ID).Count(&audits).Error; err != nil || audits != 1 {
		t.Fatalf("teardown delete audits = %d, %v", audits, err)
	}
	if _, err := svc.DeleteAdminVideoReplication(videoReplicationTestAdmin, task.ID); !errors.As(err, &authErr) || authErr.Status != 404 {
		t.Fatalf("second delete err = %v", err)
	}
}
