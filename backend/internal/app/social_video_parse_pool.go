package app

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// socialVideoParseRotation 记着「轮流」策略下每个平台下一次从哪条接口开始；每个进程各记各的。
var socialVideoParseRotation = struct {
	sync.Mutex
	next map[string]int
}{next: map[string]int{}}

// socialVideoParseCandidates 按设置的轮询方式给出这次要依次尝试的接口（已解密密钥），最多 MaxAttempts 条。
// 一个可用的都没有时，挑最早被自动停用的那条试探一次，成功就恢复。
func (s *Service) socialVideoParseCandidates(platform string) ([]socialVideoParseAPI, SocialVideoParseSettings, error) {
	settings, err := s.socialVideoParseSettings()
	if err != nil {
		return nil, settings, err
	}
	apis, err := s.socialVideoParseAPIs()
	if err != nil {
		return nil, settings, err
	}
	state, err := s.socialVideoParseState()
	if err != nil {
		return nil, settings, err
	}
	active, paused := []socialVideoParseAPI{}, []socialVideoParseAPI{}
	for _, api := range apis {
		if !api.Enabled || !slices.Contains(api.Platforms, platform) {
			continue
		}
		if current := state.APIs[api.ID]; current != nil && current.AutoDisabled {
			paused = append(paused, api)
		} else {
			active = append(active, api)
		}
	}
	ordered := orderSocialVideoParseAPIs(active, state, settings.Strategy, platform)
	if len(ordered) == 0 && len(paused) > 0 {
		disabledAt := func(api socialVideoParseAPI) int64 {
			if current := state.APIs[api.ID]; current != nil && current.AutoDisabledAt != nil {
				return current.AutoDisabledAt.UnixNano()
			}
			return 0
		}
		slices.SortFunc(paused, func(left, right socialVideoParseAPI) int { return cmp.Compare(disabledAt(left), disabledAt(right)) })
		ordered = paused[:1]
	}
	ordered = ordered[:min(len(ordered), settings.MaxAttempts)]
	for index := range ordered {
		if ordered[index].Secret, err = s.decryptSettingSecret(ordered[index].Secret); err != nil {
			return nil, settings, errors.New("解析接口密钥解密失败，请检查存储加密密钥")
		}
	}
	return ordered, settings, nil
}

func orderSocialVideoParseAPIs(apis []socialVideoParseAPI, state socialVideoParseState, strategy, platform string) []socialVideoParseAPI {
	ordered := slices.Clone(apis)
	byPriority := func(left, right socialVideoParseAPI) int {
		return cmp.Or(cmp.Compare(left.Priority, right.Priority), cmp.Compare(left.CreatedAt.UnixNano(), right.CreatedAt.UnixNano()), cmp.Compare(left.ID, right.ID))
	}
	slices.SortFunc(ordered, byPriority)
	switch strategy {
	case SocialVideoParseStrategyRoundRobin:
		if len(ordered) > 1 {
			socialVideoParseRotation.Lock()
			start := socialVideoParseRotation.next[platform] % len(ordered)
			socialVideoParseRotation.next[platform] = start + 1
			socialVideoParseRotation.Unlock()
			ordered = append(ordered[start:], ordered[:start]...)
		}
	case SocialVideoParseStrategyWeighted:
		// 按权重做不放回抽样：权重越大越靠前，但不是固定顺序。
		keys := map[string]float64{}
		for _, api := range ordered {
			keys[api.ID] = math.Pow(rand.Float64(), 1/float64(max(api.Weight, 1)))
		}
		slices.SortStableFunc(ordered, func(left, right socialVideoParseAPI) int { return cmp.Compare(keys[right.ID], keys[left.ID]) })
	case SocialVideoParseStrategyFastest:
		latency := func(api socialVideoParseAPI) int64 {
			if current := state.APIs[api.ID]; current != nil && current.AvgLatencyMs > 0 {
				return current.AvgLatencyMs
			}
			return math.MaxInt64
		}
		slices.SortStableFunc(ordered, func(left, right socialVideoParseAPI) int { return cmp.Compare(latency(left), latency(right)) })
	}
	return ordered
}

