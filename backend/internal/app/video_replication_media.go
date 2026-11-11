package app

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/sync/errgroup"
)

// 视频复刻拆解用到的 ffmpeg 步骤与纯计算：切点检测、镜头划分、关键帧时间、宫格拼接。
// 切点只用 ffmpeg 自带的场景分数，不依赖 Python；阈值和镜头长度上下限后续按样片再调。

const (
	// videoTeardownSceneThreshold 是 select 滤镜的场景分数阈值（0–1），越小切得越碎。
	videoTeardownSceneThreshold = 0.3
	// videoTeardownMinShotMs：短于它的镜头并入前一镜，闪白、字幕弹出不单独成镜。
	videoTeardownMinShotMs = int64(400)
	// videoTeardownMaxSegmentMs：没有切点的长镜头按这个长度切开，一行分镜对应一次视频生成能覆盖的时长。
	videoTeardownMaxSegmentMs = int64(10_000)
	// videoTeardownFrameEdge 是关键帧长边像素，宫格里每格就是这个尺寸。
	videoTeardownFrameEdge = 512
	// videoTeardownGridShots：每张宫格放 3 个镜头，一行一个镜头，三列是开头、中间、结尾。
	videoTeardownGridShots = 3
	// videoTeardownGridGap 是宫格外边和格子间隔（中灰），videoTeardownLabelWidth 是左侧镜头编号条的宽度。
	videoTeardownGridGap         = 8
	videoTeardownLabelWidth      = 80
	videoTeardownFrameConcurrent = 4
	videoTeardownStderrLimit     = 4 << 20
)

const (
	videoTeardownBoundaryStart = "start"
	videoTeardownBoundaryCut   = "cut"
	videoTeardownBoundarySplit = "split"
)

var videoTeardownPTSTime = regexp.MustCompile(`pts_time:\s*([0-9]+(?:\.[0-9]+)?)`)

// videoTeardownSegment 是划分后的一个镜头；Boundary 说明这一镜开头是怎么来的：
// start 第一镜，cut 检测到的切点，split 长镜头按时长切开（前后画面连续）。
type videoTeardownSegment struct {
	StartMs  int64
	EndMs    int64
	Boundary string
}

func (s videoTeardownSegment) durationMs() int64 { return s.EndMs - s.StartMs }

// parseVideoTeardownCuts 从 showinfo 日志里取出被 select 选中的帧时间（毫秒），升序去重。
func parseVideoTeardownCuts(stderr []byte) []int64 {
	var cuts []int64
	for _, line := range strings.Split(string(stderr), "\n") {
		if !strings.Contains(line, "showinfo") {
			continue
		}
		match := videoTeardownPTSTime.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		seconds, err := strconv.ParseFloat(match[1], 64)
		if err != nil || seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
			continue
		}
		cuts = append(cuts, int64(math.Round(seconds*1000)))
	}
	slices.Sort(cuts)
	return slices.Compact(cuts)
}

// buildVideoTeardownSegments 把切点变成镜头：去掉离上一切点或片尾太近的切点，长镜头按时长切开，
// 镜头数超过 maxShots 时反复合并最短的一镜（优先并回同一长镜头切开的相邻段）。
func buildVideoTeardownSegments(durationMs int64, cutsMs []int64, maxShots int) []videoTeardownSegment {
	if durationMs <= 0 {
		return nil
	}
	if maxShots <= 0 {
		maxShots = 1
	}
	sorted := slices.Clone(cutsMs)
	slices.Sort(sorted)
	segments := make([]videoTeardownSegment, 0, len(sorted)+1)
	start, boundary := int64(0), videoTeardownBoundaryStart
	for _, cut := range sorted {
		if cut-start < videoTeardownMinShotMs || durationMs-cut < videoTeardownMinShotMs {
			continue
		}
		segments = append(segments, videoTeardownSegment{StartMs: start, EndMs: cut, Boundary: boundary})
		start, boundary = cut, videoTeardownBoundaryCut
	}
	segments = append(segments, videoTeardownSegment{StartMs: start, EndMs: durationMs, Boundary: boundary})

	split := make([]videoTeardownSegment, 0, len(segments))
	for _, segment := range segments {
		parts := int((segment.durationMs() + videoTeardownMaxSegmentMs - 1) / videoTeardownMaxSegmentMs)
		if parts <= 1 {
			split = append(split, segment)
			continue
		}
		for part := 0; part < parts; part++ {
			partStart := segment.StartMs + segment.durationMs()*int64(part)/int64(parts)
			partEnd := segment.StartMs + segment.durationMs()*int64(part+1)/int64(parts)
			partBoundary := videoTeardownBoundarySplit
			if part == 0 {
				partBoundary = segment.Boundary
			}
			split = append(split, videoTeardownSegment{StartMs: partStart, EndMs: partEnd, Boundary: partBoundary})
		}
	}

	for len(split) > maxShots {
		left := videoTeardownMergePoint(split)
		merged := videoTeardownSegment{StartMs: split[left].StartMs, EndMs: split[left+1].EndMs, Boundary: split[left].Boundary}
		split = append(split[:left], append([]videoTeardownSegment{merged}, split[left+2:]...)...)
	}
	return split
}

