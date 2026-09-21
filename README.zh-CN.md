<div align="center">

# codexqa

**写得快已经不够。CodeXQA 让你立刻知道写得好不好。**

AI Coding 之后，最大的痛点是**快速验证代码质量**：刚写的代码有没有 bug、会不会打到老功能、完整测试用例怎么建、变更知识图谱打了哪些接口 / 方法 / 调用链、架构有没有被破坏、有没有安全风险、是否满足业务需求、对应测试数据怎么尽快造出来。**codexqa 聚焦代码测试验证阶段**，用多维度 Skill 做 360° 覆盖，让你不但写得快，更能快速感知写得好不好，把开发闭环从「写完」走到「验完」。

Cursor · Claude Code · Codex · OpenClaw。本地优先，不用账号、不用网关、不用迁 QA 平台。

<p>
  <strong>8</strong> 个 skill &nbsp;·&nbsp;
  <strong>0</strong> 个账号 &nbsp;·&nbsp;
  <strong>7/7</strong> 盲测召回 &nbsp;·&nbsp;
  <strong>0</strong> 次诱饵误报 &nbsp;·&nbsp;
  <strong>10</strong> 种语言
</p>

<sub>可复现数字来自 <a href="examples/inventory-service/README.md">inventory-service</a>：7 个语义缺陷 + 4 个诱饵。召回 7/7、精确率 7/7、陷阱误报 0 — Composer，2026-09-08，<em>一次记录运行，不是多模型 benchmark</em>。Semgrep 种子规则 102 条 / 10 种语言。</sub>

GitHub 是 skill 源码；产品站：[openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=hero-zh)。

