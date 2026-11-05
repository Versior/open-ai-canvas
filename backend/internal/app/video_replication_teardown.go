package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 视频复刻 · 拆解准备（replication_teardown）：本地 ffmpeg 把一条视频拆成确定的镜头事实，
// 包括切点与时间码、每镜关键帧、按镜头排列的宫格图，以及可选的语音转写。结果写回任务，
// 前端再把宫格和镜头清单交给能看图的文本模型补全画面、口播、运镜等语义。
// 这一步不调用模型、不计费；关键帧和宫格作为图片资源计入用户存储。

// 时长和镜头数的实际上限由后台的视频复刻设置决定（见 video_replication_settings.go），不超过这里的硬上限。
const (
	videoTeardownMaxShotsLimit = 60
	videoTeardownTimeout       = 10 * time.Minute
)

var videoTeardownLanguagePattern = regexp.MustCompile(`^(?:auto|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$`)

// VideoTeardownRequest 是创建拆解任务的入参。Transcribe 为空时默认识别口播；
// 转写服务没配置时任务照常完成，并在结果的 warnings 里说明。
type VideoTeardownRequest struct {
	ResourceID string `json:"resourceId"`
	ProjectID  string `json:"projectId"`
	Transcribe *bool  `json:"transcribe"`
	Language   string `json:"language"`
	MaxShots   int    `json:"maxShots"`
}

type videoTeardownInput struct {
	Version     int    `json:"version"`
	ResourceID  string `json:"resourceId"`
	Transcribe  bool   `json:"transcribe"`
	Language    string `json:"language,omitempty"`
	MaxShots    int    `json:"maxShots"`
	Fingerprint string `json:"fingerprint"`
}

type videoTeardownBundle struct {
	Version    int                     `json:"version"`
	Source     videoTeardownSource     `json:"source"`
	Shots      []videoTeardownShot     `json:"shots"`
	Grids      []videoTeardownGrid     `json:"grids"`
	Transcript videoTeardownTranscript `json:"transcript"`
	Warnings   []string                `json:"warnings"`
}

type videoTeardownSource struct {
	ResourceID string `json:"resourceId"`
	DurationMs int64  `json:"durationMs"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	HasAudio   bool   `json:"hasAudio"`
}

type videoTeardownShot struct {
	Index              int    `json:"index"`
	StartMs            int64  `json:"startMs"`
	EndMs              int64  `json:"endMs"`
	Boundary           string `json:"boundary"`
	KeyframeTimeMs     int64  `json:"keyframeTimeMs"`
	KeyframeResourceID string `json:"keyframeResourceId"`
	KeyframeWidth      int    `json:"keyframeWidth"`
	KeyframeHeight     int    `json:"keyframeHeight"`
}

type videoTeardownGrid struct {
	ResourceID  string `json:"resourceId"`
	ShotIndexes []int  `json:"shotIndexes"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}

type videoTeardownTranscript struct {
	// Source 为 asr 表示来自语音转写；none 表示没有转写，前端让模型从画面字幕读口播。
	Source   string                         `json:"source"`
	Language string                         `json:"language,omitempty"`
	Segments []timelineTranscriptionSegment `json:"segments"`
}

// normalizeVideoTeardownRequest 校验入参；没指定镜头数上限时用后台设置的上限，指定了也不能超过它。
func normalizeVideoTeardownRequest(req VideoTeardownRequest, maxShots int) (videoTeardownInput, error) {
	input := videoTeardownInput{Version: 1, ResourceID: strings.TrimSpace(req.ResourceID), Transcribe: req.Transcribe == nil || *req.Transcribe, Language: strings.TrimSpace(req.Language), MaxShots: req.MaxShots}
	if input.ResourceID == "" || len(input.ResourceID) > 128 {
		return videoTeardownInput{}, BadAuthRequest("必须指定要拆解的视频")
	}
	if input.Language != "" && (len(input.Language) > 16 || !videoTeardownLanguagePattern.MatchString(input.Language)) {
		return videoTeardownInput{}, BadAuthRequest("口播语言格式无效，例如 zh、en 或 auto")
	}
	if input.MaxShots == 0 {
		input.MaxShots = maxShots
	}
	if input.MaxShots < 1 || input.MaxShots > maxShots {
		return videoTeardownInput{}, BadAuthRequest(fmt.Sprintf("镜头数上限必须在 1 到 %d 之间", maxShots))
	}
	return input, nil
}

