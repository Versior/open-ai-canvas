package app

import (
	"errors"
	"net/http"
	"testing"

	"yingce/backend/internal/model"
)

func TestEnsureTaskProjectActiveRequiresOwnedProjectOrCanvas(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	for _, record := range []any{
		&model.Project{ID: "owned-project", UserID: "user-1", Name: "owned", Status: model.ProjectStatusActive},
		&model.Project{ID: "foreign-project", UserID: "user-2", Name: "foreign", Status: model.ProjectStatusActive},
		&model.CanvasProject{ID: "owned-canvas", UserID: "user-1", ProjectID: "owned-project"},
		&model.CanvasProject{ID: "owned-canvas-foreign-project", UserID: "user-1", ProjectID: "foreign-project"},
		&model.CanvasProject{ID: "owned-canvas-missing-project", UserID: "user-1", ProjectID: "missing-project"},
		&model.CanvasProject{ID: "foreign-canvas", UserID: "user-2", ProjectID: "foreign-project"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}

	for _, test := range []struct {
		name string
		id   string
	}{
		{name: "no project id", id: " "},
		{name: "owned project", id: "owned-project"},
		{name: "owned canvas", id: "owned-canvas"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := service.ensureTaskProjectActive("user-1", test.id); err != nil {
				t.Fatalf("ensureTaskProjectActive() error = %v", err)
			}
		})
	}

	for _, test := range []struct {
		name string
		id   string
	}{
		{name: "foreign project", id: "foreign-project"},
		{name: "foreign canvas", id: "foreign-canvas"},
		{name: "missing project", id: "missing-project"},
		{name: "owned canvas with foreign project", id: "owned-canvas-foreign-project"},
		{name: "owned canvas with missing project", id: "owned-canvas-missing-project"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := service.ensureTaskProjectActive("user-1", test.id)
			var appErr *AppError
			if !errors.As(err, &appErr) {
				t.Fatalf("ensureTaskProjectActive() error = %v, want AppError", err)
			}
			if appErr.Status != http.StatusNotFound || appErr.Reason != ReasonNotFound || appErr.Message != "任务所属画布或项目不存在或无权访问" {
				t.Fatalf("ensureTaskProjectActive() error = %#v", appErr)
			}
		})
	}
}
func TestEnsureTaskProjectActiveRejectsAmbiguousOwnedID(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	for _, record := range []any{
		&model.Project{ID: "shared-id", UserID: "user-1", Name: "archived", Status: model.ProjectStatusArchived},
		&model.CanvasProject{ID: "shared-id", UserID: "user-1"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}

	err := service.ensureTaskProjectActive("user-1", "shared-id")
	var appErr *AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("ensureTaskProjectActive() error = %v, want AppError", err)
	}
	if appErr.Status != http.StatusBadRequest || appErr.Message != "任务归属 ID 有歧义" {
		t.Fatalf("ensureTaskProjectActive() error = %#v", appErr)
	}
}
