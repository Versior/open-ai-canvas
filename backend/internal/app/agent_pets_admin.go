package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/agentpet"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// AgentPetImportMaxBytes 是后台导入形象文件（ZIP 或图集）的大小上限。
const AgentPetImportMaxBytes = agentpet.MaxPackageBytes

// maxAgentPetBatch 是一次批量操作最多处理的形象数。
const maxAgentPetBatch = 200

// AdminAgentPetView 是后台形象库的一行。
type AdminAgentPetView struct {
	AgentPetView
	Source     string   `json:"source"`
	Enabled    bool     `json:"enabled"`
	GroupCodes []string `json:"groupCodes"`
	SortOrder  int      `json:"sortOrder"`
	// OwnerCount 是拥有人数（购买或领取），RevenueMicrocredits 是累计购买收入。
	OwnerCount          int64 `json:"ownerCount"`
	RevenueMicrocredits int64 `json:"revenueMicrocredits"`
	// Promo* 是促销配置（不论是否在进行中）；PromoState 为 none / scheduled / active / ended。
	PromoEnabled           bool       `json:"promoEnabled"`
	PromoLabel             string     `json:"promoLabel"`
	PromoPriceMicrocredits int64      `json:"promoPriceMicrocredits"`
	PromoStartsAt          *time.Time `json:"promoStartsAt"`
	PromoEndsAt            *time.Time `json:"promoEndsAt"`
	PromoState             string     `json:"promoState"`
	UpdatedAt              *time.Time `json:"updatedAt,omitempty"`
}

// AdminAgentPetInput 是后台保存一个形象的完整配置。
type AdminAgentPetInput struct {
	Name               string            `json:"name"`
	Description        string            `json:"description"`
	Enabled            bool              `json:"enabled"`
	Access             string            `json:"access"`
	PriceMicrocredits  int64             `json:"priceMicrocredits"`
	UnlockMicrocredits int64             `json:"unlockMicrocredits"`
	GroupCodes         []string          `json:"groupCodes"`
	StateRows          map[string]string `json:"stateRows"`
	Pixelated          bool              `json:"pixelated"`
	SortOrder          int               `json:"sortOrder"`
	Category           string            `json:"category"`
	Badge              string            `json:"badge"`
	// Promo* 只对积分购买的形象生效；促销价为 0 表示限时免费。
	PromoEnabled           bool       `json:"promoEnabled"`
	PromoLabel             string     `json:"promoLabel"`
	PromoPriceMicrocredits int64      `json:"promoPriceMicrocredits"`
	PromoStartsAt          *time.Time `json:"promoStartsAt"`
	PromoEndsAt            *time.Time `json:"promoEndsAt"`
	// Tone 与 Lines 只对上传形象生效；内置形象的说话风格和台词随程序发布。
	Tone  string   `json:"tone"`
	Lines []string `json:"lines"`
}

// AdminAgentPetBatchInput 是批量修改：只改提供了的字段，其余保持各自原样。
type AdminAgentPetBatchInput struct {
	IDs       []string                     `json:"ids"`
	Enabled   *bool                        `json:"enabled"`
	Category  *string                      `json:"category"`
	Badge     *string                      `json:"badge"`
	Access    *AdminAgentPetBatchAccess    `json:"access"`
	Promotion *AdminAgentPetBatchPromotion `json:"promotion"`
	// SortPosition 为 first / last 时把所选形象移到形象库最前或最后，所选形象之间保持原来的先后。
	SortPosition string `json:"sortPosition"`
}

// AdminAgentPetBatchAccess 把所选形象改成同一种开放方式；改成非积分购买时同时结束促销。
type AdminAgentPetBatchAccess struct {
	Mode               string   `json:"mode"`
	PriceMicrocredits  int64    `json:"priceMicrocredits"`
	UnlockMicrocredits int64    `json:"unlockMicrocredits"`
	GroupCodes         []string `json:"groupCodes"`
}

// AdminAgentPetBatchPromotion 给所选的积分购买形象开促销（按原价的百分比定价，0 为限时免费），
// Enabled 为 false 时结束所选形象的促销。
type AdminAgentPetBatchPromotion struct {
	Enabled  bool       `json:"enabled"`
	Label    string     `json:"label"`
	Percent  int        `json:"percent"`
	StartsAt *time.Time `json:"startsAt"`
	EndsAt   *time.Time `json:"endsAt"`
}

