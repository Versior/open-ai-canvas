package app

import (
	"cmp"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 后台「视频复刻」管理：所有用户的拆解记录（只读）、拆解与链接导入的使用统计。
// 统计按 UTC 自然日，和后台运行总览同一口径。

const (
	adminVideoReplicationTrendDays    = 14
	adminVideoReplicationFailureLimit = 8
	adminVideoReplicationKeywordLimit = 100
)

// AdminVideoReplicationTaskStats 是一类任务（拆解或链接导入）的数量：按状态、近 7 天、今天和用过的人数。
type AdminVideoReplicationTaskStats struct {
	Total     int64 `json:"total"`
	Queued    int64 `json:"queued"`
	Running   int64 `json:"running"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Cancelled int64 `json:"cancelled"`
	Users     int64 `json:"users"`
	Last7Days int64 `json:"last7Days"`
	Today     int64 `json:"today"`
}

func (stats *AdminVideoReplicationTaskStats) add(status model.TaskStatus, count int64) {
	stats.Total += count
	switch status {
	case model.TaskStatusQueued:
		stats.Queued += count
	case model.TaskStatusRunning:
		stats.Running += count
	case model.TaskStatusSucceeded:
		stats.Succeeded += count
	case model.TaskStatusFailed:
		stats.Failed += count
	case model.TaskStatusCancelled:
		stats.Cancelled += count
	}
}

// AdminVideoReplicationPlatformStat 是一个平台的链接导入次数。
type AdminVideoReplicationPlatformStat struct {
	Platform  string `json:"platform"`
	Name      string `json:"name"`
	Total     int64  `json:"total"`
	Succeeded int64  `json:"succeeded"`
	Failed    int64  `json:"failed"`
}

// AdminVideoReplicationDay 是一天里新建的拆解和链接导入任务数，Failed 是其中已失败的。
type AdminVideoReplicationDay struct {
	Date      string `json:"date"`
	Teardowns int64  `json:"teardowns"`
	Imports   int64  `json:"imports"`
	Failed    int64  `json:"failed"`
}

// AdminVideoReplicationFailure 是最近失败的一次拆解或链接导入；Kind 为 teardown 或 import。
type AdminVideoReplicationFailure struct {
	ID        string             `json:"id"`
	Kind      string             `json:"kind"`
	Platform  string             `json:"platform,omitempty"`
	User      AdminUserReference `json:"user"`
	Error     string             `json:"error"`
	CreatedAt time.Time          `json:"createdAt"`
}

type AdminVideoReplicationOverview struct {
	Settings        VideoReplicationSettings            `json:"settings"`
	Transcription   VideoReplicationTranscription       `json:"transcription"`
	Teardowns       AdminVideoReplicationTaskStats      `json:"teardowns"`
	Imports         AdminVideoReplicationTaskStats      `json:"imports"`
	Analyzed        int64                               `json:"analyzed"`
	ImportPlatforms []AdminVideoReplicationPlatformStat `json:"importPlatforms"`
	Daily           []AdminVideoReplicationDay          `json:"daily"`
	RecentFailures  []AdminVideoReplicationFailure      `json:"recentFailures"`
}

type AdminVideoReplicationQuery struct {
	Status  string
	Keyword string
	Page    int
	Limit   int
}

// AdminVideoReplicationRecord 是后台列表的一条：用户侧的记录字段，加上是谁的、口播来源和拆解提示。
type AdminVideoReplicationRecord struct {
	VideoReplicationRecord
	User      AdminUserReference `json:"user"`
	ProjectID string             `json:"projectId,omitempty"`
	// Transcript 是口播来源：asr 为语音转写，none 为没有转写；任务没完成时为空。
	Transcript string `json:"transcript,omitempty"`
	// TranscriptNote 是没有转写的原因；Warnings 是其余的拆解提示，不再重复口播的原因。
	TranscriptNote string     `json:"transcriptNote,omitempty"`
	Warnings       []string   `json:"warnings,omitempty"`
	CompletedAt    *time.Time `json:"completedAt,omitempty"`
}

type AdminVideoReplicationPage struct {
	Records []AdminVideoReplicationRecord `json:"records"`
	Total   int64                         `json:"total"`
	Page    int                           `json:"page"`
	Limit   int                           `json:"pageSize"`
}

// AdminVideoReplicationDetail 是一条记录的全部内容和它的主人；任务的失败原因不做用户侧的改写。
type AdminVideoReplicationDetail struct {
	VideoReplicationDetail
	User AdminUserReference `json:"user"`
}

func adminUserReferenceFor(users map[string]model.User, id string) AdminUserReference {
	user, found := users[id]
	if !found {
		return AdminUserReference{ID: id}
	}
	return AdminUserReference{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName}
}

func (s *Service) AdminVideoReplicationOverview(actor *model.User) (*AdminVideoReplicationOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	settings, err := s.videoReplicationSettings()
	if err != nil {
		return nil, err
	}
	transcription, err := s.videoReplicationTranscription(settings)
	if err != nil {
		return nil, err
	}
	overview := &AdminVideoReplicationOverview{Settings: settings, Transcription: transcription, ImportPlatforms: []AdminVideoReplicationPlatformStat{}, Daily: []AdminVideoReplicationDay{}, RecentFailures: []AdminVideoReplicationFailure{}}
	types := []string{model.TaskTypeReplicationTeardown, model.TaskTypeSocialVideoImport}

	counts, err := s.repo.TaskCountsByTypeStatusProvider(types)
	if err != nil {
		return nil, err
	}
	platforms := map[string]*AdminVideoReplicationPlatformStat{}
	for _, row := range counts {
		if row.Type == model.TaskTypeReplicationTeardown {
			overview.Teardowns.add(row.Status, row.Count)
			continue
		}
		overview.Imports.add(row.Status, row.Count)
		stat := platforms[row.Provider]
		if stat == nil {
			stat = &AdminVideoReplicationPlatformStat{Platform: row.Provider, Name: row.Provider}
			if info := socialVideoPlatformByID(row.Provider); info != nil {
				stat.Name = info.Name
			}
			platforms[row.Provider] = stat
		}
		stat.Total += row.Count
		switch row.Status {
		case model.TaskStatusSucceeded:
			stat.Succeeded += row.Count
		case model.TaskStatusFailed:
			stat.Failed += row.Count
		}
	}
	for _, stat := range platforms {
		overview.ImportPlatforms = append(overview.ImportPlatforms, *stat)
	}
	slices.SortFunc(overview.ImportPlatforms, func(left, right AdminVideoReplicationPlatformStat) int {
		return cmp.Or(cmp.Compare(right.Total, left.Total), strings.Compare(left.Platform, right.Platform))
	})
	if overview.Teardowns.Users, err = s.repo.DistinctTaskUserCount(model.TaskTypeReplicationTeardown); err != nil {
		return nil, err
	}
	if overview.Imports.Users, err = s.repo.DistinctTaskUserCount(model.TaskTypeSocialVideoImport); err != nil {
		return nil, err
	}
	if overview.Analyzed, err = s.repo.CountTasksWithResult(model.TaskTypeReplicationTeardown, videoReplicationAnalysisKind); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	from := today.AddDate(0, 0, -(adminVideoReplicationTrendDays - 1))
	// 每天的数量在数据库里分组算好，这里只按日期填进 14 天的格子（没有任务的日子是 0）。
	dailyCounts, err := s.repo.TaskDailyCountsByTypes(types, from, today.AddDate(0, 0, 1))
	if err != nil {
		return nil, err
	}
	days := make(map[string]int, adminVideoReplicationTrendDays)
	for day := from; !day.After(today); day = day.AddDate(0, 0, 1) {
		days[day.Format("2006-01-02")] = len(overview.Daily)
		overview.Daily = append(overview.Daily, AdminVideoReplicationDay{Date: day.Format("2006-01-02")})
	}
	weekStart := today.AddDate(0, 0, -6)
	for _, row := range dailyCounts {
		day := time.Unix(row.Day*86400, 0).UTC()
		index, found := days[day.Format("2006-01-02")]
		if !found {
			continue
		}
		stats := &overview.Teardowns
		if row.Type == model.TaskTypeReplicationTeardown {
			overview.Daily[index].Teardowns += row.Count
		} else {
			overview.Daily[index].Imports += row.Count
			stats = &overview.Imports
		}
		if row.Status == model.TaskStatusFailed {
			overview.Daily[index].Failed += row.Count
		}
		if !day.Before(weekStart) {
			stats.Last7Days += row.Count
		}
		if !day.Before(today) {
			stats.Today += row.Count
		}
	}

	failures, err := s.repo.RecentFailedTasksByTypes(types, adminVideoReplicationFailureLimit)
	if err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(failures))
	for _, task := range failures {
		if !slices.Contains(userIDs, task.UserID) {
			userIDs = append(userIDs, task.UserID)
		}
	}
	users, err := s.repo.UsersByIDs(userIDs)
	if err != nil {
		return nil, err
	}
	for _, task := range failures {
		failure := AdminVideoReplicationFailure{ID: task.ID, Kind: "teardown", User: adminUserReferenceFor(users, task.UserID), Error: task.Error, CreatedAt: task.CreatedAt}
		if task.Type == model.TaskTypeSocialVideoImport {
			failure.Kind, failure.Platform = "import", task.Provider
		}
		overview.RecentFailures = append(overview.RecentFailures, failure)
	}
	return overview, nil
}

func adminVideoReplicationStatus(value string) (model.TaskStatus, error) {
	switch status := model.TaskStatus(strings.TrimSpace(value)); status {
	case "", "all":
		return "", nil
	case model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled:
		return status, nil
	default:
		return "", BadAuthRequest("状态筛选只能是排队中、拆解中、已完成、失败或已取消")
	}
}

// AdminVideoReplications 按时间倒序列出所有用户的拆解记录，可按状态和用户（用户名、昵称、邮箱）或任务 ID 筛选。
func (s *Service) AdminVideoReplications(actor *model.User, query AdminVideoReplicationQuery) (*AdminVideoReplicationPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	status, err := adminVideoReplicationStatus(query.Status)
	if err != nil {
		return nil, err
	}
	keyword := strings.TrimSpace(query.Keyword)
	if len([]rune(keyword)) > adminVideoReplicationKeywordLimit {
		return nil, BadAuthRequest("搜索内容最多 100 个字")
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	tasks, total, err := s.repo.AdminTasksByType(repository.AdminTypedTaskFilter{Type: model.TaskTypeReplicationTeardown, Status: status, Keyword: keyword, Limit: limit, Offset: (page - 1) * limit})
	if err != nil {
		return nil, err
	}
	results, err := s.repo.ResultsByKindForTasks(idsOfTasks(tasks), videoReplicationAnalysisKind)
	if err != nil {
		return nil, err
	}
	analyses := latestResultsByTask(results)
	userIDs := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if !slices.Contains(userIDs, task.UserID) {
			userIDs = append(userIDs, task.UserID)
		}
	}
	users, err := s.repo.UsersByIDs(userIDs)
	if err != nil {
		return nil, err
	}
	records := make([]AdminVideoReplicationRecord, 0, len(tasks))
	for _, task := range tasks {
		record, bundle := videoReplicationRecordFrom(task, analyses[task.ID])
		item := AdminVideoReplicationRecord{VideoReplicationRecord: record, User: adminUserReferenceFor(users, task.UserID), ProjectID: task.ProjectID, CompletedAt: task.CompletedAt}
		if bundle != nil {
			item.Transcript = bundle.Transcript.Source
			item.TranscriptNote, item.Warnings = bundle.transcriptNoteAndWarnings()
		}
		records = append(records, item)
	}
	return &AdminVideoReplicationPage{Records: records, Total: total, Page: page, Limit: limit}, nil
}

// AdminVideoReplication 读一条任意用户的拆解记录：镜头事实、保存过的分析和主人。
func (s *Service) AdminVideoReplication(actor *model.User, taskID string) (*AdminVideoReplicationDetail, error) {
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
	output := taskForOutput(*task)
	output.Error = task.Error
	detail := &AdminVideoReplicationDetail{VideoReplicationDetail: VideoReplicationDetail{Task: output}}
	results, err := s.repo.ResultsByKindForTasks([]string{task.ID}, videoReplicationAnalysisKind)
	if err != nil {
		return nil, err
	}
	if len(results) > 0 {
		detail.Analysis = json.RawMessage(results[0].Payload)
		analyzedAt := results[0].CreatedAt
		detail.AnalyzedAt = &analyzedAt
	}
	users, err := s.repo.UsersByIDs([]string{task.UserID})
	if err != nil {
		return nil, err
	}
	detail.User = adminUserReferenceFor(users, task.UserID)
	return detail, nil
}
