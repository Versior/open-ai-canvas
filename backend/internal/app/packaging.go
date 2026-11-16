package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/packaging"
	"yingce/backend/internal/repository"
)

const packagingCatalogKey = "packaging_catalog"

type PackagingCatalogInput struct {
	ExpectedRevision *int64            `json:"expectedRevision"`
	Catalog          packaging.Catalog `json:"catalog"`
}
type PackagingProjectInput struct {
	Name             string             `json:"name"`
	ExpectedRevision *int64             `json:"expectedRevision"`
	Document         packaging.Document `json:"document"`
}
type PackagingProjectView struct {
	model.PackagingProject
	Document packaging.Document `json:"document"`
}
type PackagingProjectPage struct {
	Items    []model.PackagingProject `json:"items"`
	Total    int64                    `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"pageSize"`
}

func (s *Service) PackagingCatalog(actor *model.User, admin bool) (packaging.Catalog, error) {
	if actor == nil {
		return packaging.Catalog{}, Unauthorized("请先登录")
	}
	if admin {
		if err := s.RequireAdmin(actor); err != nil {
			return packaging.Catalog{}, err
		}
	}
	return s.packagingCatalog(admin)
}

func (s *Service) GuestPackagingCatalog() (packaging.Catalog, error) {
	return s.packagingCatalog(false)
}

func (s *Service) packagingCatalog(admin bool) (packaging.Catalog, error) {
	result := packaging.DefaultCatalog()
	row, err := s.repo.SystemSettingOptional(packagingCatalogKey)
	if err != nil {
		return result, err
	}
	if row != nil {
		if err := json.Unmarshal([]byte(row.ValueJSON), &result); err != nil {
			return result, errors.New("包装目录配置无法读取")
		}
	}
	if !admin {
		result.Templates = slices.DeleteFunc(result.Templates, func(t packaging.Template) bool { return !t.Enabled })
		result.Materials = slices.DeleteFunc(result.Materials, func(m packaging.Material) bool { return !m.Enabled })
	}
	return result, nil
}

func (s *Service) SavePackagingCatalog(actor *model.User, input PackagingCatalogInput) (packaging.Catalog, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return packaging.Catalog{}, err
	}
	if input.ExpectedRevision == nil || *input.ExpectedRevision < 0 {
		return packaging.Catalog{}, BadAuthRequest("目录保存须提供有效 expectedRevision")
	}
	if err := packaging.ValidateCatalog(input.Catalog); err != nil {
		return packaging.Catalog{}, BadAuthRequest(err.Error())
	}
	before, err := s.repo.SystemSettingOptional(packagingCatalogKey)
	if err != nil {
		return packaging.Catalog{}, err
	}
	current := packaging.DefaultCatalog()
	if before != nil {
		if err := json.Unmarshal([]byte(before.ValueJSON), &current); err != nil {
			return packaging.Catalog{}, err
		}
	}
	conflict := &kernel.AppError{Status: 409, Code: 409, Message: "目录已在其他窗口修改，请重新加载", Reason: "packaging_catalog_conflict"}
	if current.Revision != *input.ExpectedRevision {
		return packaging.Catalog{}, conflict
	}
	value := input.Catalog
	value.Revision = *input.ExpectedRevision + 1
	raw, err := json.Marshal(value)
	if err != nil {
		return packaging.Catalog{}, err
	}
	audit, err := newAdminAuditEvent(actor, "packaging.catalog.save", "packaging_catalog", packagingCatalogKey, "更新包装盒型、材料与功能配置", map[string]any{"revision": value.Revision, "templates": len(value.Templates), "materials": len(value.Materials)})
	if err != nil {
		return packaging.Catalog{}, err
	}
	err = s.repo.SavePackagingCatalog(before, &model.SystemSetting{Key: packagingCatalogKey, ValueJSON: string(raw), UpdatedBy: actor.ID}, audit)
	if errors.Is(err, repository.ErrPackagingConflict) {
		return packaging.Catalog{}, conflict
	}
	return value, err
}

