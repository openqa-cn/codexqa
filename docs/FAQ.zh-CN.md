# codexqa FAQ

[English](FAQ.md)

本页覆盖安装和已发布 skill。下面多数条目讲 `defect-detection`；其余 skill 在契约不同处单独说明。

## 这是做什么的？

codexqa 是面向 Cursor、Claude Code、Codex、OpenClaw 的公开、本地优先 [Agent Skills](https://agentskills.io/specification) 包。AI 让产出代码更快；codexqa 聚焦那些不会自动变便宜的验证工作：澄清需求、理解变更影响、拿证据审实现、设计用例、准备测试数据。

七个 skill 分别覆盖交付生命周期中的不同工作。每个 skill 都有独立输入契约，Agent 能明确知道这次该读文档、索引本地 checkout、克隆分支、做代码风险扫描、写用例、调用造数后端、诊断异常，还是收集 CodexQA 评审证据包：

| Skill | 用途 |
| --- | --- |
| [`code-analyzer`](../skills/code-analyzer/README.zh-CN.md) | 给本地仓库建符号图，再分析变更影响、回归范围、测试缺口、入口和报错 |
| [`root-cause-diagnosis`](../skills/root-cause-diagnosis/README.zh-CN.md) | 在 CodexQA CLI 之上做异常根因诊断；带门禁的英文 RCA 报告 |
| [`defect-detection`](../skills/defect-detection/README.zh-CN.md) | SAST/lint/secrets/SCA + agent 内联语义扫描 → `report_scan.*`（P0–P3） |
| [`ai-code-reviewer`](../skills/ai-code-reviewer/README.zh-CN.md) | CodexQA 证据包 → 双语 `REVIEW-REPORT.html` |
| [`requirements-analyzer`](../skills/requirements-analyzer/README.zh-CN.md) | 审需求文档的质量与风险，出一份缺口登记表 |
| [`testcase-generation`](../skills/testcase-generation/README.zh-CN.md) | 从本地需求生成测试方案与手工用例（Plan / Exec / Incremental）；双写 Markdown 并生成聚合 HTML 报告 |
| [`testdata-generation`](../skills/testdata-generation/README.zh-CN.md) | 构造可复用测试数据，回填用例里的 `{placeholder}` |

`npx skills add … --skill <name>` 一次只复制一个目录。按任务安装，彼此不互相替代。`defect-detection` 的检出效果尚未独立 benchmark。`code-analyzer`、`root-cause-diagnosis`、`defect-detection`、`testcase-generation`、`ai-code-reviewer` 和 `requirements-analyzer` 没有公开的宿主 agent 成绩。

报告、用例长什么样：[样例页和截图](../README.zh-CN.md#产物长什么样)。

## 为什么不只用 linter 或一次代码审查 prompt？

它们解决的问题不同。linter 和静态规则擅长抓可疑语法与数据流形态；通用审查 prompt 可以评论 diff，但没有稳定的输入契约和证据门禁。codexqa 保留你已经在用的模型，再补上按任务收集上下文、playbook、符号图查询、结构化产物和停点。它不是测试执行器，也不能证明实现正确；它的价值是让验证工作边界更清楚、结果更容易复核。

## 该装哪一个？

按任务选，不要按措辞选：

- 对 diff / 仓库 / 粘贴做 SAST 与语义代码风险扫描 → `defect-detection`
- 在本地仓库追变更符号、调用方、回归范围、测试缺口和可达入口 → `code-analyzer`
- 从堆栈 / 日志 / dump 做异常根因诊断 → `root-cause-diagnosis`
- CodexQA 图证据包与双语 HTML 评审报告 → `ai-code-reviewer`
- 审 PRD 本身是否完整、一致 → `requirements-analyzer`
- 写或更新手工用例库（并可生成聚合 HTML 报告） → `testcase-generation`
- 构造数据、填用例 `{placeholder}` → `testdata-generation`

只说「审这个 PR」不够选：`code-analyzer` 负责画出变更符号、调用方、入口和测试缺口；`defect-detection` 跑 SAST + agent 语义扫描并产出 `report_scan.*`；`ai-code-reviewer` 收集 CodexQA 证据包并渲染 `REVIEW-REPORT.html`；`root-cause-diagnosis` 需要异常证据做 RCA。一个请求可以串联多个 skill：先用 `code-analyzer` 收敛影响面，再用 `ai-code-reviewer` 做图证据 HTML 评审。先生成用例；占位符只能在 `.md` 落盘后再回填。

## 每个 skill 要我交什么？

输入各不相同。有两个 skill 用 Git，但用法不一样：

| Skill | 你要带上的 | 不会当输入用的 |
|---|---|---|
| `code-analyzer` | 本地仓库；审变更时再给基线 ref | 需求文档或克隆任务。它给磁盘上的现有 checkout 建索引并查询符号图 |
| `root-cause-diagnosis` | 异常证据（堆栈 / 日志 / dump），外加 git 地址、本地目录、文件或已打开工作区 | PRD 或 P0/P1/P2 审查请求。它诊断异常，不做需求缺口或图证据 HTML 评审 |
| `defect-detection` | Diff / 仓库 / 上传 / 粘贴，用于代码风险扫描 | 以异常堆栈为主（用 `root-cause-diagnosis`）或以图证据 HTML 评审为主（用 `ai-code-reviewer`） |
| `ai-code-reviewer` | 本地 checkout + `codexqa`/`jq`；PR 模式需要 `--diff-base` | 只要结构/影响面问答用 `code-analyzer`；只要 SAST 扫描报告用 `defect-detection` |
| `requirements-analyzer` | 需求文档（PRD、故事、接口说明，可选角色报告） | 被测源码。它不写用例 |
| `testcase-generation` | 本轮给出的本地 PRD / 技术方案文件、粘贴正文或 HTTPS 文档 URL（可选知识目录 / Git URL） | 不以应用源码为主输入。仅在 Incremental 且用户给出 PR/git URL、并已有用例基线时才拉代码 |
| `testdata-generation` | 造数请求、写好的用例，和/或 OpenAPI / `planId` / `serviceId` | 被测源码。它打后端（或本地 mock），回报后端返回的业务 ID |

可以直接对 Agent 说的话：[仓库 README · 快速开始](../README.zh-CN.md#快速开始)。

## 需要 npm 或 codexqa 账号吗？

不需要。`npx skills add` 只是从 GitHub 获取 skill 文件的社区安装器，本地 provider 也不需要 codexqa 账号。`code-analyzer`、`root-cause-diagnosis` 与 `defect-detection` 还要安装单独分发的 npm 包 `@openqa-cn/codexqa`，但不需要 npm 账号。你的 Agent 和远程 provider 可能各有自己的账号要求。

## code-analyzer Skill 和 codexqa CLI 是什么关系？

`code-analyzer` 的 Skill、playbook、查询 schema 和示例发布在本仓库中。npm 包 `@openqa-cn/codexqa` 是单独分发的闭源本地代码分析引擎。Skill 负责告诉 Agent 何时调用引擎、查询哪些图证据，以及如何组织报告。

建索引和图查询在用户机器上完成，不需要 LLM；索引和会话写在 `~/.codexqa/`。本仓库 CI 不安装或执行该引擎，当前验证状态见 [`code-analyzer` 已知边界](../skills/code-analyzer/KNOWN_LIMITATIONS.zh-CN.md)和[支持矩阵](SUPPORT_MATRIX.zh-CN.md)。

## 安装后会自动跑工作流吗？

不会。安装只让 Agent 能读到文件。还需要新建会话，并给出克隆地址、本地工作副本、PRD 或数据构造请求。脚本负责落盘和校验，不提供模型。

## 代码会离开本机吗？

本地 provider 把结果写在磁盘上，但这不等于「离线运行」。源码上下文怎么处理，取决于宿主 Agent / 模型；配置了 HTTP provider 会把业务材料和发现发到外部服务；接了 GitHub 问题单集成会在外部留下记录。

仓库克隆和抓取公开文档同样会联网。当前分析命令可能尝试通过 pip / Homebrew 安装 Semgrep，通过 npm / pnpm 全局安装 GitNexus。分析涉密仓库前，请先确认配置和宿主权限。

## defect-detection 的报告和配置存在哪里？

`defect-detection` 把报告写到 `-o` 目录（默认 `/tmp/aid_report/`），可选反馈写在 skill 的 `data/` 下。见其 [README](../skills/defect-detection/README.zh-CN.md)。运行数据和私有配置不要进版本库，升级前先备份。

`testcase-generation` 写到 `run_dir`（默认 `$HOME/testdata-generation/runs/{runid}`，或你指定的路径）：`testcase/testdocs/`、`testdesign/`（含 `test_design.md` 与 `testcase_generation_report.html`）、`testcase/initialcase/`、`testcase/cases/`。`testdata-generation` 写到工作区 `testdata/`（见该 skill 的 [README](../skills/testdata-generation/README.zh-CN.md)）。`code-analyzer` 的本地索引写到 `~/.codexqa/`；建索引和图查询不需要 LLM。`root-cause-diagnosis` 的任务数据写在 skill 的 `data/` 目录，并同样使用 CodexQA CLI 索引。`ai-code-reviewer` 把证据包写到工作目录（如 `.codexqa-review/`）并渲染 `REVIEW-REPORT.html`。

## defect-detection 能替代测试或静态分析吗？

不能。它把静态分析集成和 Agent 审查组合起来，但不替代测试执行，也不能证明不存在缺陷。结构和覆盖率门禁校验的是记录是否合规，不是语义是否正确。AI 给出的候选需要人工复核。

## 支持哪些语言和 Agent？

Skill 指令面向 Codex、Claude Code、Cursor 和 OpenClaw。注意「装得上」「跑过运行时测试」「完整 Agent 流程验证过」是三种不同的说法，实际核对到哪一步见[支持矩阵](SUPPORT_MATRIX.zh-CN.md)。Java 有面向方法 / 调用图的处理；其他语言的表现取决于对应的抽取和扫描路径。

## 检出准确率测过吗？

还没有公开的 Agent benchmark。回归套件校验的是 CLI 和工作流行为；边界案例演示的是一个确定可复现的缺陷，不代表 AI 检出率或误报率。

## 产物长什么样？

样例页（同一套渲染，发现项是写好的示例）：[README · 产物长什么样](../README.zh-CN.md#产物长什么样)。HTML 和截图在 `docs/assets/previews/`。

## testcase-generation 会填测试数据吗？

不会。它写测试方案和手工用例 Markdown（未知信息标 TBD / 待澄清），并生成聚合 HTML 报告供查阅。构造真实后端 ID 并回写前置条件是 `testdata-generation`。只装 `testcase-generation` 得到的是设计产物，不能直接打真实后端。
