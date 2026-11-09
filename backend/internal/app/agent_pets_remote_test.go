package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"yingce/backend/internal/model"
)

func TestAgentPetRemoteImportValidatesContentAndDeduplicates(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	data := agentPetTestPNG(t, false)
	hash := sha256.Sum256(data)
	item := AgentPetManifestItem{Name: "远端宠物", URL: "https://raw.githubusercontent.com/Versior/agent-pet-library/main/sprites/test.png", SHA256: hex.EncodeToString(hash[:])}
	downloads := 0
	download := func(context.Context, string, int64) ([]byte, error) { downloads++; return data, nil }
	skipped, err := svc.importRemoteAgentPet(context.Background(), admin, item, download)
	if err != nil || skipped {
		t.Fatalf("first import skipped=%v err=%v", skipped, err)
	}
	rows, err := svc.repo.AgentPets()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if len(row.ID) > 64 {
			t.Fatal("remote ID exceeds PostgreSQL column")
		}
	}
	skipped, err = svc.importRemoteAgentPet(context.Background(), admin, item, download)
	if err != nil || !skipped || downloads != 1 {
		t.Fatalf("repeat skipped=%v downloads=%d err=%v", skipped, downloads, err)
	}
	item.SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err = svc.importRemoteAgentPet(context.Background(), admin, item, download); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	item.SHA256 = "invalid"
	if _, err = svc.importRemoteAgentPet(context.Background(), admin, item, download); err == nil {
		t.Fatal("invalid digest accepted")
	}
	if _, err = svc.StartAgentPetRemoteImport(&model.User{ID: "user", Role: model.UserRoleUser}, AgentPetRemoteInput{}); err == nil {
		t.Fatal("non-admin started sync")
	}
	for _, url := range []string{"http://example.com/manifest.json", "https://127.0.0.1/manifest.json", "https://example.com/manifest.json?key=YOUR_FAKE_KEY", "https://fake-user@example.com/manifest.json"} {
		if _, err := svc.StartAgentPetRemoteImport(admin, AgentPetRemoteInput{ManifestURL: url}); err == nil {
			t.Fatalf("unsafe source accepted")
		}
	}
}
