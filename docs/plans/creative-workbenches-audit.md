# Fuck My Shit Mountain Audit Report

**Project:** STAGE · 视频复刻、室内设计、电商生图台
**Audit mode:** full（限定三个板块及其任务、资源、保存、交付边界）
**Date:** 2026-11-07
**Reviewer:** Boom / Codex

## 1. Executive Summary

三个板块已有可用的骨架：视频有程序切镜、模型拆解、复刻配方、逐段生成和合成；室内有效果图、知识库、结构化 3D 场景和版本项目；生图台有商品真值、策划、模板、异步出图、程序排字和详情交付。本次主要问题集中在网络中断后的任务身份、异步账号隔离、并发保存，以及结果交给剪辑师、设计师和商家时缺少可检查的交付文件。

本轮已经实现三个板块的交付补全，并修复确认的任务恢复和保存缺陷。室内新增与真实生成共用校验及模型路由的积分报价。前端继续协调流程，纯交付算法放在 lib，文件读取与导出留在页面副作用层，后端报价复用现有账务报价服务。本次没有新增数据库迁移、模型供应商、部署配置，也没有引入竞品代码或新依赖。

审查不是全仓逐行人工覆盖。按三个板块文件名扫描了约 150 个 TS/Go 文件、约 3.58 万行，人工沿入口、调用链、账号边界、任务状态和交付路径阅读，并结合回归测试与真实路由验收。静态计数只用于定位风险。模拟 API 验收不能证明真实模型画质、口型、商品一致性和室内尺寸准确；这些明确进入后续验收。

### Score Dashboard

评分针对本轮修复后的限定范围，10 分最好，属于有依据的工程判断。

| 维度 | 分数 | 依据 |
| --- | --- | --- |
| Security | 7.5 | 资源归属及功能权限复用后端校验，修复异步串账号；真实跨账号与部署渗透未覆盖 |
| Stability | 7.2 | 中断保留任务身份、保存冲突有三方合并；供应商长任务及端到端取消仍需实测 |
| Performance | 6.5 | 任务提交串行、并发限额、像素检查缩采样；大批量 ZIP 峰值内存未压测 |
| Testing | 7.3 | 真实 hook 状态回归、真实 ZIP 解包、Go 报价零财务写入；模型上游由 mock 隔离 |
| Maintainability | 6.4 | 模块已有纯函数边界；runner 与页面仍承载多种阶段和持久状态 |
| Design | 7.0 | 区分提交、查询、解析失败，写路径不静默兜底；多个 runner 的恢复规则尚未统一 |
| Release | 6.8 | 有推送门禁及已有升级链路；本轮未验证线上、支付双架构与全部供应商 |
| **Overall** | **7.0** | 具备可运行的开发闭环，正式效果验收仍需要真实模型样本 |

### Finding Statistics

统计包含本轮已修项，Confirmed 表示已有代码或行为证据，Suspected 表示仍需复现。不是“剩余漏洞数”。

| Severity | Count | Confirmed | Suspected |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High | 5 | 5 | 0 |
| Medium | 11 | 9 | 2 |
| Low | 0 | 0 | 0 |
| Info | 0 | 0 | 0 |
| **Total** | **16** | **14** | **2** |

## 2. Project Map

| 板块 | 页面与业务入口 | 持久化与外部边界 | 高风险路径 |
| --- | --- | --- | --- |
| 视频复刻 | `/video-replication`；replication-analysis、use-replication-runner；remake/remake-runner | 拆解 API、通用文本/视频任务、资源、product-video 作品、timeline 合成 | 查询失败误重提、取消丢编号、长任务、异步切账号 |
| 室内设计 | `/interior`；interior-composer、use-interior-project、interior-scene-studio | `/interior/generate`、`/interior/estimate`、项目 revision、场景 JSON 资源 | 同轮结果覆盖、未保存跳转、旧账号响应、模型报价 |
| 电商生图台 | `/studio`；use-studio-store、use-studio-runner、studio-results | 商品 revision、策划与图片任务、资源 Blob、排字/详情切片 | 保存队列、多实例调度、提交响应丢失、成品实测、历史导出 |

新增纯交付边界为 `lib/delivery-text.ts`、`lib/canvas/video-replication-delivery.ts`、`lib/interior/scene-delivery.ts`、`lib/ecommerce-studio/delivery-review.ts`。只共享确实相同的 CSV/SRT/转义能力；三个业务交付格式分别维护。

