package model

import "time"

// LUTLibraryItem 存站点共享滤镜；作品保存独立快照，管理更新不会改写已选作品。
type LUTLibraryItem struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	Name            string    `json:"name" gorm:"size:120;not null"`
	Category        string    `json:"category" gorm:"size:80;not null"`
	Description     string    `json:"description" gorm:"size:500"`
	Preset          string    `json:"preset,omitempty" gorm:"size:32"`
	CubeJSON        string    `json:"-" gorm:"type:text"`
	CubeSize        int       `json:"cubeSize" gorm:"not null"`
	DefaultStrength float64   `json:"defaultStrength" gorm:"not null"`
	Enabled         bool      `json:"enabled" gorm:"not null;index"`
	SortOrder       int       `json:"sortOrder" gorm:"not null;index"`
	Version         int64     `json:"version" gorm:"not null"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
