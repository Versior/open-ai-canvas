package app

import (
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/packaging"
)

func TestPackagingMockupAdmissionAndHistory(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	owner := &model.User{ID: "pack-mock-owner", Username: "pack-mock-owner", Role: model.UserRoleUser, Status: model.UserStatusActive}
	admin := &model.User{ID: "pack-mock-admin", Username: "pack-mock-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	for _, user := range []*model.User{owner, admin} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	catalog := packaging.DefaultCatalog()
	document := packaging.Document{Version: 1, Template: catalog.Templates[0], Parameters: catalog.Templates[0].Defaults, Material: catalog.Materials[0], Artworks: []packaging.Artwork{}, View: packaging.View{Fold: 1, Layout: "split", Background: "dark", Projection: "perspective", Finish: "paper", Light: 1}}
	revision := int64(0)
	project, err := svc.SavePackagingProject(owner, "", PackagingProjectInput{Name: "效果图验收", ExpectedRevision: &revision, Document: document})
	if err != nil {
		t.Fatal(err)
	}
	for _, resource := range []model.Resource{
		{ID: "pack-reference", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady},
		{ID: "pack-foreign", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady},
		{ID: "pack-unready", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusPending},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	request := func() map[string]any {
		return map[string]any{
			"mode": "image", "config": map[string]any{"count": "1"},
			"metadata":        map[string]any{"source": "packaging-mockup", "packagingProjectId": project.ID, "packagingRevision": 1, "packagingReferenceId": "pack-reference", "packagingScene": "studio"},
			"referenceImages": []any{map[string]any{"storageKey": "resource:pack-reference"}},
		}
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", request()); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name     string
		change   func(map[string]any)
		taskType string
		status   int
	}{
		{"source", func(r map[string]any) { r["metadata"].(map[string]any)["source"] = "canvas" }, "canvas_image", 400},
		{"revision missing", func(r map[string]any) { delete(r["metadata"].(map[string]any), "packagingRevision") }, "canvas_image", 400},
		{"revision stale", func(r map[string]any) { r["metadata"].(map[string]any)["packagingRevision"] = 2 }, "canvas_image", 409},
		{"fractional revision", func(r map[string]any) { r["metadata"].(map[string]any)["packagingRevision"] = 1.5 }, "canvas_image", 400},
		{"scene", func(r map[string]any) { r["metadata"].(map[string]any)["packagingScene"] = "unknown" }, "canvas_image", 400},
		{"task type", func(r map[string]any) {}, "canvas_text", 400},
		{"mode", func(r map[string]any) { r["mode"] = "text" }, "canvas_image", 400},
		{"no reference", func(r map[string]any) { r["referenceImages"] = []any{} }, "canvas_image", 400},
		{"multiple references", func(r map[string]any) {
			r["referenceImages"] = []any{map[string]any{"storageKey": "resource:pack-reference"}, map[string]any{"storageKey": "resource:pack-reference"}}
		}, "canvas_image", 400},
		{"mismatched reference", func(r map[string]any) { r["referenceImages"] = []any{map[string]any{"storageKey": "resource:other"}} }, "canvas_image", 400},
		{"multiple outputs", func(r map[string]any) { r["config"].(map[string]any)["count"] = "2" }, "canvas_image", 400},
		{"foreign reference", func(r map[string]any) {
			r["metadata"].(map[string]any)["packagingReferenceId"] = "pack-foreign"
			r["referenceImages"] = []any{map[string]any{"storageKey": "resource:pack-foreign"}}
		}, "canvas_image", 404},
		{"unready reference", func(r map[string]any) {
			r["metadata"].(map[string]any)["packagingReferenceId"] = "pack-unready"
			r["referenceImages"] = []any{map[string]any{"storageKey": "resource:pack-unready"}}
		}, "canvas_image", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := request()
			test.change(r)
			err := svc.requirePackagingMockupTask(owner.ID, test.taskType, r)
			appErr, ok := err.(*kernel.AppError)
			if !ok || appErr.Status != test.status {
				t.Fatalf("error = %v; want %d", err, test.status)
			}
		})
	}
	if err := svc.requirePackagingMockupTask(admin.ID, "canvas_image", request()); err == nil {
		t.Fatal("foreign project admitted")
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", map[string]any{"metadata": map[string]any{"packagingScene": "studio"}}); err == nil {
		t.Fatal("partial marker bypassed admission")
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_text", map[string]any{"mode": "text"}); err != nil {
		t.Fatal("ordinary task changed")
	}
	parentInput, _ := json.Marshal(request())
	parent := model.Task{ID: "pack-parent", UserID: owner.ID, Type: "canvas_image", InputJSON: string(parentInput), ResultJSON: `{"images":[{"storageKey":"resource:pack-reference"}]}`, Status: model.TaskStatusSucceeded}
	if err := db.Create(&parent).Error; err != nil {
		t.Fatal(err)
	}
	iteration := request()
	iteration["metadata"].(map[string]any)["packagingParentTaskId"] = parent.ID
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", iteration); err != nil {
		t.Fatal(err)
	}
	iteration["metadata"].(map[string]any)["packagingParentTaskId"] = "missing"
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", iteration); err == nil {
		t.Fatal("missing parent admitted")
	}
	iteration["metadata"].(map[string]any)["packagingParentTaskId"] = parent.ID
	if err := db.Model(&parent).Update("result_json", `{"images":[{"storageKey":"resource:other"}]}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", iteration); err == nil {
		t.Fatal("non-output reference admitted")
	}
	if err := db.Model(&parent).Updates(map[string]any{"result_json": parent.ResultJSON, "status": model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", iteration); err == nil {
		t.Fatal("unfinished parent admitted")
	}
	if err := db.Delete(&parent).Error; err != nil {
		t.Fatal(err)
	}
	catalog.MockupEnabled = false
	saved, err := svc.SavePackagingCatalog(admin, PackagingCatalogInput{Catalog: catalog, ExpectedRevision: &revision})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", request()); err == nil {
		t.Fatal("disabled generation admitted")
	}
	catalog = saved
	catalog.MockupEnabled = true
	catalog.Enabled = false
	revision = saved.Revision
	if _, err := svc.SavePackagingCatalog(admin, PackagingCatalogInput{Catalog: catalog, ExpectedRevision: &revision}); err != nil {
		t.Fatal(err)
	}
	if err := svc.requirePackagingMockupTask(owner.ID, "canvas_image", request()); err == nil {
		t.Fatal("disabled module admitted generation")
	}
	input, _ := json.Marshal(request())
	for i, task := range []model.Task{
		{ID: "mock-old", UserID: owner.ID, Type: "canvas_image", InputJSON: string(input), ResultJSON: `{"images":[{"storageKey":"resource:pack-result"}]}`, Status: model.TaskStatusSucceeded},
		{ID: "mock-new", UserID: owner.ID, Type: "canvas_image", InputJSON: string(input), Status: model.TaskStatusQueued},
		{ID: "mock-foreign", UserID: admin.ID, Type: "canvas_image", InputJSON: string(input)},
		{ID: "mock-other-source", UserID: owner.ID, Type: "canvas_image", InputJSON: `{"metadata":{"source":"canvas","packagingProjectId":"` + project.ID + `"}}`},
		{ID: "mock-other-project", UserID: owner.ID, Type: "canvas_image", InputJSON: `{"metadata":{"source":"packaging-mockup","packagingProjectId":"other"}}`},
		{ID: "mock-other-type", UserID: owner.ID, Type: "canvas_text", InputJSON: string(input)},
	} {
		task.CreatedAt = time.Now().Add(time.Duration(i) * time.Second)
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	history, err := svc.PackagingMockups(owner, project.ID, false, 1, 1)
	if err != nil || history.Total != 2 || len(history.Items) != 1 || history.Items[0].ID != "mock-new" {
		t.Fatalf("history = %#v, %v", history, err)
	}
	history, err = svc.PackagingMockups(admin, project.ID, true, 2, 1)
	if err != nil || history.Items[0].ID != "mock-old" || len(history.Items[0].OutputResourceIDs) != 1 || history.Items[0].OutputResourceIDs[0] != "pack-result" || history.Items[0].ReferenceID != "pack-reference" || history.Items[0].Revision != 1 {
		t.Fatalf("admin history = %#v, %v", history, err)
	}
	if _, err := svc.PackagingMockups(admin, project.ID, false, 1, 12); err == nil {
		t.Fatal("foreign history exposed")
	}
	if _, err := svc.PackagingMockups(owner, project.ID, true, 1, 12); err == nil {
		t.Fatal("admin history allowed ordinary user")
	}
}
