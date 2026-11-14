package model

import "time"

type PackagingProject struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	UserID       string    `json:"userId" gorm:"size:36;not null;index:idx_packaging_owner_updated,priority:1"`
	Name         string    `json:"name" gorm:"size:120;not null"`
	TemplateID   string    `json:"templateId" gorm:"size:80;not null;index"`
	DocumentJSON string    `json:"-" gorm:"type:text;not null"`
	Revision     int64     `json:"revision" gorm:"not null"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt" gorm:"index:idx_packaging_owner_updated,priority:2"`
}

// 显式资源关联供所有删除路径检查，项目与关联在同一事务提交。
type PackagingProjectResource struct {
	ProjectID  string `gorm:"primaryKey;size:36"`
	ResourceID string `gorm:"primaryKey;size:80;index"`
}
