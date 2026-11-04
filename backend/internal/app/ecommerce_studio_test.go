package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func studioProduct(id, name string, extra string) json.RawMessage {
	body := `{"id":"` + id + `","name":"` + name + `"`
	if extra != "" {
		body += "," + extra
	}
	return json.RawMessage(body + "}")
}

func TestEcommerceStudioSaveLoadAndDelete(t *testing.T) {
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	empty, err := s.EcommerceStudio(admin)
	if err != nil || empty.Revision != 0 || len(empty.Products) != 0 {
		t.Fatalf("empty studio: %+v %v", empty, err)
	}
	first, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "保温杯", `"photos":[{"resourceId":"res_photo_1","view":"front"}]`), nil)
	if err != nil || first.Revision != 1 {
		t.Fatalf("first save: %+v %v", first, err)
	}
	if _, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "保温杯 500ml", ""), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveEcommerceStudioProduct(admin, "product_bbb", studioProduct("product_bbb", "帆布包", ""), nil); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.EcommerceStudio(admin)
	if err != nil || loaded.Revision != 3 || len(loaded.Products) != 2 {
		t.Fatalf("loaded: %+v %v", loaded, err)
	}
	if ecommerceStudioProductID(loaded.Products[0]) != "product_aaa" || !strings.Contains(string(loaded.Products[0]), "保温杯 500ml") {
		t.Fatalf("update must replace in place: %s", loaded.Products[0])
	}
	deleted, err := s.DeleteEcommerceStudioProduct(admin, "product_aaa")
	if err != nil || deleted.Revision != 4 {
		t.Fatalf("delete: %+v %v", deleted, err)
	}
	if _, err := s.DeleteEcommerceStudioProduct(admin, "product_aaa"); err != nil {
		t.Fatalf("delete must be idempotent: %v", err)
	}
	loaded, err = s.EcommerceStudio(admin)
	if err != nil || len(loaded.Products) != 1 || ecommerceStudioProductID(loaded.Products[0]) != "product_bbb" {
		t.Fatalf("after delete: %+v %v", loaded, err)
	}
}

func TestEcommerceStudioProductRevisionCompareAndSwap(t *testing.T) {
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	zero, one := int64(0), int64(1)
	created, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "保温杯", `"revision":99`), &zero)
	if err != nil || ecommerceStudioProductRevision(created.Product) != 1 {
		t.Fatalf("create must start at revision 1 and ignore the client value: %+v %v", created, err)
	}
	if _, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "另一个窗口", ""), &zero); err == nil {
		t.Fatal("a second create with revision 0 must conflict instead of overwriting")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Reason != ecommerceStudioConflictReason || appErr.Details["revision"] != int64(1) {
			t.Fatalf("conflict must carry the current revision: %#v", err)
		}
	}
	updated, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "保温杯 500ml", ""), &one)
	if err != nil || ecommerceStudioProductRevision(updated.Product) != 2 {
		t.Fatalf("matching revision must save: %+v %v", updated, err)
	}
	if _, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "过期的写入", ""), &one); err == nil {
		t.Fatal("stale revision must be refused")
	}
	current, err := s.EcommerceStudioProduct(admin, "product_aaa")
	if err != nil || !strings.Contains(string(current.Product), "保温杯 500ml") || ecommerceStudioProductRevision(current.Product) != 2 {
		t.Fatalf("stale writes must not land: %+v %v", current, err)
	}
	if _, err := s.EcommerceStudioProduct(admin, "product_zzz"); err == nil {
		t.Fatal("missing product must be 404")
	}
}

