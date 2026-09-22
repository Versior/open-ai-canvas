# Domain MCP Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付“管理员安装能力包 → AnySearch 检索 → 电商商品洞察 → Artifact Bundle → 画布批量落点”的首个可运行纵向闭环。

**Architecture:** 新增不依赖 `internal/app` 的 `internal/domainmcp` 深模块，统一能力包目录、工具合同、证据、错误和 Artifact Bundle；`internal/app` 只负责管理员配置、密钥、审计、Agent 运行与画布写入。标准 MCP Endpoint 使用官方 Go SDK v1.8.0，内置 Agent 直接调用同一 Hub，避免后端自请求 HTTP。

**Tech Stack:** Go 1.25、Gin、GORM、SQLite/PostgreSQL、官方 `github.com/modelcontextprotocol/go-sdk/mcp` v1.8.0、React 19、TypeScript 7、Ant Design 6、Bun。

## Global Constraints

- 第一阶段不执行市场条目的 npm、Python、Docker 或 stdio 命令。
- 第一阶段内置领域工具权限全部为 `read_only`；媒体生成和画布写入继续由影策既有工具单独审批。
- 第一阶段只有管理员能安装、配置、测试、启停和删除能力；普通用户只能读取被允许的能力。
- 凭据只以加密值进入 `SystemSetting`，前端、日志、Agent 事件和错误不得返回明文或密文。
- 外部事实必须引用证据；没有证据时返回 `NO_EVIDENCE`，不得由模型补造趋势或商品事实。
- 市场、网页、Registry 描述和 MCP 输出均按不可信数据处理。
- 默认拒绝本机、私网和链路本地上游，仅接受 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` 精确放行。
- Artifact Bundle 只属于创建它的用户、画布和 Agent Run，过期或跨作用域时拒绝使用。
- 所有写画布行为继续进入既有审批、预算、快照冲突和操作记录边界。
- 当前工作树已有 MCP Client、子智能体、视觉识别和滚动修复；实施不得覆盖或回滚这些改动。

---

## File Structure

### Domain core

- `backend/internal/domainmcp/contracts.go`：统一结果、证据、产物、错误码和边界校验。
- `backend/internal/domainmcp/catalog.go`：能力包 Manifest、工具 Manifest、权限和 Provider 需求。
- `backend/internal/domainmcp/hub.go`：已启用能力注册、工具查找与调用入口。
- `backend/internal/domainmcp/artifact_bundle.go`：Bundle 身份、作用域、过期与画布 Recipe 合同。
- `backend/internal/domainmcp/providers/search.go`：搜索 Provider 接口及规范化结果。
- `backend/internal/domainmcp/providers/anysearch.go`：通过现有受限 MCP Client 调用 AnySearch。
- `backend/internal/domainmcp/packs/commerce/manifest.go`：电商商品洞察能力包目录。
- `backend/internal/domainmcp/packs/commerce/product_analysis.go`：商品洞察工具实现。
- `backend/internal/domainmcp/server.go`：把 Hub 注册到官方 MCP Go SDK。

### Application integration

- `backend/internal/app/domain_mcp_settings.go`：管理员设置、凭据加解密、安装状态和审计。
- `backend/internal/app/domain_mcp_runtime.go`：根据数据库设置构建并原子替换 Hub/MCP Client 快照。
- `backend/internal/app/cloud_agent_domain_mcp.go`：Agent 调用 Hub、保存 Bundle 和生成审批预览。
- `backend/internal/app/cloud_agent_artifact_bundle.go`：把 Bundle 编译成既有 `canvas_apply_ops` 并以单个操作组写入。
- `backend/internal/app/service.go`：持有 Domain MCP 运行时。
- `backend/internal/service/aliases_types.go`：向 handler 再导出管理接口类型。

### HTTP and UI

- `backend/internal/handler/domain_mcp.go`：管理员市场 API 与标准 `/mcp/domain` Endpoint。
- `backend/internal/handler/api.go`：注册路由。
- `backend/internal/handler/openapi.yaml`：接口 Schema。
- `web/src/services/api/domain-mcp.ts`：市场 API 类型和调用。
- `web/src/pages/admin/mcp/mcp-marketplace-page.tsx`：推荐、已安装、自定义连接三个标签。
- `web/src/pages/admin/mcp/mcp-marketplace-page.css`：页面私有布局、窄屏与滚动。
- `web/src/pages/admin/components/admin-shell.tsx`：增加 MCP 能力市场导航。
- `web/src/router.tsx`：增加 `/admin/mcp` 路由。
- `web/src/components/canvas/canvas-cloud-agent-settings.tsx`：展示能力包来源和可用状态。

### Tests and docs

- `backend/internal/domainmcp/*_test.go`：合同、Catalog、Hub、AnySearch、Commerce、MCP 协议测试。
- `backend/internal/app/domain_mcp_settings_test.go`：权限、密钥、审计、保留和清除测试。
- `backend/internal/app/cloud_agent_artifact_bundle_test.go`：隔离、过期、审批、重试和单组写入测试。
- `backend/internal/handler/domain_mcp_test.go`：路由鉴权、脱敏和请求边界测试。
- `web/test/admin-mcp-marketplace.test.ts`：路由、API、密钥不回显和 UI 合同测试。
- `docs/content/docs/backend/http-api.mdx`：管理员与用户接口。
- `docs/content/docs/backend/code-map.mdx`：Domain MCP 模块职责。
- `docs/content/docs/progress/pending-test.mdx`：待真实 AnySearch 和浏览器验收项目。

---

### Task 1: Domain contracts and catalog

**Files:**
- Create: `backend/internal/domainmcp/contracts.go`
- Create: `backend/internal/domainmcp/catalog.go`
- Create: `backend/internal/domainmcp/contracts_test.go`
- Create: `backend/internal/domainmcp/catalog_test.go`

**Interfaces:**
- Produces: `ErrorCode`, `DomainError`, `ErrNoEvidence`, `ErrPolicyBlocked`, `Evidence`, `Finding`, `Artifact`, `Result`, `ToolManifest`, `PackManifest`, `Catalog`, `ValidateResult(Result) error`.

- [x] **Step 1: Write failing contract tests**

```go
func TestValidateResultRequiresEvidenceForExternalFindings(t *testing.T) {
    result := Result{Findings: []Finding{{Title: "热词增长", Detail: "搜索热度上升", External: true}}}
    if err := ValidateResult(result); !errors.Is(err, ErrNoEvidence) {
        t.Fatalf("ValidateResult() error = %v", err)
    }
}

func TestBuiltinCatalogContainsCommerceProductInsight(t *testing.T) {
    catalog, err := NewCatalog(BuiltinPacks()...)
    if err != nil { t.Fatal(err) }
    pack, ok := catalog.Pack("commerce.product-insight")
    if !ok || pack.Tools[0].Name != "commerce.product_analyze" {
        t.Fatalf("pack = %#v", pack)
    }
}
```

- [x] **Step 2: Run tests and verify RED**

Run: `cd backend && go test ./internal/domainmcp -run 'ValidateResult|BuiltinCatalog' -count=1`

Expected: compilation fails because `Result`, `ValidateResult` and `NewCatalog` do not exist.

- [x] **Step 3: Implement the contracts and immutable catalog**

```go
type ErrorCode string

const (
    ErrorInputInvalid ErrorCode = "INPUT_INVALID"
    ErrorNoEvidence ErrorCode = "NO_EVIDENCE"
    ErrorUpstreamAuth ErrorCode = "UPSTREAM_AUTH"
    ErrorUpstreamQuota ErrorCode = "UPSTREAM_QUOTA"
    ErrorUpstreamTimeout ErrorCode = "UPSTREAM_TIMEOUT"
    ErrorPartialResult ErrorCode = "PARTIAL_RESULT"
    ErrorPolicyBlocked ErrorCode = "POLICY_BLOCKED"
    ErrorOutputInvalid ErrorCode = "OUTPUT_INVALID"
)

type DomainError struct {
    Code ErrorCode
    Message string
    Cause error
}
```

`DomainError.Is` 按错误码匹配，并导出 `ErrNoEvidence`、`ErrPolicyBlocked` 等不含上游正文的哨兵错误。`ValidateResult` 必须校验：最多 100 个发现、50 个来源、50 个产物；外部发现至少引用一个存在的 `Evidence.ID`；URL 为绝对 HTTPS；字符串和序列化结果有界；Artifact 类型来自白名单。

- [x] **Step 4: Run tests and verify GREEN**

Run: `cd backend && go test ./internal/domainmcp -count=1`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/internal/domainmcp
git commit -m "feat(mcp): 领域能力 - 建立结果合同与能力目录"
```

### Task 2: Hub execution boundary

**Files:**
- Create: `backend/internal/domainmcp/hub.go`
- Create: `backend/internal/domainmcp/hub_test.go`

**Interfaces:**
- Consumes: `PackManifest`, `Result`, `ValidateResult`.
- Produces: `ToolHandler`, `ToolRegistry`, `Hub.ListTools`, `Hub.CallTool`.

- [x] **Step 1: Write failing Hub tests**

```go
func TestHubExposesOnlyEnabledAllowlistedTools(t *testing.T) {
    hub, err := NewHub([]Installation{{PackID: "commerce.product-insight", Enabled: true, AllowedTools: []string{"commerce.product_analyze"}}}, fixturePack())
    if err != nil { t.Fatal(err) }
    tools := hub.ListTools()
    if len(tools) != 1 || tools[0].Name != "commerce.product_analyze" { t.Fatalf("tools = %#v", tools) }
    if _, err := hub.CallTool(context.Background(), "commerce.competitor_compare", json.RawMessage(`{}`)); !errors.Is(err, ErrPolicyBlocked) {
        t.Fatalf("error = %v", err)
    }
}
```

- [x] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/domainmcp -run Hub -count=1`

Expected: compilation fails because `Hub` does not exist.

- [x] **Step 3: Implement minimal registry and call path**

```go
type ToolHandler interface {
    Manifest() ToolManifest
    Call(context.Context, json.RawMessage) (Result, error)
}
```

Hub construction rejects duplicate pack IDs, duplicate tool names, unknown allowlist entries and enabled packs without handlers. Calls decode bounded JSON, invoke one handler, then run `ValidateResult` before returning.

- [x] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/domainmcp -run Hub -count=1`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/internal/domainmcp/hub.go backend/internal/domainmcp/hub_test.go
git commit -m "feat(mcp): 领域能力 - 增加受策略约束的 Hub"
```

### Task 3: AnySearch provider adapter

**Files:**
- Create: `backend/internal/domainmcp/providers/search.go`
- Create: `backend/internal/domainmcp/providers/anysearch.go`
- Create: `backend/internal/domainmcp/providers/anysearch_test.go`
- Modify: `backend/internal/mcp/service.go`
- Modify: `backend/internal/mcp/service_test.go`

**Interfaces:**
- Consumes: `internal/mcp.Service`, AnySearch `search` and `extract` tools.
- Produces: `SearchProvider.Search`, `SearchProvider.Extract`, normalized `SearchHit` and `ExtractedPage`.

- [ ] **Step 1: Write failing adapter tests with an HTTP fixture**

```go
func TestAnySearchNormalizesStructuredAndTextResults(t *testing.T) {
    provider := newFixtureProvider(t, fixtureReturningSearchResults())
    hits, err := provider.Search(context.Background(), SearchQuery{Query: "2026 夏季防晒衣", Limit: 5})
    if err != nil { t.Fatal(err) }
    if len(hits) != 1 || hits[0].URL != "https://example.com/item" || hits[0].Title != "防晒衣" {
        t.Fatalf("hits = %#v", hits)
    }
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/domainmcp/providers -count=1`

Expected: package or types do not exist.

- [ ] **Step 3: Implement bounded provider translation**

The adapter calls `search` with `query` and bounded `limit`, accepts `structuredContent` first and text JSON second, rejects non-HTTPS evidence URLs, truncates snippets, maps 401/403 to `UPSTREAM_AUTH`, 429 to `UPSTREAM_QUOTA`, deadline errors to `UPSTREAM_TIMEOUT`, and preserves partial valid hits with `PARTIAL_RESULT`.

Increase the generic MCP response limit from 96 KiB to 512 KiB only after adding a test proving a 500 KiB response succeeds and a 512 KiB+1 response fails. The Domain adapter applies a smaller normalized output limit before returning to the Agent.

- [ ] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/domainmcp/providers ./internal/mcp -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domainmcp/providers backend/internal/mcp
git commit -m "feat(mcp): AnySearch - 增加受限搜索 Provider"
```

### Task 4: Commerce product insight pack

**Files:**
- Create: `backend/internal/domainmcp/packs/commerce/manifest.go`
- Create: `backend/internal/domainmcp/packs/commerce/product_analysis.go`
- Create: `backend/internal/domainmcp/packs/commerce/product_analysis_test.go`

**Interfaces:**
- Consumes: `providers.SearchProvider`.
- Produces: four registered tools, with `commerce.product_analyze` fully executable in Batch 1.

- [ ] **Step 1: Write failing behavior tests**

```go
func TestProductAnalyzeSeparatesProductFactsFromMarketSignals(t *testing.T) {
    tool := NewProductAnalyze(fixtureSearchProvider())
    result, err := tool.Call(context.Background(), json.RawMessage(`{"productName":"轻薄防晒衣","productFacts":["UPF50+"]}`))
    if err != nil { t.Fatal(err) }
    if result.Artifacts[0].Type != "canvas.commerce-product-report" { t.Fatalf("artifacts = %#v", result.Artifacts) }
    assertFindingEvidence(t, result)
    assertSection(t, result.Artifacts[0], "productFacts")
    assertSection(t, result.Artifacts[0], "marketSignals")
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/domainmcp/packs/commerce -count=1`

Expected: package or constructor does not exist.

- [ ] **Step 3: Implement the first executable tool**

`commerce.product_analyze` accepts product name, known facts, audience hint, market and language. It builds bounded search queries, deduplicates canonical URLs, scores source recency and agreement, separates supplied facts from public-search signals, and returns a report Artifact plus a `canvas.recipe` Artifact containing deterministic text-node sections. The other three tools are listed in the Manifest but marked unavailable until their handlers are registered, so the Hub never exposes a non-executable tool.

- [ ] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/domainmcp/packs/commerce ./internal/domainmcp -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domainmcp/packs/commerce
git commit -m "feat(mcp): 电商洞察 - 增加商品分析能力包"
```

### Task 5: Artifact Bundle compiler

**Files:**
- Create: `backend/internal/domainmcp/artifact_bundle.go`
- Create: `backend/internal/domainmcp/artifact_bundle_test.go`
- Create: `backend/internal/app/cloud_agent_artifact_bundle.go`
- Create: `backend/internal/app/cloud_agent_artifact_bundle_test.go`
- Modify: `backend/internal/app/cloud_agent_runtime.go`
- Modify: `backend/internal/app/cloud_agent_tools.go`

**Interfaces:**
- Consumes: validated `Result.Artifacts`.
- Produces: `ArtifactBundle`, neutral `CanvasRecipeOp`, `CompileCanvasRecipe`, Agent tool `canvas_apply_artifact_bundle(bundleId)`; `internal/app` alone maps `CanvasRecipeOp` to private `agentCanvasOp`.

- [ ] **Step 1: Write failing scope and compilation tests**

```go
func TestArtifactBundleRejectsCrossRunUse(t *testing.T) {
    bundle := ArtifactBundle{ID: "bundle-1", UserID: "user-1", CanvasID: "canvas-1", RunID: "run-1", ExpiresAt: time.Now().Add(time.Hour)}
    if err := bundle.Authorize("user-1", "canvas-1", "run-2", time.Now()); !errors.Is(err, ErrPolicyBlocked) {
        t.Fatalf("Authorize() error = %v", err)
    }
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/domainmcp ./internal/app -run ArtifactBundle -count=1`

Expected: Bundle and Agent tool types do not exist.

- [ ] **Step 3: Implement Bundle storage inside the durable Agent runtime**

Add `ArtifactBundles map[string]domainmcp.ArtifactBundle` to `cloudAgentRuntime`. Bundle IDs use server-generated IDs and never come from MCP output. `CompileCanvasRecipe` accepts only known Artifact types, returns neutral `CanvasRecipeOp` values, generates stable node IDs from bundle ID plus artifact index, lays out nodes in rows and caps the result at 20 operations. `internal/app` maps those values to `agentCanvasOp` and calls the existing `prepareCloudAgentCanvasMutation`/`saveCloudAgentDocument` path once. The mutation recorder stores operation `canvas_apply_artifact_bundle`, preserving one整体撤销操作组。

- [ ] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/domainmcp ./internal/app -run ArtifactBundle -count=1`

Expected: PASS with `CGO_ENABLED=1` on Windows.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domainmcp/artifact_bundle* backend/internal/app/cloud_agent_artifact_bundle* backend/internal/app/cloud_agent_runtime.go backend/internal/app/cloud_agent_tools.go
git commit -m "feat(agent): 画布产物 - 增加 Bundle 批量落点"
```

### Task 6: Persisted installations, encrypted credentials, and audits

**Files:**
- Create: `backend/internal/app/domain_mcp_settings.go`
- Create: `backend/internal/app/domain_mcp_settings_test.go`
- Create: `backend/internal/app/domain_mcp_runtime.go`
- Modify: `backend/internal/app/service.go`
- Modify: `backend/internal/service/aliases_types.go`

**Interfaces:**
- Produces: `AdminDomainMCPCatalog`, `AdminDomainMCPInstallations`, `InstallDomainMCPPack`, `UpdateDomainMCPInstallation`, `DeleteDomainMCPInstallation`, `TestDomainMCPConnection`.

- [ ] **Step 1: Write failing admin-setting tests**

```go
func TestDomainMCPSettingsEncryptCredentialsAndKeepSecretOnBlankUpdate(t *testing.T) {
    svc, db, actor := domainMCPTestService(t)
    created, err := svc.InstallDomainMCPPack(actor, InstallDomainMCPRequest{PackID: "commerce.product-insight", APIKey: "secret-value"})
    if err != nil { t.Fatal(err) }
    raw := loadDomainMCPSetting(t, db)
    if strings.Contains(raw, "secret-value") { t.Fatal("plaintext secret persisted") }
    updated, err := svc.UpdateDomainMCPInstallation(actor, created.ID, UpdateDomainMCPRequest{Name: "新的名称"})
    if err != nil || !updated.CredentialConfigured { t.Fatalf("updated = %#v, err = %v", updated, err) }
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/app -run DomainMCPSettings -count=1`

Expected: methods and request types do not exist.

- [ ] **Step 3: Implement settings and atomic runtime reload**

Store one schema-versioned value under `domain_mcp_marketplace`. Encrypt each credential with existing `encryptSettingValue`; blank update preserves the current cipher and explicit `ClearCredential` removes it. Every write checks `actor.Role == admin`, validates before persistence, appends an `AdminAuditEvent`, saves setting and audit transactionally, builds a new immutable Hub, then swaps it under a mutex. On reload failure keep the previous working Hub and return the failure to the write request.

- [ ] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/app -run 'DomainMCPSettings|DomainMCPRuntime' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/app/domain_mcp_* backend/internal/app/service.go backend/internal/service/aliases_types.go
git commit -m "feat(admin): MCP 市场 - 持久化安装与加密凭据"
```

### Task 7: Admin HTTP API and standard MCP endpoint

**Files:**
- Create: `backend/internal/handler/domain_mcp.go`
- Create: `backend/internal/handler/domain_mcp_test.go`
- Modify: `backend/internal/handler/api.go`
- Modify: `backend/internal/handler/openapi.yaml`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

**Interfaces:**
- Consumes: app methods from Task 6 and Hub from Task 2.
- Produces: admin routes in the design and `/mcp/domain` Streamable HTTP endpoint.

- [ ] **Step 1: Write failing route tests**

Test non-admin rejection, response secret redaction, unknown JSON fields, request-size limits, connection-test timeout and the MCP sequence `initialize/server-discover → tools/list → tools/call`.

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/handler -run DomainMCP -count=1`

Expected: routes return 404 or symbols do not exist.

- [ ] **Step 3: Add official SDK and register handlers**

Run: `cd backend && go get github.com/modelcontextprotocol/go-sdk@v1.8.0`

```go
server := mcp.NewServer(&mcp.Implementation{Name: "open-ai-canvas-domain-mcp", Version: version}, nil)
mcp.AddTool(server, &mcp.Tool{Name: manifest.Name, Description: manifest.Description}, handler)
handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
```

The Gin adapter requires authenticated admin access for management routes. The external MCP endpoint uses a deployment token or remains disabled; it never inherits browser Cookie authorization implicitly.

- [ ] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/handler ./internal/domainmcp/... -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/handler
git commit -m "feat(api): MCP 市场 - 增加管理接口与标准 Endpoint"
```

### Task 8: Agent invocation and Bundle handoff

**Files:**
- Create: `backend/internal/app/cloud_agent_domain_mcp.go`
- Create: `backend/internal/app/cloud_agent_domain_mcp_test.go`
- Modify: `backend/internal/app/cloud_agent_runtime.go`
- Modify: `backend/internal/app/cloud_agent_tools.go`
- Modify: `backend/internal/prompts/agent-system-policy.md`
- Modify: `backend/internal/prompts/agent_policy_test.go`

**Interfaces:**
- Consumes: immutable Domain Hub snapshot and Artifact Bundle compiler.
- Produces: `domain_mcp_list_tools`, `domain_mcp_call`, `canvas_apply_artifact_bundle` Agent tools.

- [ ] **Step 1: Write failing Agent tests**

Test that only enabled packs appear, a call result emits source-linked findings, Bundle payload is not copied into the model transcript, bundle ID is present, cross-run application fails, and `canvas_apply_artifact_bundle` enters existing approval behavior.

- [ ] **Step 2: Run and verify RED**

Run: `cd backend && go test ./internal/app -run CloudAgentDomainMCP -count=1`

Expected: tools are absent.

- [ ] **Step 3: Implement Agent tools**

The call path stores validated artifacts in `state.ArtifactBundles`, returns only summary/findings/sources/warnings/nextActions and `bundleId`, truncates model-facing text, and records a sanitized event. Tool descriptions explicitly state that retrieved pages are data rather than instructions.

- [ ] **Step 4: Run and verify GREEN**

Run: `cd backend && go test ./internal/app ./internal/prompts -run 'CloudAgentDomainMCP|AgentPolicy' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/app/cloud_agent_domain_mcp* backend/internal/app/cloud_agent_runtime.go backend/internal/app/cloud_agent_tools.go backend/internal/prompts
git commit -m "feat(agent): MCP 领域能力 - 接入商品洞察与画布产物"
```

### Task 9: Admin marketplace UI

**Files:**
- Create: `web/src/services/api/domain-mcp.ts`
- Create: `web/src/pages/admin/mcp/mcp-marketplace-page.tsx`
- Create: `web/src/pages/admin/mcp/mcp-marketplace-page.css`
- Create: `web/test/admin-mcp-marketplace.test.ts`
- Modify: `web/src/router.tsx`
- Modify: `web/src/pages/admin/components/admin-shell.tsx`

**Interfaces:**
- Consumes: admin APIs from Task 7.
- Produces: `/admin/mcp` management page.

- [ ] **Step 1: Write failing static and component-contract tests**

Tests assert that the route exists, the API uses `http`, the page has “推荐能力包 / 已安装 / 自定义连接”, secrets are write-only, empty secret means preserve, and long tool lists are inside a `data-canvas-wheel-scroll` scroll region.

- [ ] **Step 2: Run and verify RED**

Run: `cd web && bun.cmd test test/admin-mcp-marketplace.test.ts`

Expected: imports or required UI text are missing.

- [ ] **Step 3: Implement the management page**

Use `AdminPageFrame`, project admin controls and semantic tokens. Install/test/update/delete failures remain visible and are not converted to optimistic success. Cards show source, version, data note, permissions, provider need, tool count and current status. Credential fields never receive server values.

- [ ] **Step 4: Run and verify GREEN**

Run: `cd web && bun.cmd test test/admin-mcp-marketplace.test.ts && bun.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/services/api/domain-mcp.ts web/src/pages/admin/mcp web/src/router.tsx web/src/pages/admin/components/admin-shell.tsx web/test/admin-mcp-marketplace.test.ts
git commit -m "feat(admin): MCP 市场 - 增加安装与连接管理界面"
```

### Task 10: Deployment, documentation, and full verification

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `docker-compose.local.yml`
- Modify: `docker-compose.deploy.yml`
- Modify: `docker-compose.server.yml`
- Modify: `.github/workflows/*` only where existing image publishing requires Domain MCP variables or image tags.
- Modify: `docs/content/docs/backend/http-api.mdx`
- Modify: `docs/content/docs/backend/code-map.mdx`
- Modify: `docs/content/docs/progress/pending-test.mdx`

**Interfaces:**
- Consumes: completed Batch 1 implementation.
- Produces: deployable configuration and verified release path.

- [ ] **Step 1: Add failing deployment contract tests**

Extend existing Compose and image-release tests to assert that MCP settings are forwarded without embedding credentials, `dev` image tags build from the fork, and the optional external endpoint remains closed unless a token is configured.

- [ ] **Step 2: Run and verify RED**

Run: `cd web && bun.cmd test test/ci-image-release.test.mjs test/fork-image-deployment.test.ts`

Expected: missing variables or workflow branch coverage fails.

- [ ] **Step 3: Implement deployment wiring and documentation**

Document database-backed marketplace configuration as primary, environment JSON as recovery-only, the AnySearch credential UI, the public-search signal limitation, the standard MCP endpoint opt-in, and credential rotation. Never include a real key.

- [ ] **Step 4: Run full verification**

```text
cd backend
gofmt -w internal/domainmcp internal/app/domain_mcp_* internal/app/cloud_agent_domain_mcp* internal/app/cloud_agent_artifact_bundle* internal/handler/domain_mcp*
CGO_ENABLED=1 go test ./...

cd ../web
bun.cmd run typecheck
bun.cmd run lint
bun.cmd test
set NODE_OPTIONS=--max-old-space-size=4096
bun.cmd run build

cd ..
git diff --check
```

Expected: every command exits 0. If the host lacks a working C compiler, record the CGO blocker and run all non-SQLite packages plus the existing Docker/GitHub build path; do not label backend integration tests as passed.

- [ ] **Step 5: Perform real read-only smoke tests**

Use the configured AnySearch connection to run one non-sensitive public query, verify at least one source URL, verify no key appears in response/events/logs, apply the resulting Bundle to a disposable local canvas, undo the single operation group, and verify the canvas returns to the previous snapshot.

- [ ] **Step 6: Commit**

```bash
git add .env.example docker-compose*.yml .github/workflows docs/content/docs
git commit -m "docs(mcp): 能力市场 - 补全部署与验收说明"
```

---

## Batch 1 Exit Gate

Batch 1 only closes when all of the following are evidenced:

1. Admin can install the built-in Commerce Product Insight pack without editing `.env`.
2. Secret is encrypted at rest and absent from all public responses.
3. Connection test and tool discovery use the same SSRF and timeout boundary as runtime calls.
4. Product analysis returns source-linked findings and a validated Artifact Bundle.
5. One approved call creates the complete report layout on canvas as one undo group.
6. Disabled packs and tools cannot be called by forged requests.
7. The standard MCP endpoint passes official SDK protocol smoke tests.
8. Backend tests, frontend tests/typecheck/lint/build, Compose contracts and real read-only AnySearch smoke all have recorded results.

## Remaining Full-Product Plans

After this vertical slice passes its exit gate, write and execute three independent implementation plans against the stable Hub contracts:

1. Batch 2: 电商主图、电商详情页、品牌审核与画布 Recipe。
2. Batch 3: 小红书热点、抖音趋势、内容策划与公网信号质量标注。
3. Batch 4: 影视资料、剧本开发、短剧/漫剧、分集与分镜 Recipe。

The user explicitly selected immediate comprehensive development, so execution mode is **Inline Execution** with test-first checkpoints and focused commits.
