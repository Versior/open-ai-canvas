package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/repository"
)

const socialVideoShareTextLimit = 4 << 10
const socialVideoMaxDurationSeconds = 180

var (
	socialVideoURLPattern    = regexp.MustCompile(`https?://[^\s<>]+`)
	socialVideoIDPathPattern = regexp.MustCompile(`^/(?:video|share/video)/[0-9]+/?$`)
	tiktokVideoPathPattern   = regexp.MustCompile(`^/@[^/]+/video/[0-9]+/?$`)
	socialVideoCanonicalID   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,160}$`)
)

type SocialVideoImportRequest struct {
	URL       string `json:"url"`
	ProjectID string `json:"projectId"`
}

type socialVideoURL struct {
	URL      string
	Platform string
}

type socialVideoImportInput struct {
	Version     int    `json:"version"`
	URL         string `json:"url"`
	Platform    string `json:"platform"`
	Fingerprint string `json:"fingerprint"`
}

type socialVideoMetadata struct {
	CanonicalID string
	Title       string
	Duration    float64
}

type socialVideoProbe struct {
	Width      int
	Height     int
	DurationMs int64
}

func socialVideoMetadataArgs(rawURL string) []string {
	return []string{
		"--ignore-config", "--no-playlist", "--no-netrc", "--no-cache-dir", "--skip-download", "--dump-single-json",
		"--socket-timeout", "15", "--retries", "2", "--", rawURL,
	}
}

func socialVideoDownloadArgs(rawURL, outputTemplate string, maxBytes int64) []string {
	return []string{
		"--ignore-config", "--no-playlist", "--no-netrc", "--no-cache-dir", "--no-overwrites",
		"--socket-timeout", "15", "--retries", "2", "--fragment-retries", "2", "--max-filesize", strconv.FormatInt(maxBytes, 10),
		"-f", "b[ext=mp4]/b", "-o", outputTemplate, "--", rawURL,
	}
}

func parseSocialVideoMetadata(raw []byte, platform string, maxBytes int64) (socialVideoMetadata, error) {
	var value struct {
		Extractor      string          `json:"extractor"`
		ExtractorKey   string          `json:"extractor_key"`
		ID             string          `json:"id"`
		Title          string          `json:"title"`
		Duration       float64         `json:"duration"`
		Filesize       int64           `json:"filesize"`
		FilesizeApprox int64           `json:"filesize_approx"`
		Entries        json.RawMessage `json:"entries"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return socialVideoMetadata{}, BadAuthRequest("无法读取视频元数据")
	}
	extractors := []string{}
	for _, extractor := range []string{value.Extractor, value.ExtractorKey} {
		if strings.TrimSpace(extractor) != "" {
			extractors = append(extractors, normalizeSocialVideoExtractor(extractor))
		}
	}
	if len(extractors) == 0 {
		return socialVideoMetadata{}, BadAuthRequest("视频来源与链接平台不一致")
	}
	for _, extractor := range extractors {
		if extractor != platform {
			return socialVideoMetadata{}, BadAuthRequest("视频来源与链接平台不一致")
		}
	}
	if len(value.Entries) > 0 && string(value.Entries) != "null" {
		return socialVideoMetadata{}, BadAuthRequest("仅支持导入单个视频")
	}
	if !socialVideoCanonicalID.MatchString(value.ID) {
		return socialVideoMetadata{}, BadAuthRequest("视频标识无效")
	}
	if value.Duration <= 0 || value.Duration > socialVideoMaxDurationSeconds || math.IsNaN(value.Duration) || math.IsInf(value.Duration, 0) {
		return socialVideoMetadata{}, BadAuthRequest("视频时长无效或超过 3 分钟")
	}
	if maxBytes <= 0 || value.Filesize > maxBytes || value.FilesizeApprox > maxBytes {
		return socialVideoMetadata{}, BadAuthRequest("视频文件超过导入大小限制")
	}
	return socialVideoMetadata{CanonicalID: value.ID, Title: strings.TrimSpace(value.Title), Duration: value.Duration}, nil
}

func normalizeSocialVideoExtractor(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.NewReplacer("-", "", "_", "", " ", "").Replace(value)
}

