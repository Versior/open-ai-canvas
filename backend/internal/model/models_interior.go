package model

import "time"

// InteriorMode 是室内设计页的一种出图方式（风格改造、毛坯出图等），由管理员维护。
// 提示词模板只在服务端编译，不下发给浏览器。
type InteriorMode struct {
	ID                string    `json:"id" gorm:"primaryKey;size:36"`
	Key               string    `json:"key" gorm:"size:64;not null;uniqueIndex"`
	Name              string    `json:"name" gorm:"size:120;not null"`
	Subtitle          string    `json:"subtitle" gorm:"size:240"`
	Description       string    `json:"description" gorm:"type:text"`
	Audience          string    `json:"audience" gorm:"size:16;not null"`
	CoverResourceID   string    `json:"coverResourceId" gorm:"size:36"`
	SlotsJSON         string    `json:"slotsJson" gorm:"type:text"`
	ParamsJSON        string    `json:"paramsJson" gorm:"type:text"`
	PromptTemplate    string    `json:"promptTemplate" gorm:"type:text"`
	RequiresRoom      bool      `json:"requiresRoom"`
	RequiresStyle     bool      `json:"requiresStyle"`
	NotesRequired     bool      `json:"notesRequired"`
	DefaultModelJSON  string    `json:"defaultModelJson" gorm:"type:text"`
	AllowedModelsJSON string    `json:"allowedModelsJson" gorm:"type:text"`
	MaxCount          int       `json:"maxCount" gorm:"not null;default:1"`
	SortOrder         int       `json:"sortOrder" gorm:"not null;default:0;index:idx_interior_modes_enabled_sort,priority:2"`
	Enabled           bool      `json:"enabled" gorm:"index:idx_interior_modes_enabled_sort,priority:1"`
	Builtin           bool      `json:"builtin"`
	Version           int       `json:"version" gorm:"not null;default:1"`
	CreatedBy         string    `json:"createdBy" gorm:"size:36"`
	UpdatedBy         string    `json:"updatedBy" gorm:"size:36"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

// InteriorPreset 是风格、空间等横跨所有模式的可选项。
type InteriorPreset struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	Type            string    `json:"type" gorm:"size:16;not null;uniqueIndex:idx_interior_presets_type_key,priority:1;index:idx_interior_presets_type_sort,priority:1"`
	Key             string    `json:"key" gorm:"size:64;not null;uniqueIndex:idx_interior_presets_type_key,priority:2"`
	GroupName       string    `json:"groupName" gorm:"size:64"`
	Name            string    `json:"name" gorm:"size:120;not null"`
	Summary         string    `json:"summary" gorm:"size:240"`
	CoverResourceID string    `json:"coverResourceId" gorm:"size:36"`
	Prompt          string    `json:"prompt" gorm:"type:text"`
	TagsJSON        string    `json:"tagsJson" gorm:"type:text"`
	SortOrder       int       `json:"sortOrder" gorm:"not null;default:0;index:idx_interior_presets_type_sort,priority:2"`
	Enabled         bool      `json:"enabled"`
	Builtin         bool      `json:"builtin"`
	Version         int       `json:"version" gorm:"not null;default:1"`
	CreatedBy       string    `json:"createdBy" gorm:"size:36"`
	UpdatedBy       string    `json:"updatedBy" gorm:"size:36"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// InteriorProject 是用户的一个房屋或客户方案。DocumentJSON 保存出图轮次，结构由前端维护，
// 其中的图片只能用 resourceId 字段引用，资源清理据此识别仍被引用的图片。
type InteriorProject struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	UserID       string    `json:"userId" gorm:"size:36;not null;index:idx_interior_projects_owner_updated,priority:1"`
	Name         string    `json:"name" gorm:"size:160;not null"`
	Kind         string    `json:"kind" gorm:"size:16;not null"`
	DocumentJSON string    `json:"documentJson" gorm:"type:text;not null"`
	Revision     int64     `json:"revision" gorm:"not null;default:1"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt" gorm:"index:idx_interior_projects_owner_updated,priority:2"`
}
