package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 电商生图台的私有工作区与历史私有库共用 EcommerceLibrary 一行（每用户一行），
// 生图台只占 payload 里的 "studio" 键，其余键原样保留，避免覆盖旧数据里的资源引用。
// 商品内容的结构由前端定义；服务端负责归属、标识、体积与引用格式，
// 让商品照片和采用的成品能被孤儿资源清理识别为"仍被引用"。
//
// 每个商品带服务端维护的 revision：浏览器保存与 Agent 写入都按它比较交换，
// 谁基于旧版本写入都会得到 409，而不是悄悄覆盖对方的修改。
const (
	ecommerceStudioPayloadKey      = "studio"
	ecommerceStudioDocumentVersion = 1
	ecommerceStudioMaxProducts     = 200
	ecommerceStudioMaxProductBytes = 1 << 20
	ecommerceStudioMaxPayloadBytes = 8 << 20
	ecommerceStudioMaxNameRunes    = 120
	ecommerceStudioSaveAttempts    = 3
	ecommerceStudioConflictReason  = "studio_product_conflict"
)

type EcommerceStudio struct {
	Revision int64             `json:"revision"`
	Products []json.RawMessage `json:"products"`
}

type EcommerceStudioProductResult struct {
	Revision int64           `json:"revision"`
	Product  json.RawMessage `json:"product"`
}

type EcommerceStudioDeleteResult struct {
	Revision int64 `json:"revision"`
}

type ecommerceStudioDocument struct {
	Version  int               `json:"version"`
	Products []json.RawMessage `json:"products"`
}

func (s *Service) EcommerceStudio(actor *model.User) (*EcommerceStudio, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	row, err := s.repo.EcommerceLibrary(actor.ID)
	if err != nil {
		return nil, err
	}
	_, document, err := decodeEcommerceStudioPayload(row)
	if err != nil {
		return nil, err
	}
	return &EcommerceStudio{Revision: ecommerceStudioRevision(row), Products: document.Products}, nil
}

// EcommerceStudioProduct 读取单个商品，供保存冲突后载入最新版本。
func (s *Service) EcommerceStudioProduct(actor *model.User, productID string) (*EcommerceStudioProductResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if !validEcommerceStudioID(productID) {
		return nil, BadAuthRequest("商品标识无效")
	}
	row, err := s.repo.EcommerceLibrary(actor.ID)
	if err != nil {
		return nil, err
	}
	_, document, err := decodeEcommerceStudioPayload(row)
	if err != nil {
		return nil, err
	}
	for _, item := range document.Products {
		if ecommerceStudioProductID(item) == productID {
			return &EcommerceStudioProductResult{Revision: ecommerceStudioRevision(row), Product: item}, nil
		}
	}
	return nil, NotFound("商品不存在或已被删除")
}

// SaveEcommerceStudioProduct 新建或整体替换一个商品。expectedRevision 为调用方上次读到的
// 商品 revision（新商品为 0）；省略时不做比较，直接覆盖。
func (s *Service) SaveEcommerceStudioProduct(actor *model.User, productID string, raw json.RawMessage, expectedRevision *int64) (*EcommerceStudioProductResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	fields, err := normalizeEcommerceStudioProduct(productID, raw)
	if err != nil {
		return nil, err
	}
	var saved json.RawMessage
	revision, err := s.mutateEcommerceStudio(actor.ID, func(products []json.RawMessage) ([]json.RawMessage, error) {
		index, stored := ecommerceStudioFindProduct(products, productID)
		if expectedRevision != nil && *expectedRevision != stored {
			return nil, ecommerceStudioConflict(stored)
		}
		if index < 0 && len(products) >= ecommerceStudioMaxProducts {
			return nil, BadAuthRequest("生图台最多保存 200 个商品，请先删除不再使用的商品")
		}
		next, err := encodeEcommerceStudioProduct(fields, stored+1)
		if err != nil {
			return nil, err
		}
		saved = next
		if index >= 0 {
			products[index] = next
			return products, nil
		}
		return append(products, next), nil
	})
	if err != nil {
		return nil, err
	}
	return &EcommerceStudioProductResult{Revision: revision, Product: saved}, nil
}

func (s *Service) DeleteEcommerceStudioProduct(actor *model.User, productID string) (*EcommerceStudioDeleteResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if !validEcommerceStudioID(productID) {
		return nil, BadAuthRequest("商品标识无效")
	}
	revision, err := s.mutateEcommerceStudio(actor.ID, func(products []json.RawMessage) ([]json.RawMessage, error) {
		kept := products[:0]
		for _, item := range products {
			if ecommerceStudioProductID(item) != productID {
				kept = append(kept, item)
			}
		}
		return kept, nil
	})
	if err != nil {
		return nil, err
	}
	return &EcommerceStudioDeleteResult{Revision: revision}, nil
}

// mutateEcommerceStudio 在存储锁内读改写，并用修订号做比较交换；
// 与孤儿清理共用 storageMu，避免清理在读取引用和删除之间看到半写入的状态。
func (s *Service) mutateEcommerceStudio(userID string, apply func([]json.RawMessage) ([]json.RawMessage, error)) (int64, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	for attempt := 0; attempt < ecommerceStudioSaveAttempts; attempt++ {
		revision, err := applyEcommerceStudioMutation(s.repo, userID, apply)
		if errors.Is(err, repository.ErrEcommerceLibraryConflict) {
			continue
		}
		return revision, err
	}
	return 0, NewAppError(http.StatusConflict, "生图台数据正被其他窗口保存，请稍后重试")
}

