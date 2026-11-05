package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// migrateInteriorFeature 建立室内设计的模式、风格/空间预设和用户项目三张表；只建新表，不改动已有数据。
func migrateInteriorFeature(tx *gorm.DB) error {
	return tx.AutoMigrate(&model.InteriorMode{}, &model.InteriorPreset{}, &model.InteriorProject{})
}
