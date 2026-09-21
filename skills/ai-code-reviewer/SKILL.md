---
name: ai-code-reviewer
description: >
  Graph-evidence AI code review (ai-code-reviewer) for ANY language repo using
  ONLY the CodexQA CLI symbol graph (call chains, classes, methods, configs,
  blast radius, test edges), then an order-16 Agent LLM judgment pass by the
  host agent's embedded model with deterministic dedupe/merge against heuristic
  findings. Use when the user asks for ai-code-reviewer, code review, PR review,
  代码评审, impact analysis, 影响面, regression scope, test gaps, full-repo health
  review, 全仓评审, CodexQA evidence-pack, 证据包, graph-backed review, or LLM
  semantic CR on a pack. Requires codexqa CLI for every language; never embeds
  CodexQA source; never substitutes git-diff-only analysis.
  Not SAST+agent scan reports
  (that is defect-detection), not structure/impact mapping alone
  (that is code-analyzer), and not exception RCA (that is root-cause-diagnosis).
license: Apache-2.0
compatibility: >
  Requires Node.js >= 18, bash 3.2+, jq, Python 3.10+ (via `scripts/acr-python`),
  and the `codexqa` CLI (`npm i -g @openqa-cn/codexqa`) on PATH for every language.
  Collect / validate / render / merge-llm-findings need no external LLM API; review
  prose and the order-16 semantic pass use the host agent's embedded model. Data lands under
  `<repo>/.codexqa-review/<run-id>/`.
metadata:
  author: open-source
  version: "0.0.3"
  open-standard: agentskills
---

# AI Code Reviewer

Graph-first code review via **CodexQA CLI** only. Collect a JSON evidence pack,
then reason from those artifacts. Applies to every language / polyglot monorepo.

CLI: `{baseDir}/scripts/collect-pr-evidence.sh` (and full-repo / adhoc variants).
Runtime pack: `<repo>/.codexqa-review/<run-id>/` → `review-conclusion.json` +
`REVIEW-REPORT.html`.

**Install:** Prefer `npx skills add openqa-cn/codexqa --skill ai-code-reviewer`.
Do not copy into a skills library manually until the user names the install target.

`README.md` / `README.zh-CN.md` / `HOW_IT_WORKS.md` / `KNOWN_LIMITATIONS.md`
(and their `.zh-CN` twins) are human-facing. Do not load them at runtime.

## Boundaries

| Need | Skill |
|---|---|
| Graph-evidence pack → bilingual HTML CR (`REVIEW-REPORT.html`) | **this skill** (`ai-code-reviewer`) |
| SAST + Agent LLM Detection → `report_scan.*` | `defect-detection` |
| Symbol-graph change impact, callers, test gaps | `code-analyzer` |
| Exception RCA from stacks/logs on top of CLI analysis | `root-cause-diagnosis` |

## Prerequisites

| Dependency | Why |
|---|---|
| `codexqa` on PATH (`npm i -g @openqa-cn/codexqa`, Node ≥ 18) | Sole primary analysis backend |
| `jq` | Evidence JSON / HTML render |
| `bash` 3.2+ | Collect / validate / render scripts (macOS OK) |
| Python 3.10+ (`scripts/acr-python`) | Local `derive-*` helpers / validate-skill gate |

Local skill gate (Eval substitute when `skill-up` is missing):

```bash
./scripts/validate-skill.sh
```

## Quick start

```text
Task progress:
- [ ] 1. Preflight (codexqa + jq + Python 3.10+)
- [ ] 2. Collect evidence pack → OUT_DIR
- [ ] 3. Validate (auto unless --skip-validate)
- [ ] 4. Lock primary_language / review_language_focus
- [ ] 5. Review from pack artifacts only (heuristic dimensions)
- [ ] 5b. Agent LLM judgment pass + dedupe merge (`merge-llm-findings.py`)
- [ ] 6. Write review-conclusion.json + render REVIEW-REPORT.html
```