[![CI](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml)
[![Docs](https://img.shields.io/badge/docs-openqa.cn-111827)](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=badge-docs)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=release)](https://github.com/openqa-cn/codexqa/releases)
[![Last commit](https://img.shields.io/github/last-commit/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/commits)
[![Commit activity](https://img.shields.io/github/commit-activity/m/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/graphs/commit-activity)
[![Stars](https://img.shields.io/github/stars/openqa-cn/codexqa?style=flat)](https://github.com/openqa-cn/codexqa/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/codexqa)](LICENSE)

**[English](README.md) | 简体中文**

<a href="https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=nav-docs-zh"><strong>文档站</strong></a> ·
<a href="#快速开始"><strong>快速开始</strong></a> ·
<a href="#产物长什么样"><strong>报告样例</strong></a> ·
<a href="docs/GETTING_STARTED.zh-CN.md"><strong>安装说明</strong></a> ·
<a href="CHANGELOG.md"><strong>更新日志</strong></a>

</div>

<p align="center">
  <a href="docs/assets/previews/code-wiki.html"><img src="docs/assets/previews/code-wiki.png" alt="codexqa-code-wiki 为 inventory-service 生成的架构知识图谱 HTML 报告" width="100%"></a>
</p>
<p align="center"><sub>首屏：一份填好的 <code>codexqa-code-wiki</code> HTML 报告。下面八个 skill 各自产出可打开的页面，而不是一段聊天记录。</sub></p>

## 产物长什么样

每一格对应一个已发布 skill 的 HTML 报告。页面用的是仓库里的渲染器和预置样例数据，只说明产物形态，不是已记录的 Agent 成绩。

<table>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="codexqa-defect-analyzer HTML 扫描报告"></a>
<p align="center"><sub><b>codexqa-defect-analyzer</b> — P0–P3 扫描页</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/review-report.html"><img src="docs/assets/previews/review-report.png" alt="codexqa-code-reviewer 双语 REVIEW-REPORT.html"></a>
<p align="center"><sub><b>codexqa-code-reviewer</b> — 双语 REVIEW-REPORT.html</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/code-wiki.html"><img src="docs/assets/previews/code-wiki.png" alt="codexqa-code-wiki 架构 Wiki HTML 报告"></a>
<p align="center"><sub><b>codexqa-code-wiki</b> — 架构知识图谱</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/code-analyzer.html"><img src="docs/assets/previews/code-analyzer.png" alt="codexqa-code-analyzer 变更影响图"></a>
<p align="center"><sub><b>codexqa-code-analyzer</b> — 调用方、入口、测试缺口</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/rootcause.html"><img src="docs/assets/previews/rootcause.png" alt="codexqa-rootcause-analyzer 英文 RCA 报告"></a>
<p align="center"><sub><b>codexqa-rootcause-analyzer</b> — 带门禁的英文 RCA</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/ra-register.html"><img src="docs/assets/previews/ra-register.png" alt="codexqa-requirement-analyzer 缺口登记表"></a>
<p align="center"><sub><b>codexqa-requirement-analyzer</b> — 一份缺口/冲突登记表</sub></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/assets/previews/testcase-report.html"><img src="docs/assets/previews/testcase-report.png" alt="codexqa-testcase-generator 聚合 HTML 用例报告"></a>
<p align="center"><sub><b>codexqa-testcase-generator</b> — Web / 服务端 / APP 用例</sub></p>
</td>
<td width="50%" valign="top">
<a href="docs/assets/previews/testdata-writeback.html"><img src="docs/assets/previews/testdata-writeback.png" alt="codexqa-testdata-generator 后端 ID 回写"></a>
<p align="center"><sub><b>codexqa-testdata-generator</b> — 后端 ID 回写前置条件</sub></p>
</td>
</tr>
</table>

点表格里的 HTML 即可打开。重新出图见 [`docs/assets/previews/README.md`](docs/assets/previews/README.md)。<a id="证据与边界"></a><a id="evidence-and-limitations"></a>发现项仍需人工确认；本仓库 CI 不跑现场 `@openqa-cn/codexqa` 建索引。

<a id="快速开始"></a>

## 快速开始

**1. 安装**（只装路由即可，它能按需拉取干活 skill）：

```bash
npx skills add openqa-cn/codexqa --skill codexqa-skill-router
```

按提示选 Cursor、Claude Code、Codex 或 OpenClaw。不用登录 npm。

**2. 运行** — 新建 Agent 会话，粘贴：

```text
我不确定该用哪个 skill。请路由：对照 origin/main 审查这个仓库，
产出一份可以发给评审人的 HTML 报告。
```

也可以点名：`用 codexqa-defect-analyzer 审这个分支。需求：退款不得超过剩余可退余额。`

**3. 看报告** — Agent 把 HTML/Markdown 写到磁盘。对照上面的截图。

不需要模型的安装验收：

```bash
node examples/checkout-boundary/verify.mjs
```

<details>
<summary>按需安装某一个 skill · 代码图 CLI</summary>

```bash
npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-code-reviewer
npx skills add openqa-cn/codexqa --skill codexqa-code-wiki
npx skills add openqa-cn/codexqa --skill codexqa-code-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-rootcause-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-requirement-analyzer
npx skills add openqa-cn/codexqa --skill codexqa-testcase-generator
npx skills add openqa-cn/codexqa --skill codexqa-testdata-generator
```

Wiki、影响分析、RCA、图证据审查还需要 Node.js 18+ 和 `npm install -g @openqa-cn/codexqa`（闭源本地引擎，在你的机器上跑）。详见[安装入门](docs/GETTING_STARTED.zh-CN.md) · [FAQ](docs/FAQ.zh-CN.md)。

</details>

## 核心能力

| | Skill | 你得到什么 |
| --- | --- | --- |
| 🧭 | [`codexqa-skill-router`](skills/codexqa-skill-router/README.zh-CN.md) | 按请求匹配干活 skill，必要时按需安装 |
| 📋 | [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.zh-CN.md) | 从 PRD 得到一份带 P0/P1 的缺口与冲突登记表 |
| 🧪 | [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.zh-CN.md) | 本地 Markdown 方案 + 用例 + 聚合 HTML；未知标 TBD |
| 🗃️ | [`codexqa-testdata-generator`](skills/codexqa-testdata-generator/README.zh-CN.md) | 把后端真实 ID 回写进用例前置条件 |
| 🗺️ | [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.zh-CN.md) | 社区地图、真实依赖、阅读路径、Claude Code 风格 HTML |
| 📈 | [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.zh-CN.md) | 变更符号 → 调用方、入口、未覆盖边 |
| 🧯 | [`codexqa-rootcause-analyzer`](skills/codexqa-rootcause-analyzer/README.zh-CN.md) | 带门禁的英文 RCA：触发点 / 根因 / 置信度 |
| 🛡️ | [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.zh-CN.md) | SAST/lint/密钥 + Agent LLM Detection，P0–P3 HTML |
| ⚖️ | [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.zh-CN.md) | CodexQA 证据包 → 双语 `REVIEW-REPORT.html` |

输入契约窄、有停点、产物落本地。运行时就是你已经在用的 Agent。

## 适用场景

| | 谁 | 典型用法 |
| --- | --- | --- |
| 🏢 | **企业** | 验证工作跟 Coding Agent 走：影响面、SAST、CR 证据，不必把 QA 迁到另一套 SaaS |
| 👤 | **个人** | 在 Cursor/Codex 里一次 `npx skills add`，合并自己的 PR 前先打开 HTML |
| 🎓 | **教育** | 用 [inventory-service](examples/inventory-service/README.md) 教「可核查产物」（7 个埋点缺陷、4 个诱饵） |
| 🤖 | **AI 开发** | 给 Agent 的是 skill，不是超级 prompt：路由 → 干活 → 磁盘上的报告 |

不是托管测试云。也不替代你的测试套件、SAST 授权或维护者判断。

## Star 这个仓库

如果你要的就是这种本地 skill 包、而不是再上一套 QA 平台，给 [openqa-cn/codexqa](https://github.com/openqa-cn/codexqa/stargazers) 一颗星，能让后来的人更容易搜到。出了问题，Issue 和最小复现比星更有用。

## 更新日志

[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=latest)](https://github.com/openqa-cn/codexqa/releases)
[![Last commit](https://img.shields.io/github/last-commit/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/commits)
[![Commit activity](https://img.shields.io/github/commit-activity/m/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/graphs/commit-activity)

**Unreleased** — `codexqa-*` 命名；架构 Wiki；Agent LLM Detection / judgment；文档主站 [openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=changelog-zh)。

**0.2.0** — 首批五个已发布 skill、样例报告、inventory-service 7/7 盲测（一个模型、一次运行）。

全文：[CHANGELOG.md](CHANGELOG.md) · [Releases](https://github.com/openqa-cn/codexqa/releases)（Release 正文都带 openqa.cn）。

## 产品与文档

| 我想… | 去这里 |
| --- | --- |
| 打开产品站 | [openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=docs-home-zh) |
| 浏览 skills | [Skill Hub](https://openqa.cn/skills?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=docs-skills-zh) |
| 看商业产品 | [openqa.cn/agent](https://openqa.cn/agent?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=docs-product-zh) |
| 按步骤安装 | [安装入门](docs/GETTING_STARTED.zh-CN.md) · [支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md) |
| 理解结论怎么来的 | [工作原理](docs/HOW_IT_WORKS.zh-CN.md) |
| 复现盲测 | [inventory-service](examples/inventory-service/README.md) · [评估方法](benchmarks/README.md) |
| 报缺陷 | [Issues](https://github.com/openqa-cn/codexqa/issues) · [安全](SECURITY.md) |
| 提 PR | [贡献指南](CONTRIBUTING.md) · Apache-2.0 |

自然搜索运营（只指向 openqa.cn，不再另起文档站）：[`seo/`](seo/README.zh-CN.md)。
