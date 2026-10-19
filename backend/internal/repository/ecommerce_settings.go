package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrEcommerceSettingChanged = errors.New("ecommerce settings changed")

// Compare the persisted snapshot inside the same transaction as the rollback
// copy and audit, including when multiple API processes save concurrently.
func (r *Repository) SaveEcommerceSetting(before, next, previous *model.SystemSetting, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if before == nil {
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(next)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrEcommerceSettingChanged
			}
		} else {
			result := tx.Model(&model.SystemSetting{}).Where("key = ? AND value_json = ?", before.Key, before.ValueJSON).Updates(map[string]any{"value_json": next.ValueJSON, "updated_by": next.UpdatedBy})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrEcommerceSettingChanged
			}
		}
		if err := tx.Save(previous).Error; err != nil {
			return err
		}
		return tx.Create(audit).Error
	})
}
