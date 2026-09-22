package mcp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"infinite-canvas/backend/internal/outbound"
)

const (
	ServersEnv             = "CANVAS_AGENT_MCP_SERVERS_JSON"
	modernProtocolVersion  = "2026-07-28"
	legacyProtocolVersion  = "2025-11-25"
	defaultTimeout         = 20 * time.Second
	maxTimeout             = 60 * time.Second
	maxServers             = 16
	maxToolsPerServer      = 128
	maxRequestBytes        = 64 << 10
	maxResponseBytes       = 512 << 10
	maxEnvironmentJSONSize = 128 << 10
)

type ServerConfig struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Description         string            `json:"description,omitempty"`
	URL                 string            `json:"url"`
	Headers             map[string]string `json:"headers,omitempty"`
	AllowedTools        []string          `json:"allowedTools"`
	TimeoutSeconds      int               `json:"timeoutSeconds,omitempty"`
	TimeoutMilliseconds int               `json:"-"`
}

type PublicServer struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description,omitempty"`
	AllowedTools []string `json:"allowedTools"`
}

type ServerSnapshot struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ConfigHash string `json:"configHash"`
}

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema"`
}

type ToolContent struct {
	Type        string         `json:"type"`
	Text        string         `json:"text,omitempty"`
	Data        string         `json:"data,omitempty"`
	MIMEType    string         `json:"mimeType,omitempty"`
	URI         string         `json:"uri,omitempty"`
	Name        string         `json:"name,omitempty"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description,omitempty"`
	Size        int64          `json:"size,omitempty"`
	Resource    map[string]any `json:"resource,omitempty"`
	Annotations map[string]any `json:"annotations,omitempty"`
	Meta        map[string]any `json:"_meta,omitempty"`
}

type ToolCallResult struct {
	Content           []ToolContent `json:"content"`
	StructuredContent any           `json:"structuredContent,omitempty"`
	IsError           bool          `json:"isError,omitempty"`
}

type configuredServer struct {
	config     ServerConfig
	hash       string
	allowed    map[string]struct{}
	timeout    time.Duration
	publicView PublicServer
}

type Service struct {
	servers map[string]configuredServer
	order   []string
	nextID  atomic.Int64
	era     sync.Map
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error,omitempty"`
}

