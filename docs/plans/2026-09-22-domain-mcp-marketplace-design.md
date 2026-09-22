# 影策领域 MCP Hub 与能力市场设计

状态：已确认

日期：2026-09-22

目标分支：`dev`

## 1. 背景与目标

影策已经具备画布 Agent、Skills、子智能体、模型路由、媒体生成、任务系统和初版远程 MCP Client。下一阶段需要把电商、社交热点、影视资料、品牌审核、剧本和短剧生产能力组织成可安装、可治理、可复用的标准 MCP 能力，而不是继续要求部署者手写环境变量或为每个领域维护一套重复服务。

本设计建设一个模块化的领域 MCP Hub，并在影策中提供管理员统一安装的 MCP 能力市场。市场中的项目不是只有一个连接地址，而是由 MCP 工具、领域 Skill、画布 Recipe 和权限策略组成的能力包。

目标：

1. 让管理员从市场安装能力包、配置凭据、测试连接、发现工具并设置白名单。
2. 让普通用户在画布 Agent 中选择已安装能力，并一键产出结构化画布结果。
3. 用同一套实现同时服务影策内部调用和外部标准 MCP Client。
4. 复用影策既有模型路由、计费、图片/视频生成、审批、预算和画布写入能力。
5. 为小红书、抖音等易受登录与风控影响的数据源提供可替换的 Provider seam。
6. 保证外部事实可追溯、密钥不泄露、失败不被假数据掩盖。

## 2. 已确认的产品决策

1. 采用“独立标准 MCP Hub + 影策能力市场”，不建设九个重复部署的独立服务。
2. Hub 内部按能力包加载工具；只有安装并启用的能力包才向用户暴露。
3. 第一版小红书与抖音数据使用 AnySearch 公网检索，登录浏览器适配器留作第二阶段 Provider。
4. MCP 负责检索、证据归一化、领域分析合同和结构化产物；影策负责模型选择、计费、媒体生成和画布写入。
5. 第一版由管理员统一安装并配置凭据，普通用户只能选择管理员允许的能力。
6. `.env` 配置保留为部署引导和故障恢复入口，不作为正常产品交互。
7. 第一版不自动运行市场提供的 npm、Python、Docker 或 stdio 命令。

## 3. 方案比较

### 3.1 九个独立 MCP Server

每个领域单独部署，隔离直观，但会重复鉴权、镜像、日志、升级、协议适配和配置管理。用户还会面对九个连接，无法形成统一的画布产物合同。拒绝该方案。

### 3.2 单体 MCP 暴露全部工具

部署简单，但工具目录会持续膨胀，增加模型选错工具、权限误配和上下文浪费的概率。拒绝无模块启停的单体工具集合。

### 3.3 模块化 MCP Hub + 能力包市场

采用一个深模块承载协议、鉴权、错误、证据和产物合同，各领域以能力包注册工具。能力包可独立启停、版本化和设置白名单，并可按需向 Agent 暴露。该方案复用最多、运行面最小，确定为实施方案。

## 4. 总体架构

```text
MCP 能力市场
  ├─ 推荐能力包
  ├─ 已安装能力包
  └─ 自定义远程 MCP
            │
            ▼
管理员安装、凭据与工具策略
            │
            ▼
Domain MCP Hub
  ├─ Commerce Pack
  ├─ Social Pack
  ├─ Film Pack
  ├─ Brand Pack
  └─ Story Pack
            │
            ▼
Provider seam
  ├─ AnySearchAdapter（第一阶段）
  ├─ XiaohongshuBrowserAdapter（第二阶段）
  ├─ DouyinBrowserAdapter（第二阶段）
  ├─ TMDBAdapter（第二阶段）
  └─ 企业商品库及品牌资料 Provider（后续按需）
            │
            ▼
Artifact Bundle
  ├─ 报告与表格
  ├─ 图片提示词
  ├─ 详情页模块
  ├─ 剧本与分集
  └─ 画布 Recipe
            │
            ▼
画布 Agent 审批、预算、节点创建与媒体生成
```

### 4.1 一套实现，两种运行方式

核心实现位于 `backend/internal/domainmcp/`，同时提供：

1. 影策内置适配器：画布 Agent 直接调用模块，不经过自请求 HTTP。
2. 标准 MCP Endpoint：使用 Streamable HTTP，供 Codex、Claude、Cursor 等客户端调用。

