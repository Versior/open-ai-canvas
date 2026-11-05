package app

import (
	"cmp"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/interior"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 后台「室内设计」管理：近 30 天的出图统计和所有用户的出图记录（只读）。
// 统计按 UTC 自然日，和视频复刻管理、运行总览同一口径；出图次数按任务算，一个风格一次是一个任务。

const (
	adminInteriorWindowDays   = 30
	adminInteriorTrendDays    = 14
	adminInteriorStatsLimit   = 5000
	adminInteriorFailureLimit = 8
	adminInteriorTopLimit     = 10
	adminInteriorKeywordLimit = 100
)

// AdminInteriorCount 是一个出图方式、风格或空间在统计窗口里的出图次数，Failed 是其中失败的。
type AdminInteriorCount struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Total  int64  `json:"total"`
	Failed int64  `json:"failed"`
}

type AdminInteriorDay struct {
	Date   string `json:"date"`
	Total  int64  `json:"total"`
	Failed int64  `json:"failed"`
}

type AdminInteriorFailure struct {
	ID        string             `json:"id"`
	User      AdminUserReference `json:"user"`
	ModeName  string             `json:"modeName,omitempty"`
	Error     string             `json:"error"`
	CreatedAt time.Time          `json:"createdAt"`
}

// AdminInteriorGenerationStats 是统计窗口里的出图任务数：按状态、近 7 天、今天、出过图的人数和两种交互模式。
type AdminInteriorGenerationStats struct {
	Total     int64 `json:"total"`
	Queued    int64 `json:"queued"`
	Running   int64 `json:"running"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Cancelled int64 `json:"cancelled"`
	Users     int64 `json:"users"`
	Last7Days int64 `json:"last7Days"`
	Today     int64 `json:"today"`
	Quick     int64 `json:"quick"`
	Pro       int64 `json:"pro"`
}

type AdminInteriorProjectStats struct {
	Total  int64 `json:"total"`
	Home   int64 `json:"home"`
	Client int64 `json:"client"`
	Users  int64 `json:"users"`
}

// AdminInteriorConfigHint 是配置上的提醒：站点默认模型有没有设，哪些开着的出图方式没有自己的默认模型。
type AdminInteriorConfigHint struct {
	SiteDefaultModel  bool     `json:"siteDefaultModel"`
	EnabledModes      int      `json:"enabledModes"`
	ModesWithoutModel []string `json:"modesWithoutModel"`
}

type AdminInteriorOverview struct {
	WindowDays     int                          `json:"windowDays"`
	Truncated      bool                         `json:"truncated"`
	Generations    AdminInteriorGenerationStats `json:"generations"`
	Projects       AdminInteriorProjectStats    `json:"projects"`
	Config         AdminInteriorConfigHint      `json:"config"`
	Daily          []AdminInteriorDay           `json:"daily"`
	Modes          []AdminInteriorCount         `json:"modes"`
	Styles         []AdminInteriorCount         `json:"styles"`
	Rooms          []AdminInteriorCount         `json:"rooms"`
	Models         []AdminInteriorCount         `json:"models"`
	RecentFailures []AdminInteriorFailure       `json:"recentFailures"`
}

type AdminInteriorGenerationQuery struct {
	Status  string
	Keyword string
	Mode    string
	Page    int
	Limit   int
}

// AdminInteriorGeneration 是后台列表的一条：谁、用什么方式出的图，原图、参考图和效果图，失败原因不做用户侧改写。
type AdminInteriorGeneration struct {
	ID                   string             `json:"id"`
	User                 AdminUserReference `json:"user"`
	Status               model.TaskStatus   `json:"status"`
	Stage                string             `json:"stage,omitempty"`
	Progress             int                `json:"progress"`
	Error                string             `json:"error,omitempty"`
	ModeKey              string             `json:"modeKey,omitempty"`
	ModeName             string             `json:"modeName,omitempty"`
	Surface              string             `json:"surface,omitempty"`
	RoomName             string             `json:"roomName,omitempty"`
	StyleName            string             `json:"styleName,omitempty"`
	Model                string             `json:"model,omitempty"`
	SourceResourceID     string             `json:"sourceResourceId,omitempty"`
	ReferenceResourceIDs []string           `json:"referenceResourceIds"`
	OutputResourceIDs    []string           `json:"outputResourceIds"`
	ProjectID            string             `json:"projectId,omitempty"`
	CreatedAt            time.Time          `json:"createdAt"`
	CompletedAt          *time.Time         `json:"completedAt,omitempty"`
}

type AdminInteriorGenerationPage struct {
	Records []AdminInteriorGeneration `json:"records"`
	Total   int64                     `json:"total"`
	Page    int                       `json:"page"`
	Limit   int                       `json:"pageSize"`
}

// AdminInteriorGenerationDetail 另带服务端拼好的完整提示词、参数和所属项目名。
type AdminInteriorGenerationDetail struct {
	AdminInteriorGeneration
	Prompt      string            `json:"prompt"`
	Params      map[string]string `json:"params"`
	ProjectName string            `json:"projectName,omitempty"`
}

// interiorTaskFacts 是从任务输入里读出的室内设计信息；输入由 createInteriorTask 写入。
type interiorTaskFacts struct {
	Prompt          string `json:"prompt"`
	ReferenceImages []struct {
		ResourceID string `json:"resourceId"`
		SlotKey    string `json:"slotKey"`
	} `json:"referenceImages"`
	Metadata struct {
		Interior struct {
			ModeKey   string            `json:"modeKey"`
			Surface   string            `json:"surface"`
			RoomKey   string            `json:"roomKey"`
			StyleKey  string            `json:"styleKey"`
			ProjectID string            `json:"projectId"`
			Params    map[string]string `json:"params"`
		} `json:"interior"`
	} `json:"metadata"`
}

func parseInteriorTaskFacts(raw string) interiorTaskFacts {
	var facts interiorTaskFacts
	_ = json.Unmarshal([]byte(raw), &facts)
	return facts
}

// interiorCatalogNames 是出图方式、风格和空间的机器标识到名称；停用和自定义的也在内，旧记录照样显示名称。
type interiorCatalogNames struct {
	modes  map[string]string
	styles map[string]string
	rooms  map[string]string
}

func (s *Service) interiorCatalogNames() (interiorCatalogNames, []model.InteriorMode, error) {
	names := interiorCatalogNames{modes: map[string]string{}, styles: map[string]string{}, rooms: map[string]string{}}
	modes, err := s.repo.InteriorModes(false)
	if err != nil {
		return names, nil, err
	}
	for _, item := range modes {
		names.modes[item.Key] = item.Name
	}
	presets, err := s.repo.InteriorPresets("", false)
	if err != nil {
		return names, nil, err
	}
	for _, item := range presets {
		switch item.Type {
		case interior.PresetStyle:
			names.styles[item.Key] = item.Name
		case interior.PresetRoom:
			names.rooms[item.Key] = item.Name
		}
	}
	return names, modes, nil
}

func nameOr(names map[string]string, key string) string {
	if name := names[key]; name != "" {
		return name
	}
	return key
}

// interiorOutputResourceIDs 读生图任务结果里的图片资源。
func interiorOutputResourceIDs(resultJSON string) []string {
	var result struct {
		Images []struct {
			ResourceID string `json:"resourceId"`
		} `json:"images"`
	}
	ids := []string{}
	if json.Unmarshal([]byte(resultJSON), &result) != nil {
		return ids
	}
	for _, image := range result.Images {
		if id := strings.TrimSpace(image.ResourceID); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func interiorGenerationFrom(task model.Task, facts interiorTaskFacts, names interiorCatalogNames, users map[string]model.User) AdminInteriorGeneration {
	meta := facts.Metadata.Interior
	item := AdminInteriorGeneration{
		ID: task.ID, User: adminUserReferenceFor(users, task.UserID), Status: task.Status, Stage: task.Stage, Progress: task.Progress, Error: task.Error,
		ModeKey: meta.ModeKey, Surface: meta.Surface, Model: task.Model, ProjectID: meta.ProjectID,
		ReferenceResourceIDs: []string{}, OutputResourceIDs: interiorOutputResourceIDs(task.ResultJSON), CreatedAt: task.CreatedAt, CompletedAt: task.CompletedAt,
	}
	if meta.ModeKey != "" {
		item.ModeName = nameOr(names.modes, meta.ModeKey)
	}
	if meta.RoomKey != "" {
		item.RoomName = nameOr(names.rooms, meta.RoomKey)
	}
	if meta.StyleKey != "" {
		item.StyleName = nameOr(names.styles, meta.StyleKey)
	}
	for _, ref := range facts.ReferenceImages {
		switch {
		case ref.ResourceID == "":
		case ref.SlotKey == interior.SlotSource && item.SourceResourceID == "":
			item.SourceResourceID = ref.ResourceID
		default:
			item.ReferenceResourceIDs = append(item.ReferenceResourceIDs, ref.ResourceID)
		}
	}
	return item
}

func (s *Service) adminInteriorUsers(tasks []model.Task) (map[string]model.User, error) {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if !slices.Contains(ids, task.UserID) {
			ids = append(ids, task.UserID)
		}
	}
	return s.repo.UsersByIDs(ids)
}

// addInteriorCount 给按标识计数的格子加一次；空标识（例如不需要风格的出图方式）不计。
func addInteriorCount(counts map[string]*AdminInteriorCount, key, name string, failed bool) {
	if key == "" {
		return
	}
	entry := counts[key]
	if entry == nil {
		entry = &AdminInteriorCount{Key: key, Name: name}
		counts[key] = entry
	}
	entry.Total++
	if failed {
		entry.Failed++
	}
}

func sortedInteriorCounts(counts map[string]*AdminInteriorCount, limit int) []AdminInteriorCount {
	items := make([]AdminInteriorCount, 0, len(counts))
	for _, entry := range counts {
		items = append(items, *entry)
	}
	slices.SortFunc(items, func(left, right AdminInteriorCount) int {
		return cmp.Or(cmp.Compare(right.Total, left.Total), strings.Compare(left.Key, right.Key))
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items
}

// AdminInteriorOverview 统计近 30 天的室内设计出图；任务太多时只算最新的 5000 条并标明 Truncated。
// 功能开关关着时也能看，方便开放前核对配置。
func (s *Service) AdminInteriorOverview(actor *model.User) (*AdminInteriorOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	names, modes, err := s.interiorCatalogNames()
	if err != nil {
		return nil, err
	}
	settings, err := s.interiorSettings()
	if err != nil {
		return nil, err
	}
	overview := &AdminInteriorOverview{WindowDays: adminInteriorWindowDays, Daily: []AdminInteriorDay{}, RecentFailures: []AdminInteriorFailure{}, Config: AdminInteriorConfigHint{SiteDefaultModel: settings.DefaultModel != nil, ModesWithoutModel: []string{}}}
	for _, mode := range modes {
		if !mode.Enabled {
			continue
		}
		overview.Config.EnabledModes++
		var ref *interior.ModelRef
		if strings.TrimSpace(mode.DefaultModelJSON) != "" && json.Unmarshal([]byte(mode.DefaultModelJSON), &ref) == nil && ref != nil && ref.Model != "" {
			continue
		}
		overview.Config.ModesWithoutModel = append(overview.Config.ModesWithoutModel, mode.Name)
	}
	totals, err := s.repo.InteriorProjectTotals()
	if err != nil {
		return nil, err
	}
	overview.Projects = AdminInteriorProjectStats{Total: totals.Total, Home: totals.Home, Client: totals.Client, Users: totals.Users}

	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	windowStart := today.AddDate(0, 0, -(adminInteriorWindowDays - 1))
	tasks, err := s.repo.InteriorTasksBetween(windowStart, today.AddDate(0, 0, 1), adminInteriorStatsLimit+1)
	if err != nil {
		return nil, err
	}
	if len(tasks) > adminInteriorStatsLimit {
		tasks, overview.Truncated = tasks[:adminInteriorStatsLimit], true
	}
	trendStart := today.AddDate(0, 0, -(adminInteriorTrendDays - 1))
	days := make(map[string]int, adminInteriorTrendDays)
	for day := trendStart; !day.After(today); day = day.AddDate(0, 0, 1) {
		days[day.Format("2006-01-02")] = len(overview.Daily)
		overview.Daily = append(overview.Daily, AdminInteriorDay{Date: day.Format("2006-01-02")})
	}
	weekStart := today.AddDate(0, 0, -6)
	users := map[string]bool{}
	modeCounts, styleCounts, roomCounts, modelCounts := map[string]*AdminInteriorCount{}, map[string]*AdminInteriorCount{}, map[string]*AdminInteriorCount{}, map[string]*AdminInteriorCount{}
	failures := []model.Task{}
	failureFacts := map[string]interiorTaskFacts{}
	stats := &overview.Generations
	for _, task := range tasks {
		facts := parseInteriorTaskFacts(task.InputJSON)
		meta := facts.Metadata.Interior
		failed := task.Status == model.TaskStatusFailed
		stats.Total++
		switch task.Status {
		case model.TaskStatusQueued:
			stats.Queued++
		case model.TaskStatusRunning:
			stats.Running++
		case model.TaskStatusSucceeded:
			stats.Succeeded++
		case model.TaskStatusFailed:
			stats.Failed++
		case model.TaskStatusCancelled:
			stats.Cancelled++
		}
		switch meta.Surface {
		case interior.SurfaceQuick:
			stats.Quick++
		case interior.SurfacePro:
			stats.Pro++
		}
		users[task.UserID] = true
		created := task.CreatedAt.UTC()
		if !created.Before(weekStart) {
			stats.Last7Days++
		}
		if !created.Before(today) {
			stats.Today++
		}
		if index, found := days[created.Format("2006-01-02")]; found {
			overview.Daily[index].Total++
			if failed {
				overview.Daily[index].Failed++
			}
		}
		addInteriorCount(modeCounts, meta.ModeKey, nameOr(names.modes, meta.ModeKey), failed)
		addInteriorCount(styleCounts, meta.StyleKey, nameOr(names.styles, meta.StyleKey), failed)
		addInteriorCount(roomCounts, meta.RoomKey, nameOr(names.rooms, meta.RoomKey), failed)
		addInteriorCount(modelCounts, task.Model, modelDisplayLabel(task.Model), failed)
		if failed && len(failures) < adminInteriorFailureLimit {
			failures = append(failures, task)
			failureFacts[task.ID] = facts
		}
	}
	stats.Users = int64(len(users))
	overview.Modes = sortedInteriorCounts(modeCounts, 0)
	overview.Styles = sortedInteriorCounts(styleCounts, adminInteriorTopLimit)
	overview.Rooms = sortedInteriorCounts(roomCounts, adminInteriorTopLimit)
	overview.Models = sortedInteriorCounts(modelCounts, adminInteriorTopLimit)

	owners, err := s.adminInteriorUsers(failures)
	if err != nil {
		return nil, err
	}
	for _, task := range failures {
		failure := AdminInteriorFailure{ID: task.ID, User: adminUserReferenceFor(owners, task.UserID), Error: task.Error, CreatedAt: task.CreatedAt}
		if key := failureFacts[task.ID].Metadata.Interior.ModeKey; key != "" {
			failure.ModeName = nameOr(names.modes, key)
		}
		overview.RecentFailures = append(overview.RecentFailures, failure)
	}
	return overview, nil
}

// modelDisplayLabel 去掉系统渠道前缀（CHANNEL_000005::gpt-image-2），统计里按模型名显示。
func modelDisplayLabel(value string) string {
	if index := strings.LastIndex(value, "::"); index >= 0 {
		return value[index+2:]
	}
	return value
}

// AdminInteriorGenerations 按时间倒序列出所有用户的室内设计出图，可按状态、出图方式和用户（用户名、昵称、邮箱）或任务 ID 筛选。
func (s *Service) AdminInteriorGenerations(actor *model.User, query AdminInteriorGenerationQuery) (*AdminInteriorGenerationPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	status, err := adminVideoReplicationStatus(query.Status)
	if err != nil {
		return nil, BadAuthRequest("状态筛选只能是排队中、生成中、已完成、失败或已取消")
	}
	keyword := strings.TrimSpace(query.Keyword)
	if len([]rune(keyword)) > adminInteriorKeywordLimit {
		return nil, BadAuthRequest("搜索内容最多 100 个字")
	}
	modeKey := strings.TrimSpace(query.Mode)
	if modeKey == "all" {
		modeKey = ""
	}
	if modeKey != "" && !interior.ValidKey(modeKey) {
		return nil, BadAuthRequest("出图方式筛选无效")
	}
	names, _, err := s.interiorCatalogNames()
	if err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	tasks, total, err := s.repo.AdminInteriorTasks(repository.AdminInteriorTaskFilter{Status: status, Keyword: keyword, ModeKey: modeKey, Limit: limit, Offset: (page - 1) * limit})
	if err != nil {
		return nil, err
	}
	users, err := s.adminInteriorUsers(tasks)
	if err != nil {
		return nil, err
	}
	records := make([]AdminInteriorGeneration, 0, len(tasks))
	for _, task := range tasks {
		records = append(records, interiorGenerationFrom(task, parseInteriorTaskFacts(task.InputJSON), names, users))
	}
	return &AdminInteriorGenerationPage{Records: records, Total: total, Page: page, Limit: limit}, nil
}

// AdminInteriorGeneration 读一条任意用户的室内设计出图：原图、参考图、效果图、完整提示词、参数和所属项目。
func (s *Service) AdminInteriorGeneration(actor *model.User, taskID string) (*AdminInteriorGenerationDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || len(taskID) > 128 {
		return nil, NotFound("出图记录不存在")
	}
	task, err := s.repo.AdminInteriorTask(taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("出图记录不存在")
	}
	if err != nil {
		return nil, err
	}
	names, _, err := s.interiorCatalogNames()
	if err != nil {
		return nil, err
	}
	users, err := s.repo.UsersByIDs([]string{task.UserID})
	if err != nil {
		return nil, err
	}
	facts := parseInteriorTaskFacts(task.InputJSON)
	detail := &AdminInteriorGenerationDetail{AdminInteriorGeneration: interiorGenerationFrom(*task, facts, names, users), Prompt: facts.Prompt, Params: facts.Metadata.Interior.Params}
	if detail.Params == nil {
		detail.Params = map[string]string{}
	}
	if detail.ProjectID != "" {
		projects, err := s.repo.InteriorProjectNames([]string{detail.ProjectID})
		if err != nil {
			return nil, err
		}
		detail.ProjectName = projects[detail.ProjectID]
	}
	return detail, nil
}