// videoTeardownMergePoint 选出要合并的相邻两镜，返回左边那一镜的下标：先把按时长切开的长镜头拼回去
// （选合并后最短的一处），没有可拼的再把最短的真实镜头并入较短的邻居。
func videoTeardownMergePoint(segments []videoTeardownSegment) int {
	best := -1
	for index := 1; index < len(segments); index++ {
		if segments[index].Boundary != videoTeardownBoundarySplit {
			continue
		}
		if best < 0 || segments[index-1].durationMs()+segments[index].durationMs() < segments[best].durationMs()+segments[best+1].durationMs() {
			best = index - 1
		}
	}
	if best >= 0 {
		return best
	}
	shortest := 0
	for index := range segments {
		if segments[index].durationMs() < segments[shortest].durationMs() {
			shortest = index
		}
	}
	switch {
	case shortest == 0:
		return 0
	case shortest == len(segments)-1:
		return shortest - 1
	case segments[shortest+1].durationMs() < segments[shortest-1].durationMs():
		return shortest
	default:
		return shortest - 1
	}
}

// videoTeardownFrameTimes 返回一镜的开头、中间、结尾取帧时间：开头和结尾各向内收一点，
// 避开转场边缘；片尾最后一帧之后取不到画面，再留出 50ms。
func videoTeardownFrameTimes(segment videoTeardownSegment, durationMs int64) [3]int64 {
	inset := min(max(segment.durationMs()/10, 40), 500)
	limit := max(durationMs-50, 0)
	mid := min((segment.StartMs+segment.EndMs)/2, limit)
	first := min(segment.StartMs+inset, mid)
	last := max(min(segment.EndMs-inset, limit), mid)
	return [3]int64{first, mid, last}
}

func videoTeardownFFmpeg() (string, error) {
	// 与时间线渲染共用 CANVAS_FFMPEG_PATH 与 PATH 查找规则。
	return renderFfmpegBinary()
}

// 分析过程只使用关键帧所需的清晰度，原片的尺寸、音轨和时间范围仍用于素材记录与转写。
func prepareVideoTeardownAnalysis(ctx context.Context, ffmpeg, source, dir string, width, height int) (string, error) {
	if max(width, height) <= videoTeardownFrameEdge {
		return source, nil
	}
	output := filepath.Join(dir, "analysis.mp4")
	threads := strconv.Itoa(min(runtime.GOMAXPROCS(0), videoTeardownFrameConcurrent))
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
		"-threads", threads, "-filter_threads", "1", "-i", source,
		"-map", "0:v:0", "-an", "-sn", "-dn", "-vf",
		fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease:force_divisible_by=2", videoTeardownFrameEdge, videoTeardownFrameEdge),
		"-fps_mode", "passthrough", "-c:v", "libx264", "-threads", threads, "-preset", "ultrafast", "-crf", "18", "-g", "30", output)
	combined, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if err != nil {
		return "", fmt.Errorf("准备分析视频失败（ffmpeg）：%s", commandTail(combined))
	}
	return output, nil
}

