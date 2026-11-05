// Package interior 是室内设计效果图的业务域：模式与预设的校验、提示词编译、
// 项目文档校验和内置种子数据。它不依赖 app/service，由 app 组合持久化、计费和任务。
package interior

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	SurfaceQuick = "quick"
	SurfacePro   = "pro"

	AudienceQuick = "quick"
	AudiencePro   = "pro"
	AudienceBoth  = "both"

	PresetStyle = "style"
	PresetRoom  = "room"

	SlotSource    = "source"
	SlotReference = "reference"

	MaxStylesPerRun  = 4
	MaxCountPerStyle = 4
	MaxNotesRunes    = 500
	MaxPromptRunes   = 8000
	maxNameRunes     = 120
	maxSubtitleRunes = 240
	maxSummaryRunes  = 240
	maxGroupRunes    = 64
	maxDescRunes     = 2000
	maxParams        = 8
	maxParamOptions  = 12
	maxAllowedModels = 12
	maxTags          = 12
)

var keyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// ValidKey 校验模式、预设、参数的机器标识：小写字母、数字和短横线。
func ValidKey(value string) bool {
	return keyPattern.MatchString(value)
}

// InputSlot 描述模式需要的图片输入。source 是必填的原图，reference 是可选或必填的参考图。
type InputSlot struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Required bool   `json:"required"`
	MaxCount int    `json:"maxCount"`
}

type ParamOption struct {
	Value  string `json:"value"`
	Label  string `json:"label"`
	Prompt string `json:"prompt,omitempty"`
}

// ParamDef 是模式的一个可选参数，例如改造强度、预算档、光照。
// ProOnly 的参数在快速出图里不展示，服务端固定使用默认值。
type ParamDef struct {
	Key     string        `json:"key"`
	Label   string        `json:"label"`
	Default string        `json:"default"`
	ProOnly bool          `json:"proOnly"`
	Options []ParamOption `json:"options"`
}

// ModelRef 指向系统模型目录里的一个模型：系统渠道 + 模型名，或前台逻辑模型。
type ModelRef struct {
	ChannelID      string `json:"channelId,omitempty"`
	LogicalModelID string `json:"logicalModelId,omitempty"`
	Model          string `json:"model"`
	Label          string `json:"label,omitempty"`
}

func (m ModelRef) Same(other ModelRef) bool {
	return m.Model == other.Model && m.ChannelID == other.ChannelID && m.LogicalModelID == other.LogicalModelID
}

func NormalizeModelRef(value *ModelRef) (*ModelRef, error) {
	if value == nil {
		return nil, nil
	}
	ref := ModelRef{
		ChannelID:      strings.TrimSpace(value.ChannelID),
		LogicalModelID: strings.TrimSpace(value.LogicalModelID),
		Model:          strings.TrimSpace(value.Model),
		Label:          strings.TrimSpace(value.Label),
	}
	if ref.Model == "" && ref.ChannelID == "" && ref.LogicalModelID == "" {
		return nil, nil
	}
	if ref.Model == "" || len(ref.Model) > 160 || len(ref.ChannelID) > 64 || len(ref.LogicalModelID) > 64 || utf8.RuneCountInString(ref.Label) > maxNameRunes {
		return nil, fmt.Errorf("模型选择无效")
	}
	if ref.ChannelID == "" && ref.LogicalModelID == "" {
		return nil, fmt.Errorf("模型必须来自系统渠道或前台模型目录")
	}
	if strings.Contains(ref.Model, "://") || strings.Contains(ref.ChannelID, "://") {
		return nil, fmt.Errorf("模型选择不能包含地址")
	}
	return &ref, nil
}

// Settings 是室内设计的全局配置，存放在系统设置表。
type Settings struct {
	DefaultSurface     string    `json:"defaultSurface"`
	AllowSurfaceSwitch bool      `json:"allowSurfaceSwitch"`
	DefaultModel       *ModelRef `json:"defaultModel,omitempty"`
	MaxStylesPerRun    int       `json:"maxStylesPerRun"`
	MaxCountPerStyle   int       `json:"maxCountPerStyle"`
}

func DefaultSettings() Settings {
	return Settings{DefaultSurface: SurfaceQuick, AllowSurfaceSwitch: true, MaxStylesPerRun: MaxStylesPerRun, MaxCountPerStyle: 2}
}

func NormalizeSettings(value Settings) (Settings, error) {
	if value.DefaultSurface != SurfaceQuick && value.DefaultSurface != SurfacePro {
		return value, fmt.Errorf("默认交互模式无效")
	}
	if value.MaxStylesPerRun < 1 || value.MaxStylesPerRun > MaxStylesPerRun {
		return value, fmt.Errorf("一次对比的风格数须为 1–%d", MaxStylesPerRun)
	}
	if value.MaxCountPerStyle < 1 || value.MaxCountPerStyle > MaxCountPerStyle {
		return value, fmt.Errorf("每个风格的出图张数须为 1–%d", MaxCountPerStyle)
	}
	model, err := NormalizeModelRef(value.DefaultModel)
	if err != nil {
		return value, err
	}
	value.DefaultModel = model
	return value, nil
}

