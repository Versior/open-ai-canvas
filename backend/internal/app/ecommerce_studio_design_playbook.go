package app

import (
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// 出图策划的设计策划知识（KB20）：每次都带视觉策划方法、版式与字体、文案三条，再按商品类型和名称带最多两条品类打法，
// 按材质带最多两条布光方法。整段写进系统提示词，不走知识库的相关度排序，保证策划每次都照着做。
// 知识以数据库为准：管理员停用 KB20 来源时整段不带，驳回某一条时不带那一条；数据库里还没有 KB20 时用内置原文。
const (
	ecommerceStudioPlaybookCategories = 2
	ecommerceStudioPlaybookLighting   = 2
	kb20FoodLightingID                = "kb20-light-food"
)

var studioArtworkMethods = map[string]string{
	kb20LayoutID:       "文字与摄影共同构图。处理轮廓和字形之间的空间关系；让主体的尺度、虚实和裁切随证据变化。整套只呼应少量视觉线索，不统一布景、标题带或居中摆位。局部证据自己撑起画面，不是整品照上再加一个小圆框。",
	kb20CopyID:         "从可见结构、真实动作或已确认选购信息写短句。画面证明哪项事实，文字就讲那项事实；不从结构推断效果、体验或档位。省掉同义副标题，说明放在对应证据附近。",
	kb20MainID:         "首图先让买家在搜索小图里也要辨认出商品，轮廓和关键信息不被道具或字遮住。副图让不同的部位、动作或选购证据成为入口，不沿用首图构成。平台无字规则优先。",
	"kb20-single-hero": "让商品与主题共同建立视觉记忆。用这件商品独有的轮廓、材质或动作组织画面，让标题、摄影和图形成为同一个构成；不要将搜索缩略图放大再贴标题。不替卖家编活动。",
	kb20FoodLightingID: "照出实拍里的色泽与肌理，用干净光面保留形体。生食、熟食和加工状态各按本屏证据呈现，不添加热气、冰块、酱汁或产地暗示来证明鲜度或口感。",
}

var studioLightingKeywords = map[string][]string{
	"kb20-light-fabric": {"棉", "面料", "针织", "羊毛", "羊绒", "绒布", "植绒", "毛绒", "皮革", "织物", "帆布", "无纺布", "真丝", "蚕丝", "丝绸", "亚麻"},
	kb20FoodLightingID:  {"食品", "食物", "零食", "牛肉", "猪肉", "鸡肉", "肉脯", "糕点", "饮料", "咖啡豆", "咖啡粉", "茶叶", "绿茶", "红茶", "浓汤", "汤羹", "面食", "面条", "拌面", "拉面", "挂面", "方便面", "鸡蛋面", "荞麦面", "意面", "面包"},
}

type studioDesignMethod struct {
	title, guidance, artwork string
}

func kb20Matches(spec kb20DesignSpec, text string) int {
	hits := 0
	keywords := studioLightingKeywords[spec.id]
	if len(keywords) == 0 {
		keywords = spec.keywords
	}
	for _, keyword := range keywords {
		if keyword != "" && strings.Contains(text, strings.ToLower(keyword)) {
			hits++
		}
	}
	return hits
}

// ecommerceStudioPlaybookIDs 按商品挑 KB20 的条目：通用方法在前，主图或单张图的打法、品类打法、布光在后。
// kind 是策划范围（detail、main、single），targets 是单张图策划选中的类型。
func ecommerceStudioPlaybookIDs(category, name, family, materials, kind string, targets []string) []string {
	product := strings.ToLower(category + " " + name)
	material := strings.ToLower(category + " " + name + " " + materials)
	ids := []string{kb20MethodID}
	switch kind {
	case "main":
		ids = append(ids, kb20MainID)
	case "single":
		seen := map[string]bool{}
		for _, target := range targets {
			if id := kb20SingleTypeIDs[strings.TrimSpace(target)]; id != "" && !seen[id] && len(seen) < 2 {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	type scored struct {
		id   string
		hits int
	}
	// 关键词出现在商品类型和名称里的分量加倍：医用凝胶先取质地布光，再看档案里写的软管、透明这些材质。
	pick := func(kind string, text string, limit int) []string {
		matches := []scored{}
		for _, spec := range kb20DesignSpecs {
			if spec.kind != kind || len(spec.keywords) == 0 {
				continue
			}
			if hits := kb20Matches(spec, text) + kb20Matches(spec, product); hits > 0 {
				matches = append(matches, scored{spec.id, hits})
			}
		}
		sort.SliceStable(matches, func(i, j int) bool { return matches[i].hits > matches[j].hits })
		result := []string{}
		for _, match := range matches {
			if len(result) == limit {
				break
			}
			result = append(result, match.id)
		}
		return result
	}
	categories := pick(kb20CategoryKind, "", ecommerceStudioPlaybookCategories)
	if len(categories) == 0 {
		for _, spec := range kb20DesignSpecs {
			for _, item := range spec.families {
				if item == family && len(categories) == 0 {
					categories = append(categories, spec.id)
				}
			}
		}
	}
	if len(categories) == 0 {
		categories = []string{kb20GenericID}
	}
	ids = append(ids, categories...)
	ids = append(ids, pick(kb20PhotoKind, material, ecommerceStudioPlaybookLighting)...)
	return append(ids, kb20LayoutID, kb20CopyID, kb20ColorID, kb20CompositionID)
}

// ecommerceStudioDesignPlaybook 返回追加到出图策划系统提示词里的设计策划知识；来源被停用或一条都取不到时为空。
func (s *Service) ecommerceStudioDesignPlaybook(category, name, family, materials, kind string, targets []string) string {
	prompt, _ := s.ecommerceStudioDesignGuidance(category, name, family, materials, kind, targets)
	return prompt
}

func (s *Service) ecommerceStudioDesignGuidance(category, name, family, materials, kind string, targets []string) (string, []string) {
	ids := ecommerceStudioPlaybookIDs(category, name, family, materials, kind, targets)
	entries := s.ecommerceStudioDesignEntries(ids)
	lines := []string{"以下是电商设计策划知识库（KB20）里和这件商品相关的方法，包含电商案例拆解、版面组织与字体层级方法。按本次内容选择并细化（参考方法，不是这件商品的事实）："}
	var applied []string
	for _, id := range ids {
		if entry, ok := entries[id]; ok {
			lines = append(lines, "【"+entry.title+"】"+entry.guidance)
			applied = append(applied, id)
		}
	}
	if len(applied) == 0 {
		return "", nil
	}
	return strings.Join(lines, "\n"), applied
}

func (s *Service) ecommerceStudioDesignEntries(ids []string) map[string]studioDesignMethod {
	entries := make(map[string]studioDesignMethod, len(ids))
	source, err := s.repo.EcommerceKnowledgeSource(ecommerceBuiltinSourceID(ecommerceKB20Domain))
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		// 还没写入数据库（新库首次启动前）：用内置原文。
		for _, spec := range kb20DesignSpecs {
			entries[spec.id] = studioDesignMethod{title: spec.title, guidance: spec.guidance, artwork: studioArtworkMethods[spec.id]}
		}
	case err != nil:
		slog.Warn("ecommerce studio design playbook skipped", "error", err)
	case source.Status != "ready":
		return nil
	default:
		approved, err := s.repo.EcommerceKnowledgeByIDs(ids)
		if err != nil {
			slog.Warn("ecommerce studio design playbook skipped", "error", err)
			return nil
		}
		for _, entry := range approved {
			if entry.SourceID != source.ID {
				continue
			}
			var content struct {
				Guidance        string `json:"guidance"`
				ArtworkGuidance string `json:"artworkGuidance"`
			}
			if json.Unmarshal([]byte(entry.ContentJSON), &content) == nil && strings.TrimSpace(content.Guidance) != "" {
				method := studioDesignMethod{title: entry.Title, guidance: strings.TrimSpace(content.Guidance)}
				method.artwork = studioReviewedArtworkGuidance(entry, method.guidance, strings.TrimSpace(content.ArtworkGuidance))
				entries[entry.ID] = method
			}
		}
	}
	return entries
}

func studioReviewedArtworkGuidance(entry model.EcommerceKnowledgeEntry, guidance, savedArtwork string) string {
	builtin, exists := studioArtworkMethods[entry.ID]
	if !exists {
		return ""
	}
	for _, spec := range kb20DesignSpecs {
		if spec.id != entry.ID || spec.guidance != guidance {
			continue
		}
		if entry.DedupHash == ecommerceKnowledgeContentHash(entry) {
			return builtin
		}
		if savedArtwork != "" {
			return savedArtwork
		}
	}
	return guidance
}

func ecommerceStudioImageDesignRequested(metadata map[string]any) bool {
	if metadata["studioUseDesignKnowledge"] != true || metadata["source"] != ecommerceStudioSource || metadata["studioStep"] != "image" {
		return false
	}
	switch metadata["studioPlanKind"] {
	case "detail", "main", "single":
		return true
	default:
		return false
	}
}

func (s *Service) applyEcommerceStudioImageDesign(input *canvasGenerationInput) []string {
	metadata := input.Metadata
	if input.Mode != "image" || !ecommerceStudioImageDesignRequested(metadata) {
		return nil
	}
	const referenceHeading = "\n\n【设计参考方法，不是商品事实】\n按本图的用途和实物证据选择方法。不要照搬例子、画法或文案；以上商品事实、图内语言与卖家要求优先。"
	const maxReferenceRunes = 650
	budget := maxReferenceRunes
	if profile := input.Config.CapabilityConfig; profile != nil && profile.Image != nil && profile.Image.References.PromptMaxChars > 0 {
		budget = min(budget, profile.Image.References.PromptMaxChars-utf8.RuneCountInString(withSystemPrompt(input.Config, input.Prompt)))
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceGrokImage) && strings.TrimPrefix(strings.ToLower(strings.TrimSpace(input.Config.Model)), "models/") == "grok-imagine-image-quality" {
		budget = min(budget, (grokImageQualityPromptMaxBytes-len(withSystemPrompt(input.Config, input.Prompt)))/utf8.UTFMax)
	}
	budget -= utf8.RuneCountInString(referenceHeading)
	if budget <= 0 {
		return nil
	}
	category := ecommerceStudioMetadataText(metadata["studioCategory"], ecommerceStudioKnowledgeTypeRunes)
	name := ecommerceStudioMetadataText(metadata["studioProductName"], ecommerceStudioKnowledgeNameRunes)
	family := ecommerceStudioMetadataText(metadata["studioFamily"], 24)
	materials := ecommerceStudioMetadataText(metadata["studioMaterials"], ecommerceStudioKnowledgeMaterialRunes)
	var placementID string
	role, _ := metadata["studioRole"].(string)
	if metadata["studioPlanKind"] == "main" || (metadata["studioPlanKind"] == "single" && role == "main-selling") {
		placementID = kb20MainID
	} else if metadata["studioPlanKind"] == "single" && (role == "detail-hero" || role == "detail-campaign") {
		placementID = kb20SingleTypeIDs["poster"]
	}
	var lightingIDs []string
	if family == "food" {
		lightingIDs = []string{kb20FoodLightingID}
	} else {
		for _, id := range ecommerceStudioPlaybookIDs(category, name, family, materials, "detail", nil) {
			if strings.HasPrefix(id, "kb20-light-") {
				lightingIDs = append(lightingIDs, id)
			}
		}
	}
	ids := append([]string{kb20LayoutID, kb20CopyID}, lightingIDs...)
	var placementIDs []string
	if placementID != "" {
		placementIDs = []string{placementID}
		ids = append(ids, placementID)
	}
	entries := s.ecommerceStudioDesignEntries(ids)
	var lines, applied []string
	for _, group := range []struct {
		ids   []string
		limit int
	}{{placementIDs, 140}, {[]string{kb20LayoutID}, 160}, {[]string{kb20CopyID}, 130}, {lightingIDs, 140}} {
		for _, id := range group.ids {
			entry, ok := entries[id]
			if !ok {
				continue
			}
			label := "\n" + entry.title + "："
			guidance := entry.artwork
			if guidance == "" && strings.HasPrefix(id, "kb20-light-") && id != kb20FoodLightingID {
				guidance = entry.guidance
			}
			text := ecommerceStudioDesignExcerpt(guidance, min(group.limit, budget-utf8.RuneCountInString(label)))
			if text == "" {
				continue
			}
			lines = append(lines, label+text)
			budget -= utf8.RuneCountInString(label + text)
			applied = append(applied, id)
			break
		}
	}
	if len(applied) > 0 {
		input.Prompt += referenceHeading + strings.Join(lines, "")
	}
	return applied
}

func ecommerceStudioDesignExcerpt(guidance string, limit int) string {
	if limit <= 0 {
		return ""
	}
	text := []rune(guidance)
	if len(text) <= limit {
		return guidance
	}
	prefix := string(text[:limit])
	if end := strings.LastIndexAny(prefix, "。；！？\n"); end >= 0 {
		_, width := utf8.DecodeRuneInString(prefix[end:])
		return strings.TrimSpace(prefix[:end+width])
	}
	return ""
}
