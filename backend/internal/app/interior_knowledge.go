package app

import (
	"strings"
	"sync"

	"yingce/backend/internal/interior"
	"yingce/backend/internal/model"
)

// 室内设计知识库的读取：前台按范围、空间、风格和需求取相关条目写进 AI 分析和 3D 建模的提示词，
// 后台能看全部条目。知识随程序发布，不入库。

const interiorKnowledgeTextLimit = 1000

var interiorScopes = map[string]bool{"room": true, "home": true, "building": true}

var builtinInteriorKnowledge = sync.OnceValues(interior.BuiltinKnowledge)

type InteriorKnowledgeQuery struct {
	Scope  string
	Rooms  []string
	Styles []string
	Text   string
}

// InteriorKnowledgeView 是一条知识；KindName 是类别的中文名。
type InteriorKnowledgeView struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"`
	KindName string   `json:"kindName"`
	Title    string   `json:"title"`
	Guidance string   `json:"guidance"`
	Scopes   []string `json:"scopes,omitempty"`
	Rooms    []string `json:"rooms,omitempty"`
	Styles   []string `json:"styles,omitempty"`
	Tags     []string `json:"tags,omitempty"`
}

func interiorKnowledgeView(entry interior.KnowledgeEntry, admin bool) InteriorKnowledgeView {
	view := InteriorKnowledgeView{ID: entry.ID, Kind: entry.Kind, KindName: interior.KnowledgeKindName(entry.Kind), Title: entry.Title, Guidance: entry.Guidance}
	if admin {
		view.Scopes, view.Rooms, view.Styles, view.Tags = entry.Scopes, entry.Rooms, entry.Styles, entry.Tags
	}
	return view
}

func cleanInteriorKeys(values []string, limit int) ([]string, error) {
	keys := make([]string, 0, len(values))
	for _, value := range values {
		for _, key := range strings.Split(value, ",") {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			if !interior.ValidKey(key) {
				return nil, BadAuthRequest("空间或风格标识无效")
			}
			keys = append(keys, key)
		}
	}
	if len(keys) > limit {
		return nil, BadAuthRequest("一次最多按 12 个空间或风格取知识")
	}
	return keys, nil
}

// InteriorKnowledge 按条件取相关知识（最多 16 条），要求登录并打开「室内设计」。
func (s *Service) InteriorKnowledge(actor *model.User, query InteriorKnowledgeQuery) ([]InteriorKnowledgeView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureInterior); err != nil {
		return nil, err
	}
	scope := strings.TrimSpace(query.Scope)
	if scope != "" && !interiorScopes[scope] {
		return nil, BadAuthRequest("范围须为 room、home 或 building")
	}
	rooms, err := cleanInteriorKeys(query.Rooms, 12)
	if err != nil {
		return nil, err
	}
	styles, err := cleanInteriorKeys(query.Styles, 12)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(query.Text)
	if len([]rune(text)) > interiorKnowledgeTextLimit {
		text = string([]rune(text)[:interiorKnowledgeTextLimit])
	}
	entries, err := builtinInteriorKnowledge()
	if err != nil {
		return nil, err
	}
	picked := interior.RetrieveKnowledge(entries, interior.KnowledgeQuery{Scope: scope, RoomKeys: rooms, StyleKeys: styles, Text: text})
	views := make([]InteriorKnowledgeView, 0, len(picked))
	for _, entry := range picked {
		views = append(views, interiorKnowledgeView(entry, false))
	}
	return views, nil
}

// AdminInteriorKnowledge 给后台看全部内置知识和每条的适用范围、空间、风格和关键词。
func (s *Service) AdminInteriorKnowledge(actor *model.User) ([]InteriorKnowledgeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	entries, err := builtinInteriorKnowledge()
	if err != nil {
		return nil, err
	}
	views := make([]InteriorKnowledgeView, 0, len(entries))
	for _, entry := range entries {
		views = append(views, interiorKnowledgeView(entry, true))
	}
	return views, nil
}
