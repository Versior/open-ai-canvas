package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

// 第三方视频解析接口池存在 system_settings 里：接口定义、订阅源、全局设置各一条，
// 运行状态（连续失败、自动停用、最近结果、调用记录）单独一条，调用时按原文比较写回，多实例并发也不丢更新。
const (
	socialVideoParseSettingsKey = "social_video_parse_settings"
	socialVideoParseAPIsKey     = "social_video_parse_apis"
	socialVideoParseSourcesKey  = "social_video_parse_sources"
	socialVideoParseStateKey    = "social_video_parse_state"

	socialVideoParseTaskModel = "parse-api"

	socialVideoParseMaxAPIs        = 200
	socialVideoParseMaxSources     = 20
	socialVideoParseMaxHeaders     = 20
	socialVideoParseMaxLogs        = 100
	socialVideoParseRecentLimit    = 10
	socialVideoParseMaxURLLength   = 2048
	socialVideoParseMaxBodyLength  = 8 << 10
	socialVideoParseMaxTextLength  = 200
	socialVideoParseMaxPathLength  = 200
	socialVideoParseMaxSecretBytes = 4 << 10
)

const (
	SocialVideoParseStrategyPriority   = "priority"
	SocialVideoParseStrategyRoundRobin = "round_robin"
	SocialVideoParseStrategyWeighted   = "weighted"
	SocialVideoParseStrategyFastest    = "fastest"
)

const (
	socialVideoParseStatusActive       = "active"
	socialVideoParseStatusAutoDisabled = "auto_disabled"
	socialVideoParseStatusDisabled     = "disabled"
)

var socialVideoParseHeaderName = regexp.MustCompile(`^[A-Za-z0-9!#$%&'*+.^_|~-]{1,64}$`)

// SocialVideoParseSettings 是接口池的全局设置。
type SocialVideoParseSettings struct {
	Strategy            string            `json:"strategy"`
	MaxAttempts         int               `json:"maxAttempts"`
	FailureThreshold    int               `json:"failureThreshold"`
	AutoRecover         bool              `json:"autoRecover"`
	RecoverAfterMinutes int               `json:"recoverAfterMinutes"`
	HealthCheckMinutes  int               `json:"healthCheckMinutes"`
	SampleLinks         map[string]string `json:"sampleLinks"`
}

type SocialVideoParseHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// SocialVideoParseMapping 说明从接口返回的 JSON 里怎么取字段，路径写法如 data.url、data.items[0].play。
// VideoURLPath 留空时按字段名和地址特征自动找视频地址。
type SocialVideoParseMapping struct {
	SuccessPath   string `json:"successPath"`
	SuccessValues string `json:"successValues"`
	VideoURLPath  string `json:"videoUrlPath"`
	TitlePath     string `json:"titlePath"`
	CoverPath     string `json:"coverPath"`
	IDPath        string `json:"idPath"`
	DurationPath  string `json:"durationPath"`
	DurationUnit  string `json:"durationUnit"`
	MessagePath   string `json:"messagePath"`
}

// SocialVideoParseAPIRequest 是新建、修改、导入一条接口的请求；Secret 只写不读，留空表示不改。
type SocialVideoParseAPIRequest struct {
	Category        string                   `json:"category"`
	Name            string                   `json:"name"`
	Platforms       []string                 `json:"platforms"`
	Enabled         bool                     `json:"enabled"`
	Priority        int                      `json:"priority"`
	Weight          int                      `json:"weight"`
	Method          string                   `json:"method"`
	URL             string                   `json:"url"`
	BodyType        string                   `json:"bodyType"`
	Body            string                   `json:"body"`
	Headers         []SocialVideoParseHeader `json:"headers"`
	Secret          string                   `json:"secret"`
	ClearSecret     bool                     `json:"clearSecret"`
	TimeoutSeconds  int                      `json:"timeoutSeconds"`
	Mapping         SocialVideoParseMapping  `json:"mapping"`
	DownloadHeaders []SocialVideoParseHeader `json:"downloadHeaders"`
	Remark          string                   `json:"remark"`
}