// AdminAgentPetBatchSkip 是批量操作里跳过的一项及原因。
type AdminAgentPetBatchSkip struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

type AdminAgentPetBatchResult struct {
	Pets    []AdminAgentPetView      `json:"pets"`
	Deleted []string                 `json:"deleted"`
	Skipped []AdminAgentPetBatchSkip `json:"skipped"`
}

func (entry agentPetEntry) adminView(sale repository.AgentPetSale) AdminAgentPetView {
	view := AdminAgentPetView{
		AgentPetView:           entry.userView("", false, true, 0),
		Source:                 entry.pet.Source,
		Enabled:                entry.pet.Enabled,
		GroupCodes:             entry.access.GroupCodes,
		SortOrder:              entry.pet.SortOrder,
		OwnerCount:             sale.Owners,
		RevenueMicrocredits:    sale.RevenueMicrocredits,
		PromoEnabled:           entry.promo.Enabled,
		PromoLabel:             entry.promo.Label,
		PromoPriceMicrocredits: entry.promo.PriceMicrocredits,
		PromoStartsAt:          entry.promo.StartsAt,
		PromoEndsAt:            entry.promo.EndsAt,
		PromoState:             entry.promo.State(time.Now()),
		UpdatedAt:              agentPetTimestamp(entry),
	}
	view.Usable = true
	view.Purchasable = false
	view.Claimable = false
	return view
}

// input 返回形象当前的完整配置，批量修改在它的基础上改动个别字段。
func (entry agentPetEntry) input() AdminAgentPetInput {
	return AdminAgentPetInput{
		Name:                   entry.pet.Name,
		Description:            entry.pet.Description,
		Enabled:                entry.pet.Enabled,
		Access:                 entry.access.Mode,
		PriceMicrocredits:      entry.access.PriceMicrocredits,
		UnlockMicrocredits:     entry.access.UnlockMicrocredits,
		GroupCodes:             entry.access.GroupCodes,
		StateRows:              entry.stateRows,
		Pixelated:              entry.pet.Pixelated,
		SortOrder:              entry.pet.SortOrder,
		Category:               entry.pet.Category,
		Badge:                  entry.pet.Badge,
		PromoEnabled:           entry.promo.Enabled,
		PromoLabel:             entry.promo.Label,
		PromoPriceMicrocredits: entry.promo.PriceMicrocredits,
		PromoStartsAt:          entry.promo.StartsAt,
		PromoEndsAt:            entry.promo.EndsAt,
		Tone:                   entry.tone,
		Lines:                  entry.lines,
	}
}

func (s *Service) AdminAgentPets(actor *model.User) ([]AdminAgentPetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.adminAgentPetViews(nil)
}

// adminAgentPetViews 返回后台视图；ids 不为空时只返回这些形象，顺序与形象库一致。
func (s *Service) adminAgentPetViews(ids []string) ([]AdminAgentPetView, error) {
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	sales, err := s.repo.AgentPetSales()
	if err != nil {
		return nil, err
	}
	views := make([]AdminAgentPetView, 0, len(entries))
	for _, entry := range entries {
		if ids != nil && !slices.Contains(ids, entry.pet.ID) {
			continue
		}
		views = append(views, entry.adminView(sales[entry.pet.ID]))
	}
	return views, nil
}

func (s *Service) adminAgentPet(id string) (*AdminAgentPetView, error) {
	views, err := s.adminAgentPetViews([]string{id})
	if err != nil {
		return nil, err
	}
	if len(views) == 0 {
		return nil, NotFound("形象不存在")
	}
	return &views[0], nil
}

// UpdateAdminAgentPet 保存形象配置。内置形象第一次保存时落库，之后以数据库为准。
func (s *Service) UpdateAdminAgentPet(actor *model.User, id string, input AdminAgentPetInput) (*AdminAgentPetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	entry, found := findAgentPetEntry(entries, id)
	if !found {
		return nil, NotFound("形象不存在")
	}
	groups, err := s.userGroupCodeSet()
	if err != nil {
		return nil, err
	}
	next, err := agentPetRow(actor, entry, input, groups, time.Now())
	if err != nil {
		return nil, err
	}
	before := entry.adminView(repository.AgentPetSale{})
	if err := s.repo.SaveAgentPet(&next); err != nil {
		return nil, err
	}
	after, err := s.adminAgentPet(id)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "agent_pet.update", "agent_pet", id, "更新智能体形象 "+next.Name, map[string]any{"before": before, "after": after}); err != nil {
		return nil, err
	}
	return after, nil
}