func resolveSocialVideoURL(ctx context.Context, source socialVideoURL, client *http.Client, validator func(string) (*url.URL, error)) (string, error) {
	if client == nil {
		client = outbound.OutboundHTTPClient(30 * time.Second)
	}
	if validator == nil {
		validator = outbound.ValidateOutboundURL
	}
	redirectClient := *client
	redirectClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	current, canonical, err := validateSocialVideoHop(source.URL, source.Platform, validator)
	if err != nil {
		return "", err
	}
	if canonical {
		return current.String(), nil
	}
	for hop := 0; hop < 5; hop++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current.String(), nil)
		if err != nil {
			return "", err
		}
		outbound.ApplyDefaultOutboundHeaders(req)
		resp, err := redirectClient.Do(req)
		if err != nil {
			return "", BadAuthRequest("无法展开视频短链接")
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		_ = resp.Body.Close()
		if resp.StatusCode < 300 || resp.StatusCode >= 400 {
			return "", BadAuthRequest("视频短链接没有跳转到单视频地址")
		}
		location := strings.TrimSpace(resp.Header.Get("Location"))
		if location == "" {
			return "", BadAuthRequest("视频短链接跳转地址为空")
		}
		next, err := current.Parse(location)
		if err != nil {
			return "", BadAuthRequest("视频短链接跳转地址无效")
		}
		current, canonical, err = validateSocialVideoHop(next.String(), source.Platform, validator)
		if err != nil {
			return "", err
		}
		if canonical {
			return current.String(), nil
		}
	}
	return "", BadAuthRequest("视频短链接跳转次数过多")
}

func validateSocialVideoHop(raw, expectedPlatform string, validator func(string) (*url.URL, error)) (*url.URL, bool, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !parsed.IsAbs() || parsed.Hostname() == "" || !strings.EqualFold(parsed.Scheme, "https") || parsed.User != nil || parsed.Fragment != "" {
		return nil, false, BadAuthRequest("视频跳转地址无效")
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return nil, false, BadAuthRequest("视频跳转地址端口无效")
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	platform, short := socialVideoPlatform(host)
	if platform == "" || platform != expectedPlatform {
		return nil, false, BadAuthRequest("视频短链接跳转到了其他平台")
	}
	parsed.Scheme, parsed.Host = "https", host
	validated, err := validator(parsed.String())
	if err != nil {
		return nil, false, err
	}
	path := parsed.EscapedPath()
	canonical := !short && (socialVideoIDPathPattern.MatchString(path) || platform == "tiktok" && tiktokVideoPathPattern.MatchString(path))
	return validated, canonical, nil
}

func parseSocialVideoProbe(raw []byte) (socialVideoProbe, error) {
	var value struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return socialVideoProbe{}, BadAuthRequest("无法读取视频文件信息")
	}
	var width, height int
	for _, stream := range value.Streams {
		if stream.CodecType == "video" && stream.Width > 0 && stream.Height > 0 {
			width, height = stream.Width, stream.Height
			break
		}
	}
	duration, err := strconv.ParseFloat(value.Format.Duration, 64)
	if width == 0 || height == 0 || err != nil || duration <= 0 || duration > socialVideoMaxDurationSeconds || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return socialVideoProbe{}, BadAuthRequest("下载结果不是有效的 3 分钟内视频")
	}
	return socialVideoProbe{Width: width, Height: height, DurationMs: int64(math.Round(duration * 1000))}, nil
}

func parseSocialVideoShareText(text string) (socialVideoURL, error) {
	text = strings.TrimSpace(text)
	if text == "" || len([]byte(text)) > socialVideoShareTextLimit {
		return socialVideoURL{}, BadAuthRequest("分享内容为空或超过 4 KiB")
	}
	matches := socialVideoURLPattern.FindAllString(text, -1)
	if len(matches) != 1 {
		return socialVideoURL{}, BadAuthRequest("分享内容必须且只能包含一个视频链接")
	}
	raw := strings.TrimRight(matches[0], `.,!?;:，。！？；：、)]}>"'`)
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Hostname() == "" {
		return socialVideoURL{}, BadAuthRequest("视频链接无效")
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return socialVideoURL{}, BadAuthRequest("视频链接必须使用 HTTPS")
	}
	if parsed.User != nil {
		return socialVideoURL{}, BadAuthRequest("视频链接不能包含认证信息")
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return socialVideoURL{}, BadAuthRequest("视频链接不能使用非标准端口")
	}
	if parsed.Fragment != "" {
		return socialVideoURL{}, BadAuthRequest("视频链接不能包含片段")
	}

	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	platform, short := socialVideoPlatform(host)
	if platform == "" {
		return socialVideoURL{}, BadAuthRequest("仅支持抖音和 TikTok 视频链接")
	}
	path := parsed.EscapedPath()
	if path == "" {
		path = "/"
	}
	if short {
		if strings.Trim(path, "/") == "" {
			return socialVideoURL{}, BadAuthRequest("短链接缺少视频标识")
		}
	} else if !socialVideoIDPathPattern.MatchString(path) && !(platform == "tiktok" && tiktokVideoPathPattern.MatchString(path)) {
		return socialVideoURL{}, BadAuthRequest("链接不是受支持的单视频地址")
	}

	parsed.Scheme = "https"
	parsed.Host = host
	return socialVideoURL{URL: parsed.String(), Platform: platform}, nil
}

