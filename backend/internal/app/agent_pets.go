package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/agentpet"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	agentPetResourceKind  = "agent-pet"
	agentPetSourceBuiltin = "builtin"
	agentPetSourceUpload  = "upload"
)

// AgentPetView 是用户可见的一个智能体形象及其对当前用户的使用资格。
type AgentPetView struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Description       string            `json:"description"`
	SpriteVersion     int               `json:"spriteVersion"`
	Revision          string            `json:"revision"`
	Pixelated         bool              `json:"pixelated"`
	StateRows         map[string]string `json:"stateRows"`
	Access            string            `json:"access"`
	PriceMicrocredits int64             `json:"priceMicrocredits"`
	Owned             bool              `json:"owned"`
	MemberFree        bool              `json:"memberFree"`
	Usable            bool              `json:"usable"`
	Purchasable       bool              `json:"purchasable"`
	// UnlockMicrocredits 是累计消费解锁的门槛（仅 spend）；Claimable 表示已达标、使用时自动领取。
	UnlockMicrocredits int64 `json:"unlockMicrocredits"`
	Claimable          bool  `json:"claimable"`
	// Tone 与 Lines 用于头顶气泡：内置形象有专属风格和台词，上传形象为空，由前端使用通用语气。
	Tone  string   `json:"tone"`
	Lines []string `json:"lines"`
}

// AgentPetCatalog 是用户的形象列表；SelectedPetID 为空表示使用站点默认形象。
// ConsumedMicrocredits 是用户累计消费（已结算的模型调用积分），用于累计消费解锁。
type AgentPetCatalog struct {
	Pets                 []AgentPetView `json:"pets"`
	SelectedPetID        string         `json:"selectedPetId"`
	CreditsEnabled       bool           `json:"creditsEnabled"`
	ConsumedMicrocredits int64          `json:"consumedMicrocredits"`
}

type AgentPetPurchaseResult struct {
	Pet                   AgentPetView `json:"pet"`
	Charged               bool         `json:"charged"`
	AvailableMicrocredits int64        `json:"availableMicrocredits"`
}

// AgentPetSheet 是图集内容；Revision 与列表里的 revision 一致，用作缓存版本。
type AgentPetSheet struct {
	Data     []byte
	MimeType string
	Revision string
}

// agentPetEntry 是合并内置默认值与数据库配置后的生效配置。
type agentPetEntry struct {
	pet       model.AgentPet
	access    agentpet.Access
	stateRows map[string]string
	revision  string
	stored    bool
	tone      string
	lines     []string
}

// agentPetLibrary 返回全部形象：内置形象未配置时按默认值（未上架、免费），上传形象以数据库为准。
func (s *Service) agentPetLibrary() ([]agentPetEntry, error) {
	builtins, err := agentpet.Builtins()
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.AgentPets()
	if err != nil {
		return nil, err
	}
	stored := make(map[string]model.AgentPet, len(rows))
	for _, row := range rows {
		stored[row.ID] = row
	}
	entries := make([]agentPetEntry, 0, len(builtins)+len(rows))
	for _, builtin := range builtins {
		row, ok := stored[builtin.ID]
		if !ok {
			row = model.AgentPet{ID: builtin.ID, Name: builtin.Name, Description: builtin.Description, Access: agentpet.AccessFree, GroupCodesJSON: "[]", StateRowsJSON: "{}", Pixelated: builtin.Pixelated, SortOrder: builtin.SortOrder}
		}
		row.Source = agentPetSourceBuiltin
		row.SpriteVersion = builtin.SpriteVersion
		entry, err := newAgentPetEntry(row, builtin.Revision, ok)
		if err != nil {
			return nil, err
		}
		entry.tone, entry.lines = builtin.Tone, builtin.Lines
		entries = append(entries, entry)
	}
	// 内置目录里已移除的形象即使留有配置也不再出现。
	for _, row := range rows {
		if row.Source != agentPetSourceUpload {
			continue
		}
		entry, err := newAgentPetEntry(row, uploadedAgentPetRevision(row.ResourceID), true)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].pet.SortOrder != entries[j].pet.SortOrder {
			return entries[i].pet.SortOrder < entries[j].pet.SortOrder
		}
		return entries[i].pet.ID < entries[j].pet.ID
	})
	return entries, nil
}

