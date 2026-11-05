package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

const (
	socialVideoParseExportFormat  = "yingce.social-video-parse-apis"
	socialVideoParseSourceLimit   = 1 << 20
	socialVideoParseTestParallel  = 4
	socialVideoParseSourceTimeout = 20 * time.Second
)

// SocialVideoParseOverview 是后台「视频解析接口」页一次拿到的全部数据。
type SocialVideoParseOverview struct {
	Settings  SocialVideoParseSettings  `json:"settings"`
	APIs      []SocialVideoParseAPIView `json:"apis"`
	Sources   []SocialVideoParseSource  `json:"sources"`
	Platforms []SocialVideoPlatformView `json:"platforms"`
	Logs      []SocialVideoParseLog     `json:"logs"`
}

type SocialVideoParseTestRequest struct {
	ID       string                      `json:"id"`
	API      *SocialVideoParseAPIRequest `json:"api"`
	URL      string                      `json:"url"`
	Platform string                      `json:"platform"`
}

// SocialVideoParseTestResult 是测试一条接口的结果：哪一步失败、取到的字段、视频地址能不能打开，以及返回内容的开头。
type SocialVideoParseTestResult struct {
	ID              string                  `json:"id,omitempty"`
	Name            string                  `json:"name,omitempty"`
	OK              bool                    `json:"ok"`
	Stage           string                  `json:"stage,omitempty"`
	Message         string                  `json:"message"`
	Platform        string                  `json:"platform"`
	TestURL         string                  `json:"testUrl"`
	LatencyMs       int64                   `json:"latencyMs"`
	HTTPStatus      int                     `json:"httpStatus,omitempty"`
	Result          *socialVideoParseResult `json:"result,omitempty"`
	Media           *SocialVideoMediaCheck  `json:"media,omitempty"`
	ResponsePreview string                  `json:"responsePreview,omitempty"`
}

type SocialVideoParseBatchTestRequest struct {
	Platform string   `json:"platform"`
	IDs      []string `json:"ids"`
}

type SocialVideoParseBatchTestResult struct {
	Results []SocialVideoParseTestResult `json:"results"`
	Skipped []string                     `json:"skipped"`
}

type SocialVideoParseExport struct {
	Format     string                       `json:"format"`
	Version    int                          `json:"version"`
	ExportedAt time.Time                    `json:"exportedAt"`
	APIs       []SocialVideoParseAPIRequest `json:"apis"`
}

type SocialVideoParseImportRequest struct {
	Format     string                       `json:"format"`
	Version    int                          `json:"version"`
	APIs       []SocialVideoParseAPIRequest `json:"apis"`
	AutoEnable bool                         `json:"autoEnable"`
}

// SocialVideoParseImportResult 是导入或同步订阅的结果；新接口先停用，开了自动启用时测试通过才打开。
type SocialVideoParseImportResult struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Enabled int      `json:"enabled"`
	Errors  []string `json:"errors"`
}

func (s *Service) AdminSocialVideoParseOverview(actor *model.User) (*SocialVideoParseOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	settings, err := s.socialVideoParseSettings()
	if err != nil {
		return nil, err
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, err
	}
	state, err := s.socialVideoParseState()
	if err != nil {
		return nil, err
	}
	sources, err := s.socialVideoParseSources()
	if err != nil {
		return nil, err
	}
	platforms, err := s.SocialVideoPlatforms()
	if err != nil {
		return nil, err
	}
	views := make([]SocialVideoParseAPIView, 0, len(apis))
	for _, api := range apis {
		views = append(views, socialVideoParseAPIView(api, state.APIs[api.ID]))
	}
	if sources == nil {
		sources = []SocialVideoParseSource{}
	}
	logs := state.Logs
	if logs == nil {
		logs = []SocialVideoParseLog{}
	}
	return &SocialVideoParseOverview{Settings: settings, APIs: views, Sources: sources, Platforms: platforms, Logs: logs}, nil
}

func (s *Service) UpdateSocialVideoParseSettings(actor *model.User, req SocialVideoParseSettings) (SocialVideoParseSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return SocialVideoParseSettings{}, err
	}
	normalized, err := normalizeSocialVideoParseSettings(req)
	if err != nil {
		return SocialVideoParseSettings{}, err
	}
	before, _ := s.socialVideoParseSettings()
	saved, err := updateSettingJSON(s, socialVideoParseSettingsKey, actor.ID, func(value *SocialVideoParseSettings) error {
		*value = normalized
		return nil
	})
	if err != nil {
		return SocialVideoParseSettings{}, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.settings", "system_setting", socialVideoParseSettingsKey, "更新视频解析接口设置", map[string]any{"before": before, "after": saved})
	return saved, nil
}

