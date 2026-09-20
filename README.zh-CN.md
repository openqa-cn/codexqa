<div align="center">

# codexqa

**七个本地优先的 Agent Skills，覆盖需求、测试设计、测试数据、架构 Wiki、变更影响、需求缺陷和代码审查。**

[![CI](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/codexqa/actions/workflows/repo-check.yml)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/codexqa?label=release&style=flat)](https://github.com/openqa-cn/codexqa/releases)
[![GitHub stars](https://img.shields.io/github/stars/openqa-cn/codexqa?style=flat)](https://github.com/openqa-cn/codexqa/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/codexqa)](LICENSE)

**[English](README.md) | 简体中文**

<a href="#quick-start"><strong>快速开始</strong></a> ·
<a href="docs/assets/previews/defect-report.html"><strong>报告样例</strong></a> ·
<a href="docs/HOW_IT_WORKS.zh-CN.md"><strong>工作原理</strong></a> ·
<a href="examples/inventory-service/README.md"><strong>盲测评估</strong></a> ·
<a href="#evidence-and-limitations"><strong>证据与边界</strong></a> ·
<a href="docs/GETTING_STARTED.zh-CN.md"><strong>安装入门</strong></a> ·
<a href="docs/FAQ.zh-CN.md"><strong>FAQ</strong></a> ·
<a href="docs/SUPPORT_MATRIX.zh-CN.md"><strong>支持矩阵</strong></a>

</div>

<p align="center">
  <a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="缺陷检测 HTML 报告：三条和需求对不上的发现" width="100%"></a>
</p>

<p align="center">
  <sub><em>Coding Agent 负责写出变更；codexqa 让意图、影响面、审查证据、用例和测试数据都能核查。<br>（上图是七类产物之一：使用同一渲染器和预置发现项的 defect-detection 样例页。）</em></sub>
</p>

---

AI 能很快产出一个绿 PR，但需求是否对齐、影响了谁、审查证据是否够、测试能否运行，仍然需要逐项确认。codexqa 把这些验证工作拆成七个 Agent Skills。

`codexqa` 是面向 [Cursor](https://cursor.com)、[Claude Code](https://claude.com/claude-code)、[Codex](https://openai.com/codex) 和 OpenClaw 的公开、本地优先 [Agent Skills](https://agentskills.io/specification) 包。用 `npx skills add` 只安装当前任务需要的工作流；不用 codexqa 账号、网关，也不用迁移现有平台。

## 七个 skill 如何配合

| 阶段 | Skill | 它回答什么问题 | 可核查产物 |
| --- | --- | --- | --- |
| 需求评审 | [`requirements-analyzer`](skills/requirements-analyzer/README.zh-CN.md) | PRD 是否完整、一致、可测试？ | 一份带 P0 / P1 验证项的缺口/冲突登记表 |
| 测试设计 | [`testcase-generation`](skills/testcase-generation/README.zh-CN.md) | 根据 PRD 和设计应该测什么？ | 结构化手工用例库；未知信息标出，不编造 |
| 测试数据 | [`testdata-generation`](skills/testdata-generation/README.zh-CN.md) | 哪些真实 ID 和前置条件能让用例跑起来？ | 后端实际返回值回写到用例前置条件 |
| 架构 Wiki | [`code-wiki`](skills/code-wiki/README.zh-CN.md) | 仓库怎么分层、枢纽模块是谁、新人从哪读起？ | 社区地图、真实依赖、阅读导览和 Claude Code 风格 HTML 报告 |
| 变更影响 | [`code-analyzer`](skills/code-analyzer/README.zh-CN.md) | 改了什么、谁在调用、影响哪些入口、哪里没测试？ | 符号图证据、回归范围、测试缺口和关系图 |
| 需求缺陷 | [`defect-detection`](skills/defect-detection/README.zh-CN.md) | 变更实现是否违反需求或用例？ | 通过写回门禁的结构化疑似缺陷 |
| 代码审查 | [`code-reviewer`](skills/code-reviewer/README.zh-CN.md) | 这次 diff 有哪些具体质量、安全或可维护性问题？ | 带文件:行号、影响和改法的 P0 / P1 / P2 发现 |

这些 Skill 的输入不同，这是设计选择。Agent 能明确判断这次该读文档、索引本地 checkout、克隆分支、写用例，还是调用造数后端。

## 为什么用 codexqa？

- `defect-detection` 对照需求和用例检查变更代码；这类偏差通常不能只靠静态规则发现。
- `code-analyzer` 用本地符号图把变更符号追到调用方、入口和图关系测试。
- `code-wiki` 把同一张图导出成社区和真实 `deps`，再写出架构知识图谱报告，全程不调模型。
- 文档与测试类 Skill 把需求评审、用例设计和测试数据构造分开，不让一次 prompt 包办所有事情。
- 每个 Skill 都有明确的输入契约、证据格式和停点。它们装进你已经在用的 Agent，发现项仍然交给人确认。

## 选对代码工作流

四个面向代码的 skill 会接触同一个仓库，但回答的问题不同：

| Skill | 核心问题 | 输入 | 它不替代什么 |
| --- | --- | --- | --- |
| [`code-wiki`](skills/code-wiki/README.zh-CN.md) | 系统怎么组织、新人从哪读起？ | 本地仓库（建索引 + `wiki inputs`） | 变更影响、需求缺陷或 P0 / P1 / P2 审查 |
| [`code-analyzer`](skills/code-analyzer/README.zh-CN.md) | 改了什么、能打到哪里、有哪些测试缺口？ | 本地仓库 + 可选 diff 基线 | 需求语义判断、架构 Wiki 或 P0 / P1 / P2 审查 |
| [`defect-detection`](skills/defect-detection/README.zh-CN.md) | 实现是否和需求或用例冲突？ | Git 地址 + 分支 + 可提供的需求/用例 | 通用可维护性审查或测试执行 |
| [`code-reviewer`](skills/code-reviewer/README.zh-CN.md) | 哪些具体实现问题值得形成审查发现？ | 本地 checkout + 分支 / PR / commit | 符号图影响分析或需求文档评审 |

各 Skill 的详细工作流和边界放在各自目录中：[架构 Wiki](skills/code-wiki/README.zh-CN.md)（[已知边界](skills/code-wiki/KNOWN_LIMITATIONS.zh-CN.md)）、[代码分析](skills/code-analyzer/README.zh-CN.md)（[已知边界](skills/code-analyzer/KNOWN_LIMITATIONS.zh-CN.md)）、[缺陷检测](skills/defect-detection/HOW_IT_WORKS.zh-CN.md)、[代码审查](skills/code-reviewer/HOW_IT_WORKS.zh-CN.md)、[需求分析](skills/requirements-analyzer/HOW_IT_WORKS.zh-CN.md)、[用例生成](skills/testcase-generation/HOW_IT_WORKS.zh-CN.md)和[数据构造](skills/testdata-generation/HOW_IT_WORKS.zh-CN.md)。宿主、语言和验证状态统一见[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md)。

## 在 Cursor、Claude Code、Codex 上安装

先检查基础工具。`code-analyzer` 和 `code-wiki` 要求 Node.js 18+；`defect-detection` CLI 套件当前在 Node.js 22.15.0 上验证。

```bash
node --version
npx --version
git --version
```

只安装当前任务需要的那个 skill：

```bash
npx skills add openqa-cn/codexqa --skill code-analyzer
npx skills add openqa-cn/codexqa --skill code-wiki
npx skills add openqa-cn/codexqa --skill defect-detection
npx skills add openqa-cn/codexqa --skill code-reviewer
npx skills add openqa-cn/codexqa --skill requirements-analyzer
npx skills add openqa-cn/codexqa --skill testcase-generation
npx skills add openqa-cn/codexqa --skill testdata-generation
```

`code-analyzer` 和 `code-wiki` 还需要 Node.js 18+ 和 `npm install -g @openqa-cn/codexqa`。该 npm 包是单独分发的闭源本地代码分析引擎；建索引、查询和 `wiki inputs` 在用户机器上完成，不需要 LLM。[code-analyzer 边界](skills/code-analyzer/KNOWN_LIMITATIONS.zh-CN.md) · [code-wiki 边界](skills/code-wiki/KNOWN_LIMITATIONS.zh-CN.md)。

按提示选择 Agent。全局安装到 Codex 时加 `--agent codex --global`。每个 `--skill` 只复制一个目录。

无需 codexqa 或 npm 账号。运行要求、安装范围和故障排查见[安装与入门](docs/GETTING_STARTED.zh-CN.md)。

<a id="quick-start"></a>

## 快速开始

1. 用上面的命令安装你需要的那个 skill。
2. 新建一个 Coding Agent 会话。
3. 把**该 skill 要的材料**交给 Agent。它们不能互相顶替。

### 路径 A：检查分支中的需求类缺陷

```text
用 defect-detection 审查 https://github.com/<ORG>/<REPO>.git 的 feature/refund-limit 分支。
需求：退款金额不能超过订单剩余可退余额。
对每个疑似缺陷给出位置、触发条件、依据和修复建议。
```

Git 地址支持 HTTPS 和 SSH；分支可以写 `main` 或 `feature/refund-limit` 这样的名称。需求可以直接粘贴，也可以作为文档提供。

**安装验收，不需要模型：**

```bash
node examples/checkout-boundary/verify.mjs
```

结尾应看到：

```text
PASS: known-good implementation satisfies sampled contract
EXPECTED FAILURE: defective implementation accepts zero
Fixture verified; no AI detection claim.
```

### 路径 B：分析本地工作副本的变更影响

```bash
npm install -g @openqa-cn/codexqa
codexqa --help
codexqa index /path/to/repo --diff-base origin/main
codexqa stats /path/to/repo
```

`codexqa --help` 应列出 CLI 命令；`stats` 应显示已索引的文件、符号和语言。随后在 Agent 中打开该仓库并说：

```text
用 code-analyzer 对照 origin/main 分析这个仓库。
先列高风险变更组，再给受影响调用方、入口，以及没有图关系测试罩住的变更符号。
```

这条路径依赖单独分发的闭源本地分析引擎。本仓库 CI 当前不安装或执行该引擎，详见[已知边界](skills/code-analyzer/KNOWN_LIMITATIONS.zh-CN.md)。

### 路径 C：把仓库画成架构 Wiki

```bash
npm install -g @openqa-cn/codexqa
codexqa index /path/to/repo
codexqa wiki inputs /path/to/repo --kind architecture --limit 8
```

随后在 Agent 中打开该仓库并说：

```text
用 code-wiki 给这个仓库建一份代码知识图谱。只用 wiki inputs，不要走 LLM wiki。
先出架构地图，再解释核心模块和一条阅读路径。
```

填好的报告是一份 Claude Code 官方风格的自包含 HTML。这条路径和 `code-analyzer` 共用同一套本地引擎，详见[已知边界](skills/code-wiki/KNOWN_LIMITATIONS.zh-CN.md)。

<details>
<summary><b>另外四个 skill 分别怎么开口</b></summary>

**审查本地工作副本（`code-reviewer`）** — 在 Agent 里打开该仓库。本 skill 原地 diff，不克隆。

```text
用 code-reviewer 对照 main 审查当前分支。
每条发现给出严重级别、文件:行号、规则、运行时影响和修复建议。
```

目前没有公开 fixture。要做带写回门禁的方法级需求缺陷审查，用 `defect-detection`。

**分析需求（`requirements-analyzer`）** — 交文档，不要交仓库。

```text
用 requirements-analyzer 分析这些需求文档。
只出一份缺口/冲突登记表。P0 必须带验证字段。
源材料没有的接口和 SLA 不要编。
```

这是在审 PRD。要根据 `prd/` 写用例库，用 `testcase-generation`。

**从 PRD 生成手工用例（`testcase-generation`）** — 先把 PRD / 技术方案 / 契约放到 `prd/`。生成阶段不需要 `code/`。

```text
用 testcase-generation 根据 prd/ 下的文档生成手工用例库。
源材料没写的工程字段不要编，写成 TBD。
```

Agent 停在 PRD 与技术方案冲突时，回复 `Confirm follow PRD` 或 `Item N follow technical design`。目前没有公开 fixture。

**构造测试数据（`testdata-generation`）** — 不是 git 克隆。直接说要造什么，或指向已写好的用例 / OpenAPI：

```text
用 testdata-generation 建一个叫 Northwind Standard 的标准目录商品。
没配企业网关就走本地 mock。
```

回写用例前置：

```text
这份用例帮我准备测试数据，并把 ID 回写到前置条件。
```

默认后端是 `http://127.0.0.1:8765` 上的本地 mock。demo 拿到 ID **不等于** 写入了真实系统。

</details>

## 产物长什么样

顶部大图是 `defect-detection` 的 HTML 报告。其他样例产物：

| Skill | 样例 |
| --- | --- |
| `code-wiki` | [HTML 报告模板](skills/code-wiki/assets/report-template.html) |
| `code-analyzer` | [变更影响关系图](skills/code-analyzer/assets/checkout-change-impact.svg) |
| `code-reviewer` | [P0 / P1 发现](docs/assets/previews/cr-findings.html) |
| `requirements-analyzer` | [缺口/冲突登记表](docs/assets/previews/ra-register.html) |
| `testcase-generation` | [结构化手工用例](docs/assets/previews/testcase-sample.html) |
| `testdata-generation` | [后端返回值回写用例前置条件](docs/assets/previews/testdata-writeback.html) |

这些页面使用项目内的渲染器和预置样例数据，只用于说明产物形态，不是已记录的 Agent 运行。

<a id="evidence-and-limitations"></a>

## 证据与边界

七个工作流的公开证据成熟度并不相同：

| Skill | 当前公开证据 |
| --- | --- |
| `defect-detection` | 仓库 CLI 测试、可复现 fixture 和一次记录的 Agent 运行：7/7 个预置缺陷、0 误报；单模型、单次、自建样例，不是 benchmark |
| `code-wiki` | 已公开 Skill 契约、playbook、报告模板和已知边界；`wiki inputs` 依赖同一套闭源引擎，本仓库 CI 不运行 |
| `code-analyzer` | 已公开 Skill 契约、schema、playbook、示例图和已知边界；单独分发的闭源引擎不在本仓库 CI 中运行 |
| `code-reviewer` | 离线 tooling 契约检查；没有公开 fixture 或已记录宿主 Agent 运行 |
| `requirements-analyzer` | eval 用例和解析/转换脚本；没有已记录宿主 Agent 成绩 |
| `testcase-generation` | 集成校验和用例文档 lint；没有公开 fixture 或已记录 Agent 运行 |
| `testdata-generation` | packer、slot 检索和本地 catalog mock；运行结果取决于已配置的 adapter 与 slot |

发现项需要人工确认。codexqa 不替代测试、静态分析、安全审查或维护者判断，也不能推断没有提供的业务规则。本地工作流会写磁盘；仓库克隆、文档获取、外部 provider、工具安装以及宿主 Agent/模型都可能联网。

处理私有源码或比较质量结论前，请查看[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md)、[FAQ](docs/FAQ.zh-CN.md)、各 Skill 的已知边界和[评估方法](benchmarks/README.md)。

## 开发者验证

参与贡献前，请运行仓库检查：

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

这些检查覆盖文档链接、中英章节对齐、仓库内 `defect-detection` CLI 与 provider 行为、打包、任务隔离、写回校验和边界案例。它们不执行单独分发的 `code-analyzer` / `code-wiki` 引擎，也不能证明所有缺陷都会被发现。

## 文档

| 我想…… | 从这里看 |
| --- | --- |
| 今天就跑一次审查 | [安装与入门](docs/GETTING_STARTED.zh-CN.md) · [快速开始](#quick-start) |
| 搞清楚它凭什么下结论、怎么防模型敷衍 | [各 skill 的工作原理](docs/HOW_IT_WORKS.zh-CN.md) · [缺陷检测原理](skills/defect-detection/HOW_IT_WORKS.zh-CN.md) |
| 知道某个 Skill 会漏什么、什么时候别信它 | [各 Skill 的工作原理](docs/HOW_IT_WORKS.zh-CN.md) · [架构 Wiki 边界](skills/code-wiki/KNOWN_LIMITATIONS.zh-CN.md) · [代码分析边界](skills/code-analyzer/KNOWN_LIMITATIONS.zh-CN.md) · [缺陷检测边界](skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md) · [支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md) |
| 确认代码和数据会不会离开本机 | [FAQ](docs/FAQ.zh-CN.md) · [安全说明](SECURITY.zh-CN.md) |
| 自己复现那次 7/7 盲测 | [示例](examples/README.zh-CN.md) · [inventory-service](examples/inventory-service/README.md) · [评估方法](benchmarks/README.md) |
| 知道下一步做什么、哪些还只是计划 | [能力地图与路线图](docs/ROADMAP.zh-CN.md) · [更新日志](CHANGELOG.md) |
| 弄懂仓库结构、文档为什么这么放 | [架构说明](docs/ARCHITECTURE.md)（英文） |
| 知道开源做到哪、商业从哪开始 | [商业边界](docs/COMMERCIAL_BOUNDARY.md)（英文） · [LICENSE](LICENSE) |
| 提 PR 或发一个版本 | [贡献指南](CONTRIBUTING.zh-CN.md) · [发布流程](PUBLISHING.zh-CN.md) |

## 获取支持

- 通过 [GitHub Issues](https://github.com/openqa-cn/codexqa/issues) 报告可复现问题
- 在 [GitHub Discussions](https://github.com/openqa-cn/codexqa/discussions) 提问和讨论实现方案
- 安全漏洞请按照[安全说明](SECURITY.zh-CN.md)反馈

寻求帮助时，请提供 commit 或 skill 版本、操作系统、Agent、命令、预期结果和实际结果。分享前请移除凭据、私有源码和专有日志。

其他去处：[官网](https://openqa.cn) · [产品](https://openqa.cn/agent) · [Skill Hub](https://openqa.cn/skills)

## 参与贡献

欢迎提交误报或漏报的最小公开复现、正常对照、新分析规则、案例和文档改进。分享前请移除凭据、私有源码和专有日志。请从[贡献指南](CONTRIBUTING.zh-CN.md)、[示例](examples/README.zh-CN.md)和[发布流程](PUBLISHING.zh-CN.md)开始。

Apache-2.0 · [GitHub](https://github.com/openqa-cn/codexqa)