func NewFromEnvironment() (*Service, error) {
	raw := strings.TrimSpace(os.Getenv(ServersEnv))
	if raw == "" {
		return New(nil)
	}
	if len(raw) > maxEnvironmentJSONSize {
		return nil, fmt.Errorf("%s 不能超过 %d 字节", ServersEnv, maxEnvironmentJSONSize)
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	var configs []ServerConfig
	if err := decoder.Decode(&configs); err != nil {
		return nil, fmt.Errorf("%s 格式无效: %w", ServersEnv, err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return nil, fmt.Errorf("%s 只能包含一个 JSON 数组", ServersEnv)
	}
	return New(configs)
}

func New(configs []ServerConfig) (*Service, error) {
	if len(configs) > maxServers {
		return nil, fmt.Errorf("MCP Server 最多配置 %d 个", maxServers)
	}
	service := &Service{servers: make(map[string]configuredServer, len(configs)), order: make([]string, 0, len(configs))}
	for _, input := range configs {
		server, err := normalizeServer(input)
		if err != nil {
			return nil, err
		}
		if _, exists := service.servers[server.config.ID]; exists {
			return nil, fmt.Errorf("MCP Server ID 重复: %s", server.config.ID)
		}
		service.servers[server.config.ID] = server
		service.order = append(service.order, server.config.ID)
	}
	return service, nil
}

func (s *Service) Servers() []PublicServer {
	if s == nil {
		return []PublicServer{}
	}
	result := make([]PublicServer, 0, len(s.order))
	for _, id := range s.order {
		server := s.servers[id]
		view := server.publicView
		view.AllowedTools = append([]string(nil), view.AllowedTools...)
		result = append(result, view)
	}
	return result
}

func (s *Service) Snapshots(ids []string) ([]ServerSnapshot, error) {
	if len(ids) == 0 {
		return []ServerSnapshot{}, nil
	}
	if s == nil {
		return nil, errors.New("MCP 服务未配置")
	}
	if len(ids) > maxServers {
		return nil, fmt.Errorf("单轮最多选择 %d 个 MCP Server", maxServers)
	}
	seen := make(map[string]struct{}, len(ids))
	result := make([]ServerSnapshot, 0, len(ids))
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		if _, duplicate := seen[id]; duplicate {
			return nil, fmt.Errorf("MCP Server ID 重复: %s", id)
		}
		server, ok := s.servers[id]
		if !ok {
			return nil, fmt.Errorf("MCP Server 不存在或未启用: %s", id)
		}
		seen[id] = struct{}{}
		result = append(result, ServerSnapshot{ID: id, Name: server.config.Name, ConfigHash: server.hash})
	}
	return result, nil
}

func (s *Service) ValidateSnapshot(snapshot ServerSnapshot) error {
	_, err := s.serverForSnapshot(snapshot)
	return err
}

func (s *Service) ValidateTool(snapshot ServerSnapshot, name string) error {
	server, err := s.serverForSnapshot(snapshot)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if _, allowed := server.allowed[name]; !allowed {
		return fmt.Errorf("MCP 工具未在服务端白名单中: %s", name)
	}
	return nil
}

func (s *Service) ListTools(ctx context.Context, snapshot ServerSnapshot) ([]Tool, error) {
	server, err := s.serverForSnapshot(snapshot)
	if err != nil {
		return nil, err
	}
	var result struct {
		Tools      []Tool `json:"tools"`
		NextCursor string `json:"nextCursor,omitempty"`
	}
	err = s.withSession(ctx, server, func(session, negotiatedProtocol string) error {
		cursor := ""
		collected := make([]Tool, 0, len(server.allowed))
		for page := 0; page < 8; page++ {
			params := map[string]any{}
			if cursor != "" {
				params["cursor"] = cursor
			}
			var pageResult struct {
				Tools      []Tool `json:"tools"`
				NextCursor string `json:"nextCursor,omitempty"`
			}
			if err := s.rpc(ctx, server, session, negotiatedProtocol, "tools/list", params, &pageResult); err != nil {
				return err
			}
			for _, tool := range pageResult.Tools {
				if _, allowed := server.allowed[tool.Name]; !allowed {
					continue
				}
				if err := validateTool(&tool); err != nil {
					return err
				}
				collected = append(collected, tool)
				if len(collected) > maxToolsPerServer {
					return fmt.Errorf("MCP Server 返回的工具数量超过 %d", maxToolsPerServer)
				}
			}
			cursor = strings.TrimSpace(pageResult.NextCursor)
			if cursor == "" {
				result.Tools = collected
				return nil
			}
		}
		return errors.New("MCP 工具目录分页过多")
	})
	if err != nil {
		return nil, err
	}
	return result.Tools, nil
}

func (s *Service) CallTool(ctx context.Context, snapshot ServerSnapshot, name string, arguments map[string]any) (ToolCallResult, error) {
	server, err := s.serverForSnapshot(snapshot)
	if err != nil {
		return ToolCallResult{}, err
	}
	name = strings.TrimSpace(name)
	if err := s.ValidateTool(snapshot, name); err != nil {
		return ToolCallResult{}, err
	}
	if arguments == nil {
		arguments = map[string]any{}
	}
	encoded, err := json.Marshal(arguments)
	if err != nil || len(encoded) > maxRequestBytes {
		return ToolCallResult{}, fmt.Errorf("MCP 工具参数无效或超过 %d 字节", maxRequestBytes)
	}
	var result ToolCallResult
	err = s.withSession(ctx, server, func(session, negotiatedProtocol string) error {
		return s.rpc(ctx, server, session, negotiatedProtocol, "tools/call", map[string]any{"name": name, "arguments": arguments}, &result)
	})
	if err != nil {
		return ToolCallResult{}, err
	}
	for index := range result.Content {
		if result.Content[index].Type == "" {
			return ToolCallResult{}, errors.New("MCP 工具返回了无类型内容")
		}
	}
	return result, nil
}

func normalizeServer(input ServerConfig) (configuredServer, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.URL = strings.TrimSpace(input.URL)
	if !validIdentifier(input.ID, 64) {
		return configuredServer{}, errors.New("MCP Server ID 需要 1–64 个字母、数字、点、下划线或短横线")
	}
	if input.Name == "" || len([]rune(input.Name)) > 80 {
		return configuredServer{}, fmt.Errorf("MCP Server %s 名称需要 1–80 个字符", input.ID)
	}
	if len([]rune(input.Description)) > 300 {
		return configuredServer{}, fmt.Errorf("MCP Server %s 说明不能超过 300 个字符", input.ID)
	}
	if err := validateConfiguredURL(input.URL); err != nil {
		return configuredServer{}, fmt.Errorf("MCP Server %s 地址无效: %w", input.ID, err)
	}
	headers, err := normalizeHeaders(input.Headers)
	if err != nil {
		return configuredServer{}, fmt.Errorf("MCP Server %s Header 无效: %w", input.ID, err)
	}
	input.Headers = headers
	if len(input.AllowedTools) == 0 || len(input.AllowedTools) > maxToolsPerServer {
		return configuredServer{}, fmt.Errorf("MCP Server %s 必须配置 1–%d 个允许工具", input.ID, maxToolsPerServer)
	}
	allowed := make(map[string]struct{}, len(input.AllowedTools))
	tools := make([]string, 0, len(input.AllowedTools))
	for _, raw := range input.AllowedTools {
		name := strings.TrimSpace(raw)
		if !validToolName(name) {
			return configuredServer{}, fmt.Errorf("MCP Server %s 工具名无效: %s", input.ID, name)
		}
		if _, exists := allowed[name]; exists {
			return configuredServer{}, fmt.Errorf("MCP Server %s 工具名重复: %s", input.ID, name)
		}
		allowed[name] = struct{}{}
		tools = append(tools, name)
	}
	sort.Strings(tools)
	input.AllowedTools = tools
	timeout := time.Duration(input.TimeoutSeconds) * time.Second
	if input.TimeoutMilliseconds > 0 {
		timeout = time.Duration(input.TimeoutMilliseconds) * time.Millisecond
	}
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	if timeout > maxTimeout {
		return configuredServer{}, fmt.Errorf("MCP Server %s 超时不能超过 %s", input.ID, maxTimeout)
	}
	hashInput := input
	hashInput.TimeoutMilliseconds = int(timeout / time.Millisecond)
	raw, _ := json.Marshal(hashInput)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	return configuredServer{
		config:  input,
		hash:    hash,
		allowed: allowed,
		timeout: timeout,
		publicView: PublicServer{
			ID: input.ID, Name: input.Name, Description: input.Description, AllowedTools: append([]string(nil), tools...),
		},
	}, nil
}

func (s *Service) serverForSnapshot(snapshot ServerSnapshot) (configuredServer, error) {
	if s == nil {
		return configuredServer{}, errors.New("MCP 服务未配置")
	}
	server, ok := s.servers[strings.TrimSpace(snapshot.ID)]
	if !ok {
		return configuredServer{}, fmt.Errorf("MCP Server 不存在或已停用: %s", snapshot.ID)
	}
	if snapshot.ConfigHash == "" || snapshot.ConfigHash != server.hash {
		return configuredServer{}, fmt.Errorf("MCP Server %s 配置已变化，请新开一轮 Agent", snapshot.ID)
	}
	return server, nil
}

func (s *Service) withSession(ctx context.Context, server configuredServer, fn func(session, negotiatedProtocol string) error) error {
	if cached, ok := s.era.Load(server.config.ID); ok {
		if cached == modernProtocolVersion {
			return fn("", modernProtocolVersion)
		}
		return s.withLegacySession(ctx, server, fn)
	}

	var discovery map[string]any
	_, modernErr := s.rpcRequest(ctx, server, "", modernProtocolVersion, "server/discover", map[string]any{}, &discovery)
	if modernErr == nil {
		s.era.Store(server.config.ID, modernProtocolVersion)
		return fn("", modernProtocolVersion)
	}
	if err := s.withLegacySession(ctx, server, fn); err != nil {
		return fmt.Errorf("MCP 2026-07-28 探测失败 (%v)，旧协议初始化也失败: %w", modernErr, err)
	}
	s.era.Store(server.config.ID, legacyProtocolVersion)
	return nil
}

func (s *Service) withLegacySession(ctx context.Context, server configuredServer, fn func(session, negotiatedProtocol string) error) error {
	var initialized struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	session, err := s.rpcRequest(ctx, server, "", "", "initialize", map[string]any{
		"protocolVersion": legacyProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "open-ai-canvas", "version": "1"},
	}, &initialized)
	if err != nil {
		return fmt.Errorf("MCP 初始化失败: %w", err)
	}
	if initialized.ProtocolVersion == "" {
		return errors.New("MCP 初始化响应缺少 protocolVersion")
	}
	if err := s.notification(ctx, server, session, initialized.ProtocolVersion, "notifications/initialized", map[string]any{}); err != nil {
		return fmt.Errorf("MCP 初始化确认失败: %w", err)
	}
	return fn(session, initialized.ProtocolVersion)
}

