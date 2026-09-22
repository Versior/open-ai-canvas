package domainmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
)

const maxToolInputBytes = 64 << 10

type Installation struct {
	PackID       string   `json:"packId"`
	Enabled      bool     `json:"enabled"`
	AllowedTools []string `json:"allowedTools"`
}

type ToolHandler interface {
	Manifest() ToolManifest
	Call(context.Context, json.RawMessage) (Result, error)
}

type hubTool struct {
	packID   string
	manifest ToolManifest
	handler  ToolHandler
}

type Hub struct {
	tools map[string]hubTool
	order []string
}

func NewHub(catalog *Catalog, installations []Installation, handlers ...ToolHandler) (*Hub, error) {
	if catalog == nil {
		return nil, errors.New("领域 MCP Catalog 不能为空")
	}
	catalogTools := make(map[string]hubTool)
	for _, pack := range catalog.Packs() {
		for _, manifest := range pack.Tools {
			catalogTools[manifest.Name] = hubTool{packID: pack.ID, manifest: manifest}
		}
	}

	registered := make(map[string]hubTool, len(handlers))
	for _, handler := range handlers {
		if handler == nil {
			return nil, errors.New("领域 MCP 工具 Handler 不能为空")
		}
		manifest := normalizeToolManifest(handler.Manifest())
		catalogTool, exists := catalogTools[manifest.Name]
		if !exists {
			return nil, fmt.Errorf("Handler 工具不在 Catalog 中: %s", manifest.Name)
		}
		if _, duplicate := registered[manifest.Name]; duplicate {
			return nil, fmt.Errorf("工具 Handler 重复: %s", manifest.Name)
		}
		if !toolManifestsEqual(catalogTool.manifest, manifest) {
			return nil, fmt.Errorf("工具 Handler Manifest 与 Catalog 不一致: %s", manifest.Name)
		}
		catalogTool.handler = handler
		registered[manifest.Name] = catalogTool
	}

	hub := &Hub{tools: make(map[string]hubTool), order: []string{}}
	seenPacks := make(map[string]struct{}, len(installations))
	for _, input := range installations {
		packID := strings.TrimSpace(input.PackID)
		if _, duplicate := seenPacks[packID]; duplicate {
			return nil, fmt.Errorf("能力包安装记录重复: %s", packID)
		}
		seenPacks[packID] = struct{}{}
		pack, exists := catalog.Pack(packID)
		if !exists {
			return nil, fmt.Errorf("能力包不存在: %s", packID)
		}
		if !input.Enabled {
			continue
		}
		if len(input.AllowedTools) == 0 {
			return nil, fmt.Errorf("启用的能力包 %s 必须配置工具白名单", packID)
		}
		packTools := make(map[string]ToolManifest, len(pack.Tools))
		for _, manifest := range pack.Tools {
			packTools[manifest.Name] = manifest
		}
		seenTools := make(map[string]struct{}, len(input.AllowedTools))
		allowed := make([]string, 0, len(input.AllowedTools))
		for _, rawName := range input.AllowedTools {
			name := strings.TrimSpace(rawName)
			if _, duplicate := seenTools[name]; duplicate {
				return nil, fmt.Errorf("能力包 %s 工具白名单重复: %s", packID, name)
			}
			manifest, belongs := packTools[name]
			if !belongs {
				return nil, fmt.Errorf("工具 %s 不属于能力包 %s", name, packID)
			}
			if manifest.Permission == PermissionProhibited {
				return nil, fmt.Errorf("工具 %s 已被 Catalog 禁止", name)
			}
			if _, executable := registered[name]; !executable {
				return nil, fmt.Errorf("工具 %s 尚无可执行 Handler", name)
			}
			seenTools[name] = struct{}{}
			allowed = append(allowed, name)
		}
		sort.Strings(allowed)
		for _, name := range allowed {
			hub.tools[name] = registered[name]
			hub.order = append(hub.order, name)
		}
	}
	return hub, nil
}

func (h *Hub) ListTools() []ToolManifest {
	if h == nil {
		return []ToolManifest{}
	}
	result := make([]ToolManifest, 0, len(h.order))
	for _, name := range h.order {
		result = append(result, cloneToolManifest(h.tools[name].manifest))
	}
	return result
}

func (h *Hub) CallTool(ctx context.Context, name string, input json.RawMessage) (Result, error) {
	if h == nil {
		return Result{}, NewError(ErrorPolicyBlocked, "领域 MCP Hub 未启用", nil)
	}
	name = strings.TrimSpace(name)
	tool, allowed := h.tools[name]
	if !allowed {
		return Result{}, NewError(ErrorPolicyBlocked, "领域 MCP 工具未安装、未启用或不在白名单中", nil)
	}
	if err := validateToolInput(input); err != nil {
		return Result{}, NewError(ErrorInputInvalid, "领域 MCP 工具参数必须是有界 JSON 对象", err)
	}
	result, err := tool.handler.Call(ctx, append(json.RawMessage(nil), input...))
	if err != nil {
		return Result{}, err
	}
	if err := ValidateResult(result); err != nil {
		return Result{}, err
	}
	return result, nil
}

func validateToolInput(input json.RawMessage) error {
	if len(input) == 0 || len(input) > maxToolInputBytes {
		return fmt.Errorf("参数需要 1–%d 字节", maxToolInputBytes)
	}
	decoder := json.NewDecoder(bytes.NewReader(input))
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if value == nil {
		return errors.New("参数必须是 JSON 对象")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("参数只能包含一个 JSON 对象")
	}
	return nil
}

func normalizeToolManifest(manifest ToolManifest) ToolManifest {
	result := cloneToolManifest(manifest)
	result.Name = strings.TrimSpace(result.Name)
	result.Description = strings.TrimSpace(result.Description)
	if result.InputSchema == nil {
		result.InputSchema = map[string]any{"type": "object"}
	}
	if result.OutputSchemaVersion == 0 {
		result.OutputSchemaVersion = 1
	}
	return result
}

func cloneToolManifest(manifest ToolManifest) ToolManifest {
	result := manifest
	result.InputSchema = cloneStringAnyMap(manifest.InputSchema)
	return result
}

func toolManifestsEqual(left, right ToolManifest) bool {
	return left.Name == right.Name && left.Description == right.Description && left.Permission == right.Permission && left.OutputSchemaVersion == right.OutputSchemaVersion && reflect.DeepEqual(left.InputSchema, right.InputSchema)
}
