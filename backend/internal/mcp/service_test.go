package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestServiceListsOnlyAllowlistedToolsAndCallsThem(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var mu sync.Mutex
	methods := []string{}
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
		mu.Lock()
		methods = append(methods, request.Method)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch request.Method {
		case "server/discover":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32601, "message": "method not found"}})
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "session-1")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "fixture", "version": "1"}}})
		case "notifications/initialized":
			if r.Header.Get("MCP-Protocol-Version") != "2025-03-26" {
				t.Errorf("missing protocol version header")
			}
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			if r.Header.Get("Mcp-Session-Id") != "session-1" {
				t.Errorf("missing session header")
			}
			if r.Header.Get("MCP-Protocol-Version") != "2025-03-26" {
				t.Errorf("missing protocol version header")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"tools": []any{
				map[string]any{"name": "search", "description": "Search the web", "inputSchema": map[string]any{"type": "object"}},
				map[string]any{"name": "delete_everything", "description": "blocked", "inputSchema": map[string]any{"type": "object"}},
			}}})
		case "tools/call":
			if request.Params["name"] != "search" {
				t.Errorf("tool name = %#v", request.Params["name"])
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"content": []any{map[string]any{"type": "text", "text": "result"}}, "structuredContent": map[string]any{"ok": true}}})
		default:
			t.Errorf("unexpected method %q", request.Method)
		}
	}))
	defer server.Close()

	service, err := New([]ServerConfig{{ID: "research", Name: "Research", URL: server.URL, AllowedTools: []string{"search"}, TimeoutSeconds: 5}})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	snapshots, err := service.Snapshots([]string{"research"})
	if err != nil || len(snapshots) != 1 || snapshots[0].ConfigHash == "" {
		t.Fatalf("snapshots = %#v, err = %v", snapshots, err)
	}
	tools, err := service.ListTools(context.Background(), snapshots[0])
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "search" {
		t.Fatalf("tools = %#v", tools)
	}
	result, err := service.CallTool(context.Background(), snapshots[0], "search", map[string]any{"query": "canvas"})
	if err != nil {
		t.Fatalf("call tool: %v", err)
	}
	if result.IsError || len(result.Content) != 1 || result.Content[0].Text != "result" {
		t.Fatalf("result = %#v", result)
	}
	if _, err := service.CallTool(context.Background(), snapshots[0], "delete_everything", map[string]any{}); err == nil {
		t.Fatal("non-allowlisted tool should fail")
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(methods, ",") != "server/discover,initialize,notifications/initialized,tools/list,initialize,notifications/initialized,tools/call" {
		t.Fatalf("methods = %v", methods)
	}
}

func TestServiceUsesModernStatelessProtocolAndSkipsSSENotifications(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	methods := []string{}
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
		methods = append(methods, request.Method)
		if r.Header.Get("MCP-Protocol-Version") != modernProtocolVersion || r.Header.Get("Mcp-Method") != request.Method {
			t.Errorf("missing modern routing headers: %#v", r.Header)
		}
		meta, _ := request.Params["_meta"].(map[string]any)
		if meta["io.modelcontextprotocol/protocolVersion"] != modernProtocolVersion {
			t.Errorf("missing modern metadata: %#v", request.Params)
		}
		if r.Header.Get("Mcp-Session-Id") != "" {
			t.Errorf("modern request must not use a session")
		}
		switch request.Method {
		case "server/discover":
			w.Header().Set("Content-Type", "text/event-stream")
			notification, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "notifications/progress", "params": map[string]any{"progress": 1}})
			response, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"resultType": "complete", "protocolVersions": []string{modernProtocolVersion}}})
			_, _ = w.Write([]byte("event: message\ndata: " + string(notification) + "\n\nevent: message\ndata: " + string(response) + "\n\n"))
		case "tools/list":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"resultType": "complete", "tools": []any{map[string]any{"name": "search"}}}})
		case "tools/call":
			if r.Header.Get("Mcp-Name") != "search" {
				t.Errorf("missing tool routing header")
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"resultType": "complete", "content": []any{map[string]any{"type": "text", "text": "modern"}}}})
		default:
			t.Errorf("unexpected method %q", request.Method)
		}
	}))
	defer server.Close()

	service, err := New([]ServerConfig{{ID: "modern", Name: "Modern", URL: server.URL, AllowedTools: []string{"search"}}})
	if err != nil {
		t.Fatal(err)
	}
	snapshots, _ := service.Snapshots([]string{"modern"})
	tools, err := service.ListTools(context.Background(), snapshots[0])
	if err != nil || len(tools) != 1 || tools[0].InputSchema["type"] != "object" {
		t.Fatalf("tools = %#v, err = %v", tools, err)
	}
	result, err := service.CallTool(context.Background(), snapshots[0], "search", map[string]any{"query": "canvas"})
	if err != nil || len(result.Content) != 1 || result.Content[0].Text != "modern" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
	if strings.Join(methods, ",") != "server/discover,tools/list,tools/call" {
		t.Fatalf("methods = %v", methods)
	}
}

