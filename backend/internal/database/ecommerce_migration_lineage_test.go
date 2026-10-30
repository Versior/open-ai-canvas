package database

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

type migrationFixture struct {
	version   int64
	name      string
	checksum  string
	apply     func(*gorm.DB) error
	appliedAt time.Time
}

func openLineageTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func applyCanonicalMigrationsThrough(t *testing.T, db *gorm.DB, version int64) {
	t.Helper()
	for _, item := range schemaMigrations {
		if item.version > version {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatalf("apply migration %d: %v", item.version, err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func legacyEcommerceSchema59Database(t *testing.T) (*gorm.DB, [2]time.Time) {
	t.Helper()
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 57)
	applied := [2]time.Time{
		time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 18, 8, 1, 0, 0, time.UTC),
	}
	if err := db.AutoMigrate(&model.EcommerceLibrary{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 58, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum, AppliedAt: applied[0]}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.EcommerceLibrary{UserID: "owner", Revision: 7, PayloadJSON: `{"items":[{"id":"kept-item"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "legacy-shop", UserID: "owner", Revision: 3, PayloadJSON: `{"nodes":[{"type":"product","metadata":{"content":"kept"}}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateEcommerceCanvasKind(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 59, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum, AppliedAt: applied[1]}).Error; err != nil {
		t.Fatal(err)
	}
	return db, applied
}

func forkSchema74Database(t *testing.T) (*gorm.DB, [3]time.Time) {
	t.Helper()
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 71)
	applied := [3]time.Time{
		time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC),
		time.Date(2026, 10, 21, 8, 1, 0, 0, time.UTC),
		time.Date(2026, 10, 27, 8, 2, 0, 0, time.UTC),
	}
	if err := db.AutoMigrate(&model.EcommerceLibrary{}); err != nil {
		t.Fatal(err)
	}
	if err := migrateEcommerceCanvasKind(db); err != nil {
		t.Fatal(err)
	}
	if err := migrateReferralCenter(db); err != nil {
		t.Fatal(err)
	}
	for _, record := range []schemaMigration{
		{Version: 72, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum, AppliedAt: applied[0]},
		{Version: 73, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum, AppliedAt: applied[1]},
		{Version: 74, Name: referralCenterMigrationName, Checksum: referralCenterMigrationChecksum, AppliedAt: applied[2]},
	} {
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.EcommerceLibrary{UserID: "fork-owner", Revision: 4, PayloadJSON: `{"items":[{"id":"fork-kept"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ReferralProfile{UserID: "fork-promoter", Code: "FORK2026", CreatedAt: applied[2]}).Error; err != nil {
		t.Fatal(err)
	}
	return db, applied
}

func upstreamSchemaDatabase(t *testing.T, version int64) (*gorm.DB, map[int64]time.Time) {
	t.Helper()
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 71)
	fixtures := []migrationFixture{
		{72, referralCenterMigrationName, upstreamReferralCenterMigrationChecksum, migrateReferralCenter, time.Date(2026, 10, 27, 9, 0, 0, 0, time.UTC)},
		{73, dramaEpisodeSourceFormatMigrationName, dramaEpisodeSourceFormatMigrationChecksum, migrateDramaEpisodeSourceFormat, time.Date(2026, 10, 27, 9, 1, 0, 0, time.UTC)},
		{74, dramaSegmentReferencesMigrationName, dramaSegmentReferencesMigrationChecksum, migrateDramaSegmentReferences, time.Date(2026, 10, 27, 9, 2, 0, 0, time.UTC)},
		{75, userGroupsPricingCurrencyMigrationName, userGroupsPricingCurrencyMigrationChecksum, migrateUserGroupsPricingCurrency, time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)},
		{76, agentMemoryDocumentSkillDiscoveryMigrationName, agentMemoryDocumentSkillDiscoveryMigrationChecksum, migrateAgentMemoryDocumentSkillDiscovery, time.Date(2026, 10, 28, 9, 1, 0, 0, time.UTC)},
		{77, agentMemoryDocumentColumnsMigrationName, agentMemoryDocumentColumnsMigrationChecksum, migrateAgentMemoryDocumentColumns, time.Date(2026, 10, 28, 9, 2, 0, 0, time.UTC)},
	}
	applied := make(map[int64]time.Time, len(fixtures))
	for _, fixture := range fixtures {
		if fixture.version > version {
			break
		}
		if err := fixture.apply(db); err != nil {
			t.Fatalf("apply upstream migration %d: %v", fixture.version, err)
		}
		if err := db.Create(&schemaMigration{Version: fixture.version, Name: fixture.name, Checksum: fixture.checksum, AppliedAt: fixture.appliedAt}).Error; err != nil {
			t.Fatal(err)
		}
		applied[fixture.version] = fixture.appliedAt
	}
	if err := db.Create(&model.ReferralProfile{UserID: "upstream-promoter", Code: "UPSTREAM26", CreatedAt: applied[72]}).Error; err != nil {
		t.Fatal(err)
	}
	return db, applied
}

func requireMigration(t *testing.T, db *gorm.DB, want schemaMigration) {
	t.Helper()
	var got schemaMigration
	if err := db.First(&got, "version = ?", want.Version).Error; err != nil {
		t.Fatal(err)
	}
	if got.Name != want.Name || got.Checksum != want.Checksum || (!want.AppliedAt.IsZero() && !got.AppliedAt.Equal(want.AppliedAt)) {
		t.Fatalf("migration %d = %#v, want %#v", want.Version, got, want)
	}
}

func TestCanonicalEcommerceDramaMigrationLineage(t *testing.T) {
	if CurrentSchemaVersion != 79 {
		t.Fatalf("CurrentSchemaVersion = %d", CurrentSchemaVersion)
	}
	want := []schemaMigration{
		{Version: 72, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum},
		{Version: 73, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum},
		{Version: 74, Name: referralCenterMigrationName, Checksum: referralCenterMigrationChecksum},
		{Version: 75, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum},
		{Version: 76, Name: dramaSegmentReferencesMigrationName, Checksum: dramaSegmentReferencesMigrationChecksum},
		{Version: 77, Name: userGroupsPricingCurrencyMigrationName, Checksum: userGroupsPricingCurrencyMigrationChecksum},
		{Version: 78, Name: agentMemoryDocumentSkillDiscoveryMigrationName, Checksum: agentMemoryDocumentSkillDiscoveryMigrationChecksum},
		{Version: 79, Name: agentMemoryDocumentColumnsMigrationName, Checksum: agentMemoryDocumentColumnsMigrationChecksum},
	}
	got := schemaMigrations[len(schemaMigrations)-len(want):]
	for index, item := range want {
		if got[index].version != item.Version || got[index].name != item.Name || got[index].checksum != item.Checksum {
			t.Fatalf("migration tail[%d] = %#v, want %#v", index, got[index], item)
		}
	}
}

func TestMigrateSchemaPreservesForkSchema74(t *testing.T) {
	db, applied := forkSchema74Database(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade fork schema 74: %v", err)
	}
	for _, want := range []schemaMigration{
		{Version: 72, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum, AppliedAt: applied[0]},
		{Version: 73, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum, AppliedAt: applied[1]},
		{Version: 74, Name: referralCenterMigrationName, Checksum: referralCenterMigrationChecksum, AppliedAt: applied[2]},
		{Version: 75, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum},
		{Version: 76, Name: dramaSegmentReferencesMigrationName, Checksum: dramaSegmentReferencesMigrationChecksum},
	} {
		requireMigration(t, db, want)
	}
	var library model.EcommerceLibrary
	if err := db.First(&library, "user_id = ?", "fork-owner").Error; err != nil || library.PayloadJSON != `{"items":[{"id":"fork-kept"}]}` {
		t.Fatalf("fork ecommerce data changed: %#v err=%v", library, err)
	}
	var profile model.ReferralProfile
	if err := db.First(&profile, "user_id = ?", "fork-promoter").Error; err != nil || profile.Code != "FORK2026" {
		t.Fatalf("fork referral data changed: %#v err=%v", profile, err)
	}
}

func TestMigrateSchemaNormalizesUpstreamSchemas(t *testing.T) {
	for _, version := range []int64{72, 73, 74, 75, 76, 77} {
		t.Run(strconv.FormatInt(version, 10), func(t *testing.T) {
			db, applied := upstreamSchemaDatabase(t, version)
			if err := MigrateSchema(db); err != nil {
				t.Fatalf("upgrade upstream schema %d: %v", version, err)
			}
			for _, want := range []schemaMigration{
				{Version: 72, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum},
				{Version: 73, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum},
				{Version: 74, Name: referralCenterMigrationName, Checksum: referralCenterMigrationChecksum, AppliedAt: applied[72]},
				{Version: 75, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum, AppliedAt: applied[73]},
				{Version: 76, Name: dramaSegmentReferencesMigrationName, Checksum: dramaSegmentReferencesMigrationChecksum, AppliedAt: applied[74]},
				{Version: 77, Name: userGroupsPricingCurrencyMigrationName, Checksum: userGroupsPricingCurrencyMigrationChecksum, AppliedAt: applied[75]},
				{Version: 78, Name: agentMemoryDocumentSkillDiscoveryMigrationName, Checksum: agentMemoryDocumentSkillDiscoveryMigrationChecksum, AppliedAt: applied[76]},
				{Version: 79, Name: agentMemoryDocumentColumnsMigrationName, Checksum: agentMemoryDocumentColumnsMigrationChecksum, AppliedAt: applied[77]},
			} {
				requireMigration(t, db, want)
			}
			var profile model.ReferralProfile
			if err := db.First(&profile, "user_id = ?", "upstream-promoter").Error; err != nil || profile.Code != "UPSTREAM26" {
				t.Fatalf("upstream referral data changed: %#v err=%v", profile, err)
			}
		})
	}
}

func TestMigrateSchemaNormalizesLegacyEcommerceSchema59(t *testing.T) {
	db, applied := legacyEcommerceSchema59Database(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade legacy ecommerce schema 59: %v", err)
	}
	for _, want := range []schemaMigration{
		{Version: 58, Name: "agent_memory_proposals", Checksum: "sha256:agent-memory-proposals-v58"},
		{Version: 59, Name: "channel_model_protocol_length", Checksum: "sha256:channel-model-protocol-length-v59"},
		{Version: 72, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum, AppliedAt: applied[0]},
		{Version: 73, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum, AppliedAt: applied[1]},
		{Version: 74, Name: referralCenterMigrationName, Checksum: referralCenterMigrationChecksum},
		{Version: 75, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum},
		{Version: 76, Name: dramaSegmentReferencesMigrationName, Checksum: dramaSegmentReferencesMigrationChecksum},
	} {
		requireMigration(t, db, want)
	}
	var library model.EcommerceLibrary
	if err := db.First(&library, "user_id = ?", "owner").Error; err != nil || library.Revision != 7 {
		t.Fatalf("ecommerce library changed: %#v err=%v", library, err)
	}
	var project model.CanvasProject
	if err := db.First(&project, "id = ?", "legacy-shop").Error; err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Kind  string `json:"kind"`
		Nodes []struct {
			Metadata struct {
				Content string `json:"content"`
			} `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(project.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Kind != "ecommerce" || len(payload.Nodes) != 1 || payload.Nodes[0].Metadata.Content != "kept" {
		t.Fatalf("ecommerce canvas changed: %s", project.PayloadJSON)
	}
}

func TestMigrateSchemaRejectsInexactLineagesBeforeChangingLedger(t *testing.T) {
	t.Run("fork checksum", func(t *testing.T) {
		db, _ := forkSchema74Database(t)
		if err := db.Model(&schemaMigration{}).Where("version = ?", 73).Update("checksum", "sha256:tampered").Error; err != nil {
			t.Fatal(err)
		}
		if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
			t.Fatalf("expected strict fork lineage rejection, got %v", err)
		}
		var count int64
		if err := db.Model(&schemaMigration{}).Where("version > ?", 74).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("rejected fork lineage changed ledger: count=%d err=%v", count, err)
		}
	})

	t.Run("upstream continuity", func(t *testing.T) {
		db, _ := upstreamSchemaDatabase(t, 73)
		if err := db.Delete(&schemaMigration{}, 72).Error; err != nil {
			t.Fatal(err)
		}
		if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "连续") {
			t.Fatalf("expected upstream continuity rejection, got %v", err)
		}
		requireMigration(t, db, schemaMigration{Version: 73, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum})
	})

	t.Run("legacy checksum", func(t *testing.T) {
		db, _ := legacyEcommerceSchema59Database(t)
		if err := db.Model(&schemaMigration{}).Where("version = ?", 59).Update("checksum", "sha256:tampered").Error; err != nil {
			t.Fatal(err)
		}
		if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
			t.Fatalf("expected strict legacy lineage rejection, got %v", err)
		}
		var count int64
		if err := db.Model(&schemaMigration{}).Where("version IN ?", []int64{72, 73}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("rejected legacy lineage changed ledger: count=%d err=%v", count, err)
		}
	})
}

func TestMigrateSchemaRejectsUpstreamLedgerWithoutPhysicalSchema(t *testing.T) {
	tests := []struct {
		name    string
		version int64
		breakDB func(*gorm.DB) error
	}{
		{"referral table", 72, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.ReferralBinding{}) }},
		{"promoter index", 72, func(db *gorm.DB) error { return db.Migrator().DropIndex(&model.User{}, "IsPromoter") }},
		{"episode source column", 73, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaEpisode{}, "SourceFormat") }},
		{"segment references column", 74, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON")
		}},
		{"user group table", 75, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.UserGroup{}) }},
		{"memory document table", 76, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.AgentMemoryDocument{}) }},
		{"memory sequence column", 77, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.AgentMemoryDocument{}, "NextEntrySeq") }},
		{"user group channel table", 75, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.UserGroupChannel{}) }},
		{"user group index", 75, func(db *gorm.DB) error { return db.Migrator().DropIndex(&model.User{}, "UserGroup") }},
		{"user group column", 75, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.User{}, "UserGroup") }},
		{"channel model price currency column", 75, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.ChannelModel{}, "PriceCurrency")
		}},
		{"topup product currency column", 75, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.TopupProduct{}, "Currency")
		}},
		{"billing order user group column", 75, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "UserGroup")
		}},
		{"billing order price currency column", 75, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "PriceCurrency")
		}},
		{"billing order currency rate column", 75, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "CurrencyRateMicrocredits")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, _ := upstreamSchemaDatabase(t, test.version)
			if err := test.breakDB(db); err != nil {
				t.Fatal(err)
			}
			if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "物理结构") {
				t.Fatalf("expected physical schema rejection, got %v", err)
			}
			requireMigration(t, db, schemaMigration{Version: 72, Name: referralCenterMigrationName, Checksum: upstreamReferralCenterMigrationChecksum})
		})
	}
}

