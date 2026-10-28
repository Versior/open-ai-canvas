package repository

import (
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestMutateCloudAgentUsesSingleTransaction(t *testing.T) {
	capture := &sqlCaptureLogger{}
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "cloud-agent-mutation.db")), &gorm.Config{Logger: capture})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}); err != nil {
		t.Fatal(err)
	}
	run := model.CloudAgentExecution{ID: "run", UserID: "user", Status: "queued", Revision: 3, CheckpointVersion: 2, EventCount: 1}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CloudAgentEventRecord{RunID: run.ID, UserID: run.UserID, Sequence: 1, EventJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}

	capture.statements = nil
	err = New(db).MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *Repository) error {
		if current.Revision != run.Revision+1 || len(current.Journal) != 1 {
			t.Fatalf("mutation did not read the locked run: revision=%d journal=%d", current.Revision, len(current.Journal))
		}
		current.Status = "completed"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range capture.statements {
		if strings.Contains(strings.ToUpper(statement), "SAVEPOINT") {
			t.Fatalf("MutateCloudAgent started a nested transaction: %s", statement)
		}
	}
	var stored model.CloudAgentExecution
	if err := db.First(&stored, "id = ? AND user_id = ?", run.ID, run.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != "completed" || stored.Revision != run.Revision+1 {
		t.Fatalf("mutation was not committed: status=%q revision=%d", stored.Status, stored.Revision)
	}
}
