package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestWorkerDispatchesExplicitDirectRetryOnce(t *testing.T) {
	service, db := newMediaRecoveryTestService(t)
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-explicit-direct-retry", UserID: "user-a",
		Type: "canvas_text", Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`,
		LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 2, RouteRun: 2,
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
	if probe.calls != 1 {
		t.Fatalf("provider calls = %d, want 1", probe.calls)
	}
	attempts, err := service.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		t.Fatal(err)
	}
	if len(attempts) != 1 {
		t.Fatalf("route attempts = %d, want 1", len(attempts))
	}
}

func TestWorkerStopsLegacyLogicalRetryWithoutDispatchEvidence(t *testing.T) {
	service, db := newMediaRecoveryTestService(t)
	logical := seedAgentLogicalImageModel(t, service, db)
	project := model.Project{ID: "project-legacy-logical", UserID: "user-a", Name: "active", Status: model.ProjectStatusActive}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Minute)
	task := model.Task{
		ID: "task-legacy-logical-active", UserID: project.UserID, ProjectID: project.ID,
		Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{"mode":"image"}`,
		LogicalModelID: logical.ID, LogicalModelRevisionID: logical.ActiveRevisionID,
		RouteID: "agent-sunburst-route", ChannelModelID: "agent-image-cm",
		LeaseOwner: "worker-a", LeaseExpiresAt: &expires, Attempts: 2, RouteRun: 1,
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
		t.Fatalf("route attempts = %d, want 0", len(attempts))
	}
}
