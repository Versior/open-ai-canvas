package repository

import (
	"errors"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

var ErrLUTLibraryConflict = errors.New("LUT library version conflict")

func (r *Repository) LUTLibraryItems(visibleOnly bool) ([]model.LUTLibraryItem, error) {
	items := []model.LUTLibraryItem{}
	query := r.db.Omit("cube_json").Order("sort_order asc, id asc")
	if visibleOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *Repository) LUTLibraryItem(id string) (*model.LUTLibraryItem, error) {
	var item model.LUTLibraryItem
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateLUTLibraryItem(item *model.LUTLibraryItem) error {
	return r.db.Create(item).Error
}

func (r *Repository) UpdateLUTLibraryItem(id string, version int64, fields map[string]any) error {
	fields["version"] = gorm.Expr("version + 1")
	result := r.db.Model(&model.LUTLibraryItem{}).Where("id = ? AND version = ?", id, version).Updates(fields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrLUTLibraryConflict
	}
	return nil
}

func (r *Repository) DeleteLUTLibraryItem(id string, version int64) error {
	result := r.db.Where("id = ? AND version = ?", id, version).Delete(&model.LUTLibraryItem{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrLUTLibraryConflict
	}
	return nil
}
