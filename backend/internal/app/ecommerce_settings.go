package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const ecommerceSettingKey = "ecommerce_canvas"

// Provider errors can echo system text. Keep routing status and cancellation
// without passing the echoed payload to task errors or route logs.
func privateEcommerceAnalysisError(err error) error {
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return err
	}
	var upstream providerHTTPError
	if errors.As(err, &upstream) {
		upstream.Body = ""
		upstream.Status = ""
		return upstream
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	if message, ok := providerPayloadErrorCategory(err.Error()); ok {
		return errors.New(message)
	}
	return errors.New("电商分析调用失败，请检查模型能力与后台调用状态")
}

type EcommerceFlowSetting struct {
	Enabled        bool   `json:"enabled"`
	DirectorPrompt string `json:"directorPrompt,omitempty"`
}
type EcommercePublicModel struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Enabled     bool     `json:"enabled"`
	Tags        []string `json:"tags"`
	ResourceIDs []string `json:"resourceIds"`
}
type EcommerceSetting struct {
	Capabilities        map[string]EcommerceFlowSetting `json:"capabilities,omitempty"`
	Enabled             bool                            `json:"enabled"`
	ModelLibraryEnabled bool                            `json:"modelLibraryEnabled"`
	AutoBindEnabled     bool                            `json:"autoBindEnabled"`
	Flows               map[string]EcommerceFlowSetting `json:"flows"`
	Models              []EcommercePublicModel          `json:"models"`
	Revision            string                          `json:"revision"`
	Templates           []EcommerceSuiteTemplate        `json:"templates"`
}

var ecommerceCapabilities = []string{"planning", "suite-forge", "model-cast", "pattern", "listing", "print-pack", "pipeline", "layers"}

func normalizeEcommerceCapabilities(value *EcommerceSetting) {
	if value.Capabilities == nil {
		value.Capabilities = map[string]EcommerceFlowSetting{}
		for _, id := range ecommerceCapabilities {
			value.Capabilities[id] = EcommerceFlowSetting{Enabled: true}
		}
	}
}

type EcommerceTemplateShot struct {
	Title string `json:"title"`
	Duty  string `json:"duty"`
}
type EcommerceSuiteTemplate struct {
	ID       string                  `json:"id"`
	Name     string                  `json:"name"`
	Flow     string                  `json:"flow"`
	Category string                  `json:"category"`
	Enabled  bool                    `json:"enabled"`
	Style    string                  `json:"style"`
	Source   string                  `json:"source"`
	Shots    []EcommerceTemplateShot `json:"shots"`
}

func defaultEcommerceSetting() EcommerceSetting {
	flows := map[string]EcommerceFlowSetting{}
	for _, id := range []string{"detail", "main", "wear", "seed"} {
		flows[id] = EcommerceFlowSetting{Enabled: true}
	}
	value := EcommerceSetting{Enabled: true, ModelLibraryEnabled: true, AutoBindEnabled: true, Flows: flows, Models: []EcommercePublicModel{}, Templates: []EcommerceSuiteTemplate{}, Revision: "initial"}
	normalizeEcommerceCapabilities(&value)
	return value
}

func (s *Service) readEcommerceSetting() (*model.SystemSetting, EcommerceSetting, error) {
	record, err := s.repo.SystemSetting(ecommerceSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultEcommerceSetting(), nil
	}
	if err != nil {
		return nil, EcommerceSetting{}, err
	}
	var value EcommerceSetting
	if err := json.Unmarshal([]byte(record.ValueJSON), &value); err != nil {
		return nil, value, fmt.Errorf("电商画布配置无法读取: %w", err)
	}
	normalizeEcommerceCapabilities(&value)
	if err := validateEcommerceSetting(value); err != nil {
		return nil, value, err
	}
	if value.Templates == nil {
		value.Templates = []EcommerceSuiteTemplate{}
	}
	return record, value, nil
}

