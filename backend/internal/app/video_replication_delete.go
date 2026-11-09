package app

import (
	"errors"
	"slices"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 删除自己的终态拆解记录，保留原视频、关键帧及已用于作品或画布的素材。
func (s *Service) DeleteVideoReplication(actor *model.User, taskID string) error {
	if actor == nil || actor.ID == "" {
		return Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return err
	}
	task, err := s.replicationTeardownTask(actor.ID, taskID)
	if err != nil {
		return err
	}
	if !slices.Contains(videoReplicationFinishedStatuses, task.Status) {
		return BadAuthRequest("拆解还没结束，结束后再删除")
	}
	audit, err := newAdminAuditEvent(actor, "video_replication.teardown.user_delete", "task", task.ID, "用户删除自己的拆解记录", map[string]any{"status": task.Status})
	if err != nil {
		return err
	}
	err = s.repo.DeleteFinishedTaskRecords(actor.ID, task.ID, model.TaskTypeReplicationTeardown, videoReplicationFinishedStatuses, audit)
	if errors.Is(err, repository.ErrTaskRecordsChanged) {
		return BadAuthRequest("拆解记录状态已变化，请刷新后重试")
	}
	return err
}
