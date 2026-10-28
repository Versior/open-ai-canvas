package repository

import (
	"errors"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func newTaskProjectAtomicityRepository(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{}, &model.CanvasProject{}, &model.Task{}, &model.TaskTextDelta{},
		&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{},
		&model.CloudAgentResourceLease{}, &model.LogicalModel{},
	); err != nil {
		t.Fatal(err)
	}
	return New(db), db
}

func TestCreateTaskRechecksProjectInsideTransaction(t *testing.T) {
	for _, test := range []struct {
		name     string
		status   model.TaskStatus
		billable bool
	}{
		{name: "ordinary", status: model.TaskStatusQueued, billable: true},
		{name: "text_replay", status: model.TaskStatusTextReplay},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo, db := newTaskProjectAtomicityRepository(t)
			project := model.Project{ID: "project-race", UserID: "user-a", Name: "race", Status: model.ProjectStatusActive}
			if err := db.Create(&project).Error; err != nil {
				t.Fatal(err)
			}
			// Simulate the project being archived after the application precheck.
			if err := db.Model(&project).Update("status", model.ProjectStatusArchived).Error; err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "task-race", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_text", Status: test.status}
			var err error
			if test.billable {
				if err = db.Create(&model.CreditAccount{UserID: task.UserID, AvailableMicrocredits: 1000}).Error; err != nil {
					t.Fatal(err)
				}
				order := &model.BillingOrder{ID: "order-race", UserID: task.UserID, TaskID: task.ID, IdempotencyKey: task.ID, AmountMicrocredits: 100}
				err = repo.CreateTaskWithCreditReservation(&task, order, 10)
			} else {
				err = repo.CreateTaskWithActiveLimit(&task, 10)
			}
			if !errors.Is(err, ErrProjectNotActive) {
				t.Fatalf("create task error = %v, want ErrProjectNotActive", err)
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("persisted tasks = %d, want 0", count)
			}
		})
	}
}

func TestRetryTaskRechecksProjectInsideTransaction(t *testing.T) {
	repo, db := newTaskProjectAtomicityRepository(t)
	project := model.Project{ID: "project-retry-race", UserID: "user-a", Name: "retry-race", Status: model.ProjectStatusActive}
	task := model.Task{ID: "task-retry-race", UserID: project.UserID, ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusFailed, RouteRun: 1}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&project).Update("status", model.ProjectStatusArchived).Error; err != nil {
		t.Fatal(err)
	}

	_, err := repo.RetryTaskWithBilling(task.UserID, &task, nil, 10)
	if !errors.Is(err, ErrProjectNotActive) {
		t.Fatalf("RetryTaskWithBilling() error = %v, want ErrProjectNotActive", err)
	}
	stored, err := repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.RouteRun != 1 {
		t.Fatalf("stored task status=%q routeRun=%d, want failed/1", stored.Status, stored.RouteRun)
	}
}