// detectVideoTeardownCuts 用场景分数找硬切和明显转场：先缩到 320 宽再算，3 分钟视频通常几秒内完成。
// windowMs > 0 时只检测从 startMs 起这一段，返回的切点仍是相对这一段开头的毫秒数。
func detectVideoTeardownCuts(ctx context.Context, ffmpeg, path string, startMs, windowMs int64) ([]int64, error) {
	filter := fmt.Sprintf("scale=320:-2,select='gt(scene,%.2f)',showinfo", videoTeardownSceneThreshold)
	stderr := &boundedCommandOutput{limit: videoTeardownStderrLimit}
	args := []string{"-hide_banner", "-nostdin", "-nostats", "-threads", "2", "-filter_threads", "1"}
	if windowMs > 0 {
		args = append(args, "-ss", strconv.FormatFloat(float64(startMs)/1000, 'f', 3, 64), "-t", strconv.FormatFloat(float64(windowMs)/1000, 'f', 3, 64))
	}
	args = append(args, "-i", path, "-an", "-sn", "-dn", "-vf", filter, "-f", "null", "-")
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	cmd.Stdout, cmd.Stderr = io.Discard, stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("镜头检测失败（ffmpeg）：%s", commandTail(stderr.Bytes()))
	}
	if stderr.overflow {
		return nil, errors.New("镜头检测输出过长，视频可能切换过于频繁")
	}
	return parseVideoTeardownCuts(stderr.Bytes()), nil
}

// extractVideoTeardownFrame 在指定时间截一帧，长边缩到 videoTeardownFrameEdge。
// 片尾附近可能取不到帧，依次往前退 200ms、退到 fallbackMs 再试。
func extractVideoTeardownFrame(ctx context.Context, ffmpeg, source, output string, timeMs, fallbackMs int64) error {
	scale := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease:force_divisible_by=2", videoTeardownFrameEdge, videoTeardownFrameEdge)
	var lastErr error
	for _, at := range []int64{timeMs, max(timeMs-200, 0), fallbackMs} {
		_ = os.Remove(output)
		cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
			"-threads", "1", "-filter_threads", "1",
			"-ss", strconv.FormatFloat(float64(at)/1000, 'f', 3, 64), "-i", source,
			"-frames:v", "1", "-an", "-vf", scale, "-q:v", "3", output)
		combined, err := cmd.CombinedOutput()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if info, statErr := os.Stat(output); err == nil && statErr == nil && info.Size() > 0 {
			return nil
		}
		lastErr = fmt.Errorf("截取画面失败（ffmpeg）：%s", commandTail(combined))
	}
	return lastErr
}

// extractVideoTeardownFrames 为每个镜头截开头、中间、结尾三帧，文件名按镜头顺序排列，
// 便于直接按序号拼宫格。返回 frames[镜头][0..2] 的路径。
func extractVideoTeardownFrames(ctx context.Context, ffmpeg, source, dir string, segments []videoTeardownSegment, durationMs int64) ([][3]string, error) {
	frames := make([][3]string, len(segments))
	group, groupCtx := errgroup.WithContext(ctx)
	group.SetLimit(min(runtime.GOMAXPROCS(0), videoTeardownFrameConcurrent))
	for index, segment := range segments {
		times := videoTeardownFrameTimes(segment, durationMs)
		for role, at := range times {
			path := filepath.Join(dir, fmt.Sprintf("frame-%03d-%d.jpg", index+1, role))
			frames[index][role] = path
			group.Go(func() error {
				if err := extractVideoTeardownFrame(groupCtx, ffmpeg, source, path, at, times[1]); err != nil {
					return fmt.Errorf("第 %d 镜：%w", index+1, err)
				}
				return nil
			})
		}
	}
	if err := group.Wait(); err != nil {
		return nil, err
	}
	return frames, nil
}

