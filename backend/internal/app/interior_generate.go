package app

import (
	"errors"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/interior"
	"yingce/backend/internal/model"
)

// interiorTaskSource 标记室内设计页提交的任务；任务准入据此检查「室内设计」开关。
const interiorTaskSource = "interior-design"

var (
	interiorSizes     = map[string]bool{"auto": true, "1:1": true, "3:2": true, "2:3": true, "4:3": true, "3:4": true, "16:9": true, "9:16": true, "21:9": true}
	interiorQualities = map[string]bool{"auto": true, "low": true, "medium": true, "high": true}
)

type InteriorGenerateInput struct {
	Professional         *interior.RenovationSpec `json:"professional,omitempty"`
	Surface              string                   `json:"surface"`
	ModeID               string                   `json:"modeId"`
	RoomKey              string                   `json:"roomKey,omitempty"`
	StyleKeys            []string                 `json:"styleKeys,omitempty"`
	Params               map[string]string        `json:"params,omitempty"`
	Notes                string                   `json:"notes,omitempty"`
	SourceResourceID     string                   `json:"sourceResourceId"`
	ReferenceResourceIDs []string                 `json:"referenceResourceIds,omitempty"`
	Count                int                      `json:"count"`
	Size                 string                   `json:"size,omitempty"`
	Quality              string                   `json:"quality,omitempty"`
	Model                *interior.ModelRef       `json:"model,omitempty"`
	ProjectID            string                   `json:"projectId,omitempty"`
	RoundID              string                   `json:"roundId,omitempty"`
}

type InteriorTaskReceipt struct {
	ID     string           `json:"id"`
	Status model.TaskStatus `json:"status"`
}

type InteriorGenerateItem struct {
	StyleKey  string               `json:"styleKey,omitempty"`
	StyleName string               `json:"styleName,omitempty"`
	Task      *InteriorTaskReceipt `json:"task,omitempty"`
	Error     string               `json:"error,omitempty"`
}

type InteriorGenerateResult struct {
	Model  interior.ModelRef      `json:"model"`
	Count  int                    `json:"count"`
	Params map[string]string      `json:"params"`
	Items  []InteriorGenerateItem `json:"items"`
}

type interiorVariant struct {
	key, name, prompt string
}

type interiorPrepared struct {
	model      interior.ModelRef
	count      int
	params     map[string]string
	parameters map[string]any
	refs       []map[string]any
	variants   []interiorVariant
	prompts    []string
	metadata   []map[string]any
}

// GenerateInterior 编译提示词并为每个所选风格创建一个生图任务。
// 计费、并发、取消和任务记录都沿用通用任务；第一个任务失败时直接报错，后续失败按项返回。
func (s *Service) GenerateInterior(actor *model.User, req InteriorGenerateInput, traceID, requestID string) (*InteriorGenerateResult, error) {
	prepared, err := s.prepareInteriorGeneration(actor, req)
	if err != nil {
		return nil, err
	}
	result := &InteriorGenerateResult{Model: prepared.model, Count: prepared.count, Params: prepared.params, Items: make([]InteriorGenerateItem, 0, len(prepared.variants))}
	for index, variant := range prepared.variants {
		task, createErr := s.createInteriorTask(actor.ID, prepared.model, prepared.parameters, prepared.prompts[index], prepared.refs, prepared.metadata[index], traceID, requestID)
		item := InteriorGenerateItem{StyleKey: variant.key, StyleName: variant.name}
		if createErr != nil {
			if index == 0 {
				return nil, createErr
			}
			item.Error = interiorErrorMessage(createErr)
			result.Items = append(result.Items, item)
			for _, rest := range prepared.variants[index+1:] {
				result.Items = append(result.Items, InteriorGenerateItem{StyleKey: rest.key, StyleName: rest.name, Error: "前一个风格提交失败，未提交"})
			}
			break
		}
		item.Task = &InteriorTaskReceipt{ID: task.ID, Status: task.Status}
		result.Items = append(result.Items, item)
	}
	return result, nil
}

