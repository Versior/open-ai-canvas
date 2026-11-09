package app

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// 时间线渲染：把前端 TimelineProject 快照（tracks/clips 平铺，见
// web/src/types/timeline.ts TimelineProject v2）展开为可执行的 ffmpeg 步骤。
// 与前端 timeline-to-ffmpeg.ts 保持同一数据流：trim（按 sourceStartMs 裁切）
// → 空隙补黑场静音 → concat。字幕片段不烧录（依赖 libass 和字体），单独产出 SRT；要烧录时由前端
// 把字幕画成整幅透明 PNG，作为 overlay 图片片段叠上去。
//
// 输入布局统一为「每个片段两个输入：视频源 + 音频源」，空隙展开为独立
// 黑场片段，因此第 i 个片段的视频输入为 2i、音频输入为 2i+1。

type renderClip struct {
	ID               string  `json:"id"`
	Kind             string  `json:"kind"`
	TrackID          string  `json:"trackId"`
	StartMs          int64   `json:"startMs"`
	DurationMs       int64   `json:"durationMs"`
	SourceStartMs    int64   `json:"sourceStartMs"`
	SourceDurationMs int64   `json:"sourceDurationMs"`
	Volume           float64 `json:"volume"`
	Text             string  `json:"text"`
	// Title 只用于导出剪映草稿时给素材文件起名，渲染不用。
	Title string `json:"title,omitempty"`
	// FadeIn/FadeOut 是片段首尾的纯色淡入淡出（短剧黑场、闪白转场）；为 0 时是硬切。
	FadeInMs     int64  `json:"fadeInMs,omitempty"`
	FadeInColor  string `json:"fadeInColor,omitempty"`
	FadeOutMs    int64  `json:"fadeOutMs,omitempty"`
	FadeOutColor string `json:"fadeOutColor,omitempty"`
	// Overlay 只对 image 片段有效：整幅透明 PNG 按 startMs 叠在成片画面上（烧录字幕），不进主序列。
	Overlay bool `json:"overlay,omitempty"`
	// Loop 只对音频轨片段有效：素材比片段短时从头循环（背景音乐）。
	Loop        bool `json:"loop,omitempty"`
	DirectMedia *struct {
		ID         string `json:"id"`
		Kind       string `json:"kind"`
		StorageKey string `json:"storageKey"`
	} `json:"directMedia"`
}

type renderTrack struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Visible *bool  `json:"visible"`
	Muted   bool   `json:"muted"`
}

type renderProject struct {
	Version    int           `json:"version"`
	Tracks     []renderTrack `json:"tracks"`
	Clips      []renderClip  `json:"clips"`
	DurationMs int64         `json:"durationMs"`
	// Width/Height 为输出画布尺寸；缺省按 1920x1080 横屏输出。
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
	// Fit 是画面适配输出画幅的方式：auto（默认，见 renderSegmentFit）、pad（留边）、crop（裁切铺满）。
	Fit      string     `json:"fit,omitempty"`
	ColorLut *renderLut `json:"colorLut,omitempty"`
}

type renderSource struct {
	ResourceID string
	Clip       renderClip
	Path       string
	Ext        string
	// HasAudio 由 ffprobe 探测得到；无音轨的媒体改为静音源，避免 map 失败。
	HasAudio bool
	// Width/Height 是来源画面的显示尺寸（探测优先，其次资源记录）；0 表示未知，按留边处理。
	Width  int
	Height int
	// AIGC 是来源文件容器里原有的 AIGC 隐式标识（原样字符串），没有时为空。
	AIGC string
}

// renderSegment 是渲染序列中的一段；Kind 为 video/image 表示媒体片段，
// gap 表示补黑场静音的空隙段（无 Source）。
type renderSegment struct {
	Kind       string
	DurationMs int64
	GapMs      int64
	Clip       renderClip
	Source     *renderSource
}

