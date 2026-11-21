package repository

import (
	"time"

	"yingce/backend/internal/model"
)

type AgentMemoryRevisionStatusRow struct {
	ID         string
	Status     string
	RestoredAt *time.Time
}

func (repo *Repository) AgentMemoryRevisionStatuses(userID string, revisionIDs []string) ([]AgentMemoryRevisionStatusRow, error) {
	var rows []AgentMemoryRevisionStatusRow
	err := repo.db.Model(&model.AgentMemoryDocumentRevision{}).Select("id, status, restored_at").
		Where("user_id = ? AND id IN ?", userID, revisionIDs).Find(&rows).Error
	return rows, err
}
