package repository

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func seedProjectAssetImageCommit(t *testing.T) (*gorm.DB, *Repository, model.Project, model.Asset, model.AssetVersion, model.AssetRepresentation) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "project-asset-image.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Project{}, &model.Resource{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.ProjectAssetLink{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	project := model.Project{ID: "project-image", UserID: "user-image", Name: "image", Status: model.ProjectStatusActive, Revision: 4, CreatedAt: now, UpdatedAt: now}
	resource := model.Resource{ID: "resource-image", UserID: project.UserID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Width: 10, Height: 10, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "asset-image", UserID: project.UserID, Kind: "entity", Category: model.AssetCategoryEnvironment, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "version-old", PayloadJSON: `{"kind":"entity"}`, CreatedAt: now, UpdatedAt: now}
	oldVersion := model.AssetVersion{ID: asset.PrimaryVersionID, AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	link := model.ProjectAssetLink{ID: "link-image", ProjectID: project.ID, AssetID: asset.ID, CreatedAt: now}
	for _, row := range []any{&project, &resource, &asset, &oldVersion, &link} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	updatedAsset := asset
	updatedAsset.Kind = "image"
	updatedAsset.PrimaryVersionID = "version-new"
	updatedAsset.PayloadJSON = `{"kind":"image"}`
	updatedAsset.UpdatedAt = now.Add(time.Second)
	newVersion := model.AssetVersion{ID: updatedAsset.PrimaryVersionID, AssetID: asset.ID, Version: 2, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	representation := model.AssetRepresentation{ID: "representation-new", TaskID: "task-image", AssetVersionID: newVersion.ID, ResourceID: resource.ID, MediaType: "image", Role: "primary", MetadataJSON: `{}`, CreatedAt: now}
	return db, New(db), project, updatedAsset, newVersion, representation
}

func assertProjectAssetImageCommitRolledBack(t *testing.T, db *gorm.DB, assetID string, newVersionID string, representationID string) {
	t.Helper()
	var stored model.Asset
	if err := db.First(&stored, "id = ?", assetID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.PrimaryVersionID != "version-old" || stored.Kind != "entity" {
		t.Fatalf("asset was changed: %+v", stored)
	}
	for name, query := range map[string]*gorm.DB{
		"version":        db.Model(&model.AssetVersion{}).Where("id = ?", newVersionID),
		"representation": db.Model(&model.AssetRepresentation{}).Where("id = ?", representationID),
	} {
		var count int64
		if err := query.Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0 after rollback", name, count)
		}
	}
}

func TestCommitProjectAssetImageRejectsUnavailableProjectAtomically(t *testing.T) {
	for _, state := range []string{"archived", "deleted"} {
		t.Run(state, func(t *testing.T) {
			db, repo, project, asset, version, representation := seedProjectAssetImageCommit(t)
			if state == "archived" {
				if err := db.Model(&model.Project{}).Where("id = ?", project.ID).Update("status", model.ProjectStatusArchived).Error; err != nil {
					t.Fatal(err)
				}
			} else if err := db.Delete(&model.Project{}, "id = ?", project.ID).Error; err != nil {
				t.Fatal(err)
			}

			applied, err := repo.CommitProjectAssetImage(project.ID, "version-old", &asset, &version, &representation)
			if !errors.Is(err, ErrProjectNotActive) {
				t.Fatalf("CommitProjectAssetImage error = %v, want ErrProjectNotActive", err)
			}
			if applied {
				t.Fatal("CommitProjectAssetImage reported an applied image")
			}
			assertProjectAssetImageCommitRolledBack(t, db, asset.ID, version.ID, representation.ID)
		})
	}
}

func TestCommitProjectAssetImagePreservesProjectLookupError(t *testing.T) {
	db, repo, project, asset, version, representation := seedProjectAssetImageCommit(t)
	injected := errors.New("project lookup failed")
	callbackName := "test:project_asset_image_lookup_failure"
	if err := db.Callback().Query().Before("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "projects" {
			tx.AddError(injected)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callbackName) })

	applied, err := repo.CommitProjectAssetImage(project.ID, "version-old", &asset, &version, &representation)
	if !errors.Is(err, injected) {
		t.Fatalf("CommitProjectAssetImage error = %v, want injected error", err)
	}
	if applied {
		t.Fatal("CommitProjectAssetImage reported an applied image")
	}
	assertProjectAssetImageCommitRolledBack(t, db, asset.ID, version.ID, representation.ID)
}
