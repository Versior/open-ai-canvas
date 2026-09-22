package domainmcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxFindings      = 100
	maxArtifacts     = 50
	maxSources       = 50
	maxWarnings      = 50
	maxNextActions   = 50
	maxResultBytes   = 512 << 10
	maxSummaryRunes  = 4000
	maxTitleRunes    = 300
	maxDetailRunes   = 12000
	maxSnippetRunes  = 4000
	maxEvidenceIDLen = 80
)

type ErrorCode string

const (
	ErrorInputInvalid    ErrorCode = "INPUT_INVALID"
	ErrorNoEvidence      ErrorCode = "NO_EVIDENCE"
	ErrorUpstreamAuth    ErrorCode = "UPSTREAM_AUTH"
	ErrorUpstreamQuota   ErrorCode = "UPSTREAM_QUOTA"
	ErrorUpstreamTimeout ErrorCode = "UPSTREAM_TIMEOUT"
	ErrorPartialResult   ErrorCode = "PARTIAL_RESULT"
	ErrorPolicyBlocked   ErrorCode = "POLICY_BLOCKED"
	ErrorOutputInvalid   ErrorCode = "OUTPUT_INVALID"
)

type DomainError struct {
	Code    ErrorCode
	Message string
	Cause   error
}

func (e *DomainError) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Message) != "" {
		return e.Message
	}
	return string(e.Code)
}

func (e *DomainError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (e *DomainError) Is(target error) bool {
	var other *DomainError
	return e != nil && errors.As(target, &other) && e.Code != "" && e.Code == other.Code
}

func NewError(code ErrorCode, message string, cause error) *DomainError {
	return &DomainError{Code: code, Message: strings.TrimSpace(message), Cause: cause}
}

var (
	ErrInputInvalid    = NewError(ErrorInputInvalid, "输入无效", nil)
	ErrNoEvidence      = NewError(ErrorNoEvidence, "没有可用证据", nil)
	ErrUpstreamAuth    = NewError(ErrorUpstreamAuth, "上游认证失败", nil)
	ErrUpstreamQuota   = NewError(ErrorUpstreamQuota, "上游额度不足", nil)
	ErrUpstreamTimeout = NewError(ErrorUpstreamTimeout, "上游请求超时", nil)
	ErrPartialResult   = NewError(ErrorPartialResult, "仅返回部分结果", nil)
	ErrPolicyBlocked   = NewError(ErrorPolicyBlocked, "策略禁止该操作", nil)
	ErrOutputInvalid   = NewError(ErrorOutputInvalid, "输出合同无效", nil)
)

const (
	ArtifactText                  = "canvas.text"
	ArtifactTable                 = "canvas.table"
	ArtifactRecipe                = "canvas.recipe"
	ArtifactCommerceProductReport = "canvas.commerce-product-report"
	ArtifactCommerceHeroPlan      = "canvas.commerce-hero-plan"
	ArtifactCommerceDetailPlan    = "canvas.commerce-detail-plan"
	ArtifactBrandAudit            = "canvas.brand-audit"
	ArtifactSocialContentPlan     = "canvas.social-content-plan"
	ArtifactFilmReferenceBoard    = "canvas.film-reference-board"
	ArtifactStoryScript           = "canvas.story-script"
	ArtifactStoryboard            = "canvas.storyboard"
)

var allowedArtifactTypes = map[string]struct{}{
	ArtifactText: {}, ArtifactTable: {}, ArtifactRecipe: {}, ArtifactCommerceProductReport: {},
	ArtifactCommerceHeroPlan: {}, ArtifactCommerceDetailPlan: {}, ArtifactBrandAudit: {},
	ArtifactSocialContentPlan: {}, ArtifactFilmReferenceBoard: {}, ArtifactStoryScript: {}, ArtifactStoryboard: {},
}

type Evidence struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Snippet     string    `json:"snippet,omitempty"`
	Provider    string    `json:"provider,omitempty"`
	RetrievedAt time.Time `json:"retrievedAt"`
}

type Finding struct {
	Title       string   `json:"title"`
	Detail      string   `json:"detail"`
	Confidence  float64  `json:"confidence"`
	EvidenceIDs []string `json:"evidenceIds,omitempty"`
	External    bool     `json:"external,omitempty"`
}

type Artifact struct {
	Type    string `json:"type"`
	Title   string `json:"title"`
	Content any    `json:"content"`
}

type Result struct {
	Summary     string     `json:"summary"`
	Findings    []Finding  `json:"findings"`
	Artifacts   []Artifact `json:"artifacts"`
	Sources     []Evidence `json:"sources"`
	Warnings    []string   `json:"warnings"`
	NextActions []string   `json:"nextActions"`
}

