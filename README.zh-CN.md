<div align="center">

# codexqa

**写得快已经不够。CodeXQA 完全本地执行、开箱安装即用，立刻知道写得好不好。**

AI Coding 之后，最大的痛点是**快速验证代码质量**：刚写的代码有没有 bug、会不会打到老功能、完整测试用例怎么建、变更知识图谱打了哪些接口 / 方法 / 调用链、架构有没有被破坏、有没有安全风险、是否满足业务需求、对应测试数据怎么尽快造出来。**codexqa 聚焦代码测试验证阶段**，用多维度 Skill 做 360° 覆盖，让你不但写得快，更能快速感知写得好不好，把开发闭环从「写完」走到「验完」。

Cursor · Claude Code · Codex · OpenClaw。完全本地执行，开箱安装即用；不用账号、不用网关、不用迁 QA 平台。

<p>
  <strong>8</strong> 个 skill &nbsp;·&nbsp;
  <strong>0</strong> 个账号 &nbsp;·&nbsp;
  <strong>7/7</strong> 盲测召回 &nbsp;·&nbsp;
  <strong>0</strong> 次诱饵误报 &nbsp;·&nbsp;
  <strong>10</strong> 种语言
</p>

<sub>可复现数字来自 <a href="examples/inventory-service/README.md">inventory-service</a>：7 个语义缺陷 + 4 个诱饵。召回 7/7、精确率 7/7、陷阱误报 0 — Composer，2026-09-08，<em>一次记录运行，不是多模型 benchmark</em>。Semgrep 种子规则 102 条 / 10 种语言。</sub>

GitHub 是 skill 源码；产品站点：[openqa.cn](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=hero-zh)。

