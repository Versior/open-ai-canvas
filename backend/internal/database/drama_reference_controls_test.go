package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestMigrateDramaReferenceControls(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:drama-reference-controls?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, statement := range []string{
		"CREATE TABLE drama_casts (id text PRIMARY KEY, appearance text)",
		"CREATE TABLE drama_segments (id text PRIMARY KEY, reference_cast_ids_json text)",
		"INSERT INTO drama_casts (id, appearance) VALUES ('hero', '白衣')",
		"INSERT INTO drama_segments (id, reference_cast_ids_json) VALUES ('segment', '[]')",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	found := false
	for _, migration := range schemaMigrations {
		if migration.name == "drama_reference_controls" {
			found = true
			if migration.version != 98 {
				t.Fatalf("reference controls migration version = %d, want 98", migration.version)
			}
			if err := migration.apply(db); err != nil {
				t.Fatal(err)
			}
			if err := migration.apply(db); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !found {
		t.Fatal("reference controls migration is not registered")
	}
	for _, target := range []struct {
		entity any
		field  string
	}{
		{&model.DramaCast{}, "ImagePrompt"},
		{&model.DramaSegment{}, "ReferenceImagesJSON"},
		{&model.DramaSegment{}, "AudioCastIDsJSON"},
	} {
		if !db.Migrator().HasColumn(target.entity, target.field) {
			t.Fatalf("reference controls migration did not create %s", target.field)
		}
	}
	var cast model.DramaCast
	var segment model.DramaSegment
	if err := db.First(&cast).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&segment).Error; err != nil {
		t.Fatal(err)
	}
	if cast.Appearance != "白衣" || cast.ImagePrompt != "" || segment.ReferenceCastIDsJSON != "[]" || segment.ReferenceImagesJSON != "" || segment.AudioCastIDsJSON != "" {
		t.Fatalf("migration must preserve saved data: %+v %+v", cast, segment)
	}
}
