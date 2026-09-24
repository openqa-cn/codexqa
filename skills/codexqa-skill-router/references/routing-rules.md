# Routing rules

Reading guide: sections 1–3 for every route; section 4 for ensure/install;
section 5 when the user names a skill or asks for a chain.

## 1. Catalog is the source of truth

Always run:

```bash
python3 <codexqa-skill-router>/scripts/discover_skills.py --with-catalog
```

Treat each `description` as the skill's claim of work and its exclusion list
**after** a winner is chosen. Prefer `source: "live"` entries when both live
and bundled exist for the same name. Bundled-only rows (`installed: false`)
are for **matching**; you must run `ensure_skill.py` before reading `SKILL.md`.
Choosing the winner is section 2, not a keyword overlap against descriptions.

## 2. Decide with suggest_route.py

Descriptions overlap on review / PR / diff / 评审 / 影响面 / HTML / 知识图谱.
Those words are not a score. After discovery, run:

```bash
python3 <codexqa-skill-router>/scripts/suggest_route.py --text "<user message>"
```

Follow `outcome` from the JSON (`clear`, `explicit`, `explicit_conflict`,
`ambiguous`, `chain`, `none`). A `clear` or `explicit` `winner` wins over any
description sentence, including defect-analyzer's "review a diff/MR/PR/commit".
That sentence means an incremental **scan**, not a code review.

| User says something like… | Prefer | Not |
|---|---|---|
| 代码评审 / 走查 / 单文件或整仓评审 / code review / PR·MR review / 审查意见 / 语义评审 / 双语审查 / 证据包 / 合入建议 / 这段代码有没有问题 | `codexqa-code-reviewer` | `codexqa-defect-analyzer` |
| 缺陷检测 / SAST / 漏洞·密钥·依赖·CVE / 安全基线 / 粘贴或上传找漏洞 / `report_scan` / review this diff **for vulnerabilities** | `codexqa-defect-analyzer` | `codexqa-code-reviewer` |
| 影响面 / 谁在调用 / 入口风险 / 敏感路径 / 测试缺口 / 有没有单测 / 回归哪些 / 相对 main 变了什么 / 建索引 / 错误定位 / 模块归属, and no review report | `codexqa-code-analyzer` | reviewer, wiki, defect scan |
| Same impact words inside 代码评审 | `codexqa-code-reviewer` | `codexqa-code-analyzer` |
| 架构 wiki / 模块地图 / 模块划分 / 从哪开始读 / 阅读导览 / 这个模块是干什么 / `wiki inputs` | `codexqa-code-wiki` | impact query or SAST report |
| Bare 知识图谱 / knowledge graph | ask (wiki vs analyzer) | picking either silently |
| 堆栈 / 根因 / 崩溃 / 报错原因 / 线上报错 / 日志里的异常 / 调试输出 / 根因报告, including a call chain used as evidence | `codexqa-rootcause-analyzer` | structure-only or scan report |
| 需求评审 / 需求缺口 / 需求歧义 / 一致性 / 非功能需求 / 能不能测 / requirements review | `codexqa-requirement-analyzer` | code review, case writing |
| 测试方案 / 测试分析 / 写用例 / 方案和用例 / 按 PRD 出测试 / 提测前改用例 / 提测后补用例 / test plan | `codexqa-testcase-generator` | requirement register, live data, unit-test coding |
| 造数据 / 用例物料 / 前置账号 / 造一笔业务数据 / 造数脚本 / 回写前置 / OpenAPI account or script | `codexqa-testdata-generator` | authoring cases from a PRD |
| Jev browser / 浏览器回放 / generate browser UI cases / explore a site | `codexqa-jev-browser` | writing a test plan from a PRD |
| 格式化、自动改代码风格、给函数写单元测试 | ask / none | forcing a pack skill |
| Both review report and scan list, no order | ask | starting either |
| 先评审再扫描, or 先写方案再造数 | `chain` in that order | collapsing to one skill |

`python3 …/suggest_route.py --self-check` is the regression set for this table.
If a fixture and this table disagree, fix both in the same change.

## 3. Ambiguity prompts

Ask with at most three options:

```text
This could be:
1) <skill-a> — <one-line why>
2) <skill-b> — <one-line why>
Which should I run? (or say both in order)
```

Do not start either skill until the user answers, unless they already said
"do both: first A then B".

## 4. Ensure / on-demand install

When the winner has `installed: false`:

1. Ask once to install beside `codexqa-skill-router` (unless the user already authorized
   full auto-route / "按需安装").
2. `python3 …/ensure_skill.py <name> --yes`
3. Re-discover with `--with-catalog`; confirm `skillMd` exists.
4. Only then open that `SKILL.md`.

Offline: `--from-repo /path/to/codexqa`. Failures: surface JSON; do not fake
the worker.

## 5. Explicit name and chains

- If `suggest_route.py` returns `explicit`, route to that named skill.
- If it returns `explicit_conflict`, the named skill's boundary rejects the
  task shape. Warn, offer `alternatives`, and wait. Do not start the named skill.
- For chains, keep a short plan (skill order + stop between steps). Ensure and
  complete one skill's handoff before opening the next `SKILL.md`.

## 6. Extensibility

- **New skill in a full checkout:** add `skills/<name>/SKILL.md`, run
  `scripts/refresh_catalog.py`, commit the updated `references/catalog.json`.
  If it shares a verb with a skill already in `suggest_route.py` (review,
  scan, 评审, 影响面, wiki, 用例, 根因), add a policy branch and a fixture,
  then re-run `suggest_route.py --self-check`.
- **Already installed sibling:** live discovery picks it up with no catalog
  edit (still refresh catalog before release so solo-router installs can match).
  Until it has a policy branch, `suggest_route.py` leaves it to `none` /
  `ambiguous` rather than stealing it with a shared word.
