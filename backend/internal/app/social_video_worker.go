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
	"path/filepath"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
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

func (w *taskWorkerCoordinator) runSocialVideoImport(ctx context.Context, task *model.Task) (socialVideoImportResult, error) {
	s := w.service
	var input socialVideoImportInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || input.URL == "" || input.Platform == "" {
		return socialVideoImportResult{}, errors.New("导入任务缺少有效链接")
	}
	if err := s.ensureTaskProjectActive(task.UserID, task.ProjectID); err != nil {
		return socialVideoImportResult{}, errors.New("项目已删除、归档或无权访问")
	}
	if err := w.progress(task, "解析视频链接", 15); err != nil {
		return socialVideoImportResult{}, err
	}
	finalURL, err := resolveSocialVideoURL(ctx, socialVideoURL{URL: input.URL, Platform: input.Platform}, outbound.OutboundHTTPClient(30*time.Second), outbound.ValidateOutboundURL)
	if err != nil {
		return socialVideoImportResult{}, err
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
	homeDir, downloadDir := filepath.Join(workDir, "home"), filepath.Join(workDir, "download")
	if err := os.MkdirAll(filepath.Join(homeDir, ".config"), 0o700); err != nil {
		return socialVideoImportResult{}, errors.New("无法初始化视频导入环境")
	}
	if err := os.MkdirAll(downloadDir, 0o700); err != nil {
		return socialVideoImportResult{}, errors.New("无法初始化视频下载目录")
	}
	env := isolatedSocialVideoEnv(homeDir)

	metadataRaw, err := runSocialVideoOutput(ctx, "yt-dlp", socialVideoMetadataArgs(finalURL), env)
	if err != nil {
		return socialVideoImportResult{}, errors.New("无法读取平台视频信息")
	}
	metadata, err := parseSocialVideoMetadata(metadataRaw, input.Platform, maxBytes)
	if err != nil {
		return socialVideoImportResult{}, err
	}
	if err := w.progress(task, "下载视频", 35); err != nil {
		return socialVideoImportResult{}, err
	}
	outputTemplate := filepath.Join(downloadDir, "video.%(ext)s")
	if err := runSocialVideoDownload(ctx, finalURL, outputTemplate, downloadDir, homeDir, maxBytes, env); err != nil {
		return socialVideoImportResult{}, errors.New("平台视频下载失败")
	}
	videoPath, size, err := singleSocialVideoFile(downloadDir, maxBytes)
	if err != nil {
		return socialVideoImportResult{}, err
	}

	if err := w.progress(task, "校验视频", 70); err != nil {
		return socialVideoImportResult{}, err
	}
	probeRaw, err := runSocialVideoOutput(ctx, "ffprobe", []string{"-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath}, env)
	if err != nil {
		return socialVideoImportResult{}, errors.New("下载结果无法识别为视频")
	}
	probe, err := parseSocialVideoProbe(probeRaw)
	if err != nil {
		return socialVideoImportResult{}, err
	}
	if err := s.ensureTaskProjectActive(task.UserID, task.ProjectID); err != nil {
		return socialVideoImportResult{}, errors.New("项目已删除、归档或无权访问")
	}
	if err := w.progress(task, "保存视频资源", 85); err != nil {
		return socialVideoImportResult{}, err
	}
	file, err := os.Open(videoPath)
	if err != nil {
		return socialVideoImportResult{}, errors.New("无法读取下载完成的视频")
	}
	defer file.Close()
	identity := "social-video:" + input.Platform + ":" + metadata.CanonicalID
	resource, err := s.UploadResourceFile(task.UserID, filepath.Base(videoPath), size, "video", probe.Width, probe.Height, probe.DurationMs, file, identity)
	if err != nil || resource == nil || !strings.HasPrefix(resource.MimeType, "video/") {
		return socialVideoImportResult{}, errors.New("视频资源保存失败")
	}
	return socialVideoImportResult{
		Platform: input.Platform, CanonicalID: metadata.CanonicalID, Title: metadata.Title,
		ResourceID: resource.ID, Width: probe.Width, Height: probe.Height, DurationMs: probe.DurationMs,
		MimeType: resource.MimeType, Size: resource.Size,
	}, nil
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

func runSocialVideoDownload(ctx context.Context, rawURL, outputTemplate, downloadDir, homeDir string, maxBytes int64, env []string) error {
	bin, err := exec.LookPath("yt-dlp")
	if err != nil {
		return err
	}
	downloadCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(downloadCtx, bin, socialVideoDownloadArgs(rawURL, outputTemplate, maxBytes)...)
	cmd.Dir, cmd.Env, cmd.Stdout, cmd.Stderr = homeDir, env, io.Discard, io.Discard
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			if err != nil {
				return err
			}
			total, scanErr := socialVideoDirectoryBytes(downloadDir)
			if scanErr != nil || total > maxBytes {
				return errors.New("download exceeded size limit")
			}
			return nil
		case <-ticker.C:
			total, scanErr := socialVideoDirectoryBytes(downloadDir)
			if scanErr != nil || total > maxBytes {
				cancel()
				<-done
				return errors.New("download exceeded size limit")
			}
		case <-ctx.Done():
			cancel()
			<-done
			return ctx.Err()
		}
	}
}

func socialVideoDirectoryBytes(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("download created a symbolic link")
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("download created a non-regular file")
		}
		total += info.Size()
		return nil
	})
	return total, err
}

func singleSocialVideoFile(root string, maxBytes int64) (string, int64, error) {
	var path string
	var size int64
	err := filepath.WalkDir(root, func(current string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("视频下载结果包含不安全链接")
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return errors.New("视频下载结果包含无效文件")
		}
		if path != "" {
			return errors.New("视频下载结果不是单个文件")
		}
		path, size = current, info.Size()
		return nil
	})
	if err != nil {
		return "", 0, err
	}
	if path == "" || size <= 0 || size > maxBytes {
		return "", 0, errors.New("视频文件为空或超过大小限制")
	}
	return path, size, nil
}

func isolatedSocialVideoEnv(home string) []string {
	result := make([]string, 0, len(os.Environ())+2)
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		if strings.EqualFold(key, "HOME") || strings.EqualFold(key, "XDG_CONFIG_HOME") {
			continue
		}
		result = append(result, item)
	}
	return append(result, "HOME="+home, "XDG_CONFIG_HOME="+filepath.Join(home, ".config"))
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
