package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/domainmcp/packs/commerce"
	"infinite-canvas/backend/internal/model"
)

func boolPointer(value bool) *bool { return &value }

func domainMCPTestService(t *testing.T) (*Service, *model.User) {
	t.Helper()
	service, _, _, _ := creationTestService(t)
	return service, &model.User{ID: "admin-domain-mcp", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
}

func TestDomainMCPSettingsEncryptCredentialsAndKeepSecretOnBlankUpdate(t *testing.T) {
	svc, admin := domainMCPTestService(t)
	created, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{
		PackID: commerce.PackIDProductInsight,
		APIKey: "secret-value",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !created.CredentialConfigured || created.APIKey != "" {
		t.Fatalf("public installation leaked or lost credential state: %+v", created)
	}
	stored, err := svc.repo.SystemSetting(domainMCPMarketplaceSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.ValueJSON, "secret-value") || !strings.Contains(stored.ValueJSON, encryptedSettingPrefix) {
		t.Fatalf("credential was not encrypted at rest: %s", stored.ValueJSON)
	}
	before, err := decodeDomainMCPMarketplaceSetting(stored.ValueJSON)
	if err != nil {
		t.Fatal(err)
	}
	oldCipher := before.Installations[0].CredentialCipher
	updated, err := svc.UpdateDomainMCPInstallation(admin, created.ID, UpdateDomainMCPRequest{Name: "新的名称", APIKey: ""})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "新的名称" || !updated.CredentialConfigured || updated.APIKey != "" {
		t.Fatalf("blank update did not preserve the secret: %+v", updated)
	}
	stored, err = svc.repo.SystemSetting(domainMCPMarketplaceSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	after, err := decodeDomainMCPMarketplaceSetting(stored.ValueJSON)
	if err != nil {
		t.Fatal(err)
	}
	if after.Installations[0].CredentialCipher != oldCipher {
		t.Fatal("blank API key update re-encrypted or cleared the existing secret")
	}
	cleared, err := svc.UpdateDomainMCPInstallation(admin, created.ID, UpdateDomainMCPRequest{Enabled: boolPointer(false), ClearCredential: true})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.CredentialConfigured || cleared.Enabled {
		t.Fatalf("explicit secret clear did not persist: %+v", cleared)
	}
	stored, _ = svc.repo.SystemSetting(domainMCPMarketplaceSettingKey)
	after, _ = decodeDomainMCPMarketplaceSetting(stored.ValueJSON)
	if after.Installations[0].CredentialCipher != "" {
		t.Fatal("explicit secret clear kept ciphertext")
	}
}

func TestDomainMCPSettingsRequireAdminAndNeverReturnCiphertext(t *testing.T) {
	svc, admin := domainMCPTestService(t)
	if _, err := svc.InstallDomainMCPPack(&model.User{ID: "user", Role: model.UserRoleUser}, InstallDomainMCPRequest{PackID: commerce.PackIDProductInsight, APIKey: "nope"}); err == nil {
		t.Fatal("non-admin installed a Domain MCP pack")
	}
	created, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{PackID: commerce.PackIDProductInsight, APIKey: "secret-value"})
	if err != nil {
		t.Fatal(err)
	}
	items, err := svc.AdminDomainMCPInstallations(admin)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != created.ID || items[0].APIKey != "" || !items[0].CredentialConfigured {
		t.Fatalf("admin response exposed secret material: %+v", items)
	}
	catalog, err := svc.AdminDomainMCPCatalog(admin)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, pack := range catalog {
		if pack.ID == commerce.PackIDProductInsight {
			found = pack.Installed && pack.InstallationID == created.ID
		}
	}
	if !found {
		t.Fatalf("catalog did not join installation state: %+v", catalog)
	}
}

func TestDomainMCPSettingsRejectUnavailablePacksAndUnsafeDisabledEndpoints(t *testing.T) {
	svc, admin := domainMCPTestService(t)
	if _, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{PackID: "brand.review", Enabled: boolPointer(false)}); err == nil {
		t.Fatal("unimplemented pack was installed")
	}
	if _, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{
		PackID: commerce.PackIDProductInsight, Enabled: boolPointer(false), Endpoint: "http://127.0.0.1/private",
	}); err == nil {
		t.Fatal("disabled installation persisted an unsafe endpoint")
	}
}

