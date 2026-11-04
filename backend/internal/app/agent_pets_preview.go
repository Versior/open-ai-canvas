package app

import (
	"slices"
	"sync"

	"yingce/backend/internal/agentpet"
	"yingce/backend/internal/model"
)

// 列表缩略图：商店、换形象菜单和后台列表先显示一帧静态 PNG（几十 KB），悬停或选中时才加载整张图集（1–3 MB）。
// 缩略图只由图集内容和待机动作行决定，按“图集版本:行”缓存在进程内；换图集时版本跟着变，不会用到旧图。
const (
	agentPetPreviewCacheLimit = 1024
	// 同时解码的图集数：一张 v2 图集解码后约 14 MB，限制并发避免打开商店时内存和 CPU 突增。
	agentPetPreviewDecodeSlots = 2
)

var agentPetPreviews = &agentPetPreviewCache{entries: map[string]*agentPetPreviewEntry{}, slots: make(chan struct{}, agentPetPreviewDecodeSlots)}

type agentPetPreviewCache struct {
	mu      sync.Mutex
	entries map[string]*agentPetPreviewEntry
	slots   chan struct{}
}

type agentPetPreviewEntry struct {
	once sync.Once
	data []byte
	err  error
}

// get 同一个键只生成一次；生成失败不缓存，下次请求重试。
func (cache *agentPetPreviewCache) get(key string, build func() ([]byte, error)) ([]byte, error) {
	cache.mu.Lock()
	entry := cache.entries[key]
	if entry == nil {
		if len(cache.entries) >= agentPetPreviewCacheLimit {
			for stale := range cache.entries {
				delete(cache.entries, stale)
				break
			}
		}
		entry = &agentPetPreviewEntry{}
		cache.entries[key] = entry
	}
	cache.mu.Unlock()
	entry.once.Do(func() {
		cache.slots <- struct{}{}
		defer func() { <-cache.slots }()
		entry.data, entry.err = build()
	})
	if entry.err != nil {
		cache.mu.Lock()
		if cache.entries[key] == entry {
			delete(cache.entries, key)
		}
		cache.mu.Unlock()
	}
	return entry.data, entry.err
}

// AgentPetPreview 返回列表缩略图：待机动作（含后台的状态映射）里第一格有画面的帧。读取权限与图集相同。
func (s *Service) AgentPetPreview(actor *model.User, petID string) (*AgentPetSheet, error) {
	entry, err := s.readableAgentPetEntry(actor, petID)
	if err != nil {
		return nil, err
	}
	rowName := entry.stateRows["idle"]
	if rowName == "" {
		rowName = "idle"
	}
	row := max(0, slices.Index(agentpet.Rows, rowName))
	data, err := agentPetPreviews.get(agentPetPreviewVersion(entry.revision, rowName), func() ([]byte, error) {
		sheet, _, err := s.agentPetSheetData(entry)
		if err != nil {
			return nil, err
		}
		return agentpet.PreviewFrame(sheet, row)
	})
	if err != nil {
		return nil, err
	}
	return &AgentPetSheet{Data: data, MimeType: "image/png", Revision: agentPetPreviewVersion(entry.revision, rowName)}, nil
}

// agentPetPreviewVersion 是缩略图的缓存版本：图集版本，待机改用别的动作时再加上动作名。
// 前端 agentPetPreviewURL 按同样的规则拼 v 参数，状态映射改了以后浏览器不会继续用旧缩略图。
func agentPetPreviewVersion(revision, idleRow string) string {
	if idleRow == "idle" {
		return revision
	}
	return revision + "." + idleRow
}