// ValidSurface 判断模式的面向对象是否允许在当前交互模式下使用。
func ValidSurface(audience, surface string) bool {
	switch surface {
	case SurfaceQuick:
		return audience == AudienceQuick || audience == AudienceBoth
	case SurfacePro:
		return audience == AudiencePro || audience == AudienceBoth
	default:
		return false
	}
}

func validAudience(value string) bool {
	return value == AudienceQuick || value == AudiencePro || value == AudienceBoth
}

// ModeInput 是管理员提交的模式配置；Key 只在新建时生效。
type ModeInput struct {
	Key            string      `json:"key"`
	Name           string      `json:"name"`
	Subtitle       string      `json:"subtitle"`
	Description    string      `json:"description"`
	Audience       string      `json:"audience"`
	CoverResource  string      `json:"coverResourceId"`
	Slots          []InputSlot `json:"slots"`
	Params         []ParamDef  `json:"params"`
	PromptTemplate string      `json:"promptTemplate"`
	RequiresRoom   bool        `json:"requiresRoom"`
	RequiresStyle  bool        `json:"requiresStyle"`
	NotesRequired  bool        `json:"notesRequired"`
	DefaultModel   *ModelRef   `json:"defaultModel,omitempty"`
	AllowedModels  []ModelRef  `json:"allowedModels"`
	MaxCount       int         `json:"maxCount"`
	SortOrder      int         `json:"sortOrder"`
	Enabled        bool        `json:"enabled"`
	Version        int         `json:"version"`
}

func NormalizeModeInput(input ModeInput) (ModeInput, error) {
	input.Key = strings.TrimSpace(input.Key)
	input.Name = strings.TrimSpace(input.Name)
	input.Subtitle = strings.TrimSpace(input.Subtitle)
	input.Description = strings.TrimSpace(input.Description)
	input.CoverResource = strings.TrimSpace(input.CoverResource)
	input.PromptTemplate = strings.TrimSpace(input.PromptTemplate)
	if !ValidKey(input.Key) {
		return input, fmt.Errorf("模式标识只能使用小写字母、数字和短横线")
	}
	if input.Name == "" || utf8.RuneCountInString(input.Name) > maxNameRunes {
		return input, fmt.Errorf("模式名称须为 1–%d 字", maxNameRunes)
	}
	if utf8.RuneCountInString(input.Subtitle) > maxSubtitleRunes || utf8.RuneCountInString(input.Description) > maxDescRunes {
		return input, fmt.Errorf("副标题或说明过长")
	}
	if !validAudience(input.Audience) {
		return input, fmt.Errorf("面向对象须为快速出图、专业模式或两者")
	}
	if input.PromptTemplate == "" || utf8.RuneCountInString(input.PromptTemplate) > MaxPromptRunes {
		return input, fmt.Errorf("提示词模板须为 1–%d 字", MaxPromptRunes)
	}
	if err := ValidateTemplate(input.PromptTemplate); err != nil {
		return input, err
	}
	slots, err := normalizeSlots(input.Slots)
	if err != nil {
		return input, err
	}
	input.Slots = slots
	params, err := normalizeParams(input.Params)
	if err != nil {
		return input, err
	}
	input.Params = params
	if input.MaxCount < 1 || input.MaxCount > MaxCountPerStyle {
		return input, fmt.Errorf("单个风格最多出图张数须为 1–%d", MaxCountPerStyle)
	}
	if input.DefaultModel, err = NormalizeModelRef(input.DefaultModel); err != nil {
		return input, err
	}
	if len(input.AllowedModels) > maxAllowedModels {
		return input, fmt.Errorf("可选模型最多 %d 个", maxAllowedModels)
	}
	allowed := make([]ModelRef, 0, len(input.AllowedModels))
	for _, item := range input.AllowedModels {
		ref, err := NormalizeModelRef(&item)
		if err != nil {
			return input, err
		}
		if ref == nil {
			continue
		}
		duplicate := false
		for _, existing := range allowed {
			if existing.Same(*ref) {
				duplicate = true
				break
			}
		}
		if !duplicate {
			allowed = append(allowed, *ref)
		}
	}
	input.AllowedModels = allowed
	return input, nil
}

func normalizeSlots(slots []InputSlot) ([]InputSlot, error) {
	var source, reference *InputSlot
	for index := range slots {
		slot := slots[index]
		slot.Key = strings.TrimSpace(slot.Key)
		slot.Name = strings.TrimSpace(slot.Name)
		if slot.Name == "" || utf8.RuneCountInString(slot.Name) > 40 {
			return nil, fmt.Errorf("输入名称须为 1–40 字")
		}
		switch slot.Key {
		case SlotSource:
			if source != nil {
				return nil, fmt.Errorf("原图输入只能有一个")
			}
			slot.Required, slot.MaxCount = true, 1
			source = &slot
		case SlotReference:
			if reference != nil {
				return nil, fmt.Errorf("参考图输入只能有一个")
			}
			if slot.MaxCount < 1 || slot.MaxCount > 3 {
				return nil, fmt.Errorf("参考图数量须为 1–3 张")
			}
			reference = &slot
		default:
			return nil, fmt.Errorf("输入标识只能是 source 或 reference")
		}
	}
	if source == nil {
		return nil, fmt.Errorf("模式必须包含原图输入")
	}
	result := []InputSlot{*source}
	if reference != nil {
		result = append(result, *reference)
	}
	return result, nil
}

