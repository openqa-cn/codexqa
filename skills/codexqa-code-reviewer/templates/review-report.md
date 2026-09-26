# Code Review Report

> After filling this Markdown (or instead for the shareable artifact), write
> `review-conclusion.json` (see [review-conclusion.json](review-conclusion.json))
> into the evidence pack and run:
>
> ```bash
> ./scripts/render-review-html.sh --dir <OUT_DIR>
> ```
>
> → `<OUT_DIR>/REVIEW-REPORT.html` (required deliverable).
>
> **Report surface rule:** HTML (and optional Markdown notes) **only list dimensions
> with issues** (`verdict` = `concern` / `unknown`, or Design-fit subsections with
> those verdicts). Clean dims (`ok` / `none`) stay in `review-conclusion.json` +
> `dimensions_covered` for audit, but **must not** appear as empty “None/ok”
> sections in the report. `render-review-html.sh` enforces this filter.
>
> HTML chrome supports **中文 / EN** and **白天 / 黑夜** toggles (sticky toolbar;
> preferences stored in `localStorage`). Agent-authored finding/dimension prose stays
> in the language it was written; UI labels switch.

- **mode**: pr-diff | full-repo
- **skill**: codexqa-code-reviewer
- **analysis_backend**: codexqa-cli (required for all languages)
- **repo**:
- **diff_base** (pr only):
- **evidence_dir**:
- **codexqa_version**:
- **languages** (from summary / manifest.lang_stats):
- **primary_language** (from `09-language-profile.json` / manifest):
- **review_language_focus**:
- **is_polyglot** / secondary languages:
- **language_confidence**: high | medium | low | UNKNOWN
- **index_confidence**: high | medium | low | UNKNOWN（写入 JSON 即可；**HTML 页头不展示**）

---

## 1. Change Summary and Overall Assessment

_(full-repo: use “Repo snapshot and overall risk”)_

- Business / intent (if known):
- Primary language rationale (cite language-profile share / override):
- Scope size (from change-groups / files / symbols):
- Overall risk: **High | Medium | Low** — one-line rationale
- Graph caveats (stubs, collisions, truncated, missing tags/search):
- Hot-but-thin highlights (from `08-hot-but-thin.json` or full-repo hotspots):

## 1a. Risk tier / 爆炸半径分档 (pre-pipeline)

_(Always lock from `20-risk-tier.json` before dimension depth. T0 = highest blast. auth/pay/migration/IaC → T0. Missing file → escalate manually; do not invent a lower tier. Always include when `20-risk-tier.json` exists — meta triage, not a clean/omit dimension.)_

- Tier (T0–T3) / industry_tier (Tier3–Tier1):
- Evidence floor (`full_checklist` | `trimmed_checklist` | `spot_check` | `sample_ci`):
- Drivers (paths / tags / sensitive / rollout surfaces):
- Evidence: `20-risk-tier.json`

## 1b–1g. Dimension blocks (issues only)

_(Evaluate every registry dimension into `review-conclusion.json` + `dimensions_covered`.
**In this report / HTML:** emit a dimension section **only** when that dim (or a
Design-fit subsection) has `verdict` `concern` or `unknown`. Omit `ok` / `none`
blocks entirely — do not write “None” filler sections.)_

**每张出现的维度卡必须有 `risk`（HTML「风险说明」）：** 用通俗话写清本仓库具体代码风险
（哪段代码 / 哪条用户或运行路径 / 会怎样坏）。禁止只有 verdict + 信号文件名。

### 1b. Design / 架构契合 (only if concern)

_(When emitting: include **only** subsections that are concern/unknown — Belong /
Layer / Over-engineering / Timing. Each concern subsection needs `risk` or risk-worded `notes`.)_

### 1c. Complexity / 认知负担 (only if concern)

- **风险说明** (`risk` / `hotspots`): 用通俗话写清「哪段代码难改、落在什么用户路径、改坏会怎样」；禁止整段粘贴 `loc_high+untested` / `edges-in=N`
- 过度设计 / 依据: `11-complexity-signals.json`

### 1d. Dependencies / 供应链 (only if concern)

- **风险说明** (`risk`) + necessity / reproducibility / license / vuln: `12-dependency-signals.json`

### 1e. Resilience / 错误处理与韧性 (only if concern)

- **Hard gate (always, even when section omitted from HTML):** non-empty
  `silent_swallows` / `timeout_gaps` / `retry_risks` / `partial_failure_gaps` /
  `idempotency_gaps` → each hit must appear as a finding or explicit deferred
  residual with `path:line`.
- **风险说明** (`risk`) + silent swallow / timeouts / retries / …
- Evidence: `14-resilience-signals.json`

### 1f. Privacy / 合规 (only if concern)

