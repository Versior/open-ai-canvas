package app

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/domainmcp/packs/commerce"
	"infinite-canvas/backend/internal/domainmcp/providers"
	mcpprotocol "infinite-canvas/backend/internal/mcp"
)

type domainMCPConnectionRuntime struct {
	Client   *mcpprotocol.Service
	Snapshot mcpprotocol.ServerSnapshot
}

type domainMCPRuntimeSnapshot struct {
	Hub         *domainmcp.Hub
	Connections map[string]domainMCPConnectionRuntime
}

func (s *Service) domainMCPHubSnapshot() (*domainmcp.Hub, error) {
	runtime, err := s.domainMCPRuntimeSnapshot()
	if err != nil {
		return nil, err
	}
	return runtime.Hub, nil
}

// DomainMCPHubSnapshot exposes the immutable Hub snapshot to transport
// adapters while keeping installation state and credentials inside app.
func (s *Service) DomainMCPHubSnapshot() (*domainmcp.Hub, error) {
	return s.domainMCPHubSnapshot()
}

func (s *Service) domainMCPRuntimeSnapshot() (*domainMCPRuntimeSnapshot, error) {
	s.domainMCPMu.RLock()
	if s.domainMCPLoaded {
		runtime, err := s.domainMCPRuntime, s.domainMCPRuntimeErr
		s.domainMCPMu.RUnlock()
		return runtime, err
	}
	s.domainMCPMu.RUnlock()

	s.domainMCPUpdateMu.Lock()
	defer s.domainMCPUpdateMu.Unlock()
	s.domainMCPMu.RLock()
	if s.domainMCPLoaded {
		runtime, err := s.domainMCPRuntime, s.domainMCPRuntimeErr
		s.domainMCPMu.RUnlock()
		return runtime, err
	}
	s.domainMCPMu.RUnlock()

	_, setting, err := s.readDomainMCPMarketplaceSetting()
	if err == nil {
		var runtime *domainMCPRuntimeSnapshot
		runtime, err = s.buildDomainMCPRuntime(setting)
		if err == nil {
			s.swapDomainMCPRuntime(runtime, nil)
			return runtime, nil
		}
	}
	s.swapDomainMCPRuntime(nil, err)
	return nil, err
}

func (s *Service) swapDomainMCPRuntime(runtime *domainMCPRuntimeSnapshot, err error) {
	s.domainMCPMu.Lock()
	s.domainMCPRuntime = runtime
	s.domainMCPRuntimeErr = err
	s.domainMCPLoaded = true
	s.domainMCPMu.Unlock()
}

func (s *Service) buildDomainMCPRuntime(setting domainMCPMarketplaceSetting) (*domainMCPRuntimeSnapshot, error) {
	catalog, err := domainmcp.NewCatalog(domainmcp.BuiltinPacks()...)
	if err != nil {
		return nil, err
	}
	domainInstallations := make([]domainmcp.Installation, 0, len(setting.Installations))
	handlers := make([]domainmcp.ToolHandler, 0, len(setting.Installations))
	connections := make(map[string]domainMCPConnectionRuntime)
	for _, installation := range setting.Installations {
		domainInstallations = append(domainInstallations, domainmcp.Installation{
			PackID: installation.PackID, Enabled: installation.Enabled,
			AllowedTools: append([]string(nil), installation.AllowedTools...),
		})
		if !installation.Enabled {
			continue
		}
		switch installation.PackID {
		case commerce.PackIDProductInsight:
			connection, err := s.buildAnySearchConnection(installation)
			if err != nil {
				return nil, fmt.Errorf("构建 %s 连接失败: %w", installation.Name, err)
			}
			provider, err := providers.NewAnySearch(connection.Client, connection.Snapshot)
			if err != nil {
				return nil, err
			}
			handler, err := commerce.NewProductAnalyze(provider)
			if err != nil {
				return nil, err
			}
			handlers = append(handlers, handler)
			connections[installation.ID] = connection
		default:
			return nil, BadAuthRequest("该领域能力包尚未开放可执行 Handler")
		}
	}
	hub, err := domainmcp.NewHub(catalog, domainInstallations, handlers...)
	if err != nil {
		return nil, err
	}
	return &domainMCPRuntimeSnapshot{Hub: hub, Connections: connections}, nil
}

func (s *Service) buildAnySearchConnection(installation domainMCPInstallationSetting) (domainMCPConnectionRuntime, error) {
	credential, err := s.decryptSettingSecret(installation.CredentialCipher)
	if err != nil {
		return domainMCPConnectionRuntime{}, err
	}
	if strings.TrimSpace(credential) == "" {
		return domainMCPConnectionRuntime{}, BadAuthRequest("启用 AnySearch 能力前需要配置 API Key")
	}
	client, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{
		ID: "domain-" + installation.ID, Name: installation.Name,
		Description: "Domain MCP AnySearch provider", URL: installation.Endpoint,
		Headers:      map[string]string{"Authorization": "Bearer " + credential},
		AllowedTools: []string{"extract", "search"}, TimeoutSeconds: domainMCPConnectionTimeoutSeconds,
	}})
	if err != nil {
		return domainMCPConnectionRuntime{}, err
	}
	snapshots, err := client.Snapshots([]string{"domain-" + installation.ID})
	if err != nil || len(snapshots) != 1 {
		if err == nil {
			err = errors.New("AnySearch MCP 快照缺失")
		}
		return domainMCPConnectionRuntime{}, err
	}
	return domainMCPConnectionRuntime{Client: client, Snapshot: snapshots[0]}, nil
}

func validateDomainMCPConnectionConfig(installation domainMCPInstallationSetting) error {
	_, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{
		ID: "domain-validation", Name: installation.Name, URL: installation.Endpoint,
		AllowedTools: []string{"extract", "search"}, TimeoutSeconds: domainMCPConnectionTimeoutSeconds,
	}})
	return err
}

func domainMCPExecutableTools(packID string) []string {
	switch packID {
	case commerce.PackIDProductInsight:
		return []string{commerce.ToolProductAnalyze}
	default:
		return []string{}
	}
}

func normalizeDomainMCPAllowedTools(packID string, requested []string, preserveNil bool) ([]string, error) {
	if requested == nil && preserveNil {
		return nil, nil
	}
	executable := domainMCPExecutableTools(packID)
	if requested == nil {
		return append([]string(nil), executable...), nil
	}
	allowedSet := make(map[string]struct{}, len(executable))
	for _, name := range executable {
		allowedSet[name] = struct{}{}
	}
	seen := make(map[string]struct{}, len(requested))
	result := make([]string, 0, len(requested))
	for _, raw := range requested {
		name := strings.TrimSpace(raw)
		if _, allowed := allowedSet[name]; !allowed {
			return nil, BadAuthRequest("工具未开放、未实现或不属于该能力包: " + name)
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, BadAuthRequest("能力工具白名单不能重复")
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	sort.Strings(result)
	return result, nil
}
