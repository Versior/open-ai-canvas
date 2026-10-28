package app

import (
	"context"
	"net/http"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newTaskAdmissionAtomicityTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(
		&model.SystemSetting{}, &model.Project{}, &model.CanvasProject{},
		&model.Asset{}, &model.Task{}, &model.TaskLog{}, &model.Result{},
		&model.TaskTextDelta{}, &model.ApiCallLog{}, &model.RouteAttempt{}, &model.CloudAgentResourceLease{},
		&model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{},
		&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{},
		&model.LogicalModel{}, &model.LogicalModelRevision{}, &model.LogicalModelRoute{}, &model.IDSequence{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), activeCancels: make(map[string]context.CancelFunc)}, db
}

func TestCreateTextReplayTaskRejectsForeignProject(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	if err := db.Create(&model.Project{ID: "foreign-project", UserID: "user-b", Name: "foreign", Status: model.ProjectStatusActive}).Error; err != nil {
		t.Fatal(err)
	}

	_, err := service.createTextReplayTask("user-a", CreateTaskRequest{
		ProjectID: "foreign-project",
		Type:      "canvas_text",
		Prompt:    "draft",
	}, map[string]any{"replay": true, "prompt": "draft"})
	if err == nil {
		t.Fatal("createTextReplayTask() accepted another user's project")
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("persisted tasks = %d, want 0", count)
	}
}

func TestWorkerRejectsProjectRemovedAfterAdmissionBeforePersistence(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*gorm.DB) error
	}{
		{
			name: "archived",
			mutate: func(db *gorm.DB) error {
				return db.Model(&model.Project{}).Where("id = ?", "project-race").Update("status", model.ProjectStatusArchived).Error
			},
		},
		{
			name: "deleted",
			mutate: func(db *gorm.DB) error {
				return db.Delete(&model.Project{}, "id = ?", "project-race").Error
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, db := newTaskAdmissionAtomicityTestService(t)
			project := model.Project{ID: "project-race", UserID: "user-a", Name: "race", Status: model.ProjectStatusActive}
			if err := db.Create(&project).Error; err != nil {
				t.Fatal(err)
			}
			if err := service.ensureTaskProjectActive("user-a", project.ID); err != nil {
				t.Fatalf("initial admission: %v", err)
			}
			if err := test.mutate(db); err != nil {
				t.Fatal(err)
			}

			expires := time.Now().Add(time.Minute)
			task := model.Task{
				ID: "task-race", UserID: "user-a", ProjectID: project.ID,
				Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: "{invalid",
				BillingOrderID: "order-race", LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 1,
			}
			if err := db.Create(&model.CreditAccount{UserID: task.UserID, AvailableMicrocredits: 1000}).Error; err != nil {
				t.Fatal(err)
			}
			order := &model.BillingOrder{
				ID: task.BillingOrderID, UserID: task.UserID, TaskID: task.ID,
				IdempotencyKey: task.ID, Status: model.BillingStatusReserved, AmountMicrocredits: 100,
			}
			if err := service.repo.CreateTaskWithCreditReservation(&task, order, 10); err != nil {
				t.Fatal(err)
			}

			if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
				t.Fatal("processClaimedTask() error = nil")
			}
			stored, err := service.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.TaskStatusFailed {
				t.Fatalf("task status = %q, want failed", stored.Status)
			}
			storedOrder, err := service.repo.BillingOrder(task.BillingOrderID)
			if err != nil {
				t.Fatal(err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", task.UserID).Error; err != nil {
				t.Fatal(err)
			}
			if storedOrder.Status != model.BillingStatusRefunded || account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 0 {
				t.Fatalf("billing status=%s available=%d reserved=%d, want refunded/1000/0", storedOrder.Status, account.AvailableMicrocredits, account.ReservedMicrocredits)
			}
		})
	}
}

