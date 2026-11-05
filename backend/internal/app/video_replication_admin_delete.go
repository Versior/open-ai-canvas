package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 后台删除一条拆解记录：任务、模型分析和日志在一个事务里删掉；这条拆解存的关键帧和宫格，再按资源删除的
// 引用规则清理（没被别处用到的删掉，被画布、其他任务等用到的保留并列出来）。原视频是用户自己的素材，不动。

var videoReplicationFinishedStatuses = []model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled}

// AdminVideoReplicationDeleteResult 是删除结果：删掉的图片、仍被用到而保留的图片；图片清理失败时
// ImagesError 写原因（记录已经删了，图片可以在「存储资源」里再删）。
type AdminVideoReplicationDeleteResult struct {
	ID               string                       `json:"id"`
	DeletedResources []string                     `json:"deletedResources"`
	KeptResources    []AdminResourceDeleteBlocked `json:"keptResources"`
	ImagesError      string                       `json:"imagesError,omitempty"`
}

func (s *Service) DeleteAdminVideoReplication(actor *model.User, taskID string) (*AdminVideoReplicationDeleteResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || len(taskID) > 128 {
		return nil, NotFound("拆解记录不存在")
	}
	task, err := s.repo.Task(taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && task.Type != model.TaskTypeReplicationTeardown) {
		return nil, NotFound("拆解记录不存在")
	}
	if err != nil {
		return nil, err
	}
	if !slices.Contains(videoReplicationFinishedStatuses, task.Status) {
		return nil, BadAuthRequest("拆解还没结束，结束后再删除")
	}
	images, err := s.videoTeardownImageResourceIDs(task)
	if err != nil {
		return nil, err
	}
	audit, err := newAdminAuditEvent(actor, "video_replication.teardown.delete", "task", task.ID, "管理员删除拆解记录", map[string]any{
		"userId": task.UserID, "status": task.Status, "imageResourceIds": images,
	})
	if err != nil {
		return nil, err
	}
	// 先删任务：它的结果里写着这些图，不先删的话图会被它自己挡住。
	if err := s.repo.DeleteFinishedTaskRecords(task.ID, model.TaskTypeReplicationTeardown, videoReplicationFinishedStatuses, audit); err != nil {
		if errors.Is(err, repository.ErrTaskRecordsChanged) {
			return nil, BadAuthRequest("拆解记录状态已变化，请刷新后重试")
		}
		return nil, err
	}
	result := &AdminVideoReplicationDeleteResult{ID: task.ID, DeletedResources: []string{}, KeptResources: []AdminResourceDeleteBlocked{}}
	if len(images) == 0 {
		return result, nil
	}
	cleanup, err := s.DeleteAdminResources(actor, AdminResourceDeleteRequest{ResourceIDs: images})
	if err != nil {
		// 记录已经删掉；图片留着不影响别处，只是占存储，管理员可以去「存储资源」再删。
		slog.Warn("删除拆解记录后清理图片失败", "task", task.ID, "error", err)
		result.ImagesError = "关键帧和宫格没能清理：" + videoTeardownErrorMessage(err)
		return result, nil
	}
	result.DeletedResources, result.KeptResources = cleanup.Deleted, cleanup.Blocked
	return result, nil
}

// videoTeardownImageResourceIDs 是这条拆解存过的图：结果里的关键帧和宫格，加上按上传标识找到的
// （任务失败或被重新领取时已经存下、但没写进结果的）。只取这个用户自己的资源；原视频不在里面。
func (s *Service) videoTeardownImageResourceIDs(task *model.Task) ([]string, error) {
	candidates := map[string]struct{}{}
	var bundle videoTeardownBundle
	if strings.TrimSpace(task.ResultJSON) != "" && json.Unmarshal([]byte(task.ResultJSON), &bundle) == nil {
		for _, shot := range bundle.Shots {
			candidates[shot.KeyframeResourceID] = struct{}{}
		}
		for _, grid := range bundle.Grids {
			candidates[grid.ResourceID] = struct{}{}
		}
	}
	maxGrids := (videoTeardownMaxShotsLimit + videoTeardownGridShots - 1) / videoTeardownGridShots
	keys := make([]string, 0, videoTeardownMaxShotsLimit+maxGrids)
	for index := 1; index <= videoTeardownMaxShotsLimit; index++ {
		keys = append(keys, *normalizedResourceUploadKey([]string{videoTeardownUploadIdentity(task.ID, fmt.Sprintf("keyframe-%03d.jpg", index))}))
	}
	for index := 1; index <= maxGrids; index++ {
		keys = append(keys, *normalizedResourceUploadKey([]string{videoTeardownUploadIdentity(task.ID, fmt.Sprintf("grid-%02d.jpg", index))}))
	}
	byKey, err := s.repo.ResourcesForUserByUploadKeys(task.UserID, keys)
	if err != nil {
		return nil, err
	}
	for _, resource := range byKey {
		candidates[resource.ID] = struct{}{}
	}
	delete(candidates, "")
	delete(candidates, bundle.Source.ResourceID)
	ids := make([]string, 0, len(candidates))
	for id := range candidates {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	owned, err := s.repo.ResourcesForUserIDs(task.UserID, ids)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(owned))
	for _, resource := range owned {
		result = append(result, resource.ID)
	}
	sort.Strings(result)
	return result, nil
}
