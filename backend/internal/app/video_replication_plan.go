package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// 复刻方案：用户在视频复刻工作区里填的商品档案、选定的改写脚本和逐镜处理方式。和分析一样存进 results 表
// （kind=replication_plan，task_id 指向拆解任务，每个任务只留最新一份），删除拆解记录时一起删掉。
// 方案里的商品图是用户自己的图片资源；资源引用扫描会扫 results 的 payload，被方案用到的图片不会被当成无引用清理。

const (
	videoReplicationPlanKind      = "replication_plan"
	videoReplicationPlanMaxBytes  = 256 << 10
	videoReplicationPlanMaxImages = 4
	// videoReplicationPlanMaxCanvases：方案里最多记几块按它建的画布，只用来在页面上列出和打开。
	videoReplicationPlanMaxCanvases = 20
)

var videoReplicationPlanTreatments = map[string]bool{"remake": true, "product": true, "original": true, "skip": true}

// videoReplicationPlanHead 只取服务端要校验的字段；改写的台词、提示词等文字由前端负责。
type videoReplicationPlanHead struct {
	Campaign   *videoReplicaCampaign `json:"campaign,omitempty"`
	Version    int                   `json:"version"`
	Authorized bool                  `json:"authorized"`
	Product    struct {
		Name   string `json:"name"`
		Images []struct {
			ResourceID string `json:"resourceId"`
		} `json:"images"`
	} `json:"product"`
	Shots []struct {
		ShotNumber int                    `json:"shotNumber"`
		Treatment  string                 `json:"treatment"`
		Director   *videoReplicaDirection `json:"director,omitempty"`
	} `json:"shots"`
	Canvases []struct {
		ID string `json:"id"`
	} `json:"canvases"`
}

// SaveVideoReplicationPlan 保存复刻方案。只接受本人已完成的拆解任务；逐镜处理要和拆解结果的镜头一一对应，
// 「沿用原片画面」要先确认是自己的或已授权的视频，商品图必须是本人的图片资源。
func (s *Service) SaveVideoReplicationPlan(userID, taskID string, payload []byte) (*VideoReplicationDetail, error) {
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return nil, err
	}
	task, err := s.replicationTeardownTask(userID, taskID)
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusSucceeded {
		return nil, BadAuthRequest("拆解还没有完成，不能保存复刻方案")
	}
	var bundle videoTeardownBundle
	if err := json.Unmarshal([]byte(task.ResultJSON), &bundle); err != nil || len(bundle.Shots) == 0 {
		return nil, BadAuthRequest("拆解结果无效，不能保存复刻方案")
	}
	if len(payload) == 0 || len(payload) > videoReplicationPlanMaxBytes {
		return nil, BadAuthRequest("复刻方案不能为空，也不能超过 256 KiB")
	}
	var head videoReplicationPlanHead
	if err := json.Unmarshal(payload, &head); err != nil || head.Version != 1 {
		return nil, BadAuthRequest("复刻方案格式无效")
	}
	if len([]rune(strings.TrimSpace(head.Product.Name))) > 60 {
		return nil, BadAuthRequest("商品名称不能超过 60 个字")
	}
	if head.Campaign != nil {
		if err := head.Campaign.validate(); err != nil {
			return nil, BadAuthRequest(err.Error())
		}
	}
	if len(head.Shots) != len(bundle.Shots) {
		return nil, BadAuthRequest(fmt.Sprintf("复刻方案有 %d 个镜头，拆解结果有 %d 个镜头", len(head.Shots), len(bundle.Shots)))
	}
	seen := make(map[int]bool, len(head.Shots))
	kept := 0
	for _, shot := range head.Shots {
		if shot.Director != nil {
			if err := shot.Director.validate(); err != nil {
				return nil, BadAuthRequest(err.Error())
			}
		}
		if shot.ShotNumber < 1 || shot.ShotNumber > len(bundle.Shots) || seen[shot.ShotNumber] {
			return nil, BadAuthRequest("复刻方案的镜头编号和拆解结果对不上")
		}
		seen[shot.ShotNumber] = true
		if !videoReplicationPlanTreatments[shot.Treatment] {
			return nil, BadAuthRequest(fmt.Sprintf("镜头 %d 的处理方式无效", shot.ShotNumber))
		}
		if shot.Treatment == "original" && !head.Authorized {
			return nil, BadAuthRequest("沿用原片画面前，请先确认这是你自己的视频或已获授权")
		}
		if shot.Treatment != "skip" {
			kept++
		}
	}
	if kept == 0 {
		return nil, BadAuthRequest("至少保留一个镜头")
	}
	if err := s.validateVideoReplicationPlanImages(userID, head); err != nil {
		return nil, err
	}
	if len(head.Canvases) > videoReplicationPlanMaxCanvases {
		return nil, BadAuthRequest(fmt.Sprintf("一个复刻方案最多记 %d 块画布", videoReplicationPlanMaxCanvases))
	}
	for _, canvas := range head.Canvases {
		if id := strings.TrimSpace(canvas.ID); id == "" || len(id) > 64 {
			return nil, BadAuthRequest("画布 ID 无效")
		}
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, payload); err != nil {
		return nil, BadAuthRequest("复刻方案格式无效")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return nil, err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "", false, int64(compacted.Len()), policy.Resource); err != nil {
		return nil, err
	}
	result := &model.Result{ID: newID(), UserID: userID, TaskID: task.ID, Kind: videoReplicationPlanKind, Payload: compacted.String(), CreatedAt: time.Now()}
	if err := s.repo.ReplaceTaskResult(result); err != nil {
		return nil, err
	}
	return s.VideoReplication(userID, task.ID)
}

func (s *Service) validateVideoReplicationPlanImages(userID string, head videoReplicationPlanHead) error {
	images := head.Product.Images
	if len(images) > videoReplicationPlanMaxImages {
		return BadAuthRequest(fmt.Sprintf("商品图最多 %d 张", videoReplicationPlanMaxImages))
	}
	ids := make([]string, 0, len(images))
	for _, image := range images {
		id := strings.TrimSpace(image.ResourceID)
		if id == "" || len(id) > 128 {
			return BadAuthRequest("商品图缺少资源 ID")
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	resources, err := s.repo.ResourcesForUserIDs(userID, ids)
	if err != nil {
		return err
	}
	owned := make(map[string]bool, len(resources))
	for _, resource := range resources {
		if resource.Status == model.ResourceStatusReady && (strings.HasPrefix(resource.MimeType, "image/") || resource.Kind == "image") {
			owned[resource.ID] = true
		}
	}
	for _, id := range ids {
		if !owned[id] {
			return BadAuthRequest("商品图不存在，或不是你的图片")
		}
	}
	return nil
}
