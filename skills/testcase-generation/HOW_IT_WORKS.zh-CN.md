# 测试用例生成：数据流与约束

[English](HOW_IT_WORKS.md)

`testcase-generation` 是宿主 agent 上的工作流 skill，不内置模型。输入是工作区里的 PRD / 技术方案 / 接口契约（可选知识库、被测代码）。输出是 `usecases/cases/{module}/*.md` 手工用例，以及 `usecases/testdocs/` 下的中间产物。

运行时步骤见 [`SKILL.md`](SKILL.md)。能力边界见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。安装与零配置见 [README](README.zh-CN.md)。渲染后的用例：[样例页](https://github.com/openqa-cn/openqa-skills/blob/main/docs/assets/previews/testcase-sample.html)。

## 要解决的问题

直接让模型「按 PRD 写用例」常见三类错误，对应不同约束：

| 错误 | 表现 | 约束 |
| --- | --- | --- |
| 幻觉工程字段 | 断言里出现源材料未声明的表 / 列 / cache key | 未明示的标识写 `TBD`，禁止推断 |
| 少生成 | 只产出部分场景，仍声称「用例集已完成」 | 先写 `case-registry.json` 再落 `.md`；`pending` 条目必须全部生成 |
| 无稳定 ID | 用例是散文，PRD 变更后无法定位受影响条目 | 每条用例 UUID + `business_rules_digest`；更新走 diff |

模型做测试设计判断。磁盘上的产物、门禁和 lint 用来做检查和断点续跑。

## 评估状态

没有公开 fixture、没有答案键、没有已记录的端到端运行（`defect-detection` 的 inventory-service 7/7 不适用于本 skill）。覆盖率、门禁召回、相对「直接让模型写用例」的提升均未测量。质量靠人工审产物。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 交互协议

生成不是 PRD → 用例一步完成。固定停点：

| 条件 | 展示 | 回复 |
| --- | --- | --- |
| `analysis.md` §1.6 存在（PRD 与技术方案冲突） | 不一致表，默认跟 PRD | `Confirm follow PRD` 或 `Item N follow technical design` |
| Phase 2 结束（必停） | 模块/验证范围图、数据实体依赖图、`design.md` 链接 | 确认，或改 `design.md` 后确认 |
| 全部 registry 条目 `status=done` | mermaid 总览（按模块、`new_feature` / `regression`） | 对话里增删改用例，或结束 |

用例路径：`usecases/cases/{module}/`。格式是 Markdown 手工用例，不是自动化脚本。系统生成的业务主键写成 `{placeholder}`，`Construction` 列留空；回填由 [`testdata-generation`](https://github.com/openqa-cn/openqa-skills/blob/main/skills/testdata-generation/README.zh-CN.md) 执行。只装本 skill 时，库是完整的设计产物，不能直接打真实后端。

更新：对 `prd/` git 基线和 `code/` 各仓 `HEAD`（记在 registry `_meta`）做 diff → 写 `change-impact-analysis.md` → 确认 → 只改受影响用例。

## 机制

### 1. 分阶段落盘

用例 `.md` 出现之前必须已有：

| 文件 | 内容 |
| --- | --- |
| `analysis.md` | 需求边界、接口与工程信息、调用链、风险；冲突在 §1.6 |
| `design.md` | 模块验证点、数据实体及依赖 |
| `api-details.md` | 接口 FQCN、请求/响应 |
| `case-registry.json` | 计划条目：`caseId`、`coverage`、`status` |

代价是 token 比「PRD 直出用例」高。收益：Phase 2 确认时改的是表，不是上百个文件；子 agent 只读本模块行；断点按磁盘状态恢复。

### 2. Registry 先于文件

`case-registry.json` 在生成 `.md` 之前写入，每条带 UUID，`status` 为 `pending` 或 `done`。

- 条目数 N 先声明；生成后 `cases.length` 必须等于 N，且 `usecases/cases/` 下 `.md` 数量等于 N。
- resume 读磁盘：无 `analysis.md` → Phase 1；有 `pending` → 只跑 Phase 3 Step Two。不依赖对话记忆。

`caseId` 用 UUID，不用 `TC-001`（并行写入和中途插入会打乱序号）。文件名用 `caseName`。

### 3. 工程标识：明示或 `TBD`

字段名只允许来自 `integrations-resolved.json` 的 `profile.components[].fields`，以及 Server APIs 的 serviceId / 协议 / 接口名。值只允许来自 `analysis.md` §1.3 或源材料原文。否则写 `TBD (engineering info missing)`。

禁止根据「说得通」补表名或 cache key。`TBD` 表示缺料，需要补源材料后再填。

### 4. 占位符与数据构造解耦

`{placeholder}` 表示系统生成 ID（订单号、券码等）。本 skill 只定义数据需求（`design.md` §2）。构造与回写由 `testdata-generation` 完成。禁止用编造值填占位符。

### 5. 门禁 R1–R4

| 门 | 对象 | 时机 |
| --- | --- | --- |
| R1 | `analysis.md` | Phase 1 结束后 |
| R2 | `design.md` + `api-details.md` | Phase 2 结束后、确认前 |
| R3 | `case-registry.json` | 注册表写入后、写 `.md` 前 |
| R4 | 各用例 `.md` | 写盘后 |

每道门由独立子 agent 执行，主 agent 只传规则文件绝对路径，不转述规则正文。R2/R3 在落盘前拦截缺口和冗余。

### 6. 结构检查用脚本

`generation/quality-gates/lint_case_documents.ts` 检查表头、空 `Construction`、占位符形态、标题层级、工程表列是否与 `--resolved` 的 profile 一致。表头不写死 Redis/KV/Thrift。

R4 分两遍：lint 处理确定性规则；语义（步骤是否可执行、期望是否具体）仍由模型按 `gate-case-quality.md` 判断。

### 7. 更新：基线 diff

生成结束时：`git -C prd/ commit` 作为 PRD 基线；各 `code/*` 的 `HEAD` 写入 `_meta.last_code_commits`。

更新时对基线 diff。变更点匹配：

- 可检索旧值（版本号、错误码、接口名）→ `grep` `usecases/cases/`
- 无稳定字符串的规则变化 → 与 registry 里 `business_rules_digest` 做语义比对

每个变更点独立判断「改已有」和「需新建」。`prd/` 不会自动拉远程；只认覆盖写入磁盘的内容。托管平台上改、本地未覆盖，diff 为空。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。

## 流水线

Agent 先读 `generation/generate-skill.md`，再按 resume 表打开**一个** `phase-*.md`。

```text
生成
  Phase 0   validate_integrations.ts          integrations-resolved.json
            git init prd/                     prd/.git、registry._meta
  Phase 1   需求分析 + R1                     analysis.md
            知识召回（可选）                  changed-interface-knowledge.json
            §1.6 冲突则停
  Phase 2   测试设计 + 接口查询 + R2          design.md, api-details.md
            确认（必停）
  Phase 3   用例设计 + R3                     case-registry.json (pending)
            并行生成 + lint + R4              usecases/cases/{module}/*.md (done)
            总览图
            可选 testdata-generation

更新
  Phase 0   覆盖 prd/ + code git diff
  Phase 1   变更点                            PRD text/semantic，代码 search_key
  Phase 2   命中已有用例                      grep + digest
  Phase 3   增量设计                          change-impact-analysis.md
            确认（必停）
  Phase 4   并行 update / gen                 受影响 .md + registry
            需重建数据则交 testdata-generation
```

`analysis.md` / `design.md` / `case-registry.json` 分文件存储，resume 不重放 Phase 1。游标是 registry 的 `pending` / `done`。

## 运行时

推理由宿主 agent（Cursor / Claude Code / Codex / OpenClaw）完成。指令在 `SKILL.md`、`generation/`、`maintenance/`，按阶段加载。用例质量随模型变化；registry 条数校验、lint、`TBD` 规则与模型无关。

## 相关文件

| 内容 | 路径 |
| --- | --- |
| 安装与零配置 | [README](README.zh-CN.md) |
| 未覆盖能力 | [已知边界](KNOWN_LIMITATIONS.zh-CN.md) |
| Agent 入口 | [`SKILL.md`](SKILL.md) |
| 生成编排 | `generation/generate-skill.md` |
| 更新流程 | `maintenance/update-skill.md` |
| HTTP 适配契约 | [`integration-api.md`](references/integration-api.md) |
| 仓库运行时矩阵 | [SUPPORT_MATRIX](https://github.com/openqa-cn/openqa-skills/blob/main/docs/SUPPORT_MATRIX.zh-CN.md) |
| 文档放置规则 | [ARCHITECTURE](https://github.com/openqa-cn/openqa-skills/blob/main/docs/ARCHITECTURE.md) |