// socialVideoParseAPI 是存下来的一条接口；Secret 是加密后的密钥，只在发请求时解开。
type socialVideoParseAPI struct {
	Category        string                   `json:"category"`
	ID              string                   `json:"id"`
	Name            string                   `json:"name"`
	Platforms       []string                 `json:"platforms"`
	Enabled         bool                     `json:"enabled"`
	Priority        int                      `json:"priority"`
	Weight          int                      `json:"weight"`
	Method          string                   `json:"method"`
	URL             string                   `json:"url"`
	BodyType        string                   `json:"bodyType"`
	Body            string                   `json:"body"`
	Headers         []SocialVideoParseHeader `json:"headers"`
	Secret          string                   `json:"secret,omitempty"`
	TimeoutSeconds  int                      `json:"timeoutSeconds"`
	Mapping         SocialVideoParseMapping  `json:"mapping"`
	DownloadHeaders []SocialVideoParseHeader `json:"downloadHeaders"`
	Remark          string                   `json:"remark"`
	SourceID        string                   `json:"sourceId,omitempty"`
	CreatedAt       time.Time                `json:"createdAt"`
	UpdatedAt       time.Time                `json:"updatedAt"`
}

// SocialVideoParseAPIState 是一条接口的运行状态：连续失败到阈值就自动停用，成功一次就恢复。
type SocialVideoParseAPIState struct {
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	AutoDisabled        bool       `json:"autoDisabled"`
	AutoDisabledAt      *time.Time `json:"autoDisabledAt,omitempty"`
	AutoDisabledReason  string     `json:"autoDisabledReason,omitempty"`
	SuccessCount        int64      `json:"successCount"`
	FailureCount        int64      `json:"failureCount"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt,omitempty"`
	LastFailureAt       *time.Time `json:"lastFailureAt,omitempty"`
	LastCheckedAt       *time.Time `json:"lastCheckedAt,omitempty"`
	LastError           string     `json:"lastError,omitempty"`
	LastLatencyMs       int64      `json:"lastLatencyMs"`
	AvgLatencyMs        int64      `json:"avgLatencyMs"`
	Recent              []bool     `json:"recent"`
}

// SocialVideoParseLog 是一次调用记录：Kind 为 import（用户导入）、test（后台测试）或 health（自动巡检）。
type SocialVideoParseLog struct {
	At        time.Time `json:"at"`
	APIID     string    `json:"apiId"`
	APIName   string    `json:"apiName"`
	Platform  string    `json:"platform"`
	Kind      string    `json:"kind"`
	OK        bool      `json:"ok"`
	Stage     string    `json:"stage,omitempty"`
	LatencyMs int64     `json:"latencyMs"`
	Message   string    `json:"message,omitempty"`
}

type socialVideoParseState struct {
	APIs map[string]*SocialVideoParseAPIState `json:"apis"`
	Logs []SocialVideoParseLog                `json:"logs"`
}

