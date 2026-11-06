package app

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/interior"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 室内设计知识库：前台按范围、空间、风格和需求取启用的相关条目写进 AI 分析和 3D 建模的提示词；
// 后台可以修改、停用、新增和删除条目。内置条目来自程序自带的 knowledge.json，启动时补进数据库，
// 管理员没改过的内置条目随版本更新，改过的保持原样，可以「恢复内置内容」。

const interiorKnowledgeTextLimit = 1000

var interiorScopes = map[string]bool{"room": true, "home": true, "building": true}

var builtinInteriorKnowledge = sync.OnceValues(interior.BuiltinKnowledge)

type InteriorKnowledgeQuery struct {
	Scope  string
	Rooms  []string
	Styles []string
	Text   string
}

type InteriorKnowledgeInput = interior.KnowledgeInput

// InteriorKnowledgeView 是前台取到的一条知识；ID 是条目标识，KindName 是类别的中文名。
type InteriorKnowledgeView struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	KindName string `json:"kindName"`
	Title    string `json:"title"`
	Guidance string `json:"guidance"`
}

// AdminInteriorKnowledgeView 是后台的一条知识：ID 是记录 ID，Key 是条目标识（项目里记的是它）。
type AdminInteriorKnowledgeView struct {
	ID        string    `json:"id"`
	Key       string    `json:"key"`
	Kind      string    `json:"kind"`
	KindName  string    `json:"kindName"`
	Title     string    `json:"title"`
	Guidance  string    `json:"guidance"`
	Scopes    []string  `json:"scopes"`
	Rooms     []string  `json:"rooms"`
	Styles    []string  `json:"styles"`
	Tags      []string  `json:"tags"`
	SortOrder int       `json:"sortOrder"`
	Enabled   bool      `json:"enabled"`
	Builtin   bool      `json:"builtin"`
	Edited    bool      `json:"edited"`
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// InteriorKnowledgeKind 是一个类别：每次最多取几条。
type InteriorKnowledgeKind struct {
	Value string `json:"value"`
	Label string `json:"label"`
	Limit int    `json:"limit"`
}

func interiorKnowledgeKinds() []InteriorKnowledgeKind {
	kinds := make([]InteriorKnowledgeKind, 0, len(interior.KnowledgeKinds))
	for _, kind := range interior.KnowledgeKinds {
		kinds = append(kinds, InteriorKnowledgeKind{Value: kind, Label: interior.KnowledgeKindName(kind), Limit: interior.KnowledgeKindLimit(kind)})
	}
	return kinds
}

func encodeInteriorList(values []string) string {
	if len(values) == 0 {
		return ""
	}
	raw, _ := json.Marshal(values)
	return string(raw)
}

func decodeInteriorList(raw string) []string {
	var values []string
	if interior.DecodeJSON(raw, &values) != nil || values == nil {
		return []string{}
	}
	return values
}

func interiorKnowledgeFields(item *model.InteriorKnowledgeEntry, input InteriorKnowledgeInput) {
	item.Kind, item.Title, item.Guidance = input.Kind, input.Title, input.Guidance
	item.ScopesJSON, item.RoomsJSON = encodeInteriorList(input.Scopes), encodeInteriorList(input.Rooms)
	item.StylesJSON, item.TagsJSON = encodeInteriorList(input.Styles), encodeInteriorList(input.Tags)
	item.SortOrder, item.Enabled = input.SortOrder, input.Enabled
}

// interiorKnowledgeContentEqual 比较会写进提示词、影响取知识的字段；排序和启用不算内容。
func interiorKnowledgeContentEqual(left, right *model.InteriorKnowledgeEntry) bool {
	return left.Kind == right.Kind && left.Title == right.Title && left.Guidance == right.Guidance && left.ScopesJSON == right.ScopesJSON &&
		left.RoomsJSON == right.RoomsJSON && left.StylesJSON == right.StylesJSON && left.TagsJSON == right.TagsJSON
}

func interiorKnowledgeEntry(item model.InteriorKnowledgeEntry) interior.KnowledgeEntry {
	return interior.KnowledgeEntry{ID: item.Key, Kind: item.Kind, Title: item.Title, Guidance: item.Guidance, Scopes: decodeInteriorList(item.ScopesJSON), Rooms: decodeInteriorList(item.RoomsJSON), Styles: decodeInteriorList(item.StylesJSON), Tags: decodeInteriorList(item.TagsJSON)}
}

func adminInteriorKnowledgeView(item model.InteriorKnowledgeEntry) AdminInteriorKnowledgeView {
	entry := interiorKnowledgeEntry(item)
	return AdminInteriorKnowledgeView{
		ID: item.ID, Key: item.Key, Kind: item.Kind, KindName: interior.KnowledgeKindName(item.Kind), Title: item.Title, Guidance: item.Guidance,
		Scopes: entry.Scopes, Rooms: entry.Rooms, Styles: entry.Styles, Tags: entry.Tags,
		SortOrder: item.SortOrder, Enabled: item.Enabled, Builtin: item.Builtin, Edited: item.Edited, Version: item.Version, UpdatedAt: item.UpdatedAt,
	}
}

// builtinInteriorKnowledgeModels 把程序自带的条目转成记录；排序按文件里的先后，每条隔 10 方便插入。
func builtinInteriorKnowledgeModels(now time.Time) ([]model.InteriorKnowledgeEntry, error) {
	entries, err := builtinInteriorKnowledge()
	if err != nil {
		return nil, err
	}
	items := make([]model.InteriorKnowledgeEntry, 0, len(entries))
	for index, entry := range entries {
		item := model.InteriorKnowledgeEntry{ID: kernel.NewID(), Key: entry.ID, Builtin: true, Version: 1, CreatedAt: now, UpdatedAt: now}
		interiorKnowledgeFields(&item, InteriorKnowledgeInput{Kind: entry.Kind, Title: entry.Title, Guidance: entry.Guidance, Scopes: entry.Scopes, Rooms: entry.Rooms, Styles: entry.Styles, Tags: entry.Tags, SortOrder: (index + 1) * 10, Enabled: true})
		items = append(items, item)
	}
	return items, nil
}

// EnsureBuiltinInteriorKnowledge 在启动时补齐内置知识，并更新管理员没改过的内置条目。
func (s *Service) EnsureBuiltinInteriorKnowledge() (int, int, error) {
	items, err := builtinInteriorKnowledgeModels(time.Now().UTC())
	if err != nil {
		return 0, 0, err
	}
	return s.repo.EnsureInteriorKnowledge(items)
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

// InteriorKnowledge 按条件取启用的相关知识（最多 16 条），要求登录并打开「室内设计」。
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
	rows, err := s.repo.InteriorKnowledgeEntries(true)
	if err != nil {
		return nil, err
	}
	entries := make([]interior.KnowledgeEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, interiorKnowledgeEntry(row))
	}
	picked := interior.RetrieveKnowledge(entries, interior.KnowledgeQuery{Scope: scope, RoomKeys: rooms, StyleKeys: styles, Text: text})
	views := make([]InteriorKnowledgeView, 0, len(picked))
	for _, entry := range picked {
		views = append(views, InteriorKnowledgeView{ID: entry.ID, Kind: entry.Kind, KindName: interior.KnowledgeKindName(entry.Kind), Title: entry.Title, Guidance: entry.Guidance})
	}
	return views, nil
}