## 3. Top Risks

1. **F01 / High / 已修**：拆解旧任务查询失败时提交新计费任务。
2. **F02 / High / 已修**：复刻取消未确认时清除原任务编号。
3. **F03 / High / 已修**：室内异步请求可在切账号后回写页面状态。
4. **F04 / High / 已修**：生图保存队列醒来后可能读取新账号商品。
5. **F05 / High / 已修**：室内同轮次冲突合并丢失独立任务结果。
6. **F08 / Medium / 已修**：生图查询中断或提交响应丢失被当成可重新生成。
7. **F15 / Medium / Suspected**：真实模型的跨镜头、商品和空间一致性缺乏本轮实测。
8. **F16 / Medium / Suspected**：大批量媒体交付的内存峰值可能影响低内存设备。

## 4. Detailed Findings

### Finding F01: 拆解恢复把查询失败当成新提交理由

- Severity: High；Confidence: High；Category: Stability；Status: Confirmed，已修。
- Evidence: `web/src/pages/video-replication/replication-analysis.ts`，`analyzeVideoTeardown` 的旧任务恢复与解析重试分支；`creative-reliability.harness.tsx` 的 network offline 回归。
- Problem / failure: 已提交任务仍在运行，网络查询失败后重新分析，可能生成第二个收费任务。
- Minimal fix: 查询中断原样报错；只有确认终态失败才允许重新提交；自动纠正仅针对已拿到回复的结构解析失败。
- Long-term fix: 保存客户端操作编号和阶段事件，由服务端统一恢复。
- Regression: 原任务查询抛错，断言零新提交；本轮已通过。
- Effort: 本轮完成；统一恢复协议约 3–5 个开发日。

### Finding F02: 复刻重试及取消清除未确认任务

- Severity: High；Confidence: High；Category: Stability；Status: Confirmed，已修。
- Evidence: `remake/remake-runner.ts`，unitStep、voiceLineStep、retryRemake、stopRemake、redoRemakeUnit。
- Problem / failure: 查询超时或取消网络失败，后端仍执行；清 taskId、递增 attempt 后重做会重复计费。
- Minimal fix: 查询失败保留编号和 attempt；取消只有确认 failed/cancelled 才清编号；状态未确认时拒绝定向重做；已有合成任务先查询。视频等候上限匹配后端长任务。
- Long-term fix: 停止、恢复、重新生成拆成明确命令，由后端记录阶段幂等键。
- Regression: 重试只查 original-video-task；取消失败同时保留视频、配音、合成编号；取消确认后才清除。已通过。
- Effort: 本轮完成；真实供应商取消核验约 1–2 日。

### Finding F03: 室内旧账号响应覆盖新会话

- Severity: High；Confidence: High；Category: Security；Status: Confirmed，已修。
- Evidence: `use-interior-project.ts` 的 session、scope、导航代次与基线 refs；真实 React hook 的 A→B 延迟列表回归。
- Problem / failure: A 列表或保存尚未结束，切 B 后 A 响应写回 current/projects。
- Minimal fix: 切账号重置会话和队列；每个 await 收尾核对 scope/session；导航用请求代次约束。
- Long-term fix: 页面项目状态围绕 session/document revision 管理。
- Regression: B 已加载后才返回 A，B 项目不被替换。已通过。
- Effort: 本轮完成；跨浏览器真人账号验收仍需补。

### Finding F04: 生图排队保存跨账号取数

- Severity: High；Confidence: High；Category: Security；Status: Confirmed，已修。
- Evidence: `use-studio-store.ts`，persist 排队前捕获 session/scope、resetTracking、remove await 后核验。
- Problem / failure: A 同一商品有两次保存，第二次等第一条；切 B 后队列从当前 store 取出 B 商品并发请求。
- Minimal fix: 排队前捕获会话，醒来核验；切账号清跟踪；更新与删除检查 scope。
- Long-term fix: 保存队列显式携带 document/session/revision。
- Regression: A 保存挂起，A 第二次排队，切 B 并放入同 id 商品，释放 A；无 B 内容上传，B 状态不变。已通过。
- Effort: 本轮完成。

### Finding F05: 室内冲突以轮次整体覆盖结果

