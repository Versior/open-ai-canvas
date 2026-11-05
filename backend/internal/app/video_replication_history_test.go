package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedSucceededTeardownTask(t *testing.T, db *gorm.DB, userID string, shots int) *model.Task {
	t.Helper()
	bundle := videoTeardownBundle{Version: 1, Source: videoTeardownSource{ResourceID: "res-video", DurationMs: 9000, Width: 1080, Height: 1920}}
	for index := 1; index <= shots; index++ {
		bundle.Shots = append(bundle.Shots, videoTeardownShot{Index: index, StartMs: int64(index-1) * 1000, EndMs: int64(index) * 1000, Boundary: "cut", KeyframeTimeMs: int64(index-1)*1000 + 500, KeyframeResourceID: fmt.Sprintf("res-key-%d", index)})
	}
	payload, _ := json.Marshal(bundle)
	task := &model.Task{ID: fmt.Sprintf("vt-history-%d", time.Now().UnixNano()), UserID: userID, Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusSucceeded, Stage: "拆解完成", Progress: 100, ResultJSON: string(payload), CreatedAt: time.Now()}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func teardownAnalysisPayload(title string, shotNumbers ...int) []byte {
	rows := make([]map[string]any, 0, len(shotNumbers))
	for _, shot := range shotNumbers {
		rows = append(rows, map[string]any{"shotNumber": shot, "plotDescription": fmt.Sprintf("镜头 %d", shot)})
	}
	payload, _ := json.Marshal(map[string]any{"version": 1, "model": "text-model", "title": title, "summary": nil, "rows": rows})
	return payload
}

func TestVideoReplicationAnalysisSaveListAndDetail(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedSucceededTeardownTask(t, db, "usr-a", 2)

	if _, err := svc.SaveVideoReplicationAnalysis("usr-a", task.ID, teardownAnalysisPayload("第一版", 1, 2)); err != nil {
		t.Fatalf("save: %v", err)
	}
	// 重新分析覆盖旧结果，每个任务只留一份。
	saved, err := svc.SaveVideoReplicationAnalysis("usr-a", task.ID, teardownAnalysisPayload("第二版", 2, 1))
	if err != nil {
		t.Fatalf("resave: %v", err)
	}
	if !strings.Contains(string(saved.Analysis), "第二版") || saved.AnalyzedAt == nil {
		t.Fatalf("saved = %+v", saved)
	}
	results, err := svc.repo.TaskResultsByKind("usr-a", []string{task.ID}, videoReplicationAnalysisKind)
	if err != nil || len(results) != 1 {
		t.Fatalf("results = %d, %v", len(results), err)
	}

	records, err := svc.VideoReplications("usr-a")
	if err != nil || len(records) != 1 {
		t.Fatalf("records = %+v, %v", records, err)
	}
	record := records[0]
	if record.ID != task.ID || record.Title != "第二版" || record.Model != "text-model" || record.ShotCount != 2 || record.CoverResourceID != "res-key-1" || record.DurationMs != 9000 || record.AnalyzedAt == nil || !slices.Equal(record.PreviewResourceIDs, []string{"res-key-1", "res-key-2"}) || record.Width != 1080 || record.Height != 1920 {
		t.Fatalf("record = %+v", record)
	}
	detail, err := svc.VideoReplication("usr-a", task.ID)
	if err != nil || detail.Task == nil || detail.Task.ResultJSON == "" || !strings.Contains(string(detail.Analysis), "第二版") {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
	if others, err := svc.VideoReplications("usr-b"); err != nil || len(others) != 0 {
		t.Fatalf("other user records = %+v, %v", others, err)
	}
}

func TestVideoReplicationAnalysisRejectsMismatchedRowsAndForeignTasks(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedSucceededTeardownTask(t, db, "usr-a", 3)
	cases := map[string][]byte{
		"missing shot":   teardownAnalysisPayload("缺镜头", 1, 2),
		"duplicate shot": teardownAnalysisPayload("重复", 1, 1, 3),
		"out of range":   teardownAnalysisPayload("越界", 1, 2, 4),
		"bad version":    []byte(`{"version":2,"model":"m","rows":[{"shotNumber":1},{"shotNumber":2},{"shotNumber":3}]}`),
		"no model":       []byte(`{"version":1,"rows":[{"shotNumber":1},{"shotNumber":2},{"shotNumber":3}]}`),
		"not json":       []byte(`rows`),
	}
	for name, payload := range cases {
		var authErr *AuthError
		if _, err := svc.SaveVideoReplicationAnalysis("usr-a", task.ID, payload); !errors.As(err, &authErr) {
			t.Fatalf("%s: err = %v, want a validation error", name, err)
		}
	}
	var notFound *AuthError
	if _, err := svc.SaveVideoReplicationAnalysis("usr-b", task.ID, teardownAnalysisPayload("别人的", 1, 2, 3)); !errors.As(err, &notFound) {
		t.Fatalf("foreign task err = %v", err)
	}
	if _, err := svc.VideoReplication("usr-b", task.ID); !errors.As(err, &notFound) {
		t.Fatalf("foreign detail err = %v", err)
	}

	running := seedSucceededTeardownTask(t, db, "usr-a", 1)
	if err := db.Model(&model.Task{}).Where("id = ?", running.ID).Update("status", model.TaskStatusRunning).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveVideoReplicationAnalysis("usr-a", running.ID, teardownAnalysisPayload("未完成", 1)); err == nil {
		t.Fatal("running teardown accepted an analysis")
	}
}
