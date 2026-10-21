package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrEcommerceLibraryConflict = errors.New("ecommerce library revision conflict")

func (r *Repository) EcommerceLibrary(userID string) (*model.EcommerceLibrary, error) {
	var row model.EcommerceLibrary
	err := r.db.First(&row, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *Repository) SaveEcommerceLibrary(row *model.EcommerceLibrary, expected int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if expected == 0 {
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(row)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrEcommerceLibraryConflict
			}
			return nil
		}
		result := tx.Model(&model.EcommerceLibrary{}).Where("user_id = ? AND revision = ?", row.UserID, expected).Updates(map[string]any{"payload_json": row.PayloadJSON, "revision": row.Revision, "updated_at": row.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrEcommerceLibraryConflict
		}
		return nil
	})
}
