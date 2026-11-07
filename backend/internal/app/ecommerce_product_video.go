package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 商品视频 · 元素替换的作品记录。和电商生图台共用 EcommerceLibrary 一行（每用户一行），只占 payload 里的
// "productVideos" 键，其余键原样保留。作品内容（素材、参考视频片段、每段的生成任务、成片）的结构由前端定义；
// 服务端负责归属、标识、体积与引用格式，并为每条作品维护 revision：两个窗口同时改同一条作品时，
// 基于旧版本的写入得到 409，而不是悄悄覆盖。素材和成片以 resourceId / keyframeResourceId 字段引用，
// 孤儿资源清理据此把它们识别为仍被引用。
const (
	productVideoPayloadKey      = "productVideos"
	productVideoDocumentVersion = 1
	productVideoMaxItems        = 100
	productVideoMaxItemBytes    = 128 << 10
	productVideoMaxTitleRunes   = 120
	productVideoConflictReason  = "product_video_conflict"
)

type ProductVideoList struct {
	Revision int64             `json:"revision"`
	Items    []json.RawMessage `json:"items"`
}

type ProductVideoResult struct {
	Revision int64           `json:"revision"`
	Item     json.RawMessage `json:"item"`
}

type ProductVideoDeleteResult struct {
	Revision int64 `json:"revision"`
}

type productVideoDocument struct {
	Version int               `json:"version"`
	Items   []json.RawMessage `json:"items"`
}

func (s *Service) ProductVideos(actor *model.User) (*ProductVideoList, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	row, err := s.repo.EcommerceLibrary(actor.ID)
	if err != nil {
		return nil, err
	}
	_, document, err := decodeProductVideoPayload(row)
	if err != nil {
		return nil, err
	}
	return &ProductVideoList{Revision: ecommerceStudioRevision(row), Items: document.Items}, nil
}

// ProductVideo 读取一条作品，供保存冲突后载入最新版本。
func (s *Service) ProductVideo(actor *model.User, id string) (*ProductVideoResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if !validEcommerceStudioID(id) {
		return nil, BadAuthRequest("作品标识无效")
	}
	row, err := s.repo.EcommerceLibrary(actor.ID)
	if err != nil {
		return nil, err
	}
	_, document, err := decodeProductVideoPayload(row)
	if err != nil {
		return nil, err
	}
	if index, _ := ecommerceStudioFindProduct(document.Items, id); index >= 0 {
		return &ProductVideoResult{Revision: ecommerceStudioRevision(row), Item: document.Items[index]}, nil
	}
	return nil, NotFound("作品不存在或已被删除")
}

// SaveProductVideo 新建或整体替换一条作品。expectedRevision 是调用方上次读到的作品 revision（新作品为 0），必填。
func (s *Service) SaveProductVideo(actor *model.User, id string, raw json.RawMessage, expectedRevision *int64) (*ProductVideoResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if expectedRevision == nil {
		return nil, BadAuthRequest("保存作品时必须带上 expectedRevision")
	}
	fields, err := normalizeProductVideoItem(id, raw)
	if err != nil {
		return nil, err
	}
	var saved json.RawMessage
	revision, err := s.mutateProductVideos(actor.ID, func(items []json.RawMessage) ([]json.RawMessage, error) {
		index, stored := ecommerceStudioFindProduct(items, id)
		if *expectedRevision != stored {
			return nil, productVideoConflict(stored)
		}
		if index < 0 && len(items) >= productVideoMaxItems {
			return nil, BadAuthRequest("商品视频最多保存 100 条作品，请先删除不再需要的作品")
		}
		next, err := encodeProductVideoItem(fields, stored+1)
		if err != nil {
			return nil, err
		}
		saved = next
		if index >= 0 {
			items[index] = next
			return items, nil
		}
		return append(items, next), nil
	})
	if err != nil {
		return nil, err
	}
	return &ProductVideoResult{Revision: revision, Item: saved}, nil
}

// DeleteProductVideo 只删除作品记录，不删除已上传的素材、片段与任务；作品不存在时同样成功。
func (s *Service) DeleteProductVideo(actor *model.User, id string) (*ProductVideoDeleteResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if !validEcommerceStudioID(id) {
		return nil, BadAuthRequest("作品标识无效")
	}
	revision, err := s.mutateProductVideos(actor.ID, func(items []json.RawMessage) ([]json.RawMessage, error) {
		kept := items[:0]
		for _, item := range items {
			if ecommerceStudioProductID(item) != id {
				kept = append(kept, item)
			}
		}
		return kept, nil
	})
	if err != nil {
		return nil, err
	}
	return &ProductVideoDeleteResult{Revision: revision}, nil
}