func TestWorkerKeepsClaimedTaskForRetryOnProjectAdmissionReadFailure(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-project-read-failure", UserID: "user-a", ProjectID: "project-transient",
		Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: "{invalid",
		BillingOrderID: "order-project-read-failure", LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 1,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	billing := &taskTerminalBillingStub{}
	service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
		service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
	)

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusRunning || stored.LeaseOwner != "worker-a" {
		t.Fatalf("task status=%q leaseOwner=%q, want running claim preserved", stored.Status, stored.LeaseOwner)
	}
	if len(billing.refund) != 0 || len(billing.uncertain) != 0 {
		t.Fatalf("billing refund=%v uncertain=%v, want untouched", billing.refund, billing.uncertain)
	}
}

func seedUnavailableTimelineProject(t *testing.T, db *gorm.DB, projectID string, state string) {
	t.Helper()
	if state == "deleted" {
		return
	}
	userID, status := "user-a", model.ProjectStatusActive
	if state == "foreign" {
		userID = "user-b"
	}
	if state == "archived" {
		status = model.ProjectStatusArchived
	}
	if err := db.Create(&model.Project{ID: projectID, UserID: userID, Name: state, Status: status}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestTimelineTaskCreationRejectsUnavailableProject(t *testing.T) {
	for _, taskType := range []string{model.TaskTypeTimelineTranscription, model.TaskTypeTimelineRender} {
		for _, state := range []string{"foreign", "archived", "deleted"} {
			t.Run(taskType+"/"+state, func(t *testing.T) {
				service, db := newTimelineTaskTestService(t)
				projectID := "timeline-" + state
				seedUnavailableTimelineProject(t, db, projectID, state)

				var err error
				if taskType == model.TaskTypeTimelineTranscription {
					seedResource(t, db, "timeline-resource", "user-a", "video/mp4")
					_, err = service.CreateTimelineTranscriptionTask("user-a", TimelineTranscriptionCreateRequest{
						ResourceID: "timeline-resource", ProjectID: projectID,
					})
				} else {
					_, err = service.CreateTimelineRenderTask("user-a", TimelineRenderCreateRequest{
						ProjectID: projectID, Timeline: renderTestProject("resource:timeline-resource"),
					})
				}
				if err == nil {
					t.Fatal("timeline task creation accepted unavailable project")
				}
				var count int64
				if err := db.Model(&model.Task{}).Count(&count).Error; err != nil {
					t.Fatal(err)
				}
				if count != 0 {
					t.Fatalf("persisted tasks = %d, want 0", count)
				}
			})
		}
	}
}

func TestTimelineWorkerRejectsUnavailableProjectBeforeExecution(t *testing.T) {
	for _, taskType := range []string{model.TaskTypeTimelineTranscription, model.TaskTypeTimelineRender} {
		for _, state := range []string{"foreign", "archived", "deleted"} {
			t.Run(taskType+"/"+state, func(t *testing.T) {
				service, db := newTaskAdmissionAtomicityTestService(t)
				projectID := "timeline-worker-" + state
				seedUnavailableTimelineProject(t, db, projectID, state)
				expires := time.Now().Add(time.Minute)
				task := model.Task{
					ID: "task-" + taskType + "-" + state, UserID: "user-a", ProjectID: projectID,
					Type: taskType, Status: model.TaskStatusRunning, InputJSON: "{invalid",
					BillingOrderID: "order-" + taskType + "-" + state,
					LeaseOwner:     "worker-a", LeaseExpiresAt: &expires, Attempts: 1,
				}
				if err := db.Create(&task).Error; err != nil {
					t.Fatal(err)
				}
				billing := &taskTerminalBillingStub{}
				service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
					service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
				)
				t.Setenv(whisperLangEnv, "")
				t.Setenv(renderFfmpegEnv, "/no/such/ffmpeg")

				if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
					t.Fatal("processClaimedTask() error = nil; timeline executor was not gated")
				}
				stored, err := service.repo.Task(task.ID)
				if err != nil {
					t.Fatal(err)
				}
				if stored.Status != model.TaskStatusFailed || stored.Stage != "项目不可用" {
					t.Fatalf("task status=%q stage=%q, want failed/project unavailable", stored.Status, stored.Stage)
				}
				if len(billing.refund) != 1 || len(billing.uncertain) != 0 {
					t.Fatalf("billing refund=%v uncertain=%v, want one safe refund", billing.refund, billing.uncertain)
				}
			})
		}
	}
}

