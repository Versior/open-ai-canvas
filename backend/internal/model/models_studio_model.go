package model

import "time"

// 电商生图台「模特库」的素材种类：模特人脸、全身模特（站立等整个人的全身照）、姿势参考、模特样式（造型）。
// 人脸和全身模特都是真人肖像，需要确认肖像授权才能上架。
const (
	StudioModelKindFace   = "face"
	StudioModelKindFigure = "figure"
	StudioModelKindPose   = "pose"
	StudioModelKindStyle  = "style"
)

// StudioModelAsset 是模特库里的一条素材，由管理员维护。
// 图片存为本地专用资源（kind studio-model），不计入导入者的个人容量；用户选用时复制一份到自己的资源库再出图，
// 出图时的资源归属校验因此保持不变。
type StudioModelAsset struct {
	ID       string `json:"id" gorm:"primaryKey;size:36"`
	Kind     string `json:"kind" gorm:"size:16;not null;index"`
	Name     string `json:"name" gorm:"size:80;not null"`
	Category string `json:"category" gorm:"size:48;not null;default:''"`
	// Gender 为空表示不限，主要用于人脸筛选。
	Gender   string `json:"gender" gorm:"size:16;not null;default:''"`
	TagsJSON string `json:"-" gorm:"type:text;not null;default:'[]'"`
	// Prompt 是写进出图提示词的文字描述；模特样式只靠它描述造型，图片可选。
	Prompt          string `json:"prompt" gorm:"type:text;not null;default:''"`
	ResourceID      string `json:"resourceId" gorm:"size:36;not null;default:'';index"`
	ThumbResourceID string `json:"thumbResourceId" gorm:"size:36;not null;default:'';index"`
	Width           int    `json:"width" gorm:"not null;default:0"`
	Height          int    `json:"height" gorm:"not null;default:0"`
	// Consent 是人脸、全身模特的肖像授权确认；没确认的不能上架。
	Consent   bool      `json:"consent" gorm:"not null;default:false"`
	Enabled   bool      `json:"enabled" gorm:"not null;index"`
	SortOrder int       `json:"sortOrder" gorm:"not null;default:0;index"`
	CreatedBy string    `json:"createdBy" gorm:"size:36"`
	UpdatedBy string    `json:"updatedBy" gorm:"size:36"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
