# codexqa FAQ

[English](FAQ.md)

本页覆盖安装和已发布 skill。下面多数条目讲 `defect-detection`；其余 skill 在契约不同处单独说明。

## 这是做什么的？

codexqa 是面向 Cursor、Claude Code、Codex、OpenClaw 的公开、本地优先 [Agent Skills](https://agentskills.io/specification) 包。针对 Agent 写出绿 PR 之后仍然贵的部分：需求 / 业务逻辑缺陷、走过场的审查、不完整的 PRD、手工用例库、以及用例里的 `{placeholder}`。五个 skill：

| Skill | 用途 |
| --- | --- |
| [`defect-detection`](../skills/defect-detection/README.zh-CN.md) | 克隆 git 分支 / PR / 测试计划，写出带门禁的发现 |
| [`code-reviewer`](../skills/code-reviewer/README.zh-CN.md) | 对本地工作副本做 playbook CR，产出 P0 / P1 / P2 报告 |
| [`requirements-analyzer`](../skills/requirements-analyzer/README.zh-CN.md) | 审需求文档的质量与风险，出一份缺口登记表 |
| [`testcase-generation`](../skills/testcase-generation/README.zh-CN.md) | 从 PRD / 技术方案 / 规格生成并更新手工测试用例 |
| [`testdata-generation`](../skills/testdata-generation/README.zh-CN.md) | 构造可复用测试数据，回填用例里的 `{placeholder}` |

`npx skills add … --skill <name>` 一次只复制一个目录。按任务安装，彼此不互相替代。`defect-detection` 的检出效果尚未独立 benchmark。`testcase-generation`、`code-reviewer` 和 `requirements-analyzer` 没有公开的宿主 agent 成绩。

报告、用例长什么样：[样例页和截图](../README.zh-CN.md#产物长什么样)。

## 该装哪一个？

按任务选，不要按措辞选：

- 找需求 / 业务逻辑缺陷，并且要写回门禁 → `defect-detection`
- 对本地工作副本做质量 / 安全 / 可维护性 CR → `code-reviewer`
- 审 PRD 本身是否完整、一致 → `requirements-analyzer`
- 写或更新手工用例库 → `testcase-generation`
- 构造数据、填用例 `{placeholder}` → `testdata-generation`

只说「审这个 PR」不够选：`defect-detection` 按 URL 克隆并对发现做门禁；`code-reviewer` 原地 diff 再加载 playbook。一个请求也可以跨两个 skill。先生成用例；占位符只能在 `.md` 落盘后再回填。

## 每个 skill 要我交什么？

输入各不相同。有两个 skill 用 Git，但用法不一样：

| Skill | 你要带上的 | 不会当输入用的 |
|---|---|---|
| `defect-detection` | Git 地址 + 分支（有需求或用例更好） | — |
| `code-reviewer` | 本地 Git 工作副本 + 要审的分支 / PR / commit | 克隆地址。本 skill 原地 diff |
| `requirements-analyzer` | 需求文档（PRD、故事、接口说明，可选角色报告） | 被测源码。它不写用例 |
| `testcase-generation` | `prd/` 下的 PRD / 技术方案 / 接口契约 | 生成阶段的 `code/`。`code/` 只在更新时做 diff，判断哪些用例受影响，不从代码推断 schema，也不造数据 |
| `testdata-generation` | 造数请求、写好的用例，和/或 OpenAPI / `planId` / `serviceId` | 被测源码。它打后端（或本地 mock），回报后端返回的业务 ID |

可以直接对 Agent 说的话：[仓库 README · 快速开始](../README.zh-CN.md#快速开始)。

## 需要 npm 或 codexqa 账号吗？

不需要。`npx skills add` 只是从 GitHub 获取 skill 文件的社区安装器，本地 provider 也不需要 codexqa 账号。你的 Agent 和远程 provider 可能各有自己的账号要求。

## 安装后会自动跑工作流吗？

不会。安装只让 Agent 能读到文件。还需要新建会话，并给出克隆地址、本地工作副本、PRD 或数据构造请求。脚本负责落盘和校验，不提供模型。

## 代码会离开本机吗？

本地 provider 把结果写在磁盘上，但这不等于「离线运行」。源码上下文怎么处理，取决于宿主 Agent / 模型；配置了 HTTP provider 会把业务材料和发现发到外部服务；接了 GitHub 问题单集成会在外部留下记录。

仓库克隆和抓取公开文档同样会联网。当前分析命令可能尝试通过 pip / Homebrew 安装 Semgrep，通过 npm / pnpm 全局安装 GitNexus。分析涉密仓库前，请先确认配置和宿主权限。

## defect-detection 的报告和配置存在哪里？

默认写在 skill 安装目录下的 `data/`，以及本地 `enterprise/` 输入目录。运行时可用 `DETECTION_DATA_DIR`、`CONTENT_JSON_BASE`、`DETECTION_ENTERPRISE_DIR` 覆盖，细节见[运维手册](../skills/defect-detection/references/operator-manual.md)和[适配器指南](../skills/defect-detection/references/api/adapters.md)。运行数据和私有配置不要进版本库，升级前先备份。

`testcase-generation` 写到工作区 `usecases/` 和可选的 `{workspace}/.ai-testcase/`。`testdata-generation` 写到工作区 `testdata/`（见该 skill 的 [README](../skills/testdata-generation/README.zh-CN.md)）。

## defect-detection 能替代测试或静态分析吗？

不能。它把静态分析集成和 Agent 审查组合起来，但不替代测试执行，也不能证明不存在缺陷。结构和覆盖率门禁校验的是记录是否合规，不是语义是否正确。AI 给出的候选需要人工复核。

## 支持哪些语言和 Agent？

Skill 指令面向 Codex、Claude Code、Cursor 和 OpenClaw。注意「装得上」「跑过运行时测试」「完整 Agent 流程验证过」是三种不同的说法，实际核对到哪一步见[支持矩阵](SUPPORT_MATRIX.zh-CN.md)。Java 有面向方法 / 调用图的处理；其他语言的表现取决于对应的抽取和扫描路径。

## 检出准确率测过吗？

还没有公开的 Agent benchmark。回归套件校验的是 CLI 和工作流行为；边界案例演示的是一个确定可复现的缺陷，不代表 AI 检出率或误报率。

## 产物长什么样？

样例页（同一套渲染，发现项是写好的示例）：[README · 产物长什么样](../README.zh-CN.md#产物长什么样)。HTML 和截图在 `docs/assets/previews/`。

## testcase-generation 会填测试数据吗？

不会。用例保留 `{placeholder}`，`Construction` 列为空。回填由 `testdata-generation` 做。只装 `testcase-generation` 得到的是设计产物，不能直接打真实后端。
