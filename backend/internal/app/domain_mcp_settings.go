package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/model"
)

const (
	domainMCPMarketplaceSettingKey      = "domain_mcp_marketplace"
	domainMCPMarketplaceSchemaVersion   = 1
	domainMCPDefaultAnySearchEndpoint   = "https://api.anysearch.com/mcp"
	domainMCPConnectionTimeoutSeconds   = 20
	maxDomainMCPInstallations           = 32
	maxDomainMCPMarketplaceSettingBytes = 256 << 10
)

type domainMCPMarketplaceSetting struct {
	SchemaVersion int                            `json:"schemaVersion"`
	Installations []domainMCPInstallationSetting `json:"installations"`
}

type domainMCPInstallationSetting struct {
	ID               string    `json:"id"`
	PackID           string    `json:"packId"`
	Name             string    `json:"name"`
	Enabled          bool      `json:"enabled"`
	AllowedTools     []string  `json:"allowedTools"`
	Provider         string    `json:"provider"`
	Endpoint         string    `json:"endpoint"`
	CredentialCipher string    `json:"credentialCipher,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type AdminDomainMCPInstallation struct {
	ID                   string    `json:"id"`
	PackID               string    `json:"packId"`
	Name                 string    `json:"name"`
	Enabled              bool      `json:"enabled"`
	AllowedTools         []string  `json:"allowedTools"`
	Provider             string    `json:"provider"`
	Endpoint             string    `json:"endpoint"`
	CredentialConfigured bool      `json:"credentialConfigured"`
	APIKey               string    `json:"-"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type AdminDomainMCPPack struct {
	domainmcp.PackManifest
	Source         string `json:"source"`
	Executable     bool   `json:"executable"`
	Installed      bool   `json:"installed"`
	InstallationID string `json:"installationId,omitempty"`
	Enabled        bool   `json:"enabled"`
}

type InstallDomainMCPRequest struct {
	PackID       string   `json:"packId"`
	Name         string   `json:"name"`
	Enabled      *bool    `json:"enabled"`
	AllowedTools []string `json:"allowedTools"`
	Endpoint     string   `json:"endpoint"`
	APIKey       string   `json:"apiKey"`
}

type UpdateDomainMCPRequest struct {
	Name            string   `json:"name"`
	Enabled         *bool    `json:"enabled"`
	AllowedTools    []string `json:"allowedTools"`
	Endpoint        string   `json:"endpoint"`
	APIKey          string   `json:"apiKey"`
	ClearCredential bool     `json:"clearCredential"`
}

type DomainMCPConnectionTestResult struct {
	OK    bool     `json:"ok"`
	Tools []string `json:"tools"`
}

func (s *Service) AdminDomainMCPCatalog(actor *model.User) ([]AdminDomainMCPPack, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, setting, err := s.readDomainMCPMarketplaceSetting()
	if err != nil {
		return nil, err
	}
	catalog, err := domainmcp.NewCatalog(domainmcp.BuiltinPacks()...)
	if err != nil {
		return nil, err
	}
	installed := make(map[string]domainMCPInstallationSetting, len(setting.Installations))
	for _, item := range setting.Installations {
		installed[item.PackID] = item
	}
	result := make([]AdminDomainMCPPack, 0, len(catalog.Packs()))
	for _, pack := range catalog.Packs() {
		item := AdminDomainMCPPack{PackManifest: pack, Source: "builtin", Executable: len(domainMCPExecutableTools(pack.ID)) > 0}
		if current, ok := installed[pack.ID]; ok {
			item.Installed, item.InstallationID, item.Enabled = true, current.ID, current.Enabled
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) AdminDomainMCPInstallations(actor *model.User) ([]AdminDomainMCPInstallation, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, setting, err := s.readDomainMCPMarketplaceSetting()
	if err != nil {
		return nil, err
	}
	result := make([]AdminDomainMCPInstallation, 0, len(setting.Installations))
	for _, item := range setting.Installations {
		result = append(result, publicDomainMCPInstallation(item))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.Before(result[j].CreatedAt) })
	return result, nil
}

func (s *Service) InstallDomainMCPPack(actor *model.User, req InstallDomainMCPRequest) (AdminDomainMCPInstallation, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	s.domainMCPUpdateMu.Lock()
	defer s.domainMCPUpdateMu.Unlock()
	record, setting, err := s.readDomainMCPMarketplaceSetting()
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	if len(setting.Installations) >= maxDomainMCPInstallations {
		return AdminDomainMCPInstallation{}, BadAuthRequest("领域 MCP 安装数量已达上限")
	}
	catalog, err := domainmcp.NewCatalog(domainmcp.BuiltinPacks()...)
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	packID := strings.TrimSpace(req.PackID)
	pack, ok := catalog.Pack(packID)
	if !ok {
		return AdminDomainMCPInstallation{}, BadAuthRequest("领域能力包不存在")
	}
	if len(domainMCPExecutableTools(packID)) == 0 {
		return AdminDomainMCPInstallation{}, BadAuthRequest("该领域能力包尚未开放安装")
	}
	for _, current := range setting.Installations {
		if current.PackID == packID {
			return AdminDomainMCPInstallation{}, creationConflict("该领域能力包已经安装")
		}
	}
	allowedTools, err := normalizeDomainMCPAllowedTools(packID, req.AllowedTools, false)
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = pack.DisplayName
	}
	endpoint := strings.TrimSpace(req.Endpoint)
	if endpoint == "" {
		endpoint = domainMCPDefaultAnySearchEndpoint
	}
	credential, err := s.encryptSettingSecret(strings.TrimSpace(req.APIKey))
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	now := time.Now().UTC()
	installation := domainMCPInstallationSetting{
		ID: newID(), PackID: packID, Name: name, Enabled: enabled, AllowedTools: allowedTools,
		Provider: firstDomainMCPProvider(pack), Endpoint: endpoint, CredentialCipher: credential,
		CreatedAt: now, UpdatedAt: now,
	}
	setting.Installations = append(setting.Installations, installation)
	return s.persistDomainMCPMutation(actor, record, setting, installation, "domain_mcp.install", "安装领域 MCP 能力包")
}

func (s *Service) UpdateDomainMCPInstallation(actor *model.User, id string, req UpdateDomainMCPRequest) (AdminDomainMCPInstallation, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	if req.ClearCredential && strings.TrimSpace(req.APIKey) != "" {
		return AdminDomainMCPInstallation{}, BadAuthRequest("不能同时设置并清除凭据")
	}
	s.domainMCPUpdateMu.Lock()
	defer s.domainMCPUpdateMu.Unlock()
	record, setting, err := s.readDomainMCPMarketplaceSetting()
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	index := domainMCPInstallationIndex(setting.Installations, strings.TrimSpace(id))
	if index < 0 {
		return AdminDomainMCPInstallation{}, NotFound("领域 MCP 安装记录不存在")
	}
	installation := setting.Installations[index]
	if name := strings.TrimSpace(req.Name); name != "" {
		installation.Name = name
	}
	if req.Enabled != nil {
		installation.Enabled = *req.Enabled
	}
	if req.AllowedTools != nil {
		installation.AllowedTools, err = normalizeDomainMCPAllowedTools(installation.PackID, req.AllowedTools, false)
		if err != nil {
			return AdminDomainMCPInstallation{}, err
		}
	}
	if endpoint := strings.TrimSpace(req.Endpoint); endpoint != "" {
		installation.Endpoint = endpoint
	}
	if req.ClearCredential {
		installation.CredentialCipher = ""
	} else if secret := strings.TrimSpace(req.APIKey); secret != "" {
		installation.CredentialCipher, err = s.encryptSettingSecret(secret)
		if err != nil {
			return AdminDomainMCPInstallation{}, err
		}
	}
	installation.UpdatedAt = time.Now().UTC()
	setting.Installations[index] = installation
	return s.persistDomainMCPMutation(actor, record, setting, installation, "domain_mcp.update", "更新领域 MCP 安装")
}

func (s *Service) DeleteDomainMCPInstallation(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	s.domainMCPUpdateMu.Lock()
	defer s.domainMCPUpdateMu.Unlock()
	record, setting, err := s.readDomainMCPMarketplaceSetting()
	if err != nil {
		return err
	}
	index := domainMCPInstallationIndex(setting.Installations, strings.TrimSpace(id))
	if index < 0 {
		return NotFound("领域 MCP 安装记录不存在")
	}
	removed := setting.Installations[index]
	setting.Installations = append(setting.Installations[:index], setting.Installations[index+1:]...)
	runtime, err := s.buildDomainMCPRuntime(setting)
	if err != nil {
		return err
	}
	encoded, err := encodeDomainMCPMarketplaceSetting(setting)
	if err != nil {
		return err
	}
	record.ValueJSON, record.UpdatedBy = encoded, actor.ID
	audit, err := newAdminAuditEvent(actor, "domain_mcp.delete", "domain_mcp_installation", removed.ID, "删除领域 MCP 安装", map[string]any{"packId": removed.PackID})
	if err != nil {
		return err
	}
	if err := s.repo.SaveSystemSettingWithAudit(record, audit); err != nil {
		return err
	}
	s.swapDomainMCPRuntime(runtime, nil)
	return nil
}

func (s *Service) TestDomainMCPConnection(actor *model.User, id string) (DomainMCPConnectionTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return DomainMCPConnectionTestResult{}, err
	}
	_, setting, err := s.readDomainMCPMarketplaceSetting()
	if err != nil {
		return DomainMCPConnectionTestResult{}, err
	}
	index := domainMCPInstallationIndex(setting.Installations, strings.TrimSpace(id))
	if index < 0 {
		return DomainMCPConnectionTestResult{}, NotFound("领域 MCP 安装记录不存在")
	}
	installation := setting.Installations[index]
	connection, err := s.buildAnySearchConnection(installation)
	if err != nil {
		return DomainMCPConnectionTestResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), domainMCPConnectionTimeoutSeconds*time.Second)
	defer cancel()
	tools, callErr := connection.Client.ListTools(ctx, connection.Snapshot)
	toolNames := make([]string, 0, len(tools))
	for _, tool := range tools {
		if tool.Name == "search" || tool.Name == "extract" {
			toolNames = append(toolNames, tool.Name)
		}
	}
	sort.Strings(toolNames)
	ok := callErr == nil && len(toolNames) == 2
	auditErr := s.appendAdminAudit(actor, "domain_mcp.test", "domain_mcp_installation", installation.ID, "测试领域 MCP 连接", map[string]any{"ok": ok, "toolCount": len(toolNames)})
	if auditErr != nil {
		return DomainMCPConnectionTestResult{}, auditErr
	}
	if callErr != nil {
		return DomainMCPConnectionTestResult{}, WrapAppError(502, "领域 MCP 连接测试失败", callErr)
	}
	if !ok {
		return DomainMCPConnectionTestResult{}, WrapAppError(502, "领域 MCP 连接缺少 search 或 extract 工具", nil)
	}
	return DomainMCPConnectionTestResult{OK: true, Tools: toolNames}, nil
}