func videoTeardownTaskID(userID, idempotencyKey string) string {
	sum := sha256.Sum256([]byte(userID + "\x00" + idempotencyKey))
	return "vt" + hex.EncodeToString(sum[:16])
}

func videoTeardownFingerprint(input videoTeardownInput, projectID string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{input.ResourceID, strings.TrimSpace(projectID), strconv.FormatBool(input.Transcribe), input.Language, strconv.Itoa(input.MaxShots)}, "\x00")))
	return hex.EncodeToString(sum[:])
}

// CreateVideoTeardownTask 校验视频归属、类型和时长后排队拆解任务；同一幂等键重放返回原任务，
// 换了参数则返回冲突。功能关闭时拒绝，时长和镜头数按后台的视频复刻设置校验。
func (s *Service) CreateVideoTeardownTask(userID, idempotencyKey string, req VideoTeardownRequest) (*model.Task, error) {
	if s.IsDraining() {
		return nil, &AppError{Status: http.StatusServiceUnavailable, Code: http.StatusServiceUnavailable, Message: "服务正在维护，暂不接受新任务", Retryable: true}
	}
	if err := s.RequireFeature(FeatureVideoReplication); err != nil {
		return nil, err
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if len(idempotencyKey) < 8 || len(idempotencyKey) > 128 {
		return nil, BadAuthRequest("X-Idempotency-Key 长度必须为 8 到 128 个字符")
	}
	settings, err := s.videoReplicationSettings()
	if err != nil {
		return nil, err
	}
	input, err := normalizeVideoTeardownRequest(req, settings.MaxShots)
	if err != nil {
		return nil, err
	}
	projectID := strings.TrimSpace(req.ProjectID)
	if err := s.ensureTaskProjectActive(userID, projectID); err != nil {
		return nil, err
	}
	resource, err := s.Resource(userID, input.ResourceID)
	if err != nil || resource == nil {
		return nil, BadAuthRequest("无法读取要拆解的视频，可能已被删除")
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("视频还没有上传完成")
	}
	if !strings.HasPrefix(strings.ToLower(resource.MimeType), "video/") {
		return nil, BadAuthRequest("只能拆解视频文件")
	}
	if resource.DurationMs > int64(settings.MaxDurationSeconds)*1000 {
		return nil, BadAuthRequest(videoReplicationDurationError(settings.MaxDurationSeconds))
	}

	id := videoTeardownTaskID(userID, idempotencyKey)
	input.Fingerprint = videoTeardownFingerprint(input, projectID)
	if existing, lookupErr := s.repo.TaskForUser(userID, id); lookupErr == nil {
		return videoTeardownIdempotentReplay(existing, input.Fingerprint)
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, lookupErr
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	task := model.Task{
		ID: id, UserID: userID, ProjectID: projectID,
		Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusQueued,
		Stage: "等待拆解", Progress: 5, Prompt: "视频拆解",
		Provider: "local", Model: "ffmpeg", InputJSON: string(inputJSON),
	}
	if err := s.createTaskWithinStorageQuota(&task, nil, policy); err != nil {
		if existing, lookupErr := s.repo.TaskForUser(userID, id); lookupErr == nil {
			return videoTeardownIdempotentReplay(existing, input.Fingerprint)
		}
		if errors.Is(err, repository.ErrActiveTaskLimit) {
			return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
		}
		return nil, err
	}
	s.recordActivity(userID, "task", 1)
	_ = s.log(userID, task.ID, "info", "视频拆解任务已进入队列", "")
	return taskForOutput(task), nil
}

func videoTeardownIdempotentReplay(task *model.Task, fingerprint string) (*model.Task, error) {
	if task == nil || task.Type != model.TaskTypeReplicationTeardown {
		return nil, idempotencyConflict()
	}
	var input videoTeardownInput
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Fingerprint == "" || input.Fingerprint != fingerprint {
		return nil, idempotencyConflict()
	}
	return taskForOutput(*task), nil
}

func (w *taskWorkerCoordinator) processReplicationTeardown(task *model.Task, parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, videoTeardownTimeout)
	defer cancel()
	bundle, err := w.runReplicationTeardown(ctx, task)
	if err != nil {
		return w.failReplicationTeardown(task, videoTeardownErrorMessage(err))
	}
	payload, err := json.Marshal(bundle)
	if err != nil {
		return w.failReplicationTeardown(task, "拆解结果无法保存")
	}
	task.Status = model.TaskStatusSucceeded
	task.Stage = "拆解完成"
	task.Progress = 100
	task.ResultJSON = string(payload)
	completedAt := time.Now()
	task.CompletedAt = &completedAt
	if err := w.service.repo.SaveTaskCompletion(task, model.TaskStatusRunning, nil); err != nil {
		return fmt.Errorf("保存视频拆解完成状态失败: %w", err)
	}
	w.service.logInfo(task.UserID, task.ID, fmt.Sprintf("视频拆解完成：%d 个镜头，%d 张宫格", len(bundle.Shots), len(bundle.Grids)), strings.Join(bundle.Warnings, "；"))
	return nil
}

func (w *taskWorkerCoordinator) runReplicationTeardown(ctx context.Context, task *model.Task) (videoTeardownBundle, error) {
	s := w.service
	var input videoTeardownInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || input.ResourceID == "" || input.MaxShots < 1 {
		return videoTeardownBundle{}, errors.New("拆解任务缺少有效的视频引用")
	}
	if err := s.ensureTaskProjectActive(task.UserID, task.ProjectID); err != nil {
		return videoTeardownBundle{}, errors.New("项目已删除、归档或无权访问")
	}
	// 按执行时的设置校验：排队期间后台调低了时长上限或关了口播识别，也照新设置执行。
	settings, err := s.videoReplicationSettings()
	if err != nil {
		return videoTeardownBundle{}, errors.New("无法读取视频复刻设置")
	}
	ffmpeg, err := videoTeardownFFmpeg()
	if err != nil {
		return videoTeardownBundle{}, err
	}
	if !mediaProbeAvailable() {
		return videoTeardownBundle{}, errMediaProbeUnavailable
	}
	if err := w.progress(task, "读取视频", 10); err != nil {
		return videoTeardownBundle{}, err
	}
	workDir, err := os.MkdirTemp("", "yingce-video-teardown-")
	if err != nil {
		return videoTeardownBundle{}, errors.New("无法创建拆解临时目录")
	}
	defer os.RemoveAll(workDir)
	sourcePath, mimeType, err := s.materializeVideoTeardownSource(task.UserID, input.ResourceID, workDir)
	if err != nil {
		return videoTeardownBundle{}, err
	}
	probe, err := probeMediaFile(ctx, sourcePath)
	if err != nil {
		return videoTeardownBundle{}, errors.New("无法识别视频文件")
	}
	if probe.Width <= 0 || probe.Height <= 0 || probe.DurationMs <= 0 {
		return videoTeardownBundle{}, errors.New("文件里没有可拆解的视频画面")
	}
	if probe.DurationMs > int64(settings.MaxDurationSeconds)*1000 {
		return videoTeardownBundle{}, errors.New(videoReplicationDurationError(settings.MaxDurationSeconds))
	}
	hasAudio, _ := probeHasAudioStream(ctx, sourcePath)

	if err := w.progress(task, "检测镜头切点", 20); err != nil {
		return videoTeardownBundle{}, err
	}
	cuts, err := detectVideoTeardownCuts(ctx, ffmpeg, sourcePath)
	if err != nil {
		return videoTeardownBundle{}, err
	}
	segments := buildVideoTeardownSegments(probe.DurationMs, cuts, input.MaxShots)

	if err := w.progress(task, fmt.Sprintf("截取 %d 个镜头的画面", len(segments)), 35); err != nil {
		return videoTeardownBundle{}, err
	}
	framesDir := filepath.Join(workDir, "frames")
	if err := os.MkdirAll(framesDir, 0o700); err != nil {
		return videoTeardownBundle{}, errors.New("无法创建关键帧目录")
	}
	frames, err := extractVideoTeardownFrames(ctx, ffmpeg, sourcePath, framesDir, segments, probe.DurationMs)
	if err != nil {
		return videoTeardownBundle{}, err
	}

	if err := w.progress(task, "拼接宫格", 55); err != nil {
		return videoTeardownBundle{}, err
	}
	gridPaths := []string{}
	for start := 0; start < len(frames); start += videoTeardownGridShots {
		end := min(start+videoTeardownGridShots, len(frames))
		path := filepath.Join(workDir, fmt.Sprintf("grid-%02d.jpg", len(gridPaths)+1))
		if err := buildVideoTeardownGrid(ctx, ffmpeg, workDir, len(gridPaths)+1, start+1, frames[start:end], path); err != nil {
			return videoTeardownBundle{}, err
		}
		gridPaths = append(gridPaths, path)
	}

	bundle := videoTeardownBundle{
		Version:    1,
		Source:     videoTeardownSource{ResourceID: input.ResourceID, DurationMs: probe.DurationMs, Width: probe.Width, Height: probe.Height, HasAudio: hasAudio},
		Shots:      make([]videoTeardownShot, 0, len(segments)),
		Grids:      make([]videoTeardownGrid, 0, len(gridPaths)),
		Transcript: videoTeardownTranscript{Source: "none", Segments: []timelineTranscriptionSegment{}},
		Warnings:   []string{},
	}
	if input.Transcribe {
		if err := w.progress(task, "识别口播", 65); err != nil {
			return videoTeardownBundle{}, err
		}
		transcript, warning := s.transcribeVideoTeardown(ctx, settings, sourcePath, mimeType, hasAudio, input.Language)
		bundle.Transcript = transcript
		if warning != "" {
			bundle.Warnings = append(bundle.Warnings, warning)
		}
	}

	if err := s.ensureTaskProjectActive(task.UserID, task.ProjectID); err != nil {
		return videoTeardownBundle{}, errors.New("项目已删除、归档或无权访问")
	}
	if err := w.progress(task, "保存关键帧", 85); err != nil {
		return videoTeardownBundle{}, err
	}
	for index, segment := range segments {
		times := videoTeardownFrameTimes(segment, probe.DurationMs)
		resource, width, height, err := s.saveVideoTeardownImage(task, fmt.Sprintf("keyframe-%03d.jpg", index+1), frames[index][1])
		if err != nil {
			return videoTeardownBundle{}, err
		}
		bundle.Shots = append(bundle.Shots, videoTeardownShot{
			Index: index + 1, StartMs: segment.StartMs, EndMs: segment.EndMs, Boundary: segment.Boundary,
			KeyframeTimeMs: times[1], KeyframeResourceID: resource.ID, KeyframeWidth: width, KeyframeHeight: height,
		})
	}
	for index, path := range gridPaths {
		resource, width, height, err := s.saveVideoTeardownImage(task, fmt.Sprintf("grid-%02d.jpg", index+1), path)
		if err != nil {
			return videoTeardownBundle{}, err
		}
		shotIndexes := []int{}
		for shot := index*videoTeardownGridShots + 1; shot <= min((index+1)*videoTeardownGridShots, len(segments)); shot++ {
			shotIndexes = append(shotIndexes, shot)
		}
		bundle.Grids = append(bundle.Grids, videoTeardownGrid{ResourceID: resource.ID, ShotIndexes: shotIndexes, Width: width, Height: height})
	}
	return bundle, nil
}

// materializeVideoTeardownSource 把用户自己的视频资源复制到临时目录，大小不超过资源上传上限。
func (s *Service) materializeVideoTeardownSource(userID, resourceID, workDir string) (string, string, error) {
	resource, reader, err := s.OpenResource(userID, resourceID)
	if err != nil || resource == nil || reader == nil {
		return "", "", errors.New("无法读取要拆解的视频，可能已被删除")
	}
	defer reader.Close()
	if !strings.HasPrefix(strings.ToLower(resource.MimeType), "video/") {
		return "", "", errors.New("只能拆解视频文件")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", "", errors.New("无法读取资源大小限制")
	}
	limit := megabytes(policy.Resource.ResourceUploadMB)
	path := filepath.Join(workDir, "source"+extForMime(resource.MimeType))
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", "", errors.New("无法写入拆解临时文件")
	}
	written, copyErr := io.Copy(file, io.LimitReader(reader, limit+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return "", "", errors.New("读取视频失败")
	}
	if written > limit {
		return "", "", errors.New("视频文件超过资源大小上限")
	}
	return path, resource.MimeType, nil
}

// transcribeVideoTeardown 调用已配置的 whisper.cpp 服务识别口播。后台关了口播识别、转写不可用或失败时不让整个拆解失败，
// 返回的 warning 会展示给用户，前端改让模型从画面字幕读口播。
func (s *Service) transcribeVideoTeardown(ctx context.Context, settings VideoReplicationSettings, sourcePath, mimeType string, hasAudio bool, language string) (videoTeardownTranscript, string) {
	none := videoTeardownTranscript{Source: "none", Segments: []timelineTranscriptionSegment{}}
	if !hasAudio {
		return none, "视频没有音轨，没有识别口播"
	}
	if !settings.TranscribeEnabled {
		return none, "后台已关闭口播识别，口播改从画面字幕识别"
	}
	if err := s.RequireFeature(FeatureTimelineTranscription); err != nil {
		return none, "字幕转写暂未开放，口播改从画面字幕识别"
	}
	baseURL := strings.TrimSpace(os.Getenv(whisperLangEnv))
	if baseURL == "" {
		return none, "未配置转写服务（" + whisperLangEnv + "），口播改从画面字幕识别"
	}
	file, err := os.Open(sourcePath)
	if err != nil {
		return none, "读取视频音轨失败，口播改从画面字幕识别"
	}
	defer file.Close()
	wavPath, cleanup, err := prepareWhisperWav(ctx, file, mimeType)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return none, "提取音轨失败，口播改从画面字幕识别"
	}
	if language == "auto" {
		language = ""
	}
	segments, detected, err := newWhisperClient(baseURL).transcribe(ctx, wavPath, language)
	if err != nil {
		return none, "口播识别失败（" + videoTeardownErrorMessage(err) + "），改从画面字幕识别"
	}
	return videoTeardownTranscript{Source: "asr", Language: detected, Segments: segments}, ""
}

