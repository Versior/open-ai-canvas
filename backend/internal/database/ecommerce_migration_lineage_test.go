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
		{78, dramaCastVoiceLooksMigrationName, dramaCastVoiceLooksMigrationChecksum, migrateDramaCastVoiceLooks, time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)},
		{79, ecommerceAgentKnowledgeMigrationName, upstreamEcommerceAgentKnowledgeMigrationChecksum, migrateEcommerceFeature, time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)},
		{80, paymentOrderChargeMethodMigrationName, paymentOrderChargeMethodMigrationChecksum, migratePaymentOrderChargeMethod, time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC)},
		{81, arkPortraitAssetsMigrationName, arkPortraitAssetsMigrationChecksum, func(tx *gorm.DB) error {
			return tx.AutoMigrate(&model.ArkPortraitSession{}, &model.ArkPortraitGroup{}, &model.ArkPortraitAsset{})
		}, time.Date(2026, 11, 4, 9, 1, 0, 0, time.UTC)},
		{82, tokenCacheWritePriceMigrationName, tokenCacheWritePriceMigrationChecksum, migrateTokenCacheWritePrice, time.Date(2026, 11, 5, 9, 0, 0, 0, time.UTC)},
		{83, skillAdminEditsMigrationName, skillAdminEditsMigrationChecksum, migrateSkillAdminEdits, time.Date(2026, 11, 5, 9, 1, 0, 0, time.UTC)},
		{84, tokenPriceRulesMigrationName, tokenPriceRulesMigrationChecksum, migrateTokenPriceRules, time.Date(2026, 11, 5, 9, 2, 0, 0, time.UTC)},
		{85, poseLibraryMigrationName, poseLibraryMigrationChecksum, func(tx *gorm.DB) error {
			return tx.AutoMigrate(&model.PoseLibrarySource{}, &model.PoseLibraryItem{})
		}, time.Date(2026, 11, 5, 9, 3, 0, 0, time.UTC)},
		{86, arkAssetGroupsMigrationName, arkAssetGroupsMigrationChecksum, migrateArkAssetGroups, time.Date(2026, 11, 5, 9, 4, 0, 0, time.UTC)},
		{87, inspirationFeedMigrationName, inspirationFeedMigrationChecksum, func(tx *gorm.DB) error {
			return tx.AutoMigrate(&model.InspirationFeedEntry{})
		}, time.Date(2026, 11, 5, 9, 5, 0, 0, time.UTC)},
		{88, "reference_video_billing", "sha256:reference-video-billing-v88-20261106", migrateReferenceVideoBilling, time.Date(2026, 11, 6, 9, 0, 0, 0, time.UTC)},
		{89, "reference_video_cost_price", "sha256:reference-video-cost-price-v89-20261106", migrateReferenceVideoCostPrice, time.Date(2026, 11, 6, 9, 1, 0, 0, time.UTC)},
		{90, "drama_draft_form", "sha256:drama-draft-form-v90-20261106", func(tx *gorm.DB) error {
			if tx.Migrator().HasColumn(&model.DramaProduction{}, "DraftJSON") {
				return nil
			}
			return tx.Migrator().AddColumn(&model.DramaProduction{}, "DraftJSON")
		}, time.Date(2026, 11, 6, 9, 2, 0, 0, time.UTC)},
		{91, "email_logs_and_notifications", "sha256:email-logs-and-notifications-v91-20261106", func(tx *gorm.DB) error {
			return tx.AutoMigrate(&model.EmailLog{}, &model.UserNotificationSetting{})
		}, time.Date(2026, 11, 6, 9, 3, 0, 0, time.UTC)},
		{92, "drama_reference_controls", "sha256:drama-reference-controls-v92", func(tx *gorm.DB) error {
			for _, item := range schemaMigrations {
				if item.name == "drama_reference_controls" {
					return item.apply(tx)
				}
			}
			t.Fatal("reference controls migration is not registered")
			return nil
		}, time.Date(2026, 11, 8, 9, 0, 0, 0, time.UTC)},
	}
	for _, item := range schemaMigrations {
		if item.version >= 100 {
			fixtures = append(fixtures, migrationFixture{item.version - 7, item.name, item.checksum, item.apply, time.Date(2026, 11, 11, 9, int(item.version-100), 0, 0, time.UTC)})
		}
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
	if CurrentSchemaVersion != 107 {
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
		{Version: 80, Name: ecommerceAgentKnowledgeMigrationName, Checksum: ecommerceAgentKnowledgeMigrationChecksum},
		{Version: 81, Name: dramaCastVoiceLooksMigrationName, Checksum: dramaCastVoiceLooksMigrationChecksum},
		{Version: 82, Name: paymentOrderChargeMethodMigrationName, Checksum: paymentOrderChargeMethodMigrationChecksum},
		{Version: 83, Name: arkPortraitAssetsMigrationName, Checksum: arkPortraitAssetsMigrationChecksum},
		{Version: 84, Name: agentPetSkinsMigrationName, Checksum: agentPetSkinsMigrationChecksum},
		{Version: 85, Name: studioModelLibraryMigrationName, Checksum: studioModelLibraryMigrationChecksum},
		{Version: 86, Name: interiorDesignMigrationName, Checksum: interiorDesignMigrationChecksum},
		{Version: 87, Name: tokenCacheWritePriceMigrationName, Checksum: tokenCacheWritePriceMigrationChecksum},
		{Version: 88, Name: skillAdminEditsMigrationName, Checksum: skillAdminEditsMigrationChecksum},
		{Version: 89, Name: tokenPriceRulesMigrationName, Checksum: tokenPriceRulesMigrationChecksum},
		{Version: 90, Name: poseLibraryMigrationName, Checksum: poseLibraryMigrationChecksum},
		{Version: 91, Name: arkAssetGroupsMigrationName, Checksum: arkAssetGroupsMigrationChecksum},
		{Version: 92, Name: inspirationFeedMigrationName, Checksum: inspirationFeedMigrationChecksum},
		{Version: 93, Name: interiorKnowledgeMigrationName, Checksum: interiorKnowledgeMigrationChecksum},
		{Version: 94, Name: "reference_video_billing", Checksum: "sha256:reference-video-billing-v88-20261106"},
		{Version: 95, Name: "reference_video_cost_price", Checksum: "sha256:reference-video-cost-price-v89-20261106"},
		{Version: 96, Name: "drama_draft_form", Checksum: "sha256:drama-draft-form-v90-20261106"},
		{Version: 97, Name: "email_logs_and_notifications", Checksum: "sha256:email-logs-and-notifications-v91-20261106"},
		{Version: 98, Name: "drama_reference_controls", Checksum: "sha256:drama-reference-controls-v92"},
		{Version: 99, Name: "lut_library", Checksum: "sha256:lut-library-v99-20261109"},
	}
	got := schemaMigrations[len(schemaMigrations)-len(want)-8 : len(schemaMigrations)-8]
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

func TestMigrateSchemaUpgradesFork93WithMissingNewColumns(t *testing.T) {
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 93)
	var originalLedger []schemaMigration
	if err := db.Order("version").Find(&originalLedger).Error; err != nil {
		t.Fatal(err)
	}
	library := model.EcommerceLibrary{UserID: "fork-owner", Revision: 8, PayloadJSON: `{"items":[{"id":"kept"}]}`}
	knowledge := model.InteriorKnowledgeEntry{ID: "custom-knowledge", Key: "custom", Kind: "dimensions", Title: "Custom", Guidance: "Keep this guidance", Edited: true, Version: 3}
	if err := db.Create(&library).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&knowledge).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModel{ID: "token-video", ChannelID: "channel", ModelKey: "video", Capability: "video"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModelPriceTier{ID: "tier", ChannelModelID: "token-video", SelectorKey: "{}", BillingMode: "token", OutputTokenPriceMicrocredits: 160, CostPricing: model.CreditCostPricing{Configured: true, OutputTokenPriceMicrocredits: 60}}).Error; err != nil {
		t.Fatal(err)
	}
	// 旧迁移中的 AutoMigrate 使用当前模型，必须移除新字段，才能验证真实的 93→97 升级。
	for _, target := range []struct {
		entity  any
		columns []string
	}{
		{&model.ChannelModel{}, []string{"ReferenceVideoBilling"}},
		{&model.ChannelModelPriceTier{}, []string{"reference_video_unit_price_microcredits", "reference_video_output_token_price_microcredits", "cost_reference_video_unit_price_microcredits", "cost_reference_video_output_token_price_microcredits"}},
		{&model.BillingOrder{}, []string{"reference_video_count", "reference_video_millis", "reference_video_billed", "cost_reference_video_unit_price_microcredits", "cost_reference_video_output_token_price_microcredits"}},
		{&model.DramaProduction{}, []string{"DraftJSON"}},
	} {
		for _, column := range target.columns {
			if err := db.Migrator().DropColumn(target.entity, column); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := db.Migrator().DropTable(&model.EmailLog{}, &model.UserNotificationSetting{}); err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade fork schema 93: %v", err)
	}
	for _, record := range originalLedger {
		requireMigration(t, db, record)
	}
	var storedLibrary model.EcommerceLibrary
	if err := db.First(&storedLibrary, "user_id = ?", library.UserID).Error; err != nil || storedLibrary.PayloadJSON != library.PayloadJSON || storedLibrary.Revision != library.Revision {
		t.Fatalf("ecommerce data changed: %#v err=%v", storedLibrary, err)
	}
	var storedKnowledge model.InteriorKnowledgeEntry
	if err := db.First(&storedKnowledge, "id = ?", knowledge.ID).Error; err != nil || storedKnowledge.Guidance != knowledge.Guidance || !storedKnowledge.Edited || storedKnowledge.Version != knowledge.Version {
		t.Fatalf("interior knowledge changed: %#v err=%v", storedKnowledge, err)
	}
	var channelModel model.ChannelModel
	if err := db.First(&channelModel, "id = ?", "token-video").Error; err != nil || !channelModel.ReferenceVideoBilling {
		t.Fatalf("reference billing not enabled: %#v err=%v", channelModel, err)
	}
	var tier model.ChannelModelPriceTier
	if err := db.First(&tier, "id = ?", "tier").Error; err != nil || tier.ReferenceVideoOutputTokenPriceMicrocredits != 160 || tier.CostPricing.ReferenceVideoOutputTokenPriceMicrocredits != 60 {
		t.Fatalf("reference video prices not backfilled: %#v err=%v", tier, err)
	}
	for version := int64(94); version <= 97; version++ {
		if err := validateCanonicalMigrationPhysicalSchema(db, version); err != nil {
			t.Fatal(err)
		}
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateSchemaUpgradesFork97ReferenceControls(t *testing.T) {
	db := openLineageTestDatabase(t)
	applyCanonicalMigrationsThrough(t, db, 97)
	var originalLedger []schemaMigration
	if err := db.Order("version").Find(&originalLedger).Error; err != nil {
		t.Fatal(err)
	}
	cast := model.DramaCast{ID: "kept-cast", Appearance: "白衣"}
	segment := model.DramaSegment{ID: "kept-segment", ReferenceCastIDsJSON: `["kept-cast"]`}
	for _, record := range []any{&cast, &segment} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 旧 AutoMigrate 会读取当前模型，移除新列以复现已部署的 97 号结构。
	for _, target := range []struct {
		entity any
		field  string
	}{
		{&model.DramaCast{}, "ImagePrompt"},
		{&model.DramaSegment{}, "ReferenceImagesJSON"},
		{&model.DramaSegment{}, "AudioCastIDsJSON"},
	} {
		if err := db.Migrator().DropColumn(target.entity, target.field); err != nil {
			t.Fatal(err)
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatalf("upgrade attempt %d: %v", attempt, err)
		}
		for _, record := range originalLedger {
			requireMigration(t, db, record)
		}
		if err := validateCanonicalMigrationPhysicalSchema(db, 98); err != nil {
			t.Fatal(err)
		}
		var storedCast model.DramaCast
		var storedSegment model.DramaSegment
		if err := db.First(&storedCast, "id = ?", cast.ID).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&storedSegment, "id = ?", segment.ID).Error; err != nil {
			t.Fatal(err)
		}
		if storedCast.Appearance != cast.Appearance || storedSegment.ReferenceCastIDsJSON != segment.ReferenceCastIDsJSON {
			t.Fatal("reference controls upgrade changed existing cast or segment data")
		}
		var count int64
		if err := db.Model(&schemaMigration{}).Count(&count).Error; err != nil || count != int64(len(originalLedger))+CurrentSchemaVersion-97 {
			t.Fatalf("upgrade must append migrations after version 97: count=%d err=%v", count, err)
		}
	}
	requireMigration(t, db, schemaMigration{Version: 98, Name: "drama_reference_controls", Checksum: "sha256:drama-reference-controls-v92"})
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateSchemaNormalizesUpstreamSchemas(t *testing.T) {
	for _, version := range []int64{72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99} {
		t.Run(strconv.FormatInt(version, 10), func(t *testing.T) {
			db, applied := upstreamSchemaDatabase(t, version)
			project := model.EcommerceProject{ID: "upstream-shop", UserID: "upstream-owner", Name: "保温杯", Status: "completed", DraftJSON: "{}", PlanJSON: `{"images":[{"id":"kept"}]}`, Revision: 4}
			if version >= 79 {
				if err := db.Create(&project).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := MigrateSchema(db); err != nil {
				t.Fatalf("upgrade upstream schema %d: %v", version, err)
			}
			if version >= 79 {
				var stored model.EcommerceProject
				if err := db.First(&stored, "id = ?", project.ID).Error; err != nil || stored.PlanJSON != project.PlanJSON || stored.Revision != project.Revision {
					t.Fatalf("upstream ecommerce project changed: %#v err=%v", stored, err)
				}
			}
			// 上游 78（短剧声音与造型）在 Fork 为 81，上游 79（电商 Agent）为 80；没跑过的由本次迁移补上，AppliedAt 为零时不比较。
			for _, want := range []schemaMigration{
				{Version: 72, Name: ecommercePrivateLibraryMigrationName, Checksum: ecommercePrivateLibraryMigrationChecksum},
				{Version: 73, Name: restoreEcommerceCanvasKindMigrationName, Checksum: restoreEcommerceCanvasKindMigrationChecksum},
				{Version: 74, Name: referralCenterMigrationName, Checksum: referralCenterMigrationChecksum, AppliedAt: applied[72]},
				{Version: 75, Name: dramaEpisodeSourceFormatMigrationName, Checksum: dramaEpisodeSourceFormatMigrationChecksum, AppliedAt: applied[73]},
				{Version: 76, Name: dramaSegmentReferencesMigrationName, Checksum: dramaSegmentReferencesMigrationChecksum, AppliedAt: applied[74]},
				{Version: 77, Name: userGroupsPricingCurrencyMigrationName, Checksum: userGroupsPricingCurrencyMigrationChecksum, AppliedAt: applied[75]},
				{Version: 78, Name: agentMemoryDocumentSkillDiscoveryMigrationName, Checksum: agentMemoryDocumentSkillDiscoveryMigrationChecksum, AppliedAt: applied[76]},
				{Version: 79, Name: agentMemoryDocumentColumnsMigrationName, Checksum: agentMemoryDocumentColumnsMigrationChecksum, AppliedAt: applied[77]},
				{Version: 80, Name: ecommerceAgentKnowledgeMigrationName, Checksum: ecommerceAgentKnowledgeMigrationChecksum, AppliedAt: applied[79]},
				{Version: 81, Name: dramaCastVoiceLooksMigrationName, Checksum: dramaCastVoiceLooksMigrationChecksum, AppliedAt: applied[78]},
				// 上游 80、81 在 Fork 为 82、83，上游 82 接在 Fork 自有的 84–86 之后为 87；Fork 自有迁移在搬迁后补跑。
				{Version: 82, Name: paymentOrderChargeMethodMigrationName, Checksum: paymentOrderChargeMethodMigrationChecksum, AppliedAt: applied[80]},
				{Version: 83, Name: arkPortraitAssetsMigrationName, Checksum: arkPortraitAssetsMigrationChecksum, AppliedAt: applied[81]},
				{Version: 84, Name: agentPetSkinsMigrationName, Checksum: agentPetSkinsMigrationChecksum},
				{Version: 85, Name: studioModelLibraryMigrationName, Checksum: studioModelLibraryMigrationChecksum},
				{Version: 86, Name: interiorDesignMigrationName, Checksum: interiorDesignMigrationChecksum},
				{Version: 87, Name: tokenCacheWritePriceMigrationName, Checksum: tokenCacheWritePriceMigrationChecksum, AppliedAt: applied[82]},
				// 上游 83–87 顺延五位为 88–92。
				{Version: 88, Name: skillAdminEditsMigrationName, Checksum: skillAdminEditsMigrationChecksum, AppliedAt: applied[83]},
				{Version: 89, Name: tokenPriceRulesMigrationName, Checksum: tokenPriceRulesMigrationChecksum, AppliedAt: applied[84]},
				{Version: 90, Name: poseLibraryMigrationName, Checksum: poseLibraryMigrationChecksum, AppliedAt: applied[85]},
				{Version: 91, Name: arkAssetGroupsMigrationName, Checksum: arkAssetGroupsMigrationChecksum, AppliedAt: applied[86]},
				{Version: 92, Name: inspirationFeedMigrationName, Checksum: inspirationFeedMigrationChecksum, AppliedAt: applied[87]},
				{Version: 93, Name: interiorKnowledgeMigrationName, Checksum: interiorKnowledgeMigrationChecksum},
				{Version: 94, Name: "reference_video_billing", Checksum: "sha256:reference-video-billing-v88-20261106", AppliedAt: applied[88]},
				{Version: 95, Name: "reference_video_cost_price", Checksum: "sha256:reference-video-cost-price-v89-20261106", AppliedAt: applied[89]},
				{Version: 96, Name: "drama_draft_form", Checksum: "sha256:drama-draft-form-v90-20261106", AppliedAt: applied[90]},
				{Version: 97, Name: "email_logs_and_notifications", Checksum: "sha256:email-logs-and-notifications-v91-20261106", AppliedAt: applied[91]},
				{Version: 98, Name: "drama_reference_controls", Checksum: "sha256:drama-reference-controls-v92", AppliedAt: applied[92]},
			} {
				requireMigration(t, db, want)
			}
			if err := RequireSchemaVersion(db); err != nil {
				t.Fatalf("schema after upgrading upstream %d: %v", version, err)
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
	t.Run("upstream latest checksum", func(t *testing.T) {
		db, applied := upstreamSchemaDatabase(t, 92)
		if err := db.Model(&schemaMigration{}).Where("version = ?", 92).Update("checksum", "sha256:tampered").Error; err != nil {
			t.Fatal(err)
		}
		if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
			t.Fatalf("expected latest upstream checksum rejection, got %v", err)
		}
		requireMigration(t, db, schemaMigration{Version: 88, Name: "reference_video_billing", Checksum: "sha256:reference-video-billing-v88-20261106", AppliedAt: applied[88]})
		requireMigration(t, db, schemaMigration{Version: 92, Name: "drama_reference_controls", Checksum: "sha256:tampered", AppliedAt: applied[92]})
	})

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

	// 上游 PR #939 分支把电商 Agent 记为 78；上游 main 从未发布这套编号，按名称不一致拒绝，账本保持原样。
	t.Run("upstream pull request lineage", func(t *testing.T) {
		db, _ := upstreamSchemaDatabase(t, 77)
		if err := migrateEcommerceFeature(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: 78, Name: ecommerceAgentKnowledgeMigrationName, Checksum: ecommerceAgentKnowledgeMigrationChecksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
		if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "名称不一致") {
			t.Fatalf("expected pull request lineage rejection, got %v", err)
		}
		requireMigration(t, db, schemaMigration{Version: 72, Name: referralCenterMigrationName, Checksum: upstreamReferralCenterMigrationChecksum})
		requireMigration(t, db, schemaMigration{Version: 78, Name: ecommerceAgentKnowledgeMigrationName, Checksum: ecommerceAgentKnowledgeMigrationChecksum})
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
		{"drama look column", 78, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaCast{}, "LookName") }},
		{"drama shot look column", 78, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaShot{}, "LookCastIDsJSON") }},
		{"ecommerce agent table", 79, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.EcommerceAgentRun{}) }},
		{"reference billing column", 88, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.ChannelModel{}, "ReferenceVideoBilling")
		}},
		{"reference cost column", 89, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "cost_reference_video_unit_price_microcredits")
		}},
		{"draft form column", 90, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaProduction{}, "DraftJSON") }},
		{"email log table", 91, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.EmailLog{}) }},
		{"notification setting table", 91, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.UserNotificationSetting{}) }},
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
		{"ecommerce agent table", 80, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.EcommerceAgentRun{}) }},
		{"drama look column", 81, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaCast{}, "LookName") }},
		{"reference billing column", 94, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.ChannelModel{}, "ReferenceVideoBilling")
		}},
		{"reference cost column", 95, func(db *gorm.DB) error {
			return db.Migrator().DropColumn(&model.BillingOrder{}, "cost_reference_video_unit_price_microcredits")
		}},
		{"draft form column", 96, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaProduction{}, "DraftJSON") }},
		{"email log table", 97, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.EmailLog{}) }},
		{"notification setting table", 97, func(db *gorm.DB) error { return db.Migrator().DropTable(&model.UserNotificationSetting{}) }},
		{"cast image prompt column", 98, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaCast{}, "ImagePrompt") }},
		{"segment reference images column", 98, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaSegment{}, "ReferenceImagesJSON") }},
		{"segment audio casts column", 98, func(db *gorm.DB) error { return db.Migrator().DropColumn(&model.DramaSegment{}, "AudioCastIDsJSON") }},
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
	for _, version := range []int64{74, 91, 92} {
		t.Run(strconv.FormatInt(version, 10), func(t *testing.T) {
			db, _ := upstreamSchemaDatabase(t, version)
			var originalLedger []schemaMigration
			if err := db.Order("version").Find(&originalLedger).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`CREATE TRIGGER reject_ecommerce_ledger BEFORE INSERT ON schema_migrations WHEN NEW.version = 72 BEGIN SELECT RAISE(FAIL, 'reject ecommerce ledger'); END`).Error; err != nil {
				t.Fatal(err)
			}
			if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "reject ecommerce ledger") {
				t.Fatalf("expected injected migration failure, got %v", err)
			}
			for _, record := range originalLedger {
				requireMigration(t, db, record)
			}
			var count int64
			if err := db.Model(&schemaMigration{}).Where("version > ?", version).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("failed transaction left relocated records: count=%d err=%v", count, err)
			}
		})
	}
}
