package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedVideoReplicationAdminData(t *testing.T, db *gorm.DB) (aliceTasks []*model.Task, failed *model.Task) {
	t.Helper()
	for _, user := range []model.User{
		{ID: "usr-alice", Username: "alice", DisplayName: "Alice", Email: "alice@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "usr-bob", Username: "bob", DisplayName: "Bob", Email: "bob@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 按创建顺序：older、newer、失败的拆解和两次链接导入，列表应倒序。
	older := seedSucceededTeardownTask(t, db, "usr-alice", 2)
	newer := seedSucceededTeardownTask(t, db, "usr-alice", 3)
	if err := db.Create(&model.Result{ID: "res-analysis", UserID: "usr-alice", TaskID: newer.ID, Kind: videoReplicationAnalysisKind, Payload: string(teardownAnalysisPayload("爆款开箱", 1, 2, 3)), CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	failed = &model.Task{ID: "vt-admin-failed", UserID: "usr-bob", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusFailed, Stage: "视频拆解失败", Error: "无法识别视频文件", CreatedAt: time.Now()}
	for _, task := range []*model.Task{
		failed,
		{ID: "sv-admin-ok", UserID: "usr-bob", Type: model.TaskTypeSocialVideoImport, Provider: "douyin", Status: model.TaskStatusSucceeded, CreatedAt: time.Now()},
		{ID: "sv-admin-failed", UserID: "usr-bob", Type: model.TaskTypeSocialVideoImport, Provider: "kuaishou", Status: model.TaskStatusFailed, Error: "解析接口都失败了", CreatedAt: time.Now()},
		{ID: "tsk-other", UserID: "usr-bob", Type: "canvas_text", Status: model.TaskStatusFailed, CreatedAt: time.Now()},
	} {
		if err := db.Create(task).Error; err != nil {
			t.Fatal(err)
		}
	}
	return []*model.Task{newer, older}, failed
}

func TestAdminVideoReplicationListDetailAndOverview(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	alice, failed := seedVideoReplicationAdminData(t, db)
	user := &model.User{ID: "usr-alice", Role: model.UserRoleUser}
	var authErr *AuthError
	if _, err := svc.AdminVideoReplications(user, AdminVideoReplicationQuery{}); !errors.As(err, &authErr) || authErr.Status != 403 {
		t.Fatalf("non-admin list err = %v", err)
	}
	if _, err := svc.AdminVideoReplicationOverview(user); !errors.As(err, &authErr) || authErr.Status != 403 {
		t.Fatalf("non-admin overview err = %v", err)
	}

	page, err := svc.AdminVideoReplications(videoReplicationTestAdmin, AdminVideoReplicationQuery{})
	if err != nil || page.Total != 3 || len(page.Records) != 3 || page.Page != 1 || page.Limit != 20 {
		t.Fatalf("page = %+v, %v", page, err)
	}
	byID := map[string]AdminVideoReplicationRecord{}
	for _, record := range page.Records {
		byID[record.ID] = record
	}
	if record := byID[alice[0].ID]; record.User.Username != "alice" || record.Title != "爆款开箱" || record.ShotCount != 3 || record.AnalyzedAt == nil || record.CoverResourceID != "res-key-1" {
		t.Fatalf("analyzed record = %+v", record)
	}
	if record := byID[failed.ID]; record.User.DisplayName != "Bob" || record.Error != "无法识别视频文件" || record.Status != model.TaskStatusFailed {
		t.Fatalf("failed record = %+v", record)
	}
	if page.Records[len(page.Records)-1].ID != alice[1].ID {
		t.Fatalf("records are not newest first: %+v", page.Records)
	}
	for query, want := range map[AdminVideoReplicationQuery]int64{
		{Status: "failed"}:                     1,
		{Keyword: "ALICE"}:                     2,
		{Keyword: "bob@example"}:               1,
		{Keyword: alice[1].ID}:                 1,
		{Keyword: "nobody"}:                    0,
		{Status: "succeeded", Keyword: "bob"}:  0,
		{Status: "succeeded", Keyword: "alic"}: 2,
	} {
		filtered, err := svc.AdminVideoReplications(videoReplicationTestAdmin, query)
		if err != nil || filtered.Total != want {
			t.Fatalf("query %+v: total = %v, %v, want %d", query, filtered, err, want)
		}
	}
	if _, err := svc.AdminVideoReplications(videoReplicationTestAdmin, AdminVideoReplicationQuery{Status: "done"}); !errors.As(err, &authErr) || authErr.Status != 400 {
		t.Fatalf("invalid status err = %v", err)
	}

	detail, err := svc.AdminVideoReplication(videoReplicationTestAdmin, alice[0].ID)
	if err != nil || detail.User.Username != "alice" || detail.Task == nil || detail.Task.ResultJSON == "" || !strings.Contains(string(detail.Analysis), "爆款开箱") || detail.AnalyzedAt == nil {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
	if detail, err := svc.AdminVideoReplication(videoReplicationTestAdmin, failed.ID); err != nil || detail.Task.Error != "无法识别视频文件" {
		t.Fatalf("failed detail = %+v, %v", detail, err)
	}
	for _, id := range []string{"sv-admin-ok", "missing", ""} {
		if _, err := svc.AdminVideoReplication(videoReplicationTestAdmin, id); !errors.As(err, &authErr) || authErr.Status != 404 {
			t.Fatalf("detail %q err = %v", id, err)
		}
	}

	overview, err := svc.AdminVideoReplicationOverview(videoReplicationTestAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if teardowns := overview.Teardowns; teardowns.Total != 3 || teardowns.Succeeded != 2 || teardowns.Failed != 1 || teardowns.Users != 2 || teardowns.Today != 3 || teardowns.Last7Days != 3 {
		t.Fatalf("teardown stats = %+v", teardowns)
	}
	if imports := overview.Imports; imports.Total != 2 || imports.Succeeded != 1 || imports.Failed != 1 || imports.Users != 1 || imports.Today != 2 {
		t.Fatalf("import stats = %+v", imports)
	}
	if overview.Analyzed != 1 || len(overview.ImportPlatforms) != 2 || overview.ImportPlatforms[0].Name != "抖音" || overview.ImportPlatforms[1].Failed != 1 {
		t.Fatalf("analyzed = %d, platforms = %+v", overview.Analyzed, overview.ImportPlatforms)
	}
	if len(overview.Daily) != adminVideoReplicationTrendDays {
		t.Fatalf("daily = %+v", overview.Daily)
	}
	if today := overview.Daily[len(overview.Daily)-1]; today.Date != time.Now().UTC().Format("2006-01-02") || today.Teardowns != 3 || today.Imports != 2 || today.Failed != 2 {
		t.Fatalf("today = %+v", today)
	}
	kinds := []string{}
	for _, failure := range overview.RecentFailures {
		kinds = append(kinds, failure.Kind+":"+failure.User.Username)
	}
	if len(kinds) != 2 || !strings.Contains(strings.Join(kinds, ","), "teardown:bob") || !strings.Contains(strings.Join(kinds, ","), "import:bob") {
		t.Fatalf("recent failures = %+v", overview.RecentFailures)
	}
	if overview.Settings.MaxShots != 60 || !overview.Transcription.Enabled {
		t.Fatalf("overview settings = %+v, transcription = %+v", overview.Settings, overview.Transcription)
	}
}
