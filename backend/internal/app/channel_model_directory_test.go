package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestChannelModelDirectoryDefaultsAndCustomNames(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	channel := model.ModelChannel{ID: "directory-defaults", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.invalid/v1", APIKey: "synthetic", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	enabled := true
	request := ChannelModelRequest{
		ModelKey: "product", ProviderModelKey: "upstream", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "upstream"),
		PriceTiers:       []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, Enabled: &enabled}},
		Enabled:          &enabled,
	}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, "", request)
	if err != nil {
		t.Fatal(err)
	}
	if saved.DisplayName != request.ModelKey {
		t.Fatalf("default group = %q", saved.DisplayName)
	}
	public, err := svc.sanitizeChannelModel(saved)
	if err != nil || public.ChannelLabel != "upstream" {
		t.Fatalf("default second-level label = %q, %v", public.ChannelLabel, err)
	}
	// A pre-existing sentinel must resolve on read, without editing the stored record.
	if err := db.Model(saved).UpdateColumn("display_name", "未分类").Error; err != nil {
		t.Fatal(err)
	}
	items, err := svc.AdminChannelModels(admin, channel.ID)
	if err != nil || len(items) != 1 || items[0].DisplayName != request.ModelKey {
		t.Fatalf("legacy list group: %v %v", items, err)
	}
	stored, err := svc.repo.ChannelModelByID(channel.ID, saved.ID)
	if err != nil || stored.DisplayName != "未分类" {
		t.Fatal("reading rewrote legacy metadata")
	}
	public, err = svc.sanitizeChannelModel(stored)
	if err != nil || public.DisplayName != request.ModelKey {
		t.Fatalf("legacy public group = %q, %v", public.DisplayName, err)
	}
	request.DisplayName, request.ChannelLabel = "product", "自定义渠道"
	request.ExpectedUpdatedAt, request.ExpectedPriceVersion = saved.UpdatedAt, saved.PriceVersion
	saved, err = svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, request)
	if err != nil || saved.DisplayName != "product" || saved.ChannelLabel != "自定义渠道" {
		t.Fatalf("custom names = %#v, %v", saved, err)
	}
	// 默认名称无需写入较短的 channel_label 列，允许跟随超过 80 字的上游 ID。
	request.DisplayName = "未分类"
	request.ProviderModelKey = strings.Repeat("a", 100)
	request.ChannelLabel = request.ProviderModelKey
	request.ExpectedUpdatedAt, request.ExpectedPriceVersion = saved.UpdatedAt, saved.PriceVersion
	saved, err = svc.SaveAdminChannelModel(admin, channel.ID, saved.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	public, err = svc.sanitizeChannelModel(saved)
	if err != nil || public.ChannelLabel != request.ProviderModelKey || saved.ChannelLabel != "" {
		t.Fatalf("long default label = %q, %v", public.ChannelLabel, err)
	}
}
