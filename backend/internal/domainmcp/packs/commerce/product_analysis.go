package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/domainmcp/providers"
)

const FactSourceUserSupplied = "user_supplied"

type ProductAnalyzeInput struct {
	ProductName  string   `json:"productName"`
	ProductFacts []string `json:"productFacts"`
	AudienceHint string   `json:"audienceHint"`
	Market       string   `json:"market"`
	Language     string   `json:"language"`
}

type ProductFact struct {
	Claim                string `json:"claim"`
	Source               string `json:"source"`
	RequiresVerification bool   `json:"requiresVerification"`
}

type MarketSignal struct {
	Title       string   `json:"title"`
	Detail      string   `json:"detail"`
	Confidence  float64  `json:"confidence"`
	EvidenceIDs []string `json:"evidenceIds"`
}

type SellingPointDirection struct {
	Category    string   `json:"category"`
	Direction   string   `json:"direction"`
	EvidenceIDs []string `json:"evidenceIds,omitempty"`
	Status      string   `json:"status"`
}

type ProductReport struct {
	ProductName        string                  `json:"productName"`
	AudienceHint       string                  `json:"audienceHint,omitempty"`
	Market             string                  `json:"market"`
	Language           string                  `json:"language"`
	ProductFacts       []ProductFact           `json:"productFacts"`
	MarketSignals      []MarketSignal          `json:"marketSignals"`
	SellingPointMatrix []SellingPointDirection `json:"sellingPointMatrix"`
	RiskNotes          []string                `json:"riskNotes"`
}

type ProductCanvasRecipe struct {
	Layout string              `json:"layout"`
	Nodes  []ProductRecipeNode `json:"nodes"`
}

type ProductRecipeNode struct {
	Key     string `json:"key"`
	Type    string `json:"type"`
	Title   string `json:"title"`
	Content any    `json:"content"`
	Column  int    `json:"column"`
	Row     int    `json:"row"`
}

type ProductAnalyze struct {
	provider providers.SearchProvider
	now      func() time.Time
}

func NewProductAnalyze(provider providers.SearchProvider) (*ProductAnalyze, error) {
	if provider == nil {
		return nil, errors.New("商品洞察 SearchProvider 不能为空")
	}
	return &ProductAnalyze{provider: provider, now: time.Now}, nil
}

func (p *ProductAnalyze) Manifest() domainmcp.ToolManifest {
	return productAnalyzeToolManifest()
}