func TestEcommerceStudioRejectsInvalidProducts(t *testing.T) {
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	for name, tc := range map[string]struct {
		id  string
		raw string
	}{
		"short id":      {"abc", `{"id":"abc"}`},
		"path id":       {"../evil", `{"id":"../evil"}`},
		"mismatch":      {"product_aaa", `{"id":"product_bbb"}`},
		"not object":    {"product_aaa", `["product_aaa"]`},
		"inline media":  {"product_aaa", `{"id":"product_aaa","photos":[{"url":"data:image/png;base64,AAAA"}]}`},
		"name too long": {"product_aaa", `{"id":"product_aaa","name":"` + strings.Repeat("长", 121) + `"}`},
	} {
		if _, err := s.SaveEcommerceStudioProduct(admin, tc.id, json.RawMessage(tc.raw), nil); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	studio, err := s.EcommerceStudio(admin)
	if err != nil || studio.Revision != 0 {
		t.Fatalf("rejected saves must not write: %+v %v", studio, err)
	}
}

func TestEcommerceStudioPreservesLegacyLibraryAndProtectsResources(t *testing.T) {
	s, db, _, admin := newAdminStorageDeleteTestService(t)
	legacy := model.EcommerceLibrary{UserID: admin.ID, Revision: 7, PayloadJSON: `{"items":[{"id":"kept-item","resourceId":"res_legacy"}]}`}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	saved, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "台灯", `"photos":[{"resourceId":"res_photo_1"}],"plans":[{"shots":[{"adopted":{"resourceId":"res_output_1"}}]}]`), nil)
	if err != nil || saved.Revision != 8 {
		t.Fatalf("save over legacy row: %+v %v", saved, err)
	}
	var row model.EcommerceLibrary
	if err := db.First(&row, "user_id = ?", admin.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(row.PayloadJSON, `"kept-item"`) || !strings.Contains(row.PayloadJSON, `"studio"`) {
		t.Fatalf("legacy keys lost: %s", row.PayloadJSON)
	}
	candidates := []string{"res_legacy", "res_photo_1", "res_output_1", "res_unused"}
	snapshot, err := s.repo.ResourceReferenceSnapshot(admin.ID, "", candidates)
	if err != nil {
		t.Fatal(err)
	}
	wanted := map[string]struct{}{}
	for _, id := range candidates {
		wanted[id] = struct{}{}
	}
	referenced := map[string]struct{}{}
	for _, document := range snapshot.Documents {
		for id := range documentReferencedResourceIDs(document.PrimaryJSON, wanted) {
			referenced[id] = struct{}{}
		}
	}
	for _, id := range []string{"res_legacy", "res_photo_1", "res_output_1"} {
		if _, ok := referenced[id]; !ok {
			t.Fatalf("%s must stay protected from orphan cleanup: %v", id, referenced)
		}
	}
	if _, ok := referenced["res_unused"]; ok {
		t.Fatal("unreferenced resource reported as referenced")
	}
}

func TestEcommerceStudioRefusesUnreadableLegacyPayload(t *testing.T) {
	s, db, _, admin := newAdminStorageDeleteTestService(t)
	if err := db.Create(&model.EcommerceLibrary{UserID: admin.ID, Revision: 2, PayloadJSON: `["unexpected"]`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "杯子", ""), nil); err == nil {
		t.Fatal("unreadable payload must not be overwritten")
	}
	var row model.EcommerceLibrary
	if err := db.First(&row, "user_id = ?", admin.ID).Error; err != nil || row.PayloadJSON != `["unexpected"]` || row.Revision != 2 {
		t.Fatalf("payload changed: %+v %v", row, err)
	}
}

func TestEcommerceDossierCapabilityBackfillsStoredSettings(t *testing.T) {
	s, db, _, admin := newAdminStorageDeleteTestService(t)
	legacy := defaultEcommerceSetting()
	delete(legacy.Capabilities, "dossier")
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{ecommerceSettingKey, ecommerceSettingKey + "_previous"} {
		if err := db.Create(&model.SystemSetting{Key: key, ValueJSON: string(encoded)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	_, current, err := s.readEcommerceSetting()
	if err != nil || !current.Capabilities["dossier"].Enabled {
		t.Fatalf("stored setting without dossier must stay readable: %v", err)
	}
	if _, err := s.PreviousEcommerceSetting(admin); err != nil {
		t.Fatalf("previous setting without dossier: %v", err)
	}
	for _, references := range s.ecommerceResourceReferences([]string{"res_any"}) {
		for _, reference := range references {
			if strings.Contains(reference.Title, "无法读取") {
				t.Fatal("older settings must not freeze resource deletion")
			}
		}
	}
	if _, err := s.UpdateEcommerceSetting(admin, current); err != nil {
		t.Fatalf("admin save over older previous setting: %v", err)
	}
	input := canvasGenerationInput{Mode: "text", Prompt: "识别商品", Metadata: map[string]interface{}{"ecommerceCapability": "dossier", "ecommerceAnalysisFlow": "cap:dossier"}}
	if err := s.applyEcommerceAnalysisInstruction(&input); err != nil {
		t.Fatal(err)
	}
	if input.Config.SystemPrompt != defaultEcommerceCapabilityPrompt("dossier") || !strings.Contains(input.Config.SystemPrompt, "图片可见") {
		t.Fatal("dossier director prompt not applied")
	}
	image := canvasGenerationInput{Mode: "image", Metadata: map[string]interface{}{"ecommerceCapability": "dossier"}}
	if s.validateEcommerceCapability(&image) == nil {
		t.Fatal("dossier is a text-only capability")
	}
}
