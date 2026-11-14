package app

import (
	"errors"
	"gorm.io/gorm"
	"testing"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/packaging"
	"yingce/backend/internal/repository"
)

func TestPackagingAssetPurgePreservesOriginalAndLockedRecheck(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resource := model.Resource{ID: "pkg-art", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/pack.png"}
	asset := model.Asset{ID: "pkg-asset", UserID: "user-1", Title: "包装原稿", PayloadJSON: `{"data":{"storageKey":"resource:pkg-art"}}`}
	project := model.PackagingProject{ID: "pkg-project", UserID: "user-1", Name: "包装", TemplateID: "tuck", DocumentJSON: "{}", Revision: 1}
	for _, row := range []any{&resource, &asset, &project, &model.PackagingProjectResource{ProjectID: project.ID, ResourceID: resource.ID}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.DeleteUserAsset("user-1", asset.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("original lost: %v count=%d", err, count)
	}
	if err := db.Model(&model.ResourceDeletionJob{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("original queued for deletion: %v count=%d", err, count)
	}
	asset.ID = "pkg-asset-race"
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	err := svc.repo.DeleteAssetAndResources("user-1", asset.ID, []string{resource.ID}, nil, true)
	if !errors.Is(err, repository.ErrAdminResourceStillReferenced) {
		t.Fatalf("locked recheck missing: %v", err)
	}
	if err := db.Model(&model.Asset{}).Where("id = ?", asset.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("failed transaction removed asset: %v count=%d", err, count)
	}
}

func TestPackagingAdminAuditFailureRollsBackCatalogAndDelete(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	admin := &model.User{ID: "pkg-admin-audit", Username: "pkg-admin-audit", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	catalog := packaging.DefaultCatalog()
	revision := int64(0)
	reject := func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "admin_audit_events" {
			tx.AddError(errors.New("audit failure"))
		}
	}
	if err := db.Callback().Create().Before("gorm:create").Register("test:packaging_audit_failure", reject); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Create().Remove("test:packaging_audit_failure") })
	if _, err := svc.SavePackagingCatalog(admin, PackagingCatalogInput{ExpectedRevision: &revision, Catalog: catalog}); err == nil {
		t.Fatal("catalog accepted audit failure")
	}
	row, err := svc.repo.SystemSettingOptional(packagingCatalogKey)
	if err != nil || row != nil {
		t.Fatalf("catalog committed without audit: %v %#v", err, row)
	}
	project := model.PackagingProject{ID: "pkg-audit-project", UserID: "user-1", Name: "包装", TemplateID: "tuck", DocumentJSON: `{"version":1}`, Revision: 1, CreatedAt: time.Now()}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.AdminDeletePackagingProject(admin, project.ID, 1); err == nil {
		t.Fatal("delete accepted audit failure")
	}
	if _, err := svc.repo.PackagingProject("user-1", project.ID); err != nil {
		t.Fatalf("project deleted without audit: %v", err)
	}
}
