package interior

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// 室内设计知识库：随程序发布的尺寸规范、家具尺寸、动线间距、风格配色和建模要点。
// AI 方案分析和 3D 建模按范围、空间、风格和需求里的关键词取出相关条目，写进提示词当参考数据。

//go:embed knowledge.json
var knowledgeJSON []byte

const (
	KnowledgeBuilding  = "building"
	KnowledgeDimension = "dimension"
	KnowledgeFurniture = "furniture"
	KnowledgeClearance = "clearance"
	KnowledgeLighting  = "lighting"
	KnowledgeStyle     = "style"
	KnowledgeModeling  = "modeling"
)

// knowledgeKindLimit 是每一类最多取几条，避免一类知识挤占整段参考数据。
var knowledgeKindLimit = map[string]int{KnowledgeBuilding: 8, KnowledgeDimension: 4, KnowledgeFurniture: 3, KnowledgeClearance: 2, KnowledgeLighting: 1, KnowledgeStyle: 2, KnowledgeModeling: 2}

var knowledgeKindNames = map[string]string{KnowledgeBuilding: "建筑与结构", KnowledgeDimension: "空间尺寸", KnowledgeFurniture: "家具尺寸", KnowledgeClearance: "动线间距", KnowledgeLighting: "灯光", KnowledgeStyle: "风格配色", KnowledgeModeling: "建模要点"}

const knowledgeMaxEntries = 16

type KnowledgeEntry struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"`
	Title    string   `json:"title"`
	Scopes   []string `json:"scopes,omitempty"`
	Rooms    []string `json:"rooms,omitempty"`
	Styles   []string `json:"styles,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Guidance string   `json:"guidance"`
}

// KnowledgeQuery 是取知识的条件：范围（room/home/building）、空间和风格的标识、需求原文。
type KnowledgeQuery struct {
	Scope     string
	RoomKeys  []string
	StyleKeys []string
	Text      string
}

func KnowledgeKindName(kind string) string {
	return knowledgeKindNames[kind]
}

// BuiltinKnowledge 读内置知识库并校验：标识唯一、类别已知、正文非空。
func BuiltinKnowledge() ([]KnowledgeEntry, error) {
	var file struct {
		Entries []KnowledgeEntry `json:"entries"`
	}
	if err := json.Unmarshal(knowledgeJSON, &file); err != nil {
		return nil, fmt.Errorf("室内设计知识库格式无效：%w", err)
	}
	seen := map[string]bool{}
	for _, entry := range file.Entries {
		if !ValidKey(entry.ID) || seen[entry.ID] {
			return nil, fmt.Errorf("室内设计知识条目标识无效或重复：%s", entry.ID)
		}
		seen[entry.ID] = true
		if _, ok := knowledgeKindLimit[entry.Kind]; !ok || strings.TrimSpace(entry.Title) == "" || strings.TrimSpace(entry.Guidance) == "" {
			return nil, fmt.Errorf("室内设计知识条目 %s 缺少类别、标题或正文", entry.ID)
		}
	}
	return file.Entries, nil
}

// RetrieveKnowledge 按条件给条目打分后取出：指定的空间、风格直接命中；范围、关键词命中加分；
// 什么条件都不挂的通用条目（家具、动线、建模要点）分低一些但也能进来。每类有上限，总数不超过 16 条。
func RetrieveKnowledge(entries []KnowledgeEntry, query KnowledgeQuery) []KnowledgeEntry {
	text := strings.ToLower(query.Text)
	type scored struct {
		entry KnowledgeEntry
		score int
		order int
	}
	candidates := make([]scored, 0, len(entries))
	for index, entry := range entries {
		score := 0
		roomHit := intersects(entry.Rooms, query.RoomKeys)
		styleHit := intersects(entry.Styles, query.StyleKeys)
		scopeHit := query.Scope != "" && slices.Contains(entry.Scopes, query.Scope)
		tagHits := 0
		for _, tag := range entry.Tags {
			if tag != "" && strings.Contains(text, strings.ToLower(tag)) {
				tagHits++
			}
		}
		switch {
		case roomHit:
			score += 40
		case len(entry.Rooms) > 0 && tagHits == 0:
			// 写了适用空间、但和这次的空间、需求都不沾边的条目不要。
			continue
		}
		switch {
		case styleHit:
			score += 40
		case len(entry.Styles) > 0:
			// 风格条目只给选中或需求里写到的风格。
			if tagHits == 0 {
				continue
			}
			score += 20
		}
		if len(entry.Scopes) > 0 {
			if !scopeHit && tagHits == 0 {
				continue
			}
			if scopeHit {
				// 只适用于这一种范围的条目（例如只对建筑外观的屋顶做法）比几种范围通用的更要紧。
				score += 25
				if len(entry.Scopes) == 1 {
					score += 15
				}
			}
		}
		score += tagHits * 12
		if len(entry.Rooms) == 0 && len(entry.Styles) == 0 && len(entry.Scopes) == 0 {
			score += 8
		}
		if score > 0 {
			candidates = append(candidates, scored{entry: entry, score: score, order: index})
		}
	}
	slices.SortStableFunc(candidates, func(left, right scored) int {
		if left.score != right.score {
			return right.score - left.score
		}
		return left.order - right.order
	})
	picked := make([]KnowledgeEntry, 0, knowledgeMaxEntries)
	perKind := map[string]int{}
	for _, candidate := range candidates {
		if len(picked) >= knowledgeMaxEntries {
			break
		}
		if perKind[candidate.entry.Kind] >= knowledgeKindLimit[candidate.entry.Kind] {
			continue
		}
		perKind[candidate.entry.Kind]++
		picked = append(picked, candidate.entry)
	}
	return picked
}

func intersects(values, wanted []string) bool {
	for _, value := range values {
		if slices.Contains(wanted, value) {
			return true
		}
	}
	return false
}