func (s *Service) persistDomainMCPMutation(actor *model.User, record *model.SystemSetting, setting domainMCPMarketplaceSetting, installation domainMCPInstallationSetting, action, summary string) (AdminDomainMCPInstallation, error) {
	if err := validateDomainMCPMarketplaceSetting(setting); err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	runtime, err := s.buildDomainMCPRuntime(setting)
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	encoded, err := encodeDomainMCPMarketplaceSetting(setting)
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	record.ValueJSON, record.UpdatedBy = encoded, actor.ID
	audit, err := newAdminAuditEvent(actor, action, "domain_mcp_installation", installation.ID, summary, map[string]any{
		"packId": installation.PackID, "enabled": installation.Enabled,
		"allowedTools": installation.AllowedTools, "credentialConfigured": installation.CredentialCipher != "",
	})
	if err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	if err := s.repo.SaveSystemSettingWithAudit(record, audit); err != nil {
		return AdminDomainMCPInstallation{}, err
	}
	s.swapDomainMCPRuntime(runtime, nil)
	return publicDomainMCPInstallation(installation), nil
}

func (s *Service) readDomainMCPMarketplaceSetting() (*model.SystemSetting, domainMCPMarketplaceSetting, error) {
	record, err := s.repo.SystemSetting(domainMCPMarketplaceSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &model.SystemSetting{Key: domainMCPMarketplaceSettingKey}, domainMCPMarketplaceSetting{SchemaVersion: domainMCPMarketplaceSchemaVersion, Installations: []domainMCPInstallationSetting{}}, nil
	}
	if err != nil {
		return nil, domainMCPMarketplaceSetting{}, err
	}
	setting, err := decodeDomainMCPMarketplaceSetting(record.ValueJSON)
	return record, setting, err
}

