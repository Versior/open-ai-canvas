package repository

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var (
	ErrInteriorProjectConflict = errors.New("interior project revision conflict")
	ErrInteriorVersionConflict = errors.New("interior catalog version conflict")
)

func (r *Repository) InteriorModes(enabledOnly bool) ([]model.InteriorMode, error) {
	var items []model.InteriorMode
	query := r.db.Order("sort_order asc").Order("created_at asc")
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *Repository) InteriorMode(id string) (*model.InteriorMode, error) {
	var item model.InteriorMode
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) InteriorModeByKey(key string) (*model.InteriorMode, error) {
	var item model.InteriorMode
	if err := r.db.First(&item, "key = ?", key).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateInteriorMode(item *model.InteriorMode) error {
	return r.db.Create(item).Error
}

// SaveInteriorMode 按版本号比较交换，避免两个管理员窗口互相覆盖。标识、内置标记和创建信息不随保存改变。
func (r *Repository) SaveInteriorMode(item *model.InteriorMode, expectedVersion int) error {
	result := r.db.Model(&model.InteriorMode{}).Where("id = ? AND version = ?", item.ID, expectedVersion).Updates(map[string]any{
		"name": item.Name, "subtitle": item.Subtitle, "description": item.Description, "audience": item.Audience,
		"cover_resource_id": item.CoverResourceID, "slots_json": item.SlotsJSON, "params_json": item.ParamsJSON, "prompt_template": item.PromptTemplate,
		"requires_room": item.RequiresRoom, "requires_style": item.RequiresStyle, "notes_required": item.NotesRequired,
		"default_model_json": item.DefaultModelJSON, "allowed_models_json": item.AllowedModelsJSON, "max_count": item.MaxCount,
		"sort_order": item.SortOrder, "enabled": item.Enabled, "version": item.Version, "updated_by": item.UpdatedBy, "updated_at": item.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInteriorVersionConflict
	}
	return nil
}

func (r *Repository) InteriorPresets(presetType string, enabledOnly bool) ([]model.InteriorPreset, error) {
	var items []model.InteriorPreset
	query := r.db.Order("sort_order asc").Order("created_at asc")
	if presetType != "" {
		query = query.Where("type = ?", presetType)
	}
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *Repository) InteriorPreset(id string) (*model.InteriorPreset, error) {
	var item model.InteriorPreset
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) InteriorPresetsByKeys(presetType string, keys []string) ([]model.InteriorPreset, error) {
	if len(keys) == 0 {
		return []model.InteriorPreset{}, nil
	}
	var items []model.InteriorPreset
	err := r.db.Where("type = ? AND key IN ?", presetType, keys).Find(&items).Error
	return items, err
}

func (r *Repository) CreateInteriorPreset(item *model.InteriorPreset) error {
	return r.db.Create(item).Error
}

func (r *Repository) SaveInteriorPreset(item *model.InteriorPreset, expectedVersion int) error {
	result := r.db.Model(&model.InteriorPreset{}).Where("id = ? AND version = ?", item.ID, expectedVersion).Updates(map[string]any{
		"group_name": item.GroupName, "name": item.Name, "summary": item.Summary, "cover_resource_id": item.CoverResourceID,
		"prompt": item.Prompt, "tags_json": item.TagsJSON, "sort_order": item.SortOrder, "enabled": item.Enabled,
		"version": item.Version, "updated_by": item.UpdatedBy, "updated_at": item.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInteriorVersionConflict
	}
	return nil
}

// EnsureInteriorCatalog 只插入缺失的内置模式和预设，已存在的记录（包括管理员改过的）保持不变。
func (r *Repository) EnsureInteriorCatalog(modes []model.InteriorMode, presets []model.InteriorPreset) (int, error) {
	inserted := 0
	err := r.db.Transaction(func(tx *gorm.DB) error {
		for index := range modes {
			result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoNothing: true}).Create(&modes[index])
			if result.Error != nil {
				return result.Error
			}
			inserted += int(result.RowsAffected)
		}
		for index := range presets {
			result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "type"}, {Name: "key"}}, DoNothing: true}).Create(&presets[index])
			if result.Error != nil {
				return result.Error
			}
			inserted += int(result.RowsAffected)
		}
		return nil
	})
	return inserted, err
}

