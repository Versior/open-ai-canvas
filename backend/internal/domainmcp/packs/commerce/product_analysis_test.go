package commerce

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/domainmcp/providers"
)

type fixtureSearchProvider struct {
	responses [][]providers.SearchHit
	errors    []error
	queries   []providers.SearchQuery
}

func (p *fixtureSearchProvider) Search(_ context.Context, query providers.SearchQuery) ([]providers.SearchHit, error) {
	p.queries = append(p.queries, query)
	index := len(p.queries) - 1
	if index >= len(p.responses) {
		return nil, domainmcp.ErrNoEvidence
	}
	var err error
	if index < len(p.errors) {
		err = p.errors[index]
	}
	return p.responses[index], err
}

func (p *fixtureSearchProvider) Extract(context.Context, string) (providers.ExtractedPage, error) {
	return providers.ExtractedPage{}, errors.New("not used")
}

func TestProductAnalyzeSeparatesProductFactsFromMarketSignals(t *testing.T) {
	now := time.Date(2026, 9, 22, 9, 0, 0, 0, time.UTC)
	search := &fixtureSearchProvider{responses: [][]providers.SearchHit{
		{{Title: "防晒衣选购", URL: "https://example.com/guide", Snippet: "消费者关注轻薄、透气和防晒检测", RetrievedAt: now}},
		{{Title: "户外防晒体验", URL: "https://example.com/review", Snippet: "通勤用户重视不闷热和便携收纳", RetrievedAt: now}},
		{{Title: "防晒服饰趋势", URL: "https://example.com/trend", Snippet: "公开内容强调场景化穿搭和舒适度", RetrievedAt: now}},
	}}
	tool, err := NewProductAnalyze(search)
	if err != nil {
		t.Fatal(err)
	}
	tool.now = func() time.Time { return now }

	result, err := tool.Call(context.Background(), json.RawMessage(`{"productName":"轻薄防晒衣","productFacts":["UPF50+","锦纶面料"],"audienceHint":"城市通勤女性","market":"中国大陆"}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := domainmcp.ValidateResult(result); err != nil {
		t.Fatalf("invalid result: %v", err)
	}
	if len(result.Artifacts) != 2 || result.Artifacts[0].Type != domainmcp.ArtifactCommerceProductReport || result.Artifacts[1].Type != domainmcp.ArtifactRecipe {
		t.Fatalf("artifacts = %#v", result.Artifacts)
	}
	report, ok := result.Artifacts[0].Content.(ProductReport)
	if !ok {
		t.Fatalf("report type = %T", result.Artifacts[0].Content)
	}
	if len(report.ProductFacts) != 2 || report.ProductFacts[0].Source != FactSourceUserSupplied || !report.ProductFacts[0].RequiresVerification {
		t.Fatalf("product facts = %#v", report.ProductFacts)
	}
	if len(report.MarketSignals) != 3 || len(result.Sources) != 3 {
		t.Fatalf("market signals = %#v sources = %#v", report.MarketSignals, result.Sources)
	}
	for _, finding := range result.Findings {
		if finding.External && len(finding.EvidenceIDs) == 0 {
			t.Fatalf("external finding has no evidence: %#v", finding)
		}
	}
	if len(search.queries) != 3 {
		t.Fatalf("queries = %#v", search.queries)
	}
	for _, query := range search.queries {
		if query.Limit != 5 || query.Query == "" {
			t.Fatalf("invalid query = %#v", query)
		}
	}
}

func TestProductAnalyzeDeduplicatesSourcesAndPreservesPartialResults(t *testing.T) {
	now := time.Now().UTC()
	shared := providers.SearchHit{Title: "同一来源", URL: "https://example.com/shared", Snippet: "轻薄透气", RetrievedAt: now}
	search := &fixtureSearchProvider{
		responses: [][]providers.SearchHit{{shared}, {shared}, nil},
		errors:    []error{nil, domainmcp.ErrPartialResult, domainmcp.ErrNoEvidence},
	}
	tool, err := NewProductAnalyze(search)
	if err != nil {
		t.Fatal(err)
	}
	result, err := tool.Call(context.Background(), json.RawMessage(`{"productName":"防晒衣"}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Sources) != 1 || len(result.Warnings) < 2 {
		t.Fatalf("sources = %#v warnings = %#v", result.Sources, result.Warnings)
	}
	report := result.Artifacts[0].Content.(ProductReport)
	if len(report.MarketSignals) != 1 || report.MarketSignals[0].Confidence <= 0.7 {
		t.Fatalf("market signals = %#v", report.MarketSignals)
	}
}

func TestProductAnalyzeRejectsInvalidInputBeforeSearching(t *testing.T) {
	search := &fixtureSearchProvider{}
	tool, err := NewProductAnalyze(search)
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		`{}`,
		`{"productName":""}`,
		`{"productName":"商品","unknown":true}`,
		`{"productName":"商品","productFacts":["事实","事实"]}`,
	} {
		if _, err := tool.Call(context.Background(), json.RawMessage(input)); !errors.Is(err, domainmcp.ErrInputInvalid) {
			t.Fatalf("input %s error = %v", input, err)
		}
	}
	if len(search.queries) != 0 {
		t.Fatalf("invalid input reached provider: %#v", search.queries)
	}
}

func TestProductAnalyzeReturnsNoEvidenceWhenAllQueriesAreEmpty(t *testing.T) {
	search := &fixtureSearchProvider{errors: []error{domainmcp.ErrNoEvidence, domainmcp.ErrNoEvidence, domainmcp.ErrNoEvidence}}
	tool, err := NewProductAnalyze(search)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tool.Call(context.Background(), json.RawMessage(`{"productName":"冷门商品"}`)); !errors.Is(err, domainmcp.ErrNoEvidence) {
		t.Fatalf("error = %v, want ErrNoEvidence", err)
	}
}

func TestProductAnalyzeManifestMatchesBuiltinCatalog(t *testing.T) {
	search := &fixtureSearchProvider{}
	tool, err := NewProductAnalyze(search)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := domainmcp.NewCatalog(domainmcp.BuiltinPacks()...)
	if err != nil {
		t.Fatal(err)
	}
	pack, ok := catalog.Pack(PackIDProductInsight)
	if !ok {
		t.Fatal("product insight pack missing")
	}
	var manifest domainmcp.ToolManifest
	for _, candidate := range pack.Tools {
		if candidate.Name == ToolProductAnalyze {
			manifest = candidate
			break
		}
	}
	if manifest.Name == "" || manifest.Name != tool.Manifest().Name || manifest.Description != tool.Manifest().Description {
		t.Fatalf("catalog manifest = %#v tool manifest = %#v", manifest, tool.Manifest())
	}
	properties, _ := manifest.InputSchema["properties"].(map[string]any)
	if _, ok := properties["productName"]; !ok {
		t.Fatalf("productName schema missing: %#v", manifest.InputSchema)
	}
}

func TestProductSearchQueriesStayWithinProviderBoundary(t *testing.T) {
	queries := productSearchQueries(ProductAnalyzeInput{
		ProductName:  strings.Repeat("商品", 100),
		AudienceHint: strings.Repeat("目标人群", 125),
		Market:       strings.Repeat("市场", 50),
	})
	for _, query := range queries {
		if got := utf8.RuneCountInString(query.Query); got > 500 {
			t.Fatalf("query length = %d, query = %q", got, query.Query)
		}
	}
}
