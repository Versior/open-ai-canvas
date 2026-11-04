package app

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

// 游客只读接口（功能开关、模型目录、LibTV 公开作品）的应用层实现。
// 这些都是展示数据：结果按 Service 实例缓存 60 秒，管理员改动最多延迟一分钟对游客可见。
// 生成、上传、保存、报价与导入仍走登录接口，这里不提供任何写入或计费入口。

const (
	guestReadCacheTTL     = time.Minute
	guestReadCacheMaxKeys = 512
)

type guestReadCacheEntry struct {
	value   any
	expires time.Time
}

type guestReadCache struct {
	mu      sync.Mutex
	entries map[string]guestReadCacheEntry
}

// 缓存挂在 Service 实例上而不改动上游的 Service 结构体；测试里每个实例各用一份。
var guestReadCaches sync.Map

func (s *Service) guestCache() *guestReadCache {
	value, _ := guestReadCaches.LoadOrStore(s, &guestReadCache{entries: map[string]guestReadCacheEntry{}})
	return value.(*guestReadCache)
}

func (c *guestReadCache) get(key string, now time.Time) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || !now.Before(entry.expires) {
		return nil, false
	}
	return entry.value, true
}

// put 限制键数量：关键词与 requestId 由请求方决定，满了先清过期项，仍满就整体清空，不让游客撑大内存。
func (c *guestReadCache) put(key string, value any, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= guestReadCacheMaxKeys {
		for existing, entry := range c.entries {
			if !now.Before(entry.expires) {
				delete(c.entries, existing)
			}
		}
		if len(c.entries) >= guestReadCacheMaxKeys {
			c.entries = map[string]guestReadCacheEntry{}
		}
	}
	c.entries[key] = guestReadCacheEntry{value: value, expires: now.Add(guestReadCacheTTL)}
}

// GuestFeatureAvailability 是游客可见的功能开关：只有开关和是否已配置，不含操作人与时间。
type GuestFeatureAvailability struct {
	FeatureAvailability
	Configured bool `json:"configured"`
}

func (s *Service) GuestFeatureAvailability() (*GuestFeatureAvailability, error) {
	value, err := s.FeatureAvailability()
	if err != nil {
		return nil, err
	}
	return &GuestFeatureAvailability{FeatureAvailability: value.FeatureAvailability, Configured: value.Configured}, nil
}

// GuestModelCatalog 是游客可见的模型目录：按默认分组的渠道可见性与价格展示，不附加可用率统计。
// 不使用 systemGroupAccess，它会放开渠道可见性，把只给特定分组的渠道暴露给游客。
func (s *Service) GuestModelCatalog() (*ModelCatalogResponse, error) {
	cache := s.guestCache()
	if cached, ok := cache.get("model-catalog", time.Now()); ok {
		return cached.(*ModelCatalogResponse), nil
	}
	group, err := s.resolvedUserGroup(model.DefaultUserGroupCode)
	if err != nil {
		return nil, err
	}
	channels, err := s.publicSystemChannelCatalog(&userGroupAccess{group: group}, nil)
	if err != nil {
		return nil, err
	}
	response := &ModelCatalogResponse{Source: ModelCatalogSourceSystem, Models: []PublicLogicalModel{}, Channels: channels}
	cache.put("model-catalog", response, time.Now())
	return response, nil
}

// GuestLibTVGallery 游客读取公开作品列表。首页不带 requestId 时共用缓存里的那一份，
// 返回的 requestId 也相同，所以游客翻后续页时命中同一组缓存，排序前后一致。
func (s *Service) GuestLibTVGallery(ctx context.Context, req LibTVGalleryRequest) (*LibTVGalleryResult, error) {
	key := fmt.Sprintf("libtv-gallery:%d:%d:%d:%s:%s", req.Page, req.PageSize, req.TagID, strings.TrimSpace(req.RequestID), strings.TrimSpace(req.Keyword))
	cache := s.guestCache()
	if cached, ok := cache.get(key, time.Now()); ok {
		return cached.(*LibTVGalleryResult), nil
	}
	result, err := s.authDomain().PublicLibTVGallery(ctx, req)
	if err != nil {
		return nil, err
	}
	cache.put(key, result, time.Now())
	return result, nil
}

// GuestLibTVWork 游客读取单个公开作品详情，按作品 UUID 缓存；导入画布仍要求登录。
func (s *Service) GuestLibTVWork(ctx context.Context, templateUUID string) (*LibTVWorkDetail, error) {
	key := "libtv-work:" + strings.TrimSpace(templateUUID)
	cache := s.guestCache()
	if cached, ok := cache.get(key, time.Now()); ok {
		return cached.(*LibTVWorkDetail), nil
	}
	result, err := s.authDomain().PublicLibTVWork(ctx, templateUUID)
	if err != nil {
		return nil, err
	}
	cache.put(key, result, time.Now())
	return result, nil
}
