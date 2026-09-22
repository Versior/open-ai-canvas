package domainmcp

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"
)

type ToolPermission string

const (
	PermissionReadOnly      ToolPermission = "read_only"
	PermissionExternalWrite ToolPermission = "external_write"
	PermissionCanvasWrite   ToolPermission = "canvas_write"
	PermissionProhibited    ToolPermission = "prohibited"
)

type ToolManifest struct {
	Name                string         `json:"name"`
	Description         string         `json:"description"`
	Permission          ToolPermission `json:"permission"`
	InputSchema         map[string]any `json:"inputSchema"`
	OutputSchemaVersion int            `json:"outputSchemaVersion"`
}

type PackManifest struct {
	ID                   string         `json:"id"`
	DisplayName          string         `json:"displayName"`
	Description          string         `json:"description"`
	Version              string         `json:"version"`
	ProviderRequirements []string       `json:"providerRequirements"`
	DataNotice           string         `json:"dataNotice,omitempty"`
	Tools                []ToolManifest `json:"tools"`
}

type Catalog struct {
	packs map[string]PackManifest
	order []string
}

func NewCatalog(packs ...PackManifest) (*Catalog, error) {
	catalog := &Catalog{packs: make(map[string]PackManifest, len(packs)), order: make([]string, 0, len(packs))}
	toolOwners := make(map[string]string)
	for _, input := range packs {
		pack := normalizePackManifest(clonePackManifest(input))
		if err := validatePackManifest(pack); err != nil {
			return nil, err
		}
		if _, duplicate := catalog.packs[pack.ID]; duplicate {
			return nil, fmt.Errorf("能力包 ID 重复: %s", pack.ID)
		}
		for _, tool := range pack.Tools {
			if owner, duplicate := toolOwners[tool.Name]; duplicate {
				return nil, fmt.Errorf("工具 %s 同时属于 %s 和 %s", tool.Name, owner, pack.ID)
			}
			toolOwners[tool.Name] = pack.ID
		}
		catalog.packs[pack.ID] = pack
		catalog.order = append(catalog.order, pack.ID)
	}
	return catalog, nil
}

func normalizePackManifest(pack PackManifest) PackManifest {
	sort.Strings(pack.ProviderRequirements)
	for index := range pack.Tools {
		if pack.Tools[index].InputSchema == nil {
			pack.Tools[index].InputSchema = map[string]any{"type": "object"}
		}
		if pack.Tools[index].OutputSchemaVersion == 0 {
			pack.Tools[index].OutputSchemaVersion = 1
		}
	}
	return pack
}

func (c *Catalog) Packs() []PackManifest {
	if c == nil {
		return []PackManifest{}
	}
	result := make([]PackManifest, 0, len(c.order))
	for _, id := range c.order {
		result = append(result, clonePackManifest(c.packs[id]))
	}
	return result
}

func (c *Catalog) Pack(id string) (PackManifest, bool) {
	if c == nil {
		return PackManifest{}, false
	}
	pack, ok := c.packs[strings.TrimSpace(id)]
	return clonePackManifest(pack), ok
}

func BuiltinPacks() []PackManifest {
	return []PackManifest{
		builtinPack("commerce.product-insight", "电商商品洞察", "分析商品、竞品、卖点与目标人群", []string{"anysearch"}, "外部市场结论来自可追溯的公网检索信号。",
			"commerce.product_analyze", "commerce.competitor_compare", "commerce.selling_point_matrix", "commerce.audience_insights"),
		builtinPack("social.xhs-trends", "小红书热点", "聚类公开内容信号并生成选题与审核建议", []string{"anysearch"}, "结果是公网检索信号，不代表小红书官方热榜。",
			"social.xhs_trends", "social.xhs_topic_clusters", "social.xhs_content_plan", "social.xhs_post_review"),
		builtinPack("social.douyin-trends", "抖音趋势", "研究公开趋势信号、钩子、脚本与视频表达", []string{"anysearch"}, "结果是公网检索信号，不代表抖音官方热榜。",
			"social.douyin_trends", "social.douyin_hook_analysis", "social.douyin_content_plan", "social.douyin_video_review"),
		builtinPack("film.references", "影视资料", "检索片目、主创、影像风格、人物与场景参考", []string{"anysearch"}, "资料结论保留来源，不复制受保护的辨识性表达。",
			"film.reference_search", "film.title_research", "film.lookbook_research", "film.character_reference", "film.scene_reference"),
		builtinPack("brand.review", "品牌审核", "编译品牌规则并审核文案、视觉与活动一致性", nil, "图片像素由调用方视觉模型检查，能力包负责规则和审核结构。",
			"brand.policy_compile", "brand.copy_compliance", "brand.visual_compliance", "brand.campaign_audit"),
		builtinPack("commerce.hero-image", "电商主图", "规划、扩展并审核电商主图方案", nil, "媒体生成由影策既有生成工具执行。",
			"commerce.hero_image_plan", "commerce.hero_image_variants", "commerce.hero_image_review"),
		builtinPack("commerce.detail-page", "电商详情页", "规划详情页模块、提示词与质量审核", nil, "能力包产出结构化页面计划，不直接提交生成任务。",
			"commerce.detail_page_plan", "commerce.detail_section_prompts", "commerce.detail_page_review"),
		builtinPack("story.script", "剧本开发", "开发命题、人物弧、场次、剧本和连贯性审核", nil, "结构化结果与阅读文本来自同一规范化剧本。",
			"story.premise_develop", "story.character_arc", "story.script_develop", "story.script_review", "story.continuity_check"),
		builtinPack("story.short-motion", "短剧与漫剧", "规划分集、付费卡点、剧本、分镜和漫剧动效", nil, "画布 Recipe 只创建计划节点，媒体生成单独审批。",
			"story.short_drama_plan", "story.motion_comic_plan", "story.episode_outline", "story.episode_script", "story.storyboard_recipe", "story.episode_review"),
	}
}