```bash
# PR / diff (default)
./scripts/collect-pr-evidence.sh --repo /path/to/repo --diff-base origin/main

# Full-repo (optional)
./scripts/collect-fullrepo-evidence.sh --repo /path/to/repo

# Adhoc / single-file (no PR diff-base)
./scripts/collect-adhoc-evidence.sh --file /path/to/Foo.java

# After review reasoning:
./scripts/render-review-html.sh --dir <OUT_DIR>
```

Default OUT_DIR: `<repo>/.codexqa-review/<run-id>/` with runtime **`manifest.json`**
(+ `09-language-profile.json`). `templates/evidence-manifest.json` is schema-only —
never written by collectors.

## Hard constraints (CodexQA mandate)

1. **CLI only** — call `codexqa` on PATH. Never vendor / unzip / import `@openqa-cn/codexqa`.
2. **Evidence files first** — the CodexQA evidence pack is a **hard prerequisite** (前置必要条件).
   Impact, callers, entries, coverage must **cite artifact** fields.
3. **No invented graph** — missing facts → `confidence: UNKNOWN`. Never fake green from `test/` paths.
4. **PR gates** — need code identity (`REPO`) + reviewable change (`--diff-base`). Else `status: blocked`.
5. **Human merge decision** — actionable review only; never auto-approve.
6. **No alternate primary backend** — forbid git-diff-only, grep-only “call graph”, or language SAST
   (SpotBugs/ESLint/mypy/…) as the sole engine. Missing/invalid pack →
   `missing_gate: missing_codexqa_engine` (or specific gate).
7. **Primary language gate** — read `09-language-profile.json` / `manifest.primary_language` /
   `review_language_focus` before findings; apply
   [references/review-dimensions.md](references/review-dimensions.md)
   ([references/language-profile.md](references/language-profile.md)).
   Override with `--primary-lang` only when detection is wrong. Label uncertainty for
   reflection / dynamic dispatch / cross-language FFI — do not leave CodexQA.

## Modes

| Mode | When | Script |
|---|---|---|
| **PR/diff (default)** | Branch/PR vs base | `scripts/collect-pr-evidence.sh` |
| **Full-repo (optional)** | Health / architecture / hotspots | `scripts/collect-fullrepo-evidence.sh` |
| **Adhoc (single-file)** | Upload one/few files without PR | `scripts/collect-adhoc-evidence.sh` |

Full-repo deliverables: hotspot modules (ranked by **edges-in**, not `from_count`), layering drift (入口 → 应用 → 领域 → 存储),
entry concentration, hardening backlog P0/P1/P2. Never invent PR `change_status`.
No product scorecard / 产品评测打分.

Adhoc: bootstraps a mini git repo when `--repo` is omitted so CodexQA index gates pass; validate with `--mode adhoc`.

## Capability → pack map

| Capability | Pack evidence |
|---|---|
| Change localization | `03-change-groups` / `05-changed-symbols` / `diffs/*.diff.json` |
| Design fit | `10-design-fit-signals.json` (path + package/import layers, `import_cross_layer`, `dead_nested_symbols` confirmed via empty edges-in; full: `imports/` + on-disk fallback) |
| Complexity | `11-complexity-signals.json` (method LOC / decisions / nesting / YAGNI hints) |
| Dependencies | `12-dependency-signals.json` (manifest/lock SNAPSHOT, lock drift, license clues, local audit) |
| Privacy | `13-privacy-signals.json` (PII fields, log exposure, retention gaps, consent/transfer clues) |
| Resilience | `14-resilience-signals.json` (timeout, retry, swallow, partial fail, idempotency/compensation) — signal hits → findings hard gate |
| Change / rollout | `15-rollout-signals.json` (migration, dual-write, flags, compat window, breaking announce, rollback) |
| Observability | `16-observability-signals.json` (catch without log/metric/trace) |
| Contract | `17-contract-signals.json` (breaking hints, XSS/HTML sinks, public-sig volume) |
| Maintainability | `18-maintainability-signals.json` (TODO/FIXME, magic numbers, long files) |
| Performance | `21-performance-signals.json` (hot path, N+1, unbounded allocation) |
| Agent LLM judgment | `22-llm-judgment.json` (host-agent semantic CR + dedupe merge vs heuristic findings) |
| Annotation callbacks | `19-annotation-edges.json` (Spring/Resilience4j synthetic callers when edges-in empty) |
| Risk tier (blast-radius triage) | `20-risk-tier.json` (T0–T3 from paths + tags + sensitive + rollout surfaces; auth/pay/migration/IaC → T0) |
| Blast radius | `impact/*/edges-in.json` / `reach-in.json` (PR + full-repo top hotspots) |
| Entry / flow | `07-tags.json` + `impact/*/paths/` |
| Test gaps | `tested_count` + `tests-reach.json` (not test directory / test path names) |
| Sensitive paths | `06-sensitive-hits.json` + callers |
| Hot-but-thin | `08-hot-but-thin.json` |
| Full-repo architecture | `stats` / `summary` / `imports/` + Design fit signals |
| Primary language | `09-language-profile.json` + manifest stamps |