func TestDomainMCPRuntimeKeepsWorkingSnapshotWhenUpdateIsInvalid(t *testing.T) {
	svc, admin := domainMCPTestService(t)
	created, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{PackID: commerce.PackIDProductInsight, APIKey: "secret-value"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := svc.domainMCPHubSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if tools := before.ListTools(); len(tools) != 1 || tools[0].Name != commerce.ToolProductAnalyze {
		t.Fatalf("unexpected initial Hub tools: %+v", tools)
	}
	if _, err := svc.UpdateDomainMCPInstallation(admin, created.ID, UpdateDomainMCPRequest{AllowedTools: []string{"commerce.not_implemented"}}); err == nil {
		t.Fatal("invalid allowlist update succeeded")
	}
	after, err := svc.domainMCPHubSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if tools := after.ListTools(); len(tools) != 1 || tools[0].Name != commerce.ToolProductAnalyze {
		t.Fatalf("invalid update replaced the working Hub: %+v", tools)
	}
	items, _ := svc.AdminDomainMCPInstallations(admin)
	if len(items) != 1 || len(items[0].AllowedTools) != 1 || items[0].AllowedTools[0] != commerce.ToolProductAnalyze {
		t.Fatalf("invalid update polluted persisted settings: %+v", items)
	}
	reloaded := &Service{repo: svc.repo, dataDir: svc.dataDir}
	reloadedHub, err := reloaded.domainMCPHubSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if tools := reloadedHub.ListTools(); len(tools) != 1 || tools[0].Name != commerce.ToolProductAnalyze {
		t.Fatalf("persisted installation did not rebuild after restart: %+v", tools)
	}
}

func TestDomainMCPConnectionTestUsesEncryptedCredentialAndDiscoversRequiredTools(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if r.Header.Get("Authorization") != "Bearer connection-secret" {
			t.Errorf("unexpected Authorization header")
		}
		var request struct {
			ID     any    `json:"id"`
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch request.Method {
		case "server/discover":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"resultType": "complete", "protocolVersions": []string{"2026-07-28"}}})
		case "tools/list":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"resultType": "complete", "tools": []any{
				map[string]any{"name": "search", "inputSchema": map[string]any{"type": "object"}},
				map[string]any{"name": "extract", "inputSchema": map[string]any{"type": "object"}},
			}}})
		default:
			t.Errorf("unexpected method %q", request.Method)
		}
	}))
	defer server.Close()

	svc, admin := domainMCPTestService(t)
	created, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{
		PackID: commerce.PackIDProductInsight, APIKey: "connection-secret", Endpoint: server.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.TestDomainMCPConnection(admin, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK || len(result.Tools) != 2 || result.Tools[0] != "extract" || result.Tools[1] != "search" {
		t.Fatalf("unexpected connection test result: %+v", result)
	}
}

func TestDomainMCPDeletePersistsAuditAndRemovesRuntimeTools(t *testing.T) {
	svc, admin := domainMCPTestService(t)
	created, err := svc.InstallDomainMCPPack(admin, InstallDomainMCPRequest{PackID: commerce.PackIDProductInsight, APIKey: "secret-value"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteDomainMCPInstallation(admin, created.ID); err != nil {
		t.Fatal(err)
	}
	items, err := svc.AdminDomainMCPInstallations(admin)
	if err != nil || len(items) != 0 {
		t.Fatalf("installation was not deleted: %+v %v", items, err)
	}
	hub, err := svc.domainMCPHubSnapshot()
	if err != nil || len(hub.ListTools()) != 0 {
		t.Fatalf("runtime retained deleted tools: %+v %v", hub.ListTools(), err)
	}
	events, count, err := svc.repo.AdminAuditEvents("domain_mcp_installation", created.ID, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	foundDelete := false
	for _, event := range events {
		foundDelete = foundDelete || event.Action == "domain_mcp.delete"
	}
	if count < 2 || !foundDelete {
		t.Fatalf("delete audit missing: count=%d events=%+v", count, events)
	}
}