- Severity: High；Confidence: High；Category: Stability；Status: Confirmed，已修。
- Evidence: `interior-models.ts`，mergeInteriorDocuments；`interior-project-merge.test.ts`。
- Problem / failure: 两个窗口对同轮的不同 item 回填结果，最后保存者可能覆盖另一张；服务端删除也可能被旧本地条目复活。
- Minimal fix: 传已确认基线，字段三方合并；同轮 item 按 id 合并；已删条目不复活。
- Long-term fix: 后端逐 item 更新和版本事件，避免整个文档写入。
- Regression: 同轮独立结果、远端删除、显式 deletedIds 三项已通过。
- Effort: 本轮完成；细粒度更新约 3–5 日。

### Finding F06: 室内改名和删除其他项目影响未保存文档

- Severity: Medium；Confidence: High；Category: Stability；Status: Confirmed，已修。
- Evidence: `use-interior-project.ts`，rename、remove、ensureSaved；真实 hook 回归。
- Problem / failure: 改名绕开 dirty 保存；删除其他项目清除当前未保存状态后，导航失去保护。
- Minimal fix: 改名前 ensureSaved；保存失败拦下；异步期间保留最新文档；删除其他项目不清当前 dirty。
- Long-term fix: 项目命令统一经一个保存边界。
- Regression: 保存离线时 rename 不发新名称；删除另一项目后 open 仍被未保存保护拦下。已通过。
- Effort: 本轮完成。

### Finding F07: 生图实例卸载清掉全局待提交任务

- Severity: Medium；Confidence: High；Category: Stability；Status: Confirmed，已修。
- Evidence: `use-studio-runner.ts`，jobs.owner、ownedAttempts、effect cleanup。
- Problem / failure: 一个窗口或组件离开，另一实例的排队镜头一起消失。
- Minimal fix: 队列按 owner 标记，卸载只移除自己尚未提交的任务。
- Long-term fix: 调度器独立于组件生命周期，按用户 session 维护。
- Regression: 并发限额 1，A 提交挂起、B 排队，卸载 A 后 B 仍提交并完成。已通过。
- Effort: 本轮完成。

### Finding F08: 生图中断后重复任务或误释放并发

- Severity: Medium；Confidence: High；Category: Stability；Status: Confirmed，已修。
- Evidence: `use-studio-runner.ts`，uncertain、serializeSubmit、watch、resume；`studio-results.tsx` 的重新查询入口。
- Problem / failure: 图片后台仍跑，查询失败被标失败；响应丢失时新 attempt 产生新请求；旧后台任务占额却继续放出新提交。
- Minimal fix: 暂时失败保留 taskId/活动状态；响应丢失使用同一 clientOperationId；uncertain 保留并发席位；提交前重新检查账号与取消状态。
- Long-term fix: 服务端按 operationId 查询回执，调度器以服务端活跃任务数校准。
- Regression: 查询中断接回原结果；提交响应丢失两次编号完全相同。已通过。
- Effort: 本轮完成；全供应商故障注入约 2–3 日。

### Finding F09: 室内生成前缺少实际模型积分预估

- Severity: Medium；Confidence: High；Category: Design；Status: Confirmed，已补全。
- Evidence: `interior_generate.go`，prepareInteriorGeneration、EstimateInterior；`handler/interior.go`；`use-interior-estimate.ts`。
- Problem / failure: 多风格、多张图的生成成本只能生成后知道；客户端自己乘单价无法处理逻辑模型路由与参考图计价。
- Minimal fix: 共用校验与实际 input，每风格走现有渠道/逻辑模型 Quote 汇总；不创建任务、不预留余额；前端取消过时报价，失败明确显示。
- Long-term fix: 套图/逐镜同样引入服务端工作流报价。
- Regression: 两风格×两图，按请求计价只收两次；断言任务、账单、余额预留零写入。已通过。
- Effort: 本轮完成。

### Finding F10: 视频拆解不能一次交给剪辑师

- Severity: Medium；Confidence: High；Category: Design；Status: Confirmed，已补全。
- Evidence: 新 `video-replication-delivery.ts` 与 `replication-delivery.ts`，真实页面“剪辑交付包”。
- Problem / failure: 报告、原片帧、删镜后的时序与口播需要人工拼装。
- Minimal fix: ZIP 导出逐镜 CSV、口播 SRT、拆解 Markdown、方案 JSON、全部原片关键帧；删镜后方案时间连续，保留原片 timecode。
- Long-term fix: 可编辑时间线和镜头效果评估；不重复已有成片及剪映导出。
- Regression: 真实 ZIP 解包确认删镜时间和字幕；缺帧报错不出残包。已通过。
- Effort: 本轮完成。