## Workflow detail

### 1. Preflight

```bash
command -v codexqa || { echo "install: npm i -g @openqa-cn/codexqa"; exit 1; }
command -v jq >/dev/null
codexqa --version
```

PR: `REPO` + `DIFF_BASE`. Full-repo: `REPO` only. Prefer absolute repo paths.

### 2. Collect

Shared helpers: `scripts/lib/codexqa-preflight.sh`.
Options: `--full`, `--primary-lang <Lang>`, `--skip-index`, `--skip-validate`, `--out DIR`.

### 3. Validate

```bash
./scripts/validate-evidence.sh --dir <OUT_DIR> --mode pr   # or --mode full
```

Fails: missing CodexQA provenance; empty change-groups; all `change_status=default`;
`lang_stats` present but `primary_language` null. Legacy packs may WARN and still pass.

`stubs≥20` (numeric or `{total:N}`) → cap edge/reach findings at **UNKNOWN**; do not treat `from_count` as real fan-in — prefer `edges-in` callers.

### 4. Review from artifacts

1. Read [prompts/pr-diff-review.md](prompts/pr-diff-review.md) or
   [prompts/full-repo-review.md](prompts/full-repo-review.md).
2. Confirm `manifest.engine` is `codexqa` (or legacy codexqa in commands). Else blocked.
3. Lock language from `manifest.json` + `09-language-profile.json`.
4. For top risks: `diffs/`, `impact/<id>/`, `paths/`, then tags / hot-but-thin / sensitive.
5. Mermaid from [references/mermaid-evidence.md](references/mermaid-evidence.md).
6. **Agent LLM judgment (order 16):** follow [prompts/llm-judgment-pass.md](prompts/llm-judgment-pass.md)
   — host embedded model reviews pack-scoped diffs/sources; run
   `scripts/lib/merge-llm-findings.py` so final `p0`/`p1`/`p2` are **deduped** against
   heuristic findings (`22-llm-judgment.json`).

### 5. Deliver

1. Optional chat notes: [templates/review-report.md](templates/review-report.md)
2. **Required:** `<OUT_DIR>/review-conclusion.json` from
   [templates/review-conclusion.json](templates/review-conclusion.json)
3. **Required:** `./scripts/render-review-html.sh --dir <OUT_DIR>` → **`REVIEW-REPORT.html`**

Cover: 变更摘要、主开发语言、**有问题的维度**（Design / Complexity / Dependencies /
Resilience / Privacy / Rollout / Performance / Agent LLM judgment 等 — `ok`/`none` 不进报告）、总风险、P0/P1/P2、
回归必测清单、测试缺口、敏感路径、卡片内调用链路。
**不渲染：** 建议修复顺序、残留风险与假设、独立影响面示意。
`render-review-html.sh` 会过滤干净维度；仍须在 `review-conclusion.json` 写全评估结果与
`dimensions_covered`。Final findings must already be **dedupe-merged** (no duplicate
heuristic + LLM cards for the same defect).

