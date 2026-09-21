# GitHub 展示面（About、Topics、社交预览）

GitHub Settings 无法进 git。定位一变，就在 `https://github.com/openqa-cn/codexqa` 按本表改。README 文案是可被抓取的兜底。

## About

- **Description（≤350 字）：** 本地优先的 AI 验证 Agent Skills：需求评审、测试设计、测试数据、架构 Wiki、变更影响、异常根因、SAST/代码风险扫描、图证据审查。适用 Cursor、Claude Code、Codex、OpenClaw。`npx skills add openqa-cn/codexqa`
- **Website：** [https://openqa.cn/](https://openqa.cn/)（不要把 About 指到 GitHub Pages）。
- **Releases：** 打开。推送版本 tag 或点 Publish Release 时，`.github/workflows/release-notes.yml` 会用 `.github/release-notes.md` 填正文，并始终带上 `https://openqa.cn/`。

## Topics（最多 20 个）

保留这些；超出上限时删掉更空的词：

`agent-skills` `agentskills` `cursor` `claude-code` `openai-codex` `code-review` `sast` `static-analysis` `testing` `test-automation` `manual-testing` `requirements` `root-cause-analysis` `code-analysis` `architecture` `qa` `llm` `developer-tools` `openclaw` `verification`

## 社交预览图

在 Settings → General → Social preview 上传 `docs/assets/previews/defect-report.png`（或 1280×640 裁切）。Alt 已说明这是缺陷 HTML 报告；不要用纯 Logo。

## README 约定

- H1 仍是 `codexqa`。
- H1 下一行先写品类（Agent Skills、本地优先验证），再列九个 skill。
- **Documentation** 链 [openqa.cn](https://openqa.cn/)，GitHub 当源码仓。

## Releases

每条 GitHub Release 正文回答：用户现在能做什么、宿主/Agent 边界、文档 URL。不要把内部重构放开头（那些留在 `CHANGELOG.md` Internal）。
