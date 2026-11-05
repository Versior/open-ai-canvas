package app

import (
	"encoding/json"
	"errors"
	"log/slog"
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

const interiorSettingsKey = "interior_settings"

type (
	InteriorModeInput   = interior.ModeInput
	InteriorPresetInput = interior.PresetInput
	InteriorSettings    = interior.Settings
	InteriorModelRef    = interior.ModelRef
)

type InteriorModeView struct {
	ID              string               `json:"id"`
	Key             string               `json:"key"`
	Name            string               `json:"name"`
	Subtitle        string               `json:"subtitle"`
	Description     string               `json:"description"`
	Audience        string               `json:"audience"`
	CoverResourceID string               `json:"coverResourceId,omitempty"`
	CoverURL        string               `json:"coverUrl,omitempty"`
	Slots           []interior.InputSlot `json:"slots"`
	Params          []interior.ParamDef  `json:"params"`
	RequiresRoom    bool                 `json:"requiresRoom"`
	RequiresStyle   bool                 `json:"requiresStyle"`
	NotesRequired   bool                 `json:"notesRequired"`
	DefaultModel    *interior.ModelRef   `json:"defaultModel,omitempty"`
	AllowedModels   []interior.ModelRef  `json:"allowedModels"`
	MaxCount        int                  `json:"maxCount"`
	SortOrder       int                  `json:"sortOrder"`
	Enabled         bool                 `json:"enabled"`
	Builtin         bool                 `json:"builtin"`
	Version         int                  `json:"version"`
	PromptTemplate  string               `json:"promptTemplate,omitempty"`
	UpdatedAt       time.Time            `json:"updatedAt"`
}

type InteriorPresetView struct {
	ID              string    `json:"id"`
	Type            string    `json:"type"`
	Key             string    `json:"key"`
	GroupName       string    `json:"groupName"`
	Name            string    `json:"name"`
	Summary         string    `json:"summary"`
	CoverResourceID string    `json:"coverResourceId,omitempty"`
	CoverURL        string    `json:"coverUrl,omitempty"`
	Prompt          string    `json:"prompt,omitempty"`
	Tags            []string  `json:"tags"`
	SortOrder       int       `json:"sortOrder"`
	Enabled         bool      `json:"enabled"`
	Builtin         bool      `json:"builtin"`
	Version         int       `json:"version"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// InteriorCatalog 是前台可用的模式、风格和空间。提示词模板和片段不在其中。
type InteriorCatalog struct {
	Settings InteriorPublicSettings `json:"settings"`
	Modes    []InteriorModeView     `json:"modes"`
	Styles   []InteriorPresetView   `json:"styles"`
	Rooms    []InteriorPresetView   `json:"rooms"`
}

type InteriorPublicSettings struct {
	DefaultSurface     string `json:"defaultSurface"`
	AllowSurfaceSwitch bool   `json:"allowSurfaceSwitch"`
	MaxStylesPerRun    int    `json:"maxStylesPerRun"`
	MaxCountPerStyle   int    `json:"maxCountPerStyle"`
	// DefaultModel 只含系统渠道或前台逻辑模型的标识，页面据此预选模型。
	DefaultModel *interior.ModelRef `json:"defaultModel,omitempty"`
}

// EnsureBuiltinInteriorCatalog 在启动时补齐内置的模式、风格和空间；已有记录不覆盖。
func (s *Service) EnsureBuiltinInteriorCatalog() (int, error) {
	seed, err := interior.BuiltinSeed()
	if err != nil {
		return 0, err
	}
	now := time.Now().UTC()
	modes := make([]model.InteriorMode, 0, len(seed.Modes))
	for _, input := range seed.Modes {
		item, err := interiorModeFromInput(input)
		if err != nil {
			return 0, err
		}
		item.ID, item.Builtin, item.Version, item.CreatedAt, item.UpdatedAt = kernel.NewID(), true, 1, now, now
		modes = append(modes, item)
	}
	presets := make([]model.InteriorPreset, 0, len(seed.Presets))
	for _, input := range seed.Presets {
		item, err := interiorPresetFromInput(input)
		if err != nil {
			return 0, err
		}
		item.ID, item.Builtin, item.Version, item.CreatedAt, item.UpdatedAt = kernel.NewID(), true, 1, now, now
		presets = append(presets, item)
	}
	return s.repo.EnsureInteriorCatalog(modes, presets)
}

func (s *Service) InteriorCatalog(actor *model.User) (*InteriorCatalog, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	settings, err := s.interiorSettings()
	if err != nil {
		return nil, err
	}
	modes, err := s.repo.InteriorModes(true)
	if err != nil {
		return nil, err
	}
	presets, err := s.repo.InteriorPresets("", true)
	if err != nil {
		return nil, err
	}
	catalog := &InteriorCatalog{
		Settings: InteriorPublicSettings{DefaultSurface: settings.DefaultSurface, AllowSurfaceSwitch: settings.AllowSurfaceSwitch, MaxStylesPerRun: settings.MaxStylesPerRun, MaxCountPerStyle: settings.MaxCountPerStyle, DefaultModel: settings.DefaultModel},
		Modes:    make([]InteriorModeView, 0, len(modes)),
		Styles:   []InteriorPresetView{},
		Rooms:    []InteriorPresetView{},
	}
	for _, item := range modes {
		view, err := s.interiorModeView(item, false)
		if err != nil {
			return nil, err
		}
		catalog.Modes = append(catalog.Modes, view)
	}
	for _, item := range presets {
		view := s.interiorPresetView(item, false)
		switch item.Type {
		case interior.PresetStyle:
			catalog.Styles = append(catalog.Styles, view)
		case interior.PresetRoom:
			catalog.Rooms = append(catalog.Rooms, view)
		}
	}
	return catalog, nil
}

func (s *Service) AdminInteriorModes(actor *model.User) ([]InteriorModeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	modes, err := s.repo.InteriorModes(false)
	if err != nil {
		return nil, err
	}
	views := make([]InteriorModeView, 0, len(modes))
	for _, item := range modes {
		view, err := s.interiorModeView(item, true)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) CreateInteriorMode(actor *model.User, input InteriorModeInput) (*InteriorModeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := interior.NormalizeModeInput(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if err := s.requireInteriorCover(actor, normalized.CoverResource, ""); err != nil {
		return nil, err
	}
	if _, err := s.repo.InteriorModeByKey(normalized.Key); err == nil {
		return nil, BadAuthRequest("模式标识已存在")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	item, err := interiorModeFromInput(normalized)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	item.ID, item.Version, item.CreatedBy, item.UpdatedBy, item.CreatedAt, item.UpdatedAt = kernel.NewID(), 1, actor.ID, actor.ID, now, now
	if err := s.repo.CreateInteriorMode(&item); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_mode.create", "interior_mode", item.ID, "新增室内设计模式："+item.Name, map[string]any{"key": item.Key}); err != nil {
		return nil, err
	}
	view, err := s.interiorModeView(item, true)
	return &view, err
}

func (s *Service) UpdateInteriorMode(actor *model.User, id string, input InteriorModeInput) (*InteriorModeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, err := s.repo.InteriorMode(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("模式不存在")
	}
	if err != nil {
		return nil, err
	}
	input.Key = current.Key
	normalized, err := interior.NormalizeModeInput(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if err := s.requireInteriorCover(actor, normalized.CoverResource, current.CoverResourceID); err != nil {
		return nil, err
	}
	if input.Version != current.Version {
		return nil, interiorVersionConflict(current.Version)
	}
	item, err := interiorModeFromInput(normalized)
	if err != nil {
		return nil, err
	}
	item.ID, item.Key, item.Builtin, item.CreatedBy, item.CreatedAt = current.ID, current.Key, current.Builtin, current.CreatedBy, current.CreatedAt
	item.Version, item.UpdatedBy, item.UpdatedAt = current.Version+1, actor.ID, time.Now().UTC()
	if err := s.repo.SaveInteriorMode(&item, current.Version); errors.Is(err, repository.ErrInteriorVersionConflict) {
		return nil, interiorVersionConflict(current.Version)
	} else if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_mode.update", "interior_mode", item.ID, "修改室内设计模式："+item.Name, map[string]any{"key": item.Key, "version": item.Version, "enabled": item.Enabled}); err != nil {
		return nil, err
	}
	view, err := s.interiorModeView(item, true)
	return &view, err
}

func (s *Service) AdminInteriorPresets(actor *model.User, presetType string) ([]InteriorPresetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if !interior.ValidPresetType(presetType) {
		return nil, BadAuthRequest("预设类型须为 style 或 room")
	}
	items, err := s.repo.InteriorPresets(presetType, false)
	if err != nil {
		return nil, err
	}
	views := make([]InteriorPresetView, 0, len(items))
	for _, item := range items {
		views = append(views, s.interiorPresetView(item, true))
	}
	return views, nil
}

func (s *Service) CreateInteriorPreset(actor *model.User, input InteriorPresetInput) (*InteriorPresetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := interior.NormalizePresetInput(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if err := s.requireInteriorCover(actor, normalized.CoverResource, ""); err != nil {
		return nil, err
	}
	existing, err := s.repo.InteriorPresetsByKeys(normalized.Type, []string{normalized.Key})
	if err != nil {
		return nil, err
	}
	if len(existing) > 0 {
		return nil, BadAuthRequest("同类型下的标识已存在")
	}
	item, err := interiorPresetFromInput(normalized)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	item.ID, item.Version, item.CreatedBy, item.UpdatedBy, item.CreatedAt, item.UpdatedAt = kernel.NewID(), 1, actor.ID, actor.ID, now, now
	if err := s.repo.CreateInteriorPreset(&item); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_preset.create", "interior_preset", item.ID, "新增室内设计"+interiorPresetLabel(item.Type)+"："+item.Name, map[string]any{"type": item.Type, "key": item.Key}); err != nil {
		return nil, err
	}
	view := s.interiorPresetView(item, true)
	return &view, nil
}

func (s *Service) UpdateInteriorPreset(actor *model.User, id string, input InteriorPresetInput) (*InteriorPresetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, err := s.repo.InteriorPreset(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("预设不存在")
	}
	if err != nil {
		return nil, err
	}
	input.Type, input.Key = current.Type, current.Key
	normalized, err := interior.NormalizePresetInput(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if err := s.requireInteriorCover(actor, normalized.CoverResource, current.CoverResourceID); err != nil {
		return nil, err
	}
	if input.Version != current.Version {
		return nil, interiorVersionConflict(current.Version)
	}
	item, err := interiorPresetFromInput(normalized)
	if err != nil {
		return nil, err
	}
	item.ID, item.Type, item.Key, item.Builtin, item.CreatedBy, item.CreatedAt = current.ID, current.Type, current.Key, current.Builtin, current.CreatedBy, current.CreatedAt
	item.Version, item.UpdatedBy, item.UpdatedAt = current.Version+1, actor.ID, time.Now().UTC()
	if err := s.repo.SaveInteriorPreset(&item, current.Version); errors.Is(err, repository.ErrInteriorVersionConflict) {
		return nil, interiorVersionConflict(current.Version)
	} else if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_preset.update", "interior_preset", item.ID, "修改室内设计"+interiorPresetLabel(item.Type)+"："+item.Name, map[string]any{"type": item.Type, "key": item.Key, "version": item.Version, "enabled": item.Enabled}); err != nil {
		return nil, err
	}
	view := s.interiorPresetView(item, true)
	return &view, nil
}

func (s *Service) AdminInteriorSettings(actor *model.User) (*InteriorSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	settings, err := s.interiorSettings()
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

func (s *Service) UpdateInteriorSettings(actor *model.User, input InteriorSettings) (*InteriorSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := interior.NormalizeSettings(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	before, err := s.interiorSettings()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: interiorSettingsKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current, err := s.repo.SystemSetting(interiorSettingsKey); err == nil {
		setting.CreatedAt = current.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_settings.update", "system_setting", interiorSettingsKey, "更新室内设计配置", map[string]any{"before": before, "after": normalized}); err != nil {
		return nil, err
	}
	return &normalized, nil
}

// interiorSettings 读取全局配置；没有保存过时使用默认值。保存过但无法解析时报错，不静默回退。
func (s *Service) interiorSettings() (InteriorSettings, error) {
	setting, err := s.repo.SystemSetting(interiorSettingsKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return interior.DefaultSettings(), nil
	}
	if err != nil {
		return InteriorSettings{}, err
	}
	value := interior.DefaultSettings()
	if json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return InteriorSettings{}, errors.New("室内设计配置格式无效")
	}
	return interior.NormalizeSettings(value)
}

// requireInteriorCover 只校验新换上的封面：必须是当前管理员自己上传、已就绪的图片。
// 封面没变时跳过，别的管理员设过的封面不妨碍修改其他字段。
func (s *Service) requireInteriorCover(actor *model.User, resourceID, previous string) error {
	if resourceID == "" || resourceID == previous {
		return nil
	}
	resource, err := s.repo.ResourceForUser(actor.ID, resourceID)
	if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return BadAuthRequest("封面图片不存在或未就绪")
	}
	return nil
}

// interiorCoverURL 是读展示路径：封面失效时只记录告警，不影响整个目录返回。
func (s *Service) interiorCoverURL(resourceID string) string {
	if resourceID == "" {
		return ""
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil || resource.Status != model.ResourceStatusReady {
		slog.Warn("interior cover unavailable", "resourceId", resourceID)
		return ""
	}
	access, err := s.resolveResourceAccess(resource, ResourceAccessOptions{Purpose: assets.PurposeDisplay})
	if err != nil || access == nil {
		slog.Warn("interior cover access failed", "resourceId", resourceID, "error", err)
		return ""
	}
	return access.URL
}

func (s *Service) interiorModeView(item model.InteriorMode, admin bool) (InteriorModeView, error) {
	view := InteriorModeView{
		ID: item.ID, Key: item.Key, Name: item.Name, Subtitle: item.Subtitle, Description: item.Description, Audience: item.Audience,
		CoverResourceID: item.CoverResourceID, CoverURL: s.interiorCoverURL(item.CoverResourceID),
		RequiresRoom: item.RequiresRoom, RequiresStyle: item.RequiresStyle, NotesRequired: item.NotesRequired,
		MaxCount: item.MaxCount, SortOrder: item.SortOrder, Enabled: item.Enabled, Builtin: item.Builtin, Version: item.Version, UpdatedAt: item.UpdatedAt,
		Slots: []interior.InputSlot{}, Params: []interior.ParamDef{}, AllowedModels: []interior.ModelRef{},
	}
	if err := interior.DecodeJSON(item.SlotsJSON, &view.Slots); err != nil {
		return view, errors.New("室内设计模式输入配置无效：" + item.Key)
	}
	if err := interior.DecodeJSON(item.ParamsJSON, &view.Params); err != nil {
		return view, errors.New("室内设计模式参数配置无效：" + item.Key)
	}
	if err := interior.DecodeJSON(item.AllowedModelsJSON, &view.AllowedModels); err != nil {
		return view, errors.New("室内设计模式可选模型配置无效：" + item.Key)
	}
	if strings.TrimSpace(item.DefaultModelJSON) != "" {
		var ref interior.ModelRef
		if err := interior.DecodeJSON(item.DefaultModelJSON, &ref); err != nil {
			return view, errors.New("室内设计模式默认模型配置无效：" + item.Key)
		}
		if ref.Model != "" {
			view.DefaultModel = &ref
		}
	}
	if admin {
		view.PromptTemplate = item.PromptTemplate
		return view, nil
	}
	// 前台只需要选项名称；每个选项对应的提示词片段留在服务端。
	for index := range view.Params {
		options := make([]interior.ParamOption, 0, len(view.Params[index].Options))
		for _, option := range view.Params[index].Options {
			options = append(options, interior.ParamOption{Value: option.Value, Label: option.Label})
		}
		view.Params[index].Options = options
	}
	return view, nil
}

func (s *Service) interiorPresetView(item model.InteriorPreset, admin bool) InteriorPresetView {
	view := InteriorPresetView{
		ID: item.ID, Type: item.Type, Key: item.Key, GroupName: item.GroupName, Name: item.Name, Summary: item.Summary,
		CoverResourceID: item.CoverResourceID, CoverURL: s.interiorCoverURL(item.CoverResourceID),
		Tags: []string{}, SortOrder: item.SortOrder, Enabled: item.Enabled, Builtin: item.Builtin, Version: item.Version, UpdatedAt: item.UpdatedAt,
	}
	if err := interior.DecodeJSON(item.TagsJSON, &view.Tags); err != nil {
		view.Tags = []string{}
	}
	if admin {
		view.Prompt = item.Prompt
	}
	return view
}

func interiorModeFromInput(input interior.ModeInput) (model.InteriorMode, error) {
	slots, err := interior.EncodeJSON(input.Slots)
	if err != nil {
		return model.InteriorMode{}, err
	}
	params, err := interior.EncodeJSON(input.Params)
	if err != nil {
		return model.InteriorMode{}, err
	}
	allowed, err := interior.EncodeJSON(input.AllowedModels)
	if err != nil {
		return model.InteriorMode{}, err
	}
	defaultModel := ""
	if input.DefaultModel != nil {
		if defaultModel, err = interior.EncodeJSON(input.DefaultModel); err != nil {
			return model.InteriorMode{}, err
		}
	}
	return model.InteriorMode{
		Key: input.Key, Name: input.Name, Subtitle: input.Subtitle, Description: input.Description, Audience: input.Audience,
		CoverResourceID: input.CoverResource, SlotsJSON: slots, ParamsJSON: params, PromptTemplate: input.PromptTemplate,
		RequiresRoom: input.RequiresRoom, RequiresStyle: input.RequiresStyle, NotesRequired: input.NotesRequired,
		DefaultModelJSON: defaultModel, AllowedModelsJSON: allowed, MaxCount: input.MaxCount, SortOrder: input.SortOrder, Enabled: input.Enabled,
	}, nil
}

func interiorPresetFromInput(input interior.PresetInput) (model.InteriorPreset, error) {
	tags, err := interior.EncodeJSON(input.Tags)
	if err != nil {
		return model.InteriorPreset{}, err
	}
	return model.InteriorPreset{
		Type: input.Type, Key: input.Key, GroupName: input.GroupName, Name: input.Name, Summary: input.Summary,
		CoverResourceID: input.CoverResource, Prompt: input.Prompt, TagsJSON: tags, SortOrder: input.SortOrder, Enabled: input.Enabled,
	}, nil
}

func interiorPresetLabel(presetType string) string {
	if presetType == interior.PresetRoom {
		return "空间"
	}
	return "风格"
}

func interiorVersionConflict(current int) error {
	return &AppError{Status: http.StatusConflict, Code: http.StatusConflict, Reason: "interior_version_conflict", Message: "配置已被其他管理员修改，请刷新后再保存", Details: map[string]any{"version": current}}
}
