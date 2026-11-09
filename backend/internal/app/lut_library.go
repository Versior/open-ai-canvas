package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type LUTLibraryWriteRequest struct {
	Name            string         `json:"name"`
	Category        string         `json:"category"`
	Description     string         `json:"description"`
	Enabled         *bool          `json:"enabled"`
	SortOrder       int            `json:"sortOrder"`
	DefaultStrength *float64       `json:"defaultStrength"`
	Cube            *renderCubeLut `json:"cube,omitempty"`
	ExpectedVersion int64          `json:"expectedVersion"`
}

type LUTLibrarySnapshot struct {
	*renderLut
	LibraryID      string `json:"libraryId"`
	LibraryVersion int64  `json:"libraryVersion"`
}

type LUTLibraryDetail struct {
	Item *model.LUTLibraryItem `json:"item"`
	Lut  LUTLibrarySnapshot    `json:"lut"`
}

func (s *Service) LUTLibraryItems(actor *model.User, admin bool) ([]model.LUTLibraryItem, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if admin {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	return s.repo.LUTLibraryItems(!admin)
}

func (s *Service) LUTLibraryDetail(actor *model.User, id string, admin bool) (*LUTLibraryDetail, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if admin {
		if err := s.RequireAdmin(actor); err != nil {
			return nil, err
		}
	}
	item, err := s.repo.LUTLibraryItem(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("LUT 已被删除或不存在")
	}
	if err != nil {
		return nil, err
	}
	if !admin && !item.Enabled {
		return nil, NotFound("LUT 已停用，请重新选择")
	}
	lut := &renderLut{Name: item.Name, Strength: item.DefaultStrength, Preset: item.Preset}
	if item.CubeJSON != "" {
		if err := json.Unmarshal([]byte(item.CubeJSON), &lut.Cube); err != nil {
			return nil, fmt.Errorf("LUT 色表数据损坏")
		}
	}
	if err := validateRenderLut(lut); err != nil {
		return nil, err
	}
	lut.Cube = renderLutCube(lut)
	lut.Preset = ""
	return &LUTLibraryDetail{Item: item, Lut: LUTLibrarySnapshot{renderLut: lut, LibraryID: item.ID, LibraryVersion: item.Version}}, nil
}

func validateLUTLibraryWrite(req *LUTLibraryWriteRequest) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Category = strings.TrimSpace(req.Category)
	req.Description = strings.TrimSpace(req.Description)
	if req.Name == "" || len([]rune(req.Name)) > 120 {
		return BadAuthRequest("LUT 名称须为 1–120 个字符")
	}
	if req.Category == "" || len([]rune(req.Category)) > 80 {
		return BadAuthRequest("分类须为 1–80 个字符")
	}
	if len([]rune(req.Description)) > 500 {
		return BadAuthRequest("说明不能超过 500 个字符")
	}
	if req.Enabled == nil || req.DefaultStrength == nil || math.IsNaN(*req.DefaultStrength) || math.IsInf(*req.DefaultStrength, 0) || *req.DefaultStrength < 0 || *req.DefaultStrength > 1 {
		return BadAuthRequest("请选择状态和 0–100% 的默认强度")
	}
	if req.SortOrder < 0 || req.SortOrder > 100000 {
		return BadAuthRequest("排序须为 0–100000 的整数")
	}
	if req.Cube != nil {
		if err := validateRenderLut(&renderLut{Name: req.Name, Strength: *req.DefaultStrength, Cube: req.Cube}); err != nil {
			return BadAuthRequest(err.Error())
		}
	}
	return nil
}

func (s *Service) CreateLUTLibraryItem(actor *model.User, req LUTLibraryWriteRequest) (*model.LUTLibraryItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validateLUTLibraryWrite(&req); err != nil {
		return nil, err
	}
	if req.Cube == nil {
		return nil, BadAuthRequest("请上传有效的 .cube LUT 文件")
	}
	encoded, err := json.Marshal(req.Cube)
	if err != nil {
		return nil, err
	}
	item := &model.LUTLibraryItem{ID: newID(), Name: req.Name, Category: req.Category, Description: req.Description, Enabled: *req.Enabled, SortOrder: req.SortOrder, DefaultStrength: *req.DefaultStrength, CubeJSON: string(encoded), CubeSize: req.Cube.Size, Version: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	audit, err := newAdminAuditEvent(actor, "lut_library.create", "lut_library", item.ID, "新增 LUT 滤镜", map[string]any{"name": item.Name})
	if err != nil {
		return nil, err
	}
	if err := s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.CreateLUTLibraryItem(item); err != nil {
			return err
		}
		return tx.AppendAdminAudit(audit)
	}); err != nil {
		return nil, err
	}
	return item, nil
}

func lutLibraryMutationError(err error) error {
	if errors.Is(err, repository.ErrLUTLibraryConflict) {
		return &AppError{Status: 409, Code: 409, Message: "LUT 已被其他管理员修改或删除，请刷新后重试"}
	}
	return err
}

func (s *Service) UpdateLUTLibraryItem(actor *model.User, id string, req LUTLibraryWriteRequest) (*model.LUTLibraryItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if req.ExpectedVersion <= 0 {
		return nil, BadAuthRequest("缺少 LUT 版本，请刷新后重试")
	}
	if err := validateLUTLibraryWrite(&req); err != nil {
		return nil, err
	}
	fields := map[string]any{"name": req.Name, "category": req.Category, "description": req.Description, "enabled": *req.Enabled, "sort_order": req.SortOrder, "default_strength": *req.DefaultStrength, "updated_at": time.Now()}
	if req.Cube != nil {
		encoded, err := json.Marshal(req.Cube)
		if err != nil {
			return nil, err
		}
		fields["cube_json"], fields["cube_size"], fields["preset"] = string(encoded), req.Cube.Size, ""
	}
	audit, err := newAdminAuditEvent(actor, "lut_library.update", "lut_library", id, "更新 LUT 滤镜", map[string]any{"name": req.Name, "enabled": *req.Enabled})
	if err != nil {
		return nil, err
	}
	var item *model.LUTLibraryItem
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.UpdateLUTLibraryItem(id, req.ExpectedVersion, fields); err != nil {
			return err
		}
		if err := tx.AppendAdminAudit(audit); err != nil {
			return err
		}
		item, err = tx.LUTLibraryItem(id)
		return err
	})
	return item, lutLibraryMutationError(err)
}

func (s *Service) DeleteLUTLibraryItem(actor *model.User, id string, version int64) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if version <= 0 {
		return BadAuthRequest("缺少 LUT 版本，请刷新后重试")
	}
	audit, err := newAdminAuditEvent(actor, "lut_library.delete", "lut_library", id, "删除 LUT 滤镜", nil)
	if err != nil {
		return err
	}
	return lutLibraryMutationError(s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.DeleteLUTLibraryItem(id, version); err != nil {
			return err
		}
		return tx.AppendAdminAudit(audit)
	}))
}
