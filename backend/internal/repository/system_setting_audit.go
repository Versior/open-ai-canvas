package repository

import (
	"errors"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

// SaveSystemSettingWithAudit commits configuration and its append-only admin
// audit as one unit. Callers must build and validate any runtime snapshot before
// entering this transaction so a failed reload never leaves persisted partial
// state behind.
func (r *Repository) SaveSystemSettingWithAudit(setting *model.SystemSetting, event *model.AdminAuditEvent) error {
	if setting == nil || event == nil {
		return errors.New("system setting and admin audit are required")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(setting).Error; err != nil {
			return err
		}
		return tx.Create(event).Error
	})
}
