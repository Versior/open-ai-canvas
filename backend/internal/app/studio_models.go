package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 电商生图台「模特库」：管理员导入模特人脸、姿势参考图和模特样式；用户在生图台按需选用。
// 原图与缩略图都存成本地专用资源（kind studio-model，不计入个人容量）；用户选用人脸或姿势时，
// 服务端把原图复制到用户自己的资源库（按素材与原图去重），出图任务只引用用户自己的资源。
const (
	studioModelResourceKind = "studio-model"
	// StudioModelImportMaxBytes 是单张素材图的上限。
	StudioModelImportMaxBytes = 12 << 20
	studioModelMaxPixels      = 40_000_000
	studioModelThumbSide      = 512
	studioModelMaxBatch       = 200
	studioModelMaxPageSize    = 60
)

var (
	studioModelKinds   = map[string]string{model.StudioModelKindFace: "模特人脸", model.StudioModelKindPose: "姿势", model.StudioModelKindStyle: "模特样式"}
	studioModelGenders = map[string]bool{"": true, "female": true, "male": true}
	studioModelMimes   = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
	studioModelTagSep  = regexp.MustCompile(`[,，、;；\s]+`)
)

type StudioModelView struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Category  string   `json:"category"`
	Gender    string   `json:"gender"`
	Tags      []string `json:"tags"`
	Prompt    string   `json:"prompt"`
	HasImage  bool     `json:"hasImage"`
	Width     int      `json:"width"`
	Height    int      `json:"height"`
	Revision  string   `json:"revision"`
	Enabled   bool     `json:"enabled"`
	Consent   bool     `json:"consent"`
	SortOrder int      `json:"sortOrder"`
	UpdatedAt string   `json:"updatedAt"`
}

type StudioModelPage struct {
	Items      []StudioModelView `json:"items"`
	Total      int64             `json:"total"`
	Page       int               `json:"page"`
	PageSize   int               `json:"pageSize"`
	Categories []string          `json:"categories"`
	// 以下两项只有后台列表返回：每种素材的总条数（类型页签）和当前类型每个分类的条数（分类筛选）。
	KindCounts     map[string]int64           `json:"kindCounts,omitempty"`
	CategoryCounts []StudioModelCategoryCount `json:"categoryCounts,omitempty"`
}

type StudioModelCategoryCount struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// 后台列表的上下架筛选：空串看全部。
var studioModelStatuses = map[string]bool{"": true, "enabled": true, "disabled": true}

// AdminStudioModelInput 是后台新增或修改素材时的文字字段；图片只在导入时上传。
type AdminStudioModelInput struct {
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	Category  string   `json:"category"`
	Gender    string   `json:"gender"`
	Tags      []string `json:"tags"`
	Prompt    string   `json:"prompt"`
	Consent   bool     `json:"consent"`
	Enabled   bool     `json:"enabled"`
	SortOrder *int     `json:"sortOrder"`
}

type AdminStudioModelBatchInput struct {
	IDs    []string `json:"ids"`
	Action string   `json:"action"`
}