func ValidateResult(result Result) error {
	if err := validateBoundedText("summary", result.Summary, maxSummaryRunes, true); err != nil {
		return outputInvalid(err)
	}
	if len(result.Findings) > maxFindings || len(result.Artifacts) > maxArtifacts || len(result.Sources) > maxSources || len(result.Warnings) > maxWarnings || len(result.NextActions) > maxNextActions {
		return outputInvalid(errors.New("结果集合超过数量限制"))
	}

	sources := make(map[string]struct{}, len(result.Sources))
	for _, source := range result.Sources {
		if source.ID == "" || len(source.ID) > maxEvidenceIDLen || strings.TrimSpace(source.ID) != source.ID {
			return outputInvalid(errors.New("证据 ID 无效"))
		}
		if _, duplicate := sources[source.ID]; duplicate {
			return outputInvalid(fmt.Errorf("证据 ID 重复: %s", source.ID))
		}
		if err := validateBoundedText("source.title", source.Title, maxTitleRunes, false); err != nil {
			return outputInvalid(err)
		}
		if err := validateBoundedText("source.snippet", source.Snippet, maxSnippetRunes, true); err != nil {
			return outputInvalid(err)
		}
		if err := validateEvidenceURL(source.URL); err != nil {
			return outputInvalid(err)
		}
		if source.RetrievedAt.IsZero() {
			return outputInvalid(errors.New("证据缺少 retrievedAt"))
		}
		sources[source.ID] = struct{}{}
	}

	for _, finding := range result.Findings {
		if err := validateBoundedText("finding.title", finding.Title, maxTitleRunes, false); err != nil {
			return outputInvalid(err)
		}
		if err := validateBoundedText("finding.detail", finding.Detail, maxDetailRunes, false); err != nil {
			return outputInvalid(err)
		}
		if finding.Confidence < 0 || finding.Confidence > 1 {
			return outputInvalid(errors.New("finding.confidence 必须在 0 到 1 之间"))
		}
		if finding.External && len(finding.EvidenceIDs) == 0 {
			return NewError(ErrorNoEvidence, "外部事实缺少证据", nil)
		}
		for _, evidenceID := range finding.EvidenceIDs {
			if _, exists := sources[evidenceID]; !exists {
				return outputInvalid(fmt.Errorf("发现引用未知证据: %s", evidenceID))
			}
		}
	}

	for _, artifact := range result.Artifacts {
		if _, allowed := allowedArtifactTypes[artifact.Type]; !allowed {
			return outputInvalid(fmt.Errorf("不支持的 Artifact 类型: %s", artifact.Type))
		}
		if err := validateBoundedText("artifact.title", artifact.Title, maxTitleRunes, false); err != nil {
			return outputInvalid(err)
		}
		if artifact.Content == nil {
			return outputInvalid(errors.New("Artifact content 不能为空"))
		}
	}
	for _, warning := range result.Warnings {
		if err := validateBoundedText("warning", warning, maxDetailRunes, false); err != nil {
			return outputInvalid(err)
		}
	}
	for _, action := range result.NextActions {
		if err := validateBoundedText("nextAction", action, maxDetailRunes, false); err != nil {
			return outputInvalid(err)
		}
	}

	encoded, err := json.Marshal(result)
	if err != nil {
		return outputInvalid(fmt.Errorf("结果无法编码: %w", err))
	}
	if len(encoded) > maxResultBytes {
		return outputInvalid(fmt.Errorf("结果超过 %d 字节", maxResultBytes))
	}
	return nil
}

func outputInvalid(cause error) error {
	return NewError(ErrorOutputInvalid, "输出不符合领域 MCP 合同", cause)
}

func validateBoundedText(field string, value string, maxRunes int, allowEmpty bool) error {
	if !utf8.ValidString(value) {
		return fmt.Errorf("%s 不是有效 UTF-8", field)
	}
	if strings.TrimSpace(value) != value {
		return fmt.Errorf("%s 不能包含首尾空白", field)
	}
	if !allowEmpty && value == "" {
		return fmt.Errorf("%s 不能为空", field)
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return fmt.Errorf("%s 超过 %d 个字符", field, maxRunes)
	}
	return nil
}

func validateEvidenceURL(raw string) error {
	if raw == "" || len(raw) > 4096 {
		return errors.New("证据 URL 为空或过长")
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return errors.New("证据 URL 必须是无凭据的绝对 HTTPS 地址")
	}
	return nil
}