func (s *Service) rpc(ctx context.Context, server configuredServer, session, negotiatedProtocol, method string, params map[string]any, target any) error {
	_, err := s.rpcRequest(ctx, server, session, negotiatedProtocol, method, params, target)
	return err
}

func (s *Service) rpcRequest(ctx context.Context, server configuredServer, session, negotiatedProtocol, method string, params map[string]any, target any) (string, error) {
	id := s.nextID.Add(1)
	if negotiatedProtocol == modernProtocolVersion {
		modernParams := make(map[string]any, len(params)+1)
		for key, value := range params {
			modernParams[key] = value
		}
		modernParams["_meta"] = map[string]any{
			"io.modelcontextprotocol/protocolVersion":    modernProtocolVersion,
			"io.modelcontextprotocol/clientCapabilities": map[string]any{},
			"io.modelcontextprotocol/clientInfo":         map[string]any{"name": "open-ai-canvas", "version": "1"},
		}
		params = modernParams
	}
	payload := map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}
	response, responseSession, err := s.post(ctx, server, session, negotiatedProtocol, payload, false)
	if err != nil {
		return "", err
	}
	if response.Error != nil {
		return "", fmt.Errorf("MCP JSON-RPC %d: %s", response.Error.Code, response.Error.Message)
	}
	if strings.TrimSpace(string(response.ID)) != fmt.Sprintf("%d", id) {
		return "", fmt.Errorf("MCP JSON-RPC 响应 id 不匹配: want %d got %s", id, strings.TrimSpace(string(response.ID)))
	}
	if len(response.Result) == 0 || string(response.Result) == "null" {
		return "", errors.New("MCP 响应缺少 result")
	}
	if negotiatedProtocol == modernProtocolVersion {
		var envelope struct {
			ResultType string `json:"resultType"`
		}
		if err := json.Unmarshal(response.Result, &envelope); err != nil {
			return "", fmt.Errorf("解析 MCP 2026-07-28 resultType: %w", err)
		}
		switch envelope.ResultType {
		case "complete":
		case "input_required":
			return "", errors.New("MCP 工具需要多轮输入，当前画布 Agent 尚未支持该交互")
		case "task":
			return "", errors.New("MCP 工具返回异步任务，当前画布 Agent 尚未支持 MCP Tasks 扩展")
		case "":
			return "", errors.New("MCP 2026-07-28 响应缺少 resultType")
		default:
			return "", fmt.Errorf("MCP 返回不支持的 resultType: %s", envelope.ResultType)
		}
	}
	if err := json.Unmarshal(response.Result, target); err != nil {
		return "", fmt.Errorf("解析 MCP result: %w", err)
	}
	return responseSession, nil
}

