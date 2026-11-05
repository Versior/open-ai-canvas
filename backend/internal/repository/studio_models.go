package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// StudioModelQuery 是模特库列表的筛选条件；EnabledOnly 给用户端用，后台默认列出全部，
// 也可以用 EnabledOnly / DisabledOnly 只看已上架或未上架的。
type StudioModelQuery struct {
	Kind         string
	Query        string
	Category     string
	Gender       string
	EnabledOnly  bool
	DisabledOnly bool
	Offset       int
	Limit        int
}

// StudioModelCount 是按类型或分类汇总的素材条数。
type StudioModelCount struct {
	Name  string
	Count int64
}

func (r *Repository) studioModelScope(query StudioModelQuery) *gorm.DB {
	db := r.db.Model(&model.StudioModelAsset{}).Where("kind = ?", query.Kind)
	if query.EnabledOnly {
		db = db.Where("enabled = ?", true)
	}
	if query.DisabledOnly {
		db = db.Where("enabled = ?", false)
	}
	if query.Category != "" {
		db = db.Where("category = ?", query.Category)
	}
	if query.Gender != "" {
		db = db.Where("gender = ?", query.Gender)
	}
	if text := strings.TrimSpace(query.Query); text != "" {
		like := "%" + escapeLike(text) + "%"
		db = db.Where(`(name LIKE ? ESCAPE '\' OR category LIKE ? ESCAPE '\' OR tags_json LIKE ? ESCAPE '\' OR prompt LIKE ? ESCAPE '\')`, like, like, like, like)
	}
	return db
}

func (r *Repository) StudioModelAssets(query StudioModelQuery) ([]model.StudioModelAsset, int64, error) {
	var total int64
	if err := r.studioModelScope(query).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []model.StudioModelAsset{}
	err := r.studioModelScope(query).Order("sort_order asc, created_at desc, id asc").Offset(query.Offset).Limit(query.Limit).Find(&items).Error
	return items, total, err
}

func (r *Repository) StudioModelCategories(kind string, enabledOnly bool) ([]string, error) {
	categories := []string{}
	db := r.db.Model(&model.StudioModelAsset{}).Where("kind = ? AND category <> ''", kind)
	if enabledOnly {
		db = db.Where("enabled = ?", true)
	}
	err := db.Distinct("category").Order("category asc").Pluck("category", &categories).Error
	return categories, err
}

// StudioModelKindCounts 是每种素材的总条数，后台类型页签用。
func (r *Repository) StudioModelKindCounts() ([]StudioModelCount, error) {
	counts := []StudioModelCount{}
	err := r.db.Model(&model.StudioModelAsset{}).Select("kind AS name, COUNT(*) AS count").Group("kind").Scan(&counts).Error
	return counts, err
}

// StudioModelCategoryCounts 是某种素材每个分类的条数（不含未分类），条数多的在前，后台分类筛选用。
func (r *Repository) StudioModelCategoryCounts(kind string) ([]StudioModelCount, error) {
	counts := []StudioModelCount{}
	err := r.db.Model(&model.StudioModelAsset{}).Select("category AS name, COUNT(*) AS count").Where("kind = ? AND category <> ''", kind).Group("category").Order("COUNT(*) DESC, category ASC").Scan(&counts).Error
	return counts, err
}

func (r *Repository) StudioModelAsset(id string) (*model.StudioModelAsset, error) {
	var item model.StudioModelAsset
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) StudioModelAssetsByIDs(ids []string) ([]model.StudioModelAsset, error) {
	items := []model.StudioModelAsset{}
	if len(ids) == 0 {
		return items, nil
	}
	err := r.db.Where("id IN ?", ids).Find(&items).Error
	return items, err
}

// StudioModelAssetsByResourceIDs 找出用到这些资源（原图或缩略图）的素材，供删除保护使用。
func (r *Repository) StudioModelAssetsByResourceIDs(resourceIDs []string) ([]model.StudioModelAsset, error) {
	items := []model.StudioModelAsset{}
	if len(resourceIDs) == 0 {
		return items, nil
	}
	err := r.db.Where("resource_id IN ? OR thumb_resource_id IN ?", resourceIDs, resourceIDs).Find(&items).Error
	return items, err
}

func (r *Repository) CreateStudioModelAsset(item *model.StudioModelAsset) error {
	return r.db.Create(item).Error
}

func (r *Repository) SaveStudioModelAsset(item *model.StudioModelAsset) error {
	return r.db.Save(item).Error
}

// SetStudioModelAssetsEnabled 批量上下架，一个事务内完成。
func (r *Repository) SetStudioModelAssetsEnabled(ids []string, enabled bool, actorID string) (int64, error) {
	result := r.db.Model(&model.StudioModelAsset{}).Where("id IN ?", ids).Updates(map[string]any{"enabled": enabled, "updated_by": actorID, "updated_at": time.Now()})
	return result.RowsAffected, result.Error
}

func (r *Repository) DeleteStudioModelAssets(ids []string) (int64, error) {
	result := r.db.Where("id IN ?", ids).Delete(&model.StudioModelAsset{})
	return result.RowsAffected, result.Error
}
