package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAnalyticsBaseModelIdentityMatchesTasksRequestsAndFinance(t *testing.T) {
	tasks := []model.Task{
		{ID: "a", Model: "channel-a::image-model", Type: "canvas_image", UserID: "user", Status: model.TaskStatusSucceeded},
		{ID: "b", Model: "channel-b::image-model", Type: "canvas_image", UserID: "user", Status: model.TaskStatusFailed},
	}
	logs := []model.ApiCallLog{
		{ID: "request-a", TaskID: "a", Model: "image-model", Capability: "image", UserID: "user", Status: model.ApiCallStatusSucceeded},
		{ID: "request-b", TaskID: "b", Model: "channel-b::image-model", Capability: "image", UserID: "user", Status: model.ApiCallStatusFailed},
	}
	rows := buildAnalyticsModels(tasks, logs)
	if len(rows) != 1 || rows[0].Model != "image-model" || rows[0].Tasks != 2 || rows[0].Requests != 2 || rows[0].UniqueUsers != 1 {
		t.Fatalf("model rows = %+v", rows)
	}
	if rows[0].TaskSuccessRate == nil || *rows[0].TaskSuccessRate != 50 || rows[0].RequestSuccessRate == nil || *rows[0].RequestSuccessRate != 50 {
		t.Fatalf("success rates = %+v", rows[0])
	}
	result := AnalyticsOverview{Models: rows}
	applyAnalyticsFinance(&result, map[string]analyticsFinancialRecord{"a": {Log: logs[1], Revenue: 900_000}})
	if result.Models[0].Finance.RevenueMicrocredits != 900_000 {
		t.Fatalf("model finance = %+v", result.Models[0].Finance)
	}
}

func TestAdminAnalyticsModelAndChannelFiltersShareModelIdentity(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.BillingOrder{}, &model.ApiCallLog{}, &model.Task{}, &model.UserDailyActivity{}, &model.User{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for _, channel := range []string{"a", "b"} {
		task := model.Task{ID: "task-" + channel, UserID: "user", Model: channel + "::image_%model", Type: "canvas_image", Status: model.TaskStatusSucceeded, CreatedAt: now}
		log := model.ApiCallLog{ID: "log-" + channel, TaskID: task.ID, ChannelID: channel, UserID: "user", Model: "image_%model", Capability: "image", RequestKind: "create", Status: model.ApiCallStatusSucceeded, CreatedAt: now}
		if channel == "b" {
			log.Model = channel + "::image_%model"
		}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&log).Error; err != nil {
			t.Fatal(err)
		}
	}
	other := model.Task{ID: "unrelated", UserID: "user", Model: "a::image_Xmodel", Type: "canvas_image", CreatedAt: now}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	query := AnalyticsQuery{From: now.Add(-time.Hour).Format(time.RFC3339), To: now.Add(time.Hour).Format(time.RFC3339), Model: "image_%model"}
	admin := &model.User{Role: model.UserRoleAdmin}
	result, err := svc.AdminAnalytics(admin, query)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Models) != 1 || result.Models[0].Tasks != 2 || result.Models[0].Requests != 2 {
		t.Fatalf("all channels = %+v", result.Models)
	}
	query.ChannelID = "a"
	result, err = svc.AdminAnalytics(admin, query)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Models) != 1 || result.Models[0].Tasks != 1 || result.Models[0].Requests != 1 {
		t.Fatalf("one channel = %+v", result.Models)
	}
	query.ChannelID = "b"
	result, err = svc.AdminAnalytics(admin, query)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Models) != 1 || result.Models[0].Tasks != 1 || result.Models[0].Requests != 1 {
		t.Fatalf("prefixed log = %+v", result.Models)
	}
}
