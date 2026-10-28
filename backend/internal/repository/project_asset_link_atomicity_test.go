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

func TestLinkProjectAssetRejectsArchivedProjectAtomically(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "project-assets.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Project{}, &model.Asset{}, &model.AssetVersion{}, &model.ProjectAssetLink{}); err != nil {
		t.Fatal(err)
	}
	project := model.Project{ID: "project-archived", UserID: "user", Name: "archived", Status: model.ProjectStatusArchived, Revision: 7}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	asset := &model.Asset{ID: "asset-new", UserID: project.UserID, Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, CreatedAt: now, UpdatedAt: now}
	link := &model.ProjectAssetLink{ID: "link-new", ProjectID: project.ID, AssetID: asset.ID, CreatedAt: now}

	created, err := New(db).LinkProjectAsset(asset, nil, link)
	if !errors.Is(err, ErrProjectNotActive) {
		t.Fatalf("LinkProjectAsset error = %v, want ErrProjectNotActive", err)
	}
	if created {
		t.Fatal("LinkProjectAsset reported a committed link")
	}
	for name, query := range map[string]*gorm.DB{
		"asset": db.Model(&model.Asset{}).Where("id = ?", asset.ID),
		"link":  db.Model(&model.ProjectAssetLink{}).Where("id = ?", link.ID),
	} {
		var count int64
		if err := query.Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0 after rollback", name, count)
		}
	}
	var stored model.Project
	if err := db.First(&stored, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Revision != project.Revision {
		t.Fatalf("project revision = %d, want %d", stored.Revision, project.Revision)
	}
}
