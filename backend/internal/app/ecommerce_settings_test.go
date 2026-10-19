package app

import (
	"encoding/json"
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestEcommerceSettingsPermissionsAndValidation(t *testing.T) {
	s := &Service{}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := s.EcommerceSetting(nil); err == nil {
		t.Fatal("anonymous settings accepted")
	}
	if _, err := s.AdminEcommerceSetting(user); err == nil {
		t.Fatal("non-admin read accepted")
	}
	if _, err := s.UpdateEcommerceSetting(user, defaultEcommerceSetting()); err == nil {
		t.Fatal("non-admin write accepted")
	}
	if _, err := s.PreviousEcommerceSetting(user); err == nil {
		t.Fatal("non-admin rollback accepted")
	}
	if _, err := s.UploadEcommerceModelImage(user, nil); err == nil {
		t.Fatal("non-admin upload accepted")
	}
	for _, mutate := range []func(*EcommerceSetting){
		func(v *EcommerceSetting) { delete(v.Flows, "detail") },
		func(v *EcommerceSetting) { v.Models = nil },
		func(v *EcommerceSetting) {
			v.Flows["detail"] = EcommerceFlowSetting{DirectorPrompt: strings.Repeat("字", 20001)}
		},
		func(v *EcommerceSetting) {
			v.Models = []EcommercePublicModel{{ID: "model", Name: "Test", Enabled: true, Tags: []string{}, ResourceIDs: []string{}}}
		},
		func(v *EcommerceSetting) {
			item := EcommercePublicModel{ID: "same", Name: "Test", Tags: []string{}, ResourceIDs: []string{}}
			v.Models = []EcommercePublicModel{item, item}
		},
	} {
		value := defaultEcommerceSetting()
		mutate(&value)
		if validateEcommerceSetting(value) == nil {
			t.Fatal("invalid setting accepted")
		}
	}
}

func TestEcommerceSettingsPublishRollbackAndProtectImages(t *testing.T) {
	s, db, _, admin := newAdminStorageDeleteTestService(t)
	initial, err := s.AdminEcommerceSetting(admin)
	if err != nil || !initial.Enabled || len(initial.Flows) != 4 || initial.Models == nil {
		t.Fatalf("default: %+v %v", initial, err)
	}
	resource, err := s.UploadEcommerceModelImage(admin, contentUploadHeader(t, mediaTestPNG(t)))
	if err != nil {
		t.Fatal(err)
	}
	value := *initial
	value.Models = []EcommercePublicModel{{ID: "public", Name: "Test model", Enabled: true, Tags: []string{"studio"}, ResourceIDs: []string{resource.ID}}}
	published, err := s.UpdateEcommerceSetting(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateEcommerceSetting(admin, value); err == nil {
		t.Fatal("stale revision accepted")
	}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	public, err := s.EcommerceSetting(user)
	if err != nil || len(public.Models) != 1 {
		t.Fatalf("public models: %+v %v", public, err)
	}
	delivery, err := s.PrepareEcommerceModelDelivery(user, "public", resource.ID, ResourceAccessOptions{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Stream != nil && delivery.Stream.Body != nil {
		delivery.Stream.Body.Close()
	}
	if _, err := s.PrepareEcommerceModelDelivery(user, "other", resource.ID, ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("unpublished model accessible")
	}
	blocked, err := s.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{resource.ID}})
	if err != nil || len(blocked.Blocked) != 1 || len(blocked.Deleted) != 0 {
		t.Fatalf("current reference: %+v %v", blocked, err)
	}
	removed := *published
	removed.Models = []EcommercePublicModel{}
	current, err := s.UpdateEcommerceSetting(admin, removed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PrepareEcommerceModelDelivery(user, "public", resource.ID, ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("removed model accessible")
	}
	refs := s.ecommerceResourceReferences([]string{resource.ID})
	if len(refs[resource.ID]) != 1 || refs[resource.ID][0].ID != ecommerceSettingKey+"_previous" {
		t.Fatalf("rollback reference: %+v", refs)
	}
	if err := s.cleanupDetachedUserResources(admin.ID, []model.Resource{*resource}); err != nil {
		t.Fatal(err)
	}
	assertModelCount(t, db, &model.Resource{}, "id = ?", 1, resource.ID)
	previous, err := s.PreviousEcommerceSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	previous.Revision = current.Revision
	secondAdmin := &model.User{ID: "admin-two", Role: model.UserRoleAdmin}
	restored, err := s.UpdateEcommerceSetting(secondAdmin, *previous)
	if err != nil || len(restored.Models) != 1 {
		t.Fatalf("restore by another admin: %+v %v", restored, err)
	}
	restored.Models[0].Enabled = false
	if _, err := s.UpdateEcommerceSetting(secondAdmin, *restored); err != nil {
		t.Fatal(err)
	}
	public, err = s.EcommerceSetting(user)
	if err != nil || len(public.Models) != 0 {
		t.Fatalf("disabled filter: %+v %v", public, err)
	}
	if _, err := s.PrepareEcommerceModelDelivery(user, "public", resource.ID, ResourceAccessOptions{}, ""); err == nil {
		t.Fatal("disabled image accessible")
	}
}

func TestEcommerceRejectsForeignImagesAndMalformedUpload(t *testing.T) {
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	other := &model.User{ID: "other-admin", Role: model.UserRoleAdmin}
	resource, err := s.UploadEcommerceModelImage(other, contentUploadHeader(t, mediaTestPNG(t)))
	if err != nil {
		t.Fatal(err)
	}
	value := defaultEcommerceSetting()
	value.Models = []EcommercePublicModel{{ID: "foreign", Name: "Foreign", Tags: []string{}, ResourceIDs: []string{resource.ID}}}
	if _, err := s.UpdateEcommerceSetting(admin, value); err == nil {
		t.Fatal("foreign unpublished image accepted")
	}
	if _, err := s.UploadEcommerceModelImage(admin, contentUploadHeader(t, []byte("<html>not an image</html>"))); err == nil {
		t.Fatal("spoofed image accepted")
	}
	header := contentUploadHeader(t, mediaTestPNG(t))
	header.Size = 11 << 20
	if _, err := s.UploadEcommerceModelImage(admin, header); err == nil {
		t.Fatal("oversized upload accepted")
	}
}

func TestEcommerceInvalidConfigurationBlocksDeletion(t *testing.T) {
	s, _, _, _ := newAdminStorageDeleteTestService(t)
	value := defaultEcommerceSetting()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceSettingKey + "_previous", ValueJSON: "broken"}); err != nil {
		t.Fatal(err)
	}
	if len(s.ecommerceResourceReferences([]string{"any-image"})["any-image"]) == 0 {
		t.Fatal("malformed rollback allowed deletion")
	}
}

func TestEcommerceAuditFailureRollsBackConfiguration(t *testing.T) {
	s, db, _, admin := newAdminStorageDeleteTestService(t)
	original, err := s.UpdateEcommerceSetting(admin, defaultEcommerceSetting())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TRIGGER fail_ecommerce_audit BEFORE INSERT ON admin_audit_events WHEN NEW.action = 'ecommerce_canvas.update' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;").Error; err != nil {
		t.Fatal(err)
	}
	changed := *original
	changed.Enabled = false
	if _, err := s.UpdateEcommerceSetting(admin, changed); err == nil {
		t.Fatal("audit failure accepted")
	}
	actual, err := s.AdminEcommerceSetting(admin)
	if err != nil || !actual.Enabled || actual.Revision != original.Revision {
		t.Fatalf("configuration changed after failed audit: %+v %v", actual, err)
	}
	previous, err := s.PreviousEcommerceSetting(admin)
	if err != nil || previous.Revision != "initial" {
		t.Fatalf("rollback changed after failed audit: %+v %v", previous, err)
	}
}