type StudioModelAttachment struct {
	ResourceID string `json:"resourceId"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
}

// StudioModelImage 是给浏览器的图片流；调用方负责关闭 Body。
type StudioModelImage struct {
	Body     io.ReadCloser
	Size     int64
	MimeType string
	Revision string
}

func studioModelRevision(item model.StudioModelAsset) string {
	return strconv.FormatInt(item.UpdatedAt.UnixMilli(), 36)
}

func studioModelTags(raw string) []string {
	tags := []string{}
	if json.Unmarshal([]byte(raw), &tags) != nil || tags == nil {
		return []string{}
	}
	return tags
}

func newStudioModelView(item model.StudioModelAsset) StudioModelView {
	return StudioModelView{
		ID: item.ID, Kind: item.Kind, Name: item.Name, Category: item.Category, Gender: item.Gender, Tags: studioModelTags(item.TagsJSON), Prompt: item.Prompt,
		HasImage: item.ResourceID != "", Width: item.Width, Height: item.Height, Revision: studioModelRevision(item), Enabled: item.Enabled, Consent: item.Consent,
		SortOrder: item.SortOrder, UpdatedAt: item.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func runeLimit(value string, limit int) bool {
	return utf8.RuneCountInString(value) <= limit
}

// normalizeStudioModelInput 校验并整理文字字段；hasImage 表示这条素材有没有图片。
func normalizeStudioModelInput(input AdminStudioModelInput, hasImage bool) (AdminStudioModelInput, error) {
	input.Kind = strings.TrimSpace(input.Kind)
	input.Name = strings.TrimSpace(input.Name)
	input.Category = strings.TrimSpace(input.Category)
	input.Gender = strings.TrimSpace(input.Gender)
	input.Prompt = strings.TrimSpace(input.Prompt)
	if _, ok := studioModelKinds[input.Kind]; !ok {
		return input, BadAuthRequest("素材类型只能是模特人脸、姿势或模特样式")
	}
	if input.Name == "" || !runeLimit(input.Name, 60) {
		return input, BadAuthRequest("名称不能为空，最多 60 个字")
	}
	if !runeLimit(input.Category, 24) {
		return input, BadAuthRequest("分类最多 24 个字")
	}
	if !studioModelGenders[input.Gender] {
		return input, BadAuthRequest("性别只能是女、男或不限")
	}
	if !runeLimit(input.Prompt, 600) {
		return input, BadAuthRequest("出图描述最多 600 个字")
	}
	tags := []string{}
	seen := map[string]bool{}
	for _, tag := range input.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		if !runeLimit(tag, 16) {
			return input, BadAuthRequest("每个标签最多 16 个字")
		}
		seen[tag] = true
		tags = append(tags, tag)
	}
	if len(tags) > 12 {
		return input, BadAuthRequest("标签最多 12 个")
	}
	input.Tags = tags
	switch input.Kind {
	case model.StudioModelKindFace:
		if !hasImage {
			return input, BadAuthRequest("模特人脸需要上传一张清晰的正脸图")
		}
		if input.Enabled && !input.Consent {
			return input, BadAuthRequest("人脸素材要先确认已获得肖像使用授权才能上架")
		}
	case model.StudioModelKindPose:
		if !hasImage {
			return input, BadAuthRequest("姿势素材需要上传一张姿势参考图")
		}
	case model.StudioModelKindStyle:
		if input.Prompt == "" {
			return input, BadAuthRequest("模特样式要写清造型描述，出图靠它描述妆发与穿搭")
		}
	}
	return input, nil
}

// ParseStudioModelTags 把表单里的标签文本拆成列表：支持 JSON 数组，也支持逗号、顿号或空格分隔。
func ParseStudioModelTags(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var tags []string
	if strings.HasPrefix(raw, "[") && json.Unmarshal([]byte(raw), &tags) == nil {
		return tags
	}
	return studioModelTagSep.Split(raw, -1)
}

func (s *Service) studioModelReader(actor *model.User) (bool, error) {
	if actor == nil {
		return false, Unauthorized("请先登录")
	}
	if actor.Role == model.UserRoleAdmin {
		return true, nil
	}
	return false, s.RequireFeature(FeatureEcommerceStudio)
}

func studioModelPaging(page, pageSize int) (int, int, error) {
	if page < 1 || pageSize < 1 || pageSize > studioModelMaxPageSize {
		return 0, 0, BadAuthRequest("分页参数无效")
	}
	return page, pageSize, nil
}

func (s *Service) studioModelPage(query repository.StudioModelQuery, page, pageSize int) (*StudioModelPage, error) {
	query.Offset, query.Limit = (page-1)*pageSize, pageSize
	items, total, err := s.repo.StudioModelAssets(query)
	if err != nil {
		return nil, err
	}
	categories, err := s.repo.StudioModelCategories(query.Kind, query.EnabledOnly)
	if err != nil {
		return nil, err
	}
	result := &StudioModelPage{Items: make([]StudioModelView, 0, len(items)), Total: total, Page: page, PageSize: pageSize, Categories: categories}
	for _, item := range items {
		result.Items = append(result.Items, newStudioModelView(item))
	}
	return result, nil
}

// StudioModels 是生图台用的模特库列表，只给已上架的素材。
func (s *Service) StudioModels(actor *model.User, kind, query, category, gender string, page, pageSize int) (*StudioModelPage, error) {
	if _, err := s.studioModelReader(actor); err != nil {
		return nil, err
	}
	if _, ok := studioModelKinds[kind]; !ok {
		return nil, BadAuthRequest("素材类型无效")
	}
	if !runeLimit(query, 60) || !studioModelGenders[gender] {
		return nil, BadAuthRequest("筛选条件无效")
	}
	page, pageSize, err := studioModelPaging(page, pageSize)
	if err != nil {
		return nil, err
	}
	return s.studioModelPage(repository.StudioModelQuery{Kind: kind, Query: query, Category: category, Gender: gender, EnabledOnly: true}, page, pageSize)
}

// AdminStudioModels 是后台列表，包括未上架的素材；可按分类和上下架（status 为 enabled / disabled）筛选，
// 另带每种素材的总条数和当前类型每个分类的条数。
func (s *Service) AdminStudioModels(actor *model.User, kind, query, category, status string, page, pageSize int) (*StudioModelPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, ok := studioModelKinds[kind]; !ok {
		return nil, BadAuthRequest("素材类型无效")
	}
	if !runeLimit(query, 60) || !runeLimit(category, 24) || !studioModelStatuses[status] {
		return nil, BadAuthRequest("筛选条件无效")
	}
	page, pageSize, err := studioModelPaging(page, pageSize)
	if err != nil {
		return nil, err
	}
	result, err := s.studioModelPage(repository.StudioModelQuery{Kind: kind, Query: query, Category: category, EnabledOnly: status == "enabled", DisabledOnly: status == "disabled"}, page, pageSize)
	if err != nil {
		return nil, err
	}
	kinds, err := s.repo.StudioModelKindCounts()
	if err != nil {
		return nil, err
	}
	result.KindCounts = map[string]int64{}
	for name := range studioModelKinds {
		result.KindCounts[name] = 0
	}
	for _, item := range kinds {
		if _, ok := result.KindCounts[item.Name]; ok {
			result.KindCounts[item.Name] = item.Count
		}
	}
	categories, err := s.repo.StudioModelCategoryCounts(kind)
	if err != nil {
		return nil, err
	}
	result.CategoryCounts = make([]StudioModelCategoryCount, 0, len(categories))
	for _, item := range categories {
		result.CategoryCounts = append(result.CategoryCounts, StudioModelCategoryCount{Name: item.Name, Count: item.Count})
	}
	return result, nil
}

type studioModelUpload struct {
	data     []byte
	mimeType string
	width    int
	height   int
	thumb    []byte
	thumbW   int
	thumbH   int
}

// readStudioModelUpload 读入后台上传的一张素材图，核对与缩略图交给 decodeStudioModelImage。
func readStudioModelUpload(file *multipart.FileHeader) (*studioModelUpload, error) {
	if file.Size <= 0 || file.Size > StudioModelImportMaxBytes {
		return nil, BadAuthRequest("图片须在 12 MiB 以内")
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, StudioModelImportMaxBytes+1))
	if err != nil {
		return nil, err
	}
	return decodeStudioModelImage(data)
}

// decodeStudioModelImage 核对一张素材图（格式、大小、像素），同时生成不超过 512 像素的 JPEG 缩略图供列表浏览。
func decodeStudioModelImage(data []byte) (*studioModelUpload, error) {
	if len(data) == 0 || len(data) > StudioModelImportMaxBytes {
		return nil, BadAuthRequest("图片须在 12 MiB 以内")
	}
	mimeType := http.DetectContentType(data)
	if _, ok := studioModelMimes[mimeType]; !ok {
		return nil, BadAuthRequest("只支持 PNG、JPEG 或 WebP 图片")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return nil, BadAuthRequest("图片无法识别，请换一张")
	}
	if config.Width*config.Height > studioModelMaxPixels {
		return nil, BadAuthRequest("图片像素过多，请缩小到 4000 万像素以内")
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, BadAuthRequest("图片无法识别，请换一张")
	}
	scale := float64(studioModelThumbSide) / float64(max(config.Width, config.Height))
	if scale > 1 {
		scale = 1
	}
	thumbW, thumbH := max(1, int(float64(config.Width)*scale)), max(1, int(float64(config.Height)*scale))
	canvas := image.NewRGBA(image.Rect(0, 0, thumbW, thumbH))
	// 透明背景铺白再缩放，缩略图存成 JPEG。
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	xdraw.CatmullRom.Scale(canvas, canvas.Bounds(), decoded, decoded.Bounds(), xdraw.Over, nil)
	var thumb bytes.Buffer
	if err := jpeg.Encode(&thumb, canvas, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return &studioModelUpload{data: data, mimeType: mimeType, width: config.Width, height: config.Height, thumb: thumb.Bytes(), thumbW: thumbW, thumbH: thumbH}, nil
}

// ImportStudioModel 新增一条素材；人脸和姿势必须带图，模特样式可以只有文字。
func (s *Service) ImportStudioModel(actor *model.User, input AdminStudioModelInput, file *multipart.FileHeader) (*StudioModelView, error) {
	if file == nil {
		return s.importStudioModel(actor, input, "", nil)
	}
	return s.importStudioModel(actor, input, file.Filename, func() (*studioModelUpload, error) { return readStudioModelUpload(file) })
}

// ImportStudioModelImage 给后台批量导入工具用：图片以字节传入，校验、缩略图、存储和审计与后台上传完全一致。
func (s *Service) ImportStudioModelImage(actor *model.User, input AdminStudioModelInput, fileName string, data []byte) (*StudioModelView, error) {
	return s.importStudioModel(actor, input, fileName, func() (*studioModelUpload, error) { return decodeStudioModelImage(data) })
}

// AdminStudioModelKeys 列出某类素材已有的「分类 + 名称」，批量导入工具据此跳过已经导入过的条目。
func (s *Service) AdminStudioModelKeys(actor *model.User, kind string) (map[string]bool, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	keys := map[string]bool{}
	for offset := 0; ; offset += 500 {
		items, _, err := s.repo.StudioModelAssets(repository.StudioModelQuery{Kind: kind, Offset: offset, Limit: 500})
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			keys[StudioModelKey(item.Category, item.Name)] = true
		}
		if len(items) < 500 {
			return keys, nil
		}
	}
}

// StudioModelKey 是导入去重用的键：同一类素材里分类和名称都相同视为同一条。
func StudioModelKey(category, name string) string {
	return strings.TrimSpace(category) + "\x00" + strings.TrimSpace(name)
}

func (s *Service) importStudioModel(actor *model.User, input AdminStudioModelInput, fileName string, load func() (*studioModelUpload, error)) (*StudioModelView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	normalized, err := normalizeStudioModelInput(input, load != nil)
	if err != nil {
		return nil, err
	}
	item := model.StudioModelAsset{ID: newID(), Kind: normalized.Kind, Name: normalized.Name, Category: normalized.Category, Gender: normalized.Gender, Prompt: normalized.Prompt, Consent: normalized.Consent, Enabled: normalized.Enabled, CreatedBy: actor.ID, UpdatedBy: actor.ID}
	if normalized.SortOrder != nil {
		item.SortOrder = *normalized.SortOrder
	}
	tags, _ := json.Marshal(normalized.Tags)
	item.TagsJSON = string(tags)
	if load != nil {
		upload, err := load()
		if err != nil {
			return nil, err
		}
		stem := strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName))
		original, _, err := s.storeResource(actor.ID, studioModelResourceKind, stem+studioModelMimes[upload.mimeType], upload.mimeType, int64(len(upload.data)), upload.width, upload.height, 0, bytes.NewReader(upload.data), nil, true)
		if err != nil {
			return nil, err
		}
		thumb, _, err := s.storeResource(actor.ID, studioModelResourceKind, stem+"-thumb.jpg", "image/jpeg", int64(len(upload.thumb)), upload.thumbW, upload.thumbH, 0, bytes.NewReader(upload.thumb), nil, true)
		if err != nil {
			return nil, err
		}
		item.ResourceID, item.ThumbResourceID, item.Width, item.Height = original.ID, thumb.ID, upload.width, upload.height
	}
	if err := s.repo.CreateStudioModelAsset(&item); err != nil {
		return nil, err
	}
	view := newStudioModelView(item)
	if err := s.appendAdminAudit(actor, "studio_model.import", "studio_model", item.ID, "新增模特库"+studioModelKinds[item.Kind]+" "+item.Name, map[string]any{"kind": item.Kind, "resourceId": item.ResourceID, "consent": item.Consent}); err != nil {
		return nil, err
	}
	return &view, nil
}

// UpdateStudioModel 修改文字字段与上下架；类型和图片不能改，要换图就删掉重新导入。
func (s *Service) UpdateStudioModel(actor *model.User, id string, input AdminStudioModelInput) (*StudioModelView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := s.repo.StudioModelAsset(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材不存在")
	}
	if err != nil {
		return nil, err
	}
	input.Kind = item.Kind
	normalized, err := normalizeStudioModelInput(input, item.ResourceID != "")
	if err != nil {
		return nil, err
	}
	tags, _ := json.Marshal(normalized.Tags)
	item.Name, item.Category, item.Gender, item.Prompt, item.TagsJSON = normalized.Name, normalized.Category, normalized.Gender, normalized.Prompt, string(tags)
	item.Consent, item.Enabled, item.UpdatedBy = normalized.Consent, normalized.Enabled, actor.ID
	if normalized.SortOrder != nil {
		item.SortOrder = *normalized.SortOrder
	}
	if err := s.repo.SaveStudioModelAsset(item); err != nil {
		return nil, err
	}
	view := newStudioModelView(*item)
	if err := s.appendAdminAudit(actor, "studio_model.update", "studio_model", item.ID, "修改模特库素材 "+item.Name, map[string]any{"enabled": item.Enabled, "consent": item.Consent}); err != nil {
		return nil, err
	}
	return &view, nil
}

// BatchStudioModels 批量上架、下架或删除。上架时人脸素材都要已确认肖像授权，否则整批不执行。
func (s *Service) BatchStudioModels(actor *model.User, input AdminStudioModelBatchInput) (map[string]any, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range input.IDs {
		if id = strings.TrimSpace(id); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) > studioModelMaxBatch {
		return nil, BadAuthRequest(fmt.Sprintf("一次选择 1–%d 条素材", studioModelMaxBatch))
	}
	items, err := s.repo.StudioModelAssetsByIDs(ids)
	if err != nil {
		return nil, err
	}
	if len(items) != len(ids) {
		return nil, NotFound("部分素材已不存在，请刷新后重试")
	}
	var affected int64
	switch input.Action {
	case "enable", "disable":
		enabled := input.Action == "enable"
		if enabled {
			for _, item := range items {
				if item.Kind == model.StudioModelKindFace && !item.Consent {
					return nil, BadAuthRequest("「" + item.Name + "」还没确认肖像使用授权，不能上架")
				}
			}
		}
		affected, err = s.repo.SetStudioModelAssetsEnabled(ids, enabled, actor.ID)
	case "delete":
		affected, err = s.repo.DeleteStudioModelAssets(ids)
	default:
		return nil, BadAuthRequest("批量操作只能是上架、下架或删除")
	}
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "studio_model.batch_"+input.Action, "studio_model", strings.Join(ids[:min(len(ids), 5)], ","), fmt.Sprintf("批量%s模特库素材 %d 条", map[string]string{"enable": "上架", "disable": "下架", "delete": "删除"}[input.Action], affected), map[string]any{"ids": ids}); err != nil {
		return nil, err
	}
	return map[string]any{"affected": affected}, nil
}

func (s *Service) readableStudioModel(actor *model.User, id string) (*model.StudioModelAsset, error) {
	admin, err := s.studioModelReader(actor)
	if err != nil {
		return nil, err
	}
	item, err := s.repo.StudioModelAsset(id)
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && !item.Enabled && !admin {
		return nil, NotFound("素材不存在或已下架")
	}
	return item, err
}

// studioModelResource 读出素材自己的专用资源；不是这条素材的资源或类型不对时拒绝。
func (s *Service) studioModelResource(resourceID string) (*model.Resource, error) {
	if resourceID == "" {
		return nil, NotFound("这条素材没有图片")
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil || resource.Kind != studioModelResourceKind || resource.Status != model.ResourceStatusReady {
		return nil, NotFound("素材图片不可用")
	}
	return resource, nil
}

// OpenStudioModelImage 返回素材图；thumb 为真时优先给缩略图。
func (s *Service) OpenStudioModelImage(actor *model.User, id string, thumb bool) (*StudioModelImage, error) {
	item, err := s.readableStudioModel(actor, id)
	if err != nil {
		return nil, err
	}
	resourceID := item.ResourceID
	if thumb && item.ThumbResourceID != "" {
		resourceID = item.ThumbResourceID
	}
	resource, err := s.studioModelResource(resourceID)
	if err != nil {
		return nil, err
	}
	stream, err := s.openResourceRange(resource.UserID, resource, "")
	if err != nil {
		return nil, NotFound("素材图片不可用")
	}
	return &StudioModelImage{Body: stream.Body, Size: resource.Size, MimeType: resource.MimeType, Revision: studioModelRevision(*item)}, nil
}

// AttachStudioModel 把素材原图复制到当前用户的资源库，返回用户自己的资源 ID 供出图引用。
// 同一用户对同一张原图只复制一次（按上传幂等键去重），配额与普通上传一致。
func (s *Service) AttachStudioModel(actor *model.User, id string) (*StudioModelAttachment, error) {
	item, err := s.readableStudioModel(actor, id)
	if err != nil {
		return nil, err
	}
	if item.Kind == model.StudioModelKindStyle && item.ResourceID == "" {
		return nil, BadAuthRequest("这条模特样式只有文字描述，不需要带图")
	}
	original, err := s.studioModelResource(item.ResourceID)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte("studio-model:" + item.ID + ":" + original.ID))
	uploadKey := hex.EncodeToString(digest[:])
	if existing, err := s.repo.ResourceByUploadKey(actor.ID, uploadKey); err == nil && existing.Status == model.ResourceStatusReady {
		return &StudioModelAttachment{ResourceID: existing.ID, Width: existing.Width, Height: existing.Height}, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	stream, err := s.openResourceRange(original.UserID, original, "")
	if err != nil {
		return nil, NotFound("素材图片不可用")
	}
	defer stream.Body.Close()
	day, err := s.reserveUserUploadQuota(actor.ID, original.Size)
	if err != nil {
		return nil, err
	}
	fileName := "模特库-" + studioModelKinds[item.Kind] + "-" + item.Name + filepath.Ext(original.ObjectKey)
	copied, stored, err := s.storeResource(actor.ID, "image", fileName, original.MimeType, original.Size, original.Width, original.Height, 0, stream.Body, &uploadKey, false)
	switch {
	case err != nil:
		s.releaseUserUploadQuota(actor.ID, day, original.Size)
		return nil, err
	case stored:
		s.commitUserUploadQuota(actor.ID, original.Size)
	default:
		s.releaseUserUploadQuota(actor.ID, day, original.Size)
	}
	return &StudioModelAttachment{ResourceID: copied.ID, Width: copied.Width, Height: copied.Height}, nil
}

// studioModelResourceReferences 让模特库用到的原图和缩略图不被后台删除或自动回收；读不到素材表时全部视为仍被引用。
func (s *Service) studioModelResourceReferences(resourceIDs []string) map[string][]AdminResourceReferenceView {
	result := map[string][]AdminResourceReferenceView{}
	items, err := s.repo.StudioModelAssetsByResourceIDs(resourceIDs)
	if err != nil {
		for _, id := range resourceIDs {
			result[id] = []AdminResourceReferenceView{{Kind: "电商模特库", ID: id, Title: "模特库无法读取"}}
		}
		return result
	}
	for _, item := range items {
		reference := AdminResourceReferenceView{Kind: "电商模特库", ID: item.ID, Title: "模特库 · " + item.Name}
		for _, resourceID := range []string{item.ResourceID, item.ThumbResourceID} {
			if resourceID != "" && slicesContains(resourceIDs, resourceID) {
				result[resourceID] = append(result[resourceID], reference)
			}
		}
	}
	return result
}

func slicesContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
