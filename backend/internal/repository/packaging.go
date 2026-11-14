package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
	"yingce/backend/internal/model"
)

var ErrPackagingConflict = errors.New("packaging revision conflict")
var ErrPackagingQuota = errors.New("packaging project quota reached")
var ErrPackagingResource = errors.New("图稿不存在、尚未就绪或不属于当前用户")

func (r *Repository) PackagingProjects(userID, templateID string, page, pageSize int) ([]model.PackagingProject, int64, error) {
	query := r.db.Model(&model.PackagingProject{})
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if templateID != "" {
		query = query.Where("template_id = ?", templateID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	items := []model.PackagingProject{}
	err := query.Select("id", "user_id", "name", "template_id", "revision", "created_at", "updated_at").Order("updated_at DESC, id ASC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&items).Error
	return items, count, err
}

func (r *Repository) PackagingProject(userID, id string) (*model.PackagingProject, error) {
	var item model.PackagingProject
	query := r.db.Where("id = ?", id)
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) SavePackagingProject(item *model.PackagingProject, expected int64, refs []string, limit int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 与上传清理及管理员资源删除使用同一资源行锁，阻止引用写入与物理删除交错。
		if len(refs) > 0 {
			var resources []model.Resource
			q := tx.Where("id IN ? AND user_id = ? AND status = ? AND kind = ?", refs, item.UserID, model.ResourceStatusReady, "image")
			if tx.Dialector.Name() == "postgres" {
				q = q.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := q.Find(&resources).Error; err != nil {
				return err
			}
			if len(resources) != len(refs) {
				return ErrPackagingResource
			}
		}
		if expected == 0 {
			// 锁用户行使跨实例的新建配额检查串行，SQLite 的写事务由数据库串行处理。
			var user model.User
			q := tx.Where("id = ?", item.UserID)
			if tx.Dialector.Name() == "postgres" {
				q = q.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := q.First(&user).Error; err != nil {
				return err
			}
			var count int64
			if err := tx.Model(&model.PackagingProject{}).Where("user_id = ?", item.UserID).Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(limit) {
				return ErrPackagingQuota
			}
			if err := tx.Create(item).Error; err != nil {
				return err
			}
		}
		if expected > 0 {
			result := tx.Model(&model.PackagingProject{}).Where("id = ? AND user_id = ? AND revision = ?", item.ID, item.UserID, expected).Updates(map[string]any{"name": item.Name, "template_id": item.TemplateID, "document_json": item.DocumentJSON, "revision": item.Revision, "updated_at": item.UpdatedAt})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrPackagingConflict
			}
		}
		if err := tx.Where("project_id = ?", item.ID).Delete(&model.PackagingProjectResource{}).Error; err != nil {
			return err
		}
		for _, id := range refs {
			if err := tx.Create(&model.PackagingProjectResource{ProjectID: item.ID, ResourceID: id}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) DeletePackagingProject(userID, id string, expected int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND user_id = ? AND revision = ?", id, userID, expected).Delete(&model.PackagingProject{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPackagingConflict
		}
		return tx.Where("project_id = ?", id).Delete(&model.PackagingProjectResource{}).Error
	})
}

type PackagingStats struct {
	Projects   int64 `json:"projects"`
	Users      int64 `json:"users"`
	Last7Days  int64 `json:"last7Days"`
	ByTemplate []struct {
		TemplateID string `json:"templateId"`
		Total      int64  `json:"total"`
	} `json:"byTemplate"`
}

func (r *Repository) PackagingStats() (PackagingStats, error) {
	result := PackagingStats{}
	q := r.db.Model(&model.PackagingProject{})
	if err := q.Count(&result.Projects).Error; err != nil {
		return result, err
	}
	if err := r.db.Model(&model.PackagingProject{}).Distinct("user_id").Count(&result.Users).Error; err != nil {
		return result, err
	}
	if err := r.db.Model(&model.PackagingProject{}).Where("created_at >= ?", time.Now().UTC().AddDate(0, 0, -7)).Count(&result.Last7Days).Error; err != nil {
		return result, err
	}
	err := r.db.Model(&model.PackagingProject{}).Select("template_id, COUNT(*) AS total").Group("template_id").Order("total DESC").Scan(&result.ByTemplate).Error
	return result, err
}

func (r *Repository) PackagingResourceReferences(ids []string) ([]ResourceDirectReference, error) {
	items := []ResourceDirectReference{}
	if !r.db.Migrator().HasTable(&model.PackagingProjectResource{}) {
		return items, nil
	}
	err := r.db.Table("packaging_project_resources AS refs").Select("'包装刀板' AS kind, p.id, p.name AS title, refs.resource_id").Joins("JOIN packaging_projects AS p ON p.id = refs.project_id").Where("refs.resource_id IN ?", ids).Scan(&items).Error
	return items, err
}