func (p *ProductAnalyze) Call(ctx context.Context, raw json.RawMessage) (domainmcp.Result, error) {
	input, err := decodeProductAnalyzeInput(raw)
	if err != nil {
		return domainmcp.Result{}, err
	}
	queries := productSearchQueries(input)
	warnings := []string{"市场结论来自可追溯的公网检索信号，不等同于平台官方热榜或商品自身事实。"}
	hits := make([]providers.SearchHit, 0, len(queries)*5)
	for _, query := range queries {
		queryHits, searchErr := p.provider.Search(ctx, query)
		switch {
		case searchErr == nil:
			hits = append(hits, queryHits...)
		case errors.Is(searchErr, domainmcp.ErrPartialResult):
			hits = append(hits, queryHits...)
			warnings = append(warnings, "一次公网检索只返回了部分通过来源校验的结果。")
		case errors.Is(searchErr, domainmcp.ErrNoEvidence):
			warnings = append(warnings, "一次公网检索没有找到可用证据，报告未对该方向补造结论。")
		case errors.Is(searchErr, domainmcp.ErrUpstreamQuota), errors.Is(searchErr, domainmcp.ErrUpstreamTimeout):
			if len(hits) == 0 {
				return domainmcp.Result{}, searchErr
			}
			warnings = append(warnings, "一次公网检索因额度或超时未完成，报告仅使用已取得的证据。")
		case errors.Is(searchErr, domainmcp.ErrUpstreamAuth):
			return domainmcp.Result{}, searchErr
		default:
			return domainmcp.Result{}, searchErr
		}
	}
	if len(hits) == 0 {
		return domainmcp.Result{}, domainmcp.NewError(domainmcp.ErrorNoEvidence, "没有找到可用于商品洞察的公网证据", nil)
	}

	sources, signals := aggregateMarketSignals(hits, p.now().UTC())
	facts := make([]ProductFact, 0, len(input.ProductFacts))
	for _, fact := range input.ProductFacts {
		facts = append(facts, ProductFact{Claim: fact, Source: FactSourceUserSupplied, RequiresVerification: true})
	}
	report := ProductReport{
		ProductName:        input.ProductName,
		AudienceHint:       input.AudienceHint,
		Market:             input.Market,
		Language:           input.Language,
		ProductFacts:       facts,
		MarketSignals:      signals,
		SellingPointMatrix: productSellingPointMatrix(facts, signals),
		RiskNotes: []string{
			"用户提供的商品事实仍需以检测报告、包装或商品资料核验。",
			"公网市场表达只能作为创意方向，不能替代商品功效证据。",
		},
	}
	findings := make([]domainmcp.Finding, 0, len(signals))
	for _, signal := range signals {
		findings = append(findings, domainmcp.Finding{Title: signal.Title, Detail: signal.Detail, Confidence: signal.Confidence, EvidenceIDs: append([]string(nil), signal.EvidenceIDs...), External: true})
	}
	result := domainmcp.Result{
		Summary:   fmt.Sprintf("已基于 %d 个可追溯公网来源整理“%s”的商品事实边界、市场信号与卖点方向。", len(sources), input.ProductName),
		Findings:  findings,
		Artifacts: []domainmcp.Artifact{{Type: domainmcp.ArtifactCommerceProductReport, Title: input.ProductName + " 商品洞察报告", Content: report}, {Type: domainmcp.ArtifactRecipe, Title: input.ProductName + " 画布布局", Content: productCanvasRecipe(report)}},
		Sources:   sources,
		Warnings:  uniqueStrings(warnings),
		NextActions: []string{
			"核对所有用户提供的商品事实与可出示证据。",
			"选择一个卖点方向生成主图或详情页方案。",
		},
	}
	if err := domainmcp.ValidateResult(result); err != nil {
		return domainmcp.Result{}, err
	}
	return result, nil
}

func decodeProductAnalyzeInput(raw json.RawMessage) (ProductAnalyzeInput, error) {
	var input ProductAnalyzeInput
	if len(raw) == 0 || len(raw) > 64<<10 {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "商品分析参数为空或过大", nil)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "商品分析参数不是有效对象", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "商品分析参数只能包含一个对象", nil)
	}
	input.ProductName = strings.TrimSpace(input.ProductName)
	input.AudienceHint = strings.TrimSpace(input.AudienceHint)
	input.Market = strings.TrimSpace(input.Market)
	input.Language = strings.TrimSpace(input.Language)
	if err := validateInputText(input.ProductName, 200, false); err != nil {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "productName 需要 1–200 个有效字符", err)
	}
	if err := validateInputText(input.AudienceHint, 500, true); err != nil {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "audienceHint 无效", err)
	}
	if input.Market == "" {
		input.Market = "中国大陆"
	}
	if input.Language == "" {
		input.Language = "zh-CN"
	}
	if err := validateInputText(input.Market, 100, false); err != nil {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "market 无效", err)
	}
	if err := validateInputText(input.Language, 32, false); err != nil {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "language 无效", err)
	}
	if len(input.ProductFacts) > 20 {
		return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "productFacts 最多 20 条", nil)
	}
	seen := make(map[string]struct{}, len(input.ProductFacts))
	for index, fact := range input.ProductFacts {
		fact = strings.TrimSpace(fact)
		if err := validateInputText(fact, 500, false); err != nil {
			return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "productFacts 包含无效事实", err)
		}
		if _, duplicate := seen[fact]; duplicate {
			return input, domainmcp.NewError(domainmcp.ErrorInputInvalid, "productFacts 不能重复", nil)
		}
		seen[fact] = struct{}{}
		input.ProductFacts[index] = fact
	}
	return input, nil
}

