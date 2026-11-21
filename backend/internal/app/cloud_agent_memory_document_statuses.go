package app

import (
	"errors"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (svc *Service) AgentMemoryRevisionStatuses(userID string, revisionIDs []string) (map[string]string, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if len(revisionIDs) < 1 || len(revisionIDs) > 100 {
		return nil, BadAuthRequest("每次查询需要 1–100 个记忆修订 ID")
	}
	statuses := make(map[string]string, len(revisionIDs))
	uniqueIDs := make([]string, 0, len(revisionIDs))
	for _, id := range revisionIDs {
		if _, exists := statuses[id]; exists {
			continue
		}
		if err := validateCloudAgentID(id, "记忆修订 ID", 36); err != nil {
			return nil, err
		}
		uniqueIDs = append(uniqueIDs, id)
		statuses[id] = "unavailable"
	}
	rows, err := svc.repo.AgentMemoryRevisionStatuses(userID, uniqueIDs)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		switch row.Status {
		case model.AgentMemoryRevisionApplied, model.AgentMemoryRevisionPending, model.AgentMemoryRevisionRejected:
			if row.RestoredAt != nil {
				statuses[row.ID] = agentMemoryOutcomeUndone
			} else {
				statuses[row.ID] = row.Status
			}
		default:
			return nil, errors.New("记忆修订记录的状态无效")
		}
	}
	return statuses, nil
}
