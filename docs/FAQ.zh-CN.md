# codexqa FAQ

[English](FAQ.md)

本页覆盖安装和已发布 skill。下面多数条目讲 `codexqa-defect-analyzer`；其余 skill 在契约不同处单独说明。

## 这是做什么的？

codexqa 是面向 Cursor、Claude Code、Codex、OpenClaw 的公开、本地优先 [Agent Skills](https://agentskills.io/specification) 包。AI 让产出代码更快；codexqa 聚焦那些不会自动变便宜的验证工作：澄清需求、理解变更影响、拿证据审实现、设计用例、准备测试数据。

十个干活的 skill 分别覆盖交付生命周期中的不同工作，另有 [`codexqa-skill-router`](../skills/codexqa-skill-router/README.zh-CN.md) 在请求未点名 skill 时做自动选择。每个干活的 skill 都有独立输入契约，Agent 能明确知道这次该读文档、索引本地 checkout、为一次 diff 出报告、做代码风险扫描、写用例、调用造数后端、驱动浏览器、诊断异常、收集 CodexQA 评审证据包，还是导出架构 Wiki：

| Skill | 用途 |
| --- | --- |
| [`codexqa-skill-router`](../skills/codexqa-skill-router/README.zh-CN.md) | 发现现场兄弟 + 内置目录；按需安装；交接给匹配 skill |
| [`codexqa-code-analyzer`](../skills/codexqa-code-analyzer/README.zh-CN.md) | 给本地仓库建符号图，再分析变更影响、回归范围、测试缺口、入口和报错 |
| [`codexqa-change-analysis`](../skills/codexqa-change-analysis/README.zh-CN.md) | 对一次变更做 diff 索引，写一份 HTML 报告（影响入口、变更清单、测试方案、覆盖结论、敏感路径），并为未覆盖的点新增可运行的测试文件 |
| [`codexqa-code-wiki`](../skills/codexqa-code-wiki/README.zh-CN.md) | 给本地仓库建索引，用 `wiki inputs`（不调模型）导出社区 digest，写出架构知识图谱 HTML 报告 |
| [`codexqa-rootcause-analyzer`](../skills/codexqa-rootcause-analyzer/README.zh-CN.md) | 在 CodexQA CLI 之上做异常根因诊断；带门禁的英文 RCA 报告 |
| [`codexqa-defect-analyzer`](../skills/codexqa-defect-analyzer/README.zh-CN.md) | SAST/lint/secrets/SCA + Agent LLM Detection → `report_scan.*`（P0–P3，去重合并） |
| [`codexqa-code-reviewer`](../skills/codexqa-code-reviewer/README.zh-CN.md) | CodexQA 证据包 + 启发式维度 + Agent LLM judgment → 双语 `REVIEW-REPORT.html` |
| [`codexqa-requirement-analyzer`](../skills/codexqa-requirement-analyzer/README.zh-CN.md) | 审需求文档的质量与风险，出一份缺口登记表 |
| [`codexqa-testcase-generator`](../skills/codexqa-testcase-generator/README.zh-CN.md) | 从本地需求生成测试方案与手工用例（Plan / Exec / Incremental）；双写 Markdown 并生成聚合 HTML 报告 |
| [`codexqa-testdata-generator`](../skills/codexqa-testdata-generator/README.zh-CN.md) | 构造可复用测试数据，回填用例里的 `{placeholder}` |
| [`codexqa-jev-browser`](../skills/codexqa-jev-browser/README.zh-CN.md) | 在 Playwright Chromium 里回放 YAML / Markdown / API 用例或按目标执行；本地 HTML 报告含每一步和标注截图 |

`npx skills add … --skill <name>` 一次只复制一个目录。按任务安装，彼此不互相替代。不确定时装 `codexqa-skill-router`——只装路由也可按需拉取干活 skill。`codexqa-defect-analyzer` 的检出效果尚未独立 benchmark。`codexqa-code-analyzer`、`codexqa-change-analysis`、`codexqa-code-wiki`、`codexqa-rootcause-analyzer`、`codexqa-defect-analyzer`、`codexqa-testcase-generator`、`codexqa-code-reviewer`、`codexqa-requirement-analyzer`、`codexqa-jev-browser` 和 `codexqa-skill-router` 没有公开的宿主 agent 成绩。

报告、用例长什么样：[样例页和截图](../README.zh-CN.md#所有技能SKILL概览)。

## skill 名字改过吗？

改过。每个已发布 skill 的目录名与 frontmatter `name` 都统一为 `codexqa-*`。请用新名字安装，例如 `npx skills add openqa-cn/codexqa --skill codexqa-defect-analyzer`。旧名对照：`ai-code-reviewer`→`codexqa-code-reviewer`，`change-impact-analysis`→`codexqa-change-analysis`，`code-analyzer`→`codexqa-code-analyzer`，`code-wiki`→`codexqa-code-wiki`，`defect-detection`→`codexqa-defect-analyzer`，`requirements-analyzer`→`codexqa-requirement-analyzer`，`root-cause-diagnosis`→`codexqa-rootcause-analyzer`，`skill-router`→`codexqa-skill-router`，`testdata-generation`→`codexqa-testdata-generator`，`testcase-generation`→`codexqa-testcase-generator`。

## 为什么不只用 linter 或一次代码审查 prompt？

它们解决的问题不同。linter 和静态规则擅长抓可疑语法与数据流形态；通用审查 prompt 可以评论 diff，但没有稳定的输入契约和证据门禁。codexqa 保留你已经在用的模型，再补上按任务收集上下文、playbook、符号图查询、结构化产物和停点。它不是测试执行器，也不能证明实现正确；它的价值是让验证工作边界更清楚、结果更容易复核。

## 该装哪一个？

按任务选，不要按措辞选：

- 不确定用哪个 / 自动路由含糊的 QA 请求 → `codexqa-skill-router`
- 对 diff / 仓库 / 粘贴做 SAST 与语义代码风险扫描 → `codexqa-defect-analyzer`
- 在本地仓库追变更符号、调用方、回归范围、测试缺口和可达入口 → `codexqa-code-analyzer`
- 为一次 diff 出一份 HTML 变更影响报告，并给没覆盖的点补测试文件 → `codexqa-change-analysis`
- 画模块地图、真实依赖和阅读路径，不调模型 → `codexqa-code-wiki`
- 从堆栈 / 日志 / dump 做异常根因诊断 → `codexqa-rootcause-analyzer`
- CodexQA 图证据包与双语 HTML 评审报告 → `codexqa-code-reviewer`
- 审 PRD 本身是否完整、一致 → `codexqa-requirement-analyzer`
- 写或更新手工用例库（并可生成聚合 HTML 报告） → `codexqa-testcase-generator`
- 构造数据、填用例 `{placeholder}` → `codexqa-testdata-generator`
- 在真实浏览器里回放 UI 用例或按目标执行 → `codexqa-jev-browser`

只说「审这个 PR」不够选：`codexqa-code-wiki` 负责画社区和阅读顺序；`codexqa-code-analyzer` 负责画出变更符号、调用方、入口和测试缺口；`codexqa-change-analysis` 把一次 diff 做成 HTML 影响报告并补新测试；`codexqa-defect-analyzer` 跑 SAST + agent 语义扫描并产出 `report_scan.*`；`codexqa-code-reviewer` 收集 CodexQA 证据包并渲染 `REVIEW-REPORT.html`；`codexqa-rootcause-analyzer` 需要异常证据做 RCA。一个请求可以串联多个 skill：先用 `codexqa-code-wiki` 看地图，再用 `codexqa-code-analyzer` 收敛影响面，再用 `codexqa-code-reviewer` 做图证据 HTML 评审。先生成用例；占位符只能在 `.md` 落盘后再回填。

## 每个 skill 要我交什么？

输入各不相同。有几个 skill 用 Git，但用法不一样：

| Skill | 你要带上的 | 不会当输入用的 |
|---|---|---|
| `codexqa-skill-router` | 待路由的请求（可选：同意按需安装）；Python 3.10+ | 干活本身——它只选型，必要时拉取，再跟随其它 skill |
| `codexqa-code-analyzer` | 本地仓库；审变更时再给基线 ref | 需求文档或克隆任务。它给磁盘上的现有 checkout 建索引并查询符号图 |
| `codexqa-change-analysis` | 本地仓库和一个基线 ref（如 `origin/main`）；要跑生成的测试，被测仓库需能启动 | 没有 diff 的全仓分析（用 `codexqa-code-analyzer`）。它只新增测试文件，不改已有测试 |
| `codexqa-code-wiki` | 已建索引的本地仓库 | 变更集、需求文档或克隆任务。它导出 `wiki inputs` 并写架构报告 |
| `codexqa-rootcause-analyzer` | 异常证据（堆栈 / 日志 / dump），外加 git 地址、本地目录、文件或已打开工作区 | PRD 或 P0/P1/P2 审查请求。它诊断异常，不做需求缺口或图证据 HTML 评审 |
| `codexqa-defect-analyzer` | Diff / 仓库 / 上传 / 粘贴，用于代码风险扫描 | 以异常堆栈为主（用 `codexqa-rootcause-analyzer`）或以图证据 HTML 评审为主（用 `codexqa-code-reviewer`） |
| `codexqa-code-reviewer` | 本地 checkout + `codexqa`/`jq`；PR 模式需要 `--diff-base` | 只要结构/影响面问答用 `codexqa-code-analyzer`；只要 SAST 扫描报告用 `codexqa-defect-analyzer` |
| `codexqa-requirement-analyzer` | 需求文档（PRD、故事、接口说明，可选角色报告） | 被测源码。它不写用例 |
| `codexqa-testcase-generator` | 本轮给出的本地 PRD / 技术方案文件、粘贴正文或 HTTPS 文档 URL（可选知识目录 / Git URL） | 不以应用源码为主输入。仅在 Incremental 且用户给出 PR/git URL、并已有用例基线时才拉代码 |
| `codexqa-testdata-generator` | 造数请求、写好的用例，和/或 OpenAPI / `planId` / `serviceId` | 被测源码。它打后端（或本地 mock），回报后端返回的业务 ID |
| `codexqa-jev-browser` | 一份 YAML / Markdown / API 用例，或目标加 URL；先在 skill 目录 `npm install` | CSS / XPath / 坐标。它只操作自己页面索引里的控件 |

可以直接对 Agent 说的话：[仓库 README · 快速开始](../README.zh-CN.md#快速开始)。

## 需要 npm 或 codexqa 账号吗？

不需要。`npx skills add` 只是从 GitHub 获取 skill 文件的社区安装器，本地 provider 也不需要 codexqa 账号。`codexqa-code-analyzer`、`codexqa-change-analysis`、`codexqa-code-wiki`、`codexqa-rootcause-analyzer` 与 `codexqa-defect-analyzer` 还要安装单独分发的 npm 包 `@openqa-cn/codexqa`，但不需要 npm 账号。你的 Agent 和远程 provider 可能各有自己的账号要求。

## codexqa-code-analyzer / codexqa-code-wiki Skill 和 codexqa CLI 是什么关系？

`codexqa-code-analyzer` 和 `codexqa-code-wiki` 的 Skill、playbook 和示例发布在本仓库中。npm 包 `@openqa-cn/codexqa` 是单独分发的闭源本地代码分析引擎。Skill 负责告诉 Agent 何时调用引擎、查询哪些图证据，以及如何组织报告。

建索引、图查询和 `wiki inputs` 在用户机器上完成，不需要 LLM；索引和会话写在 `~/.codexqa/`。本仓库 CI 不安装或执行该引擎，当前验证状态见 [`codexqa-code-analyzer` 已知边界](../skills/codexqa-code-analyzer/KNOWN_LIMITATIONS.zh-CN.md)、[`codexqa-code-wiki` 已知边界](../skills/codexqa-code-wiki/KNOWN_LIMITATIONS.zh-CN.md)和[支持矩阵](SUPPORT_MATRIX.zh-CN.md)。

## 安装后会自动跑工作流吗？

不会。安装只让 Agent 能读到文件。还需要新建会话，并给出克隆地址、本地工作副本、PRD 或数据构造请求。脚本负责落盘和校验，不提供模型。例外：[`codexqa-skill-router`](../skills/codexqa-skill-router/README.zh-CN.md) 可在征得同意后**按需拉取**其它 skill 的文件并跟随执行——它本身仍不替代干活 skill。

## 代码会离开本机吗？

本地 provider 把结果写在磁盘上，但这不等于「离线运行」。源码上下文怎么处理，取决于宿主 Agent / 模型；配置了 HTTP provider 会把业务材料和发现发到外部服务；接了 GitHub 问题单集成会在外部留下记录。

仓库克隆和抓取公开文档同样会联网。当前分析命令可能尝试通过 pip / Homebrew 安装 Semgrep，通过 npm / pnpm 全局安装 GitNexus。分析涉密仓库前，请先确认配置和宿主权限。

## codexqa-defect-analyzer 的报告和配置存在哪里？

`codexqa-defect-analyzer` 把报告写到 `-o` 目录（默认 `/tmp/aid_report/`），可选反馈写在 skill 的 `data/` 下。见其 [README](../skills/codexqa-defect-analyzer/README.zh-CN.md)。运行数据和私有配置不要进版本库，升级前先备份。

`codexqa-testcase-generator` 写到 `run_dir`（默认 `$HOME/codexqa-testdata-generator/runs/{runid}`，或你指定的路径）：`testcase/testdocs/`、`testdesign/`（含 `test_design.md` 与 `testcase_generation_report.html`）、`testcase/initialcase/`、`testcase/cases/`。`codexqa-testdata-generator` 写到工作区 `testdata/`（见该 skill 的 [README](../skills/codexqa-testdata-generator/README.zh-CN.md)）。`codexqa-code-analyzer` 和 `codexqa-code-wiki` 的本地索引写到 `~/.codexqa/`；建索引、图查询和 `wiki inputs` 不需要 LLM。`codexqa-code-wiki` 还会在工作目录写一份自包含 HTML 报告。`codexqa-rootcause-analyzer` 的任务数据写在 skill 的 `data/` 目录，并同样使用 CodexQA CLI 索引。`codexqa-code-reviewer` 把证据包写到工作目录（如 `.codexqa-review/`）并渲染 `REVIEW-REPORT.html`。

## codexqa-defect-analyzer 能替代测试或静态分析吗？

不能。它把静态分析集成和 Agent 审查组合起来，但不替代测试执行，也不能证明不存在缺陷。结构和覆盖率门禁校验的是记录是否合规，不是语义是否正确。AI 给出的候选需要人工复核。

## 支持哪些语言和 Agent？

Skill 指令面向 Codex、Claude Code、Cursor 和 OpenClaw。注意「装得上」「跑过运行时测试」「完整 Agent 流程验证过」是三种不同的说法，实际核对到哪一步见[支持矩阵](SUPPORT_MATRIX.zh-CN.md)。Java 有面向方法 / 调用图的处理；其他语言的表现取决于对应的抽取和扫描路径。

## 检出准确率测过吗？

还没有公开的 Agent benchmark。回归套件校验的是 CLI 和工作流行为；边界案例演示的是一个确定可复现的缺陷，不代表 AI 检出率或误报率。

## 产物长什么样？

样例页（同一套渲染，发现项是写好的示例）：[README · 所有技能SKILL概览](../README.zh-CN.md#所有技能SKILL概览)。HTML 和截图在 `docs/assets/previews/`。

## codexqa-testcase-generator 会填测试数据吗？

不会。它写测试方案和手工用例 Markdown（未知信息标 TBD / 待澄清），并生成聚合 HTML 报告供查阅。构造真实后端 ID 并回写前置条件是 `codexqa-testdata-generator`。只装 `codexqa-testcase-generator` 得到的是设计产物，不能直接打真实后端。
