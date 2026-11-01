package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var (
	ErrAgentPetOwned       = errors.New("已有用户购买或领取该形象，不能删除，可以改为下架")
	ErrAgentPetUnavailable = errors.New("形象已下架或价格已变化，请刷新后重试")
)

func (r *Repository) AgentPets() ([]model.AgentPet, error) {
	var pets []model.AgentPet
	err := r.db.Order("sort_order asc, created_at asc").Find(&pets).Error
	return pets, err
}

func (r *Repository) AgentPet(id string) (*model.AgentPet, error) {
	var pet model.AgentPet
	if err := r.db.First(&pet, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &pet, nil
}

func (r *Repository) CreateAgentPet(pet *model.AgentPet) error {
	return r.db.Create(pet).Error
}

func (r *Repository) SaveAgentPet(pet *model.AgentPet) error {
	return r.db.Save(pet).Error
}

// DeleteAgentPet 只删除没有人购买或领取过的形象，并清掉指向它的当前选择。
func (r *Repository) DeleteAgentPet(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var owners int64
		if err := tx.Model(&model.UserAgentPet{}).Where("pet_id = ?", id).Count(&owners).Error; err != nil {
			return err
		}
		if owners > 0 {
			return ErrAgentPetOwned
		}
		deleted := tx.Where("id = ?", id).Delete(&model.AgentPet{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Where("pet_id = ?", id).Delete(&model.UserAgentPetSelection{}).Error
	})
}

func (r *Repository) AgentPetsByResourceIDs(resourceIDs []string) ([]model.AgentPet, error) {
	var pets []model.AgentPet
	if len(resourceIDs) == 0 {
		return pets, nil
	}
	err := r.db.Where("resource_id IN ?", resourceIDs).Find(&pets).Error
	return pets, err
}

func (r *Repository) AgentPetOwnerCounts() (map[string]int64, error) {
	var rows []struct {
		PetID  string
		Owners int64
	}
	if err := r.db.Model(&model.UserAgentPet{}).Select("pet_id, COUNT(*) AS owners").Group("pet_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.PetID] = row.Owners
	}
	return counts, nil
}

func (r *Repository) OwnedAgentPetIDs(userID string) (map[string]bool, error) {
	var ids []string
	if err := r.db.Model(&model.UserAgentPet{}).Where("user_id = ?", userID).Pluck("pet_id", &ids).Error; err != nil {
		return nil, err
	}
	owned := make(map[string]bool, len(ids))
	for _, id := range ids {
		owned[id] = true
	}
	return owned, nil
}

// AgentPetSelection 返回用户当前选择的形象 ID；空字符串表示使用站点默认形象。
func (r *Repository) AgentPetSelection(userID string) (string, error) {
	var selection model.UserAgentPetSelection
	err := r.db.First(&selection, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	return selection.PetID, err
}

// ClaimAgentPet 记录无需付费即可拥有的形象（累计消费达标后领取）；重复领取没有副作用。
func (r *Repository) ClaimAgentPet(userID string, petID string) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.UserAgentPet{UserID: userID, PetID: petID, CreatedAt: time.Now()}).Error
}

func (r *Repository) SaveAgentPetSelection(userID string, petID string) error {
	if petID == "" {
		return r.db.Where("user_id = ?", userID).Delete(&model.UserAgentPetSelection{}).Error
	}
	selection := model.UserAgentPetSelection{UserID: userID, PetID: petID, UpdatedAt: time.Now()}
	return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.AssignmentColumns([]string{"pet_id", "updated_at"})}).Create(&selection).Error
}

// AgentPetPurchase 是一次购买；Access 和价格必须与用户看到的上架信息一致。
type AgentPetPurchase struct {
	UserID            string
	PetID             string
	Access            string
	PriceMicrocredits int64
	Note              string
}

// PurchaseAgentPet 先抢占 (user_id, pet_id) 已购记录再扣积分：重复或并发请求只扣一次，余额不足整笔回滚。
// 返回 false 表示此前已购买，本次未扣费。
func (r *Repository) PurchaseAgentPet(purchase AgentPetPurchase) (bool, *model.CreditAccount, error) {
	var account model.CreditAccount
	purchased := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.CreditAccount{UserID: purchase.UserID}).Error; err != nil {
			return err
		}
		ownership := model.UserAgentPet{UserID: purchase.UserID, PetID: purchase.PetID, PriceMicrocredits: purchase.PriceMicrocredits, CreatedAt: time.Now()}
		claimed := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ownership)
		if claimed.Error != nil {
			return claimed.Error
		}
		if claimed.RowsAffected == 0 {
			return tx.First(&account, "user_id = ?", purchase.UserID).Error
		}
		// 在同一事务里复核上架状态和价格，避免按旧价格扣费。
		var listed int64
		if err := tx.Model(&model.AgentPet{}).Where("id = ? AND enabled = ? AND access = ? AND price_microcredits = ?", purchase.PetID, true, purchase.Access, purchase.PriceMicrocredits).Count(&listed).Error; err != nil {
			return err
		}
		if listed != 1 {
			return ErrAgentPetUnavailable
		}
		debited := tx.Model(&model.CreditAccount{}).Where("user_id = ? AND available_microcredits >= ?", purchase.UserID, purchase.PriceMicrocredits).Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits - ?", purchase.PriceMicrocredits),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             time.Now(),
		})
		if debited.Error != nil {
			return debited.Error
		}
		if debited.RowsAffected != 1 {
			return ErrInsufficientCredits
		}
		if err := tx.First(&account, "user_id = ?", purchase.UserID).Error; err != nil {
			return err
		}
		entry := model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     purchase.UserID,
			Type:                       model.CreditLedgerAgentPetPurchase,
			AmountMicrocredits:         -purchase.PriceMicrocredits,
			AvailableDeltaMicrocredits: -purchase.PriceMicrocredits,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			Scene:                      "智能体形象",
			Note:                       purchase.Note,
		}
		if err := tx.Create(&entry).Error; err != nil {
			return err
		}
		purchased = true
		return tx.Model(&model.UserAgentPet{}).Where("user_id = ? AND pet_id = ?", purchase.UserID, purchase.PetID).Update("ledger_entry_id", entry.ID).Error
	})
	return purchased, &account, err
}