func TestTimelineTaskCreationKeepsEmptyProjectCompatibility(t *testing.T) {
	for _, taskType := range []string{model.TaskTypeTimelineTranscription, model.TaskTypeTimelineRender} {
		t.Run(taskType, func(t *testing.T) {
			service, db := newTimelineTaskTestService(t)
			var task *model.Task
			var err error
			if taskType == model.TaskTypeTimelineTranscription {
				seedResource(t, db, "timeline-empty-project-resource", "user-a", "video/mp4")
				task, err = service.CreateTimelineTranscriptionTask("user-a", TimelineTranscriptionCreateRequest{
					ResourceID: "timeline-empty-project-resource",
				})
			} else {
				task, err = service.CreateTimelineRenderTask("user-a", TimelineRenderCreateRequest{
					Timeline: renderTestProject("resource:timeline-empty-project-resource"),
				})
			}
			if err != nil {
				t.Fatalf("create with empty project: %v", err)
			}
			if task.ProjectID != "" || task.Status != model.TaskStatusQueued {
				t.Fatalf("task project=%q status=%q, want empty/queued", task.ProjectID, task.Status)
			}
		})
	}
}

func TestTimelineWorkerKeepsEmptyProjectCompatibility(t *testing.T) {
	for _, taskType := range []string{model.TaskTypeTimelineTranscription, model.TaskTypeTimelineRender} {
		t.Run(taskType, func(t *testing.T) {
			service, db := newTaskAdmissionAtomicityTestService(t)
			expires := time.Now().Add(time.Minute)
			task := model.Task{
				ID: "task-empty-project-" + taskType, UserID: "user-a",
				Type: taskType, Status: model.TaskStatusRunning, InputJSON: "{invalid",
				LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 1,
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			t.Setenv(whisperLangEnv, "")
			t.Setenv(renderFfmpegEnv, "/no/such/ffmpeg")

			if err := service.taskWorker().processClaimedTask(&task, nil); err != nil {
				t.Fatalf("process empty-project timeline task: %v", err)
			}
			stored, err := service.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.TaskStatusFailed || stored.Stage == "项目不可用" {
				t.Fatalf("task status=%q stage=%q, want timeline executor result", stored.Status, stored.Stage)
			}
		})
	}
}
func TestWorkerContinuesProviderRecoveryWhenProjectWasDeleted(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-provider-recovery", UserID: "user-a", ProjectID: "deleted-project",
		Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`,
		ProviderRequestID: "provider-existing", LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 1, RouteRun: 1,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{
		ID: "attempt-provider-recovery", TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 1,
		Status: "succeeded", DispatchState: "accepted", ProviderRequestID: task.ProviderRequestID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	billing := &taskTerminalBillingStub{}
	service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
		service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
	)
	probe := &queuedChannelExecutionProbe{Service: service}
	service.taskRouteExecutor = &taskRouteExecutor{port: probe}

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	if probe.calls != 1 {
		t.Fatalf("provider recovery calls = %d, want 1", probe.calls)
	}
	attempts, err := service.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 1 {
		t.Fatalf("route attempts = %d, want existing attempt only", len(attempts))
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Stage == "项目不可用" {
		t.Fatalf("submitted task was stopped by project admission: %#v", stored)
	}
}

func TestWorkerRoutesSubmittedAttemptToReconciliationWhenProjectWasDeleted(t *testing.T) {
	for _, dispatchState := range []string{"accepted", "submission_unknown"} {
		t.Run(dispatchState, func(t *testing.T) {
			service, db := newTaskAdmissionAtomicityTestService(t)
			expires := time.Now().Add(time.Minute)
			task := model.Task{
				ID: "task-route-" + dispatchState, UserID: "user-a", ProjectID: "deleted-project",
				Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`,
				BillingOrderID: "order-route-" + dispatchState,
				LeaseOwner:     "worker-a", LeaseExpiresAt: &expires, Attempts: 1, RouteRun: 1,
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.RouteAttempt{
				ID: "attempt-route-" + dispatchState, TaskID: task.ID, RouteRun: task.RouteRun,
				AttemptNumber: 1, Status: "dispatching", DispatchState: dispatchState,
			}).Error; err != nil {
				t.Fatal(err)
			}
			billing := &taskTerminalBillingStub{}
			service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
				service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
			)
			probe := &queuedChannelExecutionProbe{Service: service}
			service.taskRouteExecutor = &taskRouteExecutor{port: probe}

			if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
				t.Fatal("processClaimedTask() error = nil")
			}
			stored, err := service.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Stage != "项目不可用" || probe.calls != 0 {
				t.Fatalf("stage=%q calls=%d, want project rejection without resubmission", stored.Stage, probe.calls)
			}
			if len(billing.refund) != 0 || len(billing.uncertain) != 1 {
				t.Fatalf("billing refund=%v uncertain=%v, want review only", billing.refund, billing.uncertain)
			}
			attempts, err := service.repo.RouteAttempts(task.ID, task.RouteRun)
			if err != nil {
				t.Fatal(err)
			}
			if len(attempts) != 1 {
				t.Fatalf("route attempts = %d, want no duplicate", len(attempts))
			}
		})
	}
}

