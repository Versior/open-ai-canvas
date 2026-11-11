# 二开分支统一到 main

## 整合范围

- `feat/ecommerce-canvas` 已完整包含在 `main`，无需重复应用代码。
- `ci/auto` 与 `ci/stage-deploy` 的历史合入 `main`。
- `feat/agent-pet-styles` 保留独立，其独有提交不进入本次整合。
- 只处理远端现存分支；本地其他工作区和未提交修改不参与整合。

## 发布入口

`main` 作为二开默认分支，复用 `Publish container images` 的质量检查、三种镜像和双架构构建。旧自动同步脚本将 `main` 当作纯上游镜像并独立更新 `latest`，旧预览脚本绕过质量检查；这两份重复工作流退出主分支。

自动上游同步不再直接改写二开主分支或发布上游镜像。上游更新应合入 `main`，通过推送前检查及 GitHub CI 后发布。

手动预览在同一个发布工作流中选择 `main` 并勾选 `preview`，或执行：

```bash
gh workflow run publish-images.yml --ref main -f preview=true
```

预览仍须通过质量检查及完整架构构建，只更新 `stage-deploy` 和对应 SHA 标签。普通 `main` 推送沿用最新提交校验后更新 `latest`；正式版本标签沿用原有发布规则。预览不更新正式版本标签、不创建 GitHub Release，也不会部署服务器。

## 验证边界

交付前核对各来源分支的祖先关系、智能体独有提交隔离、提交身份和远端主分支；运行镜像推广专项、推送前完整检查，并确认 GitHub CI。实际服务器升级和手动预览镜像发布由管理员按部署需求执行。
