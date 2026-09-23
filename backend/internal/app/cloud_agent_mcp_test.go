package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	mcpprotocol "infinite-canvas/backend/internal/mcp"
	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentMCPAdmissionFreezesSelectedServersAndAddsTools(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	registry, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "research", Name: "Research", URL: "https://example.com/mcp", AllowedTools: []string{"search"}}})
	if err != nil {
		t.Fatal(err)
	}
	s.mcp = registry
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	req.MCPServerIDs = []string{"research"}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.MCPServers) != 1 || state.MCPServers[0].ID != "research" || state.MCPServers[0].ConfigHash == "" {
		t.Fatalf("MCP snapshots = %#v", state.MCPServers)
	}
	for _, name := range []string{"mcp_list_tools", "mcp_call"} {
		if !canonicalHasTool(state.Canonical, name) {
			t.Fatalf("canonical tools missing %s", name)
		}
	}

	unknown := agentTestRequest()
	unknown.PermissionMode = "request_approval"
	unknown.IdempotencyKey = "unknown-mcp-server"
	unknown.MCPServerIDs = []string{"missing"}
	if _, err := s.CreateCloudAgentRun("user", unknown, ""); err == nil {
		t.Fatal("unknown MCP server accepted")
	}
	duplicate := agentTestRequest()
	duplicate.PermissionMode = "request_approval"
	duplicate.IdempotencyKey = "duplicate-mcp-server"
	duplicate.MCPServerIDs = []string{"research", "research"}
	if _, err := s.CreateCloudAgentRun("user", duplicate, ""); err == nil {
		t.Fatal("duplicate MCP server accepted")
	}
}

func TestCloudAgentMCPToolsUseFrozenConfiguration(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var request struct {
			ID     any            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		w.Header().Set("Content-Type", "application/json")
		switch request.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "fixture", "version": "1"}}})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"tools": []any{map[string]any{"name": "search", "inputSchema": map[string]any{"type": "object"}}}}})
		case "tools/call":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"content": []any{map[string]any{"type": "text", "text": "fresh result"}}}})
		}
	}))
	defer server.Close()
	registry, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "research", Name: "Research", URL: server.URL, AllowedTools: []string{"search"}}})
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{mcp: registry}
	snapshots, _ := registry.Snapshots([]string{"research"})
	state := &cloudAgentRuntime{MCPServers: snapshots}

	listCall := cloudAgentCall{}
	listCall.Function.Name = "mcp_list_tools"
	listCall.Function.Arguments = `{"serverId":"research"}`
	listed, err := s.cloudAgentMCPTool(context.Background(), state, listCall)
	if err != nil {
		t.Fatal(err)
	}
	listedMap, _ := listed.(map[string]any)
	if listedMap["serverId"] != "research" {
		t.Fatalf("list result = %#v", listed)
	}
	toolCall := cloudAgentCall{}
	toolCall.Function.Name = "mcp_call"
	toolCall.Function.Arguments = `{"serverId":"research","toolName":"search","arguments":{"query":"canvas"}}`
	called, err := s.cloudAgentMCPTool(context.Background(), state, toolCall)
	if err != nil {
		t.Fatal(err)
	}
	if called == nil {
		t.Fatal("empty MCP call result")
	}

	changed, _ := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "research", Name: "Research", URL: server.URL, AllowedTools: []string{"search", "fetch"}}})
	s.mcp = changed
	if _, err := s.cloudAgentMCPTool(context.Background(), state, listCall); err == nil {
		t.Fatal("changed MCP configuration accepted by frozen run")
	}
}

func TestValidateCloudAgentMCPSnapshotsMatchesRequest(t *testing.T) {
	valid := []mcpprotocol.ServerSnapshot{{ID: "research", Name: "Research", ConfigHash: strings.Repeat("a", 64)}}
	if err := validateCloudAgentMCPSnapshots([]string{"research"}, valid); err != nil {
		t.Fatal(err)
	}
	for _, snapshots := range [][]mcpprotocol.ServerSnapshot{
		{},
		{{ID: "other", Name: "Research", ConfigHash: strings.Repeat("a", 64)}},
		{{ID: "research", Name: "", ConfigHash: strings.Repeat("a", 64)}},
		{{ID: "research", Name: "Research", ConfigHash: "broken"}},
	} {
		if err := validateCloudAgentMCPSnapshots([]string{"research"}, snapshots); err == nil {
			t.Fatalf("invalid snapshots accepted: %#v", snapshots)
		}
	}
}

func TestCloudAgentMCPCallAcceptsNamespacedToolNames(t *testing.T) {
	registry, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "research", Name: "Research", URL: "https://example.com/mcp", AllowedTools: []string{"web/search:v2"}}})
	if err != nil {
		t.Fatal(err)
	}
	snapshots, _ := registry.Snapshots([]string{"research"})
	s := &Service{mcp: registry}
	call := cloudAgentCall{}
	call.Function.Name = "mcp_call"
	call.Function.Arguments = `{"serverId":"research","toolName":"web/search:v2","arguments":{}}`
	args, _, err := s.cloudAgentMCPCallArgs(&cloudAgentRuntime{MCPServers: snapshots}, call)
	if err != nil || args.ToolName != "web/search:v2" {
		t.Fatalf("namespaced MCP tool rejected: args=%#v err=%v", args, err)
	}
}

func TestCloudAgentMCPToolTreatsProtocolErrorResultAsFailure(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var request struct {
			ID     any    `json:"id"`
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		w.Header().Set("Content-Type", "application/json")
		switch request.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/call":
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"isError": true, "content": []any{map[string]any{"type": "text", "text": "not found"}}}})
		}
	}))
	defer server.Close()
	registry, err := mcpprotocol.New([]mcpprotocol.ServerConfig{{ID: "research", Name: "Research", URL: server.URL, AllowedTools: []string{"search"}}})
	if err != nil {
		t.Fatal(err)
	}
	snapshots, _ := registry.Snapshots([]string{"research"})
	s := &Service{mcp: registry}
	call := cloudAgentCall{}
	call.Function.Name = "mcp_call"
	call.Function.Arguments = `{"serverId":"research","toolName":"search","arguments":{}}`
	result, err := s.cloudAgentMCPTool(context.Background(), &cloudAgentRuntime{MCPServers: snapshots}, call)
	if err == nil || result == nil {
		t.Fatalf("MCP isError should preserve result and return error: result=%#v err=%v", result, err)
	}
}

func canonicalHasTool(request canonicalAgentRequest, name string) bool {
	for _, item := range request.Tools {
		function, _ := item["function"].(map[string]any)
		if function["name"] == name {
			return true
		}
	}
	return false
}