// AdminInteriorKnowledge 列出全部条目（含停用的）和类别。
func (s *Service) AdminInteriorKnowledge(actor *model.User) ([]AdminInteriorKnowledgeView, []InteriorKnowledgeKind, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, nil, err
	}
	rows, err := s.repo.InteriorKnowledgeEntries(false)
	if err != nil {
		return nil, nil, err
	}
	views := make([]AdminInteriorKnowledgeView, 0, len(rows))
	for _, row := range rows {
		views = append(views, adminInteriorKnowledgeView(row))
	}
	return views, interiorKnowledgeKinds(), nil
}

func (s *Service) interiorKnowledgeRow(id string) (*model.InteriorKnowledgeEntry, error) {
	item, err := s.repo.InteriorKnowledgeEntry(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("知识条目不存在")
	}
	return item, err
}

// CreateInteriorKnowledge 新增一条知识；标识不能和已有条目（含内置的）重复。
func (s *Service) CreateInteriorKnowledge(actor *model.User, input InteriorKnowledgeInput) (*AdminInteriorKnowledgeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	input, err := interior.NormalizeKnowledgeInput(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	exists, err := s.repo.InteriorKnowledgeKeyExists(input.Key)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, BadAuthRequest("知识标识已存在")
	}
	now := time.Now().UTC()
	item := model.InteriorKnowledgeEntry{ID: kernel.NewID(), Key: input.Key, Version: 1, CreatedBy: actor.ID, UpdatedBy: actor.ID, CreatedAt: now, UpdatedAt: now}
	interiorKnowledgeFields(&item, input)
	if err := s.repo.CreateInteriorKnowledgeEntry(&item); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_knowledge.create", "interior_knowledge", item.ID, "新增室内设计知识："+item.Title, map[string]any{"key": item.Key, "kind": item.Kind}); err != nil {
		return nil, err
	}
	view := adminInteriorKnowledgeView(item)
	return &view, nil
}

