package database

import (
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func TestEcommerceAgentSchemaMigration79(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: filepath.Join(t.TempDir(), "schema.db")}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() }()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{}, &model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing agent table %T", table)
		}
	}
	if !db.Migrator().HasColumn(&model.EcommerceKnowledgeEntry{}, "KnowledgeDomain") {
		t.Fatal("missing ecommerce knowledge domain column after schema migration")
	}
	if !db.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
		t.Fatal("missing ecommerce knowledge domain index after schema migration")
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

// Fork 已推送的 79 升级时先补电商 Agent 表（80）再补短剧角色声音与造型（81）；本地已到 80 的库只补 81。
// 两条路径都不能改动已有账本和短剧数据。上游 main 的编号见 ecommerce_migration_lineage_test.go。
func TestEcommerceAgentSchemaUpgradeFromForkSchemaPreservesMigrationHistory(t *testing.T) {
	for _, from := range []int64{79, 80} {
		t.Run(strconv.FormatInt(from, 10), func(t *testing.T) {
			db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "upgrade.db")})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			defer sqlDB.Close()
			if err := db.AutoMigrate(&schemaMigration{}); err != nil {
				t.Fatal(err)
			}
			for _, item := range schemaMigrations {
				if item.version > from {
					break
				}
				if err := item.apply(db); err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
					t.Fatal(err)
				}
			}
			ecommerceModels := []any{
				&model.EcommerceProject{}, &model.EcommerceKnowledgeSource{},
				&model.EcommerceKnowledgeEntry{}, &model.EcommerceCreativeRecommendation{},
				&model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{},
				&model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{},
			}
			// The baseline uses current models; remove what 80 and 81 add to restore the older schema.
			if from < 80 {
				if err := db.Migrator().DropTable(ecommerceModels...); err != nil {
					t.Fatal(err)
				}
			}
			cast := model.DramaCast{ID: "existing-cast", ProjectID: "existing-drama", Kind: "character", Name: "林夏", Appearance: "短发，米色风衣", Position: 3}
			if err := db.Create(&cast).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Migrator().DropIndex(&model.DramaCast{}, "ParentID"); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"VoiceProfileID", "VoiceSampleResourceID", "ParentID", "LookName", "LookFromChapter", "LookToChapter"} {
				if err := db.Migrator().DropColumn(&model.DramaCast{}, field); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Migrator().DropColumn(&model.DramaShot{}, "LookCastIDsJSON"); err != nil {
				t.Fatal(err)
			}
			var before []schemaMigration
			if err := db.Order("version").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := MigrateSchema(db); err != nil {
					t.Fatal(err)
				}
			}
			var after []schemaMigration
			if err := db.Where("version <= ?", from).Order("version").Find(&after).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("existing migration ledger changed")
			}
			for _, table := range ecommerceModels {
				if !db.Migrator().HasTable(table) {
					t.Fatalf("missing ecommerce table %T after upgrading from fork %d", table, from)
				}
			}
			if !db.Migrator().HasColumn(&model.EcommerceKnowledgeEntry{}, "KnowledgeDomain") || !db.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
				t.Fatal("missing ecommerce knowledge domain column or index")
			}
			for _, want := range []schemaMigration{
				{Version: 80, Name: "ecommerce_agent_and_knowledge", Checksum: "sha256:ecommerce-agent-and-knowledge-v78-20261101"},
				{Version: 81, Name: "drama_cast_voice_looks", Checksum: "sha256:drama-cast-voice-looks-v78-20261101"},
			} {
				var got schemaMigration
				if err := db.First(&got, "version = ?", want.Version).Error; err != nil {
					t.Fatal(err)
				}
				if got.Name != want.Name || got.Checksum != want.Checksum {
					t.Fatalf("migration %d = %+v, want %+v", want.Version, got, want)
				}
			}
			if !db.Migrator().HasIndex(&model.DramaCast{}, "ParentID") || !db.Migrator().HasColumn(&model.DramaShot{}, "LookCastIDsJSON") {
				t.Fatal("missing drama look index or shot look column")
			}
			var stored model.DramaCast
			if err := db.First(&stored, "id = ?", cast.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.ProjectID != cast.ProjectID || stored.Kind != cast.Kind || stored.Name != cast.Name || stored.Appearance != cast.Appearance || stored.Position != cast.Position {
				t.Fatalf("existing drama cast changed: %+v", stored)
			}
			if stored.ParentID != "" || stored.LookName != "" || stored.VoiceProfileID != "" || stored.LookFromChapter != 0 || stored.LookToChapter != 0 {
				t.Fatalf("new drama cast columns not zero: %+v", stored)
			}
			if err := RequireSchemaVersion(db); err != nil {
				t.Fatal(err)
			}
		})
	}
}