// agentPetRow 按后台输入生成要保存的形象配置；单个保存和批量修改共用同一套校验。
func agentPetRow(actor *model.User, entry agentPetEntry, input AdminAgentPetInput, groups map[string]bool, now time.Time) (model.AgentPet, error) {
	name := agentpet.CleanText(input.Name, agentpet.MaxNameRunes)
	if name == "" {
		return model.AgentPet{}, BadAuthRequest("请填写形象名称")
	}
	access, err := agentpet.NormalizeAccess(input.Access, input.PriceMicrocredits, input.UnlockMicrocredits, input.GroupCodes)
	if err != nil {
		return model.AgentPet{}, err
	}
	for _, code := range access.GroupCodes {
		if !groups[code] {
			return model.AgentPet{}, BadAuthRequest("用户分组 " + code + " 不存在")
		}
	}
	stateRows, err := agentpet.NormalizeStateRows(input.StateRows)
	if err != nil {
		return model.AgentPet{}, err
	}
	if input.SortOrder < -100000 || input.SortOrder > 100000 {
		return model.AgentPet{}, BadAuthRequest("排序值须在 -100000 到 100000 之间")
	}
	category, err := agentpet.NormalizeLabel(input.Category, agentpet.MaxCategoryRunes, "分类")
	if err != nil {
		return model.AgentPet{}, err
	}
	badge, err := agentpet.NormalizeLabel(input.Badge, agentpet.MaxBadgeRunes, "角标")
	if err != nil {
		return model.AgentPet{}, err
	}
	requested := agentpet.Promotion{Enabled: input.PromoEnabled, Label: input.PromoLabel, PriceMicrocredits: input.PromoPriceMicrocredits, StartsAt: input.PromoStartsAt, EndsAt: input.PromoEndsAt}
	promo := entry.promo
	// 没改动的促销（比如只切换上架）原样保留，不因结束时间已过而无法保存；改了就重新校验。
	if !samePromotion(requested, entry.promo) || access.Mode != agentpet.AccessPaid || (promo.Enabled && promo.PriceMicrocredits >= access.PriceMicrocredits) {
		if promo, err = agentpet.NormalizePromotion(access, requested, now); err != nil {
			return model.AgentPet{}, err
		}
	}
	tone, lines := "", []string{}
	if entry.pet.Source == agentPetSourceUpload {
		if tone, lines, err = agentpet.NormalizeVoice(input.Tone, input.Lines); err != nil {
			return model.AgentPet{}, err
		}
	}
	groupsJSON, _ := json.Marshal(access.GroupCodes)
	rowsJSON, _ := json.Marshal(stateRows)
	linesJSON, _ := json.Marshal(lines)
	next := entry.pet
	next.Name = name
	next.Description = agentpet.CleanText(input.Description, agentpet.MaxDescriptionRunes)
	next.Enabled = input.Enabled
	next.Access = access.Mode
	next.PriceMicrocredits = access.PriceMicrocredits
	next.UnlockMicrocredits = access.UnlockMicrocredits
	next.GroupCodesJSON = string(groupsJSON)
	next.StateRowsJSON = string(rowsJSON)
	next.Tone = tone
	next.LinesJSON = string(linesJSON)
	next.Category = category
	next.Badge = badge
	next.PromoEnabled = promo.Enabled
	next.PromoLabel = promo.Label
	next.PromoPriceMicrocredits = promo.PriceMicrocredits
	next.PromoStartsAt = promo.StartsAt
	next.PromoEndsAt = promo.EndsAt
	next.Pixelated = input.Pixelated
	next.SortOrder = input.SortOrder
	next.UpdatedBy = actor.ID
	if !entry.stored {
		next.CreatedAt = now
	}
	return next, nil
}

func samePromotion(a, b agentpet.Promotion) bool {
	sameTime := func(x, y *time.Time) bool { return (x == nil) == (y == nil) && (x == nil || x.Equal(*y)) }
	return a.Enabled == b.Enabled && strings.TrimSpace(a.Label) == b.Label && a.PriceMicrocredits == b.PriceMicrocredits && sameTime(a.StartsAt, b.StartsAt) && sameTime(a.EndsAt, b.EndsAt)
}