// UpdateInteriorKnowledge 修改一条知识（标识不能改）。改了内置条目的内容会标成已修改，之后版本更新不再覆盖它；
// 只改启用或排序不算修改内容。
func (s *Service) UpdateInteriorKnowledge(actor *model.User, id string, input InteriorKnowledgeInput) (*AdminInteriorKnowledgeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, err := s.interiorKnowledgeRow(id)
	if err != nil {
		return nil, err
	}
	input.Key = current.Key
	input, err = interior.NormalizeKnowledgeInput(input)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if input.Version != current.Version {
		return nil, interiorVersionConflict(current.Version)
	}
	item := *current
	interiorKnowledgeFields(&item, input)
	item.Edited = current.Edited || (current.Builtin && !interiorKnowledgeContentEqual(&item, current))
	item.Version, item.UpdatedBy, item.UpdatedAt = current.Version+1, actor.ID, time.Now().UTC()
	if err := s.repo.SaveInteriorKnowledgeEntry(&item, current.Version); err != nil {
		if errors.Is(err, repository.ErrInteriorVersionConflict) {
			return nil, interiorVersionConflict(current.Version)
		}
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_knowledge.update", "interior_knowledge", item.ID, "修改室内设计知识："+item.Title, map[string]any{"key": item.Key, "version": item.Version, "enabled": item.Enabled, "edited": item.Edited}); err != nil {
		return nil, err
	}
	view := adminInteriorKnowledgeView(item)
	return &view, nil
}

// DeleteInteriorKnowledge 删除管理员新增的条目；内置条目只能停用。
func (s *Service) DeleteInteriorKnowledge(actor *model.User, id string, version int) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	current, err := s.interiorKnowledgeRow(id)
	if err != nil {
		return err
	}
	if current.Builtin {
		return BadAuthRequest("内置条目不能删除，可以停用")
	}
	if version != current.Version {
		return interiorVersionConflict(current.Version)
	}
	if err := s.repo.DeleteInteriorKnowledgeEntry(current.ID, current.Version); err != nil {
		if errors.Is(err, repository.ErrInteriorVersionConflict) {
			return interiorVersionConflict(current.Version)
		}
		return err
	}
	return s.appendAdminAudit(actor, "interior_knowledge.delete", "interior_knowledge", current.ID, "删除室内设计知识："+current.Title, map[string]any{"key": current.Key})
}

// ResetInteriorKnowledge 把改过的内置条目恢复成程序自带的内容（启用状态不动），之后又跟随版本更新。
func (s *Service) ResetInteriorKnowledge(actor *model.User, id string, version int) (*AdminInteriorKnowledgeView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, err := s.interiorKnowledgeRow(id)
	if err != nil {
		return nil, err
	}
	if !current.Builtin {
		return nil, BadAuthRequest("只有内置条目可以恢复")
	}
	if version != current.Version {
		return nil, interiorVersionConflict(current.Version)
	}
	builtins, err := builtinInteriorKnowledgeModels(time.Now().UTC())
	if err != nil {
		return nil, err
	}
	index := slices.IndexFunc(builtins, func(item model.InteriorKnowledgeEntry) bool { return item.Key == current.Key })
	if index < 0 {
		return nil, BadAuthRequest("这一版程序里没有这条内置知识")
	}
	item := *current
	source := builtins[index]
	item.Kind, item.Title, item.Guidance, item.ScopesJSON, item.RoomsJSON, item.StylesJSON, item.TagsJSON, item.SortOrder = source.Kind, source.Title, source.Guidance, source.ScopesJSON, source.RoomsJSON, source.StylesJSON, source.TagsJSON, source.SortOrder
	item.Edited, item.Version, item.UpdatedBy, item.UpdatedAt = false, current.Version+1, actor.ID, time.Now().UTC()
	if err := s.repo.SaveInteriorKnowledgeEntry(&item, current.Version); err != nil {
		if errors.Is(err, repository.ErrInteriorVersionConflict) {
			return nil, interiorVersionConflict(current.Version)
		}
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "interior_knowledge.reset", "interior_knowledge", item.ID, "恢复室内设计内置知识："+item.Title, map[string]any{"key": item.Key, "version": item.Version}); err != nil {
		return nil, err
	}
	view := adminInteriorKnowledgeView(item)
	return &view, nil
}
