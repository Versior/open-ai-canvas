package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/agentpet"
	"yingce/backend/internal/model"
)

const AgentPetDefaultManifestURL = "https://raw.githubusercontent.com/Versior/agent-pet-library/main/manifest.json"
const agentPetRemoteSettingKey = "agent_pets.remote_manifest_url"

type AgentPetRemoteInput struct {
	ManifestURL string `json:"manifestUrl"`
}
type AgentPetRemoteView struct {
	StudioModelRemoteImportView
	ManifestURL string `json:"manifestUrl"`
}
type AgentPetManifestItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	SHA256      string `json:"sha256"`
}

func validateAgentPetRemoteURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || len(raw) > 2048 {
		return BadAuthRequest("请填写不带凭据、查询串的 HTTPS 清单地址")
	}
	_, err = ValidateOutboundURL(raw)
	return err
}

func (s *Service) AgentPetRemoteStatus(actor *model.User) (*AgentPetRemoteView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.agentPetImportMu.Lock()
	defer s.agentPetImportMu.Unlock()
	return s.agentPetRemoteViewLocked()
}

func (s *Service) agentPetRemoteViewLocked() (*AgentPetRemoteView, error) {
	source := AgentPetDefaultManifestURL
	setting, err := s.repo.SystemSettingOptional(agentPetRemoteSettingKey)
	if err != nil {
		return nil, err
	}
	if setting != nil {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &source); err != nil {
			return nil, err
		}
	}
	view := StudioModelRemoteImportView{Status: "idle", Report: StudioModelImportReport{Failures: []StudioModelImportFailure{}}, Sources: []StudioModelSource{}}
	if s.agentPetImport != nil {
		view = s.agentPetImport.snapshot()
	}
	return &AgentPetRemoteView{StudioModelRemoteImportView: view, ManifestURL: source}, nil
}

func (s *Service) StartAgentPetRemoteImport(actor *model.User, input AgentPetRemoteInput) (*AgentPetRemoteView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	source := strings.TrimSpace(input.ManifestURL)
	if source == "" {
		source = AgentPetDefaultManifestURL
	}
	if err := validateAgentPetRemoteURL(source); err != nil {
		return nil, err
	}
	s.agentPetImportMu.Lock()
	defer s.agentPetImportMu.Unlock()
	if s.agentPetImport != nil && s.agentPetImport.running() {
		return nil, WrapAppError(http.StatusConflict, "已有一次形象拉取在进行", nil)
	}
	if err := s.appendAdminAudit(actor, "agent_pet.remote_import", "agent_pet", "remote-import", "从远端同步智能体形象", map[string]any{"manifest": source}); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(source)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: agentPetRemoteSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	job := &studioModelImportJob{cancel: cancel, view: StudioModelRemoteImportView{Status: "running", Source: source, StartedAt: time.Now().UTC().Format(time.RFC3339), Report: StudioModelImportReport{Failures: []StudioModelImportFailure{}}}}
	s.agentPetImport = job
	owner := *actor
	go s.runAgentPetRemoteImport(ctx, job, &owner, source)
	return s.agentPetRemoteViewLocked()
}

func (s *Service) CancelAgentPetRemoteImport(actor *model.User) (*AgentPetRemoteView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.agentPetImportMu.Lock()
	defer s.agentPetImportMu.Unlock()
	if s.agentPetImport != nil {
		s.agentPetImport.cancel()
	}
	return s.agentPetRemoteViewLocked()
}

func (s *Service) importRemoteAgentPet(ctx context.Context, actor *model.User, item AgentPetManifestItem, download func(context.Context, string, int64) ([]byte, error)) (bool, error) {
	digest := strings.ToLower(strings.TrimSpace(item.SHA256))
	hash, err := hex.DecodeString(digest)
	if err != nil || len(hash) != sha256.Size {
		return false, BadAuthRequest("图集需要有效 SHA-256 摘要")
	}
	id := agentpet.UploadIDPrefix + "remote-" + digest[:48]
	if _, err := s.repo.AgentPet(id); err == nil {
		return true, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	if err := validateAgentPetRemoteURL(item.URL); err != nil {
		return false, err
	}
	data, err := download(ctx, item.URL, agentpet.MaxSheetBytes)
	if err != nil {
		return false, err
	}
	actual := sha256.Sum256(data)
	if hex.EncodeToString(actual[:]) != digest {
		return false, BadAuthRequest("图集摘要不匹配，未导入")
	}
	pkg, err := agentpet.ReadUpload(data, "spritesheet.webp")
	if err != nil {
		return false, err
	}
	pkg.Name = agentpet.CleanText(item.Name, agentpet.MaxNameRunes)
	if pkg.Name == "" {
		return false, BadAuthRequest("形象名称不能为空")
	}
	pkg.Description = agentpet.CleanText(item.Description, agentpet.MaxDescriptionRunes)
	_, err = s.importAgentPetPackage(actor, pkg, id)
	return false, err
}

func (s *Service) runAgentPetRemoteImport(ctx context.Context, job *studioModelImportJob, actor *model.User, source string) {
	defer job.cancel()
	data, err := DownloadStudioModelFile(ctx, source, 8<<20)
	var manifest struct {
		Version int                    `json:"version"`
		Items   []AgentPetManifestItem `json:"items"`
	}
	if err == nil {
		err = json.Unmarshal(data, &manifest)
	}
	if err == nil && (manifest.Version != 1 || len(manifest.Items) == 0 || len(manifest.Items) > 5000) {
		err = BadAuthRequest("清单须为 version: 1，含 1–5000 个图集")
	}
	if err != nil {
		job.finish("failed", "清单读取失败："+videoTeardownErrorMessage(err))
		return
	}
	report := StudioModelImportReport{Total: len(manifest.Items), Failures: []StudioModelImportFailure{}}
	// 手动上传过的形象也参与内容去重，切换为仓库同步后保留其 ID、价格和用户选择。
	existing := map[string]bool{}
	rows, err := s.repo.AgentPets()
	if err != nil {
		job.finish("failed", "形象库读取失败")
		return
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			job.finish("cancelled", "")
			return
		}
		if row.Source != agentPetSourceUpload {
			continue
		}
		data, _, err := s.readUploadedAgentPetSheet(row.ResourceID)
		if err != nil {
			slog.Warn("同步去重时已有图集不可用", "pet", row.ID)
			continue
		}
		digest := sha256.Sum256(data)
		existing[hex.EncodeToString(digest[:])] = true
	}
	job.setReport(report)
	for _, item := range manifest.Items {
		if ctx.Err() != nil {
			job.finish("cancelled", "")
			return
		}
		digest := strings.ToLower(strings.TrimSpace(item.SHA256))
		skipped := existing[digest]
		var err error
		if !skipped {
			skipped, err = s.importRemoteAgentPet(ctx, actor, item, DownloadStudioModelFile)
		}
		if ctx.Err() != nil {
			job.finish("cancelled", "")
			return
		}
		report.Done++
		switch {
		case err != nil:
			report.fail(item.Name, err)
		case skipped:
			report.Skipped++
		default:
			report.Imported++
		}
		if err == nil {
			existing[digest] = true
		}
		job.setReport(report)
	}
	status := "done"
	if report.Failed > 0 {
		status = "failed"
	}
	job.finish(status, "")
	if err := s.appendAdminAudit(actor, "agent_pet.remote_import_done", "agent_pet", "remote-import", fmt.Sprintf("形象同步：新增 %d，跳过 %d，失败 %d", report.Imported, report.Skipped, report.Failed), report); err != nil {
		job.finish("failed", "同步审计保存失败")
	}
}
