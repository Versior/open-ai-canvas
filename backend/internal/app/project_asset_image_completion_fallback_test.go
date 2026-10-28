package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestProjectAssetImageCompletionFallsBackToLibraryWhenProjectUnavailable(t *testing.T) {
	for _, state := range []string{"deleted", "archived", "ambiguous"} {
		t.Run(state, func(t *testing.T) {
			svc, db, projectID, projectAsset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
			if err := db.AutoMigrate(&model.SystemSetting{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}); err != nil {
				t.Fatal(err)
			}
			svc.dataDir = t.TempDir()
			if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), bytes.Repeat([]byte{3}, 32), 0o600); err != nil {
				t.Fatal(err)
			}

			switch state {
			case "deleted":
				if err := db.Delete(&model.Project{}, "id = ?", projectID).Error; err != nil {
					t.Fatal(err)
				}
			case "archived":
				if err := db.Model(&model.Project{}).Where("id = ?", projectID).Update("status", model.ProjectStatusArchived).Error; err != nil {
					t.Fatal(err)
				}
			case "ambiguous":
				if err := db.Create(&model.CanvasProject{ID: projectID, UserID: "user-1", Title: "same id", PayloadJSON: `{}`}).Error; err != nil {
					t.Fatal(err)
				}
			}

			input, err := json.Marshal(map[string]any{"metadata": map[string]any{
				"operation":             "project_asset_image",
				"projectAssetId":        projectAsset.ID,
				"projectAssetVersionId": projectAsset.PrimaryVersionID,
			}})
			if err != nil {
				t.Fatal(err)
			}
			checkpoint, err := svc.encryptSettingSecret(`{"mode":"image","items":[{"resourceId":"image-1"}]}`)
			if err != nil {
				t.Fatal(err)
			}
			task := model.Task{
				ID: "project-asset-image-fallback-" + state, UserID: "user-1", ProjectID: projectID,
				Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: string(input),
				MediaRecoveryJSON: checkpoint, CreatedAt: time.Now(),
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}

			if err := svc.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"images":[{"resourceId":"image-1"}]}`), nil, false); err != nil {
				t.Fatalf("completion: %v", err)
			}
			stored, err := svc.repo.Task(task.ID)
			if err != nil || stored.Status != model.TaskStatusSucceeded || strings.Contains(stored.ResultJSON, `"projectAssetImageStatus":"bound"`) {
				t.Fatalf("stored task=%+v err=%v", stored, err)
			}
			versions, err := svc.repo.AssetVersions(projectAsset.ID)
			if err != nil || len(versions) != 1 {
				t.Fatalf("project asset was rebound: versions=%d err=%v", len(versions), err)
			}
			libraryAssetID := generationMediaAssetID(task.ID, 0)
			libraryAsset, err := svc.repo.AssetForUser(task.UserID, libraryAssetID)
			if err != nil || !strings.Contains(libraryAsset.PayloadJSON, `"storageKey":"resource:image-1"`) || strings.Contains(libraryAsset.PayloadJSON, `"projectIds"`) {
				t.Fatalf("library asset=%+v err=%v", libraryAsset, err)
			}
			if _, err := svc.repo.ProjectAssetLink(projectID, libraryAssetID); err == nil {
				t.Fatal("library fallback was linked to unavailable project")
			}
		})
	}
}

func TestProjectAssetImageCompletionKeepsClaimOnProjectLookupFailure(t *testing.T) {
	svc, db, projectID, projectAsset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(map[string]any{"metadata": map[string]any{
		"operation":             "project_asset_image",
		"projectAssetId":        projectAsset.ID,
		"projectAssetVersionId": projectAsset.PrimaryVersionID,
	}})
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "project-asset-image-project-lookup-error", UserID: "user-1", ProjectID: projectID,
		Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: string(input),
		LeaseOwner: "worker-a", LeaseExpiresAt: &expires, CreatedAt: time.Now(),
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	lookupErr := errors.New("project lookup failed")
	callbackName := "test:project_asset_image_project_lookup_error"
	if err := db.Callback().Query().Before("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "canvas_projects" {
			tx.AddError(lookupErr)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callbackName) })

	err = svc.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"images":[{"resourceId":"image-1"}]}`), nil, false)
	if !errors.Is(err, lookupErr) {
		t.Fatalf("completion error=%v, want lookup error", err)
	}
	stored, readErr := svc.repo.Task(task.ID)
	if readErr != nil || stored.Status != model.TaskStatusRunning || stored.LeaseOwner != "worker-a" {
		t.Fatalf("stored task=%+v err=%v", stored, readErr)
	}
	versions, readErr := svc.repo.AssetVersions(projectAsset.ID)
	if readErr != nil || len(versions) != 1 {
		t.Fatalf("project asset changed after lookup failure: versions=%d err=%v", len(versions), readErr)
	}
}

