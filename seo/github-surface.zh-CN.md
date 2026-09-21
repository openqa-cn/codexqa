# GitHub 展示面（About、Topics、社交预览）

GitHub Settings 无法进 git。定位一变，就在 `https://github.com/openqa-cn/codexqa` 按本表改。README 文案是可被抓取的兜底。

## About

- **Description（≤350 字）：** AI Coding 之后最大痛点是快速验证：缺陷、老功能影响、用例、变更图谱（接口/方法/链路）、架构、安全、需求符合度、测试数据。8 个本地 Skill，360° 覆盖测试验证阶段。适用 Cursor、Claude Code、Codex、OpenClaw。`npx skills add openqa-cn/codexqa`
- **Website：** [https://openqa.cn/](https://openqa.cn/)（不要把 About 指到 GitHub Pages）。
- **Releases：** 打开。推送版本 tag 或点 Publish Release 时，`.github/workflows/release-notes.yml` 会用 `.github/release-notes.md` 填正文，并始终带上 `https://openqa.cn/`。

## Topics（最多 20 个）

保留这些；超出上限时删掉更空的词：

`agent-skills` `agentskills` `cursor` `claude-code` `openai-codex` `code-review` `sast` `static-analysis` `testing` `test-automation` `manual-testing` `requirements` `root-cause-analysis` `code-analysis` `architecture` `qa` `llm` `developer-tools` `openclaw` `verification`

## 社交预览图

在 Settings → General → Social preview 上传 `docs/assets/previews/defect-report.png`（或 1280×640 裁切）。Alt 已说明这是缺陷 HTML 报告；不要用纯 Logo。

## README 约定

- H1 仍是 `CodexQA`。
- H1 下一行是「写得快 vs 立刻知道写得好不好」，并点明**完全本地执行、开箱安装即用**；紧跟测试验证阶段的 360° 维度（缺陷、回归、用例、图谱、架构、安全、需求、造数），再跟上可核对数字和截图。
- 首屏视觉是 skill HTML 报告截图；八个干活 skill 在 `docs/assets/previews/` 各有一份预览。
- **Documentation** 链 [openqa.cn](https://openqa.cn/)（可用 `utm_source=github&utm_medium=readme&utm_campaign=oss-seo`），GitHub 当源码仓。

## Releases

每条 GitHub Release 正文回答：用户现在能做什么、宿主/Agent 边界、文档 URL。不要把内部重构放开头（那些留在 `CHANGELOG.md` Internal）。