// buildVideoTeardownGrid 把若干镜头的三帧拼成一张图：一行一个镜头，三列依次是开头、中间、结尾，
// 左侧编号条写上镜头编号（从 firstShot 起）。模型按编号对应镜头，不靠自己数行。
func buildVideoTeardownGrid(ctx context.Context, ffmpeg, dir string, index, firstShot int, shots [][3]string, output string) error {
	sequence := filepath.Join(dir, fmt.Sprintf("grid-%02d", index))
	if err := os.MkdirAll(sequence, 0o700); err != nil {
		return err
	}
	number := 0
	for _, shot := range shots {
		for _, frame := range shot {
			number++
			if err := copyVideoTeardownFile(frame, filepath.Join(sequence, fmt.Sprintf("%03d.jpg", number))); err != nil {
				return err
			}
		}
	}
	// 中灰底和间隔：闪白、黑场这类纯色画面也能和背景分开，模型不会把整张宫格当成空白。
	// 先无损拼成 PNG，加完编号再只压一次 JPEG。
	tiled := filepath.Join(dir, fmt.Sprintf("grid-%02d-tiled.png", index))
	layout := fmt.Sprintf("tile=3x%d:margin=%d:padding=%d:color=gray", len(shots), videoTeardownGridGap, videoTeardownGridGap)
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
		"-framerate", "1", "-i", filepath.Join(sequence, "%03d.jpg"), "-vf", layout, "-frames:v", "1", tiled)
	if combined, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("拼接宫格失败（ffmpeg）：%s", commandTail(combined))
	}
	if err := labelVideoTeardownGrid(tiled, output, firstShot, len(shots)); err != nil {
		return fmt.Errorf("标注宫格失败：%w", err)
	}
	return nil
}

// labelVideoTeardownGrid 在宫格左边加一条中灰编号栏，每行中间写上镜头编号，存成 JPEG。
func labelVideoTeardownGrid(tiledPath, output string, firstShot, rows int) error {
	file, err := os.Open(tiledPath)
	if err != nil {
		return err
	}
	tiled, err := png.Decode(file)
	file.Close()
	if err != nil {
		return err
	}
	bounds := tiled.Bounds()
	canvas := image.NewRGBA(image.Rect(0, 0, bounds.Dx()+videoTeardownLabelWidth, bounds.Dy()))
	xdraw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{R: 128, G: 128, B: 128, A: 255}), image.Point{}, xdraw.Src)
	xdraw.Draw(canvas, image.Rect(videoTeardownLabelWidth, 0, canvas.Bounds().Dx(), bounds.Dy()), tiled, bounds.Min, xdraw.Src)
	rowHeight := (bounds.Dy() - (rows+1)*videoTeardownGridGap) / max(rows, 1)
	for row := range rows {
		top := videoTeardownGridGap + row*(rowHeight+videoTeardownGridGap)
		drawVideoTeardownLabel(canvas, strconv.Itoa(firstShot+row), image.Rect(videoTeardownGridGap, top, videoTeardownLabelWidth, top+rowHeight))
	}
	out, err := os.OpenFile(output, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if err := jpeg.Encode(out, canvas, &jpeg.Options{Quality: 85}); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// drawVideoTeardownLabel 在 area 中间画深色底块和白色数字。basicfont 是随 x/image 打包的 7×13 点阵字，
// 放大 4 倍；镜像里不装字体也能用（ffmpeg 的 drawtext 需要 freetype 和字体文件）。
func drawVideoTeardownLabel(dst *image.RGBA, text string, area image.Rectangle) {
	const scale = 4
	face := basicfont.Face7x13
	glyphs := image.NewRGBA(image.Rect(0, 0, face.Advance*len(text), face.Height))
	drawer := font.Drawer{Dst: glyphs, Src: image.White, Face: face, Dot: fixed.P(0, face.Ascent)}
	drawer.DrawString(text)
	width, height := glyphs.Bounds().Dx()*scale, glyphs.Bounds().Dy()*scale
	center := image.Pt((area.Min.X+area.Max.X)/2, (area.Min.Y+area.Max.Y)/2)
	digits := image.Rect(center.X-width/2, center.Y-height/2, center.X-width/2+width, center.Y-height/2+height)
	xdraw.Draw(dst, digits.Inset(-8), image.NewUniform(color.RGBA{R: 24, G: 24, B: 24, A: 255}), image.Point{}, xdraw.Src)
	xdraw.NearestNeighbor.Scale(dst, digits, glyphs, glyphs.Bounds(), xdraw.Over, nil)
}

func copyVideoTeardownFile(from, to string) error {
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(to, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		return err
	}
	return target.Close()
}

// commandTail 取命令输出的最后一段，写进用户可读的错误里。
func commandTail(output []byte) string {
	detail := strings.TrimSpace(string(output))
	if runes := []rune(detail); len(runes) > 300 {
		detail = string(runes[len(runes)-300:])
	}
	if detail == "" {
		return "无输出"
	}
	return detail
}
