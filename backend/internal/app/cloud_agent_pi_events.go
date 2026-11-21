package app

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Canvas Event Handlers - 事件处理器

// handleMessageStart 处理消息开始事件
func (s *Service) handleMessageStart(userID, runID string, data map[string]any) (any, error) {
	// 记录消息开始
	slog.Debug("agent message_start", "run", runID)

	// 更新运行状态
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	// 标记正在生成响应
	state.IsGenerating = true

	if err := s.saveCloudAgentRuntimeState(userID, runID, &state); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true}, nil
}

// handleMessageDelta 处理消息增量事件
func (s *Service) handleMessageDelta(userID, runID string, data map[string]any) (any, error) {
	delta, _ := data["delta"].(string)
	messageID, _ := data["messageId"].(string)
	slog.Debug("agent message_delta", "run", runID, "message_id", messageID, "len", len(delta))

	if err := s.broadcastAgentEvent(userID, runID, "message_delta", map[string]any{
		"delta":     delta,
		"messageId": messageID,
	}); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true}, nil
}

// handleMessageEnd 处理消息结束事件（关键修复点）
func (s *Service) handleMessageEnd(userID, runID string, data map[string]any) (any, error) {
	slog.Debug("agent message_end", "run", runID, "role", data["role"])

	// 检查消息角色，防止将用户消息误认为助手消息
	role, _ := data["role"].(string)
	if role != "assistant" {
		slog.Debug("agent message_end ignored", "run", runID, "role", role)
		return map[string]any{"ok": true, "ignored": true, "reason": fmt.Sprintf("non-assistant role: %s", role)}, nil
	}
	message, _ := data["message"].(map[string]any)
	if !validPiAssistantResponse(message) {
		return nil, errors.New("invalid Agent assistant message_end: expected a completed text response or tool call")
	}

	// 更新运行状态
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	// 标记生成完成
	state.IsGenerating = false

	// 计数真实的助手响应
	state.PiAssistantResponses++

	slog.Debug("agent assistant response completed", "run", runID, "count", state.PiAssistantResponses)

	if err := s.saveCloudAgentRuntimeState(userID, runID, &state); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true, "assistantResponses": state.PiAssistantResponses}, nil
}

func validPiAssistantResponse(message map[string]any) bool {
	if message["role"] != "assistant" || stringField(message, "errorMessage") != "" {
		return false
	}
	seen := map[string]bool{}
	for _, raw := range interfaceSlice(message["content"]) {
		part, _ := raw.(map[string]any)
		if part["type"] != "toolCall" {
			continue
		}
		id, name := stringField(part, "id"), stringField(part, "name")
		if strings.TrimSpace(id) == "" || strings.TrimSpace(name) == "" || seen[id] {
			return false
		}
		if arguments := part["arguments"]; arguments != nil {
			if _, ok := arguments.(map[string]any); !ok {
				return false
			}
		}
		seen[id] = true
	}
	if len(seen) > 0 {
		return message["stopReason"] == "toolUse"
	}
	return message["stopReason"] == "stop" && strings.TrimSpace(runtimeContentText(message["content"])) != ""
}

// handleError 处理错误事件
func (s *Service) handleError(userID, runID string, data map[string]any) (any, error) {
	errorMsg, _ := data["error"].(string)
	slog.Warn("agent runtime error", "run", runID, "error", errorMsg)

	// 更新运行状态为失败
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}

	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	state.IsGenerating = false
	state.LastError = errorMsg

	if err := s.saveCloudAgentRuntimeState(userID, runID, &state); err != nil {
		return nil, err
	}

	return map[string]any{"ok": true}, nil
}

// saveCloudAgentRuntimeState persists only the Pi control fields changed by an
// event handler, merging them into the latest revision before checkpointing.
func (s *Service) saveCloudAgentRuntimeState(userID, runID string, state *cloudAgentRuntime) error {
	if state == nil {
		return fmt.Errorf("missing Agent runtime state")
	}
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			fresh, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			fresh.IsGenerating = state.IsGenerating
			fresh.LastError = state.LastError
			fresh.PiAssistantResponses = state.PiAssistantResponses
			return cloudAgentSave(current, &fresh)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

func (s *Service) broadcastAgentEvent(userID, runID, kind string, payload map[string]any) error {
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			state.event(runID, kind, payload)
			return cloudAgentSave(current, &state)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}
