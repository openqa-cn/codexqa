# 搜索意图地图

每个 URL **只承担一个主意图**。品牌词（`codexqa`、`openqa-cn`）不做投放主词，随站外提及自然起来。品类词和 how-to 词打 [openqa.cn](https://openqa.cn/)，而不是 `github.com` 上的 README。

默认站点：`https://openqa.cn`。GitHub 仍是安装源和社交证明。不要再发布第二套文档站。

## 怎么用这张表

- 标题和首段用搜索者的词，然后再出现 skill 名。
- 不要把两个 skill 塞进同一个着陆 URL。
- Search Console 或百度统计出现有曝光、没有专页的词时，补行而不是改挤旧页。

## 品类意图

| 主查询（en） | 主查询（zh） | 着陆 URL | 引擎 |
| --- | --- | --- | --- |
| Agent Skills for QA / verification | Agent Skills 测试验证 / AI 辅助测试 | `/` 与 `/zh/` | Google、Bing、百度 |
| local-first code review skill Cursor | Cursor 本地代码审查 Agent Skill | `/` | Google、Bing |
| AI test case generation from PRD | 根据 PRD 生成测试用例 | `/skills/codexqa-testcase-generator` | Google、Bing、百度 |

## 按 skill 的任务意图

| Skill | 主查询（en） | 主查询（zh） | 着陆 URL | 支撑长尾 |
| --- | --- | --- | --- | --- |
| `codexqa-skill-router` | which Agent Skill to install for QA | 不确定用哪个测试 Skill | `/skills/codexqa-skill-router` | Cursor 自动选型、`npx skills add` 路由 |
| `codexqa-requirement-analyzer` | review PRD completeness and testability | PRD 需求评审 缺口 冲突 | `/skills/codexqa-requirement-analyzer` | 需求缺口登记表、可测试验收标准 |
| `codexqa-testcase-generator` | generate manual test cases from requirements | 需求文档生成手工用例 | `/skills/codexqa-testcase-generator` | 从 PRD 出测试方案、Cursor 用例设计 |
| `codexqa-testdata-generator` | construct test data and backfill placeholders | 测试数据构造 回填用例 | `/skills/codexqa-testdata-generator` | OpenAPI 造数、用例 `{placeholder}` |
| `codexqa-code-wiki` | generate architecture wiki from a repo | 代码仓库架构 Wiki / 知识图谱 | `/skills/codexqa-code-wiki` | 模块地图、新人阅读路径、不调模型 |
| `codexqa-code-analyzer` | change impact analysis symbol graph | 变更影响分析 调用链 回归范围 | `/skills/codexqa-code-analyzer` | 调用图测试缺口、Cursor 影响面 |
| `codexqa-rootcause-analyzer` | root cause analysis from stack traces | 根据堆栈日志做根因分析 | `/skills/codexqa-rootcause-analyzer` | 本地仓崩溃 RCA、异常诊断 skill |
| `codexqa-defect-analyzer` | SAST plus LLM code-risk scan | SAST 代码风险扫描 Agent | `/skills/codexqa-defect-analyzer` | 密钥 SCA Cursor、`report_scan.html` |
| `codexqa-code-reviewer` | graph-evidence code review HTML report | 基于证据包的代码审查报告 | `/skills/codexqa-code-reviewer` | `REVIEW-REPORT.html`、Agent LLM judgment |

## 对比意图

| 主查询（en） | 主查询（zh） | 着陆 URL |
| --- | --- | --- |
| Agent Skill vs linter vs code-review prompt | 代码审查 Agent 和 linter 有什么区别 | `/compare` |
| local-first SAST vs uploading code to a SaaS scanner | 本地优先代码扫描 vs 云端 SAST | `/compare` |

## 证据与案例意图

| 主查询（en） | 主查询（zh） | 着陆 URL |
| --- | --- | --- |
| sample defect detection HTML report | 缺陷检测 HTML 报告样例 | `/cases` |
| requirement mismatch findings example | 需求和实现不一致 报告 | `/cases` |

## 生态意图

| 主查询（en） | 主查询（zh） | 着陆 URL |
| --- | --- | --- |
| `npx skills add` Cursor | Cursor 安装 Agent Skill | `/getting-started` |
| Agent Skills OpenClaw Codex Claude | 在 Claude Code / Codex 安装 skill | `/getting-started` |
| `@openqa-cn/codexqa` CLI | CodexQA CLI 符号图 | `/getting-started` |

## URL 清单

| 路径（openqa.cn） | 事实来源 | 语言 |
| --- | --- | --- |
| `https://openqa.cn/` | 产品首页（OpenQA Skills） | 中文默认 / 英文切换 |
| `https://openqa.cn/` 技能目录 | 各 skill 的 GitHub README | zh / en |
| 单 skill how-to（没有就补） | `skills/<name>/README*.md` | 跟线上 IA |
| 对比 / 案例 / FAQ | 做在 openqa.cn，素材用仓库 FAQ / 预览图 | zh / en |

## 分引擎优先级

| 引擎 | 打赢条件 | 不要指望 |
| --- | --- | --- |
| Google | 任务页 + FAQPage + 英文 how-to | 第一个月品类词第一 |
| Bing | 同一站点 + 发布时 IndexNow | 另做一套内容 |
| 百度 | openqa.cn 中文标题、主动推送、国内可访问 | `github.com` URL 稳定排名 |
| 头条搜索 | 头条号文章重复任务意图 | 链接权重传给 GitHub |
