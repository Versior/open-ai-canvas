package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/model"
)

const (
	cloudAgentDomainMCPBundleTTL          = time.Hour
	cloudAgentDomainMCPSummaryRunes       = 2000
	cloudAgentDomainMCPFindingLimit       = 16
	cloudAgentDomainMCPFindingRunes       = 2000
	cloudAgentDomainMCPSourceLimit        = 20
	cloudAgentDomainMCPSourceSnippetRunes = 1200
	cloudAgentDomainMCPAdviceLimit        = 10
	cloudAgentDomainMCPAdviceRunes        = 1000
)

type cloudAgentDomainMCPCallArgs struct {
	ToolName  string          `json:"toolName"`
	Arguments json.RawMessage `json:"arguments"`
}

func (s *Service) cloudAgentDomainMCPTool(ctx context.Context, run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (any, error) {
	if run == nil || state == nil || strings.TrimSpace(run.ID) == "" || strings.TrimSpace(run.UserID) == "" || strings.TrimSpace(state.Request.CanvasID) == "" {
		return nil, errors.New("领域 MCP Agent 运行上下文不可用")
	}
	if state.RuntimeRunID != "" && state.RuntimeRunID != run.ID {
		return nil, WrapAppError(409, "领域 MCP 调用不属于当前 Agent Run", domainmcp.ErrPolicyBlocked)
	}
	hub, err := s.domainMCPHubSnapshot()
	if err != nil {
		return nil, WrapAppError(503, "领域 MCP 运行时不可用", err)
	}
	switch call.Function.Name {
	case "domain_mcp_list_tools":
		var args struct{}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		return map[string]any{"tools": hub.ListTools()}, nil
	case "domain_mcp_call":
		return s.callCloudAgentDomainMCP(ctx, run, state, call, hub)
	default:
		return nil, BadAuthRequest("不支持的领域 MCP Agent 工具")
	}
}

func (s *Service) callCloudAgentDomainMCP(ctx context.Context, run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, hub *domainmcp.Hub) (any, error) {
	var args cloudAgentDomainMCPCallArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	args.ToolName = strings.TrimSpace(args.ToolName)
	if args.ToolName == "" {
		return nil, cloudAgentFieldError("toolName", "required", "领域 MCP 工具名不能为空，请先读取工具目录")
	}
	if len(args.Arguments) == 0 {
		return nil, cloudAgentFieldError("arguments", "required", "领域 MCP 工具参数不能为空，无参数时传 {}")
	}
	result, err := hub.CallTool(ctx, args.ToolName, args.Arguments)
	if err != nil {
		return nil, cloudAgentDomainMCPAppError(err)
	}
	bundleID := ""
	if len(result.Artifacts) > 0 {
		bundleID = cloudAgentID(run.UserID, run.ID+":domain-mcp:"+call.ID)
		if state.ArtifactBundles == nil {
			state.ArtifactBundles = make(map[string]domainmcp.ArtifactBundle)
		}
		if _, exists := state.ArtifactBundles[bundleID]; !exists && len(state.ArtifactBundles) >= maxCloudAgentArtifactBundles {
			return nil, WrapAppError(409, "当前 Agent Run 的 Artifact Bundle 数量已达上限", domainmcp.ErrPolicyBlocked)
		}
		bundle, err := domainmcp.NewArtifactBundle(bundleID, run.UserID, state.Request.CanvasID, run.ID, args.ToolName, result, time.Now().UTC(), cloudAgentDomainMCPBundleTTL)
		if err != nil {
			return nil, cloudAgentDomainMCPAppError(err)
		}
		state.ArtifactBundles[bundleID] = bundle
	}
	return cloudAgentDomainMCPResultView(args.ToolName, bundleID, result), nil
}

func cloudAgentDomainMCPResultView(toolName, bundleID string, result domainmcp.Result) map[string]any {
	truncated := false
	summary := truncateRunes(result.Summary, cloudAgentDomainMCPSummaryRunes)
	truncated = truncated || summary != result.Summary

	sourceByID := make(map[string]domainmcp.Evidence, len(result.Sources))
	for _, source := range result.Sources {
		sourceByID[source.ID] = source
	}
	neededSources := make(map[string]struct{})
	findings := make([]domainmcp.Finding, 0, min(len(result.Findings), cloudAgentDomainMCPFindingLimit))
	for _, finding := range result.Findings {
		if len(findings) >= cloudAgentDomainMCPFindingLimit {
			truncated = true
			break
		}
		additional := 0
		valid := true
		for _, id := range finding.EvidenceIDs {
			if _, exists := sourceByID[id]; !exists {
				valid = false
				break
			}
			if _, exists := neededSources[id]; !exists {
				additional++
			}
		}
		if !valid || len(neededSources)+additional > cloudAgentDomainMCPSourceLimit {
			truncated = true
			continue
		}
		copy := finding
		copy.Title = truncateRunes(copy.Title, 300)
		copy.Detail = truncateRunes(copy.Detail, cloudAgentDomainMCPFindingRunes)
		copy.EvidenceIDs = append([]string(nil), copy.EvidenceIDs...)
		truncated = truncated || copy.Title != finding.Title || copy.Detail != finding.Detail
		findings = append(findings, copy)
		for _, id := range finding.EvidenceIDs {
			neededSources[id] = struct{}{}
		}
	}

	sources := make([]domainmcp.Evidence, 0, len(neededSources))
	for _, source := range result.Sources {
		if _, needed := neededSources[source.ID]; !needed {
			continue
		}
		copy := source
		copy.Title = truncateRunes(copy.Title, 300)
		copy.Snippet = truncateRunes(copy.Snippet, cloudAgentDomainMCPSourceSnippetRunes)
		truncated = truncated || copy.Title != source.Title || copy.Snippet != source.Snippet
		sources = append(sources, copy)
	}

	warnings, warningsTruncated := boundedDomainMCPStrings(result.Warnings)
	nextActions, actionsTruncated := boundedDomainMCPStrings(result.NextActions)
	truncated = truncated || warningsTruncated || actionsTruncated
	view := map[string]any{
		"toolName": toolName, "summary": summary, "findings": findings,
		"sources": sources, "warnings": warnings, "nextActions": nextActions,
		"truncated": truncated,
	}
	if bundleID != "" {
		view["bundleId"] = bundleID
	}
	return view
}

func boundedDomainMCPStrings(values []string) ([]string, bool) {
	limit := min(len(values), cloudAgentDomainMCPAdviceLimit)
	result := make([]string, 0, limit)
	truncated := len(values) > limit
	for _, value := range values[:limit] {
		bounded := truncateRunes(value, cloudAgentDomainMCPAdviceRunes)
		truncated = truncated || bounded != value
		result = append(result, bounded)
	}
	return result, truncated
}

func cloudAgentDomainMCPAppError(err error) error {
	var domainErr *domainmcp.DomainError
	if !errors.As(err, &domainErr) || domainErr == nil {
		return WrapAppError(502, "领域 MCP 工具执行失败", err)
	}
	message := strings.TrimSpace(domainErr.Message)
	if message == "" {
		message = "领域 MCP 工具执行失败"
	}
	switch domainErr.Code {
	case domainmcp.ErrorInputInvalid:
		return &cloudAgentArgumentError{BadAuthRequest(message)}
	case domainmcp.ErrorPolicyBlocked:
		return WrapAppError(409, message, err)
	case domainmcp.ErrorUpstreamTimeout:
		return WrapAppError(504, "领域 MCP 上游响应超时", err)
	case domainmcp.ErrorUpstreamAuth, domainmcp.ErrorUpstreamQuota, domainmcp.ErrorNoEvidence, domainmcp.ErrorPartialResult, domainmcp.ErrorOutputInvalid:
		return WrapAppError(502, message, err)
	default:
		return WrapAppError(502, "领域 MCP 工具执行失败", err)
	}
}