### Finding F11: 室内 3D 方案缺少尺寸清单与可编辑平面交付

- Severity: Medium；Confidence: High；Category: Design；Status: Confirmed，已补全。
- Evidence: `lib/interior/scene-delivery.ts`、`interior-scene-delivery.tsx`。
- Problem / failure: 仅 GLB/JSON 难核对房间面积、家具数量和布局冲突。
- Minimal fix: 方案 JSON、房间面积、家具清单、检查结果及每层 SVG 草图；房间矩形并集减柱子，检查重叠/入口/家具规格。
- Long-term fix: 现场尺寸锚点、门窗/家具轮廓、通行检查，再考虑 CAD。
- Regression: L 形并集、柱子扣减、家具数、SVG XML 转义及真实 ZIP 解包。已通过。
- Effort: 本轮完成。草图不是 CAD/施工图，不含门窗家具轮廓；重叠房间面积仍分别列出。

### Finding F12: 生图交付没有实测图片与完整性结果

- Severity: Medium；Confidence: High；Category: Design；Status: Confirmed，已补全。
- Evidence: `delivery-review.ts`、`studio-delivery-review.ts`、studio-delivery 的 manifest。
- Problem / failure: 模型声称尺寸不等于实际文件；部分成功 ZIP 容易被误认为整套完成。
- Minimal fix: 解码实际 Blob 测宽高、字节、边缘白色比例；检查缺图、画幅及未经确认的卖点；导出检查 TXT/JSON，manifest 标 complete 与 missingShots。
- Long-term fix: OCR、产品外观比较、区域分割加人工签收；规则应有官方来源、版本和适用范围。
- Regression: 透明边缘不能算白，缺图/尺寸/文案提醒；真实页面下载包 complete=false。已通过。
- Effort: 本轮完成；视觉质量评估需要额外样本与模型。

### Finding F13: 检查报告过期和历史排字随当前风格变化

- Severity: Medium；Confidence: High；Category: Frontend State；Status: Confirmed，已修。
- Evidence: studio-results 的 review signature；StudioRun.styleId、createStudioRun、normalizeRun、composeStudioShots。
- Problem / failure: 换成品/卖点后仍显示旧检查；改商品风格后，历史记录再导出用新墨色。
- Minimal fix: 检查绑定数据签名；新生成记录固化排字 styleId，保存读回保留；切账号/卸载中止导出收尾。
- Long-term fix: 完整生成输入、提示词版本与排字模板快照。旧记录缺少当时 styleId，不能凭空重建，仍使用现有回退。
- Regression: 新记录改商品风格后，JSON 往返仍保留旧 styleId。已通过。
- Effort: 本轮完成；完整快照约 2–4 日。

### Finding F14: 室内交付面板被 3D 画布遮挡

- Severity: Medium；Confidence: High；Category: Frontend State；Status: Confirmed，已修。
- Evidence: 真实 `/interior` 展开方案包时的截图；interior.css 的 itd-scene-body 原有三行 grid 与新增第四个子项。
- Problem / failure: 展开清单增加内容，画布最小高度撑出 grid 计算区，遮挡标题及部分交付内容。
- Minimal fix: 四行布局、画布最小高度、纵向滚动；实际页面复核。
- Long-term fix: 3D 区与详情区独立缩放，移动端改成可折叠工作区。
- Regression: 明暗主题展开/滚动，画布与 metadata、details 不重叠。
- Effort: 本轮完成。

### Finding F15: 真实模型效果一致性尚缺本轮证据

- Severity: Medium；Confidence: Medium；Category: Testing；Status: Suspected，待真实模型验收。
- Evidence: 本轮模拟 API 与现有 prompt/约束；没有真实视频、室内图片、商品套图的本轮模型输出。
- Problem / failure: 多镜商品颜色漂移、视频动作边界跳变、室内墙体/尺寸漂移可能逃过逻辑测试。当前不能声称这些已发生或已解决。
- Minimal fix: 按开发方案建立授权测试样本，每例记录 input、任务 id、输出和人工评分。
- Long-term fix: 指标门禁与候选重做闭环。
- Regression: 见开发方案各板块的真实样本矩阵。
- Effort: 每板块首轮约 2–3 日，另计模型费用。