func (s *Service) notification(ctx context.Context, server configuredServer, session, negotiatedProtocol, method string, params map[string]any) error {
	payload := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	_, _, err := s.post(ctx, server, session, negotiatedProtocol, payload, true)
	return err
}

func (s *Service) post(ctx context.Context, server configuredServer, session, negotiatedProtocol string, payload map[string]any, notification bool) (rpcResponse, string, error) {
	var empty rpcResponse
	parsed, err := outbound.ValidateCustomRelayURL(server.config.URL)
	if err != nil {
		return empty, "", err
	}
	body, err := json.Marshal(payload)
	if err != nil || len(body) > maxRequestBytes {
		return empty, "", errors.New("MCP 请求无法编码或超过大小限制")
	}
	requestCtx, cancel := context.WithTimeout(ctx, server.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, parsed.String(), bytes.NewReader(body))
	if err != nil {
		return empty, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if session != "" {
		req.Header.Set("Mcp-Session-Id", session)
	}
	if negotiatedProtocol != "" {
		req.Header.Set("MCP-Protocol-Version", negotiatedProtocol)
	}
	if negotiatedProtocol == modernProtocolVersion {
		method, _ := payload["method"].(string)
		req.Header.Set("Mcp-Method", method)
		if params, ok := payload["params"].(map[string]any); ok {
			if name, ok := params["name"].(string); ok && strings.TrimSpace(name) != "" {
				req.Header.Set("Mcp-Name", strings.TrimSpace(name))
			}
		}
	}
	for name, value := range server.config.Headers {
		req.Header.Set(name, value)
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	resp, err := outbound.CustomRelayHTTPClient(server.timeout).Do(req)
	if err != nil {
		return empty, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4097))
		return empty, "", fmt.Errorf("MCP HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))
	}
	responseSession := strings.TrimSpace(resp.Header.Get("Mcp-Session-Id"))
	if responseSession == "" {
		responseSession = session
	}
	if notification && resp.StatusCode == http.StatusAccepted {
		return empty, responseSession, nil
	}
	raw, err := readBoundedBody(resp.Body)
	if err != nil {
		return empty, "", err
	}
	if notification && len(bytes.TrimSpace(raw)) == 0 {
		return empty, responseSession, nil
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		raw, err = firstSSEData(raw, payload["id"])
		if err != nil {
			return empty, "", err
		}
	}
	if err := json.Unmarshal(raw, &empty); err != nil {
		return empty, "", fmt.Errorf("解析 MCP JSON-RPC 响应: %w", err)
	}
	if empty.JSONRPC != "2.0" {
		return empty, "", errors.New("MCP 响应 jsonrpc 必须为 2.0")
	}
	return empty, responseSession, nil
}

func readBoundedBody(reader io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, maxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxResponseBytes {
		return nil, fmt.Errorf("MCP 响应超过 %d 字节", maxResponseBytes)
	}
	return raw, nil
}

func firstSSEData(raw []byte, expectedID any) ([]byte, error) {
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 4096), maxResponseBytes)
	parts := []string{}
	match := func() ([]byte, bool) {
		if len(parts) == 0 {
			return nil, false
		}
		candidate := []byte(strings.Join(parts, "\n"))
		parts = parts[:0]
		if expectedID == nil {
			return candidate, true
		}
		var response rpcResponse
		if json.Unmarshal(candidate, &response) != nil {
			return nil, false
		}
		expected, _ := json.Marshal(expectedID)
		return candidate, bytes.Equal(bytes.TrimSpace(response.ID), bytes.TrimSpace(expected))
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if candidate, ok := match(); ok {
				return candidate, nil
			}
			continue
		}
		if strings.HasPrefix(line, "data:") {
			parts = append(parts, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if candidate, ok := match(); ok {
		return candidate, nil
	}
	return nil, errors.New("MCP SSE 响应没有匹配请求 id 的 data 事件")
}

func validateConfiguredURL(raw string) error {
	if len(raw) == 0 || len(raw) > 4096 {
		return errors.New("地址为空或过长")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || !parsed.IsAbs() || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("需要不含凭据和片段的绝对 HTTP(S) 地址")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("只支持 http/https")
	}
	if parsed.Scheme == "http" && !outbound.AllowedPrivateUpstreamHost(parsed.Hostname()) {
		return errors.New("HTTP 地址仅允许已精确放行的可信主机")
	}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) && !outbound.AllowedPrivateUpstreamHost(parsed.Hostname()) {
		return errors.New("不允许访问未放行的本机或私网地址")
	}
	return nil
}

