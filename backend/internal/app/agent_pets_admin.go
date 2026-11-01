package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"slices"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/agentpet"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// AgentPetImportMaxBytes 是后台导入形象文件（ZIP 或图集）的大小上限。
const AgentPetImportMaxBytes = agentpet.MaxPackageBytes

// AdminAgentPetView 是后台形象库的一行。
type AdminAgentPetView struct {
	AgentPetView
	Source     string     `json:"source"`
	Enabled    bool       `json:"enabled"`
	GroupCodes []string   `json:"groupCodes"`
	SortOrder  int        `json:"sortOrder"`
	OwnerCount int64      `json:"ownerCount"`
	UpdatedAt  *time.Time `json:"updatedAt,omitempty"`
}

// AdminAgentPetInput 是后台保存一个形象的完整配置。
type AdminAgentPetInput struct {
	Name              string            `json:"name"`
	Description       string            `json:"description"`
	Enabled           bool              `json:"enabled"`
	Access            string            `json:"access"`
	PriceMicrocredits int64             `json:"priceMicrocredits"`
	GroupCodes        []string          `json:"groupCodes"`
	StateRows         map[string]string `json:"stateRows"`
	Pixelated         bool              `json:"pixelated"`
	SortOrder         int               `json:"sortOrder"`
}

func (entry agentPetEntry) adminView(owners int64) AdminAgentPetView {
	view := AdminAgentPetView{
		AgentPetView: entry.userView("", false, true),
		Source:       entry.pet.Source,
		Enabled:      entry.pet.Enabled,
		GroupCodes:   entry.access.GroupCodes,
		SortOrder:    entry.pet.SortOrder,
		OwnerCount:   owners,
		UpdatedAt:    agentPetTimestamp(entry),
	}
	view.Usable = true
	view.Purchasable = false
	return view
}

func (s *Service) AdminAgentPets(actor *model.User) ([]AdminAgentPetView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	owners, err := s.repo.AgentPetOwnerCounts()
	if err != nil {
		return nil, err
	}
	views := make([]AdminAgentPetView, 0, len(entries))
	for _, entry := range entries {
		views = append(views, entry.adminView(owners[entry.pet.ID]))
	}
	return views, nil
}

func (s *Service) adminAgentPet(id string) (*AdminAgentPetView, error) {
	entries, err := s.agentPetLibrary()
	if err != nil {
		return nil, err
	}
	entry, found := findAgentPetEntry(entries, id)
	if !found {
		return nil, NotFound("形象不存在")
	}
	owners, err := s.repo.AgentPetOwnerCounts()
	if err != nil {
		return nil, err
	}
	view := entry.adminView(owners[id])
	return &view, nil
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
	name := agentpet.CleanText(input.Name, agentpet.MaxNameRunes)
	if name == "" {
		return nil, BadAuthRequest("请填写形象名称")
	}
	access, err := agentpet.NormalizeAccess(input.Access, input.PriceMicrocredits, input.GroupCodes)
	if err != nil {
		return nil, err
	}
	if err := s.requireExistingUserGroups(access.GroupCodes); err != nil {
		return nil, err
	}
	stateRows, err := agentpet.NormalizeStateRows(input.StateRows)
	if err != nil {
		return nil, err
	}
	if input.SortOrder < -100000 || input.SortOrder > 100000 {
		return nil, BadAuthRequest("排序值须在 -100000 到 100000 之间")
	}
	groupsJSON, _ := json.Marshal(access.GroupCodes)
	rowsJSON, _ := json.Marshal(stateRows)
	before := entry.adminView(0)
	next := entry.pet
	next.Name = name
	next.Description = agentpet.CleanText(input.Description, agentpet.MaxDescriptionRunes)
	next.Enabled = input.Enabled
	next.Access = access.Mode
	next.PriceMicrocredits = access.PriceMicrocredits
	next.GroupCodesJSON = string(groupsJSON)
	next.StateRowsJSON = string(rowsJSON)
	next.Pixelated = input.Pixelated
	next.SortOrder = input.SortOrder
	next.UpdatedBy = actor.ID
	if !entry.stored {
		next.CreatedAt = time.Now()
	}
	if err := s.repo.SaveAgentPet(&next); err != nil {
		return nil, err
	}
	after, err := s.adminAgentPet(id)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "agent_pet.update", "agent_pet", id, "更新智能体形象 "+name, map[string]any{"before": before, "after": after}); err != nil {
		return nil, err
	}
	return after, nil
}

func (s *Service) requireExistingUserGroups(codes []string) error {
	if len(codes) == 0 {
		return nil
	}
	groups, err := s.repo.UserGroups()
	if err != nil {
		return err
	}
	known := []string{model.DefaultUserGroupCode}
	for _, group := range groups {
		known = append(known, normalizeUserGroupCode(group.Code))
	}
	for _, code := range codes {
		if !slices.Contains(known, code) {
			return BadAuthRequest("用户分组 " + code + " 不存在")
		}
	}
	return nil
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
		ID:             agentpet.UploadIDPrefix + newID(),
		Source:         agentPetSourceUpload,
		ResourceID:     resource.ID,
		Name:           firstNonEmpty(pkg.Name, "自定义形象"),
		Description:    pkg.Description,
		SpriteVersion:  pkg.Sheet.Version,
		Access:         agentpet.AccessFree,
		GroupCodesJSON: "[]",
		StateRowsJSON:  "{}",
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

// DeleteAdminAgentPet 删除上传的形象；内置形象只能下架，已有人购买的形象不能删除。
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
