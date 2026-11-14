package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func TestPackagingPostgresTransactions(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
	}
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("packaging_test_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
		connection, _ := admin.DB()
		_ = connection.Close()
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), config)
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.Resource{}, &model.PackagingProject{}, &model.PackagingProjectResource{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "owner", Username: "owner"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"art-a", "art-b", "locked-art"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "owner", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(db)
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			<-start
			refs := [][]string{{"art-a", "art-b"}, {"art-b", "art-a"}}[i]
			results <- repo.SavePackagingProject(&model.PackagingProject{ID: fmt.Sprintf("project-%d", i), UserID: "owner", Name: "包装", TemplateID: "tuck", DocumentJSON: "{}", Revision: 1}, 0, refs, 1)
		}(i)
	}
	close(start)
	first, second := <-results, <-results
	if !((first == nil && errors.Is(second, ErrPackagingQuota)) || (second == nil && errors.Is(first, ErrPackagingQuota))) {
		t.Fatalf("concurrent quota: %v / %v", first, second)
	}
	projects, count, err := repo.PackagingProjects("owner", "", 1, 30)
	if err != nil || count != 1 {
		t.Fatalf("project count: %d / %v", count, err)
	}
	start = make(chan struct{})
	for i := 0; i < 2; i++ {
		go func(i int) {
			<-start
			item := projects[0]
			item.Name = fmt.Sprintf("editor-%d", i)
			item.DocumentJSON = fmt.Sprintf(`{"editor":%d}`, i)
			item.Revision = 2
			results <- repo.SavePackagingProject(&item, 1, [][]string{{"art-a", "art-b"}, {"art-b", "art-a"}}[i], 1)
		}(i)
	}
	close(start)
	first, second = <-results, <-results
	if !((first == nil && errors.Is(second, ErrPackagingConflict)) || (second == nil && errors.Is(first, ErrPackagingConflict))) {
		t.Fatalf("concurrent revision: %v / %v", first, second)
	}
	winner, err := repo.PackagingProject("owner", projects[0].ID)
	if err != nil || winner.Revision != 2 {
		t.Fatalf("winner: %v / %v", winner, err)
	}
	invalid := *winner
	invalid.Revision = 3
	if err := repo.SavePackagingProject(&invalid, 2, []string{"missing-art"}, 1); !errors.Is(err, ErrPackagingResource) {
		t.Fatalf("missing resource: %v", err)
	}
	stored, err := repo.PackagingProject("owner", winner.ID)
	if err != nil || stored.Revision != 2 || stored.DocumentJSON != winner.DocumentJSON {
		t.Fatal("rejected write changed project")
	}
	if err := repo.DeletePackagingProject("owner", winner.ID, 1, nil); !errors.Is(err, ErrPackagingConflict) {
		t.Fatalf("stale delete: %v", err)
	}
	if err := repo.DeletePackagingProject("owner", winner.ID, 2, nil); err != nil {
		t.Fatal(err)
	}
	var references, originals int64
	db.Model(&model.PackagingProjectResource{}).Count(&references)
	db.Model(&model.Resource{}).Count(&originals)
	if references != 0 || originals != 3 {
		t.Fatalf("delete references=%d originals=%d", references, originals)
	}

	locked := db.Begin()
	if locked.Error != nil {
		t.Fatal(locked.Error)
	}
	defer locked.Rollback()
	var resource model.Resource
	if err := locked.Clauses(clause.Locking{Strength: "UPDATE"}).First(&resource, "id = ?", "locked-art").Error; err != nil {
		t.Fatal(err)
	}
	go func() {
		results <- repo.SavePackagingProject(&model.PackagingProject{ID: "after-delete", UserID: "owner", Name: "包装", TemplateID: "tuck", DocumentJSON: "{}", Revision: 1}, 0, []string{"locked-art"}, 1)
	}()
	select {
	case err := <-results:
		t.Fatalf("save crossed resource deletion lock: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	if err := locked.Delete(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := locked.Commit().Error; err != nil {
		t.Fatal(err)
	}
	if err := <-results; !errors.Is(err, ErrPackagingResource) {
		t.Fatalf("deleted original accepted: %v", err)
	}

	start = make(chan struct{})
	for i := 0; i < 2; i++ {
		go func(i int) {
			<-start
			results <- repo.SavePackagingCatalog(nil, &model.SystemSetting{Key: "packaging_catalog", ValueJSON: fmt.Sprintf(`{"revision":%d}`, i+1)}, &model.AdminAuditEvent{ID: fmt.Sprintf("audit-%d", i), Action: "packaging.catalog.save"})
		}(i)
	}
	close(start)
	first, second = <-results, <-results
	if !((first == nil && errors.Is(second, ErrPackagingConflict)) || (second == nil && errors.Is(first, ErrPackagingConflict))) {
		t.Fatalf("catalog CAS: %v / %v", first, second)
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Count(&audits).Error; err != nil || audits != 1 {
		t.Fatalf("CAS audit count=%d / %v", audits, err)
	}
}