func builtinPack(id, name, description string, providers []string, dataNotice string, toolNames ...string) PackManifest {
	tools := make([]ToolManifest, 0, len(toolNames))
	for _, toolName := range toolNames {
		tools = append(tools, ToolManifest{
			Name:                toolName,
			Description:         builtinToolDescription(toolName),
			Permission:          PermissionReadOnly,
			InputSchema:         builtinToolInputSchema(toolName),
			OutputSchemaVersion: 1,
		})
	}
	return PackManifest{ID: id, DisplayName: name, Description: description, Version: "1.0.0", ProviderRequirements: providers, DataNotice: dataNotice, Tools: tools}
}

func builtinToolDescription(name string) string {
	if name == "commerce.product_analyze" {
		return "基于用户提供的商品事实和可追溯公网检索信号，分析受众、购买动机、购买阻力与卖点方向；不会把市场推测写成商品事实。"
	}
	readable := strings.NewReplacer(".", " ", "_", " ").Replace(name)
	return "影策领域能力：" + readable
}

func builtinToolInputSchema(name string) map[string]any {
	if name == "commerce.product_analyze" {
		return map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"required":             []any{"productName"},
			"properties": map[string]any{
				"productName":  map[string]any{"type": "string", "minLength": 1, "maxLength": 200, "description": "明确的商品名称"},
				"productFacts": map[string]any{"type": "array", "maxItems": 20, "items": map[string]any{"type": "string", "minLength": 1, "maxLength": 500}, "description": "用户确认的商品事实，不包含推测"},
				"audienceHint": map[string]any{"type": "string", "maxLength": 500, "description": "已有目标人群提示"},
				"market":       map[string]any{"type": "string", "maxLength": 100, "description": "目标市场，默认中国大陆"},
				"language":     map[string]any{"type": "string", "maxLength": 32, "description": "结果语言，默认 zh-CN"},
			},
		}
	}
	return map[string]any{"type": "object", "additionalProperties": false}
}

func validatePackManifest(pack PackManifest) error {
	if !validManifestIdentifier(pack.ID, 80) {
		return errors.New("能力包 ID 需要 1–80 个字母、数字、点、下划线或短横线")
	}
	if strings.TrimSpace(pack.DisplayName) == "" || len([]rune(pack.DisplayName)) > 80 {
		return fmt.Errorf("能力包 %s 名称无效", pack.ID)
	}
	if strings.TrimSpace(pack.Version) == "" || len(pack.Version) > 32 {
		return fmt.Errorf("能力包 %s 版本无效", pack.ID)
	}
	if len(pack.Tools) == 0 || len(pack.Tools) > 64 {
		return fmt.Errorf("能力包 %s 工具数量需要在 1–64 之间", pack.ID)
	}
	seen := make(map[string]struct{}, len(pack.Tools))
	for index := range pack.Tools {
		tool := &pack.Tools[index]
		if !validToolName(tool.Name) {
			return fmt.Errorf("能力包 %s 工具名无效: %s", pack.ID, tool.Name)
		}
		if _, duplicate := seen[tool.Name]; duplicate {
			return fmt.Errorf("能力包 %s 工具名重复: %s", pack.ID, tool.Name)
		}
		seen[tool.Name] = struct{}{}
		if strings.TrimSpace(tool.Description) == "" || len([]rune(tool.Description)) > 1000 {
			return fmt.Errorf("工具 %s 说明无效", tool.Name)
		}
		if tool.Permission != PermissionReadOnly && tool.Permission != PermissionExternalWrite && tool.Permission != PermissionCanvasWrite && tool.Permission != PermissionProhibited {
			return fmt.Errorf("工具 %s 权限无效", tool.Name)
		}
		if tool.InputSchema == nil {
			return fmt.Errorf("工具 %s 缺少 inputSchema", tool.Name)
		}
		if kind, _ := tool.InputSchema["type"].(string); kind != "object" {
			return fmt.Errorf("工具 %s inputSchema 必须是 object", tool.Name)
		}
		if tool.OutputSchemaVersion <= 0 {
			return fmt.Errorf("工具 %s outputSchemaVersion 无效", tool.Name)
		}
	}
	return nil
}

func clonePackManifest(input PackManifest) PackManifest {
	result := input
	result.ProviderRequirements = append([]string(nil), input.ProviderRequirements...)
	result.Tools = make([]ToolManifest, len(input.Tools))
	for index, tool := range input.Tools {
		result.Tools[index] = tool
		result.Tools[index].InputSchema = cloneStringAnyMap(tool.InputSchema)
	}
	return result
}

func cloneStringAnyMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = cloneJSONValue(value)
	}
	return result
}

func cloneJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneStringAnyMap(typed)
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = cloneJSONValue(item)
		}
		return result
	default:
		return typed
	}
}

func validManifestIdentifier(value string, max int) bool {
	if value == "" || len(value) > max || strings.TrimSpace(value) != value {
		return false
	}
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func validToolName(value string) bool {
	return validManifestIdentifier(value, 128)
}
