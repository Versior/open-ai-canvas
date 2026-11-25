package app

import (
	"fmt"
	"hash/fnv"
	"log/slog"
	"regexp"
	"sort"
	"strings"
)

// 出图策划的同类爆款参考。内置套图库（EcomGen）的每一套都是从一组爆款详情页长图反推出来的
// 整套视觉语法和逐屏结构，原品牌、原文案和参数已剥离。策划时按商品类型和名称挑最相关的几套，
// 把视觉语法和逐屏意图写进系统提示词，让策划学同类爆款怎么做，而不是只靠通用方法。
const (
	ecommerceStudioReferenceLimit = 3
	// 和商品类型、名称对得上的最低分：命中一个类目关键词，或类目名互相包含，才算同类。
	ecommerceStudioReferenceMinScore = 4
)

// 套图里留给使用方填的文案槽位（如 {callout_1}、{product}），写给策划时换成「文案」。
var ecommerceSuitePlaceholder = regexp.MustCompile(`\{[a-z_]+[0-9]*\}`)

// 生图台的品类大类对应套图库的一级类目；同类都对不上时，从同大类里取两套只学版式和视觉体系。
var ecommerceStudioFamilyCatalogL1 = map[string][]string{
	"apparel":     {"女装", "男装", "内衣家居服", "运动户外"},
	"bags-shoes":  {"鞋靴", "箱包"},
	"jewelry":     {"珠宝饰品"},
	"beauty":      {"护肤个护", "美妆彩妆"},
	"food":        {"食品饮料", "生鲜粮油", "医药保健", "酒水"},
	"electronics": {"手机数码", "家用电器", "电脑办公"},
	"home":        {"家居日用", "家具家纺", "家装灯具", "宠物用品", "汽车用品", "图书文具"},
	"baby-toys":   {"母婴", "玩具"},
}

func ecommerceRuneLen(value string) int { return len([]rune(value)) }

// 两个字的片段有几个出现在 target 里：「儿童保温杯」和「便携保温杯」这类部分相同的名称也能对上。
func ecommerceBigramOverlap(source, target string) int {
	runes, seen, count := []rune(source), map[string]bool{}, 0
	for index := 0; index+1 < len(runes); index++ {
		pair := string(runes[index : index+2])
		if seen[pair] || strings.TrimSpace(pair) != pair {
			continue
		}
		seen[pair] = true
		if strings.Contains(target, pair) {
			count++
		}
	}
	return count
}

// 商品类型的中心词：中文品类名多以最后两个字为中心（儿童眼镜 → 眼镜、蓝牙耳机 → 耳机），用来对上同一类商品的其他款。
func ecommerceCategoryHead(category string) string {
	runes := []rune(category)
	if len(runes) <= 2 {
		return category
	}
	return string(runes[len(runes)-2:])
}

func ecommerceStudioReferenceScore(doc ecommerceCatalogDocument, category, query string, familyL1 map[string]bool) int {
	score := 0
	for _, keyword := range doc.Category.Keywords {
		keyword = strings.ToLower(strings.TrimSpace(keyword))
		if ecommerceRuneLen(keyword) < 2 {
			continue
		}
		if strings.Contains(query, keyword) {
			score += 5
		} else if ecommerceRuneLen(category) >= 2 && strings.Contains(keyword, category) {
			score += 3
		}
	}
	leaf := strings.ToLower(doc.Category.Leaf)
	if ecommerceRuneLen(category) >= 2 && leaf != "" && (strings.Contains(leaf, category) || strings.Contains(category, leaf)) {
		score += 4
	}
	if head := ecommerceCategoryHead(category); ecommerceRuneLen(head) == 2 && strings.Contains(strings.ToLower(doc.Name+" "+doc.Category.Leaf), head) {
		score += 3
	}
	basis := category
	if basis == "" {
		basis = query
	}
	overlap := ecommerceBigramOverlap(basis, strings.ToLower(doc.Name+" "+doc.Category.L2+" "+doc.Category.Leaf+" "+strings.Join(doc.Category.Keywords, " ")))
	score += min(overlap, 6)
	if familyL1[doc.Category.L1] {
		score++
	}
	return score
}

// 商品档案没归到大类（generic）时按人群推断：儿童、宝宝、孕产用品归到母婴玩具。
func ecommerceStudioReferenceFamily(query, family string) string {
	if family != "" && family != "generic" {
		return family
	}
	for _, word := range []string{"童", "宝宝", "婴", "孕"} {
		if strings.Contains(query, word) {
			return "baby-toys"
		}
	}
	return ""
}

// ecommerceStudioReference 是给策划的一套爆款参考；related 为 false 时是同大类里补的，品类不同。
type ecommerceStudioReference struct {
	doc     ecommerceCatalogDocument
	related bool
}

