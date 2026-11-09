package app

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/assets"
)

type fashionVideoImage struct {
	ResourceID string `json:"resourceId"`
	Name       string `json:"name"`
}
type fashionVideoDraft struct {
	Tool   string `json:"tool"`
	Source *struct {
		fashionVideoImage
		DurationMs int64 `json:"durationMs"`
		Width      int   `json:"width"`
		Height     int   `json:"height"`
		HasAudio   *bool `json:"hasAudio"`
	} `json:"source"`
	StartMs    int64               `json:"startMs"`
	Seconds    int                 `json:"seconds"`
	Models     []fashionVideoImage `json:"models"`
	Garments   []fashionVideoImage `json:"garments"`
	Faces      []fashionVideoImage `json:"faces"`
	Region     string              `json:"region"`
	Audio      string              `json:"audio"`
	Motion     string              `json:"motion"`
	Note       string              `json:"note"`
	Authorized bool                `json:"authorized"`
}

func (image fashionVideoImage) valid() bool {
	return image.ResourceID != "" && assets.ValidID(image.ResourceID) == image.ResourceID && utf8.RuneCountInString(image.Name) <= 300
}
func (draft fashionVideoDraft) validate() error {
	if !slices.Contains([]string{"tryon", "multi-garment", "multi-model", "face", "head", "motion", "print", "showcase"}, draft.Tool) || draft.Seconds < 4 || draft.Seconds > 30 || draft.StartMs < 0 || !draft.Authorized || utf8.RuneCountInString(draft.Motion) > 300 || utf8.RuneCountInString(draft.Note) > 600 || !slices.Contains([]string{"upper", "lower", "dress"}, draft.Region) || !slices.Contains([]string{"original", "model", "mute"}, draft.Audio) {
		return fmt.Errorf("视频处理方式、授权、片段范围或声音设置无效")
	}
	if draft.Source != nil && (!draft.Source.fashionVideoImage.valid() || draft.Source.Width <= 0 || draft.Source.Height <= 0 || draft.Source.DurationMs <= 0) {
		return fmt.Errorf("原视频素材无效")
	}
	if draft.Tool != "showcase" && (draft.Source == nil || draft.StartMs > draft.Source.DurationMs-int64(draft.Seconds)*1000) {
		return fmt.Errorf("视频处理须有原视频与有效片段范围")
	}
	if draft.Tool == "showcase" && draft.Audio == "original" || draft.Audio == "original" && draft.Source != nil && draft.Source.HasAudio != nil && !*draft.Source.HasAudio {
		return fmt.Errorf("当前素材没有可保留的原声")
	}
	for _, images := range [][]fashionVideoImage{draft.Models, draft.Garments, draft.Faces} {
		if len(images) > 6 {
			return fmt.Errorf("每类视频参考图最多六张")
		}
		for _, image := range images {
			if !image.valid() {
				return fmt.Errorf("视频参考图须为已上传素材")
			}
		}
	}
	m, g, f := len(draft.Models), len(draft.Garments), len(draft.Faces)
	valid := false
	switch draft.Tool {
	case "tryon", "print":
		valid = g == 1
	case "multi-garment":
		valid = g >= 2
	case "multi-model":
		valid = m >= 2 && g == 1
	case "face", "head":
		valid = f == 1
	case "motion":
		valid = m == 1
	case "showcase":
		valid = m >= 1
	}
	if !valid {
		return fmt.Errorf("视频工具所需素材或批量配对不完整")
	}
	return nil
}
func validateFashionVideoWork(raw json.RawMessage) error {
	var work struct {
		Model      string            `json:"model"`
		Title      string            `json:"title"`
		CreatedAt  string            `json:"createdAt"`
		Ratio      string            `json:"ratio"`
		Resolution string            `json:"resolution"`
		Draft      fashionVideoDraft `json:"draft"`
		Clip       *struct {
			Key        string `json:"key"`
			TaskID     string `json:"taskId"`
			ResourceID string `json:"resourceId"`
			HasAudio   *bool  `json:"hasAudio"`
		} `json:"clip"`
		Units []struct {
			ID         string              `json:"id"`
			Title      string              `json:"title"`
			Prompt     string              `json:"prompt"`
			Status     string              `json:"status"`
			TaskID     string              `json:"taskId"`
			ResourceID string              `json:"resourceId"`
			DurationMs *int64              `json:"durationMs"`
			Width      *int                `json:"width"`
			Height     *int                `json:"height"`
			Error      string              `json:"error"`
			References []fashionVideoImage `json:"references"`
			Render     *struct {
				Started    bool   `json:"started"`
				TaskID     string `json:"taskId"`
				ResourceID string `json:"resourceId"`
			} `json:"render"`
		} `json:"units"`
	}
	if json.Unmarshal(raw, &work) != nil {
		return fmt.Errorf("视频模特作品结构无效")
	}
	if _, err := time.Parse(time.RFC3339, work.CreatedAt); err != nil || strings.TrimSpace(work.Title) == "" || utf8.RuneCountInString(work.Title) > 120 || work.Model == "" || utf8.RuneCountInString(work.Model) > 200 || work.Ratio == "" || len(work.Ratio) > 20 || work.Resolution == "" || len(work.Resolution) > 20 {
		return fmt.Errorf("视频模特作品名称、模型或输出设置无效")
	}
	if err := work.Draft.validate(); err != nil {
		return err
	}
	validID := func(value string) bool { return value == "" || assets.ValidID(value) == value }
	if work.Clip != nil && (work.Clip.Key == "" || !validID(work.Clip.Key) || !validID(work.Clip.TaskID) || !validID(work.Clip.ResourceID)) {
		return fmt.Errorf("原视频切段记录无效")
	}
	if len(work.Units) < 1 || len(work.Units) > 6 {
		return fmt.Errorf("视频模特一组须有一至六段")
	}
	seen := map[string]bool{}
	pairs := [][]fashionVideoImage{}
	switch work.Draft.Tool {
	case "multi-model":
		for _, image := range work.Draft.Models {
			pairs = append(pairs, []fashionVideoImage{image, work.Draft.Garments[0]})
		}
	case "multi-garment":
		for _, image := range work.Draft.Garments {
			pairs = append(pairs, []fashionVideoImage{image})
		}
	case "face", "head":
		pairs = append(pairs, work.Draft.Faces)
	case "motion", "showcase":
		for _, image := range work.Draft.Models {
			pairs = append(pairs, []fashionVideoImage{image})
		}
	default:
		pairs = append(pairs, work.Draft.Garments)
	}
	usedPairs := map[int]bool{}
	for _, unit := range work.Units {
		if !validEcommerceStudioID(unit.ID) || seen[unit.ID] || strings.TrimSpace(unit.Title) == "" || utf8.RuneCountInString(unit.Title) > 300 || unit.Prompt == "" || utf8.RuneCountInString(unit.Prompt) > 4000 || !slices.Contains([]string{"pending", "submitting", "running", "rendering", "succeeded", "failed"}, unit.Status) || len(unit.References) < 1 || len(unit.References) > 2 || !validID(unit.TaskID) || !validID(unit.ResourceID) {
			return fmt.Errorf("视频模特生成单元无效")
		}
		seen[unit.ID] = true
		matched := -1
		for index, pair := range pairs {
			if len(pair) != len(unit.References) {
				continue
			}
			match := true
			for i, image := range pair {
				if image.ResourceID != unit.References[i].ResourceID {
					match = false
				}
			}
			if match && !usedPairs[index] {
				matched = index
				break
			}
		}
		if matched < 0 {
			return fmt.Errorf("视频单元参考图与所选素材配对不一致")
		}
		usedPairs[matched] = true
		for _, image := range unit.References {
			if !image.valid() {
				return fmt.Errorf("视频单元参考图无效")
			}
		}
		if unit.DurationMs != nil && *unit.DurationMs <= 0 || unit.Width != nil && *unit.Width <= 0 || unit.Height != nil && *unit.Height <= 0 {
			return fmt.Errorf("视频成品尺寸或时长无效")
		}
		if unit.Render != nil && (!unit.Render.Started || !validID(unit.Render.TaskID) || !validID(unit.Render.ResourceID)) {
			return fmt.Errorf("视频声音合成记录无效")
		}
		if unit.Status == "succeeded" && (unit.ResourceID == "" || unit.Render == nil || unit.Render.ResourceID == "") {
			return fmt.Errorf("成功的视频须有生成与交付资源")
		}
	}
	return nil
}
