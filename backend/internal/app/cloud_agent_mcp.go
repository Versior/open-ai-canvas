package app

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	mcpprotocol "infinite-canvas/backend/internal/mcp"
)

type AgentMCPServerView = mcpprotocol.PublicServer

func validateCloudAgentMCPSnapshots(ids []string, snapshots []mcpprotocol.ServerSnapshot) error {
	if len(ids) != len(snapshots) {
		return errors.New("Agent runtime MCP snapshot count is invalid")
	}
	for index, snapshot := range snapshots {
		if snapshot.ID != ids[index] {
			return errors.New("Agent runtime MCP snapshot order is invalid")
		}
		if err := validateCloudAgentID(snapshot.ID, "MCP Server ID", 64); err != nil {
			return errors.New("Agent runtime MCP snapshot ID is invalid")
		}
		if err := validateCloudAgentID(snapshot.Name, "MCP Server 名称", 80); err != nil {
			return errors.New("Agent runtime MCP snapshot name is invalid")
		}
		if len(snapshot.ConfigHash) != 64 {
			return errors.New("Agent runtime MCP snapshot hash is invalid")
		}
		if raw, err := hex.DecodeString(snapshot.ConfigHash); err != nil || len(raw) != 32 {
			return errors.New("Agent runtime MCP snapshot hash is invalid")
		}
	}
	return nil
}

func (s *Service) AgentMCPServers() ([]AgentMCPServerView, error) {
	if s.mcpErr != nil {
		return nil, fmt.Errorf("MCP 配置不可用: %w", s.mcpErr)
	}
	if s.mcp == nil {
		return []AgentMCPServerView{}, nil
	}
	return s.mcp.Servers(), nil
}

func (s *Service) cloudAgentMCPSnapshots(ids []string) ([]mcpprotocol.ServerSnapshot, error) {
	if len(ids) == 0 {
		return []mcpprotocol.ServerSnapshot{}, nil
	}
	if s.mcpErr != nil {
		return nil, BadAuthRequest("MCP 配置不可用，请联系管理员")
	}
	if s.mcp == nil {
		return nil, BadAuthRequest("当前部署未配置 MCP Server")
	}
	snapshots, err := s.mcp.Snapshots(ids)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return snapshots, nil
}

func cloudAgentMCPSnapshot(state *cloudAgentRuntime, serverID string) (mcpprotocol.ServerSnapshot, error) {
	serverID = strings.TrimSpace(serverID)
	for _, snapshot := range state.MCPServers {
		if snapshot.ID == serverID {
			return snapshot, nil
		}
	}
	return mcpprotocol.ServerSnapshot{}, BadAuthRequest("MCP Server 未包含在本轮固定快照中")
}

func (s *Service) cloudAgentMCPTool(ctx context.Context, state *cloudAgentRuntime, call cloudAgentCall) (any, error) {
	if s.mcpErr != nil {
		return nil, BadAuthRequest("MCP 配置不可用，请联系管理员")
	}
	if s.mcp == nil {
		return nil, BadAuthRequest("当前部署未配置 MCP Server")
	}
	switch call.Function.Name {
	case "mcp_list_tools":
		var args struct {
			ServerID string `json:"serverId"`
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		snapshot, err := cloudAgentMCPSnapshot(state, args.ServerID)
		if err != nil {
			return nil, err
		}
		tools, err := s.mcp.ListTools(ctx, snapshot)
		if err != nil {
			return nil, BadAuthRequest("MCP 工具目录读取失败：" + truncateRunes(err.Error(), 500))
		}
		return map[string]any{"serverId": snapshot.ID, "serverName": snapshot.Name, "tools": tools}, nil
	case "mcp_call":
		args, snapshot, err := s.cloudAgentMCPCallArgs(state, call)
		if err != nil {
			return nil, err
		}
		result, err := s.mcp.CallTool(ctx, snapshot, args.ToolName, args.Arguments)
		if err != nil {
			return nil, BadAuthRequest("MCP 工具调用失败：" + truncateRunes(err.Error(), 500))
		}
		payload := map[string]any{"serverId": snapshot.ID, "serverName": snapshot.Name, "toolName": args.ToolName, "result": result}
		if result.IsError {
			return payload, BadAuthRequest("MCP 工具返回未成功结果")
		}
		return payload, nil
	default:
		return nil, errors.New("unsupported MCP Agent tool")
	}
}

type cloudAgentMCPCallArguments struct {
	ServerID  string         `json:"serverId"`
	ToolName  string         `json:"toolName"`
	Arguments map[string]any `json:"arguments"`
}

func (s *Service) cloudAgentMCPCallArgs(state *cloudAgentRuntime, call cloudAgentCall) (cloudAgentMCPCallArguments, mcpprotocol.ServerSnapshot, error) {
	var args cloudAgentMCPCallArguments
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return args, mcpprotocol.ServerSnapshot{}, cloudAgentJSONArgumentError(err)
	}
	args.ToolName = strings.TrimSpace(args.ToolName)
	if args.ToolName == "" || len([]rune(args.ToolName)) > 128 {
		return args, mcpprotocol.ServerSnapshot{}, BadAuthRequest("MCP 工具名无效")
	}
	if args.Arguments == nil {
		args.Arguments = map[string]any{}
	}
	snapshot, err := cloudAgentMCPSnapshot(state, args.ServerID)
	if err != nil {
		return args, snapshot, err
	}
	if s.mcpErr != nil || s.mcp == nil {
		return args, snapshot, BadAuthRequest("MCP 配置不可用")
	}
	if err := s.mcp.ValidateTool(snapshot, args.ToolName); err != nil {
		return args, snapshot, BadAuthRequest(err.Error())
	}
	return args, snapshot, nil
}

func (s *Service) cloudAgentMCPApprovalPreview(state *cloudAgentRuntime, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	args, snapshot, err := s.cloudAgentMCPCallArgs(state, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	arguments, _ := json.Marshal(args.Arguments)
	details := []string{"Server：" + truncateRunes(snapshot.Name, 80), "工具：" + truncateRunes(args.ToolName, 128)}
	if compact := strings.TrimSpace(string(arguments)); compact != "" && compact != "{}" {
		details = append(details, "参数："+truncateRunes(compact, 500))
	}
	return cloudAgentApprovalPreview{
		Kind:        "mcp_tool_call",
		Title:       "确认调用外部 MCP 工具",
		Description: "该工具由部署者配置的外部 MCP Server 执行。批准只授权本次调用，不扩大后续 Agent 权限。",
		Items: []cloudAgentApprovalPreviewItem{{
			Operation: "mcp_call",
			Details:   details,
			Summary:   fmt.Sprintf("调用 %s 的 %s", snapshot.Name, args.ToolName),
		}},
	}, nil
}
