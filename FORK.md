# 二次开发与上游同步

本仓库是 [ddcat-ai/open-ai-canvas](https://github.com/ddcat-ai/open-ai-canvas)（影策）的二次开发版本。

**目标：二开改动不阻塞上游更新。** 本文说明如何保证这一点，以及改动应该写在哪里。

---

## 1. 分支与远程模型

| 远程 | 地址 | 用途 |
| --- | --- | --- |
| `upstream` | `github.com/ddcat-ai/open-ai-canvas` | 只读，拉取作者更新（push URL 已禁用） |
| `origin` | `github.com/Versior/open-ai-canvas`（你的 fork） | 二开提交与备份 |

| 分支 | 用途 | 纪律 |
| --- | --- | --- |
| `main` | 上游镜像 | **永不提交**，只允许 fast-forward 到 `upstream/main` |
| `dev` | 二开主线 | 全部二开改动提交在这里 |

**核心纪律：`main` 永远等于上游，二开只写在 `dev`。**

这样上游更新永远是干净的 fast-forward，冲突只可能出现在 `dev` 上——而 `dev` 是你的分支，随时可以丢弃重来，不会污染上游历史。

### 远程仓库

`origin` 已指向自己的 fork，`dev` 跟踪 `origin/dev`：

| 项 | 值 |
| --- | --- |
| `origin` | `github.com/Versior/open-ai-canvas`（你的 fork） |
| `upstream` | `github.com/ddcat-ai/open-ai-canvas`（push URL 已禁用） |

`main` 刻意**不**跟踪 `origin`，而是跟踪 `upstream/main`——这样在这个分支上误敲 `git push`，不会把东西推进上游镜像分支。

换机器时重建远程：

```powershell
git remote add upstream https://github.com/ddcat-ai/open-ai-canvas
git remote set-url --push upstream DISABLED
git remote add origin https://github.com/Versior/open-ai-canvas.git
```

> ⚠️ 该 fork 是 **public**。不要提交密钥、私有渠道信息或内部业务逻辑——`.env` 已被 `.gitignore` 忽略，但新增文件要自己确认。

---

## 2. 改动落点：先选层，再写代码

按改动类型选择落点。**层级越靠上，上游更新时冲突越少。**

| 层 | 适用改动 | 落点 | 上游冲突 |
| --- | --- | --- | --- |
| **L1 配置/数据** | 功能开关、密钥、部署参数、数据目录 | `.env`、`.local/`、`CANVAS_BACKEND_DATA_DIR` 指向的目录 | **零**（都不进 git） |
| **L2 插件包** | 新模型/协议渠道、支付渠道、工作流、技能、提示词 | `plugin-packages/<id>/` 新增目录，或运行时上传 `.yingce-plugin` | **零**（只新增文件） |
| **L3 源码** | 前端 UI 定制、后端核心逻辑 | `dev` 分支上直接改源码 | 需要处理冲突 |

**默认策略：能用 L2 就不要用 L3。** 本项目的插件系统就是官方开放的二开通道，渠道与协议类需求可以完全不改 Go / TS 源码。

### L2 的两条路

**a) 落仓库**（想跟代码一起版本管理）

在 `plugin-packages/` 下新建 `<id>/manifest.json`，然后打包：

```powershell
.\plugin-packages\package-selected.ps1 <id>     # 只打一个包
.\plugin-packages\build-packages.sh             # 全量打包
```

后端启动时扫描官方插件目录，自动加载 `*.yingce-plugin`，无需改任何 Go 代码。

**b) 落运行时**（私有渠道推荐，仓库零改动）

把 `.yingce-plugin` 通过管理端插件中心或 `POST /api/plugins` 上传。产物落在数据目录的 `plugin_packages/` + `plugin_registry.json`，仓库里一个字节都不改，上游更新完全不受影响。

`manifest.json` 范本：

- `plugin-packages/openai-chat-completions/` —— 文本 / 图片协议
- `plugin-packages/metaso-h3/` —— 异步视频协议（含轮询与响应映射）

Manifest 合同见 `docs/content/docs/plugins/plugin-system.mdx`。

---

## 3. 同步上游更新

```powershell
.\scripts\fork-sync.ps1
```

同步后可以把结果推回自己的 fork（默认不推送，避免多余的网络副作用）：

```powershell
.\scripts\fork-sync.ps1 -Push
```
脚本会检查工作区、拉取 `upstream`、把 `main` fast-forward、再把 `main` 合并进 `dev`。

手动等价流程：

```powershell
git fetch upstream --prune --tags
git checkout main
git merge --ff-only upstream/main
git checkout dev
git merge main
```

**冲突处理**：仓库已开启 `git rerere`，同一个冲突第二次出现时会自动复用上次的解法——手工解决一遍，以后同类冲突就是零成本。

**冲突时不要慌**：`git merge --abort` 回到合并前，重新评估这次上游更新是否要整体接受，或改为分次合并。

---

## 4. 冲突热点清单

下面这些文件是二开与上游的"接缝"，上游更新时冲突高发。改之前先问自己：**能不能改用 L2 插件包？**

| 文件 | 为什么是热点 |
| --- | --- |
| `web/src/lib/plugins/builtin/index.ts` | 前端内置插件的唯一注册入口，加插件必须加一行 import |
| `web/src/lib/plugins/official-applications.ts` | 官方应用型插件白名单 |
| `backend/internal/provider/registry.go`<br>`backend/internal/app/channel_model_catalog_plugin.go` | 老式 `provider.Register()` 路线（非插件包路线，与 `.yingce-plugin` 是两套机制） |
| `backend/internal/skills/seed/skills.json` | 内置技能是单文件 `go:embed`，加内置技能只能改它（运行时安装技能包则不用） |
| `backend/internal/prompts/*` | 内置提示词默认值与 agent 策略 md 编译进二进制 |
| `.env.example`、`docker-compose*.yml` | 新增部署参数与编排 |

### 接缝改动约定

改动上述文件时：

1. **一个提交只做这一件事**，提交信息里注明 `seam: <文件名>`，方便日后 `git log --grep=seam:` 快速定位所有接缝改动。
2. 尽量**只加不改**——新增一行注册、新增一个分支，不要重排既有代码。
3. 改完立刻在 `FORK.md` 本节补充备注，写明为什么必须动这个文件。

---

## 5. 日常约定

- **二开新代码优先新增文件、独立目录**，避免在上游文件里插入大段逻辑。
- **不要在 `dev` 上 rebase 上游**：长期分支重写历史会让冲突处理成本翻倍。用 `merge`。
- **每次同步后做最小验证**：

  ```powershell
  cd backend; go test ./...
  cd web; bun run build
  ```

- **不要用 `git pull` 拉上游**：`git pull` 的默认合并策略容易产生意料外的合并提交，统一走 `scripts/fork-sync.ps1`。

---

## 6. 回退

- 撤销一次同步：`git switch dev; git reset --hard ORIG_HEAD`（合并前的状态）
- 完全重来：`git switch main; git merge --ff-only upstream/main; git branch -f dev main`
- 恢复上游的某个文件：`git checkout upstream/main -- <path>`

`main` 分支始终是干净的上游镜像，所以**任何时候都可以从 `main` 重新拉出二开分支**，这是这套模型的兜底保障。
