package repository

import (
	"strings"
	"time"

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

// 以下给后台的视频复刻管理用：跨用户列出、统计某类任务。权限由 service 校验。

// AdminTypedTaskFilter 是后台按任务类型列任务的筛选；Keyword 匹配用户名、昵称、邮箱，或完整的任务 ID。
type AdminTypedTaskFilter struct {
	Type    string
	Status  model.TaskStatus
	Keyword string
	Limit   int
	Offset  int
}

func (r *Repository) AdminTasksByType(filter AdminTypedTaskFilter) ([]model.Task, int64, error) {
	query := r.db.Model(&model.Task{}).Where("type = ?", filter.Type)
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if value := strings.TrimSpace(filter.Keyword); value != "" {
		// 关键字里的 % 和 _ 按字面匹配，不当通配符。
		pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(value)) + "%"
		users := r.db.Model(&model.User{}).Select("id").Where(`lower(username) LIKE ? ESCAPE '\' OR lower(display_name) LIKE ? ESCAPE '\' OR lower(email) LIKE ? ESCAPE '\'`, pattern, pattern, pattern)
		query = query.Where("(user_id IN (?) OR id = ?)", users, value)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []model.Task
	err := query.Select("id", "user_id", "project_id", "type", "status", "stage", "progress", "provider", "model", "result_json", "error", "attempts", "started_at", "completed_at", "created_at", "updated_at").
		Order("created_at desc, id desc").Limit(filter.Limit).Offset(filter.Offset).Find(&tasks).Error
	return tasks, total, err
}

// ResultsByKindForTasks 取一批任务的某种结果，不限用户；按时间倒序，同一任务的最新一条在前。
func (r *Repository) ResultsByKindForTasks(taskIDs []string, kind string) ([]model.Result, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	var results []model.Result
	err := r.db.Where("kind = ? AND task_id IN ?", kind, taskIDs).Order("created_at desc").Find(&results).Error
	return results, err
}

// TaskGroupCount 是按类型、状态、provider 分组的任务数。
type TaskGroupCount struct {
	Type     string
	Status   model.TaskStatus
	Provider string
	Count    int64
}

func (r *Repository) TaskCountsByTypeStatusProvider(types []string) ([]TaskGroupCount, error) {
	var rows []TaskGroupCount
	err := r.db.Model(&model.Task{}).Select("type, status, provider, COUNT(*) AS count").Where("type IN ?", types).Group("type, status, provider").Scan(&rows).Error
	return rows, err
}

func (r *Repository) DistinctTaskUserCount(taskType string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Task{}).Where("type = ?", taskType).Distinct("user_id").Count(&count).Error
	return count, err
}

// CountTasksWithResult 数某类任务里有多少个存过某种结果。从任务表按类型连过去：走 tasks.type 和 results.task_id
// 的索引，不扫整张 results 表，任务行已经不在的孤立结果也不计入。
func (r *Repository) CountTasksWithResult(taskType, kind string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Result{}).Joins("JOIN tasks ON tasks.id = results.task_id").Where("tasks.type = ? AND results.kind = ?", taskType, kind).Distinct("results.task_id").Count(&count).Error
	return count, err
}

// TasksByTypesBetween 取一段时间内创建的某几类任务，只带统计用的列。
func (r *Repository) TasksByTypesBetween(types []string, from, to time.Time) ([]model.Task, error) {
	var tasks []model.Task
	query := whereTimeRange(r.db.Model(&model.Task{}).Select("id", "type", "status", "provider", "created_at"), "created_at", from, to)
	err := query.Where("type IN ?", types).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) RecentFailedTasksByTypes(types []string, limit int) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Select("id", "user_id", "type", "status", "stage", "provider", "error", "created_at", "completed_at").
		Where("type IN ? AND status = ?", types, model.TaskStatusFailed).Order("created_at desc, id desc").Limit(limit).Find(&tasks).Error
	return tasks, err
}