func TestWorkerPreservesMediaRecoveryWhenProjectWasDeleted(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-media-recovery", UserID: "user-a", ProjectID: "deleted-project",
		Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{"mode":"image"}`,
		MediaRecoveryJSON: "invalid-checkpoint", BillingOrderID: "order-media-recovery",
		LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 1,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	billing := &taskTerminalBillingStub{}
	service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
		service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
	)

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusRunning || stored.MediaRecoveryJSON == "" || stored.Stage == "项目不可用" {
		t.Fatalf("media recovery was discarded by project admission: %#v", stored)
	}
	if len(billing.refund) != 0 || len(billing.uncertain) != 0 {
		t.Fatalf("billing refund=%v uncertain=%v, want untouched", billing.refund, billing.uncertain)
	}
}

func TestWorkerRejectsNewRouteRunWhenOnlyOldBillingLogMayHaveSubmitted(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	if err := db.AutoMigrate(&model.IDSequence{}); err != nil {
		t.Fatal(err)
	}
	project := model.Project{ID: "project-old-billing-log", UserID: "user-a", Name: "old billing log", Status: model.ProjectStatusActive}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}

	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-old-billing-log", UserID: project.UserID, ProjectID: project.ID,
		Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`,
		BillingOrderID: "order-old-billing-log", LeaseOwner: "worker-a", LeaseExpiresAt: &expires,
		Attempts: 1, RouteRun: 2,
	}
	if err := db.Create(&model.CreditAccount{UserID: task.UserID, AvailableMicrocredits: 1000}).Error; err != nil {
		t.Fatal(err)
	}
	order := &model.BillingOrder{
		ID: task.BillingOrderID, UserID: task.UserID, TaskID: task.ID,
		IdempotencyKey: task.ID, Status: model.BillingStatusReserved, AmountMicrocredits: 100,
	}
	if err := service.repo.CreateTaskWithCreditReservation(&task, order, 10); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "old-route-success", UserID: task.UserID, TaskID: task.ID,
		RequestKind: "create", Method: http.MethodPost, Billable: true,
		Status: model.ApiCallStatusSucceeded, StatusCode: http.StatusOK,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.Project{}, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	probe := &queuedChannelExecutionProbe{Service: service}
	service.taskRouteExecutor = &taskRouteExecutor{port: probe}

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	if probe.calls != 0 {
		t.Fatalf("provider calls = %d, want 0", probe.calls)
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.Stage != "项目不可用" {
		t.Fatalf("task status=%q stage=%q, want failed/project unavailable", stored.Status, stored.Stage)
	}
	storedOrder, err := service.repo.BillingOrder(order.ID)
	if err != nil {
		t.Fatal(err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", task.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if storedOrder.Status != model.BillingStatusRefunded || account.AvailableMicrocredits != 1000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("billing status=%s available=%d reserved=%d, want refunded/1000/0", storedOrder.Status, account.AvailableMicrocredits, account.ReservedMicrocredits)
	}
	var reserveCount, consumeCount, refundCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerReserve).Count(&reserveCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerConsume).Count(&consumeCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerRefund).Count(&refundCount).Error; err != nil {
		t.Fatal(err)
	}
	if reserveCount != 1 || consumeCount != 0 || refundCount != 1 {
		t.Fatalf("ledger reserve=%d consume=%d refund=%d, want 1/0/1", reserveCount, consumeCount, refundCount)
	}
}
func TestWorkerKeepsLegacyRetryBillingUncertainWhenProjectWasDeleted(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-legacy-retry-project-deleted", UserID: "user-a", ProjectID: "deleted-project",
		Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`,
		BillingOrderID: "order-legacy-retry-project-deleted",
		LeaseOwner:     "worker-a", LeaseExpiresAt: &expires, Attempts: 2, RouteRun: 1,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	billing := &taskTerminalBillingStub{}
	service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
		service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
	)
	probe := &queuedChannelExecutionProbe{Service: service}
	service.taskRouteExecutor = &taskRouteExecutor{port: probe}

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	if probe.calls != 0 {
		t.Fatalf("provider calls = %d, want 0", probe.calls)
	}
	if len(billing.refund) != 0 || len(billing.uncertain) != 1 {
		t.Fatalf("billing refund=%v uncertain=%v, want review without refund", billing.refund, billing.uncertain)
	}
	attempts, err := service.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 0 {
		t.Fatalf("route attempts = %d, want legacy uncertainty without a new attempt", len(attempts))
	}
}

func TestWorkerStopsLegacyLogicalModelRetryWhenProjectWasDeleted(t *testing.T) {
	service, db := newTaskAdmissionAtomicityTestService(t)
	logical := seedAgentLogicalImageModel(t, service, db)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-legacy-logical-project-deleted", UserID: "user-a", ProjectID: "deleted-project",
		Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{"mode":"image"}`,
		LogicalModelID: logical.ID, LogicalModelRevisionID: logical.ActiveRevisionID,
		RouteID: "agent-sunburst-route", ChannelModelID: "agent-image-cm",
		BillingOrderID: "order-legacy-logical-project-deleted",
		LeaseOwner:     "worker-a", LeaseExpiresAt: &expires, Attempts: 2, RouteRun: 1,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	billing := &taskTerminalBillingStub{}
	service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
		service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
	)
	probe := &queuedChannelExecutionProbe{Service: service}
	service.taskRouteExecutor = &taskRouteExecutor{port: probe}

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	if probe.calls != 0 {
		t.Fatalf("provider calls = %d, want 0", probe.calls)
	}
	if len(billing.refund) != 0 || len(billing.uncertain) != 1 {
		t.Fatalf("billing refund=%v uncertain=%v, want review without refund", billing.refund, billing.uncertain)
	}
	attempts, err := service.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 0 {
		t.Fatalf("route attempts = %d, want no redispatch attempt", len(attempts))
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.Stage != "项目不可用" {
		t.Fatalf("task status=%q stage=%q, want failed/project unavailable", stored.Status, stored.Stage)
	}
}