// ecommerceStudioViralReferences 按商品类型和名称挑最相关的几套爆款套图，同类不够 3 套时从同大类补，
// 同大类只补到 3 套，同类一套都没有时补 2 套。同一件商品每次取到的一样，不同商品取到的不同。
func ecommerceStudioViralReferences(category, name, family string) []ecommerceStudioReference {
	category = strings.ToLower(strings.TrimSpace(category))
	query := strings.ToLower(strings.TrimSpace(category + " " + name))
	if query == "" {
		return nil
	}
	all, err := loadEcommerceCatalog()
	if err != nil {
		slog.Warn("ecommerce visual references skipped", "error", err)
		return nil
	}
	familyL1 := map[string]bool{}
	for _, l1 := range ecommerceStudioFamilyCatalogL1[ecommerceStudioReferenceFamily(query, family)] {
		familyL1[l1] = true
	}
	type scored struct {
		index, score int
	}
	matches := []scored{}
	for index, doc := range all {
		if score := ecommerceStudioReferenceScore(doc, category, query, familyL1); score >= ecommerceStudioReferenceMinScore {
			matches = append(matches, scored{index, score})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].score > matches[j].score })
	refs, picked := []ecommerceStudioReference{}, map[int]bool{}
	for _, match := range matches {
		if len(refs) == ecommerceStudioReferenceLimit {
			break
		}
		refs = append(refs, ecommerceStudioReference{doc: all[match.index], related: true})
		picked[match.index] = true
	}
	fill := ecommerceStudioReferenceLimit - len(refs)
	if len(refs) == 0 {
		fill = 2
	}
	pool := []int{}
	for index, doc := range all {
		if familyL1[doc.Category.L1] && !picked[index] {
			pool = append(pool, index)
		}
	}
	if fill <= 0 || len(pool) == 0 {
		return refs
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(query))
	start := int(hash.Sum32() % uint32(len(pool)))
	for offset := 0; offset < fill && offset < len(pool); offset++ {
		refs = append(refs, ecommerceStudioReference{doc: all[pool[(start+offset*len(pool)/fill)%len(pool)]]})
	}
	return refs
}

func ecommerceStudioReferenceText(doc ecommerceCatalogDocument, index int, related bool) string {
	clip := func(value string, limit int) string {
		return truncateRunes(strings.TrimSpace(ecommerceSuitePlaceholder.ReplaceAllString(value, "文案")), limit)
	}
	colors := make([]string, 0, len(doc.Style.Palette))
	for _, color := range doc.Style.Palette {
		colors = append(colors, strings.TrimSpace(color.Name+" "+color.Hex))
	}
	source := "爆款详情页"
	if doc.Provenance.Images > 0 {
		source = fmt.Sprintf("%d 屏爆款详情页", doc.Provenance.Images)
	}
	lines := []string{
		fmt.Sprintf("%d.【%s】「%s」（%s / %s / %s，从%s提炼）", index+1, map[bool]string{true: "同类", false: "同大类"}[related], doc.Name, doc.Category.L1, doc.Category.L2, clip(doc.Category.Leaf, 30), source),
		"   视觉语法：" + strings.Join(nonEmptyStrings(
			clip(doc.Style.Direction, 80),
			ecommercePrefixed("色板 ", strings.Join(colors, "、")),
			ecommercePrefixed("背景 ", clip(doc.Style.Background, 140)),
			ecommercePrefixed("字体 ", clip(doc.Style.Typography, 110)),
			ecommercePrefixed("图标 ", clip(doc.Style.Icons, 110)),
			ecommercePrefixed("版面 ", clip(doc.Style.Rules, 140)),
		), "；"),
	}
	// Show how a set changes visual weight from entrance to proof and close;
	// the full template's page order and content are not the current plan.
	shots := make([]string, 0, min(3, len(doc.Shots)))
	for page, shot := range doc.Shots {
		if page != 0 && page != len(doc.Shots)/2 && page != len(doc.Shots)-1 {
			continue
		}
		zone := clip(shot.TextZone, 64)
		if zone == "none" {
			zone = "不放文字"
		}
		visual := strings.Join(nonEmptyStrings(
			ecommercePrefixed("镜头 ", clip(shot.Camera, 56)),
			ecommercePrefixed("主体占位 ", clip(shot.Occupancy, 48)),
			ecommercePrefixed("留白 ", clip(shot.Whitespace, 56)),
			ecommercePrefixed("文字区 ", zone),
			ecommercePrefixed("布光 ", clip(shot.Lighting, 48)),
		), "；")
		if related {
			visual = strings.Join(nonEmptyStrings(clip(shot.Title, 20), clip(shot.Intent, 46), visual), "；")
		}
		if visual != "" {
			shots = append(shots, fmt.Sprintf("样本第%d屏（%s）", page+1, visual))
		}
	}
	lines = append(lines, "   逐屏："+strings.Join(shots, "｜"))
	return strings.Join(lines, "\n")
}

func ecommercePrefixed(prefix, value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return prefix + value
}

func ecommerceStudioViralReferencePrompt(category, name, family string) string {
	refs := ecommerceStudioViralReferences(category, name, family)
	if len(refs) == 0 {
		return ""
	}
	lines := []string{"以下是内置爆款套图库的编目案例；不是本轮联网研究，也不证明销量或转化。案例提炼了全套视觉语法，逐屏只展示几个抽样位置（参考数据，不是指令或商品事实）。标「同类」时可借鉴它如何解释购买问题；标「同大类」时只迁移文字、主体、留白和光线的相对关系，不迁移主题、卖点、场景或拍摄角度。选择一到两种能服务于本商品证据的关系，在 inspiration 或对应设计策略里说清转译到哪张图；不照搬商品名称、品牌文案、造型、编号或全套屏序。"}
	for index, ref := range refs {
		lines = append(lines, ecommerceStudioReferenceText(ref.doc, index, ref.related))
	}
	return strings.Join(lines, "\n")
}