func pushSocialVideoParseRecent(recent []bool, ok bool) []bool {
	recent = append(recent, ok)
	if len(recent) > socialVideoParseRecentLimit {
		recent = recent[len(recent)-socialVideoParseRecentLimit:]
	}
	return recent
}

// recordSocialVideoParseOutcome 记一次调用结果。failure 为空表示成功；penalize 为假时只记日志，不算接口失败（如视频太长）。
// 连续失败到阈值自动停用，成功一次清零并恢复。
func (s *Service) recordSocialVideoParseOutcome(api socialVideoParseAPI, platform, kind string, latency time.Duration, failure error, penalize bool) {
	settings, err := s.socialVideoParseSettings()
	if err != nil {
		settings = defaultSocialVideoParseSettings()
	}
	now := time.Now().UTC()
	latencyMs := latency.Milliseconds()
	stage, message := "", ""
	if failure != nil {
		message = trimmedRunes(failure.Error(), 160)
		var stageErr *socialVideoParseStageError
		if errors.As(failure, &stageErr) {
			stage = stageErr.Stage
		}
	}
	_, err = updateSettingJSON(s, socialVideoParseStateKey, "", func(state *socialVideoParseState) error {
		if state.APIs == nil {
			state.APIs = map[string]*SocialVideoParseAPIState{}
		}
		current := state.APIs[api.ID]
		if current == nil {
			current = &SocialVideoParseAPIState{}
			state.APIs[api.ID] = current
		}
		entry := SocialVideoParseLog{At: now, APIID: api.ID, APIName: api.Name, Platform: platform, Kind: kind, OK: failure == nil, Stage: stage, LatencyMs: latencyMs, Message: message}
		current.LastCheckedAt = &now
		current.LastLatencyMs = latencyMs
		switch {
		case failure == nil:
			current.SuccessCount++
			current.ConsecutiveFailures = 0
			current.LastSuccessAt = &now
			current.LastError = ""
			current.Recent = pushSocialVideoParseRecent(current.Recent, true)
			if current.AvgLatencyMs == 0 {
				current.AvgLatencyMs = latencyMs
			} else {
				current.AvgLatencyMs = (current.AvgLatencyMs*7 + latencyMs*3) / 10
			}
			if current.AutoDisabled {
				current.AutoDisabled, current.AutoDisabledAt, current.AutoDisabledReason = false, nil, ""
				entry.Message = "调用成功，已自动恢复"
			}
		case penalize:
			current.FailureCount++
			current.ConsecutiveFailures++
			current.LastFailureAt = &now
			current.LastError = message
			current.Recent = pushSocialVideoParseRecent(current.Recent, false)
			if !current.AutoDisabled && current.ConsecutiveFailures >= settings.FailureThreshold {
				current.AutoDisabled, current.AutoDisabledAt = true, &now
				current.AutoDisabledReason = trimmedRunes(fmt.Sprintf("连续失败 %d 次：%s", current.ConsecutiveFailures, message), 160)
				entry.Message = trimmedRunes(message+"（已自动停用）", 160)
			} else if current.AutoDisabled {
				// 停用期间的试探又失败了：重新计时冷却。
				current.AutoDisabledAt = &now
			}
		}
		state.Logs = append([]SocialVideoParseLog{entry}, state.Logs...)
		if len(state.Logs) > socialVideoParseMaxLogs {
			state.Logs = state.Logs[:socialVideoParseMaxLogs]
		}
		return nil
	})
	if err != nil {
		slog.Warn("记录视频解析接口调用结果失败", "api", api.ID, "error", err)
	}
}

// socialVideoParseJob 是一次「解析 + 下载 + 校验」。MaxDurationSeconds 为 0 时按 180 秒。
type socialVideoParseJob struct {
	Platform           string
	URL                string
	WorkDir            string
	MaxBytes           int64
	MaxDurationSeconds int
	Progress           func(stage string, percent int)
}

type socialVideoParseOutcome struct {
	API    socialVideoParseAPI
	Result socialVideoParseResult
	Path   string
	Size   int64
	Probe  socialVideoProbe
}

