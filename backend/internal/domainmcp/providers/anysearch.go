package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/domainmcp"
	mcpprotocol "infinite-canvas/backend/internal/mcp"
)

const (
	anySearchProviderName = "anysearch"
	maxSearchQueryRunes   = 500
	maxSearchHits         = 10
	maxSearchTitleRunes   = 300
	maxSearchSnippetRunes = 4000
	maxExtractRunes       = 50000
)

var markdownLinkPattern = regexp.MustCompile(`\[([^\]]+)\]\((https://[^\s)]+)\)`)

type AnySearch struct {
	client   *mcpprotocol.Service
	snapshot mcpprotocol.ServerSnapshot
	now      func() time.Time
}

func NewAnySearch(client *mcpprotocol.Service, snapshot mcpprotocol.ServerSnapshot) (*AnySearch, error) {
	if client == nil {
		return nil, errors.New("AnySearch MCP Client 不能为空")
	}
	if err := client.ValidateSnapshot(snapshot); err != nil {
		return nil, fmt.Errorf("AnySearch MCP 快照无效: %w", err)
	}
	for _, toolName := range []string{"search", "extract"} {
		if err := client.ValidateTool(snapshot, toolName); err != nil {
			return nil, fmt.Errorf("AnySearch 缺少工具 %s: %w", toolName, err)
		}
	}
	return &AnySearch{client: client, snapshot: snapshot, now: time.Now}, nil
}

func (a *AnySearch) Search(ctx context.Context, input SearchQuery) ([]SearchHit, error) {
	query, arguments, err := normalizeSearchQuery(input)
	if err != nil {
		return nil, err
	}
	result, err := a.client.CallTool(ctx, a.snapshot, "search", arguments)
	if err != nil {
		return nil, mapAnySearchFailure(err, "")
	}
	if result.IsError {
		return nil, mapAnySearchFailure(errors.New("AnySearch 工具返回失败"), toolText(result))
	}

	candidates, malformed := anySearchCandidates(result)
	now := a.now().UTC()
	hits := make([]SearchHit, 0, minInt(len(candidates), query.Limit))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		hit, valid := normalizeSearchHit(candidate, now)
		if !valid {
			malformed++
			continue
		}
		if _, duplicate := seen[hit.URL]; duplicate {
			continue
		}
		seen[hit.URL] = struct{}{}
		hits = append(hits, hit)
		if len(hits) >= query.Limit {
			break
		}
	}
	if len(hits) == 0 {
		return nil, domainmcp.NewError(domainmcp.ErrorNoEvidence, "AnySearch 没有返回可用的 HTTPS 来源", nil)
	}
	if malformed > 0 {
		return hits, domainmcp.NewError(domainmcp.ErrorPartialResult, "AnySearch 部分结果未通过来源校验", nil)
	}
	return hits, nil
}

func (a *AnySearch) Extract(ctx context.Context, rawURL string) (ExtractedPage, error) {
	parsed, err := validatePublicHTTPSURL(rawURL)
	if err != nil {
		return ExtractedPage{}, domainmcp.NewError(domainmcp.ErrorInputInvalid, "提取地址必须是绝对 HTTPS URL", err)
	}
	result, err := a.client.CallTool(ctx, a.snapshot, "extract", map[string]any{"url": parsed.String()})
	if err != nil {
		return ExtractedPage{}, mapAnySearchFailure(err, "")
	}
	text := strings.TrimSpace(toolText(result))
	if result.IsError {
		return ExtractedPage{}, mapAnySearchFailure(errors.New("AnySearch 工具返回失败"), text)
	}
	if text == "" {
		return ExtractedPage{}, domainmcp.NewError(domainmcp.ErrorNoEvidence, "AnySearch 没有返回页面正文", nil)
	}
	return ExtractedPage{URL: parsed.String(), Markdown: truncateRunes(text, maxExtractRunes), RetrievedAt: a.now().UTC()}, nil
}

func normalizeSearchQuery(input SearchQuery) (SearchQuery, map[string]any, error) {
	input.Query = strings.TrimSpace(input.Query)
	if input.Query == "" || utf8.RuneCountInString(input.Query) > maxSearchQueryRunes || hasControl(input.Query) {
		return input, nil, domainmcp.NewError(domainmcp.ErrorInputInvalid, "搜索词需要 1–500 个有效字符", nil)
	}
	if input.Limit == 0 {
		input.Limit = maxSearchHits
	}
	if input.Limit < 1 || input.Limit > maxSearchHits {
		return input, nil, domainmcp.NewError(domainmcp.ErrorInputInvalid, "搜索结果数量需要在 1–10 之间", nil)
	}
	input.Domain = strings.TrimSpace(input.Domain)
	input.SubDomain = strings.TrimSpace(input.SubDomain)
	if input.Domain != "" && !validRoutingKey(input.Domain) {
		return input, nil, domainmcp.NewError(domainmcp.ErrorInputInvalid, "搜索 domain 无效", nil)
	}
	if input.SubDomain != "" && !validRoutingKey(input.SubDomain) {
		return input, nil, domainmcp.NewError(domainmcp.ErrorInputInvalid, "搜索 sub_domain 无效", nil)
	}
	if input.SubDomain != "" && input.Domain == "" {
		return input, nil, domainmcp.NewError(domainmcp.ErrorInputInvalid, "sub_domain 必须与 domain 一起使用", nil)
	}
	if encoded, err := json.Marshal(input.SubDomainParams); err != nil || len(encoded) > 16<<10 {
		return input, nil, domainmcp.NewError(domainmcp.ErrorInputInvalid, "sub_domain_params 无效或过大", err)
	}
	arguments := map[string]any{"query": input.Query, "max_results": input.Limit}
	if input.Domain != "" {
		arguments["domain"] = input.Domain
	}
	if input.SubDomain != "" {
		arguments["sub_domain"] = input.SubDomain
	}
	if len(input.SubDomainParams) > 0 {
		arguments["sub_domain_params"] = input.SubDomainParams
	}
	return input, arguments, nil
}