func productSearchQueries(input ProductAnalyzeInput) []providers.SearchQuery {
	audience := input.AudienceHint
	if audience == "" {
		audience = "目标用户"
	}
	return []providers.SearchQuery{
		{Query: boundedSearchQuery(input.ProductName, audience, input.Market, "购买动机 痛点 关注点"), Limit: 5},
		{Query: boundedSearchQuery(input.ProductName, input.Market, "竞品 卖点 用户评价"), Limit: 5},
		{Query: boundedSearchQuery(input.ProductName, input.Market, "使用场景 材质 舒适度 趋势"), Limit: 5},
	}
}

func boundedSearchQuery(parts ...string) string {
	value := strings.Join(parts, " ")
	if utf8.RuneCountInString(value) <= 500 {
		return value
	}
	return string([]rune(value)[:500])
}

func aggregateMarketSignals(hits []providers.SearchHit, fallbackTime time.Time) ([]domainmcp.Evidence, []MarketSignal) {
	type aggregate struct {
		hit   providers.SearchHit
		count int
	}
	byURL := make(map[string]*aggregate, len(hits))
	order := make([]string, 0, len(hits))
	for _, hit := range hits {
		if existing := byURL[hit.URL]; existing != nil {
			existing.count++
			continue
		}
		copy := hit
		byURL[hit.URL] = &aggregate{hit: copy, count: 1}
		order = append(order, hit.URL)
	}
	sources := make([]domainmcp.Evidence, 0, len(order))
	signals := make([]MarketSignal, 0, len(order))
	for index, sourceURL := range order {
		item := byURL[sourceURL]
		retrievedAt := item.hit.RetrievedAt
		if retrievedAt.IsZero() {
			retrievedAt = fallbackTime
		}
		evidenceID := fmt.Sprintf("source-%d", index+1)
		sources = append(sources, domainmcp.Evidence{ID: evidenceID, Title: item.hit.Title, URL: item.hit.URL, Snippet: item.hit.Snippet, Provider: "anysearch", RetrievedAt: retrievedAt.UTC()})
		confidence := 0.64 + float64(item.count-1)*0.1
		if confidence > 0.9 {
			confidence = 0.9
		}
		detail := item.hit.Snippet
		if detail == "" {
			detail = "该公开来源与当前商品研究主题相关，需打开原文进一步核对。"
		}
		signals = append(signals, MarketSignal{Title: item.hit.Title, Detail: detail, Confidence: confidence, EvidenceIDs: []string{evidenceID}})
	}
	return sources, signals
}

func productSellingPointMatrix(facts []ProductFact, signals []MarketSignal) []SellingPointDirection {
	result := make([]SellingPointDirection, 0, len(facts)+len(signals))
	for _, fact := range facts {
		result = append(result, SellingPointDirection{Category: "商品事实", Direction: fact.Claim, Status: "requires_verification"})
	}
	for _, signal := range signals {
		result = append(result, SellingPointDirection{Category: "市场表达", Direction: signal.Title + "：" + signal.Detail, EvidenceIDs: append([]string(nil), signal.EvidenceIDs...), Status: "public_search_signal"})
	}
	return result
}

func productCanvasRecipe(report ProductReport) ProductCanvasRecipe {
	return ProductCanvasRecipe{
		Layout: "three-column-report",
		Nodes: []ProductRecipeNode{
			{Key: "overview", Type: domainmcp.ArtifactText, Title: report.ProductName + " 商品概览", Content: map[string]any{"audienceHint": report.AudienceHint, "market": report.Market}, Column: 0, Row: 0},
			{Key: "facts", Type: domainmcp.ArtifactTable, Title: "已知商品事实", Content: report.ProductFacts, Column: 0, Row: 1},
			{Key: "signals", Type: domainmcp.ArtifactTable, Title: "公网市场信号", Content: report.MarketSignals, Column: 1, Row: 0},
			{Key: "selling-points", Type: domainmcp.ArtifactTable, Title: "卖点方向矩阵", Content: report.SellingPointMatrix, Column: 2, Row: 0},
			{Key: "risks", Type: domainmcp.ArtifactText, Title: "核验与风险", Content: report.RiskNotes, Column: 2, Row: 1},
		},
	}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func validateInputText(value string, maxRunes int, allowEmpty bool) error {
	if !allowEmpty && value == "" {
		return errors.New("value is empty")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return errors.New("value is too long")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New("value contains control characters")
		}
	}
	return nil
}