// userGroupCodeSet 返回可选的用户分组编码（含默认分组）。
func (s *Service) userGroupCodeSet() (map[string]bool, error) {
	groups, err := s.repo.UserGroups()
	if err != nil {
		return nil, err
	}
	known := map[string]bool{model.DefaultUserGroupCode: true}
	for _, group := range groups {
		known[normalizeUserGroupCode(group.Code)] = true
	}
	return known, nil
}

func normalizeAgentPetBatchIDs(ids []string) ([]string, error) {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" && !slices.Contains(result, id) {
			result = append(result, id)
		}
	}
	if len(result) == 0 {
		return nil, BadAuthRequest("请选择要操作的形象")
	}
	if len(result) > maxAgentPetBatch {
		return nil, BadAuthRequest(fmt.Sprintf("一次最多操作 %d 个形象", maxAgentPetBatch))
	}
	return result, nil
}

// agentPetBatchSortOrders 算出“移到最前 / 最后”后所选形象的排序值：按形象库里的先后，
// 以 10 为间隔排在其余形象的最小值之前（或最大值之后）。其余形象的排序值不变。
func agentPetBatchSortOrders(entries []agentPetEntry, ids []string, position string) (map[string]int, error) {
	if position == "" {
		return nil, nil
	}
	if position != "first" && position != "last" {
		return nil, BadAuthRequest("排序位置须为 first 或 last")
	}
	const step = 10
	selected := make([]string, 0, len(ids))
	edge, hasOthers := 0, false
	for _, entry := range entries {
		if slices.Contains(ids, entry.pet.ID) {
			selected = append(selected, entry.pet.ID)
			continue
		}
		if order := entry.pet.SortOrder; !hasOthers || (position == "first" && order < edge) || (position == "last" && order > edge) {
			edge, hasOthers = order, true
		}
	}
	orders := make(map[string]int, len(selected))
	for i, id := range selected {
		order := edge + step*(i+1)
		if position == "first" {
			order = edge - step*(len(selected)-i)
		}
		if order < -100000 || order > 100000 {
			return nil, BadAuthRequest("排序值会超出 -100000 到 100000，请先在编辑里调整其他形象的排序")
		}
		orders[id] = order
	}
	return orders, nil
}

// BatchUpdateAdminAgentPets 批量修改上架、分类、角标、开放方式与价格、促销或排序位置。
// 不适用的形象（如给非积分购买的形象开促销）跳过并说明原因；校验失败时整批不保存。
func (s *Service) BatchUpdateAdminAgentPets(actor *model.User, input AdminAgentPetBatchInput) (*AdminAgentPetBatchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ids, err := normalizeAgentPetBatchIDs(input.IDs)
	if err != nil {
		return nil, err
	}
	if input.Enabled == nil && input.Category == nil && input.Badge == nil && input.Access == nil && input.Promotion == nil && input.SortPosition == "" {
		return nil, BadAuthRequest("请选择要批量修改的内容")
	}
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	sortOrders, err := agentPetBatchSortOrders(entries, ids, input.SortPosition)
	if err != nil {
		return nil, err
	}
	groups, err := s.userGroupCodeSet()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	result := &AdminAgentPetBatchResult{Pets: []AdminAgentPetView{}, Deleted: []string{}, Skipped: []AdminAgentPetBatchSkip{}}
	rows := make([]model.AgentPet, 0, len(ids))
	for _, id := range ids {
		entry, found := findAgentPetEntry(entries, id)
		if !found {
			result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: id, Reason: "形象不存在"})
			continue
		}
		next := entry.input()
		if input.Enabled != nil {
			next.Enabled = *input.Enabled
		}
		if input.Category != nil {
			next.Category = *input.Category
		}
		if input.Badge != nil {
			next.Badge = *input.Badge
		}
		if order, ok := sortOrders[id]; ok {
			next.SortOrder = order
		}
		if access := input.Access; access != nil {
			next.Access, next.PriceMicrocredits, next.UnlockMicrocredits, next.GroupCodes = access.Mode, access.PriceMicrocredits, access.UnlockMicrocredits, access.GroupCodes
			if access.Mode != agentpet.AccessPaid {
				next.PromoEnabled = false
			}
		}
		if promo := input.Promotion; promo != nil {
			if !promo.Enabled {
				next.PromoEnabled = false
			} else {
				if next.Access != agentpet.AccessPaid {
					result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: entry.pet.Name, Reason: "不是积分购买的形象，不能促销"})
					continue
				}
				price, err := agentpet.DiscountPrice(next.PriceMicrocredits, promo.Percent)
				if err != nil {
					return nil, err
				}
				if price >= next.PriceMicrocredits {
					result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: entry.pet.Name, Reason: "原价太低，打折后价格不变"})
					continue
				}
				next.PromoEnabled, next.PromoLabel, next.PromoPriceMicrocredits, next.PromoStartsAt, next.PromoEndsAt = true, promo.Label, price, promo.StartsAt, promo.EndsAt
			}
		}
		row, err := agentPetRow(actor, entry, next, groups, now)
		if err != nil {
			var appErr *AppError
			if errors.As(err, &appErr) {
				return nil, BadAuthRequest("「" + entry.pet.Name + "」" + appErr.Message)
			}
			return nil, err
		}
		rows = append(rows, row)
	}
	if len(rows) > 0 {
		if err := s.repo.SaveAgentPets(rows); err != nil {
			return nil, err
		}
	}
	updated := make([]string, 0, len(rows))
	for _, row := range rows {
		updated = append(updated, row.ID)
	}
	if len(updated) > 0 {
		if result.Pets, err = s.adminAgentPetViews(updated); err != nil {
			return nil, err
		}
	}
	if err := s.appendAdminAudit(actor, "agent_pet.batch_update", "agent_pet", strings.Join(updated, ","), fmt.Sprintf("批量修改 %d 个智能体形象", len(updated)), map[string]any{"ids": updated, "patch": input, "skipped": result.Skipped}); err != nil {
		return nil, err
	}
	return result, nil
}