func TestProjectAssetImageCompletionDoesNotHideRegistrationErrorWhenProjectBecomesUnavailable(t *testing.T) {
	svc, db, projectID, projectAsset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}); err != nil {
		t.Fatal(err)
	}
	svc.dataDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), bytes.Repeat([]byte{3}, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(map[string]any{"metadata": map[string]any{
		"operation":             "project_asset_image",
		"projectAssetId":        projectAsset.ID,
		"projectAssetVersionId": projectAsset.PrimaryVersionID,
		"workflowStepId":        "missing-workflow-step",
		"domainProjectId":       projectID,
	}})
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, err := svc.encryptSettingSecret(`{"mode":"image","items":[{"resourceId":"image-1"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "project-asset-image-registration-error", UserID: "user-1", ProjectID: projectID,
		Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: string(input),
		MediaRecoveryJSON: checkpoint, LeaseOwner: "worker-a", LeaseExpiresAt: &expires, CreatedAt: time.Now(),
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	registrationErr := errors.New("workflow registration failed")
	projectUnavailable := false
	registrationCallback := "test:fail_workflow_registration"
	if err := db.Callback().Query().Before("gorm:query").Register(registrationCallback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "workflow_step_instances" {
			projectUnavailable = true
			tx.AddError(registrationErr)
		}
	}); err != nil {
		t.Fatal(err)
	}
	projectCallback := "test:project_unavailable_after_registration_error"
	if err := db.Callback().Query().Before("gorm:query").Register(projectCallback, func(tx *gorm.DB) {
		if projectUnavailable && tx.Statement.Schema != nil && tx.Statement.Schema.Table == "projects" {
			tx.AddError(gorm.ErrRecordNotFound)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Callback().Query().Remove(registrationCallback)
		_ = db.Callback().Query().Remove(projectCallback)
	})

	err = svc.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"images":[{"resourceId":"image-1"}]}`), nil, false)
	if !errors.Is(err, registrationErr) {
		t.Fatalf("completion error=%v, want registration error", err)
	}
	if !projectUnavailable {
		t.Fatal("workflow registration failure hook was not reached")
	}
	stored, readErr := svc.repo.Task(task.ID)
	if readErr != nil || stored.Status != model.TaskStatusRunning || stored.LeaseOwner != "worker-a" {
		t.Fatalf("stored task=%+v err=%v", stored, readErr)
	}
	versions, readErr := svc.repo.AssetVersions(projectAsset.ID)
	if readErr != nil || len(versions) != 1 {
		t.Fatalf("project asset changed after registration failure: versions=%d err=%v", len(versions), readErr)
	}
}

func TestProjectAssetImageCompletionFallsBackWhenProjectBecomesUnavailableDuringBinding(t *testing.T) {
	for _, state := range []string{"archived", "deleted"} {
		t.Run(state, func(t *testing.T) {
			svc, db, projectID, projectAsset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
			if err := db.AutoMigrate(&model.SystemSetting{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}); err != nil {
				t.Fatal(err)
			}
			svc.dataDir = t.TempDir()
			if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), bytes.Repeat([]byte{3}, 32), 0o600); err != nil {
				t.Fatal(err)
			}
			input, err := json.Marshal(map[string]any{"metadata": map[string]any{
				"operation":             "project_asset_image",
				"projectAssetId":        projectAsset.ID,
				"projectAssetVersionId": projectAsset.PrimaryVersionID,
			}})
			if err != nil {
				t.Fatal(err)
			}
			checkpoint, err := svc.encryptSettingSecret(`{"mode":"image","items":[{"resourceId":"image-1"}]}`)
			if err != nil {
				t.Fatal(err)
			}
			task := model.Task{
				ID: "project-asset-image-binding-race-" + state, UserID: "user-1", ProjectID: projectID,
				Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: string(input),
				MediaRecoveryJSON: checkpoint, CreatedAt: time.Now(),
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}

			projectQueries := 0
			changed := false
			callbackName := "test:project_asset_image_binding_race_" + state
			if err := db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
				if changed || tx.Statement.Schema == nil || tx.Statement.Schema.Table != "projects" {
					return
				}
				projectQueries++
				if projectQueries != 2 {
					return
				}
				changed = true
				projectDB := tx.Session(&gorm.Session{NewDB: true})
				if state == "archived" {
					if updateErr := projectDB.Model(&model.Project{}).Where("id = ?", projectID).Update("status", model.ProjectStatusArchived).Error; updateErr != nil {
						tx.AddError(updateErr)
					}
				} else if deleteErr := projectDB.Delete(&model.Project{}, "id = ?", projectID).Error; deleteErr != nil {
					tx.AddError(deleteErr)
				}
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Callback().Query().Remove(callbackName) })

			if err := svc.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"images":[{"resourceId":"image-1"}]}`), nil, false); err != nil {
				t.Fatalf("completion: %v", err)
			}
			if !changed {
				t.Fatal("project state change hook was not reached")
			}
			stored, err := svc.repo.Task(task.ID)
			if err != nil || stored.Status != model.TaskStatusSucceeded || strings.Contains(stored.ResultJSON, `"projectAssetImageStatus":"bound"`) {
				t.Fatalf("stored task=%+v err=%v", stored, err)
			}
			versions, err := svc.repo.AssetVersions(projectAsset.ID)
			if err != nil || len(versions) != 1 {
				t.Fatalf("project asset was rebound: versions=%d err=%v", len(versions), err)
			}
			libraryAssetID := generationMediaAssetID(task.ID, 0)
			libraryAsset, err := svc.repo.AssetForUser(task.UserID, libraryAssetID)
			if err != nil || strings.Contains(libraryAsset.PayloadJSON, `"projectIds"`) {
				t.Fatalf("library asset=%+v err=%v", libraryAsset, err)
			}
			if _, err := svc.repo.ProjectAssetLink(projectID, libraryAssetID); err == nil {
				t.Fatal("library fallback was linked to unavailable project")
			}
		})
	}
}