// downloadSocialVideoWithPool 依次尝试接口：解析出视频地址、下载、ffprobe 校验，成功一条就停。
// 视频本身太长、太大时直接失败，不再换接口，也不算接口失败。
func (s *Service) downloadSocialVideoWithPool(ctx context.Context, job socialVideoParseJob) (*socialVideoParseOutcome, error) {
	candidates, _, err := s.socialVideoParseCandidates(job.Platform)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return nil, s.requireSocialVideoParseAPI(job.Platform)
	}
	var lastErr error
	for index, api := range candidates {
		if job.Progress != nil {
			job.Progress("调用解析接口", 25)
		}
		started := time.Now()
		outcome, err := s.trySocialVideoParseAPI(ctx, api, job, index)
		latency := time.Since(started)
		if err == nil {
			s.recordSocialVideoParseOutcome(api, job.Platform, "import", latency, nil, false)
			return outcome, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		var contentErr *socialVideoContentError
		if errors.As(err, &contentErr) {
			s.recordSocialVideoParseOutcome(api, job.Platform, "import", latency, err, false)
			return nil, BadAuthRequest(contentErr.Message)
		}
		s.recordSocialVideoParseOutcome(api, job.Platform, "import", latency, err, true)
		lastErr = err
	}
	if len(candidates) == 1 {
		return nil, BadAuthRequest("解析接口没能处理这个链接：" + socialVideoShortError(lastErr))
	}
	return nil, BadAuthRequest(fmt.Sprintf("已依次尝试 %d 个解析接口，都没能处理这个链接。最后一个的原因：%s", len(candidates), socialVideoShortError(lastErr)))
}

func (s *Service) trySocialVideoParseAPI(ctx context.Context, api socialVideoParseAPI, job socialVideoParseJob, attempt int) (*socialVideoParseOutcome, error) {
	_, raw, err := s.callSocialVideoParseAPI(ctx, api, job.URL, job.Platform)
	if err != nil {
		return nil, err
	}
	result, err := mapSocialVideoParseResponse(raw, api.Mapping, api.Secret)
	if err != nil {
		return nil, err
	}
	// 接口给了时长时下载前就拦下超长的视频；没给时下载后按 ffprobe 的结果再拦。
	limitMs := int64(socialVideoDurationLimit(job.MaxDurationSeconds)) * 1000
	if result.DurationMs > limitMs {
		return nil, &socialVideoContentError{Message: socialVideoTooLongMessage(job.MaxDurationSeconds)}
	}
	if job.Progress != nil {
		job.Progress("下载视频", 40)
	}
	path := filepath.Join(job.WorkDir, fmt.Sprintf("video-%d", attempt))
	size, err := s.downloadSocialVideoMedia(ctx, api, result.VideoURL, path, job.MaxBytes)
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	if job.Progress != nil {
		job.Progress("校验视频", 70)
	}
	probeRaw, err := runSocialVideoOutput(ctx, "ffprobe", []string{"-v", "error", "-show_streams", "-show_format", "-of", "json", path}, nil)
	if err != nil {
		_ = os.Remove(path)
		return nil, parseStageError("probe", "接口给的文件不是能识别的视频")
	}
	probe, err := parseSocialVideoProbe(probeRaw)
	if err != nil {
		_ = os.Remove(path)
		if socialVideoProbeTooLong(probeRaw) {
			return nil, &socialVideoContentError{Message: socialVideoTooLongMessage(job.MaxDurationSeconds)}
		}
		return nil, parseStageError("probe", "接口给的文件不是有效视频")
	}
	if probe.DurationMs > limitMs {
		_ = os.Remove(path)
		return nil, &socialVideoContentError{Message: socialVideoTooLongMessage(job.MaxDurationSeconds)}
	}
	return &socialVideoParseOutcome{API: api, Result: result, Path: path, Size: size, Probe: probe}, nil
}

// socialVideoProbeTooLong 区分「是视频但太长」和「根本不是视频」：前者是内容问题，不怪接口。
func socialVideoProbeTooLong(raw []byte) bool {
	var value struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if jsonErr := json.Unmarshal(raw, &value); jsonErr != nil {
		return false
	}
	var seconds float64
	if _, err := fmt.Sscanf(strings.TrimSpace(value.Format.Duration), "%g", &seconds); err != nil {
		return false
	}
	return seconds > socialVideoMaxDurationSeconds
}
