package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedAtomicMediaRegistration(t *testing.T) (*Service, *gorm.DB, model.Task, model.Project) {
	t.Helper()
	s, db := newMediaRecoveryTestService(t)
	if err := os.WriteFile(filepath.Join(s.dataDir, ".settings-key"), bytes.Repeat([]byte{3}, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	project := model.Project{ID: "atomic-media-project", UserID: "media-user", Name: "atomic", Status: model.ProjectStatusActive, Revision: 3}
	task := model.Task{ID: "atomic-media-task", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_image", Status: model.TaskStatusRunning, CreatedAt: time.Now()}
	resource := model.Resource{ID: "atomic-media-resource", UserID: task.UserID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 12, Width: 2, Height: 3, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	for _, row := range []any{&project, &task, &resource} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID, MIMEType: resource.MimeType}}}
	if err := s.saveMediaCheckpoint(&task, checkpoint, "register"); err != nil {
		t.Fatal(err)
	}
	return s, db, task, project
}

func TestRegisterRecoveredMediaAssetsFallsBackWhenProjectArchivesAfterFinalCheck(t *testing.T) {
	s, db, task, project := seedAtomicMediaRegistration(t)
	callbackName := "test:archive_after_media_project_check"
	archived := false
	if err := db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if archived || tx.Statement.Schema == nil || tx.Statement.Schema.Table != "projects" {
			return
		}
		archived = true
		if err := tx.Session(&gorm.Session{NewDB: true}).Model(&model.Project{}).Where("id = ?", project.ID).Update("status", model.ProjectStatusArchived).Error; err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callbackName) })

	if err := s.registerRecoveredMediaAssets(task); err != nil {
		t.Fatal(err)
	}
	if !archived {
		t.Fatal("project archive hook was not reached")
	}
	var linkCount int64
	if err := db.Model(&model.ProjectAssetLink{}).Where("project_id = ?", project.ID).Count(&linkCount).Error; err != nil {
		t.Fatal(err)
	}
	if linkCount != 0 {
		t.Fatalf("project asset link count = %d, want 0", linkCount)
	}
	asset, err := s.repo.AssetForUser(task.UserID, generationMediaAssetID(task.ID, 0))
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	if _, linked := payload.Metadata["projectIds"]; linked {
		t.Fatal("library-only asset retained stale projectIds metadata")
	}
}

func TestRegisterRecoveredMediaAssetsDoesNotDowngradeProjectWriteError(t *testing.T) {
	s, db, task, _ := seedAtomicMediaRegistration(t)
	injected := errors.New("project revision write failed")
	callbackName := "test:fail_media_project_revision"
	if err := db.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "projects" {
			tx.AddError(injected)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Update().Remove(callbackName) })

	if err := s.registerRecoveredMediaAssets(task); !errors.Is(err, injected) {
		t.Fatalf("registerRecoveredMediaAssets error = %v, want injected database error", err)
	}
}
