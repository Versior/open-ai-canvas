package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 以下给后台的室内设计管理用：跨用户列出、统计室内设计页提交的生图任务。权限由 service 校验。
// 任务表没有来源列，室内设计任务按输入里的 metadata.source（interior-design）认；
// 输入是服务端 json.Marshal 写的紧凑 JSON，键值之间没有空格。

const interiorTaskInputPattern = `%"source":"interior-design"%`

// AdminInteriorTaskFilter 是后台列室内设计任务的筛选；ModeKey 必须是已校验过的机器标识。
type AdminInteriorTaskFilter struct {
	Status  model.TaskStatus
	Keyword string
	ModeKey string
	Limit   int
	Offset  int
}

// InteriorProjectTotals 是室内设计项目的数量：全部、我的房子、客户方案和建过项目的人数。
type InteriorProjectTotals struct {
	Total  int64
	Home   int64
	Client int64
	Users  int64
}

func (r *Repository) interiorTasks() *gorm.DB {
	return r.db.Model(&model.Task{}).Where("type = ? AND input_json LIKE ?", "canvas_image", interiorTaskInputPattern)
}

// adminTaskKeyword 按用户名、昵称、邮箱（包含匹配）或完整任务 ID 筛选任务；关键字里的 % 和 _ 按字面匹配。
func (r *Repository) adminTaskKeyword(query *gorm.DB, keyword string) *gorm.DB {
	value := strings.TrimSpace(keyword)
	if value == "" {
		return query
	}
	pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(value)) + "%"
	users := r.db.Model(&model.User{}).Select("id").Where(`lower(username) LIKE ? ESCAPE '\' OR lower(display_name) LIKE ? ESCAPE '\' OR lower(email) LIKE ? ESCAPE '\'`, pattern, pattern, pattern)
	return query.Where("(user_id IN (?) OR id = ?)", users, value)
}

// AdminInteriorTasks 按时间倒序分页列出所有用户的室内设计任务，带输入原文（由 service 解析出模式、风格和原图）。
func (r *Repository) AdminInteriorTasks(filter AdminInteriorTaskFilter) ([]model.Task, int64, error) {
	query := r.interiorTasks()
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.ModeKey != "" {
		query = query.Where("input_json LIKE ?", `%"modeKey":"`+filter.ModeKey+`"%`)
	}
	query = r.adminTaskKeyword(query, filter.Keyword)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []model.Task
	err := query.Select("id", "user_id", "status", "stage", "progress", "model", "input_json", "result_json", "error", "started_at", "completed_at", "created_at", "updated_at").
		Order("created_at desc, id desc").Limit(filter.Limit).Offset(filter.Offset).Find(&tasks).Error
	return tasks, total, err
}

// AdminInteriorTask 读一条任意用户的室内设计任务；不是室内设计任务时返回 gorm.ErrRecordNotFound。
func (r *Repository) AdminInteriorTask(id string) (*model.Task, error) {
	var task model.Task
	if err := r.interiorTasks().Where("id = ?", id).First(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

// InteriorTasksSince 取某时刻之后新建的室内设计任务（最新的在前，最多 limit 条），只带统计要用的列。
func (r *Repository) InteriorTasksSince(from time.Time, limit int) ([]model.Task, error) {
	var tasks []model.Task
	err := r.interiorTasks().Where("created_at >= ?", from).
		Select("id", "user_id", "status", "model", "input_json", "error", "created_at").
		Order("created_at desc, id desc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) InteriorProjectTotals() (InteriorProjectTotals, error) {
	var rows []struct {
		Kind  string
		Count int64
	}
	if err := r.db.Model(&model.InteriorProject{}).Select("kind, count(*) as count").Group("kind").Scan(&rows).Error; err != nil {
		return InteriorProjectTotals{}, err
	}
	var totals InteriorProjectTotals
	for _, row := range rows {
		totals.Total += row.Count
		switch row.Kind {
		case "home":
			totals.Home += row.Count
		case "client":
			totals.Client += row.Count
		}
	}
	err := r.db.Model(&model.InteriorProject{}).Distinct("user_id").Count(&totals.Users).Error
	return totals, err
}

// InteriorProjectNames 按 ID 取一批项目的名称，不限用户。
func (r *Repository) InteriorProjectNames(ids []string) (map[string]string, error) {
	names := map[string]string{}
	if len(ids) == 0 {
		return names, nil
	}
	var rows []model.InteriorProject
	if err := r.db.Model(&model.InteriorProject{}).Select("id", "name").Where("id IN ?", uniqueStrings(ids)).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		names[row.ID] = row.Name
	}
	return names, nil
}