func newAgentPetEntry(row model.AgentPet, revision string, stored bool) (agentPetEntry, error) {
	var groups []string
	if err := json.Unmarshal([]byte(row.GroupCodesJSON), &groups); err != nil {
		return agentPetEntry{}, fmt.Errorf("智能体形象 %s 的分组配置无效：%w", row.ID, err)
	}
	rows := map[string]string{}
	if err := json.Unmarshal([]byte(row.StateRowsJSON), &rows); err != nil {
		return agentPetEntry{}, fmt.Errorf("智能体形象 %s 的状态映射无效：%w", row.ID, err)
	}
	if groups == nil {
		groups = []string{}
	}
	access := agentpet.Access{Mode: row.Access, PriceMicrocredits: row.PriceMicrocredits, UnlockMicrocredits: row.UnlockMicrocredits, GroupCodes: groups}
	return agentPetEntry{pet: row, access: access, stateRows: rows, revision: revision, stored: stored, lines: []string{}}, nil
}

func uploadedAgentPetRevision(resourceID string) string {
	if len(resourceID) > 16 {
		return resourceID[:16]
	}
	return resourceID
}

func findAgentPetEntry(entries []agentPetEntry, id string) (agentPetEntry, bool) {
	for _, entry := range entries {
		if entry.pet.ID == id {
			return entry, true
		}
	}
	return agentPetEntry{}, false
}

func (entry agentPetEntry) userView(groupCode string, owned bool, creditsEnabled bool, consumed int64) AgentPetView {
	entitlement := agentpet.Entitle(entry.access, groupCode, owned, consumed)
	price, unlock := int64(0), int64(0)
	switch entry.access.Mode {
	case agentpet.AccessPaid:
		price = entry.access.PriceMicrocredits
	case agentpet.AccessSpend:
		unlock = entry.access.UnlockMicrocredits
	}
	return AgentPetView{
		ID:                 entry.pet.ID,
		Name:               entry.pet.Name,
		Description:        entry.pet.Description,
		SpriteVersion:      entry.pet.SpriteVersion,
		Revision:           entry.revision,
		Pixelated:          entry.pet.Pixelated,
		StateRows:          entry.stateRows,
		Access:             entry.access.Mode,
		PriceMicrocredits:  price,
		Owned:              owned,
		MemberFree:         entitlement.MemberFree,
		Usable:             entitlement.Usable,
		Purchasable:        entitlement.Purchasable && entry.pet.Enabled && creditsEnabled,
		UnlockMicrocredits: unlock,
		Claimable:          entitlement.Claimable,
		Tone:               entry.tone,
		Lines:              entry.lines,
	}
}

// userConsumedMicrocredits 与后台用户列表的“已消费”一致：已结算模型调用的实际扣费。
func (s *Service) userConsumedMicrocredits(userID string) (int64, error) {
	totals, err := s.repo.UserCreditTotals([]string{userID})
	if err != nil {
		return 0, err
	}
	return totals[userID].ConsumedMicrocredits, nil
}