// SocialVideoParseSource 是接口订阅源：定时拉取一份接口清单，新接口去重后加进接口池。
type SocialVideoParseSource struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	URL           string     `json:"url"`
	Enabled       bool       `json:"enabled"`
	IntervalHours int        `json:"intervalHours"`
	AutoEnable    bool       `json:"autoEnable"`
	LastSyncedAt  *time.Time `json:"lastSyncedAt,omitempty"`
	LastError     string     `json:"lastError,omitempty"`
	LastTotal     int        `json:"lastTotal"`
	LastCreated   int        `json:"lastCreated"`
	LastUpdated   int        `json:"lastUpdated"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type SocialVideoParseSourceRequest struct {
	Name          string `json:"name"`
	URL           string `json:"url"`
	Enabled       bool   `json:"enabled"`
	IntervalHours int    `json:"intervalHours"`
	AutoEnable    bool   `json:"autoEnable"`
}

// SocialVideoParseAPIView 是后台看到的一条接口：不含密钥，带运行状态和综合状态。
type SocialVideoParseAPIView struct {
	Category        string                   `json:"category"`
	ID              string                   `json:"id"`
	Name            string                   `json:"name"`
	Platforms       []string                 `json:"platforms"`
	Enabled         bool                     `json:"enabled"`
	Priority        int                      `json:"priority"`
	Weight          int                      `json:"weight"`
	Method          string                   `json:"method"`
	URL             string                   `json:"url"`
	BodyType        string                   `json:"bodyType"`
	Body            string                   `json:"body"`
	Headers         []SocialVideoParseHeader `json:"headers"`
	HasSecret       bool                     `json:"hasSecret"`
	TimeoutSeconds  int                      `json:"timeoutSeconds"`
	Mapping         SocialVideoParseMapping  `json:"mapping"`
	DownloadHeaders []SocialVideoParseHeader `json:"downloadHeaders"`
	Remark          string                   `json:"remark"`
	SourceID        string                   `json:"sourceId,omitempty"`
	CreatedAt       time.Time                `json:"createdAt"`
	UpdatedAt       time.Time                `json:"updatedAt"`
	Status          string                   `json:"status"`
	State           SocialVideoParseAPIState `json:"state"`
}

func defaultSocialVideoParseSettings() SocialVideoParseSettings {
	return SocialVideoParseSettings{Strategy: SocialVideoParseStrategyPriority, MaxAttempts: 3, FailureThreshold: 3, AutoRecover: true, RecoverAfterMinutes: 30, SampleLinks: map[string]string{}}
}

func clampInt(value, low, high, fallback int) int {
	if value == 0 {
		return fallback
	}
	return min(max(value, low), high)
}

func normalizeSocialVideoParseSettings(value SocialVideoParseSettings) (SocialVideoParseSettings, error) {
	switch value.Strategy {
	case SocialVideoParseStrategyPriority, SocialVideoParseStrategyRoundRobin, SocialVideoParseStrategyWeighted, SocialVideoParseStrategyFastest:
	case "":
		value.Strategy = SocialVideoParseStrategyPriority
	default:
		return value, BadAuthRequest("轮询方式只能是优先级、轮流、按权重随机或最快优先")
	}
	value.MaxAttempts = clampInt(value.MaxAttempts, 1, 10, 3)
	value.FailureThreshold = clampInt(value.FailureThreshold, 1, 20, 3)
	value.RecoverAfterMinutes = clampInt(value.RecoverAfterMinutes, 5, 1440, 30)
	if value.HealthCheckMinutes < 0 {
		value.HealthCheckMinutes = 0
	}
	if value.HealthCheckMinutes > 0 {
		value.HealthCheckMinutes = min(max(value.HealthCheckMinutes, 10), 1440)
	}
	links := map[string]string{}
	for platform, link := range value.SampleLinks {
		link = strings.TrimSpace(link)
		if link == "" {
			continue
		}
		if socialVideoPlatformByID(platform) == nil {
			return value, BadAuthRequest("测试链接的平台无效")
		}
		parsed, err := parseSocialVideoShareText(link)
		if err != nil || parsed.Platform != platform {
			return value, BadAuthRequest(socialVideoPlatformByID(platform).Name + "的测试链接不是这个平台的视频链接")
		}
		links[platform] = parsed.URL
	}
	value.SampleLinks = links
	return value, nil
}

func trimmedRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

func normalizeSocialVideoParseHeaders(headers []SocialVideoParseHeader, label string) ([]SocialVideoParseHeader, error) {
	if len(headers) > socialVideoParseMaxHeaders {
		return nil, BadAuthRequest(fmt.Sprintf("%s最多 %d 个", label, socialVideoParseMaxHeaders))
	}
	result := make([]SocialVideoParseHeader, 0, len(headers))
	for _, header := range headers {
		name := strings.TrimSpace(header.Name)
		value := strings.TrimSpace(header.Value)
		if name == "" && value == "" {
			continue
		}
		if !socialVideoParseHeaderName.MatchString(name) {
			return nil, BadAuthRequest(label + "名称只能包含字母、数字和常见符号")
		}
		switch strings.ToLower(name) {
		case "host", "content-length", "transfer-encoding", "connection", "te", "trailer", "upgrade", "proxy-authorization", "proxy-connection":
			return nil, BadAuthRequest(label + "不能设置 " + name)
		}
		if strings.ContainsAny(value, "\r\n") || len(value) > 1024 {
			return nil, BadAuthRequest(label + "的值不能换行或超过 1024 个字符")
		}
		result = append(result, SocialVideoParseHeader{Name: name, Value: value})
	}
	return result, nil
}

// normalizeSocialVideoParseAPIRequest 校验并补齐一条接口定义，不处理密钥。
func normalizeSocialVideoParseAPIRequest(req SocialVideoParseAPIRequest) (SocialVideoParseAPIRequest, error) {
	req.Category = strings.TrimSpace(req.Category)
	if len([]rune(req.Category)) > 60 {
		return req, errors.New("接口分类不能超过 60 个字")
	}
	req.Name = trimmedRunes(req.Name, 60)
	if req.Name == "" {
		return req, BadAuthRequest("请填写接口名称")
	}
	platforms := []string{}
	for _, platform := range req.Platforms {
		platform = strings.TrimSpace(platform)
		if socialVideoPlatformByID(platform) == nil {
			return req, BadAuthRequest("接口平台无效：" + platform)
		}
		if !slices.Contains(platforms, platform) {
			platforms = append(platforms, platform)
		}
	}
	if len(platforms) == 0 {
		return req, BadAuthRequest("请至少选择一个平台")
	}
	req.Platforms = platforms
	req.Priority = min(max(req.Priority, 0), 9999)
	req.Weight = clampInt(req.Weight, 1, 100, 10)
	req.Method = strings.ToUpper(strings.TrimSpace(req.Method))
	if req.Method == "" {
		req.Method = "GET"
	}
	if req.Method != "GET" && req.Method != "POST" {
		return req, BadAuthRequest("请求方式只能是 GET 或 POST")
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" || len(req.URL) > socialVideoParseMaxURLLength {
		return req, BadAuthRequest("请填写接口地址，最长 2048 个字符")
	}
	sample := renderSocialVideoParseTemplate(req.URL, map[string]string{"url": "https://example.com/v", "platform": "douyin", "key": "key"}, url.QueryEscape)
	parsed, err := url.Parse(sample)
	if err != nil || !parsed.IsAbs() || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return req, BadAuthRequest("接口地址必须是 http 或 https 开头的完整地址")
	}
	req.BodyType = strings.TrimSpace(req.BodyType)
	switch req.BodyType {
	case "", "none":
		req.BodyType, req.Body = "none", ""
	case "json", "form":
		if req.Method != "POST" {
			return req, BadAuthRequest("只有 POST 请求能带请求体")
		}
	default:
		return req, BadAuthRequest("请求体类型只能是无、JSON 或表单")
	}
	req.Body = strings.TrimSpace(req.Body)
	if len(req.Body) > socialVideoParseMaxBodyLength {
		return req, BadAuthRequest("请求体最长 8 KiB")
	}
	if req.BodyType == "json" {
		rendered := renderSocialVideoParseTemplate(req.Body, map[string]string{"url": "https://example.com/v", "platform": "douyin", "key": "key"}, socialVideoJSONEscape)
		if !json.Valid([]byte(rendered)) {
			return req, BadAuthRequest("JSON 请求体格式不对（变量写在字符串里，如 {\"url\":\"{url}\"}）")
		}
	}
	if !strings.Contains(req.URL, "{url}") && !strings.Contains(req.Body, "{url}") {
		return req, BadAuthRequest("接口地址或请求体里要用 {url} 放视频链接")
	}
	if req.Headers, err = normalizeSocialVideoParseHeaders(req.Headers, "请求头"); err != nil {
		return req, err
	}
	if req.DownloadHeaders, err = normalizeSocialVideoParseHeaders(req.DownloadHeaders, "下载请求头"); err != nil {
		return req, err
	}
	req.TimeoutSeconds = clampInt(req.TimeoutSeconds, 3, 60, 15)
	mapping := req.Mapping
	for _, path := range []*string{&mapping.SuccessPath, &mapping.VideoURLPath, &mapping.TitlePath, &mapping.CoverPath, &mapping.IDPath, &mapping.DurationPath, &mapping.MessagePath} {
		*path = strings.TrimSpace(*path)
		if len(*path) > socialVideoParseMaxPathLength {
			return req, BadAuthRequest("字段路径最长 200 个字符")
		}
	}
	mapping.SuccessValues = trimmedRunes(mapping.SuccessValues, 100)
	if mapping.SuccessPath != "" && mapping.SuccessValues == "" {
		mapping.SuccessValues = "200,0,true,success,ok"
	}
	switch mapping.DurationUnit {
	case "", "s":
		mapping.DurationUnit = "s"
	case "ms":
	default:
		return req, BadAuthRequest("时长单位只能是秒或毫秒")
	}
	req.Mapping = mapping
	req.Remark = trimmedRunes(req.Remark, socialVideoParseMaxTextLength)
	if len(req.Secret) > socialVideoParseMaxSecretBytes {
		return req, BadAuthRequest("密钥太长")
	}
	return req, nil
}

func normalizeSocialVideoParseSourceRequest(req SocialVideoParseSourceRequest) (SocialVideoParseSourceRequest, error) {
	req.Name = trimmedRunes(req.Name, 60)
	if req.Name == "" {
		return req, BadAuthRequest("请填写订阅源名称")
	}
	req.URL = strings.TrimSpace(req.URL)
	parsed, err := url.Parse(req.URL)
	if req.URL == "" || len(req.URL) > socialVideoParseMaxURLLength || err != nil || !parsed.IsAbs() || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return req, BadAuthRequest("订阅地址必须是 http 或 https 开头的完整地址")
	}
	req.IntervalHours = clampInt(req.IntervalHours, 1, 168, 24)
	return req, nil
}

// socialVideoParseDedupeKey 判断两条接口是不是同一个：请求方式、地址模板和请求体都一样就算重复。
func socialVideoParseDedupeKey(method, rawURL, body string) string {
	return strings.ToUpper(strings.TrimSpace(method)) + " " + strings.TrimSpace(rawURL) + "\x00" + strings.TrimSpace(body)
}

func socialVideoParseStatus(api socialVideoParseAPI, state *SocialVideoParseAPIState) string {
	switch {
	case !api.Enabled:
		return socialVideoParseStatusDisabled
	case state != nil && state.AutoDisabled:
		return socialVideoParseStatusAutoDisabled
	default:
		return socialVideoParseStatusActive
	}
}

func socialVideoParseAPIView(api socialVideoParseAPI, state *SocialVideoParseAPIState) SocialVideoParseAPIView {
	view := SocialVideoParseAPIView{
		ID: api.ID, Name: api.Name, Platforms: api.Platforms, Enabled: api.Enabled, Priority: api.Priority, Weight: api.Weight,
		Method: api.Method, URL: api.URL, BodyType: api.BodyType, Body: api.Body, Headers: api.Headers, HasSecret: api.Secret != "",
		TimeoutSeconds: api.TimeoutSeconds, Mapping: api.Mapping, DownloadHeaders: api.DownloadHeaders, Remark: api.Remark, Category: api.Category,
		SourceID: api.SourceID, CreatedAt: api.CreatedAt, UpdatedAt: api.UpdatedAt, Status: socialVideoParseStatus(api, state),
	}
	if state != nil {
		view.State = *state
	}
	if view.State.Recent == nil {
		view.State.Recent = []bool{}
	}
	if view.Headers == nil {
		view.Headers = []SocialVideoParseHeader{}
	}
	if view.DownloadHeaders == nil {
		view.DownloadHeaders = []SocialVideoParseHeader{}
	}
	return view
}

// readSettingJSON 读出一条 JSON 配置；没有这一行时返回零值。
func readSettingJSON[T any](s *Service, key string) (T, error) {
	var value T
	row, err := s.repo.SystemSettingOptional(key)
	if err != nil || row == nil || strings.TrimSpace(row.ValueJSON) == "" {
		return value, err
	}
	if err := json.Unmarshal([]byte(row.ValueJSON), &value); err != nil {
		return value, fmt.Errorf("读取配置 %s 失败: %w", key, err)
	}
	return value, nil
}

var errSettingConflict = kernel.NewAppError(409, "配置正在被同时修改，请稍后重试")

// updateSettingJSON 读出一条 JSON 配置交给 mutate 修改，再按读到的原文比较写回；被别人抢先改了就重读重试。
// mutate 可能被调用多次，只能依赖传进来的最新值。
func updateSettingJSON[T any](s *Service, key, actorID string, mutate func(*T) error) (T, error) {
	var zero T
	for attempt := 0; attempt < 8; attempt++ {
		row, err := s.repo.SystemSettingOptional(key)
		if err != nil {
			return zero, err
		}
		var value T
		previous, exists := "", row != nil
		if exists {
			previous = row.ValueJSON
			if strings.TrimSpace(previous) != "" {
				if err := json.Unmarshal([]byte(previous), &value); err != nil {
					return zero, fmt.Errorf("读取配置 %s 失败: %w", key, err)
				}
			}
		}
		if err := mutate(&value); err != nil {
			return zero, err
		}
		next, err := json.Marshal(value)
		if err != nil {
			return zero, err
		}
		if exists && string(next) == previous {
			return value, nil
		}
		swapped, err := s.repo.CompareAndSwapSystemSetting(key, previous, exists, string(next), actorID)
		if err != nil {
			return zero, err
		}
		if swapped {
			return value, nil
		}
		time.Sleep(time.Duration(attempt+1) * 15 * time.Millisecond)
	}
	return zero, errSettingConflict
}

func (s *Service) socialVideoParseSettings() (SocialVideoParseSettings, error) {
	row, err := s.repo.SystemSettingOptional(socialVideoParseSettingsKey)
	if err != nil {
		return SocialVideoParseSettings{}, err
	}
	if row == nil || strings.TrimSpace(row.ValueJSON) == "" {
		return defaultSocialVideoParseSettings(), nil
	}
	var value SocialVideoParseSettings
	if err := json.Unmarshal([]byte(row.ValueJSON), &value); err != nil {
		return SocialVideoParseSettings{}, fmt.Errorf("读取视频解析设置失败: %w", err)
	}
	if value.SampleLinks == nil {
		value.SampleLinks = map[string]string{}
	}
	normalized, err := normalizeSocialVideoParseSettings(value)
	if err != nil {
		// 已存的测试链接后来不合规时只丢掉那一项，不影响导入。
		value.SampleLinks = map[string]string{}
		normalized, _ = normalizeSocialVideoParseSettings(value)
	}
	return normalized, nil
}

func (s *Service) socialVideoParseAPIs() ([]socialVideoParseAPI, error) {
	apis, err := readSettingJSON[[]socialVideoParseAPI](s, socialVideoParseAPIsKey)
	if err != nil {
		return nil, err
	}
	return apis, nil
}

func (s *Service) socialVideoParseState() (socialVideoParseState, error) {
	state, err := readSettingJSON[socialVideoParseState](s, socialVideoParseStateKey)
	if state.APIs == nil {
		state.APIs = map[string]*SocialVideoParseAPIState{}
	}
	return state, err
}

func (s *Service) socialVideoParseSources() ([]SocialVideoParseSource, error) {
	return readSettingJSON[[]SocialVideoParseSource](s, socialVideoParseSourcesKey)
}

// requireSocialVideoParseAPI 在建导入任务前确认这个平台至少有一个开着的接口（自动停用的也算，导入时会试探）。
func (s *Service) requireSocialVideoParseAPI(platform string) error {
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return err
	}
	for _, api := range apis {
		if api.Enabled && slices.Contains(api.Platforms, platform) {
			return nil
		}
	}
	name := platform
	if info := socialVideoPlatformByID(platform); info != nil {
		name = info.Name
	}
	appErr := BadAuthRequest(name + "链接暂时无法导入：后台还没有可用的解析接口，请联系管理员在「视频复刻 · 解析接口」里添加")
	appErr.Reason = kernel.ReasonFailedPrecondition
	return appErr
}

func findSocialVideoParseAPI(apis []socialVideoParseAPI, id string) (int, error) {
	for index, api := range apis {
		if api.ID == id {
			return index, nil
		}
	}
	return -1, NotFound("解析接口不存在或已删除")
}

var errSocialVideoParseNoSampleLink = errors.New("没有配置这个平台的测试链接")