### Finding F16: 大批量 ZIP 的峰值内存未经压测

- Severity: Medium；Confidence: Medium；Category: Performance；Status: Suspected，待压测。
- Evidence: composeStudioShots/inspectStudioDelivery/exportStudioZip 同时持有多个 Blob/URL，createZip 在浏览器打包。
- Problem / failure: 多张 4K 图片或长视频关键帧可能使低内存设备卡顿；没有测量证据，不能报确定内存泄漏。
- Minimal fix: 本轮已有取消失败不返回残包、异常释放 URL；补分档压测并记录峰值。
- Long-term fix: 达到实测阈值后采用分包或流式交付；先测再增加服务端导出系统。
- Regression: 5/12/30 张 1K/4K，检查耗时、内存、取消释放及完整性。
- Effort: 压测约 1 日，优化依结果决定。

## 5. Security Concerns

本轮重点为 F03/F04 与 runner 的账号边界，不是全站安全审计。报价复用生成资源归属、模式权限和功能开关，不接受客户端自报积分。CSV 对公式起始字符加保护，SVG 内容做 XML 转义。无真实凭据、数据库或用户素材进入提交。

## 6. Stability Concerns

提交失败、查询失败、解析失败不再走同一重试路线。未确认任务保留身份，终态失败才进入新生成。服务端保存失败仍展示未保存状态。取消 API 成功并不保证供应商立即终止；界面以服务端任务状态为依据，供应商财务结算仍待真实联调。

## 7. Performance Concerns

检查像素缩至最长 256，不信任模型元数据；生图实际任务并行，提交串行。新增导出未引入依赖。F16 保留为 Suspected，不凭静态代码估计 MB 数。Three.Clock、PCFSoftShadowMap 的既有弃用提示列入后续版本维护，不为本次交付顺手升级。

## 8. Testing Gaps

新增回归用真实 hook/runner 状态和 ZIP 算法；模型请求被 mock，测的是任务身份与数据行为。后端报价走内存数据库和真实报价服务，断言没有财务写入。真实页面用隔离 HTTP fixture、真实 React 路由与图片解码，并下载 ZIP 解包。未覆盖实际供应商、多用户真实会话、Firefox/Safari、PostgreSQL/Redis 专属路径及线上部署。

## 9. Maintainability Concerns

F01/F02/F08 表明多个 runner 各自实现恢复语义；F03/F04/F05 表明会话与保存冲突散落在 hook。此次直接修危险边界，交付纯算法隔离于 UI，没有一次性把业务重写。结构性后续见 [开发方案](creative-workbenches-development.md)，以明确状态机与可恢复阶段记录逐步收敛。

## 10. Principles Compliance

### Principles Violated

| Principle | Violations | Severity | Affected Areas |
| --- | --- | --- | --- |
| Fail-Fast / 错误语义 | 3 组 F01/F02/F08 | High/Medium | 视频与生图恢复，已修危险行为 |
| 会话/写边界 | 3 组 F03/F04/F06 | High/Medium | 室内与生图保存，已修 |
| SRP / 阶段协调 | 未机械计数 | Medium | 多阶段 runner，后续分离 |
| 状态一致性 | F05/F07/F13 | High/Medium | 合并、队列、交付快照，已修 |

### Principles Respected

保留 HTTP/service/lib 边界；后端复用模型报价而不是客户端猜单价；交付文件缺资源明确失败；无相关性不足的重构、依赖更新或新配置。

## 10a. Fallback / Defensive Code Analysis

| Subtype | 已人工确认的组数 | KeepWithAlert | FailFast | Remove |
| --- | --- | --- | --- | --- |
| SilentFallback | 3（F01/F02/F08） | 2（保留任务并提示） | 1（查询直接失败） | 0 |
| EmptyCatch | 1（取消吞错） | 1（保留未确认编号） | 0 | 0 |
| CompatibilityBranch | 0 | 0 | 0 | 0 |
| SilentCorrection | 0 | 0 | 0 | 0 |
| DefensiveGuess | 0 | 0 | 0 | 0 |

这是已人工核实的组数，不是整个目录所有 catch 的数量。历史记录没有 styleId 的回退不能恢复当时视觉，不将其宣称为完全可复现。

## 10b. Testing Authenticity Analysis