// saveVideoTeardownImage 把关键帧或宫格存成图片资源。上传标识带任务 ID 和文件名，
// 任务被重新领取时复用已存的资源，不重复占用存储。
func (s *Service) saveVideoTeardownImage(task *model.Task, name, path string) (*model.Resource, int, int, error) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return nil, 0, 0, fmt.Errorf("读取%s失败", name)
	}
	width, height := imageDimensions(data)
	resource, err := s.UploadResourceFile(task.UserID, name, int64(len(data)), "image", width, height, 0, bytes.NewReader(data), "replication-teardown:"+task.ID+":"+name)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("保存%s失败：%w", name, err)
	}
	if resource == nil || !strings.HasPrefix(resource.MimeType, "image/") {
		return nil, 0, 0, fmt.Errorf("保存%s失败", name)
	}
	return resource, width, height, nil
}

func (w *taskWorkerCoordinator) failReplicationTeardown(task *model.Task, message string) error {
	done, err := w.service.repo.UpdateTaskTerminalState(task.ID, task.LeaseOwner, model.TaskStatusRunning, model.TaskStatusFailed, "视频拆解失败", message, time.Now())
	if err != nil {
		return fmt.Errorf("保存视频拆解失败状态失败: %w", err)
	}
	if !done {
		return fmt.Errorf("视频拆解任务状态或租约已变化: %w", repository.ErrTaskStateConflict)
	}
	w.service.logInfo(task.UserID, task.ID, "视频拆解失败", message)
	return nil
}

func videoTeardownErrorMessage(err error) string {
	if err == nil {
		return "视频拆解失败"
	}
	var appErr *AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "" {
		return appErr.Message
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "视频拆解超时或已取消"
	}
	message := strings.TrimSpace(err.Error())
	if message == "" || len([]rune(message)) > 400 {
		return "视频拆解失败"
	}
	return message
}