// applyEcommerceStudioMutation 做一次读改写。调用方必须已持有 storageMu：HTTP 写入经
// mutateEcommerceStudio 加锁，Agent 写入在检查点事务里执行，事务外层已持有同一把锁。
// 行修订号冲突原样返回 ErrEcommerceLibraryConflict，由调用方决定重试还是让模型重读。
func applyEcommerceStudioMutation(repo *repository.Repository, userID string, apply func([]json.RawMessage) ([]json.RawMessage, error)) (int64, error) {
	row, err := repo.EcommerceLibrary(userID)
	if err != nil {
		return 0, err
	}
	payload, document, err := decodeEcommerceStudioPayload(row)
	if err != nil {
		return 0, err
	}
	products, err := apply(append([]json.RawMessage(nil), document.Products...))
	if err != nil {
		return 0, err
	}
	encodedDocument, err := json.Marshal(ecommerceStudioDocument{Version: ecommerceStudioDocumentVersion, Products: products})
	if err != nil {
		return 0, err
	}
	payload[ecommerceStudioPayloadKey] = encodedDocument
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	if len(encodedPayload) > ecommerceStudioMaxPayloadBytes {
		return 0, BadAuthRequest("生图台数据超过 8MB，请删除不再使用的商品或旧的出图记录")
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

// decodeEcommerceStudioPayload 只认 JSON 对象；无法识别时拒绝写入，宁可报错也不覆盖旧数据。
func decodeEcommerceStudioPayload(row *model.EcommerceLibrary) (map[string]json.RawMessage, ecommerceStudioDocument, error) {
	payload := map[string]json.RawMessage{}
	document := ecommerceStudioDocument{Version: ecommerceStudioDocumentVersion, Products: []json.RawMessage{}}
	if row == nil || strings.TrimSpace(row.PayloadJSON) == "" {
		return payload, document, nil
	}
	if err := json.Unmarshal([]byte(row.PayloadJSON), &payload); err != nil || payload == nil {
		return nil, document, BadAuthRequest("电商私有数据格式无法识别，已停止写入以免覆盖")
	}
	raw, exists := payload[ecommerceStudioPayloadKey]
	if !exists || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return payload, document, nil
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, document, BadAuthRequest("生图台数据格式无法识别，已停止写入以免覆盖")
	}
	if document.Products == nil {
		document.Products = []json.RawMessage{}
	}
	return payload, document, nil
}

// normalizeEcommerceStudioProduct 校验浏览器提交的商品并返回字段表；revision 由服务端写入，
// 客户端传来的值一律丢弃。
func normalizeEcommerceStudioProduct(productID string, raw json.RawMessage) (map[string]json.RawMessage, error) {
	if !validEcommerceStudioID(productID) {
		return nil, BadAuthRequest("商品标识无效")
	}
	if len(raw) == 0 || len(raw) > ecommerceStudioMaxProductBytes {
		return nil, BadAuthRequest("单个商品数据须在 1MB 以内")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, BadAuthRequest("商品数据必须是 JSON 对象")
	}
	var id string
	if err := json.Unmarshal(fields["id"], &id); err != nil || id != productID {
		return nil, BadAuthRequest("商品标识与地址不一致")
	}
	if nameRaw, exists := fields["name"]; exists {
		var name string
		if err := json.Unmarshal(nameRaw, &name); err != nil || utf8.RuneCountInString(name) > ecommerceStudioMaxNameRunes {
			return nil, BadAuthRequest("商品名称须为 120 字以内的文本")
		}
	}
	// 媒体必须先上传为资源再引用；内嵌 data URL 会撑大私有数据，也绕开资源配额与清理。
	if bytes.Contains(raw, []byte(`"data:`)) {
		return nil, BadAuthRequest("商品数据不能内嵌图片，请先上传为素材")
	}
	delete(fields, "revision")
	return fields, nil
}

// encodeEcommerceStudioProduct 写入服务端 revision 并序列化；键按字典序输出，结果稳定。
func encodeEcommerceStudioProduct(fields map[string]json.RawMessage, revision int64) (json.RawMessage, error) {
	encodedRevision, err := json.Marshal(revision)
	if err != nil {
		return nil, err
	}
	fields["revision"] = encodedRevision
	encoded, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	if len(encoded) > ecommerceStudioMaxProductBytes {
		return nil, BadAuthRequest("单个商品数据须在 1MB 以内")
	}
	return encoded, nil
}

func ecommerceStudioConflict(current int64) error {
	return &AppError{Status: http.StatusConflict, Code: http.StatusConflict, Reason: ecommerceStudioConflictReason, Message: "商品已被其他窗口或助手修改，请载入最新内容后再保存", Details: map[string]any{"revision": current}}
}

func ecommerceStudioFindProduct(products []json.RawMessage, productID string) (int, int64) {
	for index, item := range products {
		if ecommerceStudioProductID(item) == productID {
			return index, ecommerceStudioProductRevision(item)
		}
	}
	return -1, 0
}

func validEcommerceStudioID(value string) bool {
	return len(value) >= 6 && assets.ValidID(value) == value
}

func ecommerceStudioProductID(raw json.RawMessage) string {
	var header struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(raw, &header) != nil {
		return ""
	}
	return header.ID
}

func ecommerceStudioProductRevision(raw json.RawMessage) int64 {
	var header struct {
		Revision int64 `json:"revision"`
	}
	if json.Unmarshal(raw, &header) != nil || header.Revision < 0 {
		return 0
	}
	return header.Revision
}

func ecommerceStudioRevision(row *model.EcommerceLibrary) int64 {
	if row == nil {
		return 0
	}
	return row.Revision
}
