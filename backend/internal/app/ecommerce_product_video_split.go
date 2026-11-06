package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 商品视频 · 元素替换的参考视频切段（product_video_split）：多模态视频模型一次只能参考十几秒的视频，
// 这里按镜头切点把用户选定的一段参考视频切成若干片段，每段在模型的参考时长内，分别交给模型
// 生成后再按原顺序拼回去，成片时长跟随参考视频。切段只用本地 ffmpeg，不调用模型、不计费；
// 片段和封面帧作为用户自己的资源计入存储。

const (
	productVideoSplitTimeout = 10 * time.Minute
	// 参考视频选段的时长范围，和页面上「4–120 秒」一致。
	productVideoMinRangeMs = int64(4_000)
	productVideoMaxRangeMs = int64(120_000)
	// 每段的时长上限由所选模型的参考视频时长决定，这里只限定合理范围；默认 15 秒（Seedance 2.0）。
	productVideoMinSegmentLimitMs = int64(8_000)
	productVideoMaxSegmentLimitMs = int64(30_000)
	productVideoDefaultSegmentMs  = int64(15_000)
	// productVideoMinSegmentMs：一段至少 4 秒，视频模型的最短生成时长通常是 4 秒。
	productVideoMinSegmentMs = int64(4_000)
	// productVideoClipShortEdge：片段短边不超过 720，参考视频不需要更高的清晰度，也能少占存储和参考计费。
	productVideoClipShortEdge = 720
	productVideoClipFPS       = 30
)

// ProductVideoSplitRequest 是创建切段任务的入参。EndMs 为 0 表示到视频结尾；
// MaxSegmentSeconds 为 0 时按 15 秒切。
type ProductVideoSplitRequest struct {
	ResourceID        string `json:"resourceId"`
	StartMs           int64  `json:"startMs"`
	EndMs             int64  `json:"endMs"`
	MaxSegmentSeconds int    `json:"maxSegmentSeconds"`
	// Ranges 不为空时按给定的几段原样切出（复刻工作台按镜头分好了生成单元），不再检测切点；
	// 每段 1 秒到 maxSegmentSeconds 之间，StartMs/EndMs 不再使用。
	Ranges []ProductVideoSplitRange `json:"ranges"`
}

// ProductVideoSplitRange 是要切出的一段在原视频里的位置（毫秒）。
type ProductVideoSplitRange struct {
	StartMs int64 `json:"startMs"`
	EndMs   int64 `json:"endMs"`
}

type productVideoSplitInput struct {
	Version      int                      `json:"version"`
	ResourceID   string                   `json:"resourceId"`
	StartMs      int64                    `json:"startMs"`
	EndMs        int64                    `json:"endMs"`
	MaxSegmentMs int64                    `json:"maxSegmentMs"`
	Ranges       []ProductVideoSplitRange `json:"ranges,omitempty"`
	Fingerprint  string                   `json:"fingerprint"`
}

type productVideoSplitResult struct {
	Version  int                   `json:"version"`
	Source   videoTeardownSource   `json:"source"`
	StartMs  int64                 `json:"startMs"`
	EndMs    int64                 `json:"endMs"`
	Segments []productVideoSegment `json:"segments"`
	Warnings []string              `json:"warnings"`
}

// productVideoSegment 是切好的一段。StartMs/EndMs 是在原视频里的位置（拼成片时按它对齐原声）；
// ResourceID 是这一段的视频资源，KeyframeResourceID 是中间一帧，页面上当封面。
type productVideoSegment struct {
	Index              int    `json:"index"`
	StartMs            int64  `json:"startMs"`
	EndMs              int64  `json:"endMs"`
	DurationMs         int64  `json:"durationMs"`
	Boundary           string `json:"boundary"`
	ResourceID         string `json:"resourceId"`
	Width              int    `json:"width"`
	Height             int    `json:"height"`
	KeyframeResourceID string `json:"keyframeResourceId"`
}