func TestServiceDecodesStreamableHTTPSSE(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		method, _ := request["method"].(string)
		if method == "notifications/initialized" {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Mcp-Session-Id", "sse-session")
		if method == "initialize" {
			payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": request["id"], "result": map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "fixture", "version": "1"}}})
			_, _ = w.Write([]byte("event: message\ndata: " + string(payload) + "\n\n"))
			return
		}
		payload, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"id":      request["id"],
			"result": map[string]any{
				"tools": []any{map[string]any{"name": "search", "inputSchema": map[string]any{"type": "object"}}},
			},
		})
		_, _ = w.Write([]byte("event: message\ndata: " + string(payload) + "\n\n"))
	}))
	defer server.Close()

	service, err := New([]ServerConfig{{ID: "sse", Name: "SSE", URL: server.URL, AllowedTools: []string{"search"}, TimeoutSeconds: 5}})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, _ := service.Snapshots([]string{"sse"})
	tools, err := service.ListTools(context.Background(), snapshot[0])
	if err != nil || len(tools) != 1 || tools[0].Name != "search" {
		t.Fatalf("tools = %#v, err = %v", tools, err)
	}
}

func TestServiceRejectsUnsafeOrAmbiguousConfiguration(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	tests := []struct {
		name    string
		configs []ServerConfig
	}{
		{name: "private", configs: []ServerConfig{{ID: "private", Name: "Private", URL: "http://127.0.0.1:9000/mcp", AllowedTools: []string{"search"}}}},
		{name: "duplicate id", configs: []ServerConfig{{ID: "dup", Name: "One", URL: "https://one.example/mcp", AllowedTools: []string{"search"}}, {ID: "dup", Name: "Two", URL: "https://two.example/mcp", AllowedTools: []string{"search"}}}},
		{name: "empty allowlist", configs: []ServerConfig{{ID: "open", Name: "Open", URL: "https://example.com/mcp"}}},
		{name: "unsafe header", configs: []ServerConfig{{ID: "header", Name: "Header", URL: "https://example.com/mcp", Headers: map[string]string{"Host": "evil"}, AllowedTools: []string{"search"}}}},
		{name: "protocol header override", configs: []ServerConfig{{ID: "routing", Name: "Routing", URL: "https://example.com/mcp", Headers: map[string]string{"Mcp-Method": "other"}, AllowedTools: []string{"search"}}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.configs); err == nil {
				t.Fatal("expected configuration error")
			}
		})
	}
}

