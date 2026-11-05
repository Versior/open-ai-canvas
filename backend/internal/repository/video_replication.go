package repository

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 视频复刻页面的历史：拆解任务按类型倒序列出；模型分析结果存在 results 表，同一任务、同一 kind 只留一条。

func (r *Repository) TasksForUserByType(userID, taskType string, limit int) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Where("user_id = ? AND type = ?", userID, taskType).Order("created_at desc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) TaskResultsByKind(userID string, taskIDs []string, kind string) ([]model.Result, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	var results []model.Result
	err := r.db.Where("user_id = ? AND kind = ? AND task_id IN ?", userID, kind, taskIDs).Order("created_at desc").Find(&results).Error
	return results, err
}

// ReplaceTaskResult 在一个事务里删掉同一任务、同一 kind 的旧结果，再写入新结果。
func (r *Repository) ReplaceTaskResult(result *model.Result) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND task_id = ? AND kind = ?", result.UserID, result.TaskID, result.Kind).Delete(&model.Result{}).Error; err != nil {
			return err
		}
		return tx.Create(result).Error
	})
}
