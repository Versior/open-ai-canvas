package repository

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 按 UTC 自然日分组计数在 SQLite 和 PostgreSQL 上要得到同样的格子；CI 配了 CANVAS_TEST_POSTGRES_DSN 时跑 PostgreSQL。
func TestTaskDailyCountsByTypes(t *testing.T) {
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "tasks.db")), config)
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := db.DB()
		sqlDB.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
		testTaskDailyCountsByTypes(t, db)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("task_daily_counts_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
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
		testTaskDailyCountsByTypes(t, db)
	})
}

func testTaskDailyCountsByTypes(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	shanghai := time.FixedZone("UTC+8", 8*3600)
	for _, task := range []model.Task{
		{ID: "td-1", UserID: "u", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusSucceeded, CreatedAt: day.Add(time.Hour)},
		// UTC 11-03 23:00 是东八区 11-04 07:00：按 UTC 落在 11-03。
		{ID: "td-2", UserID: "u", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusFailed, CreatedAt: day.Add(23 * time.Hour).In(shanghai)},
		{ID: "td-3", UserID: "u", Type: model.TaskTypeSocialVideoImport, Status: model.TaskStatusSucceeded, CreatedAt: day.Add(25 * time.Hour)},
		{ID: "td-4", UserID: "u", Type: model.TaskTypeSocialVideoImport, Status: model.TaskStatusSucceeded, CreatedAt: day.Add(26 * time.Hour)},
		{ID: "td-other", UserID: "u", Type: "canvas_text", Status: model.TaskStatusSucceeded, CreatedAt: day.Add(2 * time.Hour)},
		{ID: "td-before", UserID: "u", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusSucceeded, CreatedAt: day.Add(-time.Minute)},
		{ID: "td-after", UserID: "u", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusSucceeded, CreatedAt: day.AddDate(0, 0, 2)},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows, err := New(db).TaskDailyCountsByTypes([]string{model.TaskTypeReplicationTeardown, model.TaskTypeSocialVideoImport}, day, day.AddDate(0, 0, 2))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int64{}
	for _, row := range rows {
		got[fmt.Sprintf("%s/%s/%s", time.Unix(row.Day*86400, 0).UTC().Format("01-02"), row.Type, row.Status)] += row.Count
	}
	want := map[string]int64{
		"11-03/replication_teardown/succeeded": 1,
		"11-03/replication_teardown/failed":    1,
		"11-04/social_video_import/succeeded":  2,
	}
	if len(got) != len(want) {
		t.Fatalf("daily counts = %v, want %v", got, want)
	}
	for key, count := range want {
		if got[key] != count {
			t.Fatalf("daily counts = %v, want %v", got, want)
		}
	}
}
