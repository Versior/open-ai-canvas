package app

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedInteriorAdminTask(t *testing.T, db *gorm.DB, id, userID string, status model.TaskStatus, meta map[string]any, createdAt time.Time) {
	t.Helper()
	// 和 createInteriorTask 写入的输入同一结构：原图排第一，metadata.source 标记来源。
	input := map[string]any{
		"mode":            "image",
		"prompt":          "把这间" + id + "改成新风格",
		"metadata":        map[string]any{"source": interiorTaskSource, "interior": meta},
		"referenceImages": []map[string]any{{"resourceId": "res-src-" + id, "slotKey": "source"}, {"resourceId": "res-ref-" + id, "slotKey": "reference"}},
	}
	raw, _ := json.Marshal(input)
	task := model.Task{ID: id, UserID: userID, Type: "canvas_image", Operation: "image", Status: status, Model: "CHANNEL_000001::gpt-image-2", InputJSON: string(raw), CreatedAt: createdAt, UpdatedAt: createdAt}
	if status == model.TaskStatusSucceeded {
		task.ResultJSON = `{"images":[{"resourceId":"res-out-` + id + `","url":"/api/resources/res-out-` + id + `/file"}],"mode":"image"}`
	}
	if status == model.TaskStatusFailed {
		task.Error = "上游返回 500"
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
}

func TestAdminInteriorOverviewAndGenerations(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	if _, err := svc.EnsureBuiltinInteriorCatalog(); err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{{ID: "usr-int-a", Username: "alice", DisplayName: "爱丽丝", Role: model.UserRoleUser}, {ID: "usr-int-b", Username: "bob", Role: model.UserRoleUser}} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	project := model.InteriorProject{ID: "proj-int-1", UserID: "usr-int-a", Name: "我家客厅", Kind: "home", DocumentJSON: `{"version":1,"rounds":[]}`, Revision: 1}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	seedInteriorAdminTask(t, db, "int-1", "usr-int-a", model.TaskStatusSucceeded, map[string]any{"modeKey": "style-redesign", "surface": "quick", "roomKey": "living-room", "styleKey": "modern-minimal", "projectId": project.ID, "params": map[string]string{"scope": "soft"}}, now.Add(-time.Hour))
	seedInteriorAdminTask(t, db, "int-2", "usr-int-a", model.TaskStatusFailed, map[string]any{"modeKey": "style-redesign", "surface": "pro", "roomKey": "living-room", "styleKey": "wabi-sabi"}, now.Add(-2*time.Hour))
	seedInteriorAdminTask(t, db, "int-3", "usr-int-b", model.TaskStatusRunning, map[string]any{"modeKey": "text-edit", "surface": "quick"}, now.AddDate(0, 0, -3))
	// 超出 30 天窗口的不计入统计，但列表里还在。
	seedInteriorAdminTask(t, db, "int-old", "usr-int-b", model.TaskStatusSucceeded, map[string]any{"modeKey": "text-edit", "surface": "quick"}, now.AddDate(0, 0, -40))
	// 电商生图台的生图任务不是室内设计任务。
	studio := model.Task{ID: "studio-1", UserID: "usr-int-a", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"source":"ecommerce-studio"},"mode":"image"}`, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&studio).Error; err != nil {
		t.Fatal(err)
	}

	var authErr *AuthError
	if _, err := svc.AdminInteriorOverview(&model.User{ID: "usr-int-a", Role: model.UserRoleUser}); !errors.As(err, &authErr) || authErr.Status != 403 {
		t.Fatalf("non-admin overview err = %v", err)
	}
	overview, err := svc.AdminInteriorOverview(videoReplicationTestAdmin)
	if err != nil {
		t.Fatal(err)
	}
	g := overview.Generations
	if g.Total != 3 || g.Succeeded != 1 || g.Failed != 1 || g.Running != 1 || g.Users != 2 || g.Last7Days != 3 || g.Quick != 2 || g.Pro != 1 || overview.Truncated {
		t.Fatalf("generation stats = %+v", g)
	}
	if overview.Projects != (AdminInteriorProjectStats{Total: 1, Home: 1, Users: 1}) {
		t.Fatalf("project stats = %+v", overview.Projects)
	}
	if len(overview.Daily) != 14 || overview.Daily[13].Total+overview.Daily[12].Total < 2 {
		t.Fatalf("daily = %+v", overview.Daily)
	}
	if len(overview.Modes) != 2 || overview.Modes[0].Key != "style-redesign" || overview.Modes[0].Total != 2 || overview.Modes[0].Failed != 1 || overview.Modes[0].Name == "style-redesign" {
		t.Fatalf("modes = %+v", overview.Modes)
	}
	if len(overview.Rooms) != 1 || overview.Rooms[0].Total != 2 || len(overview.Styles) != 2 || len(overview.Models) != 1 || overview.Models[0].Name != "gpt-image-2" {
		t.Fatalf("rooms = %+v styles = %+v models = %+v", overview.Rooms, overview.Styles, overview.Models)
	}
	if len(overview.RecentFailures) != 1 || overview.RecentFailures[0].ID != "int-2" || overview.RecentFailures[0].User.Username != "alice" || overview.RecentFailures[0].Error != "上游返回 500" {
		t.Fatalf("failures = %+v", overview.RecentFailures)
	}
	if overview.Config.SiteDefaultModel || overview.Config.EnabledModes == 0 || len(overview.Config.ModesWithoutModel) != overview.Config.EnabledModes {
		t.Fatalf("config hint = %+v", overview.Config)
	}

	page, err := svc.AdminInteriorGenerations(videoReplicationTestAdmin, AdminInteriorGenerationQuery{})
	if err != nil || page.Total != 4 || len(page.Records) != 4 || page.Records[0].ID != "int-1" {
		t.Fatalf("all generations = %+v, %v", page, err)
	}
	first := page.Records[0]
	if first.SourceResourceID != "res-src-int-1" || len(first.ReferenceResourceIDs) != 1 || len(first.OutputResourceIDs) != 1 || first.OutputResourceIDs[0] != "res-out-int-1" || first.User.Username != "alice" || first.RoomName == "" || first.StyleName == "" || first.ProjectID != project.ID {
		t.Fatalf("first record = %+v", first)
	}
	for name, query := range map[string]AdminInteriorGenerationQuery{
		"mode":    {Mode: "text-edit"},
		"status":  {Status: "failed"},
		"keyword": {Keyword: "bob"},
		"task id": {Keyword: "int-2"},
	} {
		page, err := svc.AdminInteriorGenerations(videoReplicationTestAdmin, query)
		want := map[string]int64{"mode": 2, "status": 1, "keyword": 2, "task id": 1}[name]
		if err != nil || page.Total != want {
			t.Fatalf("%s filter = %+v, %v", name, page, err)
		}
	}
	if _, err := svc.AdminInteriorGenerations(videoReplicationTestAdmin, AdminInteriorGenerationQuery{Mode: "Bad Key"}); !errors.As(err, &authErr) || authErr.Status != 400 {
		t.Fatalf("bad mode err = %v", err)
	}

	detail, err := svc.AdminInteriorGeneration(videoReplicationTestAdmin, "int-1")
	if err != nil || detail.Prompt != "把这间int-1改成新风格" || detail.Params["scope"] != "soft" || detail.ProjectName != "我家客厅" {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
	var appErr *AppError
	if _, err := svc.AdminInteriorGeneration(videoReplicationTestAdmin, "studio-1"); !errors.As(err, &appErr) || appErr.Status != 404 {
		t.Fatalf("studio task as interior err = %v", err)
	}
}