type renderPlan struct {
	Segments []renderSegment
	// AudioOverlays 是音频轨上的独立片段（配音、音乐），在主序列拼接后按 startMs 混入。
	AudioOverlays []renderSegment
	// ImageOverlays 是叠在成片画面上的整幅透明图（烧录字幕），按 startMs 排序且互不重叠。
	ImageOverlays []renderSegment
	SubtitleSRT   string
	HasMedia      bool
	Width         int
	Height        int
	// Fit 是归一化后的适配模式（auto/pad/crop）。
	Fit string
	// PropagateID 写入成片 AIGC 标识的传播内容编号，取渲染任务 ID。
	PropagateID string
	ColorLut    *renderLut
}

// buildRenderPlan 挑选可见视频/图片轨片段按 startMs 排序，并把片段之间的
// 空隙展开为黑场段，使渲染序列在时间轴上连续。
func buildRenderPlan(project renderProject) renderPlan {
	visible := map[string]bool{}
	muted := map[string]bool{}
	for _, track := range project.Tracks {
		visible[track.ID] = track.Visible == nil || *track.Visible
		muted[track.ID] = track.Muted
	}
	clips := make([]renderClip, 0, len(project.Clips))
	overlays := make([]renderSegment, 0)
	images := make([]renderSegment, 0)
	for _, clip := range project.Clips {
		if !visible[clip.TrackID] || clip.DurationMs <= 0 {
			continue
		}
		if clip.Kind == "image" && clip.Overlay {
			if _, ok := mediaResourceID(clip); ok && clip.StartMs >= 0 {
				images = append(images, renderSegment{Kind: "overlay", DurationMs: clip.DurationMs, Clip: clip})
			}
			continue
		}
		if clip.Kind == "audio" {
			if !muted[clip.TrackID] {
				if _, ok := mediaResourceID(clip); ok {
					overlays = append(overlays, renderSegment{Kind: "audio", DurationMs: clip.DurationMs, Clip: clip})
				}
			}
			continue
		}
		if clip.Kind != "video" && clip.Kind != "image" {
			continue
		}
		if muted[clip.TrackID] {
			// 静音轨的画面仍参与拼接，声音由静音源替代。
			clip.Volume = -1
		}
		clips = append(clips, clip)
	}
	sort.SliceStable(overlays, func(i, j int) bool { return overlays[i].Clip.StartMs < overlays[j].Clip.StartMs })
	sort.SliceStable(clips, func(i, j int) bool {
		if clips[i].StartMs == clips[j].StartMs {
			return clips[i].ID < clips[j].ID
		}
		return clips[i].StartMs < clips[j].StartMs
	})

	plan := renderPlan{SubtitleSRT: buildRenderSubtitleSRT(project), AudioOverlays: overlays, ImageOverlays: renderImageOverlays(images), Width: renderWidth, Height: renderHeight, Fit: normalizeRenderFit(project.Fit), ColorLut: project.ColorLut}
	if project.Width >= 16 && project.Height >= 16 && project.Width <= 4096 && project.Height <= 4096 {
		// libx264 yuv420p 要求偶数尺寸。
		plan.Width, plan.Height = project.Width&^1, project.Height&^1
	}
	cursor := int64(0)
	for _, clip := range clips {
		if gap := clip.StartMs - cursor; gap > 0 {
			plan.Segments = append(plan.Segments, renderSegment{Kind: "gap", DurationMs: gap, GapMs: gap})
		}
		plan.Segments = append(plan.Segments, renderSegment{Kind: clip.Kind, DurationMs: clip.DurationMs, Clip: clip})
		cursor = clip.StartMs + clip.DurationMs
	}
	for _, seg := range plan.Segments {
		if _, ok := mediaResourceID(seg.Clip); ok {
			plan.HasMedia = true
			break
		}
	}
	return plan
}

// renderImageOverlays 按起点排序叠加图，后一张和前一张重叠时从前一张结束处开始，完全被盖住的丢掉。
// 字幕同一时刻只显示一条，互不重叠后可以拼成一路透明画面，只做一次叠加。
func renderImageOverlays(images []renderSegment) []renderSegment {
	sort.SliceStable(images, func(i, j int) bool { return images[i].Clip.StartMs < images[j].Clip.StartMs })
	result := make([]renderSegment, 0, len(images))
	var cursor int64
	for _, image := range images {
		start, end := max(image.Clip.StartMs, cursor), image.Clip.StartMs+image.Clip.DurationMs
		if end <= start {
			continue
		}
		image.Clip.StartMs, image.Clip.DurationMs, image.DurationMs = start, end-start, end-start
		result = append(result, image)
		cursor = end
	}
	return result
}

