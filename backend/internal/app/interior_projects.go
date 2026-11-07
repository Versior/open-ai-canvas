package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/interior"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const interiorProjectConflictReason = "interior_project_conflict"

type InteriorProjectSummary struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Revision  int64     `json:"revision"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type InteriorProjectView struct {
	InteriorProjectSummary
	Document json.RawMessage `json:"document"`
}

type InteriorProjectInput struct {
	Name     string          `json:"name"`
	Kind     string          `json:"kind"`
	Document json.RawMessage `json:"document"`
	// ExpectedRevision 是浏览器上次读到的修订号；不一致时返回 409，不覆盖别处的修改。
	ExpectedRevision *int64 `json:"expectedRevision,omitempty"`
}

func (s *Service) InteriorProjects(actor *model.User) ([]InteriorProjectSummary, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	items, err := s.repo.InteriorProjects(actor.ID, interior.MaxProjectsPerUser)
	if err != nil {
		return nil, err
	}
	result := make([]InteriorProjectSummary, 0, len(items))
	for _, item := range items {
		result = append(result, interiorProjectSummary(item))
	}
	return result, nil
}

func (s *Service) InteriorProject(actor *model.User, id string) (*InteriorProjectView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	item, err := s.interiorOwnedProject(actor.ID, id)
	if err != nil {
		return nil, err
	}
	view := interiorProjectView(*item)
	return &view, nil
}

func (s *Service) CreateInteriorProject(actor *model.User, input InteriorProjectInput) (*InteriorProjectView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	name, kind, document, err := normalizeInteriorProjectInput(input)
	if err != nil {
		return nil, err
	}
	if err := s.validateInteriorMaterialRef(actor.ID, document); err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	count, err := s.repo.InteriorProjectCount(actor.ID)
	if err != nil {
		return nil, err
	}
	if count >= interior.MaxProjectsPerUser {
		return nil, BadAuthRequest("最多保存 200 个室内设计项目，请先删除不再使用的项目")
	}
	now := time.Now().UTC()
	item := model.InteriorProject{ID: kernel.NewID(), UserID: actor.ID, Name: name, Kind: kind, DocumentJSON: document, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateInteriorProject(&item); err != nil {
		return nil, err
	}
	view := interiorProjectView(item)
	return &view, nil
}

// SaveInteriorProject 整体替换项目名称和文档。与孤儿资源清理共用 storageMu，
// 避免清理在读取引用和删除之间看到半写入的项目。
func (s *Service) SaveInteriorProject(actor *model.User, id string, input InteriorProjectInput) (*InteriorProjectView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if input.ExpectedRevision == nil {
		return nil, BadAuthRequest("保存项目时必须带上 expectedRevision")
	}
	name, kind, document, err := normalizeInteriorProjectInput(input)
	if err != nil {
		return nil, err
	}
	if err := s.validateInteriorMaterialRef(actor.ID, document); err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	current, err := s.interiorOwnedProject(actor.ID, id)
	if err != nil {
		return nil, err
	}
	if current.Revision != *input.ExpectedRevision {
		return nil, interiorProjectConflict(current.Revision)
	}
	next := *current
	next.Name, next.Kind, next.DocumentJSON, next.Revision, next.UpdatedAt = name, kind, document, current.Revision+1, time.Now().UTC()
	if err := s.repo.SaveInteriorProject(&next, current.Revision); errors.Is(err, repository.ErrInteriorProjectConflict) {
		latest, readErr := s.interiorOwnedProject(actor.ID, id)
		if readErr != nil {
			return nil, readErr
		}
		return nil, interiorProjectConflict(latest.Revision)
	} else if err != nil {
		return nil, err
	}
	view := interiorProjectView(next)
	return &view, nil
}

func (s *Service) DeleteInteriorProject(actor *model.User, id string) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if _, err := s.interiorOwnedProject(actor.ID, id); err != nil {
		return err
	}
	deleted, err := s.repo.DeleteInteriorProject(actor.ID, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if !deleted {
		return NotFound("项目不存在或已被删除")
	}
	return nil
}

func (s *Service) interiorOwnedProject(userID, id string) (*model.InteriorProject, error) {
	id = strings.TrimSpace(id)
	if assets.ValidID(id) != id || id == "" {
		return nil, BadAuthRequest("项目标识无效")
	}
	item, err := s.repo.InteriorProject(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("项目不存在或已被删除")
	}
	return item, err
}

func normalizeInteriorProjectInput(input InteriorProjectInput) (string, string, string, error) {
	name, err := interior.NormalizeProjectName(input.Name)
	if err != nil {
		return "", "", "", BadAuthRequest(err.Error())
	}
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = interior.ProjectKindHome
	}
	if !interior.ValidProjectKind(kind) {
		return "", "", "", BadAuthRequest("项目类型须为 home 或 client")
	}
	document, err := interior.NormalizeProjectDocument(input.Document)
	if err != nil {
		return "", "", "", BadAuthRequest(err.Error())
	}
	return name, kind, document, nil
}

func interiorProjectSummary(item model.InteriorProject) InteriorProjectSummary {
	return InteriorProjectSummary{ID: item.ID, Name: item.Name, Kind: item.Kind, Revision: item.Revision, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func interiorProjectView(item model.InteriorProject) InteriorProjectView {
	return InteriorProjectView{InteriorProjectSummary: interiorProjectSummary(item), Document: json.RawMessage(item.DocumentJSON)}
}

func interiorProjectConflict(current int64) error {
	return &AppError{Status: http.StatusConflict, Code: http.StatusConflict, Reason: interiorProjectConflictReason, Message: "项目已在其他窗口修改，请载入最新内容后再保存", Details: map[string]any{"revision": current}}
}
