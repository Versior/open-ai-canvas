package database

import (
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestFork99UpgradePreservesPublishedLedgerAndLUTState(t *testing.T) {
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 99)
	if err := db.Model(&model.LUTLibraryItem{}).Where("id = ?", "lut-builtin-warm").Updates(map[string]any{"name": "管理员自定义", "enabled": false, "version": 7}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("id = ?", "lut-builtin-clear").Delete(&model.LUTLibraryItem{}).Error; err != nil {
		t.Fatal(err)
	}
	var before, after []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version <= ?", 99).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("upgrade changed the fork's published migration identities or timestamps")
	}
	var item model.LUTLibraryItem
	if err := db.First(&item, "id = ?", "lut-builtin-warm").Error; err != nil || item.Name != "管理员自定义" || item.Enabled || item.Version != 7 {
		t.Fatalf("LUT customization changed: %v", err)
	}
	var deleted int64
	if err := db.Model(&model.LUTLibraryItem{}).Where("id = ?", "lut-builtin-clear").Count(&deleted).Error; err != nil || deleted != 0 {
		t.Fatalf("deleted LUT was restored: count=%d err=%v", deleted, err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestUpstream100UpgradePreservesNewMigrationIdentities(t *testing.T) {
	db, applied := upstreamSchemaDatabase(t, 100)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version < 100 {
			continue
		}
		requireMigration(t, db, schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: applied[item.version-7]})
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
}