// mediaResourceID 从片段的 directMedia.storageKey（resource:<id>）还原资源 ID。
func mediaResourceID(clip renderClip) (string, bool) {
	if clip.DirectMedia == nil {
		return "", false
	}
	key := strings.TrimSpace(clip.DirectMedia.StorageKey)
	if !strings.HasPrefix(key, "resource:") {
		return "", false
	}
	id := strings.TrimSpace(strings.TrimPrefix(key, "resource:"))
	return id, id != ""
}

func buildRenderSubtitleSRT(project renderProject) string {
	subtitle := make([]renderClip, 0, len(project.Clips))
	for _, clip := range project.Clips {
		if clip.Kind != "subtitle" || strings.TrimSpace(clip.Text) == "" || clip.DurationMs <= 0 {
			continue
		}
		subtitle = append(subtitle, clip)
	}
	sort.SliceStable(subtitle, func(i, j int) bool {
		if subtitle[i].StartMs == subtitle[j].StartMs {
			return subtitle[i].ID < subtitle[j].ID
		}
		return subtitle[i].StartMs < subtitle[j].StartMs
	})
	if len(subtitle) == 0 {
		return ""
	}
	var out strings.Builder
	for i, clip := range subtitle {
		fmt.Fprintf(&out, "%d\n%s --> %s\n%s\n\n",
			i+1,
			formatSRTTimestamp(clip.StartMs),
			formatSRTTimestamp(clip.StartMs+clip.DurationMs),
			strings.TrimSpace(clip.Text))
	}
	return out.String()
}

const (
	renderWidth      = 1920
	renderHeight     = 1080
	renderFPS        = 30
	renderSampleRate = 44100
)

func (plan renderPlan) size() (int, int) {
	if plan.Width > 0 && plan.Height > 0 {
		return plan.Width, plan.Height
	}
	return renderWidth, renderHeight
}

