package app

import (
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestPersonalTaskSubmission(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		service, db, _, _ := creationTestService(t)
		verifyPersonalTaskSubmission(t, service, db, false)
	})
	t.Run("postgres", func(t *testing.T) {
		_, db := newProjectNameConflictPostgresService(t)
		service, _, _, _ := creationTestServiceOnDatabase(t, db)
		verifyPersonalTaskSubmission(t, service, db, true)
	})
}

func verifyPersonalTaskSubmission(t *testing.T, service *Service, db *gorm.DB, concurrent bool) {
	t.Helper()
	request := creationTextRequest()
	request.IdempotencyKey = "video-director:one-message"
	gate := make(chan struct{})
	type result struct {
		task *model.Task
		err  error
	}
	out := make(chan result, 2)
	if concurrent {
		peer := &Service{repo: service.repo, dataDir: service.dataDir, disablePiRuntime: true}
		for _, instance := range []*Service{service, peer} {
			go func() { <-gate; task, err := instance.CreateTask("user", request); out <- result{task, err} }()
		}
		close(gate)
	} else {
		for range 2 {
			task, err := service.CreateTask("user", request)
			out <- result{task, err}
		}
	}
	first, second := <-out, <-out
	if first.err != nil || second.err != nil || first.task.ID != second.task.ID {
		t.Fatalf("same-intent replay did not return the same accepted task: %v, %v", first.err, second.err)
	}
	for _, table := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
		var rows int64
		if err := db.Model(table).Count(&rows).Error; err != nil || rows != 1 {
			t.Fatalf("%T: %d rows; error %v", table, rows, err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil || account.AvailableMicrocredits != 9900 || account.ReservedMicrocredits != 100 {
		t.Fatalf("balance after replay: %+v, %v", account, err)
	}
	changed := request
	changed.Prompt = "另一条请求"
	if _, err := service.CreateTask("user", changed); !isSubmissionConflict(err) {
		t.Fatalf("same key with different content: %v", err)
	}
	request.RequestID = "another-http-request"
	if got, err := service.CreateTask("user", request); err != nil || got.ID != first.task.ID {
		t.Fatalf("transport identity changed replay: %v", err)
	}
	if err := db.Create(&model.User{ID: "second-user", Username: "second-user", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "second-user", AvailableMicrocredits: 1000}).Error; err != nil {
		t.Fatal(err)
	}
	if other, err := service.CreateTask("second-user", request); err != nil || other.ID == first.task.ID {
		t.Fatalf("operation not isolated by owner: %v", err)
	}
	request.IdempotencyKey = "video-director:explicit-new-take"
	next, err := service.CreateTask("user", request)
	if err != nil || next.ID == first.task.ID {
		t.Fatalf("explicit new intent did not produce a separate task: %v", err)
	}
	request.IdempotencyKey = strings.Repeat("a", 161)
	if _, err := service.CreateTask("user", request); err == nil {
		t.Fatal("oversized key accepted")
	}
	request.IdempotencyKey = ""
	seen := map[string]bool{first.task.ID: true, next.ID: true}
	for index := range 2 {
		got, err := service.CreateTask("user", request)
		if err != nil || seen[got.ID] {
			t.Fatalf("unkeyed submission %d, %v", index, err)
		}
		seen[got.ID] = true
	}
}

func isSubmissionConflict(err error) bool {
	var conflict *AppError
	return errors.As(err, &conflict) && conflict.Status == 409 && conflict.Code == CodeIdempotencyConflict
}

func TestPersonalSubmissionIntentJSONCanonical(t *testing.T) {
	service, _, _, _ := creationTestService(t)
	request := creationTextRequest()
	request.IdempotencyKey = "canonical-input"
	request.Input["metadata"] = map[string]any{"stage": "spec", "source": "test"}
	first, err := service.CreateTask("user", request)
	if err != nil {
		t.Fatal(err)
	}
	request.Input["metadata"] = map[string]any{"source": "test", "stage": "spec"}
	second, err := service.CreateTask("user", request)
	if err != nil || second.ID != first.ID {
		t.Fatalf("reordered JSON created a different operation: %v", err)
	}
}
