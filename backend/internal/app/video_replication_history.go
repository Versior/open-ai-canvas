package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 视频复刻页面的历史记录。拆解任务的 ResultJSON 是程序算出的镜头事实；看图模型的分析在前端完成
// （走普通文本生成任务计费），解析好以后存进 results 表：kind=replication_analysis，task_id 指向拆解任务，
// 每个任务只留最新一份。

const (
	videoReplicationAnalysisKind     = "replication_analysis"
	videoReplicationAnalysisMaxBytes = 512 << 10
	videoReplicationHistoryLimit     = 50
	// videoReplicationPreviewFrames：列表卡片上的胶片条最多放几张关键帧，均匀取自全片。
	videoReplicationPreviewFrames = 4
)

// VideoReplicationRecord 是历史列表的一条：拆解任务的状态，加上分析结果的标题和所用模型。
type VideoReplicationRecord struct {
	ID              string           `json:"id"`
	Status          model.TaskStatus `json:"status"`
	Stage           string           `json:"stage"`
	Progress        int              `json:"progress"`
	Error           string           `json:"error,omitempty"`
	CreatedAt       time.Time        `json:"createdAt"`
	DurationMs      int64            `json:"durationMs"`
	ShotCount       int              `json:"shotCount"`
	CoverResourceID string           `json:"coverResourceId,omitempty"`
	// PreviewResourceIDs 是均匀取自全片的几张关键帧，Width / Height 是原视频画幅。
	PreviewResourceIDs []string   `json:"previewResourceIds,omitempty"`
	Width              int        `json:"width,omitempty"`
	Height             int        `json:"height,omitempty"`
	Title              string     `json:"title,omitempty"`
	Model              string     `json:"model,omitempty"`
	AnalyzedAt         *time.Time `json:"analyzedAt,omitempty"`
}

// VideoReplicationDetail 是一条记录的全部内容：拆解任务（resultJson 里是镜头事实）和保存过的分析。
type VideoReplicationDetail struct {
	Task       *model.Task     `json:"task"`
	Analysis   json.RawMessage `json:"analysis,omitempty"`
	AnalyzedAt *time.Time      `json:"analyzedAt,omitempty"`
}

// videoReplicationAnalysisHead 只取校验和列表要用的字段；画面描述等语义字段由前端负责。
type videoReplicationAnalysisHead struct {
	Version int               `json:"version"`
	Title   string            `json:"title"`
	Model   string            `json:"model"`
	Rows    []json.RawMessage `json:"rows"`
}

// VideoReplications 列出本人最近的拆解记录；视频复刻关闭时和创建拆解一样返回 403。
func (s *Service) VideoReplications(userID string) ([]VideoReplicationRecord, error) {
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return nil, err
	}
	tasks, err := s.repo.TasksForUserByType(userID, model.TaskTypeReplicationTeardown, videoReplicationHistoryLimit)
	if err != nil {
		return nil, err
	}
	results, err := s.repo.TaskResultsByKind(userID, idsOfTasks(tasks), videoReplicationAnalysisKind)
	if err != nil {
		return nil, err
	}
	analyses := latestResultsByTask(results)
	records := make([]VideoReplicationRecord, 0, len(tasks))
	for _, task := range tasks {
		record, _ := videoReplicationRecordFrom(task, analyses[task.ID])
		record.Error = taskForOutput(task).Error
		records = append(records, record)
	}
	return records, nil
}

func idsOfTasks(tasks []model.Task) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}

// latestResultsByTask 把按时间倒序的结果按任务收成一条（最新的）。
func latestResultsByTask(results []model.Result) map[string]*model.Result {
	latest := make(map[string]*model.Result, len(results))
	for index := range results {
		if _, seen := latest[results[index].TaskID]; !seen {
			latest[results[index].TaskID] = &results[index]
		}
	}
	return latest
}

// videoReplicationRecordFrom 由拆解任务和保存过的分析（可以没有）拼出列表里的一条；第二个返回值是解析出的镜头事实，任务没完成时为空。
// Error 是任务原始的失败原因，给普通用户看之前要换成 taskForOutput 处理过的。
func videoReplicationRecordFrom(task model.Task, analysis *model.Result) (VideoReplicationRecord, *videoTeardownBundle) {
	record := VideoReplicationRecord{ID: task.ID, Status: task.Status, Stage: task.Stage, Progress: task.Progress, Error: task.Error, CreatedAt: task.CreatedAt}
	var bundle *videoTeardownBundle
	var parsed videoTeardownBundle
	if task.Status == model.TaskStatusSucceeded && json.Unmarshal([]byte(task.ResultJSON), &parsed) == nil {
		bundle = &parsed
		record.DurationMs = parsed.Source.DurationMs
		record.ShotCount = len(parsed.Shots)
		record.Width, record.Height = parsed.Source.Width, parsed.Source.Height
		if len(parsed.Shots) > 0 {
			record.CoverResourceID = parsed.Shots[0].KeyframeResourceID
		}
		count := min(len(parsed.Shots), videoReplicationPreviewFrames)
		for index := range count {
			record.PreviewResourceIDs = append(record.PreviewResourceIDs, parsed.Shots[index*len(parsed.Shots)/count].KeyframeResourceID)
		}
	}
	if analysis != nil {
		var head videoReplicationAnalysisHead
		if json.Unmarshal([]byte(analysis.Payload), &head) == nil {
			record.Title, record.Model = head.Title, head.Model
		}
		analyzedAt := analysis.CreatedAt
		record.AnalyzedAt = &analyzedAt
	}
	return record, bundle
}