// buildRenderFFmpegArgs 依据渲染计划生成 ffmpeg 参数（工作目录内相对路径）。
// 每段固定两个输入：视频源与音频源，末尾 concat 为单路输出；
// 音频轨片段作为额外输入在拼接后按起点延迟混入。
func buildRenderFFmpegArgs(plan renderPlan, target string) []string {
	if len(plan.Segments) == 0 {
		return nil
	}
	width, height := plan.size()
	black := fmt.Sprintf("color=c=black:s=%dx%d:r=%d", width, height, renderFPS)
	silence := fmt.Sprintf("anullsrc=r=%d:cl=stereo", renderSampleRate)
	args := []string{"-nostdin", "-y"}
	for _, seg := range plan.Segments {
		seconds := fmt.Sprintf("%.3f", float64(seg.DurationMs)/1000)
		switch {
		case seg.Kind == "gap" || seg.Source == nil:
			args = append(args, "-f", "lavfi", "-t", seconds, "-i", black, "-f", "lavfi", "-t", seconds, "-i", silence)
		case seg.Kind == "image":
			args = append(args, "-loop", "1", "-t", seconds, "-i", seg.Source.Path, "-f", "lavfi", "-t", seconds, "-i", silence)
		default:
			for range 2 {
				// 音频输入复用同一媒体文件；无音轨时改用静音源（见下方滤镜）。
				if seg.Clip.SourceStartMs > 0 {
					args = append(args, "-ss", fmt.Sprintf("%.3f", float64(seg.Clip.SourceStartMs)/1000))
				}
				args = append(args, "-t", seconds, "-i", seg.Source.Path)
			}
		}
	}
	overlayBase := len(plan.Segments) * 2
	overlays := make([]renderSegment, 0, len(plan.AudioOverlays))
	for _, overlay := range plan.AudioOverlays {
		if overlay.Source == nil {
			continue
		}
		if overlay.Clip.Loop {
			// 背景音乐比成片短时从头循环；-t 限定输出时长，不会无限读。
			args = append(args, "-stream_loop", "-1")
		}
		if overlay.Clip.SourceStartMs > 0 {
			args = append(args, "-ss", fmt.Sprintf("%.3f", float64(overlay.Clip.SourceStartMs)/1000))
		}
		args = append(args, "-t", fmt.Sprintf("%.3f", float64(overlay.DurationMs)/1000), "-i", overlay.Source.Path)
		overlays = append(overlays, overlay)
	}
	imageBase := overlayBase + len(overlays)
	images := make([]renderSegment, 0, len(plan.ImageOverlays))
	for _, image := range plan.ImageOverlays {
		if image.Source == nil {
			continue
		}
		args = append(args, "-loop", "1", "-t", fmt.Sprintf("%.3f", float64(image.DurationMs)/1000), "-i", image.Source.Path)
		images = append(images, image)
	}

	filters := make([]string, 0, len(plan.Segments)*2+len(overlays)+len(images)*2+4)
	labels := make([]string, 0, len(plan.Segments)*2)
	for i, seg := range plan.Segments {
		videoIn, audioIn := 2*i, 2*i+1
		videoLabel, audioLabel := fmt.Sprintf("v%d", i), fmt.Sprintf("a%d", i)
		duration := float64(seg.DurationMs) / 1000
		// tpad 用最后一帧补足短于片段时长的素材，trim 再裁到精确时长，保证音画时间轴对齐。
		scale := renderFitFilter(renderSegmentFit(plan.Fit, seg.Source, width, height), width, height)
		videoInput := fmt.Sprintf("[%d:v]", videoIn)
		if plan.ColorLut != nil && plan.ColorLut.Strength > 0 && seg.Source != nil {
			filters = append(filters,
				fmt.Sprintf("%sformat=gbrp,split[lut-original%d][lut-input%d]", videoInput, i, i),
				fmt.Sprintf("[lut-input%d]lut3d=file=timeline-lut.cube:interp=trilinear[lut-graded%d]", i, i),
				fmt.Sprintf("[lut-original%d][lut-graded%d]blend=all_expr='A*%.9f+B*%.9f'[lut-mixed%d]", i, i, 1-plan.ColorLut.Strength, plan.ColorLut.Strength, i))
			videoInput = fmt.Sprintf("[lut-mixed%d]", i)
		}
		filters = append(filters, fmt.Sprintf("%sfps=%d,%s,setsar=1,tpad=stop_mode=clone:stop_duration=%.3f,trim=duration=%.3f,setpts=PTS-STARTPTS%s[%s]", videoInput, renderFPS, scale, duration, duration, renderFadeFilters(seg.Clip, duration), videoLabel))
		silent := seg.Source != nil && seg.Kind != "image" && (!seg.Source.HasAudio || seg.Clip.Volume < 0)
		if silent {
			silentLabel := fmt.Sprintf("silent%d", i)
			filters = append(filters, fmt.Sprintf("%s[%s]", silence, silentLabel))
			filters = append(filters, fmt.Sprintf("[%s]atrim=0:%.3f,asetpts=N/SR/TB[%s]", silentLabel, duration, audioLabel))
		} else {
			volume := 1.0
			if seg.Clip.Volume > 0 {
				volume = seg.Clip.Volume
			}
			filters = append(filters, fmt.Sprintf("[%d:a]aformat=sample_fmts=fltp:sample_rates=%d:channel_layouts=stereo,volume=%.3f,apad,atrim=0:%.3f,asetpts=N/SR/TB[%s]",
				audioIn, renderSampleRate, volume, duration, audioLabel))
		}
		labels = append(labels, videoLabel, audioLabel)
	}
	var concatInputs strings.Builder
	for _, label := range labels {
		fmt.Fprintf(&concatInputs, "[%s]", label)
	}
	audioOut, videoOut := "aout", "vout"
	if len(overlays) > 0 {
		audioOut = "abase"
	}
	if len(images) > 0 {
		videoOut = "vbase"
	}
	filters = append(filters, fmt.Sprintf("%sconcat=n=%d:v=1:a=1[%s][%s]", concatInputs.String(), len(plan.Segments), videoOut, audioOut))
	if len(overlays) > 0 {
		var mixInputs strings.Builder
		mixInputs.WriteString("[abase]")
		for i, overlay := range overlays {
			volume := 1.0
			if overlay.Clip.Volume > 0 {
				volume = overlay.Clip.Volume
			}
			delay := overlay.Clip.StartMs
			if delay < 0 {
				delay = 0
			}
			label := fmt.Sprintf("o%d", i)
			filters = append(filters, fmt.Sprintf("[%d:a]aformat=sample_fmts=fltp:sample_rates=%d:channel_layouts=stereo,volume=%.3f%s,adelay=%d|%d[%s]",
				overlayBase+i, renderSampleRate, volume, renderAudioFadeFilters(overlay.Clip, float64(overlay.DurationMs)/1000), delay, delay, label))
			fmt.Fprintf(&mixInputs, "[%s]", label)
		}
		// normalize=0 直接相加：各路音量由片段 volume 决定，配音和音乐结束前后整体响度不跳变。
		filters = append(filters, fmt.Sprintf("%samix=inputs=%d:duration=first:dropout_transition=0:normalize=0[aout]", mixInputs.String(), len(overlays)+1))
	}
	if len(images) > 0 {
		filters = append(filters, renderImageOverlayFilters(images, imageBase, width, height)...)
	}

	args = append(args,
		"-filter_complex", strings.Join(filters, ";"),
		"-map", "[vout]", "-map", "[aout]",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "128k",
		// 不继承任何来源的容器元数据，只写本次合成的 AIGC 隐式标识与说明；use_metadata_tags 让 mp4
		// 以 mdta 键保存自定义的 AIGC 字段（默认的 iTunes 元数据会丢弃未知键）。
		"-map_metadata", "-1",
		"-metadata", "AIGC="+renderAIGCJSON(plan),
		"-metadata", "comment="+renderAIGCComment,
		"-movflags", "+faststart+use_metadata_tags",
		"-t", fmt.Sprintf("%.3f", planTotalSeconds(plan)),
		target,
	)
	return args
}

