package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestChannelFromRequestStoresConnectionWithoutDefaultProtocol(t *testing.T) {
	channel, err := channelFromRequest(ChannelRequest{
		Name:             "混合模型渠道",
		BaseURL:          "https://8.8.8.8/v1",
		APIKey:           "access-key",
		SecretKey:        "secret-key",
		ConcurrencyLimit: intPtr(6),
		Models:           []string{"seedance-2.0"},
	}, model.ModelChannel{})
	if err != nil {
		t.Fatalf("channelFromRequest() error = %v", err)
	}
	if channel.APIFormat != "openai" {
		t.Fatalf("APIFormat = %q, want openai", channel.APIFormat)
	}
	if channel.ConcurrencyLimit != 6 {
		t.Fatalf("ConcurrencyLimit = %d, want 6", channel.ConcurrencyLimit)
	}
	if channel.APIKey != "access-key" || channel.SecretKey != "secret-key" {
		t.Fatal("channel credentials were not stored")
	}
}

func TestMergeChannelRequestSupportsEnabledOnlyPatch(t *testing.T) {
	enabled := false
	req := mergeChannelRequest(ChannelRequest{Enabled: &enabled}, model.ModelChannel{
		Name:        "Video",
		BaseURL:     "https://example.com/v1",
		APIFormat:   "openai",
		ModelsJSON:  `["custom-video"]`,
		HeadersJSON: `[{"name":"User-Agent","value":"Stored Agent"}]`,
	})
	if req.Name != "Video" || req.BaseURL != "https://example.com/v1" || len(req.Models) != 1 || len(req.Headers) != 1 {
		t.Fatalf("mergeChannelRequest() = %#v", req)
	}
}