func applySocialVideoParseDefinition(api *socialVideoParseAPI, req SocialVideoParseAPIRequest) {
	api.Name, api.Platforms, api.Priority, api.Weight = req.Name, req.Platforms, req.Priority, req.Weight
	api.Method, api.URL, api.BodyType, api.Body, api.Headers = req.Method, req.URL, req.BodyType, req.Body, req.Headers
	api.TimeoutSeconds, api.Mapping, api.DownloadHeaders, api.Remark = req.TimeoutSeconds, req.Mapping, req.DownloadHeaders, req.Remark
}

func (s *Service) CreateSocialVideoParseAPI(actor *model.User, req SocialVideoParseAPIRequest) (*SocialVideoParseAPIView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := normalizeSocialVideoParseAPIRequest(req)
	if err != nil {
		return nil, err
	}
	secret, err := s.encryptSettingSecret(strings.TrimSpace(normalized.Secret))
	if err != nil {
		return nil, err
	}
	var created socialVideoParseAPI
	_, err = updateSettingJSON(s, socialVideoParseAPIsKey, actor.ID, func(apis *[]socialVideoParseAPI) error {
		if len(*apis) >= socialVideoParseMaxAPIs {
			return BadAuthRequest(fmt.Sprintf("解析接口最多 %d 条", socialVideoParseMaxAPIs))
		}
		now := time.Now().UTC()
		created = socialVideoParseAPI{ID: newID(), Enabled: normalized.Enabled, Secret: secret, CreatedAt: now, UpdatedAt: now}
		applySocialVideoParseDefinition(&created, normalized)
		*apis = append(*apis, created)
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.create", "social_video_parse_api", created.ID, "新增视频解析接口："+created.Name, map[string]any{"platforms": created.Platforms})
	view := socialVideoParseAPIView(created, nil)
	return &view, nil
}

func (s *Service) UpdateSocialVideoParseAPI(actor *model.User, id string, req SocialVideoParseAPIRequest) (*SocialVideoParseAPIView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := normalizeSocialVideoParseAPIRequest(req)
	if err != nil {
		return nil, err
	}
	secret := ""
	if value := strings.TrimSpace(normalized.Secret); value != "" {
		if secret, err = s.encryptSettingSecret(value); err != nil {
			return nil, err
		}
	}
	var updated socialVideoParseAPI
	_, err = updateSettingJSON(s, socialVideoParseAPIsKey, actor.ID, func(apis *[]socialVideoParseAPI) error {
		index, err := findSocialVideoParseAPI(*apis, id)
		if err != nil {
			return err
		}
		api := &(*apis)[index]
		applySocialVideoParseDefinition(api, normalized)
		api.Enabled = normalized.Enabled
		switch {
		case secret != "":
			api.Secret = secret
		case normalized.ClearSecret:
			api.Secret = ""
		}
		api.UpdatedAt = time.Now().UTC()
		updated = *api
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.update", "social_video_parse_api", id, "修改视频解析接口："+updated.Name, map[string]any{"enabled": updated.Enabled, "platforms": updated.Platforms})
	return s.socialVideoParseAPIViewByID(id)
}

func (s *Service) socialVideoParseAPIViewByID(id string) (*SocialVideoParseAPIView, error) {
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, err
	}
	index, err := findSocialVideoParseAPI(apis, id)
	if err != nil {
		return nil, err
	}
	state, err := s.socialVideoParseState()
	if err != nil {
		return nil, err
	}
	view := socialVideoParseAPIView(apis[index], state.APIs[id])
	return &view, nil
}

func (s *Service) SetSocialVideoParseAPIEnabled(actor *model.User, id string, enabled bool) (*SocialVideoParseAPIView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	var name string
	_, err := updateSettingJSON(s, socialVideoParseAPIsKey, actor.ID, func(apis *[]socialVideoParseAPI) error {
		index, err := findSocialVideoParseAPI(*apis, id)
		if err != nil {
			return err
		}
		(*apis)[index].Enabled = enabled
		(*apis)[index].UpdatedAt = time.Now().UTC()
		name = (*apis)[index].Name
		return nil
	})
	if err != nil {
		return nil, err
	}
	action, summary := "social_video_parse.disable", "停用视频解析接口："
	if enabled {
		action, summary = "social_video_parse.enable", "启用视频解析接口："
	}
	_ = s.appendAdminAudit(actor, action, "social_video_parse_api", id, summary+name, nil)
	return s.socialVideoParseAPIViewByID(id)
}

func (s *Service) DuplicateSocialVideoParseAPI(actor *model.User, id string) (*SocialVideoParseAPIView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	var copied socialVideoParseAPI
	_, err := updateSettingJSON(s, socialVideoParseAPIsKey, actor.ID, func(apis *[]socialVideoParseAPI) error {
		index, err := findSocialVideoParseAPI(*apis, id)
		if err != nil {
			return err
		}
		if len(*apis) >= socialVideoParseMaxAPIs {
			return BadAuthRequest(fmt.Sprintf("解析接口最多 %d 条", socialVideoParseMaxAPIs))
		}
		now := time.Now().UTC()
		copied = (*apis)[index]
		copied.ID, copied.Name, copied.Enabled, copied.SourceID, copied.CreatedAt, copied.UpdatedAt = newID(), trimmedRunes(copied.Name+" 副本", 60), false, "", now, now
		copied.Platforms = slices.Clone(copied.Platforms)
		copied.Headers, copied.DownloadHeaders = slices.Clone(copied.Headers), slices.Clone(copied.DownloadHeaders)
		*apis = append(*apis, copied)
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.duplicate", "social_video_parse_api", copied.ID, "复制视频解析接口："+copied.Name, map[string]any{"from": id})
	view := socialVideoParseAPIView(copied, nil)
	return &view, nil
}

// ResetSocialVideoParseAPI 手动恢复一条被自动停用的接口：清掉停用标记和连续失败次数，累计成功失败数保留。
func (s *Service) ResetSocialVideoParseAPI(actor *model.User, id string) (*SocialVideoParseAPIView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, err
	}
	index, err := findSocialVideoParseAPI(apis, id)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	_, err = updateSettingJSON(s, socialVideoParseStateKey, actor.ID, func(state *socialVideoParseState) error {
		if current := state.APIs[id]; current != nil {
			current.AutoDisabled, current.AutoDisabledAt, current.AutoDisabledReason, current.ConsecutiveFailures = false, nil, "", 0
		}
		state.Logs = append([]SocialVideoParseLog{{At: now, APIID: id, APIName: apis[index].Name, Kind: "test", OK: true, Message: "管理员手动恢复"}}, state.Logs...)
		if len(state.Logs) > socialVideoParseMaxLogs {
			state.Logs = state.Logs[:socialVideoParseMaxLogs]
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.reset", "social_video_parse_api", id, "恢复视频解析接口："+apis[index].Name, nil)
	return s.socialVideoParseAPIViewByID(id)
}

func (s *Service) DeleteSocialVideoParseAPI(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	var name string
	_, err := updateSettingJSON(s, socialVideoParseAPIsKey, actor.ID, func(apis *[]socialVideoParseAPI) error {
		index, err := findSocialVideoParseAPI(*apis, id)
		if err != nil {
			return err
		}
		name = (*apis)[index].Name
		*apis = slices.Delete(*apis, index, index+1)
		return nil
	})
	if err != nil {
		return err
	}
	_, _ = updateSettingJSON(s, socialVideoParseStateKey, actor.ID, func(state *socialVideoParseState) error {
		delete(state.APIs, id)
		return nil
	})
	_ = s.appendAdminAudit(actor, "social_video_parse.delete", "social_video_parse_api", id, "删除视频解析接口："+name, nil)
	return nil
}

// testAPIFromRequest 拿到要测试的那条接口（密钥已解开）：传了 api 就测还没保存的草稿，只传 id 就测已保存的。
func (s *Service) socialVideoParseTestTarget(req SocialVideoParseTestRequest) (socialVideoParseAPI, bool, error) {
	var stored *socialVideoParseAPI
	if id := strings.TrimSpace(req.ID); id != "" {
		apis, err := s.socialVideoParseAPIs()
		if err != nil {
			return socialVideoParseAPI{}, false, err
		}
		index, err := findSocialVideoParseAPI(apis, id)
		if err != nil {
			return socialVideoParseAPI{}, false, err
		}
		stored = &apis[index]
	}
	if req.API == nil {
		if stored == nil {
			return socialVideoParseAPI{}, false, BadAuthRequest("请选择要测试的接口")
		}
		api := *stored
		secret, err := s.decryptSettingSecret(api.Secret)
		if err != nil {
			return api, false, errors.New("解析接口密钥解密失败，请检查存储加密密钥")
		}
		api.Secret = secret
		return api, true, nil
	}
	normalized, err := normalizeSocialVideoParseAPIRequest(*req.API)
	if err != nil {
		return socialVideoParseAPI{}, false, err
	}
	draft := socialVideoParseAPI{ID: "draft", Enabled: true}
	applySocialVideoParseDefinition(&draft, normalized)
	draft.Secret = strings.TrimSpace(normalized.Secret)
	if draft.Secret == "" && stored != nil && !normalized.ClearSecret {
		if draft.Secret, err = s.decryptSettingSecret(stored.Secret); err != nil {
			return draft, false, errors.New("解析接口密钥解密失败，请检查存储加密密钥")
		}
	}
	if stored != nil {
		draft.ID = stored.ID
	}
	return draft, false, nil
}

func socialVideoParseSampleLink(api socialVideoParseAPI, settings SocialVideoParseSettings, preferred string) (string, string) {
	if preferred != "" && slices.Contains(api.Platforms, preferred) {
		return preferred, settings.SampleLinks[preferred]
	}
	for _, platform := range api.Platforms {
		if link := settings.SampleLinks[platform]; link != "" {
			return platform, link
		}
	}
	if len(api.Platforms) > 0 {
		return api.Platforms[0], ""
	}
	return "", ""
}

func (s *Service) TestSocialVideoParseAPI(ctx context.Context, actor *model.User, req SocialVideoParseTestRequest) (*SocialVideoParseTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	api, saved, err := s.socialVideoParseTestTarget(req)
	if err != nil {
		return nil, err
	}
	settings, err := s.socialVideoParseSettings()
	if err != nil {
		return nil, err
	}
	platform, link := socialVideoParseSampleLink(api, settings, strings.TrimSpace(req.Platform))
	if text := strings.TrimSpace(req.URL); text != "" {
		parsed, err := parseSocialVideoShareText(text)
		if err != nil {
			return nil, err
		}
		if !slices.Contains(api.Platforms, parsed.Platform) {
			return nil, BadAuthRequest("这条接口没有勾选测试链接所在的平台")
		}
		platform, link = parsed.Platform, parsed.URL
	}
	if link == "" {
		name := platform
		if info := socialVideoPlatformByID(platform); info != nil {
			name = info.Name
		}
		return nil, BadAuthRequest("请填写测试链接，或在「设置」里给" + name + "配一个测试链接")
	}
	result, failure := s.runSocialVideoParseTest(ctx, api, platform, link)
	if saved {
		s.recordSocialVideoParseOutcome(api, platform, "test", time.Duration(result.LatencyMs)*time.Millisecond, failure, true)
	}
	return &result, nil
}

// runSocialVideoParseTest 测一条接口：调接口、取字段、只读视频开头确认是视频，不下载整段。
func (s *Service) runSocialVideoParseTest(ctx context.Context, api socialVideoParseAPI, platform, link string) (SocialVideoParseTestResult, error) {
	result := SocialVideoParseTestResult{ID: api.ID, Name: api.Name, Platform: platform, TestURL: link}
	started := time.Now()
	target := link
	if info := socialVideoPlatformByID(platform); info != nil && info.Strict {
		if resolved, err := resolveSocialVideoURL(ctx, socialVideoURL{URL: link, Platform: platform}, s.socialVideoParseClient(30*time.Second), s.socialVideoURLValidator); err == nil {
			target = socialVideoAPIURL(platform, resolved)
		}
	}
	finish := func(err error) (SocialVideoParseTestResult, error) {
		result.LatencyMs = time.Since(started).Milliseconds()
		if err == nil {
			result.OK, result.Message = true, "接口可用，视频地址能正常打开"
			return result, nil
		}
		result.Message = trimmedRunes(err.Error(), 200)
		var stageErr *socialVideoParseStageError
		if errors.As(err, &stageErr) {
			result.Stage = stageErr.Stage
		}
		return result, err
	}
	status, raw, err := s.callSocialVideoParseAPI(ctx, api, target, platform)
	result.HTTPStatus = status
	if len(raw) > 0 {
		preview := string(raw[:min(len(raw), socialVideoParsePreviewLimit)])
		if api.Secret != "" {
			preview = strings.ReplaceAll(preview, api.Secret, "***")
		}
		result.ResponsePreview = strings.ToValidUTF8(preview, "")
	}
	if err != nil {
		return finish(err)
	}
	mapped, err := mapSocialVideoParseResponse(raw, api.Mapping, api.Secret)
	if err != nil {
		return finish(err)
	}
	result.Result = &mapped
	media, err := s.checkSocialVideoMedia(ctx, api, mapped.VideoURL)
	if media.Status != 0 {
		result.Media = &media
	}
	return finish(err)
}

func (s *Service) TestSocialVideoParseAPIs(ctx context.Context, actor *model.User, req SocialVideoParseBatchTestRequest) (*SocialVideoParseBatchTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	settings, err := s.socialVideoParseSettings()
	if err != nil {
		return nil, err
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, err
	}
	platform := strings.TrimSpace(req.Platform)
	selected := []socialVideoParseAPI{}
	for _, api := range apis {
		if len(req.IDs) > 0 && !slices.Contains(req.IDs, api.ID) || len(req.IDs) == 0 && !api.Enabled {
			continue
		}
		if platform != "" && !slices.Contains(api.Platforms, platform) {
			continue
		}
		selected = append(selected, api)
	}
	output := &SocialVideoParseBatchTestResult{Results: []SocialVideoParseTestResult{}, Skipped: []string{}}
	var mu sync.Mutex
	var wait sync.WaitGroup
	slots := make(chan struct{}, socialVideoParseTestParallel)
	for _, api := range selected {
		testPlatform, link := socialVideoParseSampleLink(api, settings, platform)
		if link == "" {
			output.Skipped = append(output.Skipped, api.Name+"：没有配置测试链接")
			continue
		}
		secret, err := s.decryptSettingSecret(api.Secret)
		if err != nil {
			output.Skipped = append(output.Skipped, api.Name+"：密钥解密失败")
			continue
		}
		api.Secret = secret
		wait.Add(1)
		slots <- struct{}{}
		go func(api socialVideoParseAPI, testPlatform, link string) {
			defer wait.Done()
			defer func() { <-slots }()
			result, failure := s.runSocialVideoParseTest(ctx, api, testPlatform, link)
			s.recordSocialVideoParseOutcome(api, testPlatform, "test", time.Duration(result.LatencyMs)*time.Millisecond, failure, true)
			result.ResponsePreview = ""
			mu.Lock()
			output.Results = append(output.Results, result)
			mu.Unlock()
		}(api, testPlatform, link)
	}
	wait.Wait()
	slices.SortFunc(output.Results, func(left, right SocialVideoParseTestResult) int { return strings.Compare(left.Name, right.Name) })
	return output, nil
}

func socialVideoParseExportItem(api socialVideoParseAPI) SocialVideoParseAPIRequest {
	return SocialVideoParseAPIRequest{
		Name: api.Name, Platforms: api.Platforms, Enabled: api.Enabled, Priority: api.Priority, Weight: api.Weight,
		Method: api.Method, URL: api.URL, BodyType: api.BodyType, Body: api.Body, Headers: api.Headers,
		TimeoutSeconds: api.TimeoutSeconds, Mapping: api.Mapping, DownloadHeaders: api.DownloadHeaders, Remark: api.Remark,
	}
}

// ExportSocialVideoParseAPIs 导出接口定义（不含密钥），格式与订阅源相同，可以直接当订阅内容用。
func (s *Service) ExportSocialVideoParseAPIs(actor *model.User, ids []string) (*SocialVideoParseExport, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, err
	}
	items := []SocialVideoParseAPIRequest{}
	for _, api := range apis {
		if len(ids) == 0 || slices.Contains(ids, api.ID) {
			items = append(items, socialVideoParseExportItem(api))
		}
	}
	return &SocialVideoParseExport{Format: socialVideoParseExportFormat, Version: 1, ExportedAt: time.Now().UTC(), APIs: items}, nil
}

// parseSocialVideoParseDocument 读订阅或导入的内容：可以是导出格式，也可以直接是接口数组。
func parseSocialVideoParseDocument(raw []byte) ([]SocialVideoParseAPIRequest, error) {
	trimmed := bytes.TrimSpace(raw)
	var items []SocialVideoParseAPIRequest
	if bytes.HasPrefix(trimmed, []byte("[")) {
		if err := json.Unmarshal(trimmed, &items); err != nil {
			return nil, BadAuthRequest("接口清单不是有效的 JSON 数组")
		}
	} else {
		var document SocialVideoParseImportRequest
		if err := json.Unmarshal(trimmed, &document); err != nil {
			return nil, BadAuthRequest("接口清单不是有效的 JSON")
		}
		if document.Format != "" && document.Format != socialVideoParseExportFormat {
			return nil, BadAuthRequest("接口清单格式不对，应为 " + socialVideoParseExportFormat)
		}
		items = document.APIs
	}
	if len(items) == 0 {
		return nil, BadAuthRequest("接口清单里没有接口")
	}
	if len(items) > socialVideoParseMaxAPIs {
		return nil, BadAuthRequest(fmt.Sprintf("一次最多导入 %d 条接口", socialVideoParseMaxAPIs))
	}
	return items, nil
}

// mergeSocialVideoParseAPIs 把一批接口并进接口池：请求方式、地址模板和请求体都相同的算同一条，只更新定义，
// 启用状态、密钥（清单里没给时）和运行状态保留；新接口一律先停用，返回新建的那些。
func (s *Service) mergeSocialVideoParseAPIs(actorID, sourceID string, incoming []SocialVideoParseAPIRequest) ([]socialVideoParseAPI, SocialVideoParseImportResult, error) {
	type prepared struct {
		req    SocialVideoParseAPIRequest
		secret string
		key    string
	}
	result := SocialVideoParseImportResult{Errors: []string{}}
	items := []prepared{}
	seen := map[string]bool{}
	for index, item := range incoming {
		normalized, err := normalizeSocialVideoParseAPIRequest(item)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("第 %d 条（%s）：%s", index+1, trimmedRunes(item.Name, 30), socialVideoShortError(err)))
			continue
		}
		key := socialVideoParseDedupeKey(normalized.Method, normalized.URL, normalized.Body)
		if seen[key] {
			continue
		}
		seen[key] = true
		secret, err := s.encryptSettingSecret(strings.TrimSpace(normalized.Secret))
		if err != nil {
			return nil, result, err
		}
		items = append(items, prepared{req: normalized, secret: secret, key: key})
	}
	baseErrors := slices.Clone(result.Errors)
	var created []socialVideoParseAPI
	_, err := updateSettingJSON(s, socialVideoParseAPIsKey, actorID, func(apis *[]socialVideoParseAPI) error {
		created = nil
		result = SocialVideoParseImportResult{Errors: slices.Clone(baseErrors)}
		now := time.Now().UTC()
		index := map[string]int{}
		for position, api := range *apis {
			index[socialVideoParseDedupeKey(api.Method, api.URL, api.Body)] = position
		}
		for _, item := range items {
			if position, ok := index[item.key]; ok {
				existing := &(*apis)[position]
				applySocialVideoParseDefinition(existing, item.req)
				if item.secret != "" {
					existing.Secret = item.secret
				}
				if existing.SourceID == "" {
					existing.SourceID = sourceID
				}
				existing.UpdatedAt = now
				result.Updated++
				continue
			}
			if len(*apis) >= socialVideoParseMaxAPIs {
				result.Errors = append(result.Errors, fmt.Sprintf("%s：接口数量已达上限 %d 条", item.req.Name, socialVideoParseMaxAPIs))
				continue
			}
			api := socialVideoParseAPI{ID: newID(), Secret: item.secret, SourceID: sourceID, CreatedAt: now, UpdatedAt: now}
			applySocialVideoParseDefinition(&api, item.req)
			*apis = append(*apis, api)
			index[item.key] = len(*apis) - 1
			created = append(created, api)
			result.Created++
		}
		return nil
	})
	return created, result, err
}

// autoEnableSocialVideoParseAPIs 用各平台的测试链接测一遍新接口，通过的打开；没有测试链接的保持停用。
func (s *Service) autoEnableSocialVideoParseAPIs(ctx context.Context, actorID string, created []socialVideoParseAPI) (int, []string) {
	settings, err := s.socialVideoParseSettings()
	if err != nil {
		return 0, []string{"读取设置失败，新接口保持停用"}
	}
	notes := []string{}
	passed := []string{}
	var mu sync.Mutex
	var wait sync.WaitGroup
	slots := make(chan struct{}, socialVideoParseTestParallel)
	for _, api := range created {
		platform, link := socialVideoParseSampleLink(api, settings, "")
		if link == "" {
			notes = append(notes, api.Name+"：没有测试链接，保持停用")
			continue
		}
		secret, err := s.decryptSettingSecret(api.Secret)
		if err != nil {
			notes = append(notes, api.Name+"：密钥解密失败，保持停用")
			continue
		}
		api.Secret = secret
		wait.Add(1)
		slots <- struct{}{}
		go func(api socialVideoParseAPI, platform, link string) {
			defer wait.Done()
			defer func() { <-slots }()
			result, failure := s.runSocialVideoParseTest(ctx, api, platform, link)
			s.recordSocialVideoParseOutcome(api, platform, "test", time.Duration(result.LatencyMs)*time.Millisecond, failure, true)
			mu.Lock()
			defer mu.Unlock()
			if failure == nil {
				passed = append(passed, api.ID)
			} else {
				notes = append(notes, api.Name+"：测试没通过，保持停用（"+trimmedRunes(failure.Error(), 60)+"）")
			}
		}(api, platform, link)
	}
	wait.Wait()
	if len(passed) == 0 {
		return 0, notes
	}
	_, err = updateSettingJSON(s, socialVideoParseAPIsKey, actorID, func(apis *[]socialVideoParseAPI) error {
		for index := range *apis {
			if slices.Contains(passed, (*apis)[index].ID) {
				(*apis)[index].Enabled = true
			}
		}
		return nil
	})
	if err != nil {
		return 0, append(notes, "启用测试通过的接口失败："+socialVideoShortError(err))
	}
	return len(passed), notes
}

func (s *Service) ImportSocialVideoParseAPIs(ctx context.Context, actor *model.User, req SocialVideoParseImportRequest) (*SocialVideoParseImportResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if req.Format != "" && req.Format != socialVideoParseExportFormat {
		return nil, BadAuthRequest("导入文件格式不对，应为 " + socialVideoParseExportFormat)
	}
	if len(req.APIs) == 0 {
		return nil, BadAuthRequest("导入文件里没有接口")
	}
	if len(req.APIs) > socialVideoParseMaxAPIs {
		return nil, BadAuthRequest(fmt.Sprintf("一次最多导入 %d 条接口", socialVideoParseMaxAPIs))
	}
	created, result, err := s.mergeSocialVideoParseAPIs(actor.ID, "", req.APIs)
	if err != nil {
		return nil, err
	}
	if req.AutoEnable && len(created) > 0 {
		enabled, notes := s.autoEnableSocialVideoParseAPIs(ctx, actor.ID, created)
		result.Enabled = enabled
		result.Errors = append(result.Errors, notes...)
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.import", "system_setting", socialVideoParseAPIsKey, "导入视频解析接口", map[string]any{"created": result.Created, "updated": result.Updated, "enabled": result.Enabled})
	return &result, nil
}

func (s *Service) CreateSocialVideoParseSource(actor *model.User, req SocialVideoParseSourceRequest) (*SocialVideoParseSource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := normalizeSocialVideoParseSourceRequest(req)
	if err != nil {
		return nil, err
	}
	if err := s.validateSocialVideoParseURL(normalized.URL); err != nil {
		return nil, err
	}
	var created SocialVideoParseSource
	_, err = updateSettingJSON(s, socialVideoParseSourcesKey, actor.ID, func(sources *[]SocialVideoParseSource) error {
		if len(*sources) >= socialVideoParseMaxSources {
			return BadAuthRequest(fmt.Sprintf("订阅源最多 %d 个", socialVideoParseMaxSources))
		}
		for _, source := range *sources {
			if source.URL == normalized.URL {
				return BadAuthRequest("这个订阅地址已经添加过了")
			}
		}
		now := time.Now().UTC()
		created = SocialVideoParseSource{ID: newID(), Name: normalized.Name, URL: normalized.URL, Enabled: normalized.Enabled, IntervalHours: normalized.IntervalHours, AutoEnable: normalized.AutoEnable, CreatedAt: now, UpdatedAt: now}
		*sources = append(*sources, created)
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.source_create", "social_video_parse_source", created.ID, "新增视频解析接口订阅源："+created.Name, nil)
	return &created, nil
}

func (s *Service) UpdateSocialVideoParseSource(actor *model.User, id string, req SocialVideoParseSourceRequest) (*SocialVideoParseSource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := normalizeSocialVideoParseSourceRequest(req)
	if err != nil {
		return nil, err
	}
	if err := s.validateSocialVideoParseURL(normalized.URL); err != nil {
		return nil, err
	}
	var updated SocialVideoParseSource
	_, err = updateSettingJSON(s, socialVideoParseSourcesKey, actor.ID, func(sources *[]SocialVideoParseSource) error {
		for index := range *sources {
			source := &(*sources)[index]
			if source.ID != id {
				if source.URL == normalized.URL {
					return BadAuthRequest("这个订阅地址已经添加过了")
				}
				continue
			}
			source.Name, source.URL, source.Enabled, source.IntervalHours, source.AutoEnable = normalized.Name, normalized.URL, normalized.Enabled, normalized.IntervalHours, normalized.AutoEnable
			source.UpdatedAt = time.Now().UTC()
			updated = *source
		}
		if updated.ID == "" {
			return NotFound("订阅源不存在或已删除")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.source_update", "social_video_parse_source", id, "修改视频解析接口订阅源："+updated.Name, nil)
	return &updated, nil
}

// DeleteSocialVideoParseSource 删除订阅源；removeAPIs 为真时连同它采集来的接口一起删，否则这些接口改为手动维护。
func (s *Service) DeleteSocialVideoParseSource(actor *model.User, id string, removeAPIs bool) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	var name string
	_, err := updateSettingJSON(s, socialVideoParseSourcesKey, actor.ID, func(sources *[]SocialVideoParseSource) error {
		for index, source := range *sources {
			if source.ID == id {
				name = source.Name
				*sources = slices.Delete(*sources, index, index+1)
				return nil
			}
		}
		return NotFound("订阅源不存在或已删除")
	})
	if err != nil {
		return err
	}
	removed := []string{}
	_, err = updateSettingJSON(s, socialVideoParseAPIsKey, actor.ID, func(apis *[]socialVideoParseAPI) error {
		removed = removed[:0]
		kept := (*apis)[:0]
		for _, api := range *apis {
			if api.SourceID == id {
				if removeAPIs {
					removed = append(removed, api.ID)
					continue
				}
				api.SourceID = ""
			}
			kept = append(kept, api)
		}
		*apis = kept
		return nil
	})
	if err != nil {
		return err
	}
	if len(removed) > 0 {
		_, _ = updateSettingJSON(s, socialVideoParseStateKey, actor.ID, func(state *socialVideoParseState) error {
			for _, apiID := range removed {
				delete(state.APIs, apiID)
			}
			return nil
		})
	}
	_ = s.appendAdminAudit(actor, "social_video_parse.source_delete", "social_video_parse_source", id, "删除视频解析接口订阅源："+name, map[string]any{"removedApis": len(removed)})
	return nil
}

func (s *Service) SyncSocialVideoParseSource(ctx context.Context, actor *model.User, id string) (*SocialVideoParseImportResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	sources, err := s.socialVideoParseSources()
	if err != nil {
		return nil, err
	}
	for _, source := range sources {
		if source.ID == id {
			result, err := s.syncSocialVideoParseSource(ctx, actor.ID, source)
			_ = s.appendAdminAudit(actor, "social_video_parse.source_sync", "social_video_parse_source", id, "同步视频解析接口订阅源："+source.Name, map[string]any{"created": result.Created, "updated": result.Updated, "error": socialVideoShortError(err)})
			if err != nil {
				return nil, err
			}
			return &result, nil
		}
	}
	return nil, NotFound("订阅源不存在或已删除")
}

// syncSocialVideoParseSource 拉一次订阅源并合并，结果写回订阅源的上次同步信息；后台巡检和「立即同步」共用。
func (s *Service) syncSocialVideoParseSource(ctx context.Context, actorID string, source SocialVideoParseSource) (SocialVideoParseImportResult, error) {
	result := SocialVideoParseImportResult{Errors: []string{}}
	items, err := s.fetchSocialVideoParseSource(ctx, source.URL)
	if err == nil {
		var created []socialVideoParseAPI
		created, result, err = s.mergeSocialVideoParseAPIs(actorID, source.ID, items)
		if err == nil && source.AutoEnable && len(created) > 0 {
			enabled, notes := s.autoEnableSocialVideoParseAPIs(ctx, actorID, created)
			result.Enabled = enabled
			result.Errors = append(result.Errors, notes...)
		}
	}
	now := time.Now().UTC()
	total := len(items)
	_, saveErr := updateSettingJSON(s, socialVideoParseSourcesKey, actorID, func(sources *[]SocialVideoParseSource) error {
		for index := range *sources {
			if (*sources)[index].ID == source.ID {
				current := &(*sources)[index]
				current.LastSyncedAt = &now
				current.LastError = socialVideoShortError(err)
				if err == nil {
					current.LastTotal, current.LastCreated, current.LastUpdated = total, result.Created, result.Updated
				}
			}
		}
		return nil
	})
	if err == nil {
		err = saveErr
	}
	return result, err
}

func (s *Service) fetchSocialVideoParseSource(ctx context.Context, rawURL string) ([]SocialVideoParseAPIRequest, error) {
	if err := s.validateSocialVideoParseURL(rawURL); err != nil {
		return nil, err
	}
	fetchCtx, cancel := context.WithTimeout(ctx, socialVideoParseSourceTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, BadAuthRequest("订阅地址无效")
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	outbound.ApplyDefaultOutboundHeaders(req)
	resp, err := s.socialVideoParseClient(socialVideoParseSourceTimeout).Do(req)
	if err != nil {
		return nil, BadAuthRequest("拉取订阅源失败：" + socialVideoShortError(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, BadAuthRequest(fmt.Sprintf("订阅源返回 HTTP %d", resp.StatusCode))
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, socialVideoParseSourceLimit+1))
	if err != nil {
		return nil, BadAuthRequest("读取订阅源失败")
	}
	if len(raw) > socialVideoParseSourceLimit {
		return nil, BadAuthRequest("订阅内容超过 1 MiB")
	}
	return parseSocialVideoParseDocument(raw)
}