const (
	renderFitAuto = "auto"
	renderFitPad  = "pad"
	renderFitCrop = "crop"
	// renderCropAspectTolerance：来源与输出宽高比的相对差 |srcW/srcH ÷ dstW/dstH − 1| 不超过 3% 时裁切铺满，
	// 只裁掉极窄的边（768×1344 → 1080×1920 约裁 1.6%）；超过时留边，避免裁掉主体。前端预览按同一规则。
	renderCropAspectTolerance = 0.03
)

func normalizeRenderFit(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case renderFitPad:
		return renderFitPad
	case renderFitCrop:
		return renderFitCrop
	default:
		return renderFitAuto
	}
}

// renderSegmentFit 决定片段画面如何适配输出画幅：pad/crop 为调用方强制；auto 按宽高比相对差选择，
// 来源尺寸未知（含黑场段）一律留边。
func renderSegmentFit(mode string, source *renderSource, width int, height int) string {
	switch mode {
	case renderFitPad, renderFitCrop:
		return mode
	}
	if source == nil || source.Width <= 0 || source.Height <= 0 || width <= 0 || height <= 0 {
		return renderFitPad
	}
	ratio := (float64(source.Width) / float64(source.Height)) / (float64(width) / float64(height))
	if math.Abs(ratio-1) <= renderCropAspectTolerance {
		return renderFitCrop
	}
	return renderFitPad
}

// renderFitFilter 返回缩放到输出画幅的滤镜：crop 先等比放大到覆盖画幅再居中裁切，pad 等比缩小后居中补黑边。
func renderFitFilter(fit string, width int, height int) string {
	if fit == renderFitCrop {
		return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d", width, height, width, height)
	}
	return fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2", width, height, width, height)
}