func TestMigrateSchemaRejectsCanonicalLedgerWithoutPhysicalSchema(t *testing.T) {
	tests := []struct {
		name    string
		version int64
		breakDB func(*gorm.DB) error
	}{
		{"referral table", 74, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.ReferralBinding{}) }},
		{"promoter index", 74, func(db *gorm.DB) error { return db.Migrator().DropIndex(&model.User{}, "IsPromoter") }},
		{"episode source column", 75, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaEpisode{}, "SourceFormat") }},
		{"segment references column", 76, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.DramaSegment{}, "ReferenceCastIDsJSON")
		}},
		{"user group table", 77, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.UserGroup{}) }},
		{"user group channel table", 77, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.UserGroupChannel{}) }},
		{"user group index", 77, func(db *gorm.DB) error { return db.Migrator().DropIndex(&model.User{}, "UserGroup") }},
		{"user group column", 77, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.User{}, "UserGroup") }},
		{"channel model price currency column", 77, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.ChannelModel{}, "PriceCurrency")
		}},
		{"topup product currency column", 77, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.TopupProduct{}, "Currency")
		}},
		{"billing order user group column", 77, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "UserGroup")
		}},
		{"billing order price currency column", 77, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "PriceCurrency")
		}},
		{"billing order currency rate column", 77, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "CurrencyRateMicrocredits")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := openLineageTestDatabase(t)
			applyCanonicalMigrationsThrough(t, db, test.version)
			if err := test.breakDB(db); err != nil {
				t.Fatal(err)
			}
			if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "物理结构") {
				t.Fatalf("expected canonical physical schema rejection, got %v", err)
			}
		})
	}
}

func TestMigrateSchemaRollsBackUpstreamRelocationWithLaterFailure(t *testing.T) {
	db, applied := upstreamSchemaDatabase(t, 74)
	if err := db.Exec(`CREATE TRIGGER reject_ecommerce_ledger BEFORE INSERT ON schema_migrations WHEN NEW.version = 72 BEGIN SELECT RAISE(FAIL, 'reject ecommerce ledger'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "reject ecommerce ledger") {
		t.Fatalf("expected injected migration failure, got %v", err)
	}
	for _, want := range []schemaMigration{
		{Version: 72, Name: referralCenterMigrationName, Checksum: upstreamReferralCenterMigrationChecksum, AppliedAt: applied[72]},
		{Version: 73, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum, AppliedAt: applied[73]},
		{Version: 74, Name: dramaSegmentReferencesMigrationName, Checksum: dramaSegmentReferencesMigrationChecksum, AppliedAt: applied[74]},
	} {
		requireMigration(t, db, want)
	}
	var count int64
	if err := db.Model(&schemaMigration{}).Where("version > ?", 74).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("failed transaction left relocated records: count=%d err=%v", count, err)
	}

}