func socialVideoPlatform(host string) (platform string, short bool) {
	switch host {
	case "v.douyin.com":
		return "douyin", true
	case "douyin.com", "www.douyin.com", "m.douyin.com", "www.iesdouyin.com":
		return "douyin", false
	case "vm.tiktok.com", "vt.tiktok.com":
		return "tiktok", true
	case "tiktok.com", "www.tiktok.com", "m.tiktok.com":
		return "tiktok", false
	default:
		return "", false
	}
}

func socialVideoTaskID(userID, idempotencyKey string) string {
	sum := sha256.Sum256([]byte(userID + "\x00" + idempotencyKey))
	return "sv" + hex.EncodeToString(sum[:16])
}

func socialVideoFingerprint(normalizedURL, projectID string) string {
	sum := sha256.Sum256([]byte(normalizedURL + "\x00" + strings.TrimSpace(projectID)))
	return hex.EncodeToString(sum[:])
}

func idempotencyConflict() *AppError {
	err := kernel.NewAppError(http.StatusConflict, "幂等键已用于不同的请求，请使用新的幂等键")
	err.Code = CodeIdempotencyConflict
	return err
}

func (s *Service) CreateSocialVideoImportTask(userID, idempotencyKey string, req SocialVideoImportRequest) (*model.Task, error) {
	if s.IsDraining() {
		return nil, &AppError{Status: http.StatusServiceUnavailable, Code: http.StatusServiceUnavailable, Message: "服务正在维护，暂不接受新任务", Retryable: true}
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if len(idempotencyKey) < 8 || len(idempotencyKey) > 128 {
		return nil, BadAuthRequest("X-Idempotency-Key 长度必须为 8 到 128 个字符")
	}
	parsed, err := parseSocialVideoShareText(req.URL)
	if err != nil {
		return nil, err
	}
	validator := s.socialVideoURLValidator
	if validator == nil {
		validator = outbound.ValidateOutboundURL
	}
	if _, err := validator(parsed.URL); err != nil {
		return nil, err
	}
	projectID := strings.TrimSpace(req.ProjectID)
	if err := s.ensureTaskProjectActive(userID, projectID); err != nil {
		return nil, err
	}

	id := socialVideoTaskID(userID, idempotencyKey)
	fingerprint := socialVideoFingerprint(parsed.URL, projectID)
	if existing, lookupErr := s.repo.TaskForUser(userID, id); lookupErr == nil {
		return socialVideoIdempotentReplay(existing, fingerprint)
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, lookupErr
	}

	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	inputJSON, err := json.Marshal(socialVideoImportInput{Version: 1, URL: parsed.URL, Platform: parsed.Platform, Fingerprint: fingerprint})
	if err != nil {
		return nil, err
	}
	task := model.Task{
		ID: id, UserID: userID, ProjectID: projectID,
		Type: model.TaskTypeSocialVideoImport, Status: model.TaskStatusQueued,
		Stage: "等待导入", Progress: 5, Prompt: "社交视频导入",
		Provider: parsed.Platform, Model: "yt-dlp", InputJSON: string(inputJSON),
	}
	if err := s.createTaskWithinStorageQuota(&task, nil, policy); err != nil {
		if existing, lookupErr := s.repo.TaskForUser(userID, id); lookupErr == nil {
			return socialVideoIdempotentReplay(existing, fingerprint)
		}
		if errors.Is(err, repository.ErrActiveTaskLimit) {
			return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
		}
		return nil, err
	}
	s.recordActivity(userID, "task", 1)
	_ = s.log(userID, task.ID, "info", "社交视频导入任务已进入队列", "")
	return taskForOutput(task), nil
}

func socialVideoIdempotentReplay(task *model.Task, fingerprint string) (*model.Task, error) {
	if task == nil || task.Type != model.TaskTypeSocialVideoImport {
		return nil, idempotencyConflict()
	}
	var input socialVideoImportInput
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Fingerprint == "" || input.Fingerprint != fingerprint {
		return nil, idempotencyConflict()
	}
	return taskForOutput(*task), nil
}
