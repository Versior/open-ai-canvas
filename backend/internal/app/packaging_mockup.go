package app

import (
	"encoding/json"
	"slices"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type packagingMockupMetadata struct {
	Source       string `json:"source"`
	ProjectID    string `json:"packagingProjectId"`
	Revision     int64  `json:"packagingRevision"`
	ReferenceID  string `json:"packagingReferenceId"`
	Scene        string `json:"packagingScene"`
	ParentTaskID string `json:"packagingParentTaskId"`
}

func (s *Service) requirePackagingMockupTask(userID, taskType string, input map[string]any) error {
	metadata, _ := input["metadata"].(map[string]any)
	marked := stringValue(metadata["source"]) == "packaging-mockup"
	for _, key := range []string{"packagingProjectId", "packagingRevision", "packagingReferenceId", "packagingScene", "packagingParentTaskId"} {
		if _, exists := metadata[key]; exists {
			marked = true
		}
	}
	if !marked {
		return nil
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return BadAuthRequest("包装效果图请求格式无效")
	}
	var request struct {
		Mode   string `json:"mode"`
		Config struct {
			Count string `json:"count"`
		} `json:"config"`
		Metadata   packagingMockupMetadata `json:"metadata"`
		References []struct {
			StorageKey string `json:"storageKey"`
		} `json:"referenceImages"`
	}
	if json.Unmarshal(raw, &request) != nil || request.Metadata.Source != "packaging-mockup" || taskType != "canvas_image" || request.Mode != "image" || request.Metadata.ProjectID == "" || request.Metadata.Revision < 1 || request.Metadata.ReferenceID == "" || len(request.References) != 1 || request.References[0].StorageKey != "resource:"+request.Metadata.ReferenceID || request.Config.Count != "1" || !slices.Contains([]string{"studio", "campaign", "lifestyle", "detail", "design"}, request.Metadata.Scene) {
		return BadAuthRequest("包装效果图须关联已保存项目版本，并提供一张当前包装预览资源")
	}
	actor := &model.User{ID: userID}
	project, err := s.PackagingProject(actor, request.Metadata.ProjectID, false)
	if err != nil {
		return err
	}
	if project.Revision != request.Metadata.Revision {
		return &kernel.AppError{Status: 409, Code: 409, Message: "包装项目版本已更新，请重新截取预览后生成", Reason: "packaging_project_conflict"}
	}
	resource, err := s.Resource(userID, request.Metadata.ReferenceID)
	if err != nil {
		return NotFound("包装参考图不存在或不属于当前用户")
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return BadAuthRequest("包装参考图必须是已就绪的图片资源")
	}
	if request.Metadata.ParentTaskID != "" {
		parent, err := s.repo.TaskForUser(userID, request.Metadata.ParentTaskID)
		if err != nil {
			return NotFound("原包装效果图任务不存在")
		}
		var input struct {
			Metadata packagingMockupMetadata `json:"metadata"`
		}
		var output struct {
			Images []struct {
				StorageKey string `json:"storageKey"`
			} `json:"images"`
		}
		if json.Unmarshal([]byte(parent.InputJSON), &input) != nil || json.Unmarshal([]byte(parent.ResultJSON), &output) != nil || parent.Type != "canvas_image" || parent.Status != model.TaskStatusSucceeded || input.Metadata.Source != "packaging-mockup" || input.Metadata.ProjectID != project.ID || input.Metadata.Revision != project.Revision || !slices.ContainsFunc(output.Images, func(image struct {
			StorageKey string `json:"storageKey"`
		}) bool {
			return image.StorageKey == "resource:"+resource.ID
		}) {
			return BadAuthRequest("继续修改须使用此包装版本的已完成效果图")
		}
	}
	catalog, err := s.PackagingCatalog(actor, false)
	if err != nil {
		return err
	}
	if !catalog.Enabled || !catalog.MockupEnabled {
		return Forbidden("包装效果图生成暂未开放，历史结果仍可查看")
	}
	return nil
}

type PackagingMockupTask struct {
	TaskSummary
	Revision          int64    `json:"packagingRevision"`
	ReferenceID       string   `json:"referenceResourceId"`
	Scene             string   `json:"scene"`
	ParentTaskID      string   `json:"parentTaskId,omitempty"`
	OutputResourceIDs []string `json:"outputResourceIds"`
}

type PackagingMockupPage struct {
	Items    []PackagingMockupTask `json:"items"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"pageSize"`
}

func (s *Service) PackagingMockups(actor *model.User, projectID string, admin bool, page, size int) (*PackagingMockupPage, error) {
	project, err := s.PackagingProject(actor, projectID, admin)
	if err != nil {
		return nil, err
	}
	page, size = max(1, page), min(30, max(1, size))
	tasks, total, err := s.repo.PackagingMockupTasks(project.UserID, projectID, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(project.UserID, taskBillingTaskIDs(tasks))
	if err != nil {
		return nil, err
	}
	summaries := taskSummariesForOutputWithBilling(tasks, orders)
	result := &PackagingMockupPage{Items: []PackagingMockupTask{}, Total: total, Page: page, PageSize: size}
	for index, task := range tasks {
		var input struct {
			Metadata packagingMockupMetadata `json:"metadata"`
		}
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return nil, err
		}
		var output struct {
			Images []struct {
				StorageKey string `json:"storageKey"`
			} `json:"images"`
		}
		if task.ResultJSON != "" {
			if err := json.Unmarshal([]byte(task.ResultJSON), &output); err != nil {
				return nil, err
			}
		}
		ids := []string{}
		for _, image := range output.Images {
			if strings.HasPrefix(image.StorageKey, "resource:") {
				ids = append(ids, strings.TrimPrefix(image.StorageKey, "resource:"))
			}
		}
		result.Items = append(result.Items, PackagingMockupTask{TaskSummary: summaries[index], Revision: input.Metadata.Revision, ReferenceID: input.Metadata.ReferenceID, Scene: input.Metadata.Scene, ParentTaskID: input.Metadata.ParentTaskID, OutputResourceIDs: ids})
	}
	return result, nil
}