func TestUpdateSystemChannelEnabledOnlySkipsOutboundResolution(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Dead", BaseURL: "https://dead.invalid/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	disabled := false
	updated, err := svc.UpdateSystemChannel(admin, channel.ID, ChannelRequest{Enabled: &disabled})
	if err != nil {
		t.Fatalf("UpdateSystemChannel() should not resolve the stored URL for an enabled-only patch: %v", err)
	}
	if updated.Enabled {
		t.Fatal("UpdateSystemChannel() did not persist disabled state")
	}
	var stored model.ModelChannel
	if err := db.First(&stored, "id = ?", channel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Enabled {
		t.Fatal("stored channel is still enabled after update")
	}
}

func TestDuplicateSystemChannelCopiesSecretsModelsAndPriceTiers(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	source := model.ModelChannel{
		ID:               "channel-source",
		UserID:           admin.ID,
		Scope:            model.ChannelScopeSystem,
		Enabled:          false,
		Name:             "方舟视频",
		PublicAlias:      "视频主链路",
		BaseURL:          "https://example.com/v1",
		APIKey:           "source-key",
		SecretKey:        "source-secret",
		APIFormat:        "openai",
		ConcurrencyLimit: 6,
		ModelsJSON:       `["seedance-2"]`,
		HeadersJSON:      `[{"name":"X-Tenant","value":"tenant-a"}]`,
	}
	if err := svc.encryptSystemChannelSecrets(&source); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	sourceModel := model.ChannelModel{
		ID:                    "model-source",
		ChannelID:             source.ID,
		ModelKey:              "seedance-2",
		ProviderModelKey:      "seedance-2",
		DisplayName:           "Seedance 2",
		SortOrder:             3,
		Capability:            "video",
		Protocol:              model.ChannelInterfaceVolcengineArkVideo,
		BillingMode:           "fixed_request",
		UnitPriceMicrocredits: 120,
		PriceConfigured:       true,
		Enabled:               true,
		PriceVersion:          4,
	}
	if err := db.Create(&sourceModel).Error; err != nil {
		t.Fatal(err)
	}
	sourceTier := model.ChannelModelPriceTier{
		ID:                    "tier-source",
		ChannelModelID:        sourceModel.ID,
		SelectorKey:           `{}`,
		SelectorJSON:          `{}`,
		Resolution:            "720p",
		ProviderModelKey:      "seedance-2",
		BillingMode:           "fixed_request",
		UnitPriceMicrocredits: 120,
		PriceConfigured:       true,
		Enabled:               true,
	}
	if err := db.Create(&sourceTier).Error; err != nil {
		t.Fatal(err)
	}

	copied, err := svc.DuplicateSystemChannel(admin, source.ID)
	if err != nil {
		t.Fatalf("DuplicateSystemChannel() error = %v", err)
	}
	if copied.Name != "方舟视频 - 副本" || copied.Enabled != source.Enabled {
		t.Fatalf("copied channel summary = %#v", copied)
	}
	var stored model.ModelChannel
	if err := db.First(&stored, "id = ?", copied.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.decryptSystemChannelSecrets(&stored); err != nil {
		t.Fatal(err)
	}
	if stored.APIKey != "source-key" || stored.SecretKey != "source-secret" || stored.HeadersJSON != source.HeadersJSON {
		t.Fatalf("copied channel connection = %#v", stored)
	}

	models, err := svc.repo.ChannelModels(copied.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID == sourceModel.ID || models[0].ModelKey != sourceModel.ModelKey || models[0].SortOrder != sourceModel.SortOrder {
		t.Fatalf("copied models = %#v", models)
	}
	if len(models[0].PriceTiers) != 1 || models[0].PriceTiers[0].ID == sourceTier.ID || models[0].PriceTiers[0].UnitPriceMicrocredits != sourceTier.UnitPriceMicrocredits {
		t.Fatalf("copied price tiers = %#v", models[0].PriceTiers)
	}
}

func TestChannelFromRequestStoresAndClearsHeaders(t *testing.T) {
	// URL validation is real, but this non-network test must not depend on DNS.
	request := ChannelRequest{Name: "Headers", BaseURL: "https://93.184.216.34/v1", Headers: []OutboundHeader{{Name: "User-Agent", Value: "Custom Agent"}}}
	channel, err := channelFromRequest(request, model.ModelChannel{})
	if err != nil {
		t.Fatal(err)
	}
	if channel.HeadersJSON != `[{"name":"User-Agent","value":"Custom Agent"}]` {
		t.Fatalf("HeadersJSON = %q", channel.HeadersJSON)
	}

	request.Headers = []OutboundHeader{}
	channel, err = channelFromRequest(request, channel)
	if err != nil {
		t.Fatal(err)
	}
	if channel.HeadersJSON != `[]` {
		t.Fatalf("cleared HeadersJSON = %q", channel.HeadersJSON)
	}
}

func TestChannelFromRequestValidatesProxyURL(t *testing.T) {
	limit := 4
	base := model.ModelChannel{}
	channel, err := channelFromRequest(ChannelRequest{Name: "Proxy", BaseURL: "https://93.184.216.34/v1", ProxyURL: stringPtr("socks5://user:secret@127.0.0.1:1080"), ConcurrencyLimit: &limit}, base)
	if err != nil {
		t.Fatal(err)
	}
	if channel.ProxyURL != "socks5://user:secret@127.0.0.1:1080" {
		t.Fatalf("proxy URL = %q", channel.ProxyURL)
	}
	for _, proxyURL := range []string{"ftp://127.0.0.1:1080", "socks5://", "socks5://127.0.0.1:1080#fragment", "http://" + strings.Repeat("a", 506)} {
		_, err := channelFromRequest(ChannelRequest{Name: "Proxy", BaseURL: "https://93.184.216.34/v1", ProxyURL: stringPtr(proxyURL), ConcurrencyLimit: &limit}, base)
		if err == nil {
			t.Fatalf("invalid proxy URL %q was accepted", proxyURL)
		}
	}
}

// 复现线上问题：管理端编辑渠道时把「代理地址」删掉（前端提交 proxyUrl:""）必须真的清空；
// 未提交该字段（nil）才保持渠道现有值。此前 ProxyURL 是 string 类型，
// mergeChannelRequest 无法区分「空串」与「没传」，一律回填旧值 → 永远清不掉。
func TestMergeChannelRequestProxyURLPointerSemantics(t *testing.T) {
	stored := model.ModelChannel{
		Name:       "Proxy",
		BaseURL:    "https://93.184.216.34/v1",
		APIFormat:  "openai",
		ModelsJSON: `[]`,
		ProxyURL:   "http://127.0.0.1:10080",
	}

	cleared := mergeChannelRequest(ChannelRequest{ProxyURL: stringPtr("")}, stored)
	if cleared.ProxyURL == nil || *cleared.ProxyURL != "" {
		t.Fatalf("cleared proxy URL = %v, want pointer to empty string", cleared.ProxyURL)
	}

	disabled := false
	kept := mergeChannelRequest(ChannelRequest{Enabled: &disabled}, stored)
	if kept.ProxyURL == nil || *kept.ProxyURL != stored.ProxyURL {
		t.Fatalf("omitted proxy URL = %v, want %q kept", kept.ProxyURL, stored.ProxyURL)
	}
}

func TestChannelFromRequestClearsProxyURL(t *testing.T) {
	limit := 4
	base := model.ModelChannel{ProxyURL: "http://127.0.0.1:10080"}
	request := ChannelRequest{Name: "Proxy", BaseURL: "https://93.184.216.34/v1", ConcurrencyLimit: &limit}

	clearedReq := request
	clearedReq.ProxyURL = stringPtr("")
	cleared, err := channelFromRequest(clearedReq, base)
	if err != nil {
		t.Fatalf("channelFromRequest() clear proxy error: %v", err)
	}
	if cleared.ProxyURL != "" {
		t.Fatalf("cleared proxy URL = %q, want empty", cleared.ProxyURL)
	}

	// 未提交该字段时不应保留传入 base 上的旧值以外的东西：包级入口下 base 值会被
	// 显式赋空，实际链路依赖 mergeChannelRequest 先回填（见上一个用例）。
	omitted, err := channelFromRequest(request, model.ModelChannel{})
	if err != nil {
		t.Fatalf("channelFromRequest() omitted proxy error: %v", err)
	}
	if omitted.ProxyURL != "" {
		t.Fatalf("omitted proxy URL = %q, want empty", omitted.ProxyURL)
	}
}

func TestPublicChannelOnlyReturnsSystemHeadersAndProxyToAdmin(t *testing.T) {
	channel := model.ModelChannel{ID: "system-1", Scope: model.ChannelScopeSystem, BaseURL: "https://example.com/v1", HeadersJSON: `[{"name":"X-Gateway-Tenant","value":"tenant-a"}]`, ProxyURL: "socks5://user:secret@127.0.0.1:1080"}
	adminView := publicChannel(channel, true, nil)
	if len(adminView.Headers) != 1 || adminView.Headers[0].Name != "X-Gateway-Tenant" {
		t.Fatalf("admin headers = %#v", adminView.Headers)
	}
	if adminView.ProxyURL != channel.ProxyURL {
		t.Fatalf("admin proxy URL = %q", adminView.ProxyURL)
	}
	userView := publicChannel(channel, false, nil)
	if len(userView.Headers) != 0 {
		t.Fatalf("user headers = %#v", userView.Headers)
	}
	if userView.ProxyURL != "" {
		t.Fatalf("user proxy URL = %q", userView.ProxyURL)
	}
}

func TestChannelFromRequestRejectsInvalidConcurrencyLimit(t *testing.T) {
	for _, limit := range []int{0, 1000} {
		_, err := channelFromRequest(ChannelRequest{Name: "Bad", BaseURL: "https://example.com/v1", ConcurrencyLimit: &limit}, model.ModelChannel{})
		if err == nil {
			t.Fatalf("channelFromRequest() concurrencyLimit = %d, error = nil", limit)
		}
	}
}

func TestRuntimeConcurrencyUsesEnvironmentFallback(t *testing.T) {
	t.Setenv("CANVAS_CHANNEL_CONCURRENCY", "7")
	t.Setenv("CANVAS_WORKER_CONCURRENCY", "9")
	setting := defaultRuntimePolicy().Task
	if setting.ChannelConcurrency != 7 || setting.WorkerConcurrency != 9 {
		t.Fatalf("runtimeConcurrencyFromEnvironment() = %#v", setting)
	}

	useGlobal := true
	channel, err := channelFromRequest(ChannelRequest{Name: "Global", BaseURL: "https://93.184.216.34/v1", UseGlobalConcurrency: &useGlobal}, model.ModelChannel{ConcurrencyLimit: 4})
	if err != nil || channel.ConcurrencyLimit != 0 {
		t.Fatalf("global concurrency channel = %#v, error = %v", channel, err)
	}
}

func TestFetchAdminChannelModelsReaddsDeletedModel(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer upstream.Close()

	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: upstream.URL + "/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	deleted := model.ChannelModel{ID: "deleted-model", ChannelID: channel.ID, ModelKey: "model-a", DisplayName: "model-a", BillingMode: "fixed_request", PriceVersion: 1}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatal(err)
	}

	result, err := svc.FetchAdminChannelModels(context.Background(), admin, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 1 {
		t.Fatalf("Added = %d, want 1", result.Added)
	}
	var active model.ChannelModel
	if err := db.First(&active, "channel_id = ? AND model_key = ?", channel.ID, "model-a").Error; err != nil {
		t.Fatal(err)
	}
	if active.ID == deleted.ID || active.Enabled || active.PriceConfigured {
		t.Fatalf("re-added model = %#v", active)
	}
	if active.DisplayName != "model-a" || active.ProviderModelKey != "model-a" {
		t.Fatalf("discovered model defaults = %#v", active)
	}
	var total int64
	if err := db.Unscoped().Model(&model.ChannelModel{}).Where("channel_id = ? AND model_key = ?", channel.ID, "model-a").Count(&total).Error; err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Fatalf("model history count = %d, want 2", total)
	}
}

func TestImportAdminChannelModelsOnlyImportsSelectedModels(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"},{"id":"model-b"}]}`))
	}))
	defer upstream.Close()

	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: upstream.URL + "/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}

	preview, err := svc.PreviewAdminChannelModels(context.Background(), admin, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview) != 2 {
		t.Fatalf("preview models = %#v, want two models", preview)
	}
	var before int64
	if err := db.Model(&model.ChannelModel{}).Where("channel_id = ?", channel.ID).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before != 0 {
		t.Fatalf("preview created %d channel models", before)
	}

	result, err := svc.ImportAdminChannelModels(context.Background(), admin, channel.ID, []string{"model-b"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 1 || len(result.Models) != 1 || result.Models[0] != "model-b" {
		t.Fatalf("import result = %#v, want only model-b", result)
	}
	var imported []model.ChannelModel
	if err := db.Where("channel_id = ?", channel.ID).Find(&imported).Error; err != nil {
		t.Fatal(err)
	}
	if len(imported) != 1 || imported[0].ModelKey != "model-b" {
		t.Fatalf("imported models = %#v, want only model-b", imported)
	}
	if imported[0].DisplayName != "model-b" || imported[0].ProviderModelKey != "model-b" {
		t.Fatalf("imported defaults = %#v", imported)
	}
	// 已有分组即使与模型 ID 相同，也不能被重复导入重置。
	if err := db.Model(&imported[0]).Updates(map[string]any{"display_name": "model-b", "channel_label": "手动名称"}).Error; err != nil {
		t.Fatal(err)
	}
	result, err = svc.ImportAdminChannelModels(context.Background(), admin, channel.ID, []string{"model-b"})
	if err != nil || result.Added != 0 {
		t.Fatalf("duplicate import = %#v, %v", result, err)
	}
	var unchanged model.ChannelModel
	if err := db.First(&unchanged, "id = ?", imported[0].ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.DisplayName != "model-b" || unchanged.ChannelLabel != "手动名称" {
		t.Fatalf("duplicate import overwrote existing names: %#v", unchanged)
	}
}

func TestImportAdminChannelModelsRejectsUnknownSelection(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer upstream.Close()

	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: upstream.URL + "/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}

	_, err := svc.ImportAdminChannelModels(context.Background(), admin, channel.ID, []string{"not-in-catalog"})
	var authErr *AuthError
	if !errors.As(err, &authErr) || authErr.Message != "所选模型不在上游模型目录中：not-in-catalog" {
		t.Fatalf("ImportAdminChannelModels() error = %#v", err)
	}
	var count int64
	if err := db.Model(&model.ChannelModel{}).Where("channel_id = ?", channel.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("unknown selection created %d channel models", count)
	}
}

func TestSaveAdminChannelModelRejectsActiveDuplicateKey(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.com/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `[]`}
	items := []model.ChannelModel{
		{ID: "model-a", ChannelID: channel.ID, ModelKey: "model-a", DisplayName: "Model A", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "fixed_request", Enabled: true, PriceVersion: 1},
		{ID: "model-b", ChannelID: channel.ID, ModelKey: "model-b", DisplayName: "Model B", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "fixed_request", Enabled: true, PriceVersion: 1},
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	enabled := true
	_, err := svc.SaveAdminChannelModel(admin, channel.ID, items[0].ID, ChannelModelRequest{ModelKey: "model-b", DisplayName: "Duplicate", Capability: "text", Protocol: string(model.ChannelInterfaceChatCompletion), BillingMode: "fixed_request", Enabled: &enabled})
	var authErr *AuthError
	if !errors.As(err, &authErr) || authErr.Status != http.StatusBadRequest || authErr.Message != "该渠道已存在模型 model-b，请直接编辑已有模型" || authErr.Details["field"] != "modelKey" {
		t.Fatalf("SaveAdminChannelModel() error = %#v", err)
	}
}

func TestCopyChannelModelKeepsIndependentPricingAndExistingTarget(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	ch := model.ModelChannel{ID: "copy-channel", UserID: admin.ID, Scope: model.ChannelScopeSystem, APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&ch).Error; err != nil {
		t.Fatal(err)
	}
	const key = "gpt-image-2.6"
	disabled, enabled := false, true
	placeholder := model.ChannelModel{ID: "imported", ChannelID: ch.ID, ModelKey: key, ProviderModelKey: key, Enabled: false, PriceVersion: 1}
	if err := db.Create(&placeholder).Error; err != nil {
		t.Fatal(err)
	}
	req := ChannelModelRequest{ModelKey: "image-source", ProviderModelKey: "vendor-image", Capability: "image", Protocol: string(model.ChannelInterfaceOpenAIImage), Enabled: &enabled,
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "vendor-image"),
		PriceTiers:       []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", UnitPriceMicrocredits: 17_000_000, PriceConfigured: true, Enabled: &enabled}, {Selector: map[string]string{"operation": "text_to_image"}, ProviderModelKey: "vendor-sku", BillingMode: "fixed_request", UnitPriceMicrocredits: 23_000_000, PriceConfigured: true, Enabled: &enabled}}}
	source, err := svc.SaveAdminChannelModel(admin, ch.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	req.ModelKey = " models/" + key + " "
	var conflict *AuthError
	if _, err = svc.SaveAdminChannelModel(admin, ch.ID, "", req); !errors.As(err, &conflict) || conflict.Details["field"] != "modelKey" {
		t.Fatalf("expected field conflict with disabled row, got %v", err)
	}
	req.ModelKey = source.ModelKey + "-copy"
	alias, err := svc.SaveAdminChannelModel(admin, ch.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	req.ModelKey, req.ProviderModelKey, req.Enabled = key, key, &disabled
	req.ExpectedUpdatedAt, req.ExpectedPriceVersion = placeholder.UpdatedAt, placeholder.PriceVersion
	req.PriceTiers[1].ProviderModelKey = ""
	req.PriceTiers[0].UnitPriceMicrocredits = 19_000_000
	if _, err = svc.SaveAdminChannelModel(admin, ch.ID, placeholder.ID, req); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.SaveAdminChannelModel(admin, ch.ID, placeholder.ID, req); err == nil {
		t.Fatal("a stale copy must not overwrite the target")
	}
	rows, err := svc.repo.ChannelModels(ch.ID, true)
	if err != nil || len(rows) != 3 {
		t.Fatalf("persisted rows = %d, error = %v", len(rows), err)
	}
	tierIDs := map[string]bool{}
	for _, row := range rows {
		wantUpstream, wantSKU, wantPrice, wantVersion := "vendor-image", "vendor-sku", int64(17_000_000), int64(1)
		if row.ID == placeholder.ID {
			wantUpstream, wantSKU, wantPrice, wantVersion = key, key, 19_000_000, 2
		} else if (row.ID != source.ID || row.ModelKey != "image-source") && (row.ID != alias.ID || row.ModelKey != "image-source-copy") {
			t.Fatal("wrong record identity")
		}
		if row.ProviderModelKey != wantUpstream || row.PriceVersion != wantVersion || row.Enabled != (row.ID != placeholder.ID) || len(row.PriceTiers) != 2 || row.Protocol != source.Protocol {
			t.Fatalf("incorrect saved configuration for %s", row.ModelKey)
		}
		for _, tier := range row.PriceTiers {
			route, price := wantUpstream, wantPrice
			if tier.Selector["operation"] == "text_to_image" {
				route, price = wantSKU, 23_000_000
			}
			if tier.ProviderModelKey != route || tier.UnitPriceMicrocredits != price || tier.ChannelModelID != row.ID || tier.ID == "" || tierIDs[tier.ID] {
				t.Fatalf("incorrect persisted price or shared tier for %s", row.ModelKey)
			}
			tierIDs[tier.ID] = true
		}
	}
}

func TestConfigurationOnlyUpdatesExistingTargetWithoutWritingIdentity(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "config", UserID: admin.ID, Scope: model.ChannelScopeSystem, APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	target := model.ChannelModel{ID: "target", ChannelID: channel.ID, ModelKey: "gpt-image-2.6", ProviderModelKey: "vendor-2.6", DisplayName: "目标分组", ChannelLabel: "目标名称", Description: "目标描述", Icon: "target", SortOrder: 42, Enabled: false, PriceVersion: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	protocol := string(model.ChannelInterfaceOpenAIImage)
	var req ChannelModelRequest
	if err := json.Unmarshal([]byte(`{"configurationOnly":true}`), &req); err != nil {
		t.Fatal(err)
	}
	req.ExpectedUpdatedAt, req.ExpectedPriceVersion = target.UpdatedAt, target.PriceVersion
	req.Capability, req.Protocol = "image", protocol
	req.CapabilityConfig = DefaultModelCapabilityConfigForModel(protocol, target.ProviderModelKey)
	req.PriceTiers = []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", PriceConfigured: true, UnitPriceMicrocredits: 17000000}}
	// Identity fields are not part of this operation, even if an old client includes them.
	yes := true
	req.ModelKey, req.ProviderModelKey, req.DisplayName, req.Enabled = "gpt-image-2.5", "vendor-2.5", "来源分组", &yes
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, "", req); err == nil {
		t.Fatal("configuration-only save must not create a model")
	}
	for _, missing := range []string{"protocol", "capabilityConfig", "priceTiers"} {
		incomplete := req
		switch missing {
		case "protocol":
			incomplete.Protocol = ""
		case "capabilityConfig":
			incomplete.CapabilityConfig = nil
		case "priceTiers":
			incomplete.PriceTiers = nil
		}
		if _, err := svc.SaveAdminChannelModel(admin, channel.ID, target.ID, incomplete); err == nil {
			t.Fatalf("accepted missing %s", missing)
		}
	}
	saved, err := svc.SaveAdminChannelModel(admin, channel.ID, target.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ModelKey != target.ModelKey || saved.ProviderModelKey != target.ProviderModelKey || saved.DisplayName != target.DisplayName || saved.ChannelLabel != target.ChannelLabel || saved.Description != target.Description || saved.Icon != target.Icon || saved.SortOrder != target.SortOrder || saved.Enabled != target.Enabled || saved.ID != target.ID {
		t.Fatal("target identity changed")
	}
	if saved.Protocol != model.ChannelInterfaceOpenAIImage || saved.Capability != "image" || len(saved.PriceTiers) != 1 || saved.PriceTiers[0].ProviderModelKey != target.ProviderModelKey || saved.PriceTiers[0].UnitPriceMicrocredits != 17000000 {
		t.Fatal("configuration was not saved to the target")
	}
	if _, err := svc.SaveAdminChannelModel(admin, channel.ID, target.ID, req); err == nil {
		t.Fatal("stale version must be rejected")
	}
}

func TestConfigurationOnlyKeepsTargetSKUsAndSourceReleasePolicy(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	const provider = "openai-image"
	adapter, ok := svc.protocolRegistry().Resolve(provider)
	if !ok {
		t.Fatal("fixture image protocol unavailable")
	}
	registry, err := protocol.NewRegistry(adapter)
	if err != nil {
		t.Fatal(err)
	}
	old, current := strings.Repeat("1", 64), strings.Repeat("2", 64)
	for i, digest := range []string{old, current} {
		if err := registry.RegisterRelease(provider, strconv.Itoa(i+1)+".0.0", digest, i == 1, true, []protocol.Adapter{adapter}, nil); err != nil {
			t.Fatal(err)
		}
	}
	svc.pluginRuntime = &pluginRuntime{registry: registry}
	channel := model.ModelChannel{ID: "import-test", UserID: admin.ID, Scope: model.ChannelScopeSystem, APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	req := ChannelModelRequest{ModelKey: "gpt-image-2.6", Protocol: provider, ProtocolRelease: old, Capability: "image", CapabilityConfig: &ModelCapabilityConfig{Version: 1, Image: DefaultImageCapabilityConfig(provider, "gpt-image-2.6")}}
	req.PriceTiers = []ChannelModelPriceTierRequest{{BillingMode: "fixed_request", ProviderModelKey: "target-default-sku", PriceConfigured: true, UnitPriceMicrocredits: 7}}
	target, err := svc.SaveAdminChannelModel(admin, channel.ID, "", req)
	if err != nil {
		t.Fatal(err)
	}
	req.ConfigurationOnly = true
	req.PriceTiers[0].ProviderModelKey = "source-default-sku"
	req.PriceTiers = append(req.PriceTiers, ChannelModelPriceTierRequest{BillingMode: "fixed_request", Selector: map[string]string{"operation": "image_to_image"}, ProviderModelKey: "source-edit-sku", PriceConfigured: true, UnitPriceMicrocredits: 29})
	for _, digest := range []string{old, "", current} {
		req.ExpectedUpdatedAt, req.ExpectedPriceVersion = target.UpdatedAt, target.PriceVersion
		req.ProtocolRelease = digest
		target, err = svc.SaveAdminChannelModel(admin, channel.ID, target.ID, req)
		if err != nil {
			t.Fatal(err)
		}
		if target.ProtocolRelease != digest {
			t.Fatalf("source release policy not preserved: got %q, want %q", target.ProtocolRelease, digest)
		}
		if len(target.PriceTiers) != 2 || target.PriceTiers[0].ProviderModelKey != "target-default-sku" || target.PriceTiers[1].ProviderModelKey != "gpt-image-2.6" {
			t.Fatal("target SKU matching or fallback incorrect")
		}
	}
}

func TestAdminCopySourceDoesNotInventMissingStoredImageConfig(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "incomplete-config", UserID: admin.ID, Scope: model.ChannelScopeSystem, APIFormat: "openai", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for i, raw := range []string{"", `{"version":1}`, `{"video":{}}`} {
		key := "missing-image-" + strconv.Itoa(i)
		row := model.ChannelModel{ID: key, ChannelID: channel.ID, ModelKey: key, ProviderModelKey: key, Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: raw, PriceVersion: 1}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := svc.AdminChannelModels(admin, channel.ID)
	if err != nil || len(rows) != 3 {
		t.Fatalf("unexpected list: %d, %v", len(rows), err)
	}
	for _, row := range rows {
		if row.CapabilityConfig["image"] != nil {
			t.Fatalf("invented source parameters for %s", row.ModelKey)
		}
	}
}

func TestDeleteAdminChannelModelsDeletesSelectionAtomically(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.com/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `["model-a","model-b","model-c"]`}
	items := []model.ChannelModel{
		{ID: "model-a", ChannelID: channel.ID, ModelKey: "model-a", DisplayName: "Model A", Enabled: true, PriceVersion: 1},
		{ID: "model-b", ChannelID: channel.ID, ModelKey: "model-b", DisplayName: "Model B", Enabled: true, PriceVersion: 1},
		{ID: "model-c", ChannelID: channel.ID, ModelKey: "model-c", DisplayName: "Model C", Enabled: true, PriceVersion: 1},
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}

	deleted, err := svc.DeleteAdminChannelModels(admin, channel.ID, []string{" model-a ", "model-b", "model-a"})
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}
	var storedChannel model.ModelChannel
	if err := db.First(&storedChannel, "id = ?", channel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedChannel.ModelsJSON != `["model-c"]` {
		t.Fatalf("ModelsJSON = %s, want model-c only", storedChannel.ModelsJSON)
	}
	var active []model.ChannelModel
	if err := db.Where("channel_id = ?", channel.ID).Find(&active).Error; err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 || active[0].ID != "model-c" {
		t.Fatalf("active models = %#v, want model-c", active)
	}
	var removed []model.ChannelModel
	if err := db.Unscoped().Where("channel_id = ? AND id IN ?", channel.ID, []string{"model-a", "model-b"}).Find(&removed).Error; err != nil {
		t.Fatal(err)
	}
	if len(removed) != 2 {
		t.Fatalf("removed models = %#v, want two", removed)
	}
	for _, item := range removed {
		if item.Enabled || item.PriceVersion != 2 || !item.DeletedAt.Valid {
			t.Fatalf("removed model state = %#v", item)
		}
	}
}

func TestDeleteAdminChannelModelsRejectsWholeSelectionWhenOneModelIsInUse(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "channel-1", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "Test", BaseURL: "https://example.com/v1", APIKey: "key", APIFormat: "openai", ModelsJSON: `["model-a","model-b"]`}
	items := []model.ChannelModel{
		{ID: "model-a", ChannelID: channel.ID, ModelKey: "model-a", DisplayName: "Model A", Enabled: true, PriceVersion: 1},
		{ID: "model-b", ChannelID: channel.ID, ModelKey: "model-b", DisplayName: "Model B", Enabled: true, PriceVersion: 1},
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "task-running", ChannelModelID: "model-b", Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}

	deleted, err := svc.DeleteAdminChannelModels(admin, channel.ID, []string{"model-a", "model-b"})
	var authErr *AuthError
	if !errors.As(err, &authErr) || authErr.Message != "所选渠道模型中有模型仍被前台模型供应线路或进行中任务使用，本次未删除任何模型" {
		t.Fatalf("DeleteAdminChannelModels() deleted = %d, error = %#v", deleted, err)
	}
	var active int64
	if err := db.Model(&model.ChannelModel{}).Where("channel_id = ?", channel.ID).Count(&active).Error; err != nil {
		t.Fatal(err)
	}
	if active != 2 {
		t.Fatalf("active models = %d, want 2 after atomic rejection", active)
	}
	var storedChannel model.ModelChannel
	if err := db.First(&storedChannel, "id = ?", channel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedChannel.ModelsJSON != channel.ModelsJSON {
		t.Fatalf("ModelsJSON changed after rejected batch: %s", storedChannel.ModelsJSON)
	}
}

func TestNormalizeAdminChannelModelDeleteIDsRequiresBoundedSelection(t *testing.T) {
	if _, err := normalizeAdminChannelModelDeleteIDs([]string{"", " "}); err == nil {
		t.Fatal("empty selection should be rejected")
	}
	values := make([]string, 101)
	for index := range values {
		values[index] = "model-" + strconv.Itoa(index)
	}
	if _, err := normalizeAdminChannelModelDeleteIDs(values); err == nil {
		t.Fatal("selection above 100 models should be rejected")
	}
}

func TestResolveProviderConfigMapsSKUToProviderModel(t *testing.T) {
	outboundtest.PublicDNS(t, "ark.cn-beijing.volces.com")
	svc, db := newChannelModelTestService(t)
	svc.dataDir = t.TempDir()
	channel := model.ModelChannel{
		ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Seedance",
		BaseURL: "https://ark.cn-beijing.volces.com/api/v3", APIKey: "test-key", APIFormat: "openai", ModelsJSON: `["seedance-2-5-480p"]`,
	}
	if err := svc.encryptSystemChannelSecrets(&channel); err != nil {
		t.Fatal(err)
	}
	item := model.ChannelModel{
		ID: "model-1", ChannelID: channel.ID, ModelKey: "seedance-2-5-480p", ProviderModelKey: "doubao-seedance-2-5",
		Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, Enabled: true,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID}, nil); err == nil {
		t.Fatal("selected a model without an explicit SKU")
	}
	config, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: item.ModelKey}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if config.ChannelModelKey != item.ModelKey || config.Model != item.ProviderModelKey {
		t.Fatalf("resolved config = %#v", config)
	}
}

func TestValidateTaskCapabilityFixesSingleResolutionSKU(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	video := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "doubao-seedance-2-5").Video
	video.References.MaxVideos = 0
	video.Resolutions = []string{"480p"}
	video.DefaultResolution = "480p"
	encoded, err := json.Marshal(&ModelCapabilityConfig{Version: 1, Video: video})
	if err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: "model-480p", ChannelID: "channel-1", ModelKey: "doubao-seedance-2-5-480p", ProviderModelKey: "doubao-seedance-2-5",
		Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, Enabled: true, CapabilityConfigJSON: string(encoded),
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	input := map[string]any{
		"mode": "video",
		"config": map[string]any{
			"channelId": "channel-1", "model": channelModel.ModelKey, "vquality": "auto", "videoSeconds": "6", "size": "16:9",
			"videoGenerateAudio": "true", "videoWatermark": "false",
		},
	}
	if err := svc.ValidateTaskCapability(input); err != nil {
		t.Fatal(err)
	}
	config := input["config"].(map[string]any)
	if got := config["vquality"]; got != "480p" {
		t.Fatalf("vquality = %#v, want 480p", got)
	}
}

func newChannelModelTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.LogicalModel{}, &model.LogicalModelRevision{}, &model.LogicalModelRoute{}, &model.Task{}, &model.IDSequence{}, &model.User{}, &model.UserGroup{}, &model.UserGroupChannel{}, &model.SystemSetting{}, &model.ChannelWebsite{}, &model.ChannelCatalogSnapshot{}, &model.ChannelProtocolSelection{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: channelTestDataDir(t)}, db
}

func intPtr(value int) *int { return &value }
