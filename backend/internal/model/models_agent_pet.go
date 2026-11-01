package model

import "time"

// CreditLedgerAgentPetPurchase 记录用户用积分购买智能体形象（宠物皮肤）的扣费。
const CreditLedgerAgentPetPurchase CreditLedgerType = "agent_pet_purchase"

// AgentPet 是后台“智能体样式”形象库的一条配置。
// 内置形象的图集打包在程序里，只有管理员改过配置后才会落库；上传形象导入时即落库，图集存为本地资源。
type AgentPet struct {
	ID                string `json:"id" gorm:"primaryKey;size:64"`
	Source            string `json:"source" gorm:"size:16;not null;index"`
	ResourceID        string `json:"resourceId" gorm:"size:36;index"`
	Name              string `json:"name" gorm:"size:80;not null"`
	Description       string `json:"description" gorm:"size:400;not null"`
	SpriteVersion     int    `json:"spriteVersion" gorm:"not null"`
	Enabled           bool   `json:"enabled" gorm:"not null;index"`
	Access            string `json:"access" gorm:"size:16;not null"`
	PriceMicrocredits int64  `json:"priceMicrocredits" gorm:"not null"`
	// UnlockMicrocredits 是 spend（累计消费解锁）方式的门槛。
	UnlockMicrocredits int64     `json:"unlockMicrocredits" gorm:"not null;default:0"`
	GroupCodesJSON     string    `json:"-" gorm:"type:text;not null"`
	StateRowsJSON      string    `json:"-" gorm:"type:text;not null"`
	Pixelated          bool      `json:"pixelated" gorm:"not null"`
	SortOrder          int       `json:"sortOrder" gorm:"not null;index"`
	UpdatedBy          string    `json:"updatedBy" gorm:"size:36"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// UserAgentPet 是用户已拥有的形象（积分购买或累计消费领取）。主键 (user_id, pet_id) 同时是购买和领取的幂等键；
// 领取的记录价格为 0、没有积分流水。
type UserAgentPet struct {
	UserID            string    `json:"userId" gorm:"primaryKey;size:36"`
	PetID             string    `json:"petId" gorm:"primaryKey;size:64;index"`
	PriceMicrocredits int64     `json:"priceMicrocredits" gorm:"not null"`
	LedgerEntryID     string    `json:"ledgerEntryId" gorm:"size:36"`
	CreatedAt         time.Time `json:"createdAt"`
}

// UserAgentPetSelection 是用户当前使用的形象；没有记录表示使用站点默认形象。
type UserAgentPetSelection struct {
	UserID    string    `json:"userId" gorm:"primaryKey;size:36"`
	PetID     string    `json:"petId" gorm:"size:64;not null;index"`
	UpdatedAt time.Time `json:"updatedAt"`
}