// 报价和生成共用入参、资源归属、模型选择与提示词编译，避免预算与实际请求分叉。
func (s *Service) prepareInteriorGeneration(actor *model.User, req InteriorGenerateInput) (*interiorPrepared, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureInterior); err != nil {
		return nil, err
	}
	settings, err := s.interiorSettings()
	if err != nil {
		return nil, err
	}
	surface := strings.TrimSpace(req.Surface)
	if surface != interior.SurfaceQuick && surface != interior.SurfacePro {
		return nil, BadAuthRequest("交互模式须为 quick 或 pro")
	}
	if !settings.AllowSurfaceSwitch && surface != settings.DefaultSurface {
		return nil, Forbidden("当前站点只开放一种交互模式")
	}
	mode, err := s.repo.InteriorMode(strings.TrimSpace(req.ModeID))
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && !mode.Enabled) {
		return nil, BadAuthRequest("所选模式未开放")
	}
	if err != nil {
		return nil, err
	}
	if !interior.ValidSurface(mode.Audience, surface) {
		return nil, Forbidden("当前模式不对这种交互模式开放")
	}
	view, err := s.interiorModeView(*mode, true)
	if err != nil {
		return nil, err
	}
	refs, err := s.interiorReferenceImages(actor.ID, view.Slots, req.SourceResourceID, req.ReferenceResourceIDs)
	if err != nil {
		return nil, err
	}
	if !interior.ValidNotes(req.Notes) {
		return nil, BadAuthRequest("补充说明不能超过 500 字")
	}
	notes := interior.CleanNotes(req.Notes)
	if mode.NotesRequired && notes == "" {
		return nil, BadAuthRequest("请写下要修改的内容")
	}
	paramPrompts, params, err := interior.ResolveParams(view.Params, req.Params, surface)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	roomName, roomPrompt, roomKey, err := s.interiorRoom(mode.RequiresRoom, req.RoomKey)
	if err != nil {
		return nil, err
	}
	variants, err := s.interiorVariants(mode.RequiresStyle, req.StyleKeys, settings.MaxStylesPerRun)
	if err != nil {
		return nil, err
	}
	count, err := interiorCount(req.Count, mode.MaxCount, settings.MaxCountPerStyle)
	if err != nil {
		return nil, err
	}
	parameters := map[string]any{"count": count}
	if size := strings.TrimSpace(req.Size); size != "" {
		if !interiorSizes[size] {
			return nil, BadAuthRequest("画面比例无效")
		}
		parameters["size"] = size
	}
	if quality := strings.TrimSpace(req.Quality); quality != "" {
		if surface != interior.SurfacePro || !interiorQualities[quality] {
			return nil, BadAuthRequest("画质参数无效")
		}
		parameters["quality"] = quality
	}
	modelRef, err := interiorModelChoice(surface, req.Model, view.DefaultModel, settings.DefaultModel, view.AllowedModels)
	if err != nil {
		return nil, err
	}
	scope, err := s.interiorTaskScope(actor.ID, req.ProjectID, req.RoundID)
	if err != nil {
		return nil, err
	}

	prepared := &interiorPrepared{model: modelRef, count: count, params: params, parameters: parameters, refs: refs, variants: variants}
	if req.Professional != nil {
		if err := req.Professional.Validate(); err != nil {
			return nil, BadAuthRequest(err.Error())
		}
		if req.Professional.Texture != nil {
			id := req.Professional.Texture.ResourceID
			textureRefs, err := s.interiorReferenceImages(actor.ID, nil, id, nil)
			if err != nil {
				return nil, BadAuthRequest("石材照片不存在、尚未就绪或不属于当前用户")
			}
			textureRefs[0]["slotKey"] = "material"
			found := false
			for _, ref := range prepared.refs {
				if ref["resourceId"] == id {
					found = true
					break
				}
			}
			if !found {
				prepared.refs = append(prepared.refs, textureRefs[0])
			}
		}
	}
	for _, variant := range variants {
		prompt := interior.Compile(interior.PromptInput{
			Template: mode.PromptTemplate, RoomName: roomName, RoomPrompt: roomPrompt,
			StyleName: variant.name, StylePrompt: variant.prompt, ParamPrompts: paramPrompts, Notes: notes,
		})
		if req.Professional != nil {
			prompt += req.Professional.RenderPrompt()
		}
		meta := map[string]any{"modeKey": mode.Key, "modeVersion": mode.Version, "surface": surface, "params": params}
		if req.Professional != nil {
			meta["professional"] = req.Professional
		}
		for key, value := range scope {
			meta[key] = value
		}
		if roomKey != "" {
			meta["roomKey"] = roomKey
		}
		if variant.key != "" {
			meta["styleKey"] = variant.key
		}
		prepared.prompts = append(prepared.prompts, prompt)
		prepared.metadata = append(prepared.metadata, meta)
	}
	return prepared, nil
}

func (s *Service) createInteriorTask(userID string, ref interior.ModelRef, parameters map[string]any, prompt string, refs []map[string]any, meta map[string]any, traceID, requestID string) (*model.Task, error) {
	input, err := s.interiorGenerationInput(userID, ref, parameters, prompt, refs, meta)
	if err != nil {
		return nil, err
	}
	config := input["config"].(map[string]any)
	return s.CreateTask(userID, CreateTaskRequest{Type: "canvas_image", Operation: "image", Prompt: prompt, Model: stringValue(config["model"]), LogicalModelID: ref.LogicalModelID, Input: input, TraceID: traceID, RequestID: requestID})
}