High-severity findings cite: symbol id/file/lines, callers or entry path,
`tested_count` / tests-reach, confidence (high|medium|low|**UNKNOWN**).
Human-facing prose (dimension `hotspots`, finding risk/evidence, summary) must
explain risks in plain language — see [references/review-dimensions.md](references/review-dimensions.md)
**Reader prose**.

**Bilingual HTML:** Write primary prose in Chinese (`summary`, `intent`, `scope`,
dimension `risk`/`yagni`/`evidence`, finding `title`/`risk`/`evidence`/`fix`,
`call_chain.title`, regression/test-gap notes, `sensitive`) **and** matching
`*_en` siblings (`summary_en`, `intent_en`, `risk_en`, `title_en`, …). The HTML
toolbar switches `data-zh`/`data-en`; missing `*_en` falls back to Chinese and
breaks EN mode — treat bilingual prose as required for delivery.

## Blocked result

```markdown
### Code Review Blocked
- status: blocked
- missing_gate: missing_codexqa_engine | missing_code_identity | missing_reviewable_change | ...
- supplied: ...
- required: ...
- next_commands: ...
```

Do not emit P0/P1/P2 or merge advice when blocked.

## Examples

End-to-end walkthrough: [examples/pr-review-walkthrough.md](examples/pr-review-walkthrough.md)

## Progressive disclosure

- CLI contract: [references/codexqa-cli-contract.md](references/codexqa-cli-contract.md)
- Language profile: [references/language-profile.md](references/language-profile.md)
- Industry bar: [references/industry-bar.md](references/industry-bar.md)
- Dimension registry: [references/dimension-registry.md](references/dimension-registry.md)
- Dimensions: [references/review-dimensions.md](references/review-dimensions.md)
- Design fit card: [references/dimensions/design-fit.md](references/dimensions/design-fit.md)
- Complexity card: [references/dimensions/complexity.md](references/dimensions/complexity.md)
- Dependencies card: [references/dimensions/dependencies.md](references/dimensions/dependencies.md)
- Privacy card: [references/dimensions/privacy.md](references/dimensions/privacy.md)
- Resilience card: [references/dimensions/resilience.md](references/dimensions/resilience.md)
- Change / rollout card: [references/dimensions/rollout.md](references/dimensions/rollout.md)
- Risk tier card: [references/dimensions/risk-tier.md](references/dimensions/risk-tier.md)
- Observability card: [references/dimensions/observability.md](references/dimensions/observability.md)
- Contract card: [references/dimensions/contract.md](references/dimensions/contract.md)
- Maintainability card: [references/dimensions/maintainability.md](references/dimensions/maintainability.md)
- Performance card: [references/dimensions/performance.md](references/dimensions/performance.md)
- Agent LLM judgment card: [references/dimensions/llm-judgment.md](references/dimensions/llm-judgment.md)
- LLM judgment pass prompt: [prompts/llm-judgment-pass.md](prompts/llm-judgment-pass.md)
- Correctness family checks: [references/dimensions/correctness-family-checks.md](references/dimensions/correctness-family-checks.md)
- Eval gate: `scripts/validate-skill.sh` + [evals/eval.yaml](evals/eval.yaml)
- Plan audit: `scripts/audit-plan-coverage.sh` → [examples/plan-coverage-audit.md](examples/plan-coverage-audit.md)

## Common pitfalls

- Do not treat README / subjective scoring as graph evidence.
- Do not equate “file under `test/`” / test directory names with `tests` edges
  (`tested_count > 0`). Path names do not prove coverage.
- Do not run `codexqa wiki` / `chat` unless the user asks (LLM cost).
- Do not claim reflective / cross-language calls are complete; label uncertainty.
- Multi-branch: pin `@branch` on `repo_id`; do not guess.
- Never skip CodexQA for Java/Go/TS “to save time”.
- Never invent primary language from folders/README.