func (s *Service) VideoReplication(userID, taskID string) (*VideoReplicationDetail, error) {
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return nil, err
	}
	task, err := s.replicationTeardownTask(userID, taskID)
	if err != nil {
		return nil, err
	}
	detail := &VideoReplicationDetail{Task: taskForOutput(*task)}
	results, err := s.repo.TaskResultsByKind(userID, []string{task.ID}, videoReplicationAnalysisKind)
	if err != nil {
		return nil, err
	}
	if len(results) > 0 {
		detail.Analysis = json.RawMessage(results[0].Payload)
		analyzedAt := results[0].CreatedAt
		detail.AnalyzedAt = &analyzedAt
	}
	return detail, nil
}

// SaveVideoReplicationAnalysis 保存前端解析好的模型分析。只接受本人已完成的拆解任务；
// 镜头行数和编号必须与拆解结果一一对应，缺镜头、多出来的行或重复编号都拒绝。
func (s *Service) SaveVideoReplicationAnalysis(userID, taskID string, payload []byte) (*VideoReplicationDetail, error) {
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return nil, err
	}
	task, err := s.replicationTeardownTask(userID, taskID)
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusSucceeded {
		return nil, BadAuthRequest("拆解还没有完成，不能保存分析结果")
	}
	var bundle videoTeardownBundle
	if err := json.Unmarshal([]byte(task.ResultJSON), &bundle); err != nil || len(bundle.Shots) == 0 {
		return nil, BadAuthRequest("拆解结果无效，不能保存分析结果")
	}
	if len(payload) == 0 || len(payload) > videoReplicationAnalysisMaxBytes {
		return nil, BadAuthRequest("分析结果不能为空，也不能超过 512 KiB")
	}
	var head videoReplicationAnalysisHead
	if err := json.Unmarshal(payload, &head); err != nil || head.Version != 1 {
		return nil, BadAuthRequest("分析结果格式无效")
	}
	if strings.TrimSpace(head.Model) == "" || len([]rune(head.Model)) > 200 || len([]rune(head.Title)) > 200 {
		return nil, BadAuthRequest("分析结果缺少模型，或标题、模型名称过长")
	}
	if len(head.Rows) != len(bundle.Shots) {
		return nil, BadAuthRequest(fmt.Sprintf("分析结果有 %d 个镜头，拆解结果有 %d 个镜头", len(head.Rows), len(bundle.Shots)))
	}
	seen := make(map[int]bool, len(head.Rows))
	for _, raw := range head.Rows {
		var row struct {
			ShotNumber int `json:"shotNumber"`
		}
		if json.Unmarshal(raw, &row) != nil || row.ShotNumber < 1 || row.ShotNumber > len(bundle.Shots) || seen[row.ShotNumber] {
			return nil, BadAuthRequest("分析结果的镜头编号和拆解结果对不上")
		}
		seen[row.ShotNumber] = true
	}
	var compacted bytes.Buffer
	if err := json.Compact(&compacted, payload); err != nil {
		return nil, BadAuthRequest("分析结果格式无效")
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
	result := &model.Result{ID: newID(), UserID: userID, TaskID: task.ID, Kind: videoReplicationAnalysisKind, Payload: compacted.String(), CreatedAt: time.Now()}
	if err := s.repo.ReplaceTaskResult(result); err != nil {
		return nil, err
	}
	analyzedAt := result.CreatedAt
	return &VideoReplicationDetail{Task: taskForOutput(*task), Analysis: json.RawMessage(result.Payload), AnalyzedAt: &analyzedAt}, nil
}

func (s *Service) replicationTeardownTask(userID, taskID string) (*model.Task, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || len(taskID) > 128 {
		return nil, NotFound("拆解记录不存在")
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && task.Type != model.TaskTypeReplicationTeardown) {
		return nil, NotFound("拆解记录不存在")
	}
	if err != nil {
		return nil, err
	}
	return task, nil
}
