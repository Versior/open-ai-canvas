package app

import (
	"errors"
	"gorm.io/gorm"
	"testing"
	"yingce/backend/internal/model"
)

func TestUserVideoReplicationDeletionIsOwnedAndPreservesResources(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	user := &model.User{ID: "delete-owner", Role: model.UserRoleUser}
	for _, row := range []any{
		&model.Task{ID: "delete-finished", UserID: user.ID, Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusFailed},
		&model.Task{ID: "delete-active", UserID: user.ID, Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusRunning},
		&model.Task{ID: "delete-other", UserID: "other", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusSucceeded},
		&model.Resource{ID: "keep-source", UserID: user.ID, Kind: "video", Status: model.ResourceStatusReady},
		&model.Resource{ID: "keep-frame", UserID: user.ID, Kind: "image", Status: model.ResourceStatusReady},
		&model.Result{ID: "delete-analysis", UserID: user.ID, TaskID: "delete-finished", Kind: videoReplicationAnalysisKind, Payload: `{"title":"test"}`},
		&model.TaskLog{ID: "delete-log", TaskID: "delete-finished"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	requireAgentPetStatus(t, svc.DeleteVideoReplication(user, "delete-other"), 404)
	requireAgentPetStatus(t, svc.DeleteVideoReplication(user, "delete-active"), 400)
	requireAgentPetStatus(t, svc.DeleteVideoReplication(nil, "delete-finished"), 401)
	if err := svc.DeleteVideoReplication(user, "delete-finished"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.Task("delete-finished"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("task not deleted: %v", err)
	}
	for _, table := range []any{&model.Result{}, &model.TaskLog{}} {
		var count int64
		if err := db.Model(table).Where("task_id = ?", "delete-finished").Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("related records remain: %d %v", count, err)
		}
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("resources changed: %d %v", count, err)
	}
	requireAgentPetStatus(t, svc.DeleteVideoReplication(user, "delete-finished"), 404)
}