func TestWorkerStopsLegacyTimelineRetryWhenProjectWasDeleted(t *testing.T) {
	t.Setenv(whisperLangEnv, "")
	service, db := newTaskAdmissionAtomicityTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-legacy-timeline-project-deleted", UserID: "user-a", ProjectID: "deleted-project",
		Type: model.TaskTypeTimelineTranscription, Status: model.TaskStatusRunning, InputJSON: `{"resourceId":"resource-a"}`,
		BillingOrderID: "order-legacy-timeline-project-deleted",
		LeaseOwner:     "worker-a", LeaseExpiresAt: &expires, Attempts: 2, RouteRun: 1,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	billing := &taskTerminalBillingStub{}
	service.taskTerminalCoordinator = newTaskTerminalCoordinatorForTest(
		service.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{},
	)

	if err := service.taskWorker().processClaimedTask(&task, nil); err == nil {
		t.Fatal("processClaimedTask() error = nil")
	}
	if len(billing.refund) != 0 || len(billing.uncertain) != 1 {
		t.Fatalf("billing refund=%v uncertain=%v, want review without refund", billing.refund, billing.uncertain)
	}
	stored, err := service.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.Stage != "项目不可用" {
		t.Fatalf("task status=%q stage=%q, want failed/project unavailable", stored.Status, stored.Stage)
	}
}
