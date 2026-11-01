package app

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestAgentPetPromotionPricingAndPurchase(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	user := &model.User{ID: "pet-shopper", Username: "pet-shopper", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	inTwoDays := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
	if _, err := svc.UpdateAdminAgentPet(admin, "polin", AdminAgentPetInput{Name: "花粉", Enabled: true, Access: "paid", PriceMicrocredits: 10_000_000, PromoEnabled: true, PromoPriceMicrocredits: 6_000_000, PromoEndsAt: &inTwoDays}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAdminAgentPet(admin, "longbao", AdminAgentPetInput{Name: "龙宝", Enabled: true, Access: "paid", PriceMicrocredits: 12_000_000, PromoEnabled: true, PromoLabel: "新春", PromoPriceMicrocredits: 0}); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Hour)
	if _, err := svc.UpdateAdminAgentPet(admin, "rupet", AdminAgentPetInput{Name: "机器人", Enabled: true, Access: "paid", PriceMicrocredits: 3_000_000, PromoEnabled: true, PromoPriceMicrocredits: 1_000_000, PromoStartsAt: &later}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAdminAgentPet(admin, "pingo", AdminAgentPetInput{Name: "企鹅", Enabled: true, Access: "free", PromoEnabled: true, PromoPriceMicrocredits: 0}); err == nil {
		t.Fatal("promotion on a free pet accepted")
	}

	catalog, err := svc.AgentPetCatalog(user)
	if err != nil {
		t.Fatal(err)
	}
	sale := findAgentPetView(t, catalog.Pets, "polin")
	if sale.PriceMicrocredits != 6_000_000 || sale.ListPriceMicrocredits != 10_000_000 || sale.Promotion == nil || sale.Promotion.Label != "限时特惠" || !sale.Promotion.EndsAt.Equal(inTwoDays) {
		t.Fatalf("sale view = %+v promo=%+v", sale, sale.Promotion)
	}
	if gift := findAgentPetView(t, catalog.Pets, "longbao"); gift.PriceMicrocredits != 0 || gift.Promotion == nil || gift.Promotion.Label != "新春" || gift.Promotion.EndsAt != nil || !gift.Purchasable {
		t.Fatalf("gift view = %+v", gift)
	}
	if scheduled := findAgentPetView(t, catalog.Pets, "rupet"); scheduled.PriceMicrocredits != 3_000_000 || scheduled.Promotion != nil {
		t.Fatalf("scheduled view = %+v", scheduled)
	}
	// 没保存过的内置形象带自带分类；保存过的以保存的为准（这里没传分类，即未分类）。
	defaults, err := svc.AdminAgentPets(admin)
	if err != nil {
		t.Fatal(err)
	}
	for _, pet := range defaults {
		if (pet.ID == "didi" && pet.Category != "猫咪") || (pet.ID == "polin" && pet.Category != "") {
			t.Fatalf("category of %s = %q", pet.ID, pet.Category)
		}
	}

	// 按原价确认会被拒绝；按促销价扣费，流水注明活动。
	_, err = svc.PurchaseAgentPet(user, "polin", 10_000_000)
	requireAgentPetStatus(t, err, http.StatusConflict)
	if _, err := svc.repo.AdjustCredits(user.ID, admin.ID, 7_000_000, "测试充值"); err != nil {
		t.Fatal(err)
	}
	result, err := svc.PurchaseAgentPet(user, "polin", 6_000_000)
	if err != nil || !result.Charged || result.AvailableMicrocredits != 1_000_000 {
		t.Fatalf("sale purchase = %+v, %v", result, err)
	}
	entries, _, err := svc.repo.CreditLedger(user.ID, "consume", 10, 0)
	if err != nil || len(entries) != 1 || entries[0].AmountMicrocredits != -6_000_000 || !strings.Contains(entries[0].Note, "限时特惠") {
		t.Fatalf("sale ledger = %+v, %v", entries, err)
	}
	// 限时免费：直接拥有，不扣费、不记流水。
	result, err = svc.PurchaseAgentPet(user, "longbao", 0)
	if err != nil || result.Charged || !result.Pet.Owned || result.AvailableMicrocredits != 1_000_000 {
		t.Fatalf("free promotion = %+v, %v", result, err)
	}
	if _, total, _ := svc.repo.CreditLedger(user.ID, "consume", 10, 0); total != 1 {
		t.Fatalf("free promotion wrote ledger: total=%d", total)
	}

	// 只改上架时原样保留促销；结束促销后恢复原价。
	if pet, err := svc.UpdateAdminAgentPet(admin, "polin", AdminAgentPetInput{Name: "花粉", Enabled: false, Access: "paid", PriceMicrocredits: 10_000_000, PromoEnabled: true, PromoLabel: "限时特惠", PromoPriceMicrocredits: 6_000_000, PromoEndsAt: &inTwoDays}); err != nil || pet.PromoState != "active" || pet.Enabled {
		t.Fatalf("toggle listing kept promotion = %+v, %v", pet, err)
	}
	pet, err := svc.UpdateAdminAgentPet(admin, "polin", AdminAgentPetInput{Name: "花粉", Enabled: true, Access: "paid", PriceMicrocredits: 10_000_000})
	if err != nil || pet.PromoEnabled || pet.PriceMicrocredits != 10_000_000 || pet.Promotion != nil {
		t.Fatalf("ended promotion = %+v, %v", pet, err)
	}
	library, err := svc.AdminAgentPets(admin)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range library {
		if item.ID == "polin" && (item.OwnerCount != 1 || item.RevenueMicrocredits != 6_000_000) {
			t.Fatalf("polin sales = %d / %d", item.OwnerCount, item.RevenueMicrocredits)
		}
		if item.ID == "longbao" && (item.OwnerCount != 1 || item.RevenueMicrocredits != 0) {
			t.Fatalf("longbao sales = %d / %d", item.OwnerCount, item.RevenueMicrocredits)
		}
	}
}

func TestAgentPetBatchOperations(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	user := &model.User{ID: "pet-batch-user", Username: "pet-batch-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BatchUpdateAdminAgentPets(user, AdminAgentPetBatchInput{IDs: []string{"pingo"}, Enabled: ptr(true)}); err == nil {
		t.Fatal("non-admin batch update accepted")
	}
	if _, err := svc.BatchUpdateAdminAgentPets(admin, AdminAgentPetBatchInput{IDs: []string{"pingo"}}); err == nil {
		t.Fatal("empty patch accepted")
	}

	result, err := svc.BatchUpdateAdminAgentPets(admin, AdminAgentPetBatchInput{IDs: []string{"pingo", "polin", "longbao", "ghost", "pingo"}, Enabled: ptr(true), Category: ptr("  精选 ")})
	if err != nil || len(result.Pets) != 3 || len(result.Skipped) != 1 || result.Skipped[0].ID != "ghost" {
		t.Fatalf("batch listing = %+v, %v", result, err)
	}
	for _, pet := range result.Pets {
		if !pet.Enabled || pet.Category != "精选" {
			t.Fatalf("batch pet = %+v", pet)
		}
	}
	// 批量定价，再批量 8 折：免费形象跳过并说明原因。
	price := AdminAgentPetBatchAccess{Mode: "paid", PriceMicrocredits: 5_000_000}
	if _, err := svc.BatchUpdateAdminAgentPets(admin, AdminAgentPetBatchInput{IDs: []string{"polin", "longbao"}, Access: &price, Badge: ptr("新品")}); err != nil {
		t.Fatal(err)
	}
	ends := time.Now().Add(24 * time.Hour)
	result, err = svc.BatchUpdateAdminAgentPets(admin, AdminAgentPetBatchInput{IDs: []string{"pingo", "polin", "longbao"}, Promotion: &AdminAgentPetBatchPromotion{Enabled: true, Percent: 80, Label: "周年庆", EndsAt: &ends}})
	if err != nil || len(result.Pets) != 2 || len(result.Skipped) != 1 || result.Skipped[0].ID != "pingo" {
		t.Fatalf("batch promotion = %+v, %v", result, err)
	}
	catalog, err := svc.AgentPetCatalog(user)
	if err != nil {
		t.Fatal(err)
	}
	if pet := findAgentPetView(t, catalog.Pets, "longbao"); pet.PriceMicrocredits != 4_000_000 || pet.ListPriceMicrocredits != 5_000_000 || pet.Promotion == nil || pet.Promotion.Label != "周年庆" || pet.Badge != "新品" {
		t.Fatalf("discounted pet = %+v", pet)
	}
	// 改成免费时一并结束促销；任一项校验失败整批不保存。
	free := AdminAgentPetBatchAccess{Mode: "free"}
	if result, err = svc.BatchUpdateAdminAgentPets(admin, AdminAgentPetBatchInput{IDs: []string{"longbao"}, Access: &free}); err != nil || result.Pets[0].PromoEnabled || result.Pets[0].Access != "free" {
		t.Fatalf("batch free = %+v, %v", result, err)
	}
	if _, err := svc.BatchUpdateAdminAgentPets(admin, AdminAgentPetBatchInput{IDs: []string{"pingo", "polin"}, Category: ptr(strings.Repeat("类", 13))}); err == nil {
		t.Fatal("over-long category accepted")
	}
	if pet, _ := svc.adminAgentPet("polin"); pet.Category != "精选" || !pet.PromoEnabled {
		t.Fatalf("failed batch changed polin: %+v", pet)
	}

	// 批量删除：只删没人拥有的上传形象。
	keep, err := svc.ImportAgentPet(admin, multipartFileHeader(t, "Keep.png", "image/png", agentPetTestPNG(t, false)))
	if err != nil {
		t.Fatal(err)
	}
	drop, err := svc.ImportAgentPet(admin, multipartFileHeader(t, "Drop.png", "image/png", agentPetTestPNG(t, false)))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.ClaimAgentPet(user.ID, keep.ID); err != nil {
		t.Fatal(err)
	}
	removed, err := svc.BatchDeleteAdminAgentPets(admin, []string{drop.ID, keep.ID, "pingo", "ghost"})
	if err != nil || len(removed.Deleted) != 1 || removed.Deleted[0] != drop.ID || len(removed.Skipped) != 3 {
		t.Fatalf("batch delete = %+v, %v", removed, err)
	}
	if _, err := svc.repo.AgentPet(drop.ID); err == nil {
		t.Fatal("deleted pet still stored")
	}

	// 上传形象可以设置说话风格和台词；内置形象沿用自带的。
	pet, err := svc.UpdateAdminAgentPet(admin, keep.ID, AdminAgentPetInput{Name: "留下", Enabled: true, Access: "free", Tone: "kitty", Lines: []string{"喵，我是你的新伙伴", " "}})
	if err != nil || pet.Tone != "kitty" || len(pet.Lines) != 1 {
		t.Fatalf("upload voice = %+v, %v", pet, err)
	}
	if _, err := svc.UpdateAdminAgentPet(admin, keep.ID, AdminAgentPetInput{Name: "留下", Access: "free", Tone: "dragon"}); err == nil {
		t.Fatal("unknown tone accepted")
	}
	if pet, err := svc.UpdateAdminAgentPet(admin, "pingo", AdminAgentPetInput{Name: "企鹅", Enabled: true, Access: "free", Tone: "robot", Lines: []string{"x"}}); err != nil || pet.Tone != "gentle" || len(pet.Lines) < 2 {
		t.Fatalf("builtin voice = %+v, %v", pet, err)
	}
	if _, err := svc.BatchDeleteAdminAgentPets(admin, nil); err == nil {
		t.Fatal("empty batch delete accepted")
	}
}