func (s *Service) interiorGenerationInput(userID string, ref interior.ModelRef, parameters map[string]any, prompt string, refs []map[string]any, meta map[string]any) (map[string]any, error) {
	input := map[string]any{
		"mode":     WorkbenchKindImage,
		"prompt":   prompt,
		"metadata": map[string]any{"source": interiorTaskSource, "interior": meta},
	}
	if len(refs) > 0 {
		input["referenceImages"] = refs
	}
	providerConfig, err := s.resolveWorkbenchProviderConfig(userID, WorkbenchKindImage, "image", ref.Model, ref.LogicalModelID, ref.ChannelID, parameters, input)
	if err != nil {
		return nil, err
	}
	modelName, _ := providerConfig["model"].(string)
	if strings.TrimSpace(modelName) == "" {
		return nil, BadAuthRequest("所选系统模型不可用")
	}
	input["config"] = providerConfig
	return input, nil
}

type InteriorEstimate struct {
	Model              interior.ModelRef `json:"model"`
	Images             int               `json:"images"`
	AmountMicrocredits int64             `json:"amountMicrocredits"`
	Estimated          bool              `json:"estimated"`
}

// EstimateInterior 不创建任务、不预留余额；按实际每个风格的输入走既有报价系统。
func (s *Service) EstimateInterior(actor *model.User, req InteriorGenerateInput) (*InteriorEstimate, error) {
	prepared, err := s.prepareInteriorGeneration(actor, req)
	if err != nil {
		return nil, err
	}
	result := &InteriorEstimate{Model: prepared.model, Images: prepared.count * len(prepared.variants)}
	for index := range prepared.variants {
		input, err := s.interiorGenerationInput(actor.ID, prepared.model, prepared.parameters, prepared.prompts[index], prepared.refs, prepared.metadata[index])
		if err != nil {
			return nil, err
		}
		// 路由意图解析只接受 JSON 数组；与 CreateTask 的 JSON 边界保持一致。
		input, err = normalizeTaskInput(input)
		if err != nil {
			return nil, err
		}
		intent := ModelRequestIntentFromTaskInput(input, "canvas_image", "image")
		var quote *LogicalModelQuote
		if prepared.model.LogicalModelID != "" {
			quote, err = s.QuoteLogicalModel(actor.ID, prepared.model.LogicalModelID, intent)
		} else {
			config := input["config"].(map[string]any)
			quote, err = s.QuoteChannelModel(actor.ID, ChannelModelQuoteRequest{ChannelID: stringValue(config["channelId"]), ModelKey: prepared.model.Model, Intent: intent})
		}
		if err != nil {
			return nil, err
		}
		result.AmountMicrocredits += quote.AmountMicrocredits
		result.Estimated = result.Estimated || quote.Estimated
	}
	return result, nil
}

// interiorReferenceImages 校验原图和参考图属于当前用户且已就绪；原图固定排在第一张，提示词按这个顺序描述。
func (s *Service) interiorReferenceImages(userID string, slots []interior.InputSlot, sourceID string, referenceIDs []string) ([]map[string]any, error) {
	referenceMax, referenceRequired := 0, false
	for _, slot := range slots {
		if slot.Key == interior.SlotReference {
			referenceMax, referenceRequired = slot.MaxCount, slot.Required
		}
	}
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return nil, BadAuthRequest("请先上传原图")
	}
	ids := []string{sourceID}
	seen := map[string]bool{sourceID: true}
	for _, id := range referenceIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids)-1 > referenceMax {
		if referenceMax == 0 {
			return nil, BadAuthRequest("当前模式不使用参考图")
		}
		return nil, BadAuthRequest("参考图数量超出当前模式上限")
	}
	if referenceRequired && len(ids) < 2 {
		return nil, BadAuthRequest("请上传参考案例图")
	}
	refs := make([]map[string]any, 0, len(ids))
	for index, id := range ids {
		if assets.ValidID(id) != id {
			return nil, BadAuthRequest("图片标识无效")
		}
		resource, err := s.repo.ResourceForUser(userID, id)
		if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			if index == 0 {
				return nil, BadAuthRequest("原图不存在或还没上传完成")
			}
			return nil, BadAuthRequest("参考图不存在或还没上传完成")
		}
		slotKey := interior.SlotSource
		if index > 0 {
			slotKey = interior.SlotReference
		}
		refs = append(refs, map[string]any{"id": resource.ID, "resourceId": resource.ID, "storageKey": "resource:" + resource.ID, "role": "reference", "slotKey": slotKey})
	}
	return refs, nil
}