[![CI](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml)
[![Docs](https://img.shields.io/badge/docs-openqa.cn-111827)](https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=badge-docs)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=release)](https://github.com/openqa-cn/codexqa/releases)
[![Last commit](https://img.shields.io/github/last-commit/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/commits)
[![Commit activity](https://img.shields.io/github/commit-activity/m/openqa-cn/codexqa)](https://github.com/openqa-cn/codexqa/graphs/commit-activity)
[![Stars](https://img.shields.io/github/stars/openqa-cn/codexqa?style=flat)](https://github.com/openqa-cn/codexqa/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/codexqa)](LICENSE)

**[English](README.md) | 简体中文**

<a href="https://openqa.cn/?utm_source=github&utm_medium=readme&utm_campaign=oss-seo&utm_content=nav-docs-zh"><strong>产品站点</strong></a> ·
<a href="#快速开始"><strong>快速开始</strong></a> ·
<a href="#测试验证所有技能概览"><strong>技能概览</strong></a> ·
<a href="docs/GETTING_STARTED.zh-CN.md"><strong>安装说明</strong></a> ·
<a href="CHANGELOG.md"><strong>更新日志</strong></a>

</div>

<a id="产物长什么样"></a>

## 测试验证所有技能概览

下面每个 skill 先说它要帮你**验证什么**、**能做什么**，再配一份可打开的 HTML 报告。页面用的是仓库里的渲染器和预置样例数据，只说明产物形态，不是已记录的 Agent 成绩。

<table>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-defect-analyzer/README.zh-CN.md">codexqa-defect-analyzer</a></strong></p>
<p><strong>验证什么</strong> — 刚写完或刚合进来的代码，有没有 bug、有没有把密钥和危险写法带进来。人眼扫一遍不够。</p>
<p><strong>核心能力</strong> — 规则扫描（SAST / lint / 密钥）和 Agent 语义检测合并去重，按 P0–P3 出 HTML：位置、证据、建议一次看完。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="codexqa-defect-analyzer HTML 扫描报告"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-code-reviewer/README.zh-CN.md">codexqa-code-reviewer</a></strong></p>
<p><strong>验证什么</strong> — 这次改动能不能过评审、会不会误伤老功能。只看 git diff 往往看不到调用链和测试缺口。</p>
<p><strong>核心能力</strong> — 先用符号图收齐影响面和测试边，再按证据包做双语评审，落成可发给评审人的 <code>REVIEW-REPORT.html</code>。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/review-report.html"><img src="docs/assets/previews/review-report.png" alt="codexqa-code-reviewer 双语 REVIEW-REPORT.html"></a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-code-wiki/README.zh-CN.md">codexqa-code-wiki</a></strong></p>
<p><strong>验证什么</strong> — 仓库怎么分层、枢纽在哪、新人 / Agent 该从哪读起。没有地图时，「架构有没有被改坏」只能靠猜。</p>
<p><strong>核心能力</strong> — 本地建架构知识图谱：模块社区、真实依赖、阅读路径，写成可打开的 HTML，不是聊天里一段口头介绍。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/code-wiki.html"><img src="docs/assets/previews/code-wiki.png" alt="codexqa-code-wiki 架构 Wiki HTML 报告"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-code-analyzer/README.zh-CN.md">codexqa-code-analyzer</a></strong></p>
<p><strong>验证什么</strong> — 改了这几行，会打到哪些接口、方法、调用链；回归该测哪、哪些路径还没测试。</p>
<p><strong>核心能力</strong> — 对着本地符号图回答变更影响面：调用方、入口、未覆盖边。不是全文搜索猜一猜。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/code-analyzer.html"><img src="docs/assets/previews/code-analyzer.png" alt="codexqa-code-analyzer 变更影响图"></a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-rootcause-analyzer/README.zh-CN.md">codexqa-rootcause-analyzer</a></strong></p>
<p><strong>验证什么</strong> — 堆栈和日志对上仓库之后，异常到底卡在哪一层。抛错的那一行，经常不是根因。</p>
<p><strong>核心能力</strong> — 对照调用链产出带门禁的英文 RCA：触发点、根因、置信度分开写，并给出可验证的修复方向。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/rootcause.html"><img src="docs/assets/previews/rootcause.png" alt="codexqa-rootcause-analyzer 英文 RCA 报告"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-requirement-analyzer/README.zh-CN.md">codexqa-requirement-analyzer</a></strong></p>
<p><strong>验证什么</strong> — 需求本身写清楚了没有、能不能测、有没有缺口和互相打架的地方。代码还没写，坑可能已经在 PRD 里。</p>
<p><strong>核心能力</strong> — 从 PRD（或一包材料）整理出一份带 P0/P1 的缺口 / 冲突登记表；高优先级条目带可执行验证步骤。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/ra-register.html"><img src="docs/assets/previews/ra-register.png" alt="codexqa-requirement-analyzer 缺口登记表"></a></p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-testcase-generator/README.zh-CN.md">codexqa-testcase-generator</a></strong></p>
<p><strong>验证什么</strong> — 完整测试该覆盖哪些场景；Web / 服务端 / APP 的用例从哪来。需求没写清时，会不会被模型编出来。</p>
<p><strong>核心能力</strong> — 按需求在本地写出测试方案和用例，未知标 TBD；再聚合成可打开的 HTML。不连用例平台。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testcase-report.html"><img src="docs/assets/previews/testcase-report.png" alt="codexqa-testcase-generator 聚合 HTML 用例报告"></a></p>
</td>
<td width="50%" valign="top">
<p><strong><a href="skills/codexqa-testdata-generator/README.zh-CN.md">codexqa-testdata-generator</a></strong></p>
<p><strong>验证什么</strong> — 用例写好了，前置数据是不是真能在后端造出来。复制一个假 ID，过不了真实接口。</p>
<p><strong>核心能力</strong> — 对着真实后端构造数据，把返回的业务 ID 回写进用例前置条件。成功以后端给了 ID 为准。</p>
<p align="center"><a href="https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testdata-writeback.html"><img src="docs/assets/previews/testdata-writeback.png" alt="codexqa-testdata-generator 后端 ID 回写"></a></p>
</td>
</tr>
</table>

点截图会在浏览器里打开 HTML 报告，而不是 GitHub 源码页。重新出图见 [`docs/assets/previews/README.md`](docs/assets/previews/README.md)。<a id="证据与边界"></a><a id="evidence-and-limitations"></a>发现项仍需人工确认；本仓库 CI 不跑现场 `@openqa-cn/codexqa` 建索引。

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

**按需安装某一个 skill · 代码图 CLI**

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

## 核心能力

每个 skill 对应测试验证闭环里的一环。下表写清**什么时候用**，以及跑完之后你能拿到哪些**可打开、可核对**的结果——不是聊天里一段口头结论。

| | Skill | 什么时候用，以及验证环节你拿到什么 |
| --- | --- | --- |
| 🧭 | [`codexqa-skill-router`](skills/codexqa-skill-router/README.zh-CN.md) | **什么时候用** 不确定该走缺陷扫描、影响面、用例还是造数；或者干活 skill 还没装。<br>**验证结果** 按你的话匹配到对应 skill，没有就按需装上再交接。你不用自己记八套入口，验证工作从「选对工具」开始。 |
| 📋 | [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.zh-CN.md) | **什么时候用** 需求评审、提测前对 PRD / 故事 / 一包材料做完整性检查。代码还没写，先看需求能不能测、有没有打架。<br>**验证结果** 一份可指派的缺口与冲突登记表（P0/P1）。高优先级条目带前置、操作、期望和证据，标出需求层哪些地方会让后续测试做不下去。 |
| 🧪 | [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.zh-CN.md) | **什么时候用** 提测、补回归，或要把 Web / 服务端 / APP 从需求落到可执行用例。<br>**验证结果** 本地测试方案 + 用例 + 聚合 HTML：覆盖哪些场景、优先级怎么排。需求没写清的标 TBD，不会把空缺编成假用例。 |
| 🗃️ | [`codexqa-testdata-generator`](skills/codexqa-testdata-generator/README.zh-CN.md) | **什么时候用** 用例写好了但跑不起来，缺账号、商品、订单等前置数据；复制一个假 ID 过不了真实接口。<br>**验证结果** 对着后端造数，把返回的业务 ID 回写进用例前置条件。你拿到的是能真正打接口的物料，成功以后端给了 ID 为准。 |
| 🗺️ | [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.zh-CN.md) | **什么时候用** 新人上手、Agent 进仓、架构评审，或怀疑这次改动把分层改乱了。<br>**验证结果** 架构知识图谱 HTML：模块社区、真实依赖、枢纽、阅读路径。核对的是系统怎么分层、该从哪读、架构有没有被拆散，不是又一份 README。 |
| 📈 | [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.zh-CN.md) | **什么时候用** 评 PR、定回归范围、问「改这几行会打到谁」。只看 git diff 看不到调用链。<br>**验证结果** 变更影响面：命中哪些接口 / 方法 / 调用链、请求从哪进、哪些边还没测试。用来圈回归名单，而不是全文搜索猜。 |
| 🧯 | [`codexqa-rootcause-analyzer`](skills/codexqa-rootcause-analyzer/README.zh-CN.md) | **什么时候用** 线上或本地异常，堆栈和日志对回仓库后，仍说不清到底卡在哪一层。<br>**验证结果** 带门禁的英文 RCA：触发点、根因、置信度分开写，并给一条可验证的修复方向。避免把抛错的那一行当成根因。 |
| 🛡️ | [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.zh-CN.md) | **什么时候用** 合码前扫分支，或贴一段刚写的代码，问有没有 bug、密钥、危险写法。<br>**验证结果** P0–P3 HTML 扫描报告。规则扫描（SAST / lint / 密钥）和 Agent 语义检测合并去重：位置、证据、建议。关注缺陷和安全风险，不是评审意见书。 |
| ⚖️ | [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.zh-CN.md) | **什么时候用** 要发给评审人、过合并门禁，不能只丢一份 git diff。<br>**验证结果** 双语 `REVIEW-REPORT.html`。基于符号图证据包（调用链、影响面、测试边）给出能否合、风险点和测试缺口，适合当 CR 附件。 |

输入契约窄、有停点、产物落本地。运行时就是你已经在用的 Agent。

## 适用场景

| | 谁 | 典型用法：用什么、走哪些 skill、拿到什么 |
| --- | --- | --- |
| 🏢 | **企业** | **用什么** 现有的 Cursor / Claude Code / Codex / OpenClaw。一次 `npx skills add` 把验证接到 Coding Agent 旁边，不用账号、不用网关、不必把 QA 迁到另一套 SaaS。<br>**常用 skill** [`codexqa-skill-router`](skills/codexqa-skill-router/README.zh-CN.md) 按话路由；合 PR 走 [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.zh-CN.md) + [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.zh-CN.md) + [`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.zh-CN.md)；提测走 [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.zh-CN.md) → [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.zh-CN.md) → [`codexqa-testdata-generator`](skills/codexqa-testdata-generator/README.zh-CN.md)；架构评审用 [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.zh-CN.md)；线上异常用 [`codexqa-rootcause-analyzer`](skills/codexqa-rootcause-analyzer/README.zh-CN.md)。<br>**拿到什么** 变更影响面（接口 / 方法 / 调用链、回归名单、测试缺口）、P0–P3 缺陷与安全扫描 HTML、可发给评审人的双语 `REVIEW-REPORT.html`、需求缺口登记表、Web/服务端/APP 用例、后端真实 ID 前置数据、架构知识图谱、带门禁的 RCA。产物落本地，发现项仍需人工确认。 |
| 👤 | **个人** | **用什么** 自己的 Cursor 或 Codex 会话。装 [`codexqa-skill-router`](skills/codexqa-skill-router/README.zh-CN.md) 即可，需要时再拉干活 skill。<br>**常用 skill** 合自己的 PR 前：[`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.zh-CN.md) 扫 bug 和密钥，[`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.zh-CN.md) 看会打到谁，[`codexqa-code-reviewer`](skills/codexqa-code-reviewer/README.zh-CN.md) 出一份能打开的评审页。进陌生仓库用 [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.zh-CN.md)；自己写需求/用例再用生成器和造数。<br>**拿到什么** 打开就能看的 HTML：有没有明显缺陷、影响面清不清楚、评审意见能不能发出去。不用再上一套测试平台。 |
| 🎓 | **教育** | **用什么** 任意支持 Agent Skills 的 IDE，加上仓库里的 [inventory-service](examples/inventory-service/README.md) 样例（7 个语义缺陷、4 个诱饵，答案键可复现）。<br>**常用 skill** 用 [`codexqa-defect-analyzer`](skills/codexqa-defect-analyzer/README.zh-CN.md) 教「扫描报告长什么样、发现项怎么分级」；用 [`codexqa-code-wiki`](skills/codexqa-code-wiki/README.zh-CN.md) / [`codexqa-code-analyzer`](skills/codexqa-code-analyzer/README.zh-CN.md) 对照模块枢纽和变更调用链；用 [`codexqa-requirement-analyzer`](skills/codexqa-requirement-analyzer/README.zh-CN.md) 与 [`codexqa-testcase-generator`](skills/codexqa-testcase-generator/README.zh-CN.md) 教需求能不能测、用例从哪来。<br>**拿到什么** 可打开的报告和学生可以对照的答案键，讲的是「可核查产物」而不是聊天里一段评语。一次记录运行的召回数字见样例 README，不是多模型榜。 |
| 🤖 | **AI 开发** | **用什么** 你已经在跑的 Agent 运行时（Cursor · Claude Code · Codex · OpenClaw）+ Agent Skills 包，不是再写一个超级 prompt。<br>**常用 skill** [`codexqa-skill-router`](skills/codexqa-skill-router/README.zh-CN.md) 做入口，其余八个干活 skill 按契约交接：需求缺口、用例、造数、架构图谱、影响面、RCA、缺陷扫描、图证据评审。<br>**拿到什么** 磁盘上的 Markdown / HTML（登记表、用例、扫描页、`REVIEW-REPORT.html`、RCA），输入窄、有停点。把验证环节接进 Agent 产品时，交的是 skill 而不是一段不可复核的对话。 |

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