func anySearchCandidates(result mcpprotocol.ToolCallResult) ([]map[string]any, int) {
	candidates := []map[string]any{}
	malformed := 0
	collectCandidateMaps(result.StructuredContent, &candidates, &malformed, 0)
	for _, content := range result.Content {
		if content.Type != "text" || strings.TrimSpace(content.Text) == "" {
			continue
		}
		var decoded any
		if json.Unmarshal([]byte(content.Text), &decoded) == nil {
			collectCandidateMaps(decoded, &candidates, &malformed, 0)
			continue
		}
		for _, match := range markdownLinkPattern.FindAllStringSubmatch(content.Text, -1) {
			if len(match) == 3 {
				candidates = append(candidates, map[string]any{"title": match[1], "url": match[2]})
			}
		}
	}
	return candidates, malformed
}

func collectCandidateMaps(value any, candidates *[]map[string]any, malformed *int, depth int) {
	if value == nil || depth > 5 || len(*candidates) >= 100 {
		return
	}
	switch typed := value.(type) {
	case map[string]any:
		if stringField(typed, "url", "link", "href") != "" {
			*candidates = append(*candidates, typed)
			return
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			switch strings.ToLower(key) {
			case "results", "items", "data", "organic", "webpages", "hits":
				collectCandidateMaps(typed[key], candidates, malformed, depth+1)
			}
		}
	case []any:
		for _, item := range typed {
			before := len(*candidates)
			collectCandidateMaps(item, candidates, malformed, depth+1)
			if before == len(*candidates) {
				if _, object := item.(map[string]any); object {
					*malformed++
				}
			}
		}
	}
}

func normalizeSearchHit(candidate map[string]any, retrievedAt time.Time) (SearchHit, bool) {
	rawURL := strings.TrimSpace(stringField(candidate, "url", "link", "href"))
	parsed, err := validatePublicHTTPSURL(rawURL)
	if err != nil {
		return SearchHit{}, false
	}
	title := strings.TrimSpace(stringField(candidate, "title", "name"))
	if title == "" {
		title = parsed.Hostname()
	}
	title = truncateRunes(title, maxSearchTitleRunes)
	snippet := truncateRunes(strings.TrimSpace(stringField(candidate, "snippet", "content", "description", "text")), maxSearchSnippetRunes)
	publishedAt := strings.TrimSpace(stringField(candidate, "published_at", "publishedAt", "date"))
	return SearchHit{Title: title, URL: parsed.String(), Snippet: snippet, PublishedAt: publishedAt, RetrievedAt: retrievedAt}, true
}

func toolText(result mcpprotocol.ToolCallResult) string {
	parts := make([]string, 0, len(result.Content))
	for _, content := range result.Content {
		if content.Type == "text" && strings.TrimSpace(content.Text) != "" {
			parts = append(parts, strings.TrimSpace(content.Text))
		}
	}
	return strings.Join(parts, "\n\n")
}

func mapAnySearchFailure(cause error, detail string) error {
	lower := strings.ToLower(cause.Error() + " " + detail)
	switch {
	case strings.Contains(lower, "context deadline"), strings.Contains(lower, "timeout"), strings.Contains(lower, "timed out"):
		return domainmcp.NewError(domainmcp.ErrorUpstreamTimeout, "AnySearch 请求超时", cause)
	case strings.Contains(lower, "unauthorized"), strings.Contains(lower, "forbidden"), strings.Contains(lower, "invalid api key"), strings.Contains(lower, "http 401"), strings.Contains(lower, "http 403"):
		return domainmcp.NewError(domainmcp.ErrorUpstreamAuth, "AnySearch 凭据无效或无权访问", cause)
	case strings.Contains(lower, "rate limit"), strings.Contains(lower, "quota"), strings.Contains(lower, "http 429"), strings.Contains(lower, "42901"):
		return domainmcp.NewError(domainmcp.ErrorUpstreamQuota, "AnySearch 请求频率或额度已达上限", cause)
	default:
		return domainmcp.NewError(domainmcp.ErrorOutputInvalid, "AnySearch 返回无法安全处理", cause)
	}
}

func validatePublicHTTPSURL(raw string) (*url.URL, error) {
	if raw == "" || len(raw) > 4096 {
		return nil, errors.New("URL 为空或过长")
	}
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" {
		return nil, errors.New("URL 必须是无凭据和片段的绝对 HTTPS 地址")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return nil, errors.New("URL 不能指向本机")
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return nil, errors.New("URL 不能指向本机、私网或链路本地地址")
	}
	return parsed, nil
}

func stringField(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

func validRoutingKey(value string) bool {
	if value == "" || len(value) > 120 {
		return false
	}
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func hasControl(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