独立入口位于 `backend/cmd/domain-mcp/`，可构建为 `ghcr.io/versior/open-ai-canvas-domain-mcp`。默认影策部署使用内置模式，不增加必需容器；需要对外提供 MCP 时才启用独立镜像或公开标准 Endpoint。

### 4.2 模块结构

```text
backend/internal/domainmcp/
├─ server.go
├─ catalog.go
├─ contracts.go
├─ errors.go
├─ evidence.go
├─ artifact_bundle.go
├─ providers/
│  └─ anysearch.go
└─ packs/
   ├─ commerce/
   ├─ social/
   ├─ film/
   ├─ brand/
   └─ story/
```

Provider seam：

```go
type SearchProvider interface {
    Search(context.Context, SearchQuery) ([]Evidence, error)
    Extract(context.Context, string) (ExtractedPage, error)
}
```

能力包 seam：

```go
type CapabilityPack interface {
    Manifest() PackManifest
    Register(ToolRegistry)
}
```

只有真实存在第二个实现的行为才进入 seam；纯粹的格式转换保持包内私有，避免浅层抽象。

## 5. 能力包目录

### 5.1 电商商品洞察

工具：

- `commerce.product_analyze`
- `commerce.competitor_compare`
- `commerce.selling_point_matrix`
- `commerce.audience_insights`

结果包括商品属性、目标人群、购买动机、购买阻力、竞品表达、功能/情绪/场景卖点、可验证主张与高风险夸张表达。商品自身信息与外部市场信息必须分栏，推测不得写成商品事实。

### 5.2 小红书热点

工具：

- `social.xhs_trends`
- `social.xhs_topic_clusters`
- `social.xhs_content_plan`
- `social.xhs_post_review`

结果包括热点聚类、用户痛点、内容角度、标题钩子、正文结构、关键词、图片页数和商业感审核。第一版结果必须标记为“公网检索信号”，不能宣称是平台官方热榜。

### 5.3 抖音趋势

工具：

- `social.douyin_trends`
- `social.douyin_hook_analysis`
- `social.douyin_content_plan`
- `social.douyin_video_review`

结果包括趋势主题、前三秒钩子、分段节奏、镜头、字幕、口播、商品植入、行动引导和评论互动。产物必须可转换为“脚本节点 → 镜头表 → 图片节点 → 视频节点”。

### 5.4 影视资料

工具：

- `film.reference_search`
- `film.title_research`
- `film.lookbook_research`
- `film.character_reference`
- `film.scene_reference`

参考卡包含名称、年份、类型、主创、摄影、灯光、色彩、构图、服化道、空间特点、可借鉴元素、不可直接复制的辨识性元素和来源链接。

### 5.5 品牌审核

工具：

- `brand.policy_compile`
- `brand.copy_compliance`
- `brand.visual_compliance`
- `brand.campaign_audit`

品牌规则被编译为必须项、禁止项、颜色、Logo 安全区、字体、语气、产品事实、禁用承诺和渠道差异。审核结果必须定位到具体图片或文案、具体规则、严重等级和修改建议。图片像素由调用方视觉模型检查，MCP 负责规则和审核结构。

### 5.6 电商主图

工具：

- `commerce.hero_image_plan`
- `commerce.hero_image_variants`
- `commerce.hero_image_review`

默认生成强卖点型、场景体验型和品牌质感型三套差异方案。每套包含构图、产品占比、背景、光线、文案区域、标题、画幅、生成提示词、禁止项和审核清单。

### 5.7 电商详情页

工具：

- `commerce.detail_page_plan`
- `commerce.detail_section_prompts`
- `commerce.detail_page_review`

默认模块顺序为首屏价值主张、痛点场景、核心卖点、功能证据、材质工艺、使用场景、尺寸参数、对比说明、信任信息和购买行动。每个模块包含目标、文案、视觉构图、提示词、产品图引用和移动端高度建议。

### 5.8 剧本开发

工具：

- `story.premise_develop`
- `story.character_arc`
- `story.script_develop`
- `story.script_review`
- `story.continuity_check`

结果包括核心命题、人物欲望、阻力、变化、情节节拍、场次表、正式剧本、连贯性问题、动机问题、台词重复和节奏问题。结构化 JSON 与阅读版文本必须来自同一规范化结果。

### 5.9 短剧与漫剧

工具：

- `story.short_drama_plan`
- `story.motion_comic_plan`
- `story.episode_outline`
- `story.episode_script`
- `story.storyboard_recipe`
- `story.episode_review`

