package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	socialVideoMaxBytes       = int64(50 << 20)
	socialVideoCommandTimeout = 10 * time.Minute
	socialVideoOutputLimit    = 1 << 20
)

type socialVideoImportResult struct {
	Platform    string `json:"platform"`
	CanonicalID string `json:"canonicalId"`
	Title       string `json:"title"`
	ResourceID  string `json:"resourceId"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	DurationMs  int64  `json:"durationMs"`
	MimeType    string `json:"mimeType"`
	Size        int64  `json:"size"`
}

func (w *taskWorkerCoordinator) processSocialVideoImport(task *model.Task, parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, socialVideoCommandTimeout)
	defer cancel()
	result, err := w.runSocialVideoImport(ctx, task)
	if err != nil {
		message := socialVideoImportErrorMessage(err)
		return w.failSocialVideoTask(task, "视频导入失败", message)
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return w.failSocialVideoTask(task, "视频导入失败", "视频导入结果无法保存")
	}
	task.Status = model.TaskStatusSucceeded
	task.Stage = "视频导入完成"
	task.Progress = 100
	task.ResultJSON = string(payload)
	completedAt := time.Now()
	task.CompletedAt = &completedAt
	if err := w.service.repo.SaveTaskCompletion(task, model.TaskStatusRunning, nil); err != nil {
		return fmt.Errorf("保存视频导入完成状态失败: %w", err)
	}
	w.service.logInfo(task.UserID, task.ID, "社交视频导入完成", result.Platform+":"+result.CanonicalID)
	return nil
}

// runSocialVideoImport 把分享链接交给后台配置的第三方解析接口池：解析出视频地址、下载、ffprobe 校验，再存成本人的视频资源。
// 抖音 / TikTok 先展开短链拿到视频 ID（展开失败就把原链接交给接口）；同一平台同一视频 ID 复用已存资源。
func (w *taskWorkerCoordinator) runSocialVideoImport(ctx context.Context, task *model.Task) (socialVideoImportResult, error) {
	s := w.service
	var input socialVideoImportInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || input.URL == "" || input.Platform == "" {
		return socialVideoImportResult{}, errors.New("导入任务缺少有效链接")
	}
	platform := socialVideoPlatformByID(input.Platform)
	if platform == nil {
		return socialVideoImportResult{}, errors.New("不支持这个视频平台")
	}
	if err := s.ensureTaskProjectActive(task.UserID, task.ProjectID); err != nil {
		return socialVideoImportResult{}, errors.New("项目已删除、归档或无权访问")
	}
	if err := w.progress(task, "解析视频链接", 15); err != nil {
		return socialVideoImportResult{}, err
	}
	targetURL, canonicalID := input.URL, ""
	if platform.Strict {
		validator := s.socialVideoURLValidator
		resolved, err := resolveSocialVideoURL(ctx, socialVideoURL{URL: input.URL, Platform: input.Platform}, s.socialVideoParseClient(30*time.Second), validator)
		if err == nil {
			targetURL, canonicalID = socialVideoAPIURL(input.Platform, resolved), socialVideoCanonicalIDFromURL(input.Platform, resolved)
		} else {
			s.logInfo(task.UserID, task.ID, "短链接展开失败，直接把原链接交给解析接口", socialVideoShortError(err))
		}
	}

	policy, err := s.RuntimePolicy()
	if err != nil {
		return socialVideoImportResult{}, errors.New("无法读取上传限制")
	}
	maxBytes := min(socialVideoMaxBytes, megabytes(policy.Resource.ResourceUploadMB))
	if maxBytes <= 0 {
		return socialVideoImportResult{}, errors.New("视频上传大小限制不可用")
	}
	workDir, err := os.MkdirTemp("", "yingce-social-video-")
	if err != nil {
		return socialVideoImportResult{}, errors.New("无法创建视频导入临时目录")
	}
	defer os.RemoveAll(workDir)

	outcome, err := s.downloadSocialVideoWithPool(ctx, socialVideoParseJob{
		Platform: input.Platform, URL: targetURL, WorkDir: workDir, MaxBytes: maxBytes, MaxDurationSeconds: input.MaxDurationSeconds,
		Progress: func(stage string, percent int) { _ = w.progress(task, stage, percent) },
	})
	if err != nil {
		return socialVideoImportResult{}, err
	}
	if canonicalID == "" {
		canonicalID = outcome.Result.ID
	}
	if canonicalID == "" {
		canonicalID = socialVideoCanonicalIDFromURL(input.Platform, input.URL)
	}
	if err := s.ensureTaskProjectActive(task.UserID, task.ProjectID); err != nil {
		return socialVideoImportResult{}, errors.New("项目已删除、归档或无权访问")
	}
	if err := w.progress(task, "保存视频资源", 85); err != nil {
		return socialVideoImportResult{}, err
	}
	file, err := os.Open(outcome.Path)
	if err != nil {
		return socialVideoImportResult{}, errors.New("无法读取下载完成的视频")
	}
	defer file.Close()
	identity := "social-video:" + input.Platform + ":" + canonicalID
	resource, err := s.UploadResourceFile(task.UserID, socialVideoFileName(input.Platform, canonicalID, outcome.Path), outcome.Size, "video", outcome.Probe.Width, outcome.Probe.Height, outcome.Probe.DurationMs, file, identity)
	if err != nil || resource == nil || !strings.HasPrefix(resource.MimeType, "video/") {
		return socialVideoImportResult{}, errors.New("视频资源保存失败")
	}
	return socialVideoImportResult{
		Platform: input.Platform, CanonicalID: canonicalID, Title: outcome.Result.Title,
		ResourceID: resource.ID, Width: outcome.Probe.Width, Height: outcome.Probe.Height, DurationMs: outcome.Probe.DurationMs,
		MimeType: resource.MimeType, Size: resource.Size,
	}, nil
}

func socialVideoFileName(platform, canonicalID, path string) string {
	extension := ".mp4"
	if detected, err := mimetype.DetectFile(path); err == nil && strings.HasPrefix(detected.String(), "video/") && detected.Extension() != "" {
		extension = detected.Extension()
	}
	return platform + "-" + trimmedRunes(canonicalID, 60) + extension
}

func runSocialVideoOutput(ctx context.Context, name string, args, env []string) ([]byte, error) {
	bin, err := exec.LookPath(name)
	if err != nil {
		return nil, err
	}
	capture := &boundedCommandOutput{limit: socialVideoOutputLimit}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env, cmd.Stdout, cmd.Stderr = env, capture, io.Discard
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	if capture.overflow {
		return nil, errors.New("command output exceeded limit")
	}
	return capture.Bytes(), nil
}

type boundedCommandOutput struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (w *boundedCommandOutput) Write(p []byte) (int, error) {
	original := len(p)
	remaining := w.limit - w.Len()
	if remaining <= 0 {
		w.overflow = true
		return original, nil
	}
	if len(p) > remaining {
		w.overflow = true
		p = p[:remaining]
	}
	_, _ = w.Buffer.Write(p)
	return original, nil
}

func (w *taskWorkerCoordinator) failSocialVideoTask(task *model.Task, stage, message string) error {
	done, err := w.service.repo.UpdateTaskTerminalState(task.ID, task.LeaseOwner, model.TaskStatusRunning, model.TaskStatusFailed, stage, message, time.Now())
	if err != nil {
		return fmt.Errorf("保存视频导入失败状态失败: %w", err)
	}
	if !done {
		return fmt.Errorf("视频导入任务状态或租约已变化: %w", repository.ErrTaskStateConflict)
	}
	w.service.logInfo(task.UserID, task.ID, "社交视频导入失败", message)
	return nil
}

func socialVideoImportErrorMessage(err error) string {
	if err == nil {
		return "视频导入失败"
	}
	var appErr *AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "" {
		return appErr.Message
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "视频导入超时或已取消"
	}
	message := strings.TrimSpace(err.Error())
	if message == "" || len([]rune(message)) > 160 {
		return "视频导入失败"
	}
	return message
}
