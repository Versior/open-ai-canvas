package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/modelpreset"
)

func TestNewChannelModelAutomaticallyFillsMetadataAndPrices(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "auto-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, Name: "Test", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	source := model.ChannelModel{ID: "source", ChannelID: channel.ID, ModelKey: "gemini-2.5-flash", ProviderModelKey: "gemini-2.5-flash", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, PriceConfigured: true, Enabled: true, BillingMode: "token", InputTokenPriceMicrocredits: 123, OutputTokenPriceMicrocredits: 456, PriceVersion: 1}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	item, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{ModelKey: "new-alias", ProviderModelKey: "models/Gemini_2.5_Flash-high"})
	if err != nil {
		t.Fatal(err)
	}
	preset, _ := modelpreset.Find(item.ProviderModelKey)
	config, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if err != nil || config.Text.ContextWindowTokens != preset.Context || config.Text.MaxOutputTokens != preset.Output || item.Icon != "Gemini" || item.DisplayName != "Gemini" {
		t.Fatal("metadata was not persisted correctly")
	}
	if item.Protocol != source.Protocol || !item.PriceConfigured || len(item.PriceTiers) != 1 {
		t.Fatal("protocol and price were not inherited")
	}
	tier := item.PriceTiers[0]
	if tier.InputTokenPriceMicrocredits != 123 || tier.OutputTokenPriceMicrocredits != 456 || tier.ProviderModelKey != item.ProviderModelKey || tier.ChannelModelID != item.ID {
		t.Fatalf("new tier still points at the source or has incorrect prices: %+v", tier)
	}
	explicit := DefaultModelCapabilityConfig("chat-completion")
	explicit.Text.ContextWindowTokens, explicit.Text.MaxOutputTokens = 64000, 4096
	manual, err := svc.SaveAdminChannelModel(admin, channel.ID, "", ChannelModelRequest{ModelKey: "manual-alias", ProviderModelKey: "gemini-2.5-flash", Capability: "text", Protocol: "chat-completion", Icon: "Qwen", CapabilityConfig: explicit, BillingMode: "fixed_request", UnitPriceMicrocredits: 19, PriceConfigured: true})
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := DecodeModelCapabilityConfig(manual.CapabilityConfigJSON)
	if cfg.Text.ContextWindowTokens != 64000 || cfg.Text.MaxOutputTokens != 4096 || manual.Icon != "Qwen" || manual.UnitPriceMicrocredits != 19 {
		t.Fatal("explicit settings were overwritten")
	}
}

func TestImportChannelModelsPersistsReusedTierAndPreservesExistingModel(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"models/Gemini_2.5_Flash-high"}]}`))
	}))
	defer upstream.Close()
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "import-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, Name: "Test", BaseURL: upstream.URL + "/v1", APIKey: "synthetic-test-key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	source := model.ChannelModel{ID: "source", ChannelID: channel.ID, ModelKey: "gemini-2.5-flash", ProviderModelKey: "gemini-2.5-flash", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, PriceConfigured: true, Enabled: true, BillingMode: "token", PriceVersion: 1}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	tier := model.ChannelModelPriceTier{ID: "old-tier", ChannelModelID: source.ID, SelectorKey: `{}`, SelectorJSON: `{}`, Resolution: "*", ProviderModelKey: source.ModelKey, BillingMode: "token", InputTokenPriceMicrocredits: 123, OutputTokenPriceMicrocredits: 456, PriceConfigured: true, Enabled: true, PriceVersion: 1}
	if err := db.Create(&tier).Error; err != nil {
		t.Fatal(err)
	}
	result, err := svc.ImportAdminChannelModels(context.Background(), admin, channel.ID, []string{"Gemini_2.5_Flash-high"})
	if err != nil || result.Added != 1 {
		t.Fatalf("import failed: %v", err)
	}
	imported, err := svc.repo.ChannelModelByKeyIncludingDisabled(channel.ID, "Gemini_2.5_Flash-high")
	if err != nil {
		t.Fatal(err)
	}
	imported, err = svc.repo.ChannelModelByID(channel.ID, imported.ID)
	if err != nil {
		t.Fatal(err)
	}
	if imported.Enabled || !imported.PriceConfigured || imported.Icon != "Gemini" || imported.DisplayName != "Gemini" || len(imported.PriceTiers) != 1 {
		t.Fatal("imported metadata/price tier missing or unexpectedly enabled")
	}
	got := imported.PriceTiers[0]
	if got.ID == tier.ID || got.ChannelModelID != imported.ID || got.ProviderModelKey != imported.ProviderModelKey || got.OutputTokenPriceMicrocredits != 456 {
		t.Fatal("imported tier retained source identity or lost price")
	}
	var metadata map[string]any
	if json.Unmarshal([]byte(imported.CapabilityConfigJSON), &metadata) != nil || metadata["text"] == nil {
		t.Fatal("missing persisted text capability")
	}
	result, err = svc.ImportAdminChannelModels(context.Background(), admin, channel.ID, []string{"Gemini_2.5_Flash-high"})
	if err != nil || result.Added != 0 {
		t.Fatal("duplicate import should preserve existing model")
	}
	original, err := svc.repo.ChannelModelByID(channel.ID, source.ID)
	if err != nil || original.PriceTiers[0].ProviderModelKey != source.ModelKey || original.PriceTiers[0].ID != tier.ID {
		t.Fatal("source model or tier changed")
	}
}

func TestNewChannelModelIdentityIndependentOfExplicitCapabilities(t *testing.T) {
	svc, _ := newChannelModelTestService(t)
	channel := &model.ModelChannel{APIFormat: "openai"}
	profile := DefaultModelCapabilityConfig("gemini-image")
	req := ChannelModelRequest{ModelKey: "models/Gemini_9_Image-preview", Capability: "image", Protocol: "gemini-image", CapabilityConfig: profile}
	got := svc.autoConfigureNewChannelModel(channel, req, nil)
	if got.DisplayName != "Gemini" || got.Icon != "Gemini" || got.CapabilityConfig != profile {
		t.Fatal("identity must not depend on text catalog or replace explicit capabilities")
	}
	req.DisplayName, req.Icon = "商品图", "Qwen"
	got = svc.autoConfigureNewChannelModel(channel, req, nil)
	if got.DisplayName != req.DisplayName || got.Icon != req.Icon {
		t.Fatal("manual identity was overwritten")
	}
}

func TestImportedChannelModelAndTiersRollbackTogether(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	occupied := model.ChannelModelPriceTier{ID: "occupied-tier", ChannelModelID: "existing", SelectorKey: `{}`, SelectorJSON: `{}`, Resolution: "*"}
	if err := db.Create(&occupied).Error; err != nil {
		t.Fatal(err)
	}
	added, err := svc.repo.CreateMissingChannelModels([]model.ChannelModel{
		{ID: "first-import", ChannelID: "channel", ModelKey: "first"},
		{ID: "second-import", ChannelID: "channel", ModelKey: "second", PriceTiers: []model.ChannelModelPriceTier{{ID: occupied.ID, SelectorKey: `{}`, SelectorJSON: `{}`, Resolution: "*"}}},
	})
	if err == nil || added != 0 {
		t.Fatal("tier failure must reject the complete import")
	}
	var count int64
	if err := db.Model(&model.ChannelModel{}).Where("channel_id = ?", "channel").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("failed transaction left partially imported models")
	}
}
