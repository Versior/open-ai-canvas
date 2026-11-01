package app

import (
	"archive/zip"
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func agentPetTestPNG(t *testing.T, opaque bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 1536, 2288))
	if opaque {
		for y := 0; y < img.Bounds().Dy(); y++ {
			for x := 0; x < img.Bounds().Dx(); x++ {
				img.SetNRGBA(x, y, color.NRGBA{R: 200, A: 255})
			}
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func agentPetTestZIP(t *testing.T, name string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for file, data := range map[string][]byte{
		"pet/pet.json":        []byte(`{"id":"fox","displayName":"` + name + `","description":"导入测试","spriteVersionNumber":2,"spritesheetPath":"spritesheet.png"}`),
		"pet/spritesheet.png": agentPetTestPNG(t, false),
	} {
		part, err := writer.Create(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func requireAgentPetStatus(t *testing.T, err error, status int) *AppError {
	t.Helper()
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != status {
		t.Fatalf("error = %v, want HTTP %d", err, status)
	}
	return appErr
}

func findAgentPetView(t *testing.T, pets []AgentPetView, id string) AgentPetView {
	t.Helper()
	for _, pet := range pets {
		if pet.ID == id {
			return pet
		}
	}
	t.Fatalf("pet %s not listed", id)
	return AgentPetView{}
}

func TestAgentPetCatalogAccessSelectionAndPurchase(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	user := &model.User{ID: "pet-user", Username: "pet-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	vipUser := &model.User{ID: "pet-vip", Username: "pet-vip", Role: model.UserRoleUser, Status: model.UserStatusActive, UserGroup: "vip"}
	for _, row := range []any{user, vipUser, &model.UserGroup{ID: "group-vip", Code: "vip", Name: "VIP", BadgeStyle: model.UserGroupBadgeVIP, RatioBasisPoints: 10000}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}

	library, err := svc.AdminAgentPets(admin)
	if err != nil || len(library) < 10 {
		t.Fatalf("admin library = %d, %v", len(library), err)
	}
	for _, pet := range library {
		if pet.Enabled || pet.Source != agentPetSourceBuiltin {
			t.Fatalf("builtin pet %s should start unlisted: %+v", pet.ID, pet)
		}
	}
	if catalog, err := svc.AgentPetCatalog(user); err != nil || len(catalog.Pets) != 0 || catalog.SelectedPetID != "" {
		t.Fatalf("initial catalog = %+v, %v", catalog, err)
	}
	if _, err := svc.UpdateAdminAgentPet(user, "pingo", AdminAgentPetInput{Name: "x", Access: "free"}); err == nil {
		t.Fatal("non-admin updated the pet library")
	}
	save := func(id string, input AdminAgentPetInput) {
		t.Helper()
		if _, err := svc.UpdateAdminAgentPet(admin, id, input); err != nil {
			t.Fatalf("save %s: %v", id, err)
		}
	}
	save("pingo", AdminAgentPetInput{Name: "企鹅", Enabled: true, Access: "free", SortOrder: 1})
	save("polin", AdminAgentPetInput{Name: "花粉", Enabled: true, Access: "paid", PriceMicrocredits: 5_000_000, GroupCodes: []string{"vip"}, SortOrder: 2})
	save("rupet", AdminAgentPetInput{Name: "机器人", Enabled: true, Access: "vip", GroupCodes: []string{"VIP"}, StateRows: map[string]string{"running": "review"}, SortOrder: 3})
	for name, input := range map[string]AdminAgentPetInput{
		"empty name":    {Name: " ", Access: "free"},
		"unknown group": {Name: "x", Access: "vip", GroupCodes: []string{"ghost"}},
		"bad row":       {Name: "x", Access: "free", StateRows: map[string]string{"running": "dance"}},
		"free price":    {Name: "x", Access: "paid"},
	} {
		if _, err := svc.UpdateAdminAgentPet(admin, "pingo", input); err == nil {
			t.Errorf("%s accepted", name)
		}
	}

	catalog, err := svc.AgentPetCatalog(user)
	if err != nil || len(catalog.Pets) != 3 || catalog.Pets[0].ID != "pingo" || !catalog.CreditsEnabled {
		t.Fatalf("user catalog = %+v, %v", catalog, err)
	}
	if pet := findAgentPetView(t, catalog.Pets, "pingo"); !pet.Usable || pet.Name != "企鹅" || pet.Revision == "" || pet.SpriteVersion != 2 {
		t.Fatalf("free pet = %+v", pet)
	}
	if pet := findAgentPetView(t, catalog.Pets, "polin"); pet.Usable || !pet.Purchasable || pet.PriceMicrocredits != 5_000_000 {
		t.Fatalf("paid pet = %+v", pet)
	}
	if pet := findAgentPetView(t, catalog.Pets, "rupet"); pet.Usable || pet.Purchasable || pet.StateRows["running"] != "review" {
		t.Fatalf("vip pet = %+v", pet)
	}

	_, err = svc.SelectAgentPet(user, "polin")
	requireAgentPetStatus(t, err, http.StatusForbidden)
	_, err = svc.SelectAgentPet(user, "rupet")
	requireAgentPetStatus(t, err, http.StatusForbidden)
	_, err = svc.SelectAgentPet(user, "vika")
	requireAgentPetStatus(t, err, http.StatusNotFound)
	if pet, err := svc.SelectAgentPet(user, "pingo"); err != nil || pet.ID != "pingo" {
		t.Fatalf("select free pet = %+v, %v", pet, err)
	}
	if pet, err := svc.AgentPetSelection(user); err != nil || pet == nil || pet.ID != "pingo" {
		t.Fatalf("selection = %+v, %v", pet, err)
	}

	_, err = svc.PurchaseAgentPet(user, "polin", 1)
	requireAgentPetStatus(t, err, http.StatusConflict)
	_, err = svc.PurchaseAgentPet(user, "polin", 5_000_000)
	if appErr := requireAgentPetStatus(t, err, http.StatusBadRequest); appErr.Reason != kernel.ReasonFailedPrecondition {
		t.Fatalf("insufficient credits reason = %q", appErr.Reason)
	}
	if _, err := svc.repo.AdjustCredits(user.ID, admin.ID, 12_000_000, "测试充值"); err != nil {
		t.Fatal(err)
	}
	result, err := svc.PurchaseAgentPet(user, "polin", 5_000_000)
	if err != nil || !result.Charged || result.AvailableMicrocredits != 7_000_000 || !result.Pet.Owned || !result.Pet.Usable {
		t.Fatalf("purchase = %+v, %v", result, err)
	}
	result, err = svc.PurchaseAgentPet(user, "polin", 5_000_000)
	if err != nil || result.Charged || result.AvailableMicrocredits != 7_000_000 {
		t.Fatalf("repeat purchase = %+v, %v", result, err)
	}
	entries, total, err := svc.repo.CreditLedger(user.ID, "consume", 10, 0)
	if err != nil || total != 1 || entries[0].Type != model.CreditLedgerAgentPetPurchase || entries[0].AmountMicrocredits != -5_000_000 || entries[0].AvailableAfterMicrocredits != 7_000_000 {
		t.Fatalf("purchase ledger = %+v total=%d err=%v", entries, total, err)
	}
	_, err = svc.PurchaseAgentPet(user, "rupet", 0)
	requireAgentPetStatus(t, err, http.StatusForbidden)
	_, err = svc.PurchaseAgentPet(user, "pingo", 0)
	requireAgentPetStatus(t, err, http.StatusBadRequest)

	vipCatalog, err := svc.AgentPetCatalog(vipUser)
	if err != nil {
		t.Fatal(err)
	}
	if pet := findAgentPetView(t, vipCatalog.Pets, "polin"); !pet.Usable || !pet.MemberFree || pet.Purchasable {
		t.Fatalf("member pet = %+v", pet)
	}
	if pet := findAgentPetView(t, vipCatalog.Pets, "rupet"); !pet.Usable {
		t.Fatalf("vip member pet = %+v", pet)
	}
	_, err = svc.PurchaseAgentPet(vipUser, "polin", 5_000_000)
	requireAgentPetStatus(t, err, http.StatusBadRequest)

	// 下架后：已购用户仍可使用和读取图集，未购买的用户看不到。
	save("polin", AdminAgentPetInput{Name: "花粉", Enabled: false, Access: "paid", PriceMicrocredits: 5_000_000, GroupCodes: []string{"vip"}, SortOrder: 2})
	if pet, err := svc.SelectAgentPet(user, "polin"); err != nil || pet.ID != "polin" {
		t.Fatalf("owner selects delisted pet = %+v, %v", pet, err)
	}
	if sheet, err := svc.AgentPetSpritesheet(user, "polin"); err != nil || sheet.MimeType != "image/webp" || len(sheet.Data) == 0 || sheet.Revision == "" {
		t.Fatalf("owner sheet = %+v, %v", sheet, err)
	}
	vipCatalog, err = svc.AgentPetCatalog(vipUser)
	if err != nil {
		t.Fatal(err)
	}
	for _, pet := range vipCatalog.Pets {
		if pet.ID == "polin" {
			t.Fatal("delisted pet visible to a non-owner")
		}
	}
	_, err = svc.AgentPetSpritesheet(vipUser, "polin")
	requireAgentPetStatus(t, err, http.StatusNotFound)
	if _, err := svc.AgentPetSpritesheet(admin, "polin"); err != nil {
		t.Fatalf("admin preview of delisted pet: %v", err)
	}
	if _, err := svc.AgentPetSpritesheet(nil, "pingo"); err == nil {
		t.Fatal("anonymous sheet access allowed")
	}

	// 失去分组资格后，选择按默认形象处理。
	if _, err := svc.SelectAgentPet(vipUser, "rupet"); err != nil {
		t.Fatal(err)
	}
	downgraded := *vipUser
	downgraded.UserGroup = ""
	if pet, err := svc.AgentPetSelection(&downgraded); err != nil || pet != nil {
		t.Fatalf("selection after losing VIP = %+v, %v", pet, err)
	}
	if pet, err := svc.SelectAgentPet(user, ""); err != nil || pet != nil {
		t.Fatalf("reset selection = %+v, %v", pet, err)
	}
	if pet, err := svc.AgentPetSelection(user); err != nil || pet != nil {
		t.Fatalf("selection after reset = %+v, %v", pet, err)
	}
}

func TestAgentPetImportReferencesAndDelete(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	user := &model.User{ID: "pet-buyer", Username: "pet-buyer", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportAgentPet(user, multipartFileHeader(t, "fox.zip", "application/zip", agentPetTestZIP(t, "Fox"))); err == nil {
		t.Fatal("non-admin imported a pet")
	}
	if _, err := svc.ImportAgentPet(admin, multipartFileHeader(t, "flat.png", "image/png", agentPetTestPNG(t, true))); err == nil {
		t.Fatal("opaque sheet imported")
	}
	imported, err := svc.ImportAgentPet(admin, multipartFileHeader(t, "fox.zip", "application/zip", agentPetTestZIP(t, "Pixel Fox")))
	if err != nil || imported.Source != agentPetSourceUpload || imported.Enabled || imported.SpriteVersion != 2 || imported.Name != "Pixel Fox" || imported.Description != "导入测试" {
		t.Fatalf("import = %+v, %v", imported, err)
	}
	stored, err := svc.repo.AgentPet(imported.ID)
	if err != nil {
		t.Fatal(err)
	}
	resource, err := svc.repo.Resource(stored.ResourceID)
	if err != nil || resource.Kind != agentPetResourceKind || resource.Provider != "local" || resource.MimeType != "image/png" {
		t.Fatalf("resource = %+v, %v", resource, err)
	}
	if references := svc.agentPetResourceReferences([]string{resource.ID}); len(references[resource.ID]) != 1 {
		t.Fatalf("references = %+v", references)
	}
	_, err = svc.AgentPetSpritesheet(user, imported.ID)
	requireAgentPetStatus(t, err, http.StatusNotFound)
	if sheet, err := svc.AgentPetSpritesheet(admin, imported.ID); err != nil || sheet.MimeType != "image/png" || !bytes.Equal(sheet.Data, agentPetTestPNG(t, false)) {
		t.Fatalf("admin preview = %v", err)
	}

	if _, err := svc.UpdateAdminAgentPet(admin, imported.ID, AdminAgentPetInput{Name: "像素狐", Enabled: true, Access: "paid", PriceMicrocredits: 1_000_000}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.AdjustCredits(user.ID, admin.ID, 1_000_000, "测试充值"); err != nil {
		t.Fatal(err)
	}
	if result, err := svc.PurchaseAgentPet(user, imported.ID, 1_000_000); err != nil || !result.Charged || result.AvailableMicrocredits != 0 {
		t.Fatalf("purchase uploaded pet = %+v, %v", result, err)
	}
	err = svc.DeleteAdminAgentPet(admin, imported.ID)
	requireAgentPetStatus(t, err, http.StatusConflict)
	library, err := svc.AdminAgentPets(admin)
	if err != nil {
		t.Fatal(err)
	}
	for _, pet := range library {
		if pet.ID == imported.ID && pet.OwnerCount != 1 {
			t.Fatalf("owner count = %d", pet.OwnerCount)
		}
	}

	spare, err := svc.ImportAgentPet(admin, multipartFileHeader(t, "Lucky Cat.png", "image/png", agentPetTestPNG(t, false)))
	if err != nil || spare.Name != "Lucky Cat" {
		t.Fatalf("plain sheet import = %+v, %v", spare, err)
	}
	spareRow, err := svc.repo.AgentPet(spare.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteAdminAgentPet(admin, spare.ID); err != nil {
		t.Fatal(err)
	}
	if references := svc.agentPetResourceReferences([]string{spareRow.ResourceID}); len(references) != 0 {
		t.Fatalf("deleted pet still references its sheet: %+v", references)
	}
	err = svc.DeleteAdminAgentPet(admin, "pingo")
	requireAgentPetStatus(t, err, http.StatusBadRequest)
	err = svc.DeleteAdminAgentPet(admin, "missing")
	requireAgentPetStatus(t, err, http.StatusNotFound)
}
