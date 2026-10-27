package database

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func legacyEcommerceSchema59Database(t *testing.T) (*gorm.DB, time.Time, time.Time) {
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
	for _, item := range schemaMigrations {
		if item.version > 57 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatalf("apply migration %d: %v", item.version, err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	applied58 := time.Date(2026, 10, 18, 8, 0, 0, 0, time.UTC)
	if err := db.AutoMigrate(&model.EcommerceLibrary{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 58, Name: "ecommerce_private_library", Checksum: "sha256:ecommerce-private-library-v58", AppliedAt: applied58}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.EcommerceLibrary{UserID: "owner", Revision: 7, PayloadJSON: `{"items":[{"id":"kept-item"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "legacy-shop", UserID: "owner", Revision: 3, PayloadJSON: `{"nodes":[{"type":"product","metadata":{"content":"kept"}}]}`}).Error; err != nil {
		t.Fatal(err)
	}

	applied59 := time.Date(2026, 10, 18, 8, 1, 0, 0, time.UTC)
	if err := migrateEcommerceCanvasKind(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 59, Name: "restore_ecommerce_canvas_kind", Checksum: "sha256:restore-ecommerce-canvas-kind-v59", AppliedAt: applied59}).Error; err != nil {
		t.Fatal(err)
	}
	return db, applied58, applied59
}

func TestMigrateSchemaNormalizesLegacyEcommerceSchema59(t *testing.T) {
	db, applied58, applied59 := legacyEcommerceSchema59Database(t)

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade legacy ecommerce schema 59: %v", err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected schema status: %#v", status)
	}

	for _, want := range []schemaMigration{
		{Version: 58, Name: "agent_memory_proposals", Checksum: "sha256:agent-memory-proposals-v58"},
		{Version: 59, Name: "channel_model_protocol_length", Checksum: "sha256:channel-model-protocol-length-v59"},
		{Version: 72, Name: "ecommerce_private_library", Checksum: "sha256:ecommerce-private-library-v58", AppliedAt: applied58},
		{Version: 73, Name: "restore_ecommerce_canvas_kind", Checksum: "sha256:restore-ecommerce-canvas-kind-v59", AppliedAt: applied59},
	} {
		var got schemaMigration
		if err := db.First(&got, "version = ?", want.Version).Error; err != nil {
			t.Fatal(err)
		}
		if got.Name != want.Name || got.Checksum != want.Checksum {
			t.Fatalf("migration %d = %#v, want name=%q checksum=%q", want.Version, got, want.Name, want.Checksum)
		}
		if !want.AppliedAt.IsZero() && !got.AppliedAt.Equal(want.AppliedAt) {
			t.Fatalf("migration %d applied_at = %v, want %v", want.Version, got.AppliedAt, want.AppliedAt)
		}
	}

	var library model.EcommerceLibrary
	if err := db.First(&library, "user_id = ?", "owner").Error; err != nil {
		t.Fatal(err)
	}
	if library.Revision != 7 || library.PayloadJSON != `{"items":[{"id":"kept-item"}]}` {
		t.Fatalf("ecommerce library changed: %#v", library)
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

func TestMigrateSchemaRejectsInexactLegacyEcommerceLineage(t *testing.T) {
	db, _, _ := legacyEcommerceSchema59Database(t)
	if err := db.Model(&schemaMigration{}).Where("version = ?", 59).Update("checksum", "sha256:tampered").Error; err != nil {
		t.Fatal(err)
	}

	err := MigrateSchema(db)
	if err == nil || !strings.Contains(err.Error(), "校验和不一致") {
		t.Fatalf("expected strict legacy lineage rejection, got %v", err)
	}
	var count int64
	if err := db.Model(&schemaMigration{}).Where("version IN ?", []int64{72, 73}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("rejected lineage partially relocated %d records", count)
	}
}

func TestMigrateSchemaNormalizesUpstreamReferralSchema72(t *testing.T) {
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
	for _, item := range schemaMigrations {
		if item.version > 71 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatalf("apply migration %d: %v", item.version, err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	appliedAt := time.Date(2026, 10, 27, 8, 0, 0, 0, time.UTC)
	if err := migrateReferralCenter(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 72, Name: "referral_center", Checksum: "sha256:referral-center-v72-20261027", AppliedAt: appliedAt}).Error; err != nil {
		t.Fatal(err)
	}
	profile := model.ReferralProfile{UserID: "promoter", Code: "KEEP2026", CreatedAt: appliedAt}
	binding := model.ReferralBinding{InviteeUserID: "invitee", InviterUserID: "promoter", Code: profile.Code, CreatedAt: appliedAt.Add(time.Minute)}
	commission := model.ReferralCommission{ID: "commission", InviterUserID: "promoter", InviteeUserID: "invitee", PaymentOrderID: "payment", OrderAmountFen: 9900, OrderCreditsMicrocredits: 1000000, RateBasisPoints: 1000, CommissionMicrocredits: 100000, LedgerEntryID: "ledger", CreatedAt: appliedAt.Add(2 * time.Minute)}
	for _, value := range []any{&profile, &binding, &commission} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade upstream referral schema 72: %v", err)
	}
	var moved schemaMigration
	if err := db.First(&moved, "version = ?", 74).Error; err != nil {
		t.Fatal(err)
	}
	if moved.Name != "referral_center" || moved.Checksum != "sha256:referral-center-v74-20261027" || !moved.AppliedAt.Equal(appliedAt) {
		t.Fatalf("unexpected relocated referral migration: %#v", moved)
	}

	var gotProfile model.ReferralProfile
	var gotBinding model.ReferralBinding
	var gotCommission model.ReferralCommission
	if err := db.First(&gotProfile, "user_id = ?", profile.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotBinding, "invitee_user_id = ?", binding.InviteeUserID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotCommission, "id = ?", commission.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotProfile.Code != profile.Code || gotBinding.InviterUserID != binding.InviterUserID || gotCommission.CommissionMicrocredits != commission.CommissionMicrocredits {
		t.Fatalf("referral data changed: profile=%#v binding=%#v commission=%#v", gotProfile, gotBinding, gotCommission)
	}
}