func decodeDomainMCPMarketplaceSetting(raw string) (domainMCPMarketplaceSetting, error) {
	var setting domainMCPMarketplaceSetting
	if len(raw) == 0 || len(raw) > maxDomainMCPMarketplaceSettingBytes {
		return setting, errors.New("领域 MCP 市场设置为空或过大")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&setting); err != nil {
		return setting, fmt.Errorf("领域 MCP 市场设置格式无效: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return setting, errors.New("领域 MCP 市场设置只能包含一个 JSON 对象")
	}
	if err := validateDomainMCPMarketplaceSetting(setting); err != nil {
		return setting, err
	}
	return setting, nil
}

func encodeDomainMCPMarketplaceSetting(setting domainMCPMarketplaceSetting) (string, error) {
	setting.SchemaVersion = domainMCPMarketplaceSchemaVersion
	if setting.Installations == nil {
		setting.Installations = []domainMCPInstallationSetting{}
	}
	encoded, err := json.Marshal(setting)
	if err != nil {
		return "", err
	}
	if len(encoded) > maxDomainMCPMarketplaceSettingBytes {
		return "", BadAuthRequest("领域 MCP 市场设置超过大小限制")
	}
	return string(encoded), nil
}

func validateDomainMCPMarketplaceSetting(setting domainMCPMarketplaceSetting) error {
	if setting.SchemaVersion != domainMCPMarketplaceSchemaVersion {
		return errors.New("领域 MCP 市场设置版本不受支持")
	}
	if len(setting.Installations) > maxDomainMCPInstallations {
		return BadAuthRequest("领域 MCP 安装数量超过限制")
	}
	catalog, err := domainmcp.NewCatalog(domainmcp.BuiltinPacks()...)
	if err != nil {
		return err
	}
	seenIDs, seenPacks := map[string]struct{}{}, map[string]struct{}{}
	for _, item := range setting.Installations {
		if err := validateDomainMCPText(item.ID, 64, "安装 ID"); err != nil {
			return err
		}
		if _, duplicate := seenIDs[item.ID]; duplicate {
			return errors.New("领域 MCP 安装 ID 重复")
		}
		seenIDs[item.ID] = struct{}{}
		pack, exists := catalog.Pack(item.PackID)
		if !exists {
			return BadAuthRequest("领域 MCP 能力包不存在: " + item.PackID)
		}
		if _, duplicate := seenPacks[item.PackID]; duplicate {
			return BadAuthRequest("同一领域 MCP 能力包只能安装一次")
		}
		seenPacks[item.PackID] = struct{}{}
		if err := validateDomainMCPText(item.Name, 80, "安装名称"); err != nil {
			return err
		}
		if item.Provider != firstDomainMCPProvider(pack) || item.Endpoint == "" || len(item.Endpoint) > 4096 {
			return BadAuthRequest("领域 MCP Provider 或 Endpoint 无效")
		}
		if len(domainMCPExecutableTools(item.PackID)) == 0 {
			return BadAuthRequest("领域 MCP 安装引用了尚未开放的能力包")
		}
		if err := validateDomainMCPConnectionConfig(item); err != nil {
			return BadAuthRequest("领域 MCP Endpoint 无效: " + err.Error())
		}
		normalized, err := normalizeDomainMCPAllowedTools(item.PackID, item.AllowedTools, false)
		if err != nil || len(normalized) != len(item.AllowedTools) {
			return BadAuthRequest("领域 MCP 工具白名单无效")
		}
		for index := range normalized {
			if normalized[index] != item.AllowedTools[index] {
				return BadAuthRequest("领域 MCP 工具白名单必须规范化排序")
			}
		}
		if item.Enabled && len(item.AllowedTools) == 0 {
			return BadAuthRequest("启用领域 MCP 安装必须至少允许一个工具")
		}
		if item.CredentialCipher != "" && (!strings.HasPrefix(item.CredentialCipher, encryptedSettingPrefix) || len(item.CredentialCipher) > 8192) {
			return errors.New("领域 MCP 凭据密文格式无效")
		}
		if item.CreatedAt.IsZero() || item.UpdatedAt.IsZero() || item.UpdatedAt.Before(item.CreatedAt) {
			return errors.New("领域 MCP 安装时间无效")
		}
	}
	return nil
}

func validateDomainMCPText(value string, maxRunes int, label string) error {
	if value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(label + "为空、过长或包含首尾空白")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}

func publicDomainMCPInstallation(item domainMCPInstallationSetting) AdminDomainMCPInstallation {
	return AdminDomainMCPInstallation{
		ID: item.ID, PackID: item.PackID, Name: item.Name, Enabled: item.Enabled,
		AllowedTools: append([]string(nil), item.AllowedTools...), Provider: item.Provider,
		Endpoint: item.Endpoint, CredentialConfigured: item.CredentialCipher != "",
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}

func firstDomainMCPProvider(pack domainmcp.PackManifest) string {
	if len(pack.ProviderRequirements) == 0 {
		return "builtin"
	}
	return pack.ProviderRequirements[0]
}

func domainMCPInstallationIndex(items []domainMCPInstallationSetting, id string) int {
	for index := range items {
		if items[index].ID == id {
			return index
		}
	}
	return -1
}