func normalizeHeaders(input map[string]string) (map[string]string, error) {
	if len(input) > 32 {
		return nil, errors.New("Header 最多 32 项")
	}
	result := make(map[string]string, len(input))
	total := 0
	for rawName, rawValue := range input {
		name := http.CanonicalHeaderKey(strings.TrimSpace(rawName))
		value := strings.TrimSpace(rawValue)
		lower := strings.ToLower(name)
		if name == "" || !validHeaderName(name) || blockedHeader(lower) {
			return nil, fmt.Errorf("不允许 Header %q", rawName)
		}
		if len(name) > 128 || len(value) > 4096 || hasUnsafeControl(value) {
			return nil, fmt.Errorf("Header %s 值无效", name)
		}
		total += len(name) + len(value)
		if total > 16<<10 {
			return nil, errors.New("Header 总大小不能超过 16KB")
		}
		result[name] = value
	}
	return result, nil
}

func validateTool(tool *Tool) error {
	if tool == nil {
		return errors.New("MCP Server 返回空工具")
	}
	if !validToolName(tool.Name) {
		return fmt.Errorf("MCP Server 返回无效工具名: %s", tool.Name)
	}
	if len([]rune(tool.Description)) > 4000 {
		return fmt.Errorf("MCP 工具 %s 说明过长", tool.Name)
	}
	if tool.InputSchema == nil {
		tool.InputSchema = map[string]any{"type": "object"}
	}
	if kind, ok := tool.InputSchema["type"].(string); ok && kind != "object" {
		return fmt.Errorf("MCP 工具 %s inputSchema 必须是 object", tool.Name)
	}
	return nil
}

func validIdentifier(value string, max int) bool {
	if value == "" || len(value) > max {
		return false
	}
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func validToolName(value string) bool {
	if value == "" || strings.TrimSpace(value) != value || len([]rune(value)) > 128 {
		return false
	}
	hasLetterOrDigit := false
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			hasLetterOrDigit = true
			continue
		}
		if r != '-' && r != '_' && r != '.' && r != ':' && r != '/' {
			return false
		}
	}
	return hasLetterOrDigit
}

func validHeaderName(value string) bool {
	for index := 0; index < len(value); index++ {
		char := value[index]
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", rune(char)) {
			continue
		}
		return false
	}
	return value != ""
}

func blockedHeader(name string) bool {
	switch name {
	case "host", "content-length", "content-type", "accept", "connection", "proxy-connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "mcp-session-id", "mcp-protocol-version", "mcp-method", "mcp-name", "last-event-id":
		return true
	}
	return strings.HasPrefix(name, "mcp-param-") || strings.HasPrefix(name, "x-canvas-") || strings.HasPrefix(name, "x-forwarded-")
}

func hasUnsafeControl(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) && r != '\t' {
			return true
		}
	}
	return false
}
