package domainmcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	serverName                = "open-ai-canvas-domain-mcp"
	defaultServerVersion      = "1"
	maxProtocolRequestBodyLen = 256 << 10
)

// NewStreamableHTTPHandler projects the current immutable Hub snapshot through
// the official MCP Streamable HTTP transport. Stateless mode intentionally
// rebuilds the protocol server per request so configuration swaps are visible
// without sharing browser sessions or stale credentials.
func NewStreamableHTTPHandler(hub func() (*Hub, error), version string) http.Handler {
	version = strings.TrimSpace(version)
	if version == "" {
		version = defaultServerVersion
	}
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		current, err := hub()
		if err != nil || current == nil {
			return nil
		}
		return newProtocolServer(current, version)
	}, &mcp.StreamableHTTPOptions{
		Stateless:                    true,
		JSONResponse:                 true,
		MaxRequestBodyBytes:          maxProtocolRequestBodyLen,
		PropagateRequestCancellation: true,
	})
}

func newProtocolServer(hub *Hub, version string) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:        serverName,
		Title:       "Open AI Canvas Domain MCP",
		Description: "Installed domain capability packs exposed by Open AI Canvas.",
		Version:     version,
	}, nil)
	for _, manifest := range hub.ListTools() {
		manifest := manifest
		server.AddTool(&mcp.Tool{
			Name:        manifest.Name,
			Description: manifest.Description,
			InputSchema: manifest.InputSchema,
		}, func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			result, err := hub.CallTool(ctx, manifest.Name, request.Params.Arguments)
			if err != nil {
				return &mcp.CallToolResult{
					Content: []mcp.Content{&mcp.TextContent{Text: publicToolError(err)}},
					IsError: true,
				}, nil
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				return &mcp.CallToolResult{
					Content: []mcp.Content{&mcp.TextContent{Text: "领域 MCP 结果无法编码"}},
					IsError: true,
				}, nil
			}
			return &mcp.CallToolResult{
				Content:           []mcp.Content{&mcp.TextContent{Text: string(encoded)}},
				StructuredContent: result,
			}, nil
		})
	}
	return server
}

func publicToolError(err error) string {
	var typed *DomainError
	if errors.As(err, &typed) && typed != nil {
		return string(typed.Code) + ": " + typed.Error()
	}
	return "OUTPUT_INVALID: 领域 MCP 工具执行失败"
}