func (s *Service) interiorRoom(required bool, key string) (string, string, string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		if required {
			return "", "", "", BadAuthRequest("请选择空间类型")
		}
		return "", "", "", nil
	}
	items, err := s.repo.InteriorPresetsByKeys(interior.PresetRoom, []string{key})
	if err != nil {
		return "", "", "", err
	}
	if len(items) == 0 || !items[0].Enabled {
		return "", "", "", BadAuthRequest("所选空间未开放")
	}
	return items[0].Name, items[0].Prompt, items[0].Key, nil
}

func (s *Service) interiorVariants(required bool, keys []string, maxStyles int) ([]interiorVariant, error) {
	cleaned := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		cleaned = append(cleaned, key)
	}
	if !required {
		if len(cleaned) > 0 {
			return nil, BadAuthRequest("当前模式不需要选择风格")
		}
		return []interiorVariant{{}}, nil
	}
	if len(cleaned) == 0 {
		return nil, BadAuthRequest("请至少选择一个风格")
	}
	if len(cleaned) > maxStyles {
		return nil, BadAuthRequest("一次最多对比 " + strconv.Itoa(maxStyles) + " 个风格")
	}
	items, err := s.repo.InteriorPresetsByKeys(interior.PresetStyle, cleaned)
	if err != nil {
		return nil, err
	}
	byKey := map[string]model.InteriorPreset{}
	for _, item := range items {
		byKey[item.Key] = item
	}
	variants := make([]interiorVariant, 0, len(cleaned))
	for _, key := range cleaned {
		item, ok := byKey[key]
		if !ok || !item.Enabled {
			return nil, BadAuthRequest("所选风格未开放")
		}
		variants = append(variants, interiorVariant{key: item.Key, name: item.Name, prompt: item.Prompt})
	}
	return variants, nil
}

func interiorCount(requested, modeMax, settingsMax int) (int, error) {
	limit := modeMax
	if settingsMax < limit {
		limit = settingsMax
	}
	if limit < 1 {
		limit = 1
	}
	if requested == 0 {
		requested = 1
	}
	if requested < 1 || requested > limit {
		return 0, BadAuthRequest("每个风格的出图张数须为 1–" + strconv.Itoa(limit))
	}
	return requested, nil
}

// interiorModelChoice 决定本次使用的模型。
// 两种模式：用户选择（必须在可选范围内）> 推荐默认模型 > 可选范围里的第一个。
// 可选范围为空时不限制，是否能用由系统渠道准入决定。
func interiorModelChoice(surface string, requested, modeDefault, siteDefault *interior.ModelRef, allowed []interior.ModelRef) (interior.ModelRef, error) {
	chosen, err := interior.NormalizeModelRef(requested)
	if err != nil {
		return interior.ModelRef{}, BadAuthRequest(err.Error())
	}
	configured := modeDefault
	if configured == nil {
		configured = siteDefault
	}
	permitted := func(ref interior.ModelRef) bool {
		if len(allowed) == 0 || (configured != nil && configured.Same(ref)) {
			return true
		}
		for _, item := range allowed {
			if item.Same(ref) {
				return true
			}
		}
		return false
	}
	if chosen != nil {
		if permitted(*chosen) {
			return *chosen, nil
		}
		return interior.ModelRef{}, BadAuthRequest("所选模型不在当前出图方式的可选范围内")
	}
	if configured != nil {
		return *configured, nil
	}
	if len(allowed) > 0 {
		return allowed[0], nil
	}
	return interior.ModelRef{}, BadAuthRequest("请选择出图模型，或让管理员配置默认模型")
}

// interiorTaskScope 校验任务关联的项目归属；轮次标识只做格式校验，用于页面把结果回填到对应轮次。
func (s *Service) interiorTaskScope(userID, projectID, roundID string) (map[string]any, error) {
	scope := map[string]any{}
	if projectID = strings.TrimSpace(projectID); projectID != "" {
		if _, err := s.interiorOwnedProject(userID, projectID); err != nil {
			return nil, err
		}
		scope["projectId"] = projectID
	}
	if roundID = strings.TrimSpace(roundID); roundID != "" {
		if assets.ValidID(roundID) != roundID {
			return nil, BadAuthRequest("轮次标识无效")
		}
		scope["roundId"] = roundID
	}
	return scope, nil
}

func interiorErrorMessage(err error) string {
	var appErr *AppError
	if errors.As(err, &appErr) && appErr.Message != "" {
		return appErr.Message
	}
	var modelErr *ModelError
	if errors.As(err, &modelErr) && modelErr.AppError != nil {
		return modelErr.Message
	}
	return "提交失败，请稍后重试"
}