// AgentPetCatalog 返回已上架的形象和用户已拥有（购买或领取）的形象（已下架的已拥有形象仍可使用）。
func (s *Service) AgentPetCatalog(actor *model.User) (*AgentPetCatalog, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	owned, err := s.repo.OwnedAgentPetIDs(actor.ID)
	if err != nil {
		return nil, err
	}
	selected, err := s.repo.AgentPetSelection(actor.ID)
	if err != nil {
		return nil, err
	}
	creditsEnabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return nil, err
	}
	consumed, err := s.userConsumedMicrocredits(actor.ID)
	if err != nil {
		return nil, err
	}
	groupCode := normalizeUserGroupCode(actor.UserGroup)
	catalog := &AgentPetCatalog{Pets: []AgentPetView{}, CreditsEnabled: creditsEnabled, ConsumedMicrocredits: consumed}
	for _, entry := range entries {
		if !entry.pet.Enabled && !owned[entry.pet.ID] {
			continue
		}
		view := entry.userView(groupCode, owned[entry.pet.ID], creditsEnabled, consumed)
		catalog.Pets = append(catalog.Pets, view)
		// 失去资格（如分组变化、形象下架）的选择按默认形象处理，资格恢复后自动生效。
		if view.ID == selected && view.Usable {
			catalog.SelectedPetID = selected
		}
	}
	return catalog, nil
}

// AgentPetSelection 返回用户当前使用的形象；没有选择或已不可用时返回 nil。
func (s *Service) AgentPetSelection(actor *model.User) (*AgentPetView, error) {
	catalog, err := s.AgentPetCatalog(actor)
	if err != nil {
		return nil, err
	}
	for _, pet := range catalog.Pets {
		if pet.ID == catalog.SelectedPetID {
			return &pet, nil
		}
	}
	return nil, nil
}

// SelectAgentPet 切换当前形象；petID 为空表示恢复站点默认形象。
func (s *Service) SelectAgentPet(actor *model.User, petID string) (*AgentPetView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	petID = strings.TrimSpace(petID)
	if petID == "" {
		return nil, s.repo.SaveAgentPetSelection(actor.ID, "")
	}
	catalog, err := s.AgentPetCatalog(actor)
	if err != nil {
		return nil, err
	}
	for _, pet := range catalog.Pets {
		if pet.ID != petID {
			continue
		}
		if !pet.Usable {
			switch pet.Access {
			case agentpet.AccessVIP:
				return nil, Forbidden("该形象为 VIP 专享")
			case agentpet.AccessSpend:
				return nil, Forbidden(fmt.Sprintf("累计消费满 %s 积分即可领取", formatAgentPetCredits(pet.UnlockMicrocredits)))
			}
			return nil, Forbidden("请先购买该形象")
		}
		// 累计消费达标的形象在第一次使用时领取，之后门槛调整也不影响。
		if pet.Claimable {
			if err := s.repo.ClaimAgentPet(actor.ID, petID); err != nil {
				return nil, err
			}
			pet.Owned, pet.Claimable = true, false
		}
		if err := s.repo.SaveAgentPetSelection(actor.ID, petID); err != nil {
			return nil, err
		}
		return &pet, nil
	}
	return nil, NotFound("形象不存在或已下架")
}

