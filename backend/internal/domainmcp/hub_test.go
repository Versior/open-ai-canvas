package domainmcp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type fixtureToolHandler struct {
	manifest ToolManifest
	result   Result
	err      error
	calls    int
	input    json.RawMessage
}

func (h *fixtureToolHandler) Manifest() ToolManifest { return h.manifest }

func (h *fixtureToolHandler) Call(_ context.Context, input json.RawMessage) (Result, error) {
	h.calls++
	h.input = append(json.RawMessage(nil), input...)
	return h.result, h.err
}

func TestHubExposesOnlyEnabledAllowlistedTools(t *testing.T) {
	catalog, err := NewCatalog(PackManifest{
		ID:          "commerce.product-insight",
		DisplayName: "Product Insight",
		Version:     "1.0.0",
		Tools: []ToolManifest{
			{Name: "commerce.product_analyze", Description: "Analyze", Permission: PermissionReadOnly},
			{Name: "commerce.competitor_compare", Description: "Compare", Permission: PermissionReadOnly},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	analyze := &fixtureToolHandler{manifest: mustCatalogTool(t, catalog, "commerce.product-insight", "commerce.product_analyze"), result: Result{Summary: "ok"}}
	compare := &fixtureToolHandler{manifest: mustCatalogTool(t, catalog, "commerce.product-insight", "commerce.competitor_compare"), result: Result{Summary: "ok"}}
	hub, err := NewHub(catalog, []Installation{{PackID: "commerce.product-insight", Enabled: true, AllowedTools: []string{"commerce.product_analyze"}}}, analyze, compare)
	if err != nil {
		t.Fatal(err)
	}

	tools := hub.ListTools()
	if len(tools) != 1 || tools[0].Name != "commerce.product_analyze" {
		t.Fatalf("tools = %#v", tools)
	}
	if _, err := hub.CallTool(context.Background(), "commerce.competitor_compare", json.RawMessage(`{}`)); !errors.Is(err, ErrPolicyBlocked) {
		t.Fatalf("blocked call error = %v", err)
	}
	if compare.calls != 0 {
		t.Fatalf("blocked handler calls = %d", compare.calls)
	}
	if _, err := hub.CallTool(context.Background(), "commerce.product_analyze", json.RawMessage(`{"productName":"防晒衣"}`)); err != nil {
		t.Fatal(err)
	}
	if analyze.calls != 1 || string(analyze.input) != `{"productName":"防晒衣"}` {
		t.Fatalf("handler calls = %d input = %s", analyze.calls, analyze.input)
	}
}

func TestHubRejectsInvalidInstallationsAndDuplicateHandlers(t *testing.T) {
	catalog, err := NewCatalog(PackManifest{
		ID:          "pack.one",
		DisplayName: "Pack One",
		Version:     "1.0.0",
		Tools:       []ToolManifest{{Name: "pack.tool", Description: "Tool", Permission: PermissionReadOnly}},
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := &fixtureToolHandler{manifest: mustCatalogTool(t, catalog, "pack.one", "pack.tool"), result: Result{Summary: "ok"}}
	tests := []struct {
		name          string
		installations []Installation
		handlers      []ToolHandler
	}{
		{name: "unknown pack", installations: []Installation{{PackID: "missing", Enabled: true, AllowedTools: []string{"pack.tool"}}}, handlers: []ToolHandler{handler}},
		{name: "empty allowlist", installations: []Installation{{PackID: "pack.one", Enabled: true}}, handlers: []ToolHandler{handler}},
		{name: "unknown tool", installations: []Installation{{PackID: "pack.one", Enabled: true, AllowedTools: []string{"other.tool"}}}, handlers: []ToolHandler{handler}},
		{name: "missing handler", installations: []Installation{{PackID: "pack.one", Enabled: true, AllowedTools: []string{"pack.tool"}}}},
		{name: "duplicate handler", installations: []Installation{{PackID: "pack.one", Enabled: true, AllowedTools: []string{"pack.tool"}}}, handlers: []ToolHandler{handler, handler}},
		{name: "duplicate installation", installations: []Installation{{PackID: "pack.one", Enabled: false}, {PackID: "pack.one", Enabled: false}}, handlers: []ToolHandler{handler}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewHub(catalog, test.installations, test.handlers...); err == nil {
				t.Fatal("invalid Hub configuration accepted")
			}
		})
	}
}

func TestHubValidatesInputAndHandlerOutput(t *testing.T) {
	catalog, err := NewCatalog(PackManifest{ID: "pack.one", DisplayName: "Pack One", Version: "1.0.0", Tools: []ToolManifest{{Name: "pack.tool", Description: "Tool", Permission: PermissionReadOnly}}})
	if err != nil {
		t.Fatal(err)
	}
	handler := &fixtureToolHandler{manifest: mustCatalogTool(t, catalog, "pack.one", "pack.tool"), result: Result{Summary: "ok"}}
	hub, err := NewHub(catalog, []Installation{{PackID: "pack.one", Enabled: true, AllowedTools: []string{"pack.tool"}}}, handler)
	if err != nil {
		t.Fatal(err)
	}

	for _, input := range []json.RawMessage{nil, json.RawMessage(`[]`), json.RawMessage(`{} {}`), json.RawMessage(`{"query":"` + strings.Repeat("x", (64<<10)+1) + `"}`)} {
		if _, err := hub.CallTool(context.Background(), "pack.tool", input); !errors.Is(err, ErrInputInvalid) {
			t.Fatalf("input %q error = %v, want ErrInputInvalid", truncateFixture(input), err)
		}
	}
	if handler.calls != 0 {
		t.Fatalf("invalid input reached handler %d times", handler.calls)
	}

	handler.result = Result{Summary: "bad", Artifacts: []Artifact{{Type: "canvas.executable", Title: "unsafe", Content: map[string]any{"command": "run"}}}}
	if _, err := hub.CallTool(context.Background(), "pack.tool", json.RawMessage(`{}`)); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("invalid output error = %v", err)
	}
}

func TestHubListToolsReturnsDefensiveCopies(t *testing.T) {
	catalog, err := NewCatalog(PackManifest{
		ID:          "pack.one",
		DisplayName: "Pack One",
		Version:     "1.0.0",
		Tools: []ToolManifest{{
			Name:        "pack.tool",
			Description: "Tool",
			Permission:  PermissionReadOnly,
			InputSchema: map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := &fixtureToolHandler{manifest: mustCatalogTool(t, catalog, "pack.one", "pack.tool"), result: Result{Summary: "ok"}}
	hub, err := NewHub(catalog, []Installation{{PackID: "pack.one", Enabled: true, AllowedTools: []string{"pack.tool"}}}, handler)
	if err != nil {
		t.Fatal(err)
	}
	first := hub.ListTools()
	first[0].InputSchema["properties"].(map[string]any)["query"].(map[string]any)["type"] = "number"
	second := hub.ListTools()
	if got := second[0].InputSchema["properties"].(map[string]any)["query"].(map[string]any)["type"]; got != "string" {
		t.Fatalf("Hub tool schema mutated: %v", got)
	}
}

func mustCatalogTool(t *testing.T, catalog *Catalog, packID, name string) ToolManifest {
	t.Helper()
	pack, ok := catalog.Pack(packID)
	if !ok {
		t.Fatalf("missing pack %s", packID)
	}
	for _, tool := range pack.Tools {
		if tool.Name == name {
			return tool
		}
	}
	t.Fatalf("missing tool %s", name)
	return ToolManifest{}
}

func truncateFixture(value []byte) string {
	if len(value) <= 80 {
		return string(value)
	}
	return string(value[:80])
}
