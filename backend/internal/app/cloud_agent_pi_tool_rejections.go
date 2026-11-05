package app

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// SDK 的参数校验发生在 /tool 之前；回填真实失败，保持调用游标与运行时一致。
func (s *Service) handlePiToolValidationFailure(userID, runID string, data map[string]any) (any, error) {
	callID, toolName := stringField(data, "callId"), stringField(data, "toolName")
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if _, recorded := cloudAgentToolMessage(&state, callID); recorded {
				return nil
			}
			if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
				return fmt.Errorf("工具调用 %q 没有对应的模型工具调用", callID)
			}
			call := state.Calls[state.CallIndex]
			if call.ID != callID || call.Function.Name != toolName {
				return fmt.Errorf("工具调用 %q 与模型声明的工具调用不一致", callID)
			}
			result := map[string]any{
				"phase": "validation", "taskSubmitted": false,
				"validationError": stringField(data, "error"),
			}
			// 「必须是可选值之一」的字段直接给出可选值：较弱的模型在整份 parameters 里找不到枚举，会连着再错几次。
			if allowed := cloudAgentValidationAllowedValues(state.Canonical.Tools, toolName, stringField(data, "error")); len(allowed) > 0 {
				result["allowedValues"] = allowed
			}
			argumentErr := &cloudAgentArgumentError{BadAuthRequest("工具参数不符合声明，本次调用未执行；请按返回的 parameters 修正参数")}
			cloudAgentRecordToolResult(current, &state, call, result, argumentErr)
			return cloudAgentSave(current, &state)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return map[string]any{"ok": err == nil}, err
		}
	}
	return nil, repository.ErrCreationConflict
}

var cloudAgentEnumViolation = regexp.MustCompile(`(?m)^\s*-\s*([A-Za-z0-9_.]+):\s*must be equal to one of the allowed values`)

// cloudAgentValidationAllowedValues 按校验报错里的字段路径（如 shots.1.role），到本轮声明的参数结构里取出它的可选值。
func cloudAgentValidationAllowedValues(tools []map[string]any, toolName, validationError string) map[string]any {
	var schema map[string]any
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]any)
		if function["name"] == toolName {
			schema, _ = function["parameters"].(map[string]any)
			break
		}
	}
	if schema == nil {
		return nil
	}
	allowed := map[string]any{}
	for _, match := range cloudAgentEnumViolation.FindAllStringSubmatch(validationError, 12) {
		node := schema
		for _, segment := range strings.Split(match[1], ".") {
			if node == nil {
				break
			}
			if _, err := strconv.Atoi(segment); err == nil {
				node, _ = node["items"].(map[string]any)
				continue
			}
			properties, _ := node["properties"].(map[string]any)
			node, _ = properties[segment].(map[string]any)
		}
		if values, ok := node["enum"]; ok && node != nil {
			allowed[match[1]] = values
		}
	}
	return allowed
}