| Test Area | Real Confidence | Risk | Action |
| --- | --- | --- | --- |
| creative-reliability hook/runner 回归 | High（状态行为），Low（模型效果） | mock 上游不能证明模型协议可用 | Keep，补真实模型样本 |
| creative-delivery ZIP 解包、CSV/SRT、面积/像素 | High（纯算法） | 不等于全部浏览器画布行为 | Keep，真实路由补充 |
| interior-project-merge | High | 跨客户端真实 revision 冲突仍需集成 | Keep |
| interior_estimate Go | High（报价/零写入） | 新价格/逻辑路由有更多计价规则 | Keep，扩模型矩阵 |
| 模拟 HTTP 页面下载 | Medium | 固定 fixture 无真实权限或付费调用 | Keep，明确标注边界 |

有价值的测试检查用户可见结果与任务编号，没有对新 helper 的内部调用顺序做镜像断言。尚缺模型画质和大媒体性能证据。

## 10c. Type Safety Analysis

本轮类型检查覆盖新入参与调用方。pending 缓存损坏条目先规范化，不能凭断言认为旧 JSON 完整。新增报价 OpenAPI 引用共同 schema。未把静态 as/TODO 计数当成安全缺陷，也未对全目录类型断言逐条作结论。

## 10d. Frontend State Analysis

| Subtype | 已确认问题组 | Affected Components |
| --- | --- | --- |
| RequestState | 7（F01/F02/F03/F04/F06/F07/F08） | 多阶段 runner 与项目 hook |
| StateDuplication / 合并 | 2（F05/F13） | project document、delivery review |
| RenderPerf | 1 Suspected（F16） | 媒体交付 |
| UIBusinessCoupling | 未作为独立缺陷计数 | runner 阶段和 UI 收尾仍待拆分 |

不因为文件长就重写；状态复杂度应先由明确的任务阶段、会话和保存基线降低。

## 10e. Backend API Analysis

新 `/interior/estimate` 走登录、功能开关、限流、no-store；共用生成请求 schema，资源归属及模式限制在 app 校验。handler 不复制模型计价。无任务、账务写入和迁移；只给预估，实际结算仍由通用任务完成。

## 10f. Dependency Weight Analysis

| Dependency | Status | Used For | Recommended Action |
| --- | --- | --- | --- |
| React / Three / existing canvas stack | 本轮未做依赖健康评级 | 真实 UI、3D 与排字 | 保留；弃用 API另做版本维护 |
| 现有 ZIP 实现 | 本轮复用 | 三类交付包 | 实测大文件峰值后决定分包 |
| 竞品与开源参考 | 只研究，未安装 | 能力与产品闭环比较 | 无代码拷贝，不增加许可或供应链面 |

未测量 bundle 与 transitive 体积，不填写猜测值。

## 11. Recommended Fix Order

### Fix Immediately

F01–F08 的任务身份、取消、账号与保存问题已处理；以专项回归和最终门禁为交付条件。

### Fix Before Stable Release

F15 的真实模型样本、供应商取消/恢复、Safari/Firefox、多个真实账号冲突；完善真实付费模型验收矩阵。

### Schedule Later

可编辑切镜、空间尺寸锚点/动线、商品外观/OCR、完整输入快照；先完成效果证据再做规模化功能。

### Ignore for Now

不凭“长文件”删除功能；不为 SVG 草图虚造施工精度；不为未知大文件瓶颈先建远程导出服务。

## 12. Quick Wins

本轮已落地：剪辑交付包、室内报价与方案包、生图实测检查、残缺 manifest、排字 styleId 固化、检查过期失效、3D 面板滚动修复。产品说明与 pending-test 同步。

## 13. Long-term Refactor Plan

1. **可恢复任务阶段**：先以视频复刻记录 stage、operationId、taskId、已确认状态和更新时间，再迁移生图；风险是旧任务身份丢失，需中断/响应丢失/账号切换/终态测试。
2. **项目写边界**：室内用已确认基线加本地操作，后续改逐 item revision；风险是远端删除与本地编辑冲突，需真实双客户端测试。
3. **生成与交付快照**：逐步记录 prompt/schema/template版本、资源引用及排字配置，不储存凭据；先覆盖新记录，旧记录明确无法恢复的字段。
4. **质量反馈闭环**：候选→自动检查→人工确认→定向重做→交付；指标和报价失败必须可见，禁止把视觉审查结果当成模型真实性保证。

参考研究、分板块需求、验收矩阵与开发顺序见 [三板块开发方案](creative-workbenches-development.md)。
