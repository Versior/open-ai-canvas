package app

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"yingce/backend/internal/interior"
	"yingce/backend/internal/model"
)

type interiorBaselineResource struct {
	ResourceID string `json:"resourceId"`
}

type InteriorDrawingBaselineView struct {
	ProjectID string                   `json:"projectId"`
	SceneID   string                   `json:"sceneId"`
	Title     string                   `json:"title"`
	Notice    string                   `json:"notice,omitempty"`
	SceneFile interiorBaselineResource `json:"sceneFile"`
}

// 仅复用本人明确确认的结构。上传文件改名或资源 ID 变化时仍按实际字节匹配，
// 不能按文件名、房间数或尺寸相似度套用另一张图的户型。
func (s *Service) InteriorDrawingBaseline(actor *model.User, referenceID string) (*InteriorDrawingBaselineView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	reference, err := s.repo.ResourceForUser(actor.ID, strings.TrimSpace(referenceID))
	if err != nil {
		return nil, err
	}
	if reference.Status != model.ResourceStatusReady || !strings.HasPrefix(reference.MimeType, "image/") {
		return nil, BadAuthRequest("请使用已上传完成的图纸图片")
	}
	projects, err := s.repo.InteriorDrawingProjects(actor.ID, interior.MaxProjectsPerUser)
	if err != nil {
		return nil, err
	}
	fingerprints := map[string][32]byte{}
	fingerprint := func(id string) ([32]byte, error) {
		if hash, ok := fingerprints[id]; ok {
			return hash, nil
		}
		_, body, err := s.OpenResource(actor.ID, id)
		if err != nil {
			return [32]byte{}, err
		}
		defer body.Close()
		hash := sha256.New()
		const maxBytes = 32 << 20
		count, err := io.Copy(hash, io.LimitReader(body, maxBytes+1))
		if err != nil {
			return [32]byte{}, err
		}
		if count == 0 || count > maxBytes {
			return [32]byte{}, BadAuthRequest("结构基准的图纸文件须为非空且不超过32MB")
		}
		var sum [32]byte
		copy(sum[:], hash.Sum(nil))
		fingerprints[id] = sum
		return sum, nil
	}
	for _, project := range projects {
		var doc struct {
			Scenes []struct {
				ID              string                   `json:"id"`
				Status          string                   `json:"status"`
				Title           string                   `json:"title"`
				Notice          string                   `json:"notice"`
				DrawingBaseline bool                     `json:"drawingBaseline"`
				Reference       interiorBaselineResource `json:"reference"`
				SceneFile       interiorBaselineResource `json:"sceneFile"`
			} `json:"scenes"`
		}
		if json.Unmarshal([]byte(project.DocumentJSON), &doc) != nil {
			return nil, errors.New("室内项目结构基准记录无效")
		}
		for _, scene := range doc.Scenes {
			if !scene.DrawingBaseline || scene.Status != "succeeded" || scene.Reference.ResourceID == "" || scene.SceneFile.ResourceID == "" {
				continue
			}
			candidate, err := s.repo.ResourceForUser(actor.ID, scene.Reference.ResourceID)
			if err != nil {
				return nil, err
			}
			if candidate.Status != model.ResourceStatusReady || candidate.Size != reference.Size || !strings.HasPrefix(candidate.MimeType, "image/") {
				continue
			}
			if candidate.ID != reference.ID {
				left, err := fingerprint(candidate.ID)
				if err != nil {
					return nil, err
				}
				right, err := fingerprint(reference.ID)
				if err != nil {
					return nil, err
				}
				if left != right {
					continue
				}
			}
			file, err := s.repo.ResourceForUser(actor.ID, scene.SceneFile.ResourceID)
			if err != nil {
				return nil, err
			}
			if file.Status != model.ResourceStatusReady {
				return nil, BadAuthRequest("已校准结构文件尚未就绪")
			}
			return &InteriorDrawingBaselineView{ProjectID: project.ID, SceneID: scene.ID, Title: scene.Title, Notice: scene.Notice, SceneFile: scene.SceneFile}, nil
		}
	}
	return nil, nil
}