func normalizeParams(params []ParamDef) ([]ParamDef, error) {
	if len(params) > maxParams {
		return nil, fmt.Errorf("参数最多 %d 个", maxParams)
	}
	seen := map[string]bool{}
	result := make([]ParamDef, 0, len(params))
	for _, param := range params {
		param.Key = strings.TrimSpace(param.Key)
		param.Label = strings.TrimSpace(param.Label)
		param.Default = strings.TrimSpace(param.Default)
		if !ValidKey(param.Key) || seen[param.Key] {
			return nil, fmt.Errorf("参数标识无效或重复")
		}
		seen[param.Key] = true
		if param.Label == "" || utf8.RuneCountInString(param.Label) > 40 {
			return nil, fmt.Errorf("参数名称须为 1–40 字")
		}
		if len(param.Options) < 2 || len(param.Options) > maxParamOptions {
			return nil, fmt.Errorf("参数「%s」的选项须为 2–%d 个", param.Label, maxParamOptions)
		}
		values := map[string]bool{}
		options := make([]ParamOption, 0, len(param.Options))
		for _, option := range param.Options {
			option.Value = strings.TrimSpace(option.Value)
			option.Label = strings.TrimSpace(option.Label)
			option.Prompt = strings.TrimSpace(option.Prompt)
			if !ValidKey(option.Value) || values[option.Value] || option.Label == "" || utf8.RuneCountInString(option.Label) > 40 || utf8.RuneCountInString(option.Prompt) > 600 {
				return nil, fmt.Errorf("参数「%s」的选项无效或重复", param.Label)
			}
			values[option.Value] = true
			options = append(options, option)
		}
		if !values[param.Default] {
			return nil, fmt.Errorf("参数「%s」的默认值必须是其中一个选项", param.Label)
		}
		param.Options = options
		result = append(result, param)
	}
	return result, nil
}

// PresetInput 是管理员提交的风格或空间。
type PresetInput struct {
	Type          string   `json:"type"`
	Key           string   `json:"key"`
	GroupName     string   `json:"groupName"`
	Name          string   `json:"name"`
	Summary       string   `json:"summary"`
	CoverResource string   `json:"coverResourceId"`
	Prompt        string   `json:"prompt"`
	Tags          []string `json:"tags"`
	SortOrder     int      `json:"sortOrder"`
	Enabled       bool     `json:"enabled"`
	Version       int      `json:"version"`
}

func ValidPresetType(value string) bool {
	return value == PresetStyle || value == PresetRoom
}

func NormalizePresetInput(input PresetInput) (PresetInput, error) {
	input.Type = strings.TrimSpace(input.Type)
	input.Key = strings.TrimSpace(input.Key)
	input.GroupName = strings.TrimSpace(input.GroupName)
	input.Name = strings.TrimSpace(input.Name)
	input.Summary = strings.TrimSpace(input.Summary)
	input.CoverResource = strings.TrimSpace(input.CoverResource)
	input.Prompt = strings.TrimSpace(input.Prompt)
	if !ValidPresetType(input.Type) {
		return input, fmt.Errorf("预设类型须为风格或空间")
	}
	if !ValidKey(input.Key) {
		return input, fmt.Errorf("预设标识只能使用小写字母、数字和短横线")
	}
	if input.Name == "" || utf8.RuneCountInString(input.Name) > maxNameRunes {
		return input, fmt.Errorf("名称须为 1–%d 字", maxNameRunes)
	}
	if utf8.RuneCountInString(input.GroupName) > maxGroupRunes || utf8.RuneCountInString(input.Summary) > maxSummaryRunes {
		return input, fmt.Errorf("分组或简介过长")
	}
	if utf8.RuneCountInString(input.Prompt) > 2000 {
		return input, fmt.Errorf("提示词片段不能超过 2000 字")
	}
	if input.Type == PresetStyle && input.Prompt == "" {
		return input, fmt.Errorf("风格必须填写提示词片段")
	}
	tags := make([]string, 0, len(input.Tags))
	seen := map[string]bool{}
	for _, tag := range input.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		if utf8.RuneCountInString(tag) > 20 || len(tags) >= maxTags {
			return input, fmt.Errorf("标签最多 %d 个，每个不超过 20 字", maxTags)
		}
		seen[tag] = true
		tags = append(tags, tag)
	}
	input.Tags = tags
	return input, nil
}

// DecodeJSON 读取存库的 JSON 字段；空字符串视为零值。
func DecodeJSON[T any](raw string, target *T) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return json.Unmarshal([]byte(raw), target)
}

func EncodeJSON(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