- **风险说明** (`risk`) + minimization / logging / retention / consent: `13-privacy-signals.json`

### 1g. Change / rollout / 变更与发布风险 (only if concern)

- **风险说明** (`risk`) + migrations / dual-write / flags / compat / announce / rollback: `15-rollout-signals.json`

### 1h. Performance / 性能专项 (only if concern)

- **Hard gate (always, even when section omitted from HTML):** non-empty
  `n_plus_one_risks` / `hot_path_risks` / `unbounded_allocation` → each hit
  must appear as a visible finding with `path:line` (family F2 in `references/rule-construction.md`; do not defer the row to `residual_risks`).
- **风险说明** (`risk`) + N+1 / hot path / unbounded allocation
- Evidence: `21-performance-signals.json`

## 2. Findings (severity descending)

一张卡一个失败场景。标题写后果，不写规则名。正文四句：谁（`actor`）、什么输入（`input`）、哪一行（`line`）、账户变成什么样（`outcome`）。修法（`fix`）单独一句。同一根因且同一种修法才合并，把其余行放进 `also_lines` 并设 `same_fix: true`（页面写「另见第 N 行」）。触发条件或账务结果不同就拆开。`getFxRate()` 放大入账和 `BigDecimal.equals` 放过限额是两张卡。

调用链路、变更状态、分类、入口默认折叠。**不展示：** 符号 id、tested_count、置信度、stub 数量、UNKNOWN 封顶、独立「影响面示意」整节。无调用方只写「未记录调用方」，不解释索引不完整。

魔法数、超长文件、过期 import 写入 `conventions`，不进入 P0/P1/P2。状态码和 URL 若改变分支或账务结果，仍是单独的缺陷卡。

`call_chain` 推荐写法（edges-in / 生产路径证据）：
```json
"call_chain": {
  "title": "生产绘制主路径",
  "paths": [["border_draw", "knit_draw", "knit_get_tile", "knit_make_tile"]],
  "focus": ["knit_draw", "knit_make_tile"]
}
```
也可用字符串数组 `["A","B","C"]`。缺省时若有 `callers[]`，渲染器会画「调用方 → 缺陷点」兜底图。

### [P0 - Blocker]

_None_ or items:

#### 网关失败后钱加到了收款方

- id (`D-001`; renderer assigns one when omitted; the same id is used in `review-comments.json`):
- actor / input / line / outcome:
- existing_code (short snippet that appears in that file's diff; omit on old conclusions):
- also_lines + same_fix (only when the fix is identical):
- Fix (one sentence):
- Call chain, change status, category, entry (collapsed in HTML):

### [P1 - Should fix this iteration]

_None_ or same structure.

### [P2 - Optional]

_None_ or short list.

## 3. Regression must-test list

面向测试/开发同学的**可执行回归场景**（不是符号名清单）。每行必须让未读过证据包的人也能照做。

| 回归测试场景（测什么） | 为什么必测 | 依据说明（通俗） |
|---|---|---|
| （示例）校验「买家 ID」：传入两个**内容相同但不是同一对象**的字符串，期望判定为同一买家 | 本次把字符串比较从引用相等改成了内容相等，避免误判 | 变更方法 `isSameBuyer`（订单域）；问题出在相等判断逻辑 |

**写作硬规则：**
- **目标列**：用完整场景句写清「入口/调用方 + 输入条件 + 期望结果」；可附方法名，但**禁止**只写方法名或参数片段。
- **原因列**：用业务/风险语言说明为何不测会出问题（少用纯缩写堆砌；必要时括号补全，如「数组越界」）。
- **证据列**：写人能读懂的依据（改了什么、哪个类/方法、哪类调用方）。**禁止**把 `05-changed-symbols`、`source:104`、裸 UUID/`symbol <id>`、`hot-but-thin` 当作证据正文；内部路径/id 最多放在句末括号作附录。

## 4. Test gaps (JSON only, not rendered)

Do **not** emit an HTML「测试缺口」section or symbol table. `seal-conclusion.py`
still writes `test_gaps` into `review-conclusion.json` so the closure gate can
see production symbols with `tested_count==0`. A static initializer, a type or
constructor, a get/set/is accessor, or a private helper goes to `waived_symbols`.
Coverage is still `tested_count` / tests-reach, not a test directory name.

## 5. Sensitive paths

_None_ or hits intersecting change / high fan-in, with callers.

## 6. Call-chain graphs (on cards)

Do **not** emit a standalone「影响面示意」section. Put pack-backed paths on each
finding / concern dimension via `call_chain` (pure HTML in the report). See §2.

**Do not** emit HTML sections「建议修复顺序」or「残留风险与假设」— low signal for readers.
`fix_order` / `residual_risks` in JSON are optional audit leftovers only (not rendered).