func (s *Service) PackagingProjects(actor *model.User, admin bool, userID, templateID string, page, pageSize int) (*PackagingProjectPage, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if admin {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	if !admin {
		userID = actor.ID
	}
	page = max(1, page)
	pageSize = min(100, max(1, pageSize))
	items, total, err := s.repo.PackagingProjects(userID, templateID, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &PackagingProjectPage{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) PackagingProject(actor *model.User, id string, admin bool) (*PackagingProjectView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	userID := actor.ID
	if admin {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
		userID = ""
	}
	item, err := s.repo.PackagingProject(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("包装项目不存在")
	}
	if err != nil {
		return nil, err
	}
	var d packaging.Document
	if err := json.Unmarshal([]byte(item.DocumentJSON), &d); err != nil {
		return nil, errors.New("包装项目数据无法读取")
	}
	return &PackagingProjectView{PackagingProject: *item, Document: d}, nil
}

func (s *Service) SavePackagingProject(actor *model.User, id string, input PackagingProjectInput) (*PackagingProjectView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 120 || input.ExpectedRevision == nil || *input.ExpectedRevision < 0 {
		return nil, BadAuthRequest("项目名称或 expectedRevision 无效")
	}
	if err := packaging.ValidateDocument(input.Document); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	catalog, err := s.PackagingCatalog(actor, false)
	if err != nil {
		return nil, err
	}
	if !catalog.Enabled {
		return nil, Forbidden("包装刀板暂未开放，已有项目仍可查看和导出")
	}
	if !slices.ContainsFunc(catalog.Templates, func(t packaging.Template) bool {
		return t.ID == input.Document.Template.ID && t.Structure == input.Document.Template.Structure
	}) || !slices.ContainsFunc(catalog.Materials, func(m packaging.Material) bool { return m.ID == input.Document.Material.ID }) {
		return nil, BadAuthRequest("选用盒型或材料已停用，请从当前目录重新选择")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	now := time.Now().UTC()
	item := model.PackagingProject{ID: id, UserID: actor.ID, Name: input.Name, TemplateID: input.Document.Template.ID, Revision: *input.ExpectedRevision + 1, CreatedAt: now, UpdatedAt: now}
	if id == "" {
		if *input.ExpectedRevision != 0 {
			return nil, BadAuthRequest("新项目版本必须为 0")
		}
		item.ID = kernel.NewID()
	}
	if id != "" {
		current, err := s.repo.PackagingProject(actor.ID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("包装项目不存在")
		}
		if err != nil {
			return nil, err
		}
		if *input.ExpectedRevision == 0 {
			return nil, BadAuthRequest("已有项目版本必须大于 0")
		}
		item.CreatedAt = current.CreatedAt
	}
	raw, err := json.Marshal(input.Document)
	if err != nil {
		return nil, err
	}
	item.DocumentJSON = string(raw)
	refs := []string{}
	for _, a := range input.Document.Artworks {
		if a.Content == nil && !slices.Contains(refs, a.ResourceID) {
			refs = append(refs, a.ResourceID)
		}
	}
	if err := s.repo.SavePackagingProject(&item, *input.ExpectedRevision, refs, catalog.MaxProjects); err != nil {
		if errors.Is(err, repository.ErrPackagingConflict) {
			return nil, &kernel.AppError{Status: 409, Code: 409, Message: "项目已在其他窗口修改，请载入最新版本或另存副本", Reason: "packaging_project_conflict"}
		}
		if errors.Is(err, repository.ErrPackagingQuota) {
			return nil, BadAuthRequest("包装项目已达到保存配额")
		}
		if errors.Is(err, repository.ErrPackagingResource) {
			return nil, BadAuthRequest(err.Error())
		}
		return nil, err
	}
	return &PackagingProjectView{PackagingProject: item, Document: input.Document}, nil
}

func (s *Service) DeletePackagingProject(actor *model.User, id string, expected int64) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	if expected < 1 {
		return BadAuthRequest("删除须提供当前项目版本")
	}
	if _, err := s.PackagingProject(actor, id, false); err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if err := s.repo.DeletePackagingProject(actor.ID, id, expected, nil); err != nil {
		if errors.Is(err, repository.ErrPackagingConflict) {
			return &kernel.AppError{Status: 409, Code: 409, Message: "项目已更新，未执行删除", Reason: "packaging_project_conflict"}
		}
		return err
	}
	return nil
}

func (s *Service) AdminPackagingOverview(actor *model.User) (repository.PackagingStats, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return repository.PackagingStats{}, err
	}
	return s.repo.PackagingStats()
}

func (s *Service) AdminDeletePackagingProject(actor *model.User, id string, expected int64) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if expected < 1 {
		return BadAuthRequest("删除须提供当前项目版本")
	}
	item, err := s.PackagingProject(actor, id, true)
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	audit, err := newAdminAuditEvent(actor, "packaging.project.delete", "packaging_project", id, "删除包装项目", map[string]any{"revision": expected})
	if err != nil {
		return err
	}
	if err := s.repo.DeletePackagingProject(item.UserID, id, expected, audit); err != nil {
		if errors.Is(err, repository.ErrPackagingConflict) {
			return &kernel.AppError{Status: 409, Code: 409, Message: "项目已更新，未执行删除", Reason: "packaging_project_conflict"}
		}
		return err
	}
	return nil
}
