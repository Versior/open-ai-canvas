package database

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestEcommerceCanvasKindRepairIsScopedAndIdempotent(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:canvas-kind-repair?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ id, raw, want string }{
		{"shop", `{"nodes":[{"type":"product","metadata":{"content":"preserved"}}],"connections":[{"id":"edge"}]}`, "ecommerce"},
		{"studio", `{"nodes":[{"type":"ecommerce-studio"}]}`, "ecommerce"},
		{"free", `{"kind":"freeform","nodes":[{"type":"product"}]}`, "freeform"},
		{"named-shop-only", `{"title":"电商创作 99","nodes":[]}`, ""},
		{"image", `{"nodes":[{"type":"image"}]}`, ""},
		{"already-shop", `{"kind":"ecommerce","nodes":[]}`, "ecommerce"},
	}
	for _, item := range cases {
		if err := db.Create(&model.CanvasProject{ID: item.id, UserID: "owner", Revision: 3, PayloadJSON: item.raw}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := migrateEcommerceCanvasKind(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range cases {
		var saved model.CanvasProject
		if err := db.First(&saved, "id = ?", item.id).Error; err != nil {
			t.Fatal(err)
		}
		var actual, original map[string]json.RawMessage
		if err := json.Unmarshal([]byte(saved.PayloadJSON), &actual); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(item.raw), &original); err != nil {
			t.Fatal(err)
		}
		var kind string
		_ = json.Unmarshal(actual["kind"], &kind)
		if kind != item.want {
			t.Fatalf("%s kind = %q", item.id, kind)
		}
		expectedRevision := int64(3)
		if item.id == "shop" || item.id == "studio" {
			expectedRevision++
		}
		if saved.Revision != expectedRevision {
			t.Fatalf("%s revision = %d", item.id, saved.Revision)
		}
		delete(actual, "kind")
		delete(original, "kind")
		a, _ := json.Marshal(actual)
		b, _ := json.Marshal(original)
		if string(a) != string(b) {
			t.Fatalf("%s content changed", item.id)
		}
	}
}