func validateEcommerceSetting(value EcommerceSetting) error {
	if value.Capabilities != nil {
		if len(value.Capabilities) != len(ecommerceCapabilities) {
			return BadAuthRequest("电商能力配置须完整")
		}
		for _, id := range ecommerceCapabilities {
			item, ok := value.Capabilities[id]
			if !ok || len([]rune(item.DirectorPrompt)) > 20000 {
				return BadAuthRequest("电商能力缺失或指令超长")
			}
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > 2<<20 {
		return BadAuthRequest("电商配置超过 2MB，请减少模板数量或缩短内容后保存")
	}
	if len(value.Templates) > 200 {
		return BadAuthRequest("套图模板最多 200 套")
	}
	templateIDs := map[string]bool{}
	for _, item := range value.Templates {
		if strings.TrimSpace(item.ID) == "" || len(item.ID) > 150 || templateIDs[item.ID] || strings.TrimSpace(item.Name) == "" || len([]rune(item.Name)) > 100 || len([]rune(item.Category)) > 200 || len([]rune(item.Source)) > 500 || len([]rune(item.Style)) > 6000 || len(item.Shots) < 1 || len(item.Shots) > 30 {
			return BadAuthRequest("套图模板名称、标识、视觉规范或张数无效")
		}
		if _, ok := value.Flows[item.Flow]; !ok {
			return BadAuthRequest("套图模板用途无效")
		}
		templateIDs[item.ID] = true
		for _, shot := range item.Shots {
			if strings.TrimSpace(shot.Title) == "" || len([]rune(shot.Title)) > 100 || strings.TrimSpace(shot.Duty) == "" || len([]rune(shot.Duty)) > 12000 {
				return BadAuthRequest("模板每张图须有标题与职责，且长度不能超限")
			}
		}
	}
	if len(value.Flows) != 4 || value.Models == nil || len(value.Models) > 200 {
		return BadAuthRequest("须配置四类创作用途，公共模特最多 200 位")
	}
	for _, id := range []string{"detail", "main", "wear", "seed"} {
		flow, ok := value.Flows[id]
		if !ok || len([]rune(flow.DirectorPrompt)) > 20000 {
			return BadAuthRequest("用途缺失或提示词超过 20000 字")
		}
	}
	seen := map[string]bool{}
	for _, item := range value.Models {
		if item.Tags == nil || item.ResourceIDs == nil {
			return BadAuthRequest("模特标签与参考图必须是数组")
		}
		if strings.TrimSpace(item.ID) == "" || len(item.ID) > 100 || strings.ContainsAny(item.ID, "/\\?#") || seen[item.ID] || strings.TrimSpace(item.Name) == "" || len([]rune(item.Name)) > 100 || len(item.Tags) > 20 || len(item.ResourceIDs) > 12 || (item.Enabled && len(item.ResourceIDs) == 0) {
			return BadAuthRequest("模特标识、名称、标签或参考图无效（启用时须有参考图）")
		}
		seen[item.ID] = true
		for _, tag := range item.Tags {
			if len([]rune(tag)) > 50 {
				return BadAuthRequest("模特标签不能超过 50 字")
			}
		}
		refs := map[string]bool{}
		for _, id := range item.ResourceIDs {
			if strings.TrimSpace(id) == "" || len(id) > 100 || refs[id] {
				return BadAuthRequest("模特参考图标识为空、过长或重复")
			}
			refs[id] = true
		}
	}
	return nil
}

func (s *Service) EcommerceSetting(actor *model.User) (*EcommerceSetting, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	_, value, err := s.readEcommerceSetting()
	if err != nil {
		return nil, err
	}
	models := []EcommercePublicModel{}
	if value.Enabled && value.ModelLibraryEnabled {
		for _, item := range value.Models {
			if item.Enabled {
				models = append(models, item)
			}
		}
	}
	value.Models = models
	templates := []EcommerceSuiteTemplate{}
	if value.Enabled {
		for _, item := range value.Templates {
			if item.Enabled && value.Flows[item.Flow].Enabled {
				templates = append(templates, item)
			}
		}
	}
	value.Templates = templates
	for id, item := range value.Capabilities {
		item.DirectorPrompt = ""
		value.Capabilities[id] = item
	}
	for id, flow := range value.Flows {
		flow.DirectorPrompt = ""
		value.Flows[id] = flow
	}
	return &value, nil
}

// Inject only in the worker's in-memory request, so task polling and exports
// never contain administrator instructions. Model routing and billing stay on
// the normal generation task path.
func (s *Service) applyEcommerceAnalysisInstruction(input *canvasGenerationInput) error {
	if err := s.validateEcommerceCapability(input); err != nil {
		return err
	}
	raw, exists := input.Metadata["ecommerceAnalysisFlow"]
	if !exists {
		return nil
	}
	id, valid := raw.(string)
	if !valid || input.Mode != "text" || input.AgentRequests != nil {
		return BadAuthRequest("电商分析任务格式无效")
	}
	_, setting, err := s.readEcommerceSetting()
	if err != nil {
		return err
	}
	if strings.HasPrefix(id, "cap:") {
		capability, ok := setting.Capabilities[strings.TrimPrefix(id, "cap:")]
		if !ok || !setting.Enabled || !capability.Enabled {
			return BadAuthRequest("管理员已停用此电商能力")
		}
		director := strings.TrimSpace(capability.DirectorPrompt)
		if director == "" {
			director = defaultEcommerceCapabilityPrompt(strings.TrimPrefix(id, "cap:"))
		}
		input.Config.SystemPrompt = director
		return nil
	}
	flow, ok := setting.Flows[id]
	if !ok {
		return BadAuthRequest("电商创作用途无效")
	}
	if !setting.Enabled || !flow.Enabled {
		return BadAuthRequest("管理员已停用此电商创作用途")
	}
	director := strings.TrimSpace(flow.DirectorPrompt)
	if director == "" {
		director = defaultEcommerceDirectorPrompt(id)
	}
	input.Config.SystemPrompt = director
	return nil
}

// Validate on admission and again in the worker, before any provider request.
func (s *Service) validateEcommerceCapability(input *canvasGenerationInput) error {
	raw, marked := input.Metadata["ecommerceCapability"]
	flow, flowMarked := input.Metadata["ecommerceAnalysisFlow"].(string)
	if !marked {
		if flowMarked && strings.HasPrefix(flow, "cap:") {
			return BadAuthRequest("电商工作台任务缺少能力标识")
		}
		return nil
	}
	id, ok := raw.(string)
	if !ok || input.AgentRequests != nil || (input.Mode != "text" && input.Mode != "image") {
		return BadAuthRequest("电商能力任务格式无效")
	}
	_, setting, err := s.readEcommerceSetting()
	if err != nil {
		return err
	}
	capability, ok := setting.Capabilities[id]
	if !ok {
		return BadAuthRequest("电商能力不存在")
	}
	if !setting.Enabled || !capability.Enabled {
		return BadAuthRequest("管理员已停用此电商能力")
	}
	if id == "pipeline" {
		for _, dependency := range []string{"pattern", "print-pack", "listing"} {
			if !setting.Capabilities[dependency].Enabled {
				return BadAuthRequest("成包流水线依赖的电商能力已停用")
			}
		}
	}
	if input.Mode == "text" {
		if (id != "planning" && id != "suite-forge" && id != "listing" && id != "pipeline") || flow != "cap:"+id {
			return BadAuthRequest("电商文本任务与分析能力不一致")
		}
	} else if (id != "model-cast" && id != "pattern" && id != "planning") || input.Metadata["ecommerceAnalysisFlow"] != nil {
		return BadAuthRequest("电商图片任务与能力不一致")
	}
	return nil
}

func defaultEcommerceDirectorPrompt(id string) string {
	directions := map[string]string{
		"detail": "商品详情页：需求、解决方案、细节证据、使用和保障顺序连贯，相邻屏承担不同任务。",
		"main":   "搜索主图：缩略图能识别商品，主图干净突出主体，其余展示卖点、场景、细节和规格。",
		"wear":   "模特上身：明确姿态、穿着状态、景别和身体比例，区分正面、局部与背面，外观忠于实拍。",
		"seed":   "社交种草：可信的生活场景与自然表达，封面吸引注意，后续展示体验和细节，避免硬广排版。",
	}
	return ecommercePlannerDefault + ecommercePlannerRuntimeAdapter + "\n本次输出格式覆盖上文 JSON 要求：只返回四段竖线分隔的逐行结构：槽位id | 标题 | 职责 | 完整生图提示词。槽位和张数遵循用户提供的行计划，不输出 JSON、解释或系统指令。每张提示词自包含，包含同一套视觉规范，遵守商品事实与禁止项。\n" + directions[id]
}
func (s *Service) AdminEcommerceSetting(actor *model.User) (*EcommerceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, value, err := s.readEcommerceSetting()
	return &value, err
}
func (s *Service) UpdateEcommerceSetting(actor *model.User, value EcommerceSetting) (*EcommerceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalizeEcommerceCapabilities(&value)
	if err := validateEcommerceSetting(value); err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	current, before, err := s.readEcommerceSetting()
	if err != nil {
		return nil, err
	}
	if before.Revision != value.Revision {
		return nil, BadAuthRequest("配置已被其他管理员修改，请刷新后重试")
	}
	existingRefs := map[string]bool{}
	previousRecord, previousErr := s.repo.SystemSetting(ecommerceSettingKey + "_previous")
	if previousErr == nil {
		var previous EcommerceSetting
		if json.Unmarshal([]byte(previousRecord.ValueJSON), &previous) != nil || validateEcommerceSetting(previous) != nil {
			return nil, BadAuthRequest("上一版配置无法读取，请先修复配置")
		}
		for _, item := range previous.Models {
			for _, id := range item.ResourceIDs {
				existingRefs[id] = true
			}
		}
	} else if !errors.Is(previousErr, gorm.ErrRecordNotFound) {
		return nil, previousErr
	}
	for _, item := range before.Models {
		for _, id := range item.ResourceIDs {
			existingRefs[id] = true
		}
	}
	for _, item := range value.Models {
		for _, id := range item.ResourceIDs {
			resource, err := s.repo.Resource(id)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil, BadAuthRequest("模特参考图不存在")
				}
				return nil, err
			}
			if resource.Kind != "image" || resource.Status != model.ResourceStatusReady || (!existingRefs[id] && resource.UserID != actor.ID) {
				return nil, BadAuthRequest("模特参考图不可用或不属于当前管理员")
			}
		}
	}
	encodedBefore, err := json.Marshal(before)
	if err != nil {
		return nil, err
	}
	value.Revision = time.Now().UTC().Format(time.RFC3339Nano)
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	record := model.SystemSetting{Key: ecommerceSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		record.CreatedAt = current.CreatedAt
	}
	backup := model.SystemSetting{Key: ecommerceSettingKey + "_previous", ValueJSON: string(encodedBefore), UpdatedBy: actor.ID}
	audit, err := newAdminAuditEvent(actor, "ecommerce_canvas.update", "system_setting", ecommerceSettingKey, "更新电商画布配置", map[string]any{"enabled": value.Enabled, "modelCount": len(value.Models), "revision": value.Revision})
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveEcommerceSetting(current, &record, &backup, audit); err != nil {
		if errors.Is(err, repository.ErrEcommerceSettingChanged) {
			return nil, BadAuthRequest("配置已被其他管理员修改，请刷新后重试")
		}
		return nil, err
	}
	return &value, nil
}
func (s *Service) PreviousEcommerceSetting(actor *model.User) (*EcommerceSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	record, err := s.repo.SystemSetting(ecommerceSettingKey + "_previous")
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("暂无上一版配置")
	}
	if err != nil {
		return nil, err
	}
	var value EcommerceSetting
	if err := json.Unmarshal([]byte(record.ValueJSON), &value); err != nil {
		return nil, err
	}
	if err := validateEcommerceSetting(value); err != nil {
		return nil, err
	}
	return &value, nil
}
func (s *Service) UploadEcommerceModelImage(actor *model.User, header *multipart.FileHeader) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if header == nil || header.Size > 10<<20 {
		return nil, BadAuthRequest("请选择不超过 10MB 的模特图片")
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	mimeType, err := detectUploadedMimeType(file)
	if err != nil {
		return nil, err
	}
	if mimeType != "image/png" && mimeType != "image/jpeg" && mimeType != "image/webp" {
		return nil, BadAuthRequest("仅支持 PNG、JPEG、WebP 图片")
	}
	header.Header.Set("Content-Type", mimeType)
	return s.uploadLocalResource(actor.ID, header, "image", 0, 0, 0)
}
func (s *Service) PrepareEcommerceModelDelivery(actor *model.User, modelID, resourceID string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	options, err := assets.NormalizeAccessOptions(options, false)
	if err != nil {
		return nil, err
	}
	_, value, err := s.readEcommerceSetting()
	if err != nil {
		return nil, err
	}
	allowed := false
	for _, item := range value.Models {
		if item.ID == modelID && (item.Enabled && value.Enabled && value.ModelLibraryEnabled || actor.Role == model.UserRoleAdmin) {
			for _, id := range item.ResourceIDs {
				if id == resourceID {
					allowed = true
				}
			}
		}
	}
	if !allowed {
		if actor.Role == model.UserRoleAdmin {
			previous, err := s.PreviousEcommerceSetting(actor)
			if err == nil {
				for _, item := range previous.Models {
					if item.ID == modelID {
						for _, id := range item.ResourceIDs {
							if id == resourceID {
								allowed = true
							}
						}
					}
				}
			}
		}
		if !allowed {
			return nil, NotFound("公共模特图片不可用")
		}
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		return nil, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return nil, NotFound("公共模特图片不可用")
	}
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}

// Current and rollback configurations both own their image references. Invalid
// settings block deletion so a damaged record cannot silently destroy assets.
func (s *Service) ecommerceResourceReferences(resourceIDs []string) map[string][]AdminResourceReferenceView {
	result := map[string][]AdminResourceReferenceView{}
	wanted := map[string]bool{}
	for _, id := range resourceIDs {
		wanted[id] = true
	}
	for _, key := range []string{ecommerceSettingKey, ecommerceSettingKey + "_previous"} {
		record, err := s.repo.SystemSetting(key)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		var value EcommerceSetting
		if err != nil || json.Unmarshal([]byte(record.ValueJSON), &value) != nil || validateEcommerceSetting(value) != nil {
			for _, id := range resourceIDs {
				result[id] = append(result[id], AdminResourceReferenceView{Kind: "电商画布", ID: key, Title: "配置无法读取，暂停资源删除"})
			}
			continue
		}
		for _, item := range value.Models {
			for _, id := range item.ResourceIDs {
				if wanted[id] {
					result[id] = append(result[id], AdminResourceReferenceView{Kind: "电商画布", ID: key, Title: item.Name})
				}
			}
		}
	}
	return result
}
