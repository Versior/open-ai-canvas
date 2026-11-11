package app

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/jianying"
	"yingce/backend/internal/model"
)

// TimelineJianyingDraftRequest 把一份时间线快照（与 POST /timeline/renders 同一结构）导出成剪映草稿。
// DraftRoot 是用户本机的剪映草稿目录；Name 是草稿名（会加上导出时间）。
type TimelineJianyingDraftRequest struct {
	DraftRoot string
	Name      string
	Timeline  renderProject
}

// timelineJianyingMaxClips 限制一次导出的片段数；复刻工作台最多 60 镜，配音、音乐、字幕加起来也远少于这个数。
const timelineJianyingMaxClips = 600

// PrepareTimelineJianyingDraft 校验时间线里的每个素材都是本人就绪的资源后装配草稿：视频片段按时间线位置
// 放在主轨（静音轨的片段音量为 0），音频轨片段按轨分到音频轨，字幕片段进字幕轨。叠加图（烧录字幕）不导出，
// 字幕在剪映里是可编辑的文字。任何素材不可用都直接报错，不导出缺素材的草稿。
func (s *Service) PrepareTimelineJianyingDraft(userID string, req TimelineJianyingDraftRequest) (*DramaArchive, error) {
	root, err := jianying.NormalizeRoot(req.DraftRoot)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	project := req.Timeline
	if len(project.Clips) > timelineJianyingMaxClips {
		return nil, BadAuthRequest(fmt.Sprintf("时间线片段太多，最多 %d 个", timelineJianyingMaxClips))
	}
	visible, muted := map[string]bool{}, map[string]bool{}
	for _, track := range project.Tracks {
		visible[track.ID] = track.Visible == nil || *track.Visible
		muted[track.ID] = track.Muted
	}
	width, height := 1080, 1920
	if project.Width >= 16 && project.Height >= 16 && project.Width <= 4096 && project.Height <= 4096 {
		width, height = project.Width, project.Height
	}
	now := time.Now()
	name := jianying.SafeName(fmt.Sprintf("%s-%s", jianying.SafeName(req.Name, "STAGE复刻", 60), now.In(dramaExportLocation).Format("0102-1504")), "STAGE复刻草稿", 80)
	draft := jianying.Draft{Name: name, Root: root, Width: width, Height: height, FPS: 30, Now: now, Placed: true}
	archive := newDramaArchive(name + ".zip")
	files := map[string]string{}
	resources := map[string]*model.Resource{}
	material := func(clip renderClip, kinds ...string) (*model.Resource, string, error) {
		id, ok := mediaResourceID(clip)
		if !ok {
			return nil, "", BadAuthRequest("时间线里有片段没有引用素材")
		}
		if fileName, done := files[id]; done {
			return resources[id], fileName, nil
		}
		var resource *model.Resource
		for _, kind := range kinds {
			if resource = s.dramaExportResource(userID, id, kind); resource != nil {
				break
			}
		}
		if resource == nil {
			return nil, "", BadAuthRequest("时间线引用的素材不可用，可能已被删除")
		}
		label := jianying.SafeName(clip.Title, map[string]string{"video": "视频", "audio": "声音"}[resource.Kind], 30)
		if label == "" {
			label = "素材"
		}
		fileName := fmt.Sprintf("%02d-%s%s", len(files)+1, label, dramaResourceExtension(resource, ".mp4"))
		if err := archive.addResource(name+"/"+jianying.MaterialsDir+"/"+fileName, resource); err != nil {
			return nil, "", err
		}
		files[id], resources[id] = fileName, resource
		return resource, fileName, nil
	}
	clips := append([]renderClip(nil), project.Clips...)
	sort.SliceStable(clips, func(i, j int) bool { return clips[i].StartMs < clips[j].StartMs })
	for _, clip := range clips {
		if !visible[clip.TrackID] || clip.DurationMs <= 0 || clip.StartMs < 0 || clip.SourceStartMs < 0 {
			continue
		}
		switch {
		case clip.Kind == "video":
			resource, fileName, err := material(clip, "video")
			if err != nil {
				return nil, err
			}
			draft.Clips = append(draft.Clips, jianying.Clip{
				FileName: fileName, Name: fileName, DurationUs: clip.DurationMs * 1000, Width: resource.Width, Height: resource.Height,
				StartUs: clip.StartMs * 1000, SourceStartUs: clip.SourceStartMs * 1000, MaterialDurationUs: resource.DurationMs * 1000, Muted: muted[clip.TrackID] || clip.Volume < 0,
			})
		case clip.Kind == "audio":
			if muted[clip.TrackID] {
				continue
			}
			resource, fileName, err := material(clip, "audio", "video")
			if err != nil {
				return nil, err
			}
			duration := clip.DurationMs
			if clip.Loop && resource.DurationMs > clip.SourceStartMs {
				// 剪映草稿没有循环：按素材时长切成几段首尾相接。
				for offset := int64(0); offset < duration; {
					part := min(resource.DurationMs-clip.SourceStartMs, duration-offset)
					draft.Audios = append(draft.Audios, jianying.AudioClip{FileName: fileName, Name: fileName, Track: clip.TrackID, StartUs: (clip.StartMs + offset) * 1000, SourceStartUs: clip.SourceStartMs * 1000, DurationUs: part * 1000, MaterialDurationUs: resource.DurationMs * 1000, Volume: clip.Volume})
					offset += part
				}
				continue
			}
			draft.Audios = append(draft.Audios, jianying.AudioClip{FileName: fileName, Name: fileName, Track: clip.TrackID, StartUs: clip.StartMs * 1000, SourceStartUs: clip.SourceStartMs * 1000, DurationUs: duration * 1000, MaterialDurationUs: resource.DurationMs * 1000, Volume: clip.Volume})
		case clip.Kind == "subtitle" && strings.TrimSpace(clip.Text) != "":
			draft.Captions = append(draft.Captions, jianying.Caption{Text: strings.TrimSpace(clip.Text), StartUs: clip.StartMs * 1000, DurationUs: clip.DurationMs * 1000})
		}
	}
	if len(draft.Clips) == 0 {
		return nil, BadAuthRequest("时间线里没有可导出的视频片段")
	}
	content, meta, err := jianying.Build(draft)
	if err != nil {
		return nil, err
	}
	archive.addData(name+"/draft_content.json", content)
	archive.addData(name+"/draft_info.json", content)
	archive.addData(name+"/draft_meta_info.json", meta)
	if len(draft.Captions) > 0 {
		archive.addData(name+"/字幕.srt", []byte(jianying.SRT(draft.Captions)))
	}
	archive.addData(name+"/导入说明.txt", []byte(timelineJianyingReadme(draft)))
	return archive, nil
}

func timelineJianyingReadme(draft jianying.Draft) string {
	var builder strings.Builder
	builder.WriteString("STAGE 视频创作 · 剪映草稿\n\n")
	builder.WriteString(jianyingImportSteps(draft))
	builder.WriteString("\n主轨是成片的画面（保留原片的镜头已静音），音频轨分别是配音、原声和背景音乐，字幕轨是可编辑的文字。\n")
	return builder.String()
}
