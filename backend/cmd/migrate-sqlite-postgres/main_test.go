package main

import (
	"path/filepath"
	"sync"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestMigrationListCoversSchemaModels(t *testing.T) {
	want := make(map[string]bool, len(database.Models()))
	cache := &sync.Map{}
	for _, value := range database.Models() {
		parsed, err := schema.Parse(value, cache, schema.NamingStrategy{})
		if err != nil {
			t.Fatal(err)
		}
		want[parsed.Table] = false
	}
	for _, migration := range migrations() {
		if _, exists := want[migration.name]; !exists {
			t.Fatalf("migration list contains unknown table %q", migration.name)
		}
		if want[migration.name] {
			t.Fatalf("migration list contains duplicate table %q", migration.name)
		}
		want[migration.name] = true
	}
	for table, covered := range want {
		if !covered {
			t.Errorf("migration list is missing table %q", table)
		}
	}
}

// 迁移账本建出来的每张业务表都必须在复制清单里；漏掉的表在迁到 PostgreSQL 时会被悄悄丢掉。
func TestMigrationListCoversMigratedSchema(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "schema.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var tables []string
	if err := db.Raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").Scan(&tables).Error; err != nil {
		t.Fatal(err)
	}
	copied := map[string]bool{"schema_migrations": true}
	for _, migration := range migrations() {
		copied[migration.name] = true
	}
	for _, table := range tables {
		if !copied[table] {
			t.Errorf("table %q is created by the schema migrations but not copied to PostgreSQL", table)
		}
	}
}

func TestAgentPetTablesMigration(t *testing.T) {
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:agent-pet-migration-source?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:agent-pet-migration-target?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []*gorm.DB{source, target} {
		if err := db.AutoMigrate(&model.AgentPet{}, &model.UserAgentPet{}, &model.UserAgentPetSelection{}); err != nil {
			t.Fatal(err)
		}
	}
	rows := []any{
		&model.AgentPet{ID: "pingo", Source: "builtin", Name: "企鹅", SpriteVersion: 2, Enabled: true, Access: "paid", PriceMicrocredits: 5_000_000, GroupCodesJSON: "[]", StateRowsJSON: "{}", LinesJSON: `["你好"]`, Category: "小动物", SortOrder: 10},
		&model.AgentPet{ID: "custom-1", Source: "upload", ResourceID: "resource-1", Name: "上传", SpriteVersion: 1, Access: "free", GroupCodesJSON: "[]", StateRowsJSON: `{"idle":"waving"}`, LinesJSON: "[]", SortOrder: -20},
		&model.UserAgentPet{UserID: "user-1", PetID: "pingo", PriceMicrocredits: 5_000_000, LedgerEntryID: "ledger-1"},
		&model.UserAgentPet{UserID: "user-1", PetID: "custom-1"},
		&model.UserAgentPetSelection{UserID: "user-1", PetID: "pingo"},
	}
	for _, row := range rows {
		if err := source.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	want := map[string]int{"agent_pets": 2, "user_agent_pets": 2, "user_agent_pet_selections": 1}
	for _, migration := range migrations() {
		expected, ok := want[migration.name]
		if !ok {
			continue
		}
		count, err := migration.run(source, target, true)
		if err != nil || count != expected {
			t.Fatalf("%s copied %d rows, want %d: %v", migration.name, count, expected, err)
		}
		delete(want, migration.name)
	}
	if len(want) > 0 {
		t.Fatalf("migration list is missing %v", want)
	}
}

func TestCanvasHistoryCompositeKeyMigration(t *testing.T) {
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-source?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-target?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []*gorm.DB{source, target} {
		if err := db.AutoMigrate(&model.Resource{}, &model.CanvasSnapshotResource{}); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Resource{ID: "resource"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	refs := []model.CanvasSnapshotResource{{SnapshotID: "b", ResourceID: "resource"}, {SnapshotID: "a", ResourceID: "resource"}}
	if err := source.Create(&refs).Error; err != nil {
		t.Fatal(err)
	}
	count, err := migrateTable[model.CanvasSnapshotResource]("canvas_snapshot_resources").run(source, target, true)
	if err != nil || count != 2 {
		t.Fatalf("history refs not copied/verified: %d %v", count, err)
	}
}

func TestLUTLibraryMigrationReplacesTargetSeedsWithSourceState(t *testing.T) {
	var databases []*gorm.DB
	for _, name := range []string{"source", "target"} {
		db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), name+".db")), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := db.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
		if err := database.MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		databases = append(databases, db)
	}
	source, target := databases[0], databases[1]
	if err := source.Where("id = ?", "lut-builtin-clear").Delete(&model.LUTLibraryItem{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := source.Model(&model.LUTLibraryItem{}).Where("id = ?", "lut-builtin-warm").Updates(map[string]any{"name": "管理员修改", "enabled": false, "version": 2}).Error; err != nil {
		t.Fatal(err)
	}
	migration := migrateLUTLibraryTable()
	if count, err := migration.run(source, target, true); err != nil || count != 5 {
		t.Fatalf("copy source library over seeds: %d %v", count, err)
	}
	if count, err := migration.run(source, target, false); err != nil || count != 5 {
		t.Fatalf("verify existing migration: %d %v", count, err)
	}
	if err := source.Where("1 = 1").Delete(&model.LUTLibraryItem{}).Error; err != nil {
		t.Fatal(err)
	}
	if count, err := migration.run(source, target, true); err != nil || count != 0 {
		t.Fatalf("empty source must not resurrect target seeds: %d %v", count, err)
	}
}

func TestMigrationDependencyOrder(t *testing.T) {
	positions := make(map[string]int)
	for i, migration := range migrations() {
		positions[migration.name] = i
	}
	for _, dependency := range [][2]string{
		{"channel_websites", "model_channels"},
		{"model_channels", "channel_catalog_snapshots"},
		{"channel_websites", "channel_protocol_selections"},
		{"channel_models", "channel_protocol_selections"},
		{"users", "channel_protocol_selections"},
		{"users", "mcp_connection_grants"},
		{"mcp_connections", "mcp_connection_grants"},
		{"users", "mcp_storage_usages"},
		{"users", "agent_storage_usages"},
	} {
		parent, parentFound := positions[dependency[0]]
		child, childFound := positions[dependency[1]]
		if !parentFound || !childFound || parent >= child {
			t.Errorf("migration must copy %s before %s", dependency[0], dependency[1])
		}
	}
}
