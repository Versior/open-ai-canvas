package app

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

// 专业模特工具共用用户私有作品的 CAS 和资源引用检查，无需新增数据表。
func validateFashionWork(raw json.RawMessage) error {
	var kind struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &kind); err != nil {
		return errors.New("作品结构无效")
	}
	if kind.Kind != "fashion" {
		return nil
	}
	var work struct {
		Kind      string `json:"kind"`
		Model     string `json:"model"`
		Title     string `json:"title"`
		CreatedAt string `json:"createdAt"`
		Draft     struct {
			Tool     string            `json:"tool"`
			Models   []json.RawMessage `json:"models"`
			Garments []json.RawMessage `json:"garments"`
			Poses    []json.RawMessage `json:"poses"`
			Faces    []json.RawMessage `json:"faces"`
			Note     string            `json:"note"`
		} `json:"draft"`
		Units []struct {
			ID         string            `json:"id"`
			Title      string            `json:"title"`
			Prompt     string            `json:"prompt"`
			Status     string            `json:"status"`
			References []json.RawMessage `json:"references"`
			ResourceID string            `json:"resourceId"`
			Video      *struct {
				Model      string `json:"model"`
				Seconds    int    `json:"seconds"`
				Prompt     string `json:"prompt"`
				Status     string `json:"status"`
				ResourceID string `json:"resourceId"`
			} `json:"video"`
		} `json:"units"`
	}
	if err := json.Unmarshal(raw, &work); err != nil {
		return errors.New("模特作品结构无效")
	}
	if work.Kind != "fashion" {
		return nil
	}
	tools := []string{"tryon", "multi-model", "multi-garment", "pose", "face", "smart-face", "head", "print"}
	if _, err := time.Parse(time.RFC3339, work.CreatedAt); err != nil || strings.TrimSpace(work.Title) == "" || utf8.RuneCountInString(work.Title) > productVideoMaxTitleRunes {
		return errors.New("模特作品须有有效名称与创建时间")
	}
	if !slices.Contains(tools, work.Draft.Tool) || work.Model == "" || utf8.RuneCountInString(work.Model) > 200 || utf8.RuneCountInString(work.Draft.Note) > 600 {
		return errors.New("模特工具或生成要求无效")
	}
	if len(work.Units) < 1 || len(work.Units) > 6 {
		return errors.New("一组模特作品须有 1–6 张")
	}
	for _, images := range [][]json.RawMessage{work.Draft.Models, work.Draft.Garments, work.Draft.Poses, work.Draft.Faces} {
		if len(images) > 6 {
			return errors.New("每类模特素材最多 6 张")
		}
		for _, image := range images {
			var ref struct {
				ResourceID string `json:"resourceId"`
				Name       string `json:"name"`
			}
			if json.Unmarshal(image, &ref) != nil || assets.ValidID(ref.ResourceID) != ref.ResourceID || ref.ResourceID == "" || utf8.RuneCountInString(ref.Name) > 300 {
				return errors.New("模特素材须引用已上传的图片")
			}
		}
	}
	modelCount, garmentCount := len(work.Draft.Models), len(work.Draft.Garments)
	switch work.Draft.Tool {
	case "multi-model":
		if modelCount < 2 || garmentCount != 1 {
			return errors.New("多模特同款须有多位模特与一件服装")
		}
	case "multi-garment":
		if modelCount != 1 || garmentCount < 2 {
			return errors.New("一模多衣须有一位模特与多件服装")
		}
	case "print":
		if garmentCount != 1 {
			return errors.New("印花提取须有一张原图")
		}
	case "pose":
		if modelCount != 1 || len(work.Draft.Poses) != 1 {
			return errors.New("姿势迁移须有目标与姿势参考")
		}
	case "face", "smart-face", "head":
		if modelCount != 1 || len(work.Draft.Faces) != 1 {
			return errors.New("换脸换头须有目标与身份参考")
		}
	case "tryon":
		if modelCount != 1 || garmentCount != 1 {
			return errors.New("换装须有一位模特与一件服装")
		}
	}
	ids := map[string]bool{}
	for _, unit := range work.Units {
		if !validEcommerceStudioID(unit.ID) || ids[unit.ID] || strings.TrimSpace(unit.Title) == "" || utf8.RuneCountInString(unit.Title) > 300 || unit.Prompt == "" || utf8.RuneCountInString(unit.Prompt) > 4000 || !slices.Contains([]string{"pending", "submitting", "running", "succeeded", "failed"}, unit.Status) || len(unit.References) < 1 || len(unit.References) > 2 {
			return errors.New("模特图片任务结构无效")
		}
		ids[unit.ID] = true
		if unit.Status == "succeeded" && unit.ResourceID == "" {
			return errors.New("成功的模特图片须有成品资源")
		}
		for _, image := range unit.References {
			var ref struct {
				ResourceID string `json:"resourceId"`
			}
			if json.Unmarshal(image, &ref) != nil || ref.ResourceID == "" || assets.ValidID(ref.ResourceID) != ref.ResourceID {
				return errors.New("模特任务参考图无效")
			}
		}
		if unit.Video != nil && (unit.Video.Model == "" || utf8.RuneCountInString(unit.Video.Model) > 200 || unit.Video.Seconds < 1 || unit.Video.Seconds > 120 || unit.Video.Prompt == "" || utf8.RuneCountInString(unit.Video.Prompt) > 2000) {
			return errors.New("模特视频任务结构无效")
		}
		if unit.Video != nil && (unit.ResourceID == "" || (unit.Video.Status != "" && !slices.Contains([]string{"pending", "running", "succeeded", "failed"}, unit.Video.Status)) || (unit.Video.Status == "succeeded" && unit.Video.ResourceID == "")) {
			return errors.New("模特视频须有选定图片与有效任务状态")
		}
	}
	return nil
}

func (s *Service) validateFashionResources(userID string, raw json.RawMessage) error {
	var kind struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &kind); err != nil || kind.Kind != "fashion" {
		return nil
	}
	refs, err := assets.CollectDocumentResourceReferences(string(raw))
	if err != nil {
		return BadAuthRequest("模特素材引用无效")
	}
	seen := map[string]bool{}
	for _, ref := range refs {
		kind := "image"
		if strings.Contains(ref.Path, ".video.") {
			kind = "video"
		}
		key := kind + ":" + ref.ResourceID
		if seen[key] {
			continue
		}
		resource, err := s.repo.ResourceForUser(userID, ref.ResourceID)
		if err != nil || resource.Status != model.ResourceStatusReady || resource.Kind != kind {
			return BadAuthRequest("模特素材不存在、尚未就绪或不属于当前用户")
		}
		seen[key] = true
	}
	return nil
}