func TestSnapshotsDetectConfigurationChangesAndEnvironmentDoesNotExposeSecrets(t *testing.T) {
	config := ServerConfig{ID: "research", Name: "Research", URL: "https://example.com/mcp", Headers: map[string]string{"Authorization": "Bearer secret"}, AllowedTools: []string{"search"}, TimeoutSeconds: 3}
	service, err := New([]ServerConfig{config})
	if err != nil {
		t.Fatal(err)
	}
	public := service.Servers()
	encoded, _ := json.Marshal(public)
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "Authorization") {
		t.Fatalf("public servers leaked secret: %s", encoded)
	}
	snapshots, _ := service.Snapshots([]string{"research"})
	changed := config
	changed.AllowedTools = []string{"search", "fetch"}
	reconfigured, err := New([]ServerConfig{changed})
	if err != nil {
		t.Fatal(err)
	}
	if err := reconfigured.ValidateSnapshot(snapshots[0]); err == nil {
		t.Fatal("changed configuration should invalidate snapshot")
	}

	t.Setenv(ServersEnv, `[{"id":"env","name":"Env","url":"https://example.com/mcp","headers":{"Authorization":"Bearer env-secret"},"allowedTools":["search"],"timeoutSeconds":2}]`)
	fromEnv, err := NewFromEnvironment()
	if err != nil || len(fromEnv.Servers()) != 1 || fromEnv.Servers()[0].ID != "env" {
		t.Fatalf("environment service = %#v, err = %v", fromEnv, err)
	}
}

func TestServiceBoundsTimeoutAndResponseSize(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Run("timeout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(150 * time.Millisecond)
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{}}`))
		}))
		defer server.Close()
		service, err := New([]ServerConfig{{ID: "slow", Name: "Slow", URL: server.URL, AllowedTools: []string{"search"}, TimeoutMilliseconds: 30}})
		if err != nil {
			t.Fatal(err)
		}
		snapshots, _ := service.Snapshots([]string{"slow"})
		if _, err := service.ListTools(context.Background(), snapshots[0]); err == nil {
			t.Fatal("expected timeout")
		}
	})

	t.Run("response size", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"payload":"` + strings.Repeat("x", maxResponseBytes) + `"}}`))
		}))
		defer server.Close()
		service, err := New([]ServerConfig{{ID: "large", Name: "Large", URL: server.URL, AllowedTools: []string{"search"}}})
		if err != nil {
			t.Fatal(err)
		}
		snapshots, _ := service.Snapshots([]string{"large"})
		if _, err := service.ListTools(context.Background(), snapshots[0]); err == nil {
			t.Fatal("expected response size error")
		}
	})
}

func TestServiceAllowsBoundedLargeToolResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	largeText := strings.Repeat("x", 500<<10)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var request struct {
			ID     any    `json:"id"`
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		w.Header().Set("Content-Type", "application/json")
		switch request.Method {
		case "server/discover":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32601, "message": "method not found"}})
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"content": []any{map[string]any{"type": "text", "text": largeText}}}})
		default:
			t.Errorf("unexpected method %q", request.Method)
		}
	}))
	defer server.Close()
	service, err := New([]ServerConfig{{ID: "large-ok", Name: "Large OK", URL: server.URL, AllowedTools: []string{"extract"}}})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, _ := service.Snapshots([]string{"large-ok"})
	result, err := service.CallTool(context.Background(), snapshot[0], "extract", map[string]any{"url": "https://example.com"})
	if err != nil {
		t.Fatalf("bounded large result failed: %v", err)
	}
	if len(result.Content) != 1 || len(result.Content[0].Text) != len(largeText) {
		t.Fatalf("large result length = %d", len(result.Content[0].Text))
	}
}

func TestServiceRejectsMismatchedResponseIDAndUnsafeToolNames(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var request struct {
			ID     any    `json:"id"`
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		w.Header().Set("Content-Type", "application/json")
		if request.Method == "initialize" {
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 999, "result": map[string]any{"protocolVersion": "2025-03-26"}})
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	service, err := New([]ServerConfig{{ID: "mismatch", Name: "Mismatch", URL: server.URL, AllowedTools: []string{"search"}}})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, _ := service.Snapshots([]string{"mismatch"})
	if _, err := service.ListTools(context.Background(), snapshot[0]); err == nil || !strings.Contains(err.Error(), "id") {
		t.Fatalf("mismatched response id accepted: %v", err)
	}
	for _, name := range []string{"search /unsafe", "search?unsafe", "/", ""} {
		if _, err := New([]ServerConfig{{ID: "invalid", Name: "Invalid", URL: "https://example.com/mcp", AllowedTools: []string{name}}}); err == nil {
			t.Fatalf("unsafe tool name accepted: %q", name)
		}
	}
}