// BatchDeleteAdminAgentPets 批量删除上传的形象；内置形象、已有人拥有的形象跳过并说明原因。
func (s *Service) BatchDeleteAdminAgentPets(actor *model.User, ids []string) (*AdminAgentPetBatchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ids, err := normalizeAgentPetBatchIDs(ids)
	if err != nil {
		return nil, err
	}
	result := &AdminAgentPetBatchResult{Pets: []AdminAgentPetView{}, Deleted: []string{}, Skipped: []AdminAgentPetBatchSkip{}}
	for _, id := range ids {
		pet, err := s.repo.AgentPet(id)
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			if builtin, ok := agentpet.LookupBuiltin(id); ok {
				result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: builtin.Name, Reason: "内置形象不能删除，可以下架"})
			} else {
				result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: id, Reason: "形象不存在"})
			}
			continue
		case err != nil:
			return nil, err
		case pet.Source != agentPetSourceUpload:
			result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: pet.Name, Reason: "内置形象不能删除，可以下架"})
			continue
		}
		switch err := s.repo.DeleteAgentPet(id); {
		case errors.Is(err, repository.ErrAgentPetOwned):
			result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: pet.Name, Reason: "已有用户购买或领取，可以下架"})
		case errors.Is(err, gorm.ErrRecordNotFound):
			result.Skipped = append(result.Skipped, AdminAgentPetBatchSkip{ID: id, Name: pet.Name, Reason: "形象不存在"})
		case err != nil:
			return nil, err
		default:
			result.Deleted = append(result.Deleted, id)
		}
	}
	if err := s.appendAdminAudit(actor, "agent_pet.batch_delete", "agent_pet", strings.Join(result.Deleted, ","), fmt.Sprintf("批量删除 %d 个智能体形象", len(result.Deleted)), map[string]any{"deleted": result.Deleted, "skipped": result.Skipped}); err != nil {
		return nil, err
	}
	return result, nil
}

// ImportAgentPet 导入 Codex 宠物 ZIP 或单张图集，图集存为本地资源；导入后默认未上架。
func (s *Service) ImportAgentPet(actor *model.User, header *multipart.FileHeader) (*AdminAgentPetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if header == nil {
		return nil, BadAuthRequest("请选择形象文件")
	}
	if header.Size <= 0 || header.Size > AgentPetImportMaxBytes {
		return nil, BadAuthRequest("形象文件不能为空，且不能超过 32 MiB")
	}
	file, err := header.Open()
	if err != nil {
		return nil, BadAuthRequest("形象文件无法读取")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, AgentPetImportMaxBytes+1))
	if err != nil || int64(len(data)) > AgentPetImportMaxBytes {
		return nil, BadAuthRequest("形象文件无法读取")
	}
	pkg, err := agentpet.ReadUpload(data, header.Filename)
	if err != nil {
		return nil, err
	}
	return s.importAgentPetPackage(actor, pkg, agentpet.UploadIDPrefix+newID())
}

