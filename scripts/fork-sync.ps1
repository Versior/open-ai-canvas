# 影策二开：把上游更新同步进二开主线分支
#
# 流程：fetch upstream -> main 仅做 fast-forward -> 把 main 合并进 dev
# 用法：.\scripts\fork-sync.ps1
#
# 设计前提见仓库根目录 FORK.md：main 永远等于上游，二开只写在 dev。

[CmdletBinding()]
param(
    [string]$UpstreamRemote = 'upstream',
    [string]$MainBranch     = 'main',
    [string]$DevBranch      = 'dev'
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host "[fork-sync] $Message" -ForegroundColor Cyan
}

function Write-WarnLine([string]$Message) {
    Write-Host "[fork-sync] $Message" -ForegroundColor Yellow
}

function Stop-Sync([string]$Message) {
    Write-Host "[fork-sync] $Message" -ForegroundColor Red
    exit 1
}

# --- 环境检查 ---------------------------------------------------------------

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-Sync '当前目录不是 Git 仓库，请在本仓库根目录运行。'
}

if ((git remote) -notcontains $UpstreamRemote) {
    Stop-Sync "未找到远程 $UpstreamRemote。请先执行：git remote add $UpstreamRemote https://github.com/ddcat-ai/open-ai-canvas"
}

$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    Stop-Sync "工作区有未提交改动，请先提交或 stash 后重试：`n$dirty"
}

$untracked = @(git status --porcelain --untracked-files=all | Where-Object { $_ -like '?? *' })
if ($untracked.Count -gt 0) {
    Write-WarnLine "检测到 $($untracked.Count) 个未跟踪文件；若与上游新增文件同名，本次合并会失败。"
}

foreach ($branch in @($MainBranch, $DevBranch)) {
    git show-ref --verify --quiet "refs/heads/$branch"
    if ($LASTEXITCODE -ne 0) {
        Stop-Sync "本地缺少分支 $branch。"
    }
}

$startBranch = "$(git rev-parse --abbrev-ref HEAD)".Trim()
$devBefore   = "$(git rev-parse $DevBranch)".Trim()

# --- 拉取上游 ---------------------------------------------------------------

Write-Step "从 $UpstreamRemote 拉取更新..."
git fetch $UpstreamRemote --prune --tags
if ($LASTEXITCODE -ne 0) {
    Stop-Sync '拉取上游失败，请检查网络或远程地址。'
}

$upstreamHead = "$(git rev-parse "$UpstreamRemote/$MainBranch")".Trim()

# --- main 仅做 fast-forward -------------------------------------------------

Write-Step "更新 $MainBranch（仅 fast-forward）..."
git checkout $MainBranch --quiet
if ($LASTEXITCODE -ne 0) { Stop-Sync "切换到 $MainBranch 失败。" }

git merge --ff-only "$UpstreamRemote/$MainBranch"
if ($LASTEXITCODE -ne 0) {
    Stop-Sync "$MainBranch 无法 fast-forward 到 $UpstreamRemote/$MainBranch，说明 main 上有本地提交。请先把这些提交移到 $DevBranch 并让 main 回到上游状态。"
}

# --- 合并进二开主线 ---------------------------------------------------------

Write-Step "把 $MainBranch 合并进 $DevBranch..."
git checkout $DevBranch --quiet
if ($LASTEXITCODE -ne 0) { Stop-Sync "切换到 $DevBranch 失败。" }

git merge --no-edit $MainBranch
if ($LASTEXITCODE -ne 0) {
    $conflicts = git diff --name-only --diff-filter=U
    Write-WarnLine '合并出现冲突，需要手工解决：'
    foreach ($file in $conflicts) { Write-Host "  - $file" }
    Write-WarnLine '解决后执行：git add <file> && git commit'
    Write-WarnLine '放弃本次合并：git merge --abort'
    Write-Host '[fork-sync] 提示：rerere 已开启，同类冲突下次会自动复用本次解法。' -ForegroundColor Yellow
    exit 2
}

# --- 结果 -------------------------------------------------------------------

$devAfter = "$(git rev-parse $DevBranch)".Trim()

Write-Host ''
if ($devBefore -eq $devAfter) {
    Write-Step "上游无新提交，$DevBranch 未变化。"
} else {
    Write-Step "完成：上游 $($upstreamHead.Substring(0, 8)) 已合并进 $DevBranch。"
}
Write-Step "当前分支：$DevBranch（运行前：$startBranch）"
git log --oneline -1
