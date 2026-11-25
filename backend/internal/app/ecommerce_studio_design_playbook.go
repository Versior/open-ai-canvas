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
)

func kb20Matches(spec kb20DesignSpec, text string) int {
	hits := 0
	for _, keyword := range spec.keywords {
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

func (s *Service) ecommerceStudioDesignEntries(ids []string) map[string]kb20DesignSpec {
	entries := make(map[string]kb20DesignSpec, len(ids))
	source, err := s.repo.EcommerceKnowledgeSource(ecommerceBuiltinSourceID(ecommerceKB20Domain))
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		// 还没写入数据库（新库首次启动前）：用内置原文。
		for _, spec := range kb20DesignSpecs {
			entries[spec.id] = spec
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
				Guidance string `json:"guidance"`
			}
			if json.Unmarshal([]byte(entry.ContentJSON), &content) == nil && strings.TrimSpace(content.Guidance) != "" {
				entries[entry.ID] = kb20DesignSpec{title: entry.Title, guidance: strings.TrimSpace(content.Guidance)}
			}
		}
	}
	return entries
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
	var lightingIDs []string
	for _, id := range ecommerceStudioPlaybookIDs(category, name, family, materials, "detail", nil) {
		if strings.HasPrefix(id, "kb20-light-") {
			lightingIDs = append(lightingIDs, id)
		}
	}
	ids := append([]string{kb20LayoutID, kb20MethodID}, lightingIDs...)
	entries := s.ecommerceStudioDesignEntries(ids)
	var lines, applied []string
	for _, group := range [][]string{{kb20LayoutID}, lightingIDs, {kb20MethodID}} {
		for _, id := range group {
			entry, ok := entries[id]
			if !ok {
				continue
			}
			label := "\n" + entry.title + "："
			text := ecommerceStudioDesignExcerpt(entry.guidance, min(235, budget-utf8.RuneCountInString(label)))
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
