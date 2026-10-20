package app

import (
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestEcommerceBuiltinCatalog(t *testing.T) {
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	page, err := s.EcommerceCatalog(admin, "", 1, 20)
	if err != nil || page.Total != 1173 || len(page.Items) != 20 {
		t.Fatalf("catalog: %v %+v", err, page)
	}
	next, err := s.EcommerceCatalog(admin, "", 2, 20)
	if err != nil || next.Items[0].ID == page.Items[0].ID {
		t.Fatal("pagination failed")
	}
	matches, err := s.EcommerceCatalog(admin, page.Items[0].Name, 1, 20)
	if err != nil || matches.Total < 1 {
		t.Fatal("name search failed")
	}
	docs, err := loadEcommerceCatalog()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, doc := range docs {
		if seen[doc.ID] {
			t.Fatal("duplicate template")
		}
		seen[doc.ID] = true
		template, err := s.EcommerceCatalogTemplate(admin, doc.ID)
		if err != nil || template.Style != doc.Style.Text || !strings.Contains(template.Shots[0].Duty, doc.Shots[0].Prompt) {
			t.Fatal("template content lost")
		}
		setting := defaultEcommerceSetting()
		setting.Templates = []EcommerceSuiteTemplate{*template}
		if err := validateEcommerceSetting(setting); err != nil {
			t.Fatalf("template %s is not editable: %v", doc.ID, err)
		}
	}
	if _, err := s.EcommerceCatalogTemplate(admin, "missing"); err == nil {
		t.Fatal("missing template accepted")
	}
	if _, err := s.EcommerceCatalog(nil, "", 1, 20); err == nil {
		t.Fatal("anonymous read accepted")
	}
	if _, err := s.EcommerceCatalog(admin, "", 0, 20); err == nil {
		t.Fatal("invalid page accepted")
	}
	user := &model.User{ID: "ordinary", Role: model.UserRoleUser}
	if _, err := s.EcommerceCatalog(user, "", 1, 20); err != nil {
		t.Fatal(err)
	}
	setting := defaultEcommerceSetting()
	setting.Enabled = false
	if _, err := s.UpdateEcommerceSetting(admin, setting); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EcommerceCatalog(user, "", 1, 20); err == nil {
		t.Fatal("disabled catalog accepted")
	}
	if _, err := s.EcommerceCatalogTemplate(user, page.Items[0].ID); err == nil {
		t.Fatal("disabled template accepted")
	}
	if _, err := s.EcommerceCatalog(admin, "", 1, 20); err != nil {
		t.Fatal("admin cannot manage disabled catalog")
	}
}
