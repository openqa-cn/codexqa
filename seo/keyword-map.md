# Search intent map

Each URL below has **one primary intent**. Brand queries (`codexqa`, `openqa-cn`) are not campaign targets; they follow from off-site mentions. Rank [openqa.cn](https://openqa.cn/), not `github.com` URLs, for category and how-to terms.

Default host: `https://openqa.cn`. GitHub remains the install source and social proof. Do not publish a second docs host.

## How to use this map

- Write the page title and first paragraph in the searcher's words, then name the skill.
- Do not merge two skills onto one landing URL.
- Refresh this table when Search Console or 百度统计 shows queries with impressions but no dedicated page.

## Category intents

| Primary query (en) | Primary query (zh) | Landing URL | Engines |
| --- | --- | --- | --- |
| Agent Skills for QA / verification | Agent Skills 测试验证 / AI 辅助测试 | `/` and `/zh/` | Google, Bing, Baidu |
| local-first code review skill Cursor | Cursor 本地代码审查 Agent Skill | `/` | Google, Bing |
| AI test case generation from PRD | 根据 PRD 生成测试用例 | `/skills/codexqa-testcase-generator` | Google, Bing, Baidu |

## Task intents by skill

| Skill | Primary query (en) | Primary query (zh) | Landing URL | Supporting long-tail |
| --- | --- | --- | --- | --- |
| `codexqa-skill-router` | which Agent Skill to install for QA | 不确定用哪个测试 Skill | `/skills/codexqa-skill-router` | auto-select Cursor skill, `npx skills add` router |
| `codexqa-requirement-analyzer` | review PRD completeness and testability | PRD 需求评审 缺口 冲突 | `/skills/codexqa-requirement-analyzer` | requirement gap register, testable acceptance criteria |
| `codexqa-testcase-generator` | generate manual test cases from requirements | 需求文档生成手工用例 | `/skills/codexqa-testcase-generator` | test plan from PRD, Cursor test design skill |
| `codexqa-testdata-generator` | construct test data and backfill placeholders | 测试数据构造 回填用例 | `/skills/codexqa-testdata-generator` | OpenAPI test data, case `{placeholder}` |
| `codexqa-code-wiki` | generate architecture wiki from a repo | 代码仓库架构 Wiki / 知识图谱 | `/skills/codexqa-code-wiki` | module map, onboarding reading path, no-LLM wiki |
| `codexqa-code-analyzer` | change impact analysis symbol graph | 变更影响分析 调用链 回归范围 | `/skills/codexqa-code-analyzer` | test gaps from call graph, Cursor impact analysis |
| `codexqa-rootcause-analyzer` | root cause analysis from stack traces | 根据堆栈日志做根因分析 | `/skills/codexqa-rootcause-analyzer` | crash RCA local repo, exception diagnosis skill |
| `codexqa-defect-analyzer` | SAST plus LLM code-risk scan | SAST 代码风险扫描 Agent | `/skills/codexqa-defect-analyzer` | secrets SCA Cursor, `report_scan.html` |
| `codexqa-code-reviewer` | graph-evidence code review HTML report | 基于证据包的代码审查报告 | `/skills/codexqa-code-reviewer` | `REVIEW-REPORT.html`, Agent LLM judgment |

## Comparison intents

| Primary query (en) | Primary query (zh) | Landing URL |
| --- | --- | --- |
| Agent Skill vs linter vs code-review prompt | 代码审查 Agent 和 linter 有什么区别 | `/compare` |
| local-first SAST vs uploading code to a SaaS scanner | 本地优先代码扫描 vs 云端 SAST | `/compare` |

## Evidence and case intents

| Primary query (en) | Primary query (zh) | Landing URL |
| --- | --- | --- |
| sample defect detection HTML report | 缺陷检测 HTML 报告样例 | `/cases` |
| requirement mismatch findings example | 需求和实现不一致 报告 | `/cases` |

## Ecosystem intents

| Primary query (en) | Primary query (zh) | Landing URL |
| --- | --- | --- |
| `npx skills add` Cursor | Cursor 安装 Agent Skill | `/getting-started` |
| Agent Skills OpenClaw Codex Claude | 在 Claude Code / Codex 安装 skill | `/getting-started` |
| `@openqa-cn/codexqa` CLI | CodexQA CLI 符号图 | `/getting-started` |

## URL inventory

| Path on openqa.cn | Source of truth | Language |
| --- | --- | --- |
| `https://openqa.cn/` | Product home (OpenQA Skills) | zh default / en switcher |
| `https://openqa.cn/` Skills catalog | Each skill’s GitHub README | zh / en |
| Per-skill how-to (create if missing) | `skills/<name>/README*.md` | match the live IA |
| Compare / cases / FAQ | Create on openqa.cn from GitHub FAQ / previews | zh / en |

## Engine priority

| Engine | Win condition | Do not expect |
| --- | --- | --- |
| Google | Task pages + FAQPage + English how-tos | Category-1 ranks in month one |
| Bing | Same site + IndexNow on publish | Separate content set |
| Baidu | Chinese titles on openqa.cn, 主动推送, 国内可访问 | Ranking of `github.com` URLs |
| Toutiao search | 头条号 articles that repeat the task intent | Link equity passed to GitHub |