func (s *Service) importAgentPetPackage(actor *model.User, pkg agentpet.Package, id string) (*AdminAgentPetView, error) {
	fileName := "spritesheet.webp"
	if pkg.Sheet.MimeType == "image/png" {
		fileName = "spritesheet.png"
	}
	resource, _, err := s.storeResource(actor.ID, agentPetResourceKind, fileName, pkg.Sheet.MimeType, int64(len(pkg.Data)), pkg.Sheet.Width, pkg.Sheet.Height, 0, bytes.NewReader(pkg.Data), nil, true)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.AgentPets()
	if err != nil {
		return nil, err
	}
	sortOrder := 0
	if builtins, err := agentpet.Builtins(); err == nil {
		for _, builtin := range builtins {
			sortOrder = max(sortOrder, builtin.SortOrder)
		}
	}
	for _, row := range rows {
		sortOrder = max(sortOrder, row.SortOrder)
	}
	pet := model.AgentPet{
		ID:             id,
		Source:         agentPetSourceUpload,
		ResourceID:     resource.ID,
		Name:           firstNonEmpty(pkg.Name, "自定义形象"),
		Description:    pkg.Description,
		SpriteVersion:  pkg.Sheet.Version,
		Access:         agentpet.AccessFree,
		GroupCodesJSON: "[]",
		StateRowsJSON:  "{}",
		LinesJSON:      "[]",
		SortOrder:      min(sortOrder+10, 100000),
		UpdatedBy:      actor.ID,
	}
	if err := s.repo.CreateAgentPet(&pet); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "agent_pet.import", "agent_pet", pet.ID, "导入智能体形象 "+pet.Name, map[string]any{"resourceId": resource.ID, "spriteVersion": pet.SpriteVersion}); err != nil {
		return nil, err
	}
	return s.adminAgentPet(pet.ID)
}

// DeleteAdminAgentPet 删除上传的形象；内置形象只能下架，已有人购买或领取的形象不能删除。
// 图集资源不再被引用后由资源清理流程回收。
func (s *Service) DeleteAdminAgentPet(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	pet, err := s.repo.AgentPet(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if _, builtin := agentpet.LookupBuiltin(id); builtin {
			return BadAuthRequest("内置形象不能删除，可以下架")
		}
		return NotFound("形象不存在")
	}
	if err != nil {
		return err
	}
	if pet.Source != agentPetSourceUpload {
		return BadAuthRequest("内置形象不能删除，可以下架")
	}
	switch err := s.repo.DeleteAgentPet(id); {
	case errors.Is(err, repository.ErrAgentPetOwned):
		return NewAppError(http.StatusConflict, repository.ErrAgentPetOwned.Error())
	case errors.Is(err, gorm.ErrRecordNotFound):
		return NotFound("形象不存在")
	case err != nil:
		return err
	}
	return s.appendAdminAudit(actor, "agent_pet.delete", "agent_pet", id, "删除智能体形象 "+pet.Name, map[string]any{"resourceId": pet.ResourceID})
}

// agentPetResourceReferences 让资源删除和回收跳过形象库仍在使用的图集；读不到形象库时全部视为被引用。
func (s *Service) agentPetResourceReferences(resourceIDs []string) map[string][]AdminResourceReferenceView {
	result := make(map[string][]AdminResourceReferenceView)
	pets, err := s.repo.AgentPetsByResourceIDs(resourceIDs)
	if err != nil {
		for _, resourceID := range resourceIDs {
			result[resourceID] = []AdminResourceReferenceView{{Kind: "智能体样式", ID: "agent_pets", Title: "形象库无法读取"}}
		}
		return result
	}
	for _, pet := range pets {
		result[pet.ResourceID] = appendUniqueAdminResourceReference(result[pet.ResourceID], AdminResourceReferenceView{Kind: "智能体样式", ID: pet.ID, Title: "智能体形象 " + pet.Name})
	}
	return result
}