// mutateProductVideos 在存储锁内读改写 productVideos 键，用整行修订号做比较交换；
// 与生图台、孤儿清理共用 storageMu。行被并发改动时重读重试，不覆盖其他键。
func (s *Service) mutateProductVideos(userID string, apply func([]json.RawMessage) ([]json.RawMessage, error)) (int64, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	for attempt := 0; attempt < ecommerceStudioSaveAttempts; attempt++ {
		revision, err := applyProductVideoMutation(s.repo, userID, apply)
		if errors.Is(err, repository.ErrEcommerceLibraryConflict) {
			continue
		}
		return revision, err
	}
	return 0, NewAppError(http.StatusConflict, "商品视频数据正被其他窗口保存，请稍后重试")
}

func applyProductVideoMutation(repo *repository.Repository, userID string, apply func([]json.RawMessage) ([]json.RawMessage, error)) (int64, error) {
	row, err := repo.EcommerceLibrary(userID)
	if err != nil {
		return 0, err
	}
	payload, document, err := decodeProductVideoPayload(row)
	if err != nil {
		return 0, err
	}
	items, err := apply(append([]json.RawMessage(nil), document.Items...))
	if err != nil {
		return 0, err
	}
	encodedDocument, err := json.Marshal(productVideoDocument{Version: productVideoDocumentVersion, Items: items})
	if err != nil {
		return 0, err
	}
	payload[productVideoPayloadKey] = encodedDocument
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	if len(encodedPayload) > ecommerceStudioMaxPayloadBytes {
		return 0, BadAuthRequest("电商私有数据超过 8MB，请删除不再需要的商品视频作品或生图台商品")
	}
	now := time.Now().UTC()
	expected := ecommerceStudioRevision(row)
	next := &model.EcommerceLibrary{UserID: userID, Revision: expected + 1, PayloadJSON: string(encodedPayload), UpdatedAt: now}
	if row == nil {
		next.CreatedAt = now
	}
	if err := repo.SaveEcommerceLibrary(next, expected); err != nil {
		return 0, err
	}
	return next.Revision, nil
}

// decodeProductVideoPayload 只认 JSON 对象；无法识别时拒绝写入，宁可报错也不覆盖旧数据。
func decodeProductVideoPayload(row *model.EcommerceLibrary) (map[string]json.RawMessage, productVideoDocument, error) {
	payload := map[string]json.RawMessage{}
	document := productVideoDocument{Version: productVideoDocumentVersion, Items: []json.RawMessage{}}
	if row == nil || strings.TrimSpace(row.PayloadJSON) == "" {
		return payload, document, nil
	}
	if err := json.Unmarshal([]byte(row.PayloadJSON), &payload); err != nil || payload == nil {
		return nil, document, BadAuthRequest("电商私有数据格式无法识别，已停止写入以免覆盖")
	}
	raw, exists := payload[productVideoPayloadKey]
	if !exists || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return payload, document, nil
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, document, BadAuthRequest("商品视频数据格式无法识别，已停止写入以免覆盖")
	}
	if document.Items == nil {
		document.Items = []json.RawMessage{}
	}
	return payload, document, nil
}

// normalizeProductVideoItem 校验浏览器提交的作品并返回字段表；revision 由服务端写入，客户端传来的值丢弃。
func normalizeProductVideoItem(id string, raw json.RawMessage) (map[string]json.RawMessage, error) {
	if !validEcommerceStudioID(id) {
		return nil, BadAuthRequest("作品标识无效")
	}
	if len(raw) == 0 || len(raw) > productVideoMaxItemBytes {
		return nil, BadAuthRequest("单条作品数据须在 128KB 以内")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, BadAuthRequest("作品数据必须是 JSON 对象")
	}
	var itemID string
	if err := json.Unmarshal(fields["id"], &itemID); err != nil || itemID != id {
		return nil, BadAuthRequest("作品标识与地址不一致")
	}
	if titleRaw, exists := fields["title"]; exists {
		var title string
		if err := json.Unmarshal(titleRaw, &title); err != nil || utf8.RuneCountInString(title) > productVideoMaxTitleRunes {
			return nil, BadAuthRequest("作品名称须为 120 字以内的文本")
		}
	}
	// 素材必须先上传为资源再引用；内嵌 data URL 会撑大私有数据，也绕开资源配额与清理。
	if bytes.Contains(raw, []byte(`"data:`)) {
		return nil, BadAuthRequest("作品数据不能内嵌图片或视频，请先上传为素材")
	}
	if err := validateProductVideoDirector(raw); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	delete(fields, "revision")
	return fields, nil
}

func encodeProductVideoItem(fields map[string]json.RawMessage, revision int64) (json.RawMessage, error) {
	encodedRevision, err := json.Marshal(revision)
	if err != nil {
		return nil, err
	}
	fields["revision"] = encodedRevision
	encoded, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	if len(encoded) > productVideoMaxItemBytes {
		return nil, BadAuthRequest("单条作品数据须在 128KB 以内")
	}
	return encoded, nil
}

func productVideoConflict(current int64) error {
	return &AppError{Status: http.StatusConflict, Code: http.StatusConflict, Reason: productVideoConflictReason, Message: "作品已在其他窗口修改，请载入最新内容后再保存", Details: map[string]any{"revision": current}}
}
