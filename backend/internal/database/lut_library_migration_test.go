package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestLUTLibraryMigrationSeedsOnceAndPreservesEdits(t *testing.T) {
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 98)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var items []model.LUTLibraryItem
	if err := db.Order("sort_order asc").Find(&items).Error; err != nil || len(items) != 6 {
		t.Fatalf("seeded catalog: %d %v", len(items), err)
	}
	if err := db.Delete(&items[0]).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&items[1]).Updates(map[string]any{"name": "管理员修改", "enabled": false, "version": 2}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.LUTLibraryItem{}).Count(&count).Error; err != nil || count != 5 {
		t.Fatalf("deleted builtin resurrected: %d %v", count, err)
	}
	var edited model.LUTLibraryItem
	if err := db.First(&edited, "id = ?", items[1].ID).Error; err != nil || edited.Name != "管理员修改" || edited.Enabled || edited.Version != 2 {
		t.Fatalf("admin edit overwritten: %+v %v", edited, err)
	}
}
