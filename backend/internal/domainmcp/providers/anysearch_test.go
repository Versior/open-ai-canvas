package providers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/domainmcp"
	mcpprotocol "infinite-canvas/backend/internal/mcp"
)

func TestAnySearchNormalizesStructuredResults(t *testing.T) {
	provider, requests := newAnySearchFixture(t, func(id any, method string, params map[string]any) map[string]any {
		if method != "tools/call" {
			return nil
		}
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]any{
				"structuredContent": map[string]any{
					"results": []any{map[string]any{
						"title":   "防晒衣选购指南",
						"url":     "https://example.com/sun-shirt",
						"snippet": "轻薄和透气是高频关注点",
					}},
				},
			},
		}
	})

	hits, err := provider.Search(context.Background(), SearchQuery{Query: "2026 夏季防晒衣", Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 || hits[0].URL != "https://example.com/sun-shirt" || hits[0].Title != "防晒衣选购指南" || hits[0].Snippet != "轻薄和透气是高频关注点" {
		t.Fatalf("hits = %#v", hits)
	}
	if len(*requests) != 1 || (*requests)[0]["name"] != "search" {
		t.Fatalf("tool requests = %#v", *requests)
	}
	arguments, _ := (*requests)[0]["arguments"].(map[string]any)
	if arguments["query"] != "2026 夏季防晒衣" || arguments["max_results"] != float64(5) && arguments["max_results"] != 5 {
		t.Fatalf("search arguments = %#v", arguments)
	}
}

func TestAnySearchParsesTextJSONAndReportsPartialResults(t *testing.T) {
	provider, _ := newAnySearchFixture(t, func(id any, method string, _ map[string]any) map[string]any {
		if method != "tools/call" {
			return nil
		}
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]any{
				"content": []any{map[string]any{
					"type": "text",
					"text": `{"results":[{"title":"有效来源","url":"https://example.com/valid","content":"有效摘要"},{"title":"不安全来源","url":"http://example.com/insecure"}]}`,
				}},
			},
		}
	})

	hits, err := provider.Search(context.Background(), SearchQuery{Query: "商品趋势"})
	if !errors.Is(err, domainmcp.ErrPartialResult) {
		t.Fatalf("Search() error = %v, want ErrPartialResult", err)
	}
	if len(hits) != 1 || hits[0].Title != "有效来源" || hits[0].Snippet != "有效摘要" {
		t.Fatalf("hits = %#v", hits)
	}
}

func TestAnySearchExtractsBoundedMarkdown(t *testing.T) {
	provider, _ := newAnySearchFixture(t, func(id any, method string, params map[string]any) map[string]any {
		if method != "tools/call" {
			return nil
		}
		if params["name"] != "extract" {
			t.Fatalf("tool name = %#v", params["name"])
		}
		return map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"result": map[string]any{
				"content": []any{map[string]any{"type": "text", "text": "# 页面标题\n\n正文内容"}},
			},
		}
	})

	page, err := provider.Extract(context.Background(), "https://example.com/article")
	if err != nil {
		t.Fatal(err)
	}
	if page.URL != "https://example.com/article" || page.Markdown != "# 页面标题\n\n正文内容" || page.RetrievedAt.IsZero() {
		t.Fatalf("page = %#v", page)
	}
}

func TestAnySearchMapsAuthQuotaAndTimeoutFailures(t *testing.T) {
	tests := []struct {
		name    string
		message string
		want    error
	}{
		{name: "auth", message: "unauthorized api key", want: domainmcp.ErrUpstreamAuth},
		{name: "quota", message: "rate limit quota exceeded", want: domainmcp.ErrUpstreamQuota},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider, _ := newAnySearchFixture(t, func(id any, method string, _ map[string]any) map[string]any {
				if method != "tools/call" {
					return nil
				}
				return map[string]any{
					"jsonrpc": "2.0",
					"id":      id,
					"result": map[string]any{
						"isError": true,
						"content": []any{map[string]any{"type": "text", "text": test.message}},
					},
				}
			})
			if _, err := provider.Search(context.Background(), SearchQuery{Query: "query"}); !errors.Is(err, test.want) {
				t.Fatalf("Search() error = %v, want %v", err, test.want)
			}
		})
	}

	t.Run("timeout", func(t *testing.T) {
		t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(100 * time.Millisecond)
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{}}`))
		}))
		defer server.Close()
		client, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "anysearch", Name: "AnySearch", URL: server.URL, AllowedTools: []string{"search", "extract"}, TimeoutMilliseconds: 20}})
		if err != nil {
			t.Fatal(err)
		}
		snapshots, _ := client.Snapshots([]string{"anysearch"})
		provider, err := NewAnySearch(client, snapshots[0])
		if err != nil {
			t.Fatal(err)
		}
		if _, err := provider.Search(context.Background(), SearchQuery{Query: "query"}); !errors.Is(err, domainmcp.ErrUpstreamTimeout) {
			t.Fatalf("Search() error = %v, want timeout", err)
		}
	})
}

func TestAnySearchRejectsInvalidQueriesAndEmptyResults(t *testing.T) {
	provider, _ := newAnySearchFixture(t, func(id any, method string, _ map[string]any) map[string]any {
		if method != "tools/call" {
			return nil
		}
		return map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{"content": []any{map[string]any{"type": "text", "text": `{"results":[]}`}}}}
	})
	for _, query := range []SearchQuery{{}, {Query: strings.Repeat("x", 501)}, {Query: "query", Limit: 11}} {
		if _, err := provider.Search(context.Background(), query); !errors.Is(err, domainmcp.ErrInputInvalid) {
			t.Fatalf("query %#v error = %v", query, err)
		}
	}
	if _, err := provider.Search(context.Background(), SearchQuery{Query: "query", Limit: 3}); !errors.Is(err, domainmcp.ErrNoEvidence) {
		t.Fatalf("empty result error = %v", err)
	}
	for _, rawURL := range []string{"http://example.com", "https://127.0.0.1/private", "https://localhost/private"} {
		if _, err := provider.Extract(context.Background(), rawURL); !errors.Is(err, domainmcp.ErrInputInvalid) {
			t.Fatalf("insecure extract URL %q error = %v", rawURL, err)
		}
	}
}

func newAnySearchFixture(t *testing.T, response func(id any, method string, params map[string]any) map[string]any) (*AnySearch, *[]map[string]any) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := []map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var request struct {
			ID     any            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch request.Method {
		case "server/discover":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32601, "message": "method not found"}})
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			requests = append(requests, request.Params)
			payload := response(request.ID, request.Method, request.Params)
			if payload == nil {
				t.Errorf("fixture returned nil payload")
				return
			}
			_ = json.NewEncoder(w).Encode(payload)
		default:
			t.Errorf("unexpected method %q", request.Method)
		}
	}))
	t.Cleanup(server.Close)
	client, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "anysearch", Name: "AnySearch", URL: server.URL, AllowedTools: []string{"search", "extract"}}})
	if err != nil {
		t.Fatal(err)
	}
	snapshots, err := client.Snapshots([]string{"anysearch"})
	if err != nil {
		t.Fatal(err)
	}
	provider, err := NewAnySearch(client, snapshots[0])
	if err != nil {
		t.Fatal(err)
	}
	return provider, &requests
}
