<div align="center">

# OpenQA Skills

**给 Cursor / Claude Code / Codex 用的 Agent Skill：检查 AI 写的代码是否还符合需求，并把 PRD 变成手工用例和真实测试数据。**

[![CI](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml/badge.svg)](https://github.com/openqa-cn/openqa-skills/actions/workflows/repo-check.yml)
[![Release](https://img.shields.io/github/v/tag/openqa-cn/openqa-skills?label=release&style=flat)](https://github.com/openqa-cn/openqa-skills/releases)
[![GitHub stars](https://img.shields.io/github/stars/openqa-cn/openqa-skills?style=flat)](https://github.com/openqa-cn/openqa-skills/stargazers)
[![License](https://img.shields.io/github/license/openqa-cn/openqa-skills)](LICENSE)

**[English](README.md) | 简体中文**

<a href="#快速开始"><strong>快速开始</strong></a> ·
<a href="#产物长什么样"><strong>产物长什么样</strong></a> ·
<a href="docs/HOW_IT_WORKS.zh-CN.md"><strong>工作原理</strong></a> ·
<a href="examples/inventory-service/README.md"><strong>盲测评估</strong></a> ·
<a href="skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md"><strong>已知边界</strong></a> ·
<a href="docs/GETTING_STARTED.zh-CN.md"><strong>安装入门</strong></a> ·
<a href="docs/FAQ.zh-CN.md"><strong>FAQ</strong></a> ·
<a href="docs/SUPPORT_MATRIX.zh-CN.md"><strong>支持矩阵</strong></a>

</div>

<p align="center">
  <a href="docs/assets/previews/defect-report.html"><img src="docs/assets/previews/defect-report.png" alt="缺陷检测 HTML 报告：三条和需求对不上的发现" width="100%"></a>
</p>

<p align="center">
  <sub><em>Agent 负责写出变更。这些 skill 核对需求、审查、用例和测试数据。<br>（上图是样例页：和本地跑出来的是同一套渲染，发现项是写好的示例。）</em></sub>
</p>

---

适用于 [Cursor](https://cursor.com)、[Claude Code](https://claude.com/claude-code)、[Codex](https://openai.com/codex) 和 OpenClaw。`npx skills add` 安装（[Agent Skills](https://agentskills.io/specification)）。本地优先，不用 OpenQA 账号。

Coding Agent 让「看起来能合的 PR」变得便宜。现在真正耗时间的是 **需求对不上、审查在走过场、测试工作模型做不完**：

| Agent 写完代码之后还会怎样 | 用这个 skill |
| --- | --- |
| PR 看起来对、CI 是绿的；需求写「满 10 件打折」，代码用了 `>` | [`defect-detection`](skills/defect-detection/README.zh-CN.md) — 业务逻辑 / 需求缺陷，不只是 Semgrep 形态 |
| 要对本地分支或 PR 做 AI 代码审查：文件:行号、运行时影响、改法，而不是一句 LGTM | [`code-reviewer`](skills/code-reviewer/README.zh-CN.md) |
| PRD 和接口说明打架，或一个 P0 没法判定失败 | [`requirements-analyzer`](skills/requirements-analyzer/README.zh-CN.md) |
| 测试还在对着 PRD 手写手工用例库 | [`testcase-generation`](skills/testcase-generation/README.zh-CN.md) |
| 用例里全是 `{placeholder}`，没人在后端造出真实 ID | [`testdata-generation`](skills/testdata-generation/README.zh-CN.md) |

我们没有按宿主分别测量并公布成绩——[核对到哪一步都写在支持矩阵里](docs/SUPPORT_MATRIX.zh-CN.md)。所有发现项都交给人确认。

## 本仓库提供什么

`openqa-skills` 是 OpenQA 面向 Coding Agent 的公开、本地优先 [Agent Skills](https://agentskills.io/specification) 包。五个 skill，**输入各不相同**：

| Skill | 你要带上的 | 它做什么 |
| --- | --- | --- |
| [`defect-detection`](skills/defect-detection/README.zh-CN.md) | Git 地址 + 分支（再加需求或用例） | 克隆、分析变更方法、写出带门禁的发现 |
| [`code-reviewer`](skills/code-reviewer/README.zh-CN.md) | 本地 Git 工作副本 + 分支 / PR / commit | Playbook CR，产出 P0 / P1 / P2 报告；不克隆 |
| [`requirements-analyzer`](skills/requirements-analyzer/README.zh-CN.md) | PRD / 故事 / 接口说明（文档） | 一份缺口/冲突登记表，带 P0 / P1 验证 |
| [`testcase-generation`](skills/testcase-generation/README.zh-CN.md) | `prd/` 下的 PRD / 技术方案 / 契约 | 生成并更新手工用例库。`code/` 只在更新时用 |
| [`testdata-generation`](skills/testdata-generation/README.zh-CN.md) | 造数请求、用例，和/或 OpenAPI | 打后端（或本地 mock）拿真实 ID；不是 git 克隆 |

[`defect-detection`](skills/defect-detection/README.zh-CN.md) 工作流：

- 创建任务、克隆仓库、收集分支与 diff 上下文
- 基于 AST 规则分析变更方法，并可选使用 Java 调用图分析
- 本地 JSON provider，以及可选的 HTTP、GitHub、测试用例、文档、问题单和异常链路适配器
- 发现结果校验、写回、排序、标签和 HTML 报告
- 可确定复现的正常实现/预置缺陷案例，以及自动化 CLI 测试套件

各 skill 原理：[缺陷检测](skills/defect-detection/HOW_IT_WORKS.zh-CN.md)、[代码审查](skills/code-reviewer/HOW_IT_WORKS.zh-CN.md)、[需求分析](skills/requirements-analyzer/HOW_IT_WORKS.zh-CN.md)、[用例生成](skills/testcase-generation/HOW_IT_WORKS.zh-CN.md)、[数据构造](skills/testdata-generation/HOW_IT_WORKS.zh-CN.md)。索引：[docs/HOW_IT_WORKS.zh-CN.md](docs/HOW_IT_WORKS.zh-CN.md)。

## defect-detection 工作方式

静态规则能抓住「长什么样都认得」的问题：吞掉的异常、写死的密钥、没判空的引用。能混过评审的，往往是另一类：代码写得规范、测试也绿，但和需求不一致。

- 需求写「满 10 件打折」，代码用了 `>`，满 10 件反而没打上。
- 退款直接按申请金额走，没有按剩余可退余额封顶。
- 一个函数改了计数器，读同一份数据的缓存却从未失效。

这类 bug 不在语法树里，在**代码和意图对不上**的地方；意图在需求、用例里，不在 AST 里。模型能对照两者做判断，但放开了也会编造没读过的方法、对几百个方法写「没问题」、标出一堆没人看的噪音。

所以分工是：**模型做语义判断，基础设施保证这个判断能被核对。**

```text
仓库 + 分支 + 需求或用例
              │
              ▼
     收集上下文，分析这次改了什么
              │
              ▼
     AST 规则 + 可选调用图
              │
              ▼
     Agent 审查，发现项过校验
              │
              ▼
     结构化发现 + HTML 报告
              │
              ▼
           人工复核
```

OpenQA 编排流程；语义审查由你这边的 Agent / 模型做。本地就能跑，不必连私有后端；需要时再用适配器接到外部平台。

真正起作用的是三道约束：

1. **分层**：和需求、用例绑得越紧的方法，分析越深；其余不平均用力。
2. **23 条写回规则**：没读过代码、方法名在源码里找不到、整批结论像自动敷衍——一律拒收。
3. **关门闸**：任务结束前再查一遍覆盖率、报告是否对得上、证据够不够。

[inventory-service](examples/inventory-service/README.md) 盲测里，7 个业务逻辑缺陷藏在正常功能改动中，另有 4 个「看着像 bug、其实是对的」诱饵。一次已记录的 agent 跑出 7/7、0 误报，且这 7 处都不是 102 条 Semgrep 种子规则抓到的。这是单模型、单次、自建样例，不是榜单成绩——[评估方法](benchmarks/README.md)、[工作原理](skills/defect-detection/HOW_IT_WORKS.zh-CN.md)、[已知边界](skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md)。

## 产物长什么样

下面都是**样例页**（和本地跑出来的是同一套渲染，发现项是写好的示例）。图旧了就直接打开 HTML。

<p align="center">
  <a href="docs/assets/previews/testcase-sample.html"><img src="docs/assets/previews/testcase-sample.png" alt="库存预占手工用例样例" width="880"></a>
</p>

<p align="center"><em>用例生成写出 Markdown。这是渲染后的样子：步骤、期望、空着的 Construction 列。<a href="docs/assets/previews/testcase-sample.html">打开页面</a>。</em></p>

<p align="center">
  <a href="docs/assets/previews/cr-findings.html"><img src="docs/assets/previews/cr-findings.png" alt="代码审查 P0 / P1 发现样例" width="880"></a>
</p>

<p align="center"><em>代码审查报告：每条都有位置、规则、运行时影响和改法。<a href="docs/assets/previews/cr-findings.html">打开页面</a>。</em></p>

<p align="center">
  <a href="docs/assets/previews/ra-register.html"><img src="docs/assets/previews/ra-register.png" alt="需求分析缺口登记表样例" width="880"></a>
</p>

<p align="center"><em>需求分析：一份缺口 / 冲突登记表，每行带可执行检查。<a href="docs/assets/previews/ra-register.html">打开页面</a>。</em></p>

<p align="center">
  <a href="docs/assets/previews/testdata-writeback.html"><img src="docs/assets/previews/testdata-writeback.png" alt="测试数据回填占位符样例" width="880"></a>
</p>

<p align="center"><em>测试数据构造把 <code>{placeholder}</code> 换成后端真正返回的 ID。<a href="docs/assets/previews/testdata-writeback.html">打开页面</a>。</em></p>

缺陷检测报告的样例页在最上面，也可以[单独打开](docs/assets/previews/defect-report.html)。

## 宿主与语言支持

Skill 指令面向 **Cursor、Claude Code、Codex、OpenClaw**：装完新开一个会话，把材料交给它。装得上不等于在那个宿主上跑得完整流程，逐项核对状态见[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md)。

`defect-detection` 对下列语言做语言感知的方法抽取，并各有自己的 Semgrep 种子包（共 102 条种子规则）。抽取器基于正则 / 括号 / 缩进，不是完整解析器：

| 语言 | 方法级抽取 | 附加 |
| --- | --- | --- |
| Java | ✓ | 可选 GitNexus 调用图 |
| Kotlin · Scala | ✓ | — |
| JavaScript · TypeScript | ✓ | 已记录的盲测样本（7/7）跑在这里 |
| Python | ✓ | 17 条种子规则；方法边界按缩进判断 |
| Go | ✓ | 可选叠加 go vet / staticcheck |
| C · C++ | ✓ | 宏密集代码为近似 |
| C# | ✓ | — |

另有可选叠加扫描：gitleaks、trivy / grype、bandit、gosec、cppcheck、eslint、detekt——装了就用，没装就跳过。

## 在 Cursor、Claude Code、Codex 上安装

```bash
npx skills add openqa-cn/openqa-skills --skill defect-detection
npx skills add openqa-cn/openqa-skills --skill code-reviewer
npx skills add openqa-cn/openqa-skills --skill requirements-analyzer
npx skills add openqa-cn/openqa-skills --skill testcase-generation
npx skills add openqa-cn/openqa-skills --skill testdata-generation
```

按提示选择 Agent。全局安装到 Codex 时加 `--agent codex --global`。每个 `--skill` 只复制一个目录。

无需 OpenQA 或 npm 账号。运行要求、安装范围和故障排查见[安装与入门](docs/GETTING_STARTED.zh-CN.md)。

## 快速开始

1. 用上面的命令安装你需要的那个 skill。
2. 新建一个 Coding Agent 会话。
3. 把**该 skill 要的材料**交给 Agent。三者不能互相顶替。

先跑通一个：**审查分支**（`defect-detection`）。

```text
使用 defect-detection 审查 REPOSITORY_URL 的 BRANCH_NAME。
业务要求：结账金额必须大于零。
对每个疑似缺陷给出位置、触发条件、依据和修复建议。
```

将大写占位符换成真实内容。工作流会收集上下文、分析变更方法、校验发现并生成报告，供人工复核。

不需要模型或私有后端的契约示例（不是检测准确率）：

```bash
node examples/checkout-boundary/verify.mjs
```

<details>
<summary><b>另外四个 skill 分别怎么开口</b></summary>

<br/>

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

## 为什么做成 skill，不是又一个平台

装进来的是文件，不是一个服务。`npx skills add … --skill <name>` 只复制一个目录，之后是你现有的 Agent 在读它——**没有账号、没有网关、没有要你迁移的工作流**。

- **语义判断留给你已经在付费的模型。** 本仓库不带模型，也不猜哪个模型更好。它负责把上下文组织好，再让模型的结论能被核对：23 条写回规则、分层、关门闸。
- **本地优先不是口号。** 本地 JSON provider 直接落盘，报告是能双击打开的 HTML。要接企业系统时，再配 HTTP / GitHub 适配器。
- **一次只装一个。** 五个 skill 输入不通用，装多了只会让 Agent 选错。按当下的任务装。
- **能力和结论分开写。** 哪些已提供、哪些还只是计划，全部在[能力地图与路线图](docs/ROADMAP.zh-CN.md)；每个组件核对到哪一步在[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md)；做不到什么在[已知边界](skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md)。

## 适用边界

> [!IMPORTANT]
> 当前缺陷检测工作流已经是一套可实际使用的工程工具，而不是只能用于实验的原型。它输出供人工确认的缺陷候选，不能替代测试、静态分析、安全审查或维护者判断。

本项目用于组织代码上下文和验证证据，不能替代测试、静态分析、安全审查或维护者判断；也不能证明不存在缺陷，或推断未提供的业务规则。发现结果是待确认候选，不是自动合并决策。

本地 provider 会把数据写入磁盘。仓库克隆、文档获取、远程 provider、自动安装 Semgrep/GitNexus，以及宿主 Agent/模型都可能联网。处理私有源码前，请阅读 [FAQ](docs/FAQ.zh-CN.md)、[支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md)和[安全说明](SECURITY.zh-CN.md)。

## 开发者验证

参与贡献前，请运行仓库检查：

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
```

这些检查覆盖文档链接、中英章节对齐、CLI 与 provider 行为、打包、任务隔离、写回校验和仓库自带的边界案例，但不能证明所有缺陷都会被发现。

## 文档

| 我想…… | 从这里看 |
| --- | --- |
| 今天就跑一次审查 | [安装与入门](docs/GETTING_STARTED.zh-CN.md) · [快速开始](#快速开始) |
| 搞清楚它凭什么下结论、怎么防模型敷衍 | [各 skill 的工作原理](docs/HOW_IT_WORKS.zh-CN.md) · [缺陷检测原理](skills/defect-detection/HOW_IT_WORKS.zh-CN.md) |
| 知道它会漏什么、什么时候别信它 | [已知边界](skills/defect-detection/KNOWN_LIMITATIONS.zh-CN.md) · [支持矩阵](docs/SUPPORT_MATRIX.zh-CN.md) |
| 确认代码和数据会不会离开本机 | [FAQ](docs/FAQ.zh-CN.md) · [安全说明](SECURITY.zh-CN.md) |
| 自己复现那次 7/7 盲测 | [示例](examples/README.zh-CN.md) · [inventory-service](examples/inventory-service/README.md) · [评估方法](benchmarks/README.md) |
| 知道下一步做什么、哪些还只是计划 | [能力地图与路线图](docs/ROADMAP.zh-CN.md) · [更新日志](CHANGELOG.md) |
| 弄懂仓库结构、文档为什么这么放 | [架构说明](docs/ARCHITECTURE.md)（英文） |
| 知道开源做到哪、商业从哪开始 | [商业边界](docs/COMMERCIAL_BOUNDARY.md)（英文） · [LICENSE](LICENSE) |
| 提 PR 或发一个版本 | [贡献指南](CONTRIBUTING.zh-CN.md) · [发布流程](PUBLISHING.zh-CN.md) |

## 获取支持

- 通过 [GitHub Issues](https://github.com/openqa-cn/openqa-skills/issues) 报告可复现问题
- 在 [GitHub Discussions](https://github.com/openqa-cn/openqa-skills/discussions) 提问和讨论实现方案
- 安全漏洞请按照[安全说明](SECURITY.zh-CN.md)反馈

寻求帮助时，请提供 commit 或 skill 版本、操作系统、Agent、命令、预期结果和实际结果。分享前请移除凭据、私有源码和专有日志。

OpenQA 的其他去处：[官网](https://openqa.cn) · [产品](https://openqa.cn/agent) · [Skill Hub](https://openqa.cn/skills)

## 参与贡献

欢迎提交误报或漏报的最小公开复现、正常对照、新分析规则、案例和文档改进。分享前请移除凭据、私有源码和专有日志。请从[贡献指南](CONTRIBUTING.zh-CN.md)、[示例](examples/README.zh-CN.md)和[发布流程](PUBLISHING.zh-CN.md)开始。

Apache-2.0 · [GitHub](https://github.com/openqa-cn/openqa-skills)
