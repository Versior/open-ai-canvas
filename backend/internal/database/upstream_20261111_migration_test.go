package database

import (
	"reflect"
	"strconv"
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

func TestUpstream100To104UpgradePreservesNewMigrationIdentities(t *testing.T) {
	for _, version := range []int64{100, 101, 102, 103, 104} {
		t.Run(strconv.FormatInt(version, 10), func(t *testing.T) {
			db, applied := upstreamSchemaDatabase(t, version)
			for range 2 {
				if err := MigrateSchema(db); err != nil {
					t.Fatal(err)
				}
			}
			for _, item := range schemaMigrations {
				if item.version < 100 || item.version > version+7 {
					continue
				}
				requireMigration(t, db, schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: applied[item.version-7]})
			}
		})
	}
}

func TestFork107UpgradePreservesPublishedLedger(t *testing.T) {
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 107)
	var before, after []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version <= ?", 107).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("upgrade changed the fork's published migration identities or timestamps")
	}
	for _, entity := range []any{&model.CreationConversation{}, &model.CreationConversationMessage{}, &model.CreationConversationResource{}, &model.MCPConnectionGrant{}, &model.MCPStorageUsage{}, &model.AgentStorageUsage{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatalf("missing new migration table: %T", entity)
		}
	}
	for _, field := range []string{"Purpose", "ClientID", "ProfileJSON"} {
		if !db.Migrator().HasColumn(&model.OAuthState{}, field) {
			t.Fatalf("missing Wechat migration field: %s", field)
		}
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