func normalizeProductVideoSplitRequest(req ProductVideoSplitRequest) (productVideoSplitInput, error) {
	input := productVideoSplitInput{Version: 1, ResourceID: strings.TrimSpace(req.ResourceID), StartMs: req.StartMs, EndMs: req.EndMs, MaxSegmentMs: int64(req.MaxSegmentSeconds) * 1000}
	if input.ResourceID == "" || len(input.ResourceID) > 128 {
		return productVideoSplitInput{}, BadAuthRequest("必须指定参考视频")
	}
	if input.MaxSegmentMs == 0 {
		input.MaxSegmentMs = productVideoDefaultSegmentMs
	}
	if input.MaxSegmentMs < productVideoMinSegmentLimitMs || input.MaxSegmentMs > productVideoMaxSegmentLimitMs {
		return productVideoSplitInput{}, BadAuthRequest(fmt.Sprintf("每段时长上限必须在 %d 到 %d 秒之间", productVideoMinSegmentLimitMs/1000, productVideoMaxSegmentLimitMs/1000))
	}
	if len(req.Ranges) > 0 {
		return normalizeProductVideoSplitRanges(input, req.Ranges)
	}
	if input.StartMs < 0 || input.EndMs < 0 || (input.EndMs > 0 && input.EndMs <= input.StartMs) {
		return productVideoSplitInput{}, BadAuthRequest("参考视频的选段无效")
	}
	if input.EndMs > 0 {
		if err := validateProductVideoRange(input.EndMs - input.StartMs); err != nil {
			return productVideoSplitInput{}, err
		}
	}
	return input, nil
}

// productVideoMaxRanges 限制一次切出的段数：拆解最多 60 个镜头，按镜头分的生成单元不会更多。
const productVideoMaxRanges = 60

func normalizeProductVideoSplitRanges(input productVideoSplitInput, ranges []ProductVideoSplitRange) (productVideoSplitInput, error) {
	if len(ranges) > productVideoMaxRanges {
		return productVideoSplitInput{}, BadAuthRequest(fmt.Sprintf("一次最多切 %d 段", productVideoMaxRanges))
	}
	input.Ranges = make([]ProductVideoSplitRange, 0, len(ranges))
	for index, item := range ranges {
		length := item.EndMs - item.StartMs
		if item.StartMs < 0 || length < 1000 || length > input.MaxSegmentMs {
			return productVideoSplitInput{}, BadAuthRequest(fmt.Sprintf("第 %d 段须在 1 到 %d 秒之间", index+1, input.MaxSegmentMs/1000))
		}
		input.Ranges = append(input.Ranges, item)
		if index == 0 || item.StartMs < input.StartMs {
			input.StartMs = item.StartMs
		}
		input.EndMs = max(input.EndMs, item.EndMs)
	}
	return input, nil
}

func validateProductVideoRange(lengthMs int64) error {
	if lengthMs < productVideoMinRangeMs || lengthMs > productVideoMaxRangeMs {
		return BadAuthRequest(fmt.Sprintf("参考视频选段须在 %d 到 %d 秒之间", productVideoMinRangeMs/1000, productVideoMaxRangeMs/1000))
	}
	return nil
}

func productVideoSplitTaskID(userID, idempotencyKey string) string {
	sum := sha256.Sum256([]byte("product-video-split\x00" + userID + "\x00" + idempotencyKey))
	return "pv" + hex.EncodeToString(sum[:16])
}

