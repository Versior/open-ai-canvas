package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/database"
	"yingce/backend/internal/interior"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestInteriorEstimateUsesPreparedVariantsWithoutTasksOrFinancialWrites(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-1")
	svc, db, channel, cm := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{newSelectionPriceTier("interior-price", `{}`, "gpt-image-1", "fixed_request")})
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "quote-user", Username: "quote-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(actor).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: actor.ID, AvailableMicrocredits: 10_000_000, ReservedMicrocredits: 250_000, Version: 7}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnsureBuiltinInteriorCatalog(); err != nil {
		t.Fatal(err)
	}
	features := platform.DefaultFeatureAvailability()
	features.InteriorEnabled = true
	if _, err := svc.UpdateFeatureAvailability(videoReplicationTestAdmin, features); err != nil {
		t.Fatal(err)
	}
	mode, err := svc.repo.InteriorModeByKey("style-redesign")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "quote-image", UserID: actor.ID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	req := InteriorGenerateInput{Surface: "pro", ModeID: mode.ID, RoomKey: "living-room", StyleKeys: []string{"modern-minimal", "wabi-sabi"}, Count: 2, SourceResourceID: "quote-image", Model: &interior.ModelRef{ChannelID: channel.ID, Model: cm.ModelKey}}
	estimate, err := svc.EstimateInterior(actor, req)
	if err != nil {
		t.Fatal(err)
	}
	if estimate.Images != 4 || estimate.AmountMicrocredits != 20 || estimate.Estimated {
		t.Fatalf("estimate = %+v", estimate)
	}
	assertVideoQuoteHasNoFinancialWrites(t, db)
	spec := interior.RenovationSpec{Scope: "wall", Stage: "renovation", WidthMM: 3600, HeightMM: 2600, Material: "marble", Finish: "honed", Pattern: "bookmatch", SlabWidthMM: 1800, SlabHeightMM: 2600, SeamMM: 2, WastePercent: 10, Lighting: "daylight"}
	req.Professional = &spec
	if err := db.Create(&model.Resource{ID: "stone-image", UserID: actor.ID, Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"resourceId":"stone-image"}`), &spec.Texture); err != nil {
		t.Fatal(err)
	}
	prepared, err := svc.prepareInteriorGeneration(actor, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(prepared.refs) != 2 || !strings.Contains(prepared.prompts[0], "左右对纹") {
		t.Fatalf("material input missing from generation")
	}
	if _, err := svc.EstimateInterior(actor, req); err != nil {
		t.Fatal(err)
	}
	spec.Texture.ResourceID = "foreign-stone"
	if _, err := svc.EstimateInterior(actor, req); err == nil {
		t.Fatal("estimate accepted foreign material")
	}
	doc, _ := json.Marshal(map[string]any{"professional": spec})
	if err := svc.validateInteriorMaterialRef(actor.ID, string(doc)); err == nil {
		t.Fatal("project accepted foreign material")
	}
	doc, _ = json.Marshal(map[string]any{"rounds": []any{map[string]any{"professional": spec}}})
	if err := svc.validateInteriorMaterialRef(actor.ID, string(doc)); err == nil {
		t.Fatal("project history accepted foreign material")
	}
	req.Professional = nil
	req.SourceResourceID = "foreign-image"
	if _, err := svc.EstimateInterior(actor, req); err == nil {
		t.Fatal("estimate accepted an inaccessible source")
	}
}
