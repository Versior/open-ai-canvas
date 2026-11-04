package app

import (
	"bytes"
	"errors"
	"image/png"
	"net/http"
	"testing"

	"yingce/backend/internal/agentpet"
	"yingce/backend/internal/model"
)

func TestAgentPetPreviewFollowsSheetAccessAndIdleRow(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	user := &model.User{ID: "pet-user", Username: "pet-user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAdminAgentPet(admin, "pingo", AdminAgentPetInput{Name: "企鹅", Enabled: true, Access: agentpet.AccessFree}); err != nil {
		t.Fatal(err)
	}
	preview, err := svc.AgentPetPreview(user, "pingo")
	if err != nil {
		t.Fatal(err)
	}
	frame, err := png.Decode(bytes.NewReader(preview.Data))
	if err != nil || preview.MimeType != "image/png" || frame.Bounds().Dx() != agentpet.CellWidth || frame.Bounds().Dy() != agentpet.CellHeight {
		t.Fatalf("preview = %+v %v", frame.Bounds(), err)
	}
	sheet, err := svc.AgentPetSpritesheet(user, "pingo")
	if err != nil || preview.Revision != sheet.Revision {
		t.Fatalf("preview revision %q, sheet %q, %v", preview.Revision, sheet.Revision, err)
	}
	// 下架的形象和图集一样，只有拥有者和管理员能看缩略图。
	if _, err := svc.AgentPetPreview(user, "vika"); err == nil {
		t.Fatal("non-owner read the preview of an unlisted pet")
	} else {
		requireAgentPetStatus(t, err, http.StatusNotFound)
	}
	if _, err := svc.AgentPetPreview(admin, "vika"); err != nil {
		t.Fatalf("admin preview of an unlisted pet: %v", err)
	}
	if _, err := svc.AgentPetPreview(nil, "pingo"); err == nil {
		t.Fatal("anonymous preview accepted")
	}
	// 待机改用别的动作时，缩略图取那一行，版本号带上动作名，浏览器不会继续用旧图。
	if _, err := svc.UpdateAdminAgentPet(admin, "pingo", AdminAgentPetInput{Name: "企鹅", Enabled: true, Access: agentpet.AccessFree, StateRows: map[string]string{"idle": "waving"}}); err != nil {
		t.Fatal(err)
	}
	waving, err := svc.AgentPetPreview(user, "pingo")
	if err != nil || waving.Revision != sheet.Revision+".waving" {
		t.Fatalf("remapped preview revision = %q, %v", waving.Revision, err)
	}
}

func TestAgentPetPreviewCacheRetriesFailures(t *testing.T) {
	cache := &agentPetPreviewCache{entries: map[string]*agentPetPreviewEntry{}, slots: make(chan struct{}, 1)}
	calls := 0
	failing := func() ([]byte, error) {
		calls++
		return nil, errors.New("disk busy")
	}
	if _, err := cache.get("a", failing); err == nil {
		t.Fatal("error swallowed")
	}
	if _, err := cache.get("a", func() ([]byte, error) { calls++; return []byte("ok"), nil }); err != nil {
		t.Fatal(err)
	}
	if data, _ := cache.get("a", failing); string(data) != "ok" || calls != 2 {
		t.Fatalf("cached data = %q after %d builds", data, calls)
	}
}
