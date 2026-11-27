package app

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestStudioArtworkDoesNotChangeSearchableKnowledge(t *testing.T) {
	for _, entry := range kb20DesignPlanningKnowledge() {
		if strings.Contains(entry.ContentJSON, "artworkGuidance") {
			t.Fatalf("studio artwork entered the agent ranking input for %s", entry.ID)
		}
		switch entry.ID {
		case kb20FoodLightingID:
			if entry.TagsJSON != `["食品","零食","肉","糕点","饮料","咖啡","茶","汤","面"]` {
				t.Fatal("the studio lighting matcher changed agent food keywords")
			}
		case "kb20-light-fabric":
			if entry.TagsJSON != `["棉","面料","针织","毛","绒","皮革","布","丝","麻"]` {
				t.Fatal("the studio lighting matcher changed agent fabric keywords")
			}
		}
	}
}

func TestStudioArtworkUpgradePreservesReviewedKnowledge(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	versions := map[string]string{
		"kb20-light-fabric": "kb20-v10-20261126", kb20FoodLightingID: "kb20-v11-20261126", kb20MainID: "kb20-v11-20261126",
		"kb20-single-hero": "kb20-v11-20261126", kb20CopyID: "kb20-v12-20261126", kb20LayoutID: "kb20-v12-20261126",
	}
	previous := shippedWith(t, func(entries []model.EcommerceKnowledgeEntry) []model.EcommerceKnowledgeEntry {
		for index := range entries {
			entry := &entries[index]
			if entry.KnowledgeDomain != ecommerceKB20Domain {
				continue
			}
			entry.Version = "kb20-v9-20261111"
			if version, ok := versions[entry.ID]; ok {
				entry.Version = version
			}
			if artwork := studioArtworkMethods[entry.ID]; artwork != "" {
				var content map[string]string
				if err := json.Unmarshal([]byte(entry.ContentJSON), &content); err != nil {
					t.Fatal(err)
				}
				content["artworkGuidance"] = artwork
				raw, err := json.Marshal(content)
				if err != nil {
					t.Fatal(err)
				}
				entry.ContentJSON = string(raw)
			}
			if keywords := studioLightingKeywords[entry.ID]; len(keywords) > 0 {
				raw, err := json.Marshal(keywords)
				if err != nil {
					t.Fatal(err)
				}
				entry.TagsJSON = string(raw)
			}
		}
		return entries
	})
	if _, err := svc.ensureBuiltinEcommerceKnowledge(previous); err != nil {
		t.Fatal(err)
	}
	const custom = "使用管理员定稿。"
	const stale = "不要沿用的旧出图摘要。"
	edit := func(id, field string, value any) {
		t.Helper()
		if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", id).Update(field, value).Error; err != nil {
			t.Fatal(err)
		}
	}
	edit(kb20CopyID, "content_json", `{"guidance":"`+custom+`","artworkGuidance":"`+stale+`"}`)
	edit(kb20LayoutID, "review_status", "rejected")
	edit(kb20MainID, "valid_until", time.Now().UTC().Add(-time.Hour))
	poster := previous[indexOfEntry(t, previous, "kb20-single-hero")]
	var posterContent map[string]string
	if err := json.Unmarshal([]byte(poster.ContentJSON), &posterContent); err != nil {
		t.Fatal(err)
	}
	posterContent["artworkGuidance"] = custom
	raw, err := json.Marshal(posterContent)
	if err != nil {
		t.Fatal(err)
	}
	edit(poster.ID, "content_json", string(raw))

	report, err := svc.EnsureBuiltinEcommerceKnowledge()
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Updated) != 4 || len(report.PreservedLocal) != 2 || !slices.Contains(report.PreservedLocal, kb20CopyID) || !slices.Contains(report.PreservedLocal, poster.ID) {
		t.Fatalf("unexpected upgrade: updated=%v preserved=%v", report.Updated, report.PreservedLocal)
	}
	ids := []string{kb20CopyID, kb20LayoutID, kb20MainID, kb20FoodLightingID, poster.ID}
	methods := svc.ecommerceStudioDesignEntries(ids)
	if len(methods) != 3 || methods[kb20FoodLightingID].artwork != studioArtworkMethods[kb20FoodLightingID] || methods[kb20CopyID].artwork != custom || methods[poster.ID].artwork != custom {
		t.Fatal("artwork ignored admin edits or approval")
	}
	food, err := svc.repo.EcommerceKnowledgeEntryByID(kb20FoodLightingID)
	if err != nil || food.Version != ecommerceKB20Version || strings.Contains(food.ContentJSON, "artworkGuidance") {
		t.Fatal("pristine v11 food kept studio-only search data")
	}
	if err := db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", food.SourceID).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	repeat, err := svc.EnsureBuiltinEcommerceKnowledge()
	if err != nil || len(repeat.Updated) != 0 || len(svc.ecommerceStudioDesignEntries(ids)) != 0 {
		t.Fatal("repeated bootstrap rewrote the data or bypassed the disabled source")
	}
}