短剧结果包括每集钩子、冲突升级、付费卡点、集尾悬念、场次数量、预计时长和镜头表。漫剧额外包含分格、对话框、旁白框、表情、姿态、景别、运镜模拟、动效层、配音和音效提示。

## 6. 输入与输出合同

每个工具使用领域明确的输入 Schema，不使用包含大量可选字段的万能参数。共享概念通过组合复用，但对模型展示的字段名称必须具体。

所有工具返回统一顶层结构：

```json
{
  "summary": "结论摘要",
  "findings": [
    {
      "title": "发现",
      "detail": "具体判断",
      "confidence": 0.86,
      "evidenceIds": ["source-1"]
    }
  ],
  "artifacts": [
    {
      "type": "canvas.text",
      "title": "商品分析报告",
      "content": {}
    }
  ],
  "sources": [
    {
      "id": "source-1",
      "title": "来源标题",
      "url": "https://example.com",
      "retrievedAt": "2026-09-22T00:00:00Z"
    }
  ],
  "warnings": [],
  "nextActions": []
}
```

合同规则：

1. 外部事实的 `findings` 必须引用 `evidenceIds`。
2. 热点结果必须包含检索时间、信号来源、可信度和建议使用周期。
3. 无证据时返回 `NO_EVIDENCE` 或警告，不允许用语言模型补造趋势。
4. Artifact 只描述产物，不直接产生画布副作用。
5. 输入、证据和结果都执行大小、数量、URL 和字符串边界校验。

## 7. Artifact Bundle 与画布写入

MCP 调用返回的 `artifacts` 先由后端按能力包 Schema 验证，并保存为当前 Agent Run 的临时 Artifact Bundle。Agent 收到的是摘要、产物数量和 `bundleId`，不需要复制大段 JSON。

新增画布工具：

```text
canvas_apply_artifact_bundle(bundleId)
```

该工具：

1. 读取本轮固定的 Bundle；
2. 生成确定性的节点、分组、连线和初始布局；
3. 进入现有画布写入审批；
4. 计入 Agent 步骤和生成预算；
5. 以一个操作组写入，支持整体撤销；
6. 写入失败时保留 Bundle，允许重试。

Bundle 不跨用户、画布或 Agent Run 使用，过期后自动清理。

## 8. MCP 市场体验

管理员页面包含三个标签：

- 推荐能力包
- 已安装
- 自定义连接

安装流程：

1. 查看能力包来源、工具、权限、版本和数据说明；
2. 选择匿名试用或输入凭据；
3. 后端测试连接；
4. 自动读取工具；
5. 管理员勾选工具白名单及审批策略；
6. 安装并启用；
7. 用户在画布 Agent 中选择能力，或从市场点击“安装并用于当前 Agent”。

自定义连接表单包含名称、说明、HTTPS Endpoint、认证方式、Header、超时、工具白名单和启用状态。第一阶段不接受可执行命令或 stdio 配置。

## 9. 存储与接口

第一阶段复用 `SystemSetting` 保存全局 MCP 市场设置，复用 `.settings-key` 加密连接凭据，复用 `AdminAuditEvent` 记录安装、修改、测试、启停和删除。无需新增数据库表。

设置值包含：

```json
{
  "schemaVersion": 1,
  "installedPacks": [],
  "connections": [],
  "toolPolicies": {},
  "encryptedCredentials": {}
}
```

管理员接口：

```text
GET    /admin/mcp/catalog
GET    /admin/mcp/installations
POST   /admin/mcp/installations
PATCH  /admin/mcp/installations/:id
DELETE /admin/mcp/installations/:id
POST   /admin/mcp/connections/test
POST   /admin/mcp/connections/:id/discover
```

用户接口继续使用：

```text
GET /agent/mcp/servers
```

用户响应只包含 ID、名称、说明、状态和允许工具。URL、Header、密钥、密文和内部错误不得返回。

## 10. 权限与安全

工具分为：

- `read_only`：允许管理员配置自动执行；
- `external_write`：每次审批；
- `canvas_write`：进入画布写入审批；
- `prohibited`：禁止执行。

第一阶段九个领域能力包全部是 `read_only`，实际媒体生成与画布写入由影策已有工具执行。

安全规则：