func productVideoSplitFingerprint(input productVideoSplitInput) string {
	parts := []string{input.ResourceID, strconv.FormatInt(input.StartMs, 10), strconv.FormatInt(input.EndMs, 10), strconv.FormatInt(input.MaxSegmentMs, 10)}
	for _, item := range input.Ranges {
		parts = append(parts, strconv.FormatInt(item.StartMs, 10)+"-"+strconv.FormatInt(item.EndMs, 10))
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

// CreateProductVideoSplitTask 校验参考视频归属、类型和选段后排队切段任务；同一幂等键重放返回原任务，
// 换了参数返回冲突。受「视频复刻」开关控制。
func (s *Service) CreateProductVideoSplitTask(userID, idempotencyKey string, req ProductVideoSplitRequest) (*model.Task, error) {
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
	input, err := normalizeProductVideoSplitRequest(req)
	if err != nil {
		return nil, err
	}
	id := productVideoSplitTaskID(userID, idempotencyKey)
	input.Fingerprint = productVideoSplitFingerprint(input)
	if existing, lookupErr := s.repo.TaskForUser(userID, id); lookupErr == nil {
		return productVideoSplitReplay(existing, input.Fingerprint)
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, lookupErr
	}
	resource, err := s.Resource(userID, input.ResourceID)
	if err != nil || resource == nil {
		return nil, BadAuthRequest("无法读取参考视频，可能已被删除")
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("参考视频还没有上传完成")
	}
	if !strings.HasPrefix(strings.ToLower(resource.MimeType), "video/") {
		return nil, BadAuthRequest("参考视频必须是视频文件")
	}
	// 资源记录了时长时先按它校验选段；没记录的到执行时按 ffprobe 结果再校验。
	if resource.DurationMs > 0 {
		end := input.EndMs
		if end == 0 {
			end = resource.DurationMs
		}
		if input.StartMs >= resource.DurationMs || end > resource.DurationMs+productVideoDurationSlackMs {
			return nil, BadAuthRequest("选段超出了参考视频的时长")
		}
		if len(input.Ranges) == 0 {
			if err := validateProductVideoRange(min(end, resource.DurationMs) - input.StartMs); err != nil {
				return nil, err
			}
		}
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
		ID: id, UserID: userID, Type: model.TaskTypeProductVideoSplit, Status: model.TaskStatusQueued,
		Stage: "等待切段", Progress: 5, Prompt: "参考视频切段",
		Provider: "local", Model: "ffmpeg", InputJSON: string(inputJSON),
	}
	if err := s.createTaskWithinStorageQuota(&task, nil, policy); err != nil {
		if existing, lookupErr := s.repo.TaskForUser(userID, id); lookupErr == nil {
			return productVideoSplitReplay(existing, input.Fingerprint)
		}
		if errors.Is(err, repository.ErrActiveTaskLimit) {
			return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
		}
		return nil, err
	}
	s.recordActivity(userID, "task", 1)
	_ = s.log(userID, task.ID, "info", "参考视频切段任务已进入队列", "")
	return taskForOutput(task), nil
}

// productVideoDurationSlackMs 容忍浏览器读到的时长和 ffprobe 之间的小误差。
const productVideoDurationSlackMs = int64(500)

func productVideoSplitReplay(task *model.Task, fingerprint string) (*model.Task, error) {
	if task == nil || task.Type != model.TaskTypeProductVideoSplit {
		return nil, idempotencyConflict()
	}
	var input productVideoSplitInput
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Fingerprint == "" || input.Fingerprint != fingerprint {
		return nil, idempotencyConflict()
	}
	return taskForOutput(*task), nil
}

func (w *taskWorkerCoordinator) processProductVideoSplit(task *model.Task, parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, productVideoSplitTimeout)
	defer cancel()
	result, err := w.runProductVideoSplit(ctx, task)
	if err != nil {
		return w.failProductVideoSplit(task, productVideoSplitErrorMessage(err))
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return w.failProductVideoSplit(task, "切段结果无法保存")
	}
	task.Status = model.TaskStatusSucceeded
	task.Stage = "切段完成"
	task.Progress = 100
	task.ResultJSON = string(payload)
	completedAt := time.Now()
	task.CompletedAt = &completedAt
	if err := w.service.repo.SaveTaskCompletion(task, model.TaskStatusRunning, nil); err != nil {
		return fmt.Errorf("保存参考视频切段完成状态失败: %w", err)
	}
	w.service.logInfo(task.UserID, task.ID, fmt.Sprintf("参考视频切段完成：%d 段", len(result.Segments)), strings.Join(result.Warnings, "；"))
	return nil
}

func (w *taskWorkerCoordinator) runProductVideoSplit(ctx context.Context, task *model.Task) (productVideoSplitResult, error) {
	s := w.service
	var input productVideoSplitInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || input.ResourceID == "" || input.MaxSegmentMs <= 0 {
		return productVideoSplitResult{}, errors.New("切段任务缺少有效的参考视频")
	}
	ffmpeg, err := videoTeardownFFmpeg()
	if err != nil {
		return productVideoSplitResult{}, err
	}
	if !mediaProbeAvailable() {
		return productVideoSplitResult{}, errMediaProbeUnavailable
	}
	if err := w.progress(task, "读取参考视频", 10); err != nil {
		return productVideoSplitResult{}, err
	}
	workDir, err := os.MkdirTemp("", "yingce-product-video-")
	if err != nil {
		return productVideoSplitResult{}, errors.New("无法创建切段临时目录")
	}
	defer os.RemoveAll(workDir)
	sourcePath, _, err := s.materializeVideoTeardownSource(task.UserID, input.ResourceID, workDir)
	if err != nil {
		return productVideoSplitResult{}, err
	}
	probe, err := probeMediaFile(ctx, sourcePath)
	if err != nil {
		return productVideoSplitResult{}, errors.New("无法识别参考视频")
	}
	if probe.Width <= 0 || probe.Height <= 0 || probe.DurationMs <= 0 {
		return productVideoSplitResult{}, errors.New("参考视频里没有可用的画面")
	}
	startMs, endMs := input.StartMs, input.EndMs
	if endMs == 0 || endMs > probe.DurationMs {
		if endMs > probe.DurationMs+productVideoDurationSlackMs {
			return productVideoSplitResult{}, errors.New("选段超出了参考视频的时长")
		}
		endMs = probe.DurationMs
	}
	if startMs >= endMs {
		return productVideoSplitResult{}, errors.New("选段超出了参考视频的时长")
	}
	if len(input.Ranges) == 0 {
		if err := validateProductVideoRange(endMs - startMs); err != nil {
			return productVideoSplitResult{}, err
		}
	}
	hasAudio, _ := probeHasAudioStream(ctx, sourcePath)

	var segments []videoTeardownSegment
	if len(input.Ranges) > 0 {
		segments, err = productVideoRangeSegments(input.Ranges, probe.DurationMs)
		if err != nil {
			return productVideoSplitResult{}, err
		}
	} else {
		if err := w.progress(task, "检测镜头切点", 20); err != nil {
			return productVideoSplitResult{}, err
		}
		cuts, err := detectVideoTeardownCuts(ctx, ffmpeg, sourcePath, startMs, endMs-startMs)
		if err != nil {
			return productVideoSplitResult{}, err
		}
		for index := range cuts {
			cuts[index] += startMs
		}
		segments = planProductVideoSegments(startMs, endMs, cuts, input.MaxSegmentMs, productVideoMinSegmentMs)
	}
	width, height := productVideoClipSize(probe.Width, probe.Height)
	result := productVideoSplitResult{
		Version: 1, StartMs: startMs, EndMs: endMs,
		Source:   videoTeardownSource{ResourceID: input.ResourceID, DurationMs: probe.DurationMs, Width: probe.Width, Height: probe.Height, HasAudio: hasAudio},
		Segments: make([]productVideoSegment, 0, len(segments)),
		Warnings: []string{},
	}
	if min(width, height) < 300 {
		result.Warnings = append(result.Warnings, "参考视频分辨率偏低，部分模型要求参考视频宽高至少 300 像素")
	}
	if ratio := float64(width) / float64(height); ratio < 0.4 || ratio > 2.5 {
		result.Warnings = append(result.Warnings, "参考视频的画面过窄或过宽，部分模型只接受 0.4–2.5 的宽高比")
	}
	for index, segment := range segments {
		percent := 30 + 60*index/len(segments)
		if err := w.progress(task, fmt.Sprintf("切出第 %d/%d 段", index+1, len(segments)), percent); err != nil {
			return productVideoSplitResult{}, err
		}
		clipPath := filepath.Join(workDir, fmt.Sprintf("segment-%02d.mp4", index+1))
		if err := extractProductVideoClip(ctx, ffmpeg, sourcePath, clipPath, segment, width, height, hasAudio); err != nil {
			return productVideoSplitResult{}, fmt.Errorf("第 %d 段：%w", index+1, err)
		}
		framePath := filepath.Join(workDir, fmt.Sprintf("segment-%02d.jpg", index+1))
		middle := segment.durationMs() / 2
		if err := extractVideoTeardownFrame(ctx, ffmpeg, clipPath, framePath, middle, 0); err != nil {
			return productVideoSplitResult{}, fmt.Errorf("第 %d 段：%w", index+1, err)
		}
		clip, err := s.saveProductVideoClip(task, fmt.Sprintf("参考片段-%02d.mp4", index+1), clipPath, width, height, segment.durationMs())
		if err != nil {
			return productVideoSplitResult{}, err
		}
		frame, err := s.saveProductVideoImage(task, fmt.Sprintf("参考片段-%02d.jpg", index+1), framePath)
		if err != nil {
			return productVideoSplitResult{}, err
		}
		result.Segments = append(result.Segments, productVideoSegment{
			Index: index + 1, StartMs: segment.StartMs, EndMs: segment.EndMs, DurationMs: segment.durationMs(), Boundary: segment.Boundary,
			ResourceID: clip.ID, Width: width, Height: height, KeyframeResourceID: frame.ID,
		})
	}
	return result, nil
}

// productVideoRangeSegments 把给定的几段换成切段，结尾超出视频时长一点（浏览器和 ffprobe 的误差）时截到结尾。
func productVideoRangeSegments(ranges []ProductVideoSplitRange, durationMs int64) ([]videoTeardownSegment, error) {
	segments := make([]videoTeardownSegment, 0, len(ranges))
	for index, item := range ranges {
		end := item.EndMs
		if end > durationMs {
			if end > durationMs+productVideoDurationSlackMs {
				return nil, fmt.Errorf("第 %d 段超出了参考视频的时长", index+1)
			}
			end = durationMs
		}
		if end-item.StartMs < 500 {
			return nil, fmt.Errorf("第 %d 段太短", index+1)
		}
		segments = append(segments, videoTeardownSegment{StartMs: item.StartMs, EndMs: end, Boundary: videoTeardownBoundaryCut})
	}
	return segments, nil
}

// planProductVideoSegments 把 [startMs, endMs) 划成若干段：尽量在镜头切点处断开，每段不超过 maxMs；
// 单个镜头超过 maxMs 时均分；短于 minMs 的段并入相邻段，并不进去（合起来超过 maxMs）时和相邻段平分。
// 返回的时间都是原视频里的绝对位置。maxMs 至少是 minMs 的两倍，平分后的两段都不会短于 minMs。
func planProductVideoSegments(startMs, endMs int64, cutsMs []int64, maxMs, minMs int64) []videoTeardownSegment {
	if endMs <= startMs || maxMs <= 0 {
		return nil
	}
	sorted := slices.Clone(cutsMs)
	slices.Sort(sorted)
	bounds := []int64{startMs}
	for _, cut := range sorted {
		if cut-bounds[len(bounds)-1] < videoTeardownMinShotMs || endMs-cut < videoTeardownMinShotMs {
			continue
		}
		bounds = append(bounds, cut)
	}
	bounds = append(bounds, endMs)

	segments := []videoTeardownSegment{}
	chunkStart, chunkEnd, boundary := startMs, startMs, videoTeardownBoundaryStart
	for index := 1; index < len(bounds); index++ {
		shotEnd := bounds[index]
		if shotEnd-chunkStart <= maxMs {
			chunkEnd = shotEnd
			continue
		}
		if chunkEnd > chunkStart {
			segments = append(segments, videoTeardownSegment{StartMs: chunkStart, EndMs: chunkEnd, Boundary: boundary})
			chunkStart, boundary = chunkEnd, videoTeardownBoundaryCut
		}
		if shotEnd-chunkStart <= maxMs {
			chunkEnd = shotEnd
			continue
		}
		// 一个镜头就超过上限：均分成若干段，最后一段留着，还能和后面的短镜头拼在一起。
		length := shotEnd - chunkStart
		parts := (length + maxMs - 1) / maxMs
		for part := int64(0); part < parts-1; part++ {
			partStart := chunkStart + length*part/parts
			partEnd := chunkStart + length*(part+1)/parts
			partBoundary := videoTeardownBoundarySplit
			if part == 0 {
				partBoundary = boundary
			}
			segments = append(segments, videoTeardownSegment{StartMs: partStart, EndMs: partEnd, Boundary: partBoundary})
		}
		chunkStart, chunkEnd, boundary = chunkStart+length*(parts-1)/parts, shotEnd, videoTeardownBoundarySplit
	}
	segments = append(segments, videoTeardownSegment{StartMs: chunkStart, EndMs: chunkEnd, Boundary: boundary})

	for len(segments) > 1 {
		short := slices.IndexFunc(segments, func(segment videoTeardownSegment) bool { return segment.durationMs() < minMs })
		if short < 0 {
			break
		}
		// 先找能直接并进去的邻居（优先较短的那一边），都并不进去时和较短的邻居平分。
		neighbor := short - 1
		if short == 0 || (short+1 < len(segments) && segments[short+1].durationMs() < segments[short-1].durationMs()) {
			neighbor = short + 1
		}
		left := min(short, neighbor)
		merged := videoTeardownSegment{StartMs: segments[left].StartMs, EndMs: segments[left+1].EndMs, Boundary: segments[left].Boundary}
		if merged.durationMs() <= maxMs {
			segments = slices.Replace(segments, left, left+2, merged)
			continue
		}
		middle := merged.StartMs + merged.durationMs()/2
		segments[left].EndMs = middle
		segments[left+1].StartMs, segments[left+1].Boundary = middle, videoTeardownBoundarySplit
	}
	return segments
}

// productVideoClipSize 返回片段的输出尺寸：短边不超过 productVideoClipShortEdge，宽高取偶数（libx264 yuv420p 要求）。
func productVideoClipSize(width, height int) (int, int) {
	scale := math.Min(1, float64(productVideoClipShortEdge)/float64(min(width, height)))
	even := func(value float64) int { return max(int(math.Round(value/2))*2, 2) }
	return even(float64(width) * scale), even(float64(height) * scale)
}

// extractProductVideoClip 重新编码出一段 H.264/AAC 的 mp4：统一 30fps，丢掉原视频的容器元数据；
// 原视频没有音轨时只输出画面。
func extractProductVideoClip(ctx context.Context, ffmpeg, source, output string, segment videoTeardownSegment, width, height int, hasAudio bool) error {
	args := []string{"-hide_banner", "-nostdin", "-loglevel", "error", "-y",
		"-ss", strconv.FormatFloat(float64(segment.StartMs)/1000, 'f', 3, 64), "-i", source,
		"-t", strconv.FormatFloat(float64(segment.durationMs())/1000, 'f', 3, 64),
		"-map", "0:v:0",
	}
	if hasAudio {
		args = append(args, "-map", "0:a:0", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", strconv.Itoa(renderSampleRate))
	}
	args = append(args,
		"-vf", fmt.Sprintf("scale=%d:%d,setsar=1,fps=%d", width, height, productVideoClipFPS),
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
		"-map_metadata", "-1", "-movflags", "+faststart", output,
	)
	combined, err := exec.CommandContext(ctx, ffmpeg, args...).CombinedOutput()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("切出片段失败（ffmpeg）：%s", commandTail(combined))
	}
	if info, statErr := os.Stat(output); statErr != nil || info.Size() == 0 {
		return errors.New("切出的片段为空")
	}
	return nil
}

func productVideoUploadIdentity(taskID, name string) string {
	return "product-video-split:" + taskID + ":" + name
}

// saveProductVideoClip 把片段存成视频资源；上传标识带任务 ID 和文件名，任务被重新领取时复用已存的资源。
func (s *Service) saveProductVideoClip(task *model.Task, name, path string, width, height int, durationMs int64) (*model.Resource, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("读取%s失败", name)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() == 0 {
		return nil, fmt.Errorf("读取%s失败", name)
	}
	if probed := probeMediaDurationMs(path); probed > 0 {
		durationMs = probed
	}
	resource, err := s.UploadResourceFile(task.UserID, name, info.Size(), "video", width, height, durationMs, file, productVideoUploadIdentity(task.ID, name))
	if err != nil {
		return nil, fmt.Errorf("保存%s失败：%w", name, err)
	}
	if resource == nil || !strings.HasPrefix(resource.MimeType, "video/") {
		return nil, fmt.Errorf("保存%s失败", name)
	}
	return resource, nil
}

func (s *Service) saveProductVideoImage(task *model.Task, name, path string) (*model.Resource, error) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return nil, fmt.Errorf("读取%s失败", name)
	}
	width, height := imageDimensions(data)
	resource, err := s.UploadResourceFile(task.UserID, name, int64(len(data)), "image", width, height, 0, bytes.NewReader(data), productVideoUploadIdentity(task.ID, name))
	if err != nil {
		return nil, fmt.Errorf("保存%s失败：%w", name, err)
	}
	if resource == nil || !strings.HasPrefix(resource.MimeType, "image/") {
		return nil, fmt.Errorf("保存%s失败", name)
	}
	return resource, nil
}

func (w *taskWorkerCoordinator) failProductVideoSplit(task *model.Task, message string) error {
	done, err := w.service.repo.UpdateTaskTerminalState(task.ID, task.LeaseOwner, model.TaskStatusRunning, model.TaskStatusFailed, "参考视频切段失败", message, time.Now())
	if err != nil {
		return fmt.Errorf("保存参考视频切段失败状态失败: %w", err)
	}
	if !done {
		return fmt.Errorf("参考视频切段任务状态或租约已变化: %w", repository.ErrTaskStateConflict)
	}
	w.service.logInfo(task.UserID, task.ID, "参考视频切段失败", message)
	return nil
}

func productVideoSplitErrorMessage(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "参考视频切段超时或已取消"
	}
	message := videoTeardownErrorMessage(err)
	if message == "视频拆解失败" {
		return "参考视频切段失败"
	}
	return message
}