// renderSourceRecord 是成片结果里逐片段的来源记录：画面适配方式与来源文件原有的 AIGC 标识（如有）。
type renderSourceRecord struct {
	ClipID     string `json:"clipId"`
	ResourceID string `json:"resourceId"`
	Kind       string `json:"kind"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	// Fit 是该画面片段实际采用的适配方式；音频片段为空。
	Fit  string `json:"fit,omitempty"`
	AIGC string `json:"aigc,omitempty"`
}

// renderSourceRecords 按成片顺序列出画面片段与音频轨片段的来源。
func renderSourceRecords(plan renderPlan) []renderSourceRecord {
	width, height := plan.size()
	records := make([]renderSourceRecord, 0, len(plan.Segments)+len(plan.AudioOverlays)+len(plan.ImageOverlays))
	for _, seg := range plan.Segments {
		if seg.Source == nil {
			continue
		}
		records = append(records, renderSourceRecord{
			ClipID: seg.Clip.ID, ResourceID: seg.Source.ResourceID, Kind: seg.Kind,
			Width: seg.Source.Width, Height: seg.Source.Height,
			Fit: renderSegmentFit(plan.Fit, seg.Source, width, height), AIGC: seg.Source.AIGC,
		})
	}
	for _, overlay := range plan.AudioOverlays {
		if overlay.Source == nil {
			continue
		}
		records = append(records, renderSourceRecord{ClipID: overlay.Clip.ID, ResourceID: overlay.Source.ResourceID, Kind: overlay.Kind, AIGC: overlay.Source.AIGC})
	}
	for _, image := range plan.ImageOverlays {
		if image.Source == nil {
			continue
		}
		records = append(records, renderSourceRecord{ClipID: image.Clip.ID, ResourceID: image.Source.ResourceID, Kind: image.Kind, Width: image.Source.Width, Height: image.Source.Height})
	}
	return records
}

// aigcImplicitLabel 是 GB 45438-2025 文件元数据隐式标识：扩展字段 AIGC 的值为 JSON，字段名按标准取用。
type aigcImplicitLabel struct {
	Label             string `json:"Label"`
	ContentProducer   string `json:"ContentProducer"`
	ProduceID         string `json:"ProduceID"`
	ReservedCode1     string `json:"ReservedCode1"`
	ContentPropagator string `json:"ContentPropagator"`
	PropagateID       string `json:"PropagateID"`
	ReservedCode2     string `json:"ReservedCode2"`
}

// AIGCPlatformPropagator 是写入成片 AIGC 标识的传播服务提供者（ContentPropagator）。
// "yingce" 只是默认占位：部署方必须替换为自己登记的服务提供者名称或编码。
const AIGCPlatformPropagator = "yingce"

const (
	// aigcLabelGenerated 是 Label 取值“1：属于人工智能生成合成内容”。
	aigcLabelGenerated = "1"
	// renderAIGCComment 写入容器 comment，供不解析 AIGC 字段的播放器与平台识别。
	renderAIGCComment = "AI生成合成内容"
	// aigcFieldMaxRunes 限制从来源文件转写的字段长度，来源元数据不可信。
	aigcFieldMaxRunes = 256
)

// renderAIGCLabel 汇总成片的 AIGC 隐式标识：Label 取第一个带标识来源的 Label；平台合成的成片本身就是
// AI 生成合成内容，没有来源标识（或来源未写 Label）时取 "1"。ContentProducer/ProduceID 取第一个写了它们的来源；
// 传播方为本平台，传播编号为渲染任务 ID。ReservedCode 属于各自写入方的校验位，重新编码后不再适用，留空。
func renderAIGCLabel(plan renderPlan) aigcImplicitLabel {
	label := aigcImplicitLabel{ContentPropagator: AIGCPlatformPropagator, PropagateID: plan.PropagateID}
	sources := make([]*renderSource, 0, len(plan.Segments)+len(plan.AudioOverlays))
	for _, seg := range plan.Segments {
		sources = append(sources, seg.Source)
	}
	for _, overlay := range plan.AudioOverlays {
		sources = append(sources, overlay.Source)
	}
	for _, source := range sources {
		if source == nil {
			continue
		}
		fields, ok := parseAIGCTag(source.AIGC)
		if !ok {
			continue
		}
		if label.Label == "" {
			label.Label = aigcField(fields, "Label")
		}
		if label.ContentProducer == "" && label.ProduceID == "" {
			label.ContentProducer, label.ProduceID = aigcField(fields, "ContentProducer"), aigcField(fields, "ProduceID")
		}
	}
	if label.Label == "" {
		label.Label = aigcLabelGenerated
	}
	return label
}

func renderAIGCJSON(plan renderPlan) string {
	encoded, err := json.Marshal(renderAIGCLabel(plan))
	if err != nil {
		return ""
	}
	return string(encoded)
}

// parseAIGCTag 解析来源文件的 AIGC 标签；不是 JSON 对象时视为没有标识。
func parseAIGCTag(raw string) (map[string]any, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, false
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(raw), &fields); err != nil || fields == nil {
		return nil, false
	}
	return fields, true
}

// aigcField 按字段名（大小写不敏感）读取字符串或数字值，截断到 aigcFieldMaxRunes。
func aigcField(fields map[string]any, key string) string {
	value, ok := fields[key]
	if !ok {
		for name, candidate := range fields {
			if strings.EqualFold(name, key) {
				value, ok = candidate, true
				break
			}
		}
	}
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return truncateRunes(strings.TrimSpace(typed), aigcFieldMaxRunes)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func planTotalSeconds(plan renderPlan) float64 {
	var total int64
	for _, seg := range plan.Segments {
		total += seg.DurationMs
	}
	return float64(total) / 1000
}

// renderImageOverlayFilters 把叠加图和中间的透明空隙拼成一路 RGBA 画面，再一次叠到 [vbase] 上输出 [vout]。
// 叠加图流比成片短时（最后一条字幕之后）eof_action=pass 让主画面原样通过。
func renderImageOverlayFilters(images []renderSegment, inputBase int, width int, height int) []string {
	filters := make([]string, 0, len(images)*2+2)
	var parts strings.Builder
	count := 0
	var cursor int64
	for i, image := range images {
		if gap := image.Clip.StartMs - cursor; gap > 0 {
			label := fmt.Sprintf("sg%d", i)
			filters = append(filters, fmt.Sprintf("color=c=black@0.0:s=%dx%d:r=%d:d=%.3f,format=rgba,setsar=1,settb=AVTB[%s]", width, height, renderFPS, float64(gap)/1000, label))
			fmt.Fprintf(&parts, "[%s]", label)
			count++
		}
		label := fmt.Sprintf("si%d", i)
		duration := float64(image.DurationMs) / 1000
		filters = append(filters, fmt.Sprintf("[%d:v]fps=%d,scale=%d:%d,format=rgba,setsar=1,trim=duration=%.3f,setpts=PTS-STARTPTS,settb=AVTB[%s]", inputBase+i, renderFPS, width, height, duration, label))
		fmt.Fprintf(&parts, "[%s]", label)
		count++
		cursor = image.Clip.StartMs + image.DurationMs
	}
	filters = append(filters, fmt.Sprintf("%sconcat=n=%d:v=1:a=0[subs]", parts.String(), count))
	filters = append(filters, "[vbase][subs]overlay=0:0:eof_action=pass,format=yuv420p[vout]")
	return filters
}

// renderAudioFadeFilters 是音频轨片段首尾的音量淡入淡出（背景音乐收尾）；时长最多取片段的一半。
func renderAudioFadeFilters(clip renderClip, duration float64) string {
	var b strings.Builder
	if clip.FadeInMs > 0 {
		fmt.Fprintf(&b, ",afade=t=in:st=0:d=%.3f", min(float64(clip.FadeInMs)/1000, duration/2))
	}
	if clip.FadeOutMs > 0 {
		fade := min(float64(clip.FadeOutMs)/1000, duration/2)
		fmt.Fprintf(&b, ",afade=t=out:st=%.3f:d=%.3f", duration-fade, fade)
	}
	return b.String()
}

// renderFadeFilters 生成片段首尾的纯色淡入淡出；颜色只接受白名单，避免拼进滤镜表达式。
func renderFadeFilters(clip renderClip, duration float64) string {
	color := func(value string) string {
		if value == "white" {
			return "white"
		}
		return "black"
	}
	var b strings.Builder
	if clip.FadeInMs > 0 {
		fmt.Fprintf(&b, ",fade=t=in:st=0:d=%.3f:color=%s", min(float64(clip.FadeInMs)/1000, duration/2), color(clip.FadeInColor))
	}
	if clip.FadeOutMs > 0 {
		fade := min(float64(clip.FadeOutMs)/1000, duration/2)
		fmt.Fprintf(&b, ",fade=t=out:st=%.3f:d=%.3f:color=%s", duration-fade, fade, color(clip.FadeOutColor))
	}
	return b.String()
}