1. 官方精选能力包随代码版本发布，市场不能动态下载并执行代码。
2. Official MCP Registry 第一阶段仅作为发现和展示数据源。
3. Registry 描述、远程工具说明、网页正文和 MCP 输出全部视为不可信数据。
4. 自定义远程连接复用现有 SSRF、私网主机白名单、Header 限制、响应大小和超时策略。
5. 凭据只在后端解密和注入；前端只显示是否已配置。
6. 更新连接时空凭据表示保留，只有明确清除操作才能删除。
7. 日志、Agent 事件、诊断包和错误响应统一脱敏。
8. Artifact Bundle 必须通过已知 Schema，不能携带任意可执行指令。

## 11. 错误与降级

统一错误代码：

- `INPUT_INVALID`
- `NO_EVIDENCE`
- `UPSTREAM_AUTH`
- `UPSTREAM_QUOTA`
- `UPSTREAM_TIMEOUT`
- `PARTIAL_RESULT`
- `POLICY_BLOCKED`
- `OUTPUT_INVALID`

搜索结果部分失败时可以返回已有证据并附 `PARTIAL_RESULT`；认证、策略、Schema 和凭据错误必须终止。上游原始响应仅进入受控调试日志且经过脱敏，普通用户只看到稳定错误语义。

## 12. 部署与版本

默认影策部署将 Domain MCP 编译进现有后端，不增加必需服务。独立 MCP 模式构建额外镜像，并由 GitHub Actions 发布提交 SHA、`dev` 和正式版本标签。

能力包 Manifest 包含稳定 ID、显示名称、版本、工具列表、权限、Provider 需求、输出 Schema 版本和兼容的影策版本。安装记录固定 Manifest 版本，升级前重新执行连接和工具合同检查。

## 13. 验证方案

后端验证：

1. 每个工具输入与输出 Schema 单元测试；
2. AnySearch 假服务的搜索、提取、限额、认证和部分失败测试；
3. MCP `initialize → tools/list → tools/call` 合同测试；
4. 2026-07-28 与旧版协议兼容测试；
5. 凭据加密、保留、清除和接口脱敏测试；
6. SSRF、私网、恶意 Header、恶意网页指令和超大响应测试；
7. Artifact Bundle 隔离、过期、审批、应用、重试和撤销测试；
8. 管理员权限与审计事件测试。

前端验证：

1. 市场安装、连接测试、启停、更新和删除；
2. 密钥不回显与留空保留；
3. 工具发现、白名单和审批策略；
4. “安装并使用”自动选择能力；
5. 长工具列表滚动及窄窗口；
6. 亮色、暗色和键盘可访问性；
7. Artifact Bundle 批量落点与整体撤销。

交付门禁：

```text
gofmt
go test ./...
bun run typecheck
bun run lint
bun run test
bun run build
MCP 合同冒烟
AnySearch 真实只读联调
GitHub Actions 镜像构建
```

## 14. 分批实施

### 批次一：纵向闭环

- Domain MCP 核心与官方 Go SDK；
- 能力包 Catalog；
- AnySearch Provider；
- 管理员市场骨架；
- 凭据加密与连接测试；
- 电商商品洞察能力包；
- Artifact Bundle 和画布批量写入；
- 完整合同、安全和 UI 测试。

该批次必须证明“市场安装 → 工具调用 → 有证据结果 → Bundle → 画布节点”的完整链路。

### 批次二：电商生产

- 电商主图；
- 电商详情页；
- 品牌审核；
- 主图与详情页画布 Recipe。

### 批次三：内容趋势

- 小红书热点；
- 抖音趋势；
- 社交内容策划与审核；
- 公网检索信号质量标注。

### 批次四：影视叙事

- 影视资料；
- 剧本开发；
- 短剧与漫剧；
- 项目、章节、剧本、分镜和生成节点 Recipe。

### 第二阶段明确不进入第一轮交付的内容

- 小红书扫码登录与 Cookie Provider；
- 抖音账号登录与 Cookie Provider；
- 自动发布、评论、点赞或收藏；
- 普通用户私有 API Key；
- OAuth 和动态客户端注册；
- 市场自动运行本地 stdio 包；
- 未经审核的 Registry 项目自动执行。

## 15. 完成定义

第一阶段设计完成并不等同于全部九个能力包完成。整体功能只有在四个实施批次全部通过各自门禁后才算交付完成。任何缺失数据源、未实测路径或只通过静态断言的部分都必须在交付报告中单独列出，不能以降级结果冒充完整实现。