// InteriorProjects 返回列表所需的字段，不读取项目文档正文。
func (r *Repository) InteriorProjects(userID string, limit int) ([]model.InteriorProject, error) {
	var items []model.InteriorProject
	err := r.db.Select("id", "user_id", "name", "kind", "revision", "created_at", "updated_at").
		Where("user_id = ?", userID).Order("updated_at desc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) InteriorProjectCount(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.InteriorProject{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *Repository) InteriorProject(userID, id string) (*model.InteriorProject, error) {
	var item model.InteriorProject
	if err := r.db.First(&item, "user_id = ? AND id = ?", userID, id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateInteriorProject(item *model.InteriorProject) error {
	return r.db.Create(item).Error
}

// SaveInteriorProject 用修订号做比较交换；调用方负责把 Revision 设为 expected+1。
func (r *Repository) SaveInteriorProject(item *model.InteriorProject, expected int64) error {
	result := r.db.Model(&model.InteriorProject{}).
		Where("user_id = ? AND id = ? AND revision = ?", item.UserID, item.ID, expected).
		Updates(map[string]any{"name": item.Name, "kind": item.Kind, "document_json": item.DocumentJSON, "revision": item.Revision, "updated_at": item.UpdatedAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInteriorProjectConflict
	}
	return nil
}

func (r *Repository) DeleteInteriorProject(userID, id string) (bool, error) {
	result := r.db.Where("user_id = ? AND id = ?", userID, id).Delete(&model.InteriorProject{})
	return result.RowsAffected == 1, result.Error
}

// interiorResourceReferences 把室内项目文档和模式/预设封面加入资源引用快照，删除素材前据此拦截。
func (r *Repository) interiorResourceReferences(userID string, resourceIDs []string, snapshot *ResourceReferenceSnapshot) error {
	if !r.db.Migrator().HasTable(&model.InteriorProject{}) {
		return nil
	}
	// 资源 ID 不多时先按 ID 文本预筛，只读可能引用它们的项目文档；最终是否引用仍由 service 解析 JSON 判定。
	query := r.db.Select("id", "name", "document_json").Where("user_id = ?", userID)
	if len(resourceIDs) <= 100 {
		conditions := make([]string, 0, len(resourceIDs))
		args := make([]any, 0, len(resourceIDs))
		for _, id := range resourceIDs {
			conditions = append(conditions, "document_json LIKE ?")
			args = append(args, "%"+id+"%")
		}
		query = query.Where(strings.Join(conditions, " OR "), args...)
	}
	var projects []model.InteriorProject
	if err := query.Find(&projects).Error; err != nil {
		return err
	}
	for _, project := range projects {
		snapshot.Documents = append(snapshot.Documents, ResourceReferenceDocument{Kind: "室内设计项目", ID: project.ID, Title: project.Name, PrimaryJSON: project.DocumentJSON})
	}
	var modes []model.InteriorMode
	if err := r.db.Select("id", "name", "cover_resource_id").Where("cover_resource_id IN ?", resourceIDs).Find(&modes).Error; err != nil {
		return err
	}
	for _, mode := range modes {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "室内设计模式封面", ID: mode.ID, Title: mode.Name, ResourceID: mode.CoverResourceID})
	}
	var presets []model.InteriorPreset
	if err := r.db.Select("id", "name", "cover_resource_id").Where("cover_resource_id IN ?", resourceIDs).Find(&presets).Error; err != nil {
		return err
	}
	for _, preset := range presets {
		snapshot.Direct = append(snapshot.Direct, ResourceDirectReference{Kind: "室内设计风格/空间封面", ID: preset.ID, Title: preset.Name, ResourceID: preset.CoverResourceID})
	}
	return nil
}

// InteriorKnowledgeEntries 按排序列出知识条目；enabledOnly 时只要启用的（前台取知识用）。
func (r *Repository) InteriorKnowledgeEntries(enabledOnly bool) ([]model.InteriorKnowledgeEntry, error) {
	var items []model.InteriorKnowledgeEntry
	query := r.db.Order("sort_order asc").Order("created_at asc")
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *Repository) InteriorKnowledgeEntry(id string) (*model.InteriorKnowledgeEntry, error) {
	var item model.InteriorKnowledgeEntry
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) InteriorKnowledgeKeyExists(key string) (bool, error) {
	var count int64
	err := r.db.Model(&model.InteriorKnowledgeEntry{}).Where("key = ?", key).Count(&count).Error
	return count > 0, err
}

func (r *Repository) CreateInteriorKnowledgeEntry(item *model.InteriorKnowledgeEntry) error {
	return r.db.Create(item).Error
}

// SaveInteriorKnowledgeEntry 按版本号比较交换保存；标识、内置标记和创建信息不改。
func (r *Repository) SaveInteriorKnowledgeEntry(item *model.InteriorKnowledgeEntry, expectedVersion int) error {
	result := r.db.Model(&model.InteriorKnowledgeEntry{}).Where("id = ? AND version = ?", item.ID, expectedVersion).Updates(map[string]any{
		"kind": item.Kind, "title": item.Title, "guidance": item.Guidance, "scopes_json": item.ScopesJSON, "rooms_json": item.RoomsJSON,
		"styles_json": item.StylesJSON, "tags_json": item.TagsJSON, "sort_order": item.SortOrder, "enabled": item.Enabled, "edited": item.Edited,
		"version": item.Version, "updated_by": item.UpdatedBy, "updated_at": item.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInteriorVersionConflict
	}
	return nil
}

// DeleteInteriorKnowledgeEntry 只删管理员新增的条目，版本号对不上时不删。内置条目只能停用，删了下次启动会补回来。
func (r *Repository) DeleteInteriorKnowledgeEntry(id string, expectedVersion int) error {
	result := r.db.Where("id = ? AND version = ? AND builtin = ?", id, expectedVersion, false).Delete(&model.InteriorKnowledgeEntry{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInteriorVersionConflict
	}
	return nil
}

// EnsureInteriorKnowledge 补齐缺失的内置条目，并把管理员没改过内容的内置条目更新成程序自带的版本
// （启用状态不动）；管理员改过的（edited）保持原样。返回新插入和更新的条数。
func (r *Repository) EnsureInteriorKnowledge(entries []model.InteriorKnowledgeEntry) (inserted int, refreshed int, err error) {
	err = r.db.Transaction(func(tx *gorm.DB) error {
		var existing []model.InteriorKnowledgeEntry
		if err := tx.Where("builtin = ?", true).Find(&existing).Error; err != nil {
			return err
		}
		byKey := make(map[string]model.InteriorKnowledgeEntry, len(existing))
		for _, item := range existing {
			byKey[item.Key] = item
		}
		for index := range entries {
			entry := entries[index]
			current, ok := byKey[entry.Key]
			if !ok {
				result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoNothing: true}).Create(&entries[index])
				if result.Error != nil {
					return result.Error
				}
				inserted += int(result.RowsAffected)
				continue
			}
			if current.Edited || (current.Kind == entry.Kind && current.Title == entry.Title && current.Guidance == entry.Guidance && current.ScopesJSON == entry.ScopesJSON &&
				current.RoomsJSON == entry.RoomsJSON && current.StylesJSON == entry.StylesJSON && current.TagsJSON == entry.TagsJSON && current.SortOrder == entry.SortOrder) {
				continue
			}
			result := tx.Model(&model.InteriorKnowledgeEntry{}).Where("id = ? AND version = ? AND edited = ?", current.ID, current.Version, false).Updates(map[string]any{
				"kind": entry.Kind, "title": entry.Title, "guidance": entry.Guidance, "scopes_json": entry.ScopesJSON, "rooms_json": entry.RoomsJSON,
				"styles_json": entry.StylesJSON, "tags_json": entry.TagsJSON, "sort_order": entry.SortOrder, "version": current.Version + 1, "updated_at": entry.UpdatedAt,
			})
			if result.Error != nil {
				return result.Error
			}
			refreshed += int(result.RowsAffected)
		}
		return nil
	})
	return inserted, refreshed, err
}
