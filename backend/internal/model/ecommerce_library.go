package model

import "time"

// EcommerceLibrary is private to its owner; public publication uses admin settings.
type EcommerceLibrary struct {
	UserID      string    `json:"-" gorm:"primaryKey;size:36"`
	Revision    int64     `json:"revision"`
	PayloadJSON string    `json:"-" gorm:"type:text"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