// PurchaseAgentPet 用积分购买付费形象。expectedPrice 是用户确认时看到的价格，价格变化时拒绝扣费。
func (s *Service) PurchaseAgentPet(actor *model.User, petID string, expectedPrice int64) (*AgentPetPurchaseResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	entry, found := findAgentPetEntry(entries, strings.TrimSpace(petID))
	owned, err := s.repo.OwnedAgentPetIDs(actor.ID)
	if err != nil {
		return nil, err
	}
	if !found || (!entry.pet.Enabled && !owned[entry.pet.ID]) {
		return nil, NotFound("形象不存在或已下架")
	}
	groupCode := normalizeUserGroupCode(actor.UserGroup)
	if !owned[entry.pet.ID] {
		entitlement := agentpet.Entitle(entry.access, groupCode, false, 0)
		switch {
		case entitlement.MemberFree:
			return nil, BadAuthRequest("你所在的分组可以免费使用该形象，无需购买")
		case entry.access.Mode == agentpet.AccessVIP:
			return nil, Forbidden("该形象为 VIP 专享，不能购买")
		case entry.access.Mode == agentpet.AccessSpend:
			return nil, BadAuthRequest(fmt.Sprintf("累计消费满 %s 积分即可领取，无需购买", formatAgentPetCredits(entry.access.UnlockMicrocredits)))
		case !entitlement.Purchasable:
			return nil, BadAuthRequest("免费形象无需购买")
		case expectedPrice != entry.access.PriceMicrocredits:
			return nil, NewAppError(http.StatusConflict, "价格已变化，请刷新后重试")
		}
	}
	charged, account, err := s.repo.PurchaseAgentPet(repository.AgentPetPurchase{
		UserID:            actor.ID,
		PetID:             entry.pet.ID,
		Access:            agentpet.AccessPaid,
		PriceMicrocredits: entry.access.PriceMicrocredits,
		Note:              "购买智能体形象：" + entry.pet.Name,
	})
	switch {
	case errors.Is(err, repository.ErrInsufficientCredits):
		appErr := BadAuthRequest("积分不足，请先充值")
		appErr.Reason = kernel.ReasonFailedPrecondition
		appErr.Details = map[string]any{"requiredMicrocredits": entry.access.PriceMicrocredits}
		return nil, appErr
	case errors.Is(err, repository.ErrAgentPetUnavailable):
		return nil, NewAppError(http.StatusConflict, repository.ErrAgentPetUnavailable.Error())
	case err != nil:
		return nil, err
	}
	return &AgentPetPurchaseResult{Pet: entry.userView(groupCode, true, true, 0), Charged: charged, AvailableMicrocredits: account.AvailableMicrocredits}, nil
}

// formatAgentPetCredits 把微积分格式化为最多两位小数的积分数。
func formatAgentPetCredits(microcredits int64) string {
	value := strconv.FormatFloat(float64(microcredits)/float64(CreditScale), 'f', 2, 64)
	return strings.TrimSuffix(strings.TrimSuffix(value, "0"), ".0")
}

// AgentPetSpritesheet 返回图集。已上架的形象所有登录用户可读（用于商店预览），
// 已下架的只有已拥有的用户和管理员可读。
func (s *Service) AgentPetSpritesheet(actor *model.User, petID string) (*AgentPetSheet, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	entry, found := findAgentPetEntry(entries, petID)
	if !found {
		return nil, NotFound("形象不存在")
	}
	if !entry.pet.Enabled && s.RequireAdmin(actor) != nil {
		owned, err := s.repo.OwnedAgentPetIDs(actor.ID)
		if err != nil {
			return nil, err
		}
		if !owned[entry.pet.ID] {
			return nil, NotFound("形象不存在")
		}
	}
	if entry.pet.Source == agentPetSourceBuiltin {
		data, sheet, err := agentpet.BuiltinSheet(entry.pet.ID)
		if err != nil {
			return nil, err
		}
		return &AgentPetSheet{Data: data, MimeType: sheet.MimeType, Revision: entry.revision}, nil
	}
	data, sheet, err := s.readUploadedAgentPetSheet(entry.pet.ResourceID)
	if err != nil {
		return nil, err
	}
	return &AgentPetSheet{Data: data, MimeType: sheet.MimeType, Revision: entry.revision}, nil
}

func (s *Service) readUploadedAgentPetSheet(resourceID string) ([]byte, agentpet.Sheet, error) {
	resource, err := s.repo.Resource(resourceID)
	if err != nil || resource.Kind != agentPetResourceKind || resource.Provider != "local" || resource.Status != model.ResourceStatusReady || resource.Size > agentpet.MaxSheetBytes {
		return nil, agentpet.Sheet{}, NotFound("形象图集不可用")
	}
	data, err := os.ReadFile(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	if err != nil {
		return nil, agentpet.Sheet{}, NotFound("形象图集不可用")
	}
	sheet, err := agentpet.InspectSheet(data)
	return data, sheet, err
}

func agentPetTimestamp(entry agentPetEntry) *time.Time {
	if !entry.stored || entry.pet.UpdatedAt.IsZero() {
		return nil
	}
	value := entry.pet.UpdatedAt
	return &value
}
