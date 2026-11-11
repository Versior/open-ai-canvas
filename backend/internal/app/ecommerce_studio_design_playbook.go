package app

import (
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"strings"

	"gorm.io/gorm"
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
	ids := ecommerceStudioPlaybookIDs(category, name, family, materials, kind, targets)
	builtin := map[string]kb20DesignSpec{}
	for _, spec := range kb20DesignSpecs {
		builtin[spec.id] = spec
	}
	guidance := map[string]string{}
	titles := map[string]string{}
	source, err := s.repo.EcommerceKnowledgeSource(ecommerceBuiltinSourceID(ecommerceKB20Domain))
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		// 还没写入数据库（新库首次启动前）：用内置原文。
		for _, id := range ids {
			guidance[id], titles[id] = builtin[id].guidance, builtin[id].title
		}
	case err != nil:
		slog.Warn("ecommerce studio design playbook skipped", "error", err)
		return ""
	case source.Status != "ready":
		return ""
	default:
		entries, err := s.repo.EcommerceKnowledgeByIDs(ids)
		if err != nil {
			slog.Warn("ecommerce studio design playbook skipped", "error", err)
			return ""
		}
		for _, entry := range entries {
			var content struct {
				Guidance string `json:"guidance"`
			}
			if json.Unmarshal([]byte(entry.ContentJSON), &content) == nil && strings.TrimSpace(content.Guidance) != "" {
				guidance[entry.ID], titles[entry.ID] = content.Guidance, entry.Title
			}
		}
	}
	lines := []string{"以下是电商设计策划知识库（KB20）里和这件商品相关的方法，包含电商案例拆解、版面组织与字体层级方法。按本次内容选择并细化（参考方法，不是这件商品的事实）："}
	for _, id := range ids {
		if text := strings.TrimSpace(guidance[id]); text != "" {
			lines = append(lines, "【"+titles[id]+"】"+text)
		}
	}
	if len(lines) == 1 {
		return ""
	}
	return strings.Join(lines, "\n")
}
