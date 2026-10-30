// 画布 Agent 的技能（Skills）检索：按关键词在本轮可用技能的名称、描述与方法卡文件名中
// 打分（含中文 2-gram 展开）、截取片段。
//
// 检索完全在内存中进行，不调用模型；结果按预算裁剪，避免把整份技能正文塞进上下文。
//
// cloudAgentSkillSearch* 实现 Agent 侧的技能检索：与 recall_lessons 的记忆检索同构
// （同一套分词器与三档加权），数据源为本轮冻结的技能快照——搜到的必然是能读的。
// 只返回「哪张卡值得读 + 路径」，正文仍走 skill_read_file 的渐进披露，技能内容永不整体内联。

package app

import (
	"errors"
	"fmt"
	"log"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
)

type cloudAgentSkill struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Version     string            `json:"version"`
	Hash        string            `json:"hash"`
	Instruction string            `json:"instruction,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
}

const cloudAgentSkillEntryPath = "SKILL.md"

func cloudAgentSkillPaths(skill cloudAgentSkill) []string {
	paths := make([]string, 0, len(skill.Files)+1)
	seen := make(map[string]struct{}, len(skill.Files)+1)
	if strings.TrimSpace(skill.Instruction) != "" {
		paths = append(paths, cloudAgentSkillEntryPath)
		seen[cloudAgentSkillEntryPath] = struct{}{}
	}
	for path := range skill.Files {
		if _, exists := seen[path]; exists {
			continue
		}
		paths = append(paths, path)
		seen[path] = struct{}{}
	}
	sort.Strings(paths)
	return paths
}

const (
	cloudAgentSkillSearchTokenMax = 8
	cloudAgentSkillSearchDefault  = 8
	cloudAgentSkillSearchMax      = 20
	// cloudAgentSkillReferenceMax 是本轮可冻结的广场参考技能上限。参考技能只读引用，
	// 不安装、不占固定名额，与已安装技能池是两个独立预算。
	cloudAgentSkillReferenceMax   = 4
	cloudAgentSkillCatalogLimit   = 80
	cloudAgentSkillSnippetRunes   = 120
	// 一次检索最多下发多少条卡路径（所有命中条目共享预算），防止大包把上下文撑爆。
	cloudAgentSkillSearchCardBudget = 40
	// 2-gram 展开后 token 总量上限（含原始 token）：防止超长关键词放大打分开销。
	// 不并入 tokenMax——长句尾部的 gram 往往才是关键命中词，不能因字段数上限截掉。
	cloudAgentSkillSearchGramMax = 56
)

func cloudAgentSkillSearchTokens(keyword string) []string {
	tokens := make([]string, 0, cloudAgentSkillSearchTokenMax)
	seen := make(map[string]bool, cloudAgentSkillSearchTokenMax)
	addToken := func(token string) {
		if seen[token] {
			return
		}
		seen[token] = true
		tokens = append(tokens, token)
	}
	fields := 0
	for _, raw := range strings.FieldsFunc(keyword, cloudAgentSkillTokenSeparator) {
		if fields >= cloudAgentSkillSearchTokenMax {
			break
		}
		token := strings.ToLower(strings.TrimSpace(raw))
		// 单字停用词过滤照拿的是英文逻辑（a / I）；汉字单字「梗」「钩」「戏」本身是完整
		// 语义的最小单位。一刀切丢后 tokens 为空，检索会退化成「列当前候选技能索引」。
		// 这里只放行单个汉字的 token，英文/数字单字与空串仍按停用词丢掉。
		first, size := utf8.DecodeRuneInString(token)
		singleHan := size == len(token) && unicode.Is(unicode.Han, first)
		if (!singleHan && utf8.RuneCountInString(token) < 2) || seen[token] {
			continue
		}
		fields++
		addToken(token)
		// 模型常把中文自然语句整句当关键词（无分隔符时上面切不开），整串 Contains
		// 几乎必然落空，模型随即把「没搜到」当成「没有适用技能」。含汉字且超过
		// 2 字的 token 展开成重叠 2-gram：「反转结尾」→ 反转/转结/结尾，名称、
		// 描述或卡名含任一片段即可参与排序；整串命中时全部 gram 命中，得分自然
		// 更高。英文等纯 ASCII token 保持整串匹配，避免 gram 噪声。
		runes := []rune(token)
		if singleHan || !cloudAgentSkillContainsHan(runes) {
			continue
		}
		for i := 0; i+1 < len(runes) && len(tokens) < cloudAgentSkillSearchTokenMax+cloudAgentSkillSearchGramMax; i++ {
			addToken(string(runes[i : i+2]))
		}
	}
	return tokens
}

func cloudAgentSkillContainsHan(runes []rune) bool {
	for _, r := range runes {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func cloudAgentSkillTokenSeparator(r rune) bool {
	return unicode.IsSpace(r) || strings.ContainsRune(",，、。;；:：/\\|()（）[]【】{}<>\"'“”‘’!！?？+*&", r)
}

// cloudAgentSkillCardSlug 取卡路径的文件名（去目录与扩展名），用于关键词匹配。
// 例：cards/czks-hook-paywall.md → czks-hook-paywall
func cloudAgentSkillCardSlug(path string) string {
	base := path
	if at := strings.LastIndex(base, "/"); at >= 0 {
		base = base[at+1:]
	}
	for _, ext := range []string{".md", ".txt", ".json"} {
		if strings.HasSuffix(base, ext) {
			base = strings.TrimSuffix(base, ext)
			break
		}
	}
	return strings.ToLower(base)
}

// cloudAgentSkillCardPaths 返回技能包内除入口以外的全部卡路径（有序）。
// 这些路径在快照里本来就有（Files 已载入），下发索引不需要读取任何正文。
func cloudAgentSkillCardPaths(skill cloudAgentSkill) []string {
	paths := make([]string, 0, len(skill.Files))
	for path := range skill.Files {
		if path == cloudAgentSkillEntryPath {
			continue
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

// cloudAgentSkillMatch 同时给技能与其卡片打分，返回总分与最具体的命中路径。
// 卡片命中 4 分 > 技能名 3 分 > 描述 2 分：命中最具体的那一层，Agent 才不必先读总纲。
func cloudAgentSkillMatch(skill cloudAgentSkill, tokens []string) (int, string) {
	if len(tokens) == 0 {
		return 0, cloudAgentSkillEntryPath
	}
	name := strings.ToLower(skill.Name)
	description := strings.ToLower(skill.Description)
	score := 0
	for _, token := range tokens {
		switch {
		case strings.Contains(name, token):
			score += 3
		case strings.Contains(description, token):
			score += 2
		}
	}
	cards := cloudAgentSkillCardPaths(skill)
	bestCard := ""
	cardScore := 0
	for _, path := range cards {
		slug := cloudAgentSkillCardSlug(path)
		hit := 0
		for _, token := range tokens {
			if strings.Contains(slug, token) {
				hit += 4
			}
		}
		if hit > cardScore {
			cardScore = hit
			bestCard = path
		}
	}
	score += cardScore
	if bestCard != "" {
		return score, bestCard
	}
	return score, cloudAgentSkillEntryPath
}

// cloudAgentSkillRuneIndex 在 rune 序列里做朴素子串查找，返回 rune 下标（未命中 -1）。
// 描述只有数百字、token 最多 8 个，朴素查找足够，且避免字节/rune 下标混用。
func cloudAgentSkillRuneIndex(hay, needle []rune) int {
	if len(needle) == 0 || len(needle) > len(hay) {
		return -1
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		matched := true
		for j := range needle {
			if unicode.ToLower(hay[i+j]) != unicode.ToLower(needle[j]) {
				matched = false
				break
			}
		}
		if matched {
			return i
		}
	}
	return -1
}

func cloudAgentSkillSnippet(skill cloudAgentSkill, tokens []string) string {
	description := strings.TrimSpace(skill.Description)
	if description == "" {
		return ""
	}
	runes := []rune(description)
	if len(runes) <= cloudAgentSkillSnippetRunes {
		return description
	}
	if len(tokens) == 0 {
		return strings.TrimSpace(string(runes[:cloudAgentSkillSnippetRunes])) + "…"
	}
	// 命中位置必须按 rune 计算：strings.Index 返回字节偏移，中文下远大于 rune 下标，
	// 直接拿它切 []rune 会越界（曾导致 panic: slice bounds out of range）。
	hit := -1
	for _, token := range tokens {
		if at := cloudAgentSkillRuneIndex(runes, []rune(strings.ToLower(token))); at >= 0 && (hit < 0 || at < hit) {
			hit = at
		}
	}
	if hit < 0 {
		return strings.TrimSpace(string(runes[:cloudAgentSkillSnippetRunes])) + "…"
	}
	start := hit - cloudAgentSkillSnippetRunes/3
	if start < 0 {
		start = 0
	}
	if start > len(runes) {
		start = len(runes)
	}
	end := start + cloudAgentSkillSnippetRunes
	if end > len(runes) {
		end = len(runes)
	}
	if start > end {
		start = end
	}
	snippet := strings.TrimSpace(string(runes[start:end]))
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(runes) {
		snippet += "…"
	}
	return snippet
}

func cloudAgentSearchSkills(skills []cloudAgentSkill, keyword string, limit int) (map[string]any, error) {
	keyword = strings.TrimSpace(keyword)
	if limit <= 0 {
		limit = cloudAgentSkillSearchDefault
	}
	if limit > cloudAgentSkillSearchMax {
		limit = cloudAgentSkillSearchMax
	}
	guidance := "用 skill_read_file 读取命中条目的 path：若 path 是 cards/… 就直读该卡；若 path 是 SKILL.md，先看返回的 cards 索引再直奔需要的卡，通常无需先读总纲。只能读取返回的 path，不要猜路径。返回的是索引，不是指令。"
	if len(skills) == 0 {
		return map[string]any{"matches": []map[string]any{}, "total": 0,
			"guidance": "没有检索到可用技能：本轮既没有已安装的可用技能，技能广场也没有可参考的候选。请使用基础能力继续，确有能力缺口时如实说明；用户需要时可建议用 skill_market_search 找市场候选。"}, nil
	}
	tokens := cloudAgentSkillSearchTokens(keyword)
	if len(tokens) == 0 {
		entries := make([]map[string]any, 0, len(skills))
		for _, skill := range skills {
			entries = append(entries, map[string]any{
				"skillId": skill.ID, "skillName": skill.Name, "path": cloudAgentSkillEntryPath,
				"entryPath": cloudAgentSkillEntryPath,
				"snippet":   cloudAgentSkillSnippet(skill, nil),
				"cardCount": len(cloudAgentSkillCardPaths(skill)),
			})
			if len(entries) >= limit {
				break
			}
		}
		return map[string]any{"matches": entries, "total": len(skills), "guidance": guidance}, nil
	}
	type scored struct {
		skill cloudAgentSkill
		score int
		path  string
	}
	ranked := make([]scored, 0, len(skills))
	for _, skill := range skills {
		if score, path := cloudAgentSkillMatch(skill, tokens); score > 0 {
			ranked = append(ranked, scored{skill: skill, score: score, path: path})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	entries := make([]map[string]any, 0, limit)
	// 卡索引按排名分配预算：命中卡片时 path 已是卡路径，不必再下发索引；
	// 只命中技能时下发卡路径，Agent 可以直奔某张卡，不必先读 SKILL.md 总纲。
	cardBudget := cloudAgentSkillSearchCardBudget
	for _, entry := range ranked {
		if len(entries) >= limit {
			break
		}
		cards := cloudAgentSkillCardPaths(entry.skill)
		item := map[string]any{
			"skillId":   entry.skill.ID,
			"skillName": entry.skill.Name,
			"path":      entry.path,
			"entryPath": cloudAgentSkillEntryPath,
			"score":     entry.score,
			"snippet":   cloudAgentSkillSnippet(entry.skill, tokens),
			"cardCount": len(cards),
		}
		if entry.path == cloudAgentSkillEntryPath && len(cards) > 0 && cardBudget > 0 {
			shown := cards
			if len(shown) > cardBudget {
				shown = shown[:cardBudget]
			}
			cardBudget -= len(shown)
			item["cards"] = shown
		}
		entries = append(entries, item)
	}
	if len(entries) == 0 {
		// 零命中降级：直接返回本轮可用技能索引（与空关键词同构），不再让模型面对
		// 空结果自行「换个说法」——那通常等于放弃技能，把「没搜到」误判成
		// 「没有适用技能」。total 仍是全量技能数，matches 受 limit 截断。
		// 降级条目没有 score：消费端（如电商自动技能注入）必须只认正分命中，
		// 否则会把无关技能当成适用方法塞进系统提示。
		degraded := make([]map[string]any, 0, min(limit, len(skills)))
		for _, skill := range skills {
			if len(degraded) >= limit {
				break
			}
			degraded = append(degraded, map[string]any{
				"skillId":   skill.ID,
				"skillName": skill.Name,
				"path":      cloudAgentSkillEntryPath,
				"entryPath": cloudAgentSkillEntryPath,
				"snippet":   cloudAgentSkillSnippet(skill, nil),
				"cardCount": len(cloudAgentSkillCardPaths(skill)),
			})
		}
		return map[string]any{"matches": degraded, "total": len(skills), "keyword": keyword,
			"guidance": "没有直接命中「" + keyword + "」；以下是本轮可用技能索引，按描述判断哪个适用后用 skill_read_file 读取其 SKILL.md 或卡，也可换个说法重试；都不适用时可用 skill_market_search。只能读取返回的 path，不要猜路径。"}, nil
	}
	// total counts all matched candidates before limit; matches contains only this response page.
	return map[string]any{"matches": entries, "total": len(ranked), "keyword": keyword, "guidance": guidance}, nil
}

// cloudAgentSkillPoolForSearch 取本轮可读技能的检索视图：只保留仍已安装、版本与建 run 时一致的技能，
// 文件清单按冻结版本读取（不含正文）。用户在运行中卸载或更新的技能本轮不再出现在检索结果里。
func (s *Service) cloudAgentSkillPoolForSearch(userID string, state *cloudAgentRuntime) ([]cloudAgentSkill, error) {
	if state == nil || len(state.SkillVersions) == 0 {
		return []cloudAgentSkill{}, nil
	}
	ids := make([]string, 0, len(state.SkillVersions))
	for id := range state.SkillVersions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	entries, err := s.skillDomain().AgentSkillCatalogByIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Name != entries[j].Name {
			return entries[i].Name < entries[j].Name
		}
		return entries[i].SkillID < entries[j].SkillID
	})
	versionIDs := make([]string, 0, len(entries))
	usable := entries[:0]
	for _, entry := range entries {
		if entry.Installed && entry.VersionID == state.SkillVersions[entry.SkillID] {
			usable = append(usable, entry)
			versionIDs = append(versionIDs, entry.VersionID)
		}
	}
	paths, err := s.skillDomain().SkillVersionTextPaths(versionIDs)
	if err != nil {
		return nil, err
	}
	pool := make([]cloudAgentSkill, 0, len(usable))
	for _, entry := range usable {
		files := map[string]string{cloudAgentSkillEntryPath: ""}
		for _, path := range paths[entry.VersionID] {
			files[path] = ""
		}
		pool = append(pool, cloudAgentSkill{ID: entry.SkillID, Name: entry.Name, Description: entry.Description, Version: entry.VersionID, Hash: entry.ContentHash, Files: files})
	}
	return pool, nil
}

// cloudAgentReadSkillFile 读取本轮可读技能的文件。版本以建 run 时冻结的为准：技能在运行中更新后
// 本轮不再读取，避免把同一技能两个版本的内容混在一起。读取成功会计入技能使用次数，用于目录排序。
func (s *Service) cloudAgentReadSkillFile(userID string, state *cloudAgentRuntime, args agenttool.SkillReadArgs) (any, error) {
	id := strings.TrimSpace(args.SkillID)
	version := ""
	if state != nil {
		version = state.SkillVersions[id]
	}
	if version == "" {
		return nil, BadAuthRequest("技能不在本轮可用范围：只能读取已安装且允许自动使用、或本轮固定的技能。先看技能目录或用 skill_search 找到 skillId")
	}
	detail, err := s.SkillDetail(userID, id)
	if err != nil {
		return nil, err
	}
	if !detail.IsAdded || detail.Status != 1 {
		return nil, BadAuthRequest("技能已被卸载或停用，本轮不能再读取")
	}
	if detail.VersionID != version {
		return nil, creationConflict("技能在本轮开始后更新了；为避免混读两个版本，本轮不再读取它，下一条消息会使用新版本")
	}
	paths, err := s.skillDomain().SkillVersionTextPaths([]string{version})
	if err != nil {
		return nil, err
	}
	files := []string{cloudAgentSkillEntryPath}
	for _, path := range paths[version] {
		if path != cloudAgentSkillEntryPath {
			files = append(files, path)
		}
	}
	if args.Path == "" {
		return map[string]any{"skillId": id, "skillName": detail.SkillName, "version": version, "entryPath": cloudAgentSkillEntryPath, "files": files,
			"guidance": "先读取 SKILL.md，再只读取入口明确引用且当前任务需要的参考文件。只能读取 files 中列出的路径；不要重复列目录或猜测路径"}, nil
	}
	content := detail.Instruction
	if args.Path != cloudAgentSkillEntryPath {
		if !slices.Contains(files, args.Path) {
			shown := files
			if len(shown) > 40 {
				shown = shown[:40]
			}
			return nil, BadAuthRequest(fmt.Sprintf("技能里没有这个可读文件；可读路径：%s。不要猜路径", strings.Join(shown, ", ")))
		}
		file, err := s.SkillPackageFile(userID, id, args.Path)
		if err != nil {
			return nil, err
		}
		if file.Binary {
			return nil, BadAuthRequest("不支持读取二进制技能文件")
		}
		latest, err := s.SkillDetail(userID, id)
		if err != nil {
			return nil, err
		}
		if !latest.IsAdded || latest.Status != 1 || latest.VersionID != version {
			return nil, creationConflict("技能在读取过程中更新或被卸载，本轮不再读取它")
		}
		content = file.Content
	}
	page, err := cloudAgentSkillPage(version, args.Path, content, args.Offset)
	if err != nil {
		return nil, err
	}
	if fields, ok := page.(map[string]any); ok {
		fields["skillId"], fields["skillName"] = id, detail.SkillName
	}
	if err := s.skillDomain().RecordSkillAgentUse(userID, []string{id}); err != nil {
		log.Printf("agent skill usage record: %v", err)
	}
	return page, nil
}

func (s *Service) cloudAgentSkillSnapshot(userID, id string, requireAdded bool) (cloudAgentSkill, error) {
	skill, err := s.SkillDetail(userID, id)
	if err != nil {
		return cloudAgentSkill{}, err
	}
	if skill.Status != 1 || requireAdded && !skill.IsAdded {
		return cloudAgentSkill{}, BadAuthRequest("技能不可用")
	}
	snapshot := cloudAgentSkill{ID: id, Name: skill.SkillName, Description: skill.Description, Version: skill.VersionID, Hash: skill.ContentHash, Files: map[string]string{cloudAgentSkillEntryPath: ""}}
	files, err := s.SkillPackageFiles(userID, id)
	if err != nil {
		return cloudAgentSkill{}, err
	}
	for _, file := range files {
		if file.Path == cloudAgentSkillEntryPath {
			continue
		}
		if strings.HasSuffix(file.Path, ".md") || strings.HasSuffix(file.Path, ".txt") || strings.HasSuffix(file.Path, ".json") {
			snapshot.Files[file.Path] = ""
		}
	}
	latest, err := s.SkillDetail(userID, id)
	if err != nil {
		return cloudAgentSkill{}, err
	}
	if latest.VersionID != skill.VersionID || latest.ContentHash != skill.ContentHash {
		return cloudAgentSkill{}, creationConflict("技能在读取时已更新，请重试")
	}
	return snapshot, nil
}

// cloudAgentSkillCatalogPage 逐页读取一个 scope 的可见技能，直到 HasMore 为 false。
// 只取第一页时，排在单页上限（80）之后的技能永远搜不到。
func (s *Service) cloudAgentSkillCatalogPage(userID, scope string) ([]SkillItem, error) {
	return cloudAgentSkillCatalogPages(func(page int) (*SkillList, error) {
		return s.Skills(userID, SkillListRequest{Scope: scope, Page: page, PageSize: cloudAgentSkillCatalogLimit})
	})
}

// cloudAgentSkillCatalogPages 只以 HasMore 结束，不设页数上限：任何上限都会让超出的技能静默搜不到。
func cloudAgentSkillCatalogPages(fetch func(page int) (*SkillList, error)) ([]SkillItem, error) {
	items := make([]SkillItem, 0, cloudAgentSkillCatalogLimit)
	for page := 1; ; page++ {
		list, err := fetch(page)
		if err != nil {
			return nil, err
		}
		items = append(items, list.Skills...)
		if !list.HasMore {
			break
		}
		// 空页却声明还有更多：分页自相矛盾，宁可报错也不返回不完整目录冒充完整。
		if len(list.Skills) == 0 {
			return nil, errors.New("技能目录分页异常：空页但仍有更多结果")
		}
	}
	return items, nil
}

func (s *Service) cloudAgentSearchMarketplaceSkills(userID string, state *cloudAgentRuntime, keyword string, limit int) (map[string]any, error) {
	if strings.TrimSpace(keyword) == "" {
		return map[string]any{"matches": []map[string]any{}, "total": 0,
			"guidance": "请用当前任务、商品和目标的关键词检索技能；未提供关键词时不要固定任意技能。"}, nil
	}
	if limit <= 0 || limit > cloudAgentSkillReferenceMax {
		limit = cloudAgentSkillReferenceMax
	}
	if state == nil {
		return nil, errors.New("Agent 只读工具缺少运行时状态")
	}
	catalog := make([]cloudAgentSkill, 0, cloudAgentSkillCatalogLimit)
	seen := make(map[string]bool, cloudAgentSkillCatalogLimit)
	for _, scope := range []string{"public", "created"} {
		items, err := s.cloudAgentSkillCatalogPage(userID, scope)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if item.Status != 1 || seen[item.SkillID] || !cloudAgentSkillReferenceEligible(state, item) {
				continue
			}
			seen[item.SkillID] = true
			catalog = append(catalog, cloudAgentSkill{ID: item.SkillID, Name: item.SkillName, Description: item.Description, Version: item.VersionID, Hash: item.ContentHash, Files: map[string]string{cloudAgentSkillEntryPath: ""}})
		}
	}
	indexed, err := cloudAgentSearchSkills(catalog, keyword, limit)
	if err != nil {
		return nil, err
	}
	matches := indexed["matches"].([]map[string]any)
	frozen := make([]cloudAgentSkill, 0, len(matches))
	for _, match := range matches {
		// 零命中会降级成整池索引（没有 score）；参考技能只在真命中时冻结，
		// 否则广场会把无关技能冻结进本轮参考池。
		if score, scored := match["score"].(int); !scored || score <= 0 {
			continue
		}
		id, _ := match["skillId"].(string)
		var snapshot cloudAgentSkill
		for _, existing := range state.SkillReferences {
			if existing.ID == id {
				snapshot = existing
				break
			}
		}
		if snapshot.ID == "" {
			if len(state.SkillReferences) >= cloudAgentSkillReferenceMax {
				break
			}
			var err error
			snapshot, err = s.cloudAgentSkillSnapshot(userID, id, false)
			if err != nil {
				return nil, err
			}
			state.SkillReferences = append(state.SkillReferences, snapshot)
		}
		frozen = append(frozen, snapshot)
	}
	return cloudAgentSearchSkills(frozen, keyword, limit)
}

// cloudAgentSkillReferenceEligible 判断一个广场技能能否被冻结成本轮参考技能。
// 黑名单严格按三条：SkillVersions 的 key（已装技能走冻结版本，运行中更新或卸载后
// 也不得从公开/自建分支绕回来）、Skills 的固定技能、以及 AgentMode=manual
// （用户明确要求只在点名或固定时使用）。
func cloudAgentSkillReferenceEligible(state *cloudAgentRuntime, item SkillItem) bool {
	if state == nil || item.Status != 1 {
		return false
	}
	id := item.SkillID
	if id == "" {
		return false
	}
	if _, installed := state.SkillVersions[id]; installed {
		return false
	}
	for _, pinned := range state.Skills {
		if pinned.ID == id {
			return false
		}
	}
	return item.AgentMode != model.UserSkillAgentModeManual
}

// cloudAgentSkillReferencesAvailable 报告技能广场里是否存在可参考的候选（公开或自建、未安装）。
// 建 run 时用它覆盖「用户没有预装技能」的场景：只要广场有候选，技能工具就该对本轮可见。
// 只探测第一页：检索本身会翻完全部页面，这里只需要一个「非空」的可靠信号。
// 无候选返回 (false, nil)；目录读取失败必须冒泡，不能吞成「工具不可用」。
func (s *Service) cloudAgentSkillReferencesAvailable(userID string) (bool, error) {
	for _, scope := range []string{"public", "created"} {
		list, err := s.Skills(userID, SkillListRequest{Scope: scope, Page: 1, PageSize: cloudAgentSkillCatalogLimit})
		if err != nil {
			return false, err
		}
		for _, item := range list.Skills {
			if cloudAgentSkillReferenceEligible(&cloudAgentRuntime{}, item) {
				return true, nil
			}
		}
	}
	return false, nil
}

// cloudAgentSearchSkillsForRun 是本轮 skill_search 的完整检索：
// 已安装 opt-in 池 ∪ 本轮已冻结的参考技能，零正分命中时再向技能广场扩展（冻结，不安装）。
// 扩展只认正分命中，降级索引里的整池候选不会被冻结成参考技能。
func (s *Service) cloudAgentSearchSkillsForRun(userID string, state *cloudAgentRuntime, keyword string, limit int) (map[string]any, error) {
	if state == nil {
		return nil, errors.New("Agent 只读工具缺少运行时状态")
	}
	pool, err := s.cloudAgentSkillPoolForSearch(userID, state)
	if err != nil {
		return nil, err
	}
	merged := append(append([]cloudAgentSkill{}, pool...), state.SkillReferences...)
	result, err := cloudAgentSearchSkills(merged, keyword, limit)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(keyword) == "" || cloudAgentSearchHasPositiveHit(result) {
		return result, nil
	}
	// 本轮可用技能没有真正命中：去广场找未安装的候选并冻结成本轮参考技能。
	discovered, err := s.cloudAgentDiscoverSkillReferences(userID, state, keyword, limit)
	if err != nil {
		return nil, err
	}
	if len(discovered) == 0 {
		return result, nil
	}
	merged = append(merged, discovered...)
	return cloudAgentSearchSkills(merged, keyword, limit)
}

// cloudAgentSearchHasPositiveHit 判断检索结果里是否存在真命中（有 score 且为正）。
// 空关键词索引与零命中降级索引都没有 score，都不是「找到了」。
func cloudAgentSearchHasPositiveHit(result map[string]any) bool {
	matches, _ := result["matches"].([]map[string]any)
	for _, match := range matches {
		if score, ok := match["score"].(int); ok && score > 0 {
			return true
		}
	}
	return false
}

// cloudAgentDiscoverSkillReferences 在技能广场（公开 + 自建）里检索未安装候选，
// 把正分命中按上限冻结进 state.SkillReferences 并返回本次新增的条目。永不安装技能。
func (s *Service) cloudAgentDiscoverSkillReferences(userID string, state *cloudAgentRuntime, keyword string, limit int) ([]cloudAgentSkill, error) {
	remaining := cloudAgentSkillReferenceMax - len(state.SkillReferences)
	if remaining <= 0 {
		return nil, nil
	}
	catalog := make([]cloudAgentSkill, 0, cloudAgentSkillCatalogLimit)
	seen := make(map[string]bool, cloudAgentSkillCatalogLimit)
	for _, scope := range []string{"public", "created"} {
		items, err := s.cloudAgentSkillCatalogPage(userID, scope)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if seen[item.SkillID] || !cloudAgentSkillReferenceEligible(state, item) {
				continue
			}
			seen[item.SkillID] = true
			catalog = append(catalog, cloudAgentSkill{ID: item.SkillID, Name: item.SkillName, Description: item.Description, Version: item.VersionID, Hash: item.ContentHash, Files: map[string]string{cloudAgentSkillEntryPath: ""}})
		}
	}
	if len(catalog) == 0 {
		return nil, nil
	}
	indexed, err := cloudAgentSearchSkills(catalog, keyword, limit)
	if err != nil {
		return nil, err
	}
	matches, _ := indexed["matches"].([]map[string]any)
	discovered := make([]cloudAgentSkill, 0, remaining)
	for _, match := range matches {
		if len(discovered) >= remaining {
			break
		}
		if score, ok := match["score"].(int); !ok || score <= 0 {
			continue
		}
		id, _ := match["skillId"].(string)
		if id == "" {
			continue
		}
		snapshot, err := s.cloudAgentSkillSnapshot(userID, id, false)
		if err != nil {
			return nil, err
		}
		state.SkillReferences = append(state.SkillReferences, snapshot)
		discovered = append(discovered, snapshot)
	}
	return discovered, nil
}

// cloudAgentReadSkillFileForRun 是本轮 skill_read_file 的完整读取：
// 本轮已安装技能（冻结版本）优先，其次是本轮冻结的广场参考技能（只读引用，不要求已安装）。
func (s *Service) cloudAgentReadSkillFileForRun(userID string, state *cloudAgentRuntime, args agenttool.SkillReadArgs) (any, error) {
	if state == nil {
		return nil, errors.New("Agent 只读工具缺少运行时状态")
	}
	id := strings.TrimSpace(args.SkillID)
	if id == "" {
		return nil, BadAuthRequest("技能不在本轮可用范围：只能读取已安装且允许自动使用、或本轮固定的技能。先看技能目录或用 skill_search 找到 skillId")
	}
	if _, installed := state.SkillVersions[id]; installed {
		return s.cloudAgentReadSkillFile(userID, state, args)
	}
	for _, ref := range state.SkillReferences {
		if ref.ID == id {
			return s.cloudAgentReadSkillReferenceFile(userID, ref, args)
		}
	}
	return nil, BadAuthRequest("技能不在本轮可用范围：只能读取已安装且允许自动使用、或本轮固定的技能。先看技能目录或用 skill_search 找到 skillId")
}

// cloudAgentReadSkillReferenceFile 读取本轮冻结的参考技能文件。
// 不要求 IsAdded——参考技能本来就没安装；但必须仍启用、版本与内容哈希与冻结值一致，
// 且只能读冻结清单里的路径。参考技能不计入技能使用次数（它不在用户技能库里）。
func (s *Service) cloudAgentReadSkillReferenceFile(userID string, ref cloudAgentSkill, args agenttool.SkillReadArgs) (any, error) {
	if ref.Version == "" || ref.Hash == "" {
		return nil, errors.New("本轮参考技能缺少冻结版本")
	}
	detail, err := s.SkillDetail(userID, ref.ID)
	if err != nil {
		return nil, err
	}
	if detail.Status != 1 {
		return nil, BadAuthRequest("技能已被卸载或停用，本轮不能再读取")
	}
	if detail.VersionID != ref.Version || detail.ContentHash != ref.Hash {
		return nil, creationConflict("技能在本轮开始后更新了；为避免混读两个版本，本轮不再读取它，下一条消息会使用新版本")
	}
	paths := cloudAgentSkillPaths(ref)
	files := make([]string, 0, len(paths))
	for _, path := range paths {
		files = append(files, path)
	}
	if args.Path == "" {
		return map[string]any{"skillId": ref.ID, "skillName": ref.Name, "version": ref.Version, "entryPath": cloudAgentSkillEntryPath, "files": files,
			"guidance": "先读取 SKILL.md，再只读取入口明确引用且当前任务需要的参考文件。只能读取 files 中列出的路径；不要重复列目录或猜测路径"}, nil
	}
	if !slices.Contains(paths, args.Path) {
		shown := files
		if len(shown) > 40 {
			shown = shown[:40]
		}
		return nil, BadAuthRequest(fmt.Sprintf("技能里没有这个可读文件；可读路径：%s。不要猜路径", strings.Join(shown, ", ")))
	}
	file, err := s.SkillPackageFile(userID, ref.ID, args.Path)
	if err != nil {
		return nil, err
	}
	if file.Binary {
		return nil, BadAuthRequest("不支持读取二进制技能文件")
	}
	latest, err := s.SkillDetail(userID, ref.ID)
	if err != nil {
		return nil, err
	}
	if latest.Status != 1 || latest.VersionID != ref.Version || latest.ContentHash != ref.Hash {
		return nil, creationConflict("技能在读取过程中更新或被卸载，本轮不再读取它")
	}
	page, err := cloudAgentSkillPage(ref.Version, args.Path, file.Content, args.Offset)
	if err != nil {
		return nil, err
	}
	if fields, ok := page.(map[string]any); ok {
		fields["skillId"], fields["skillName"] = ref.ID, ref.Name
	}
	return page, nil
}
