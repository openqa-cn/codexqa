# Review dimensions and severity

## Analysis backend

All dimensions below are evaluated on **CodexQA CLI evidence packs** for every
language. Language-specific notes refine risk focus; they do not replace CodexQA.
## Severity

| Level | Meaning | Examples |
|---|---|---|
| **P0** | Block merge | Financial loss, severe security, auth bypass, main-path breakage, data corruption, reproducible deadlock/OOM |
| **P1** | Fix this iteration | Likely races, clear perf regressions, broken contracts for known callers, missing tests on entry-reachable / edges-in-evidenced changes, missing core observability |
| **P2** | Optional / debt | Non-core smells, readability, minor perf; keep short |

Critique code, not authors. Prefer stack-compatible fixes; no unauthorized rewrites.

## Dimension pipeline (order)

**Authoritative order:** [dimension-registry.md](dimension-registry.md).
Do not re-order in prompts without updating the registry.

**Pre-pipeline:** **Blast-radius risk tier** — read `20-risk-tier.json`, lock T0–T3
evidence floor, then proceed ([dimensions/risk-tier.md](dimensions/risk-tier.md)).
auth / pay / migration / IaC → T0 deepen. Tier drives depth only; it does not replace
Security or Rollout findings.

1. **Design fit** — belong in repo/layer, boundary/module fit, over-engineering
   ([dimensions/design-fit.md](dimensions/design-fit.md); signals: `10-design-fit-signals.json`)
2. **Complexity** — cognitive load, size/nesting, modify risk, implementation YAGNI
   ([dimensions/complexity.md](dimensions/complexity.md); signals: `11-complexity-signals.json`)
3. **Dependencies / supply chain** — necessity, lock/SNAPSHOT reproducibility, license clues, local-audit posture
   ([dimensions/dependencies.md](dimensions/dependencies.md); signals: `12-dependency-signals.json`)
4. **Correctness / state** — logic bugs, edge cases, wrong state from `symbol-diff` + callers
   (failure-path *policy* — timeout/retry/swallow — lives in Resilience, not here)
5. **Error handling / resilience** — timeout, retry, degradation, circuit break, partial failure,
   idempotency & compensation, silent swallow
   ([dimensions/resilience.md](dimensions/resilience.md); signals: `14-resilience-signals.json`)
6. **Security / sensitive** — auth, token, pay, secret, injection; escalate when graph shows entry reachability
7. **Privacy / compliance** — PII minimization, log redaction, retention/erase/export, consent & cross-border clues
   ([dimensions/privacy.md](dimensions/privacy.md); signals: `13-privacy-signals.json`)
8. **API / contract** — signature/behavior drift vs external callers; breaking hints; XSS/HTML sinks
   ([dimensions/contract.md](dimensions/contract.md); signals: `17-contract-signals.json`)
9. **Change / rollout** — migration, dual-write, feature flags, compat window, breaking announce, rollback
   ([dimensions/rollout.md](dimensions/rollout.md); signals: `15-rollout-signals.json`)
10. **Concurrency / consistency** — races, locks, visibility when language or domain implies it
   (retry/MQ idempotency & compensation → Resilience)
11. **Regression scope** — concrete caller/module list from impact packs
12. **Test gaps** — production changed symbols with `tested_count==0` and empty tests-reach
13. **Observability** — logs/metrics/traces on new failure paths
   ([dimensions/observability.md](dimensions/observability.md); signals: `16-observability-signals.json`; silent swallow → Resilience)
14. **Maintainability** — TODO/FIXME, magic numbers, long files (P2)
   ([dimensions/maintainability.md](dimensions/maintainability.md); signals: `18-maintainability-signals.json`)
15. **Performance** — hot path, N+1, unbounded allocation (not profiler/SLO invention)
   ([dimensions/performance.md](dimensions/performance.md); signals: `21-performance-signals.json`)

Finding `category` values include: `design | complexity | dependencies | correctness | resilience | security | privacy | contract | rollout | concurrency | regression | test_gaps | observability | maintainability | performance | risk_tier | …`.

## Primary language (required)

Before scoring findings, read `09-language-profile.json` / `manifest.primary_language`
and `review_language_focus` (see [language-profile.md](language-profile.md)).

- Use **`review_language_focus`** for which family table row applies to this review.
- Use **`primary_language`** for repo-level claims in the report header.
- If `is_polyglot: true`, also scan `secondary_languages` for cross-boundary risks.
- Never override with README/folder guesses unless the user passed `--primary-lang`.

## Multi-language notes

Apply the family for `review_language_focus` (from CodexQA `lang_stats`, not guesswork):

| Family | Extra focus |
|---|---|
| Java / Kotlin | NPE, transaction boundaries, Spring config, serialization; apply [dimensions/correctness-family-checks.md](dimensions/correctness-family-checks.md) |
| Go | Error wrapping, context cancel, concurrency, nil interfaces; apply correctness-family-checks |
| TypeScript / JS | null/undefined, async races, API typing drift; apply correctness-family-checks |
| Python | None paths, dynamic attrs → mark call-graph uncertainty; apply correctness-family-checks |
| C / C++ / Rust | Memory/lifetime, unsafe, FFI stubs |
| Mixed monorepo | Per-language islands; cross-language edges may be incomplete — label uncertainty |

See also: hot-but-thin **must-read** for `equals` / `hashCode` / `compare*` in
[dimensions/correctness-family-checks.md](dimensions/correctness-family-checks.md).

## Evidence binding for findings

Each P0/P1 should include when available (same keys as `templates/review-conclusion.json`):

- `file` + location (from node or diff)
- `symbol_id` / name
- `change_status`
- `callers` (names from **`edges-in` direct calls**; use `reach-in` only for chain context, not as a substitute caller list)
- `entry` (if path/tag evidence exists — do not invent when tag `repo_count==0`)
- `tested_count` / tests-reach summary
- `artifact` path under the evidence pack
- `confidence`: high \| medium \| low \| **UNKNOWN** (UNKNOWN required for edge/reach/path radius claims when `stubs>=20`)

## Coverage language (strict)

| Allowed claim | Required evidence |
|---|---|
| “Has test edge coverage” | `tested_count > 0` or non-empty `tests-reach` |
| “Test file mentions name” | `search --tests-only` only — **not** coverage |
| “Untested change” | changed production symbol + `tested_count==0` + empty tests-reach |

## Regression must-test writing (`regression_tests[]`)

Audience: developers / QA reading the HTML report — **not** CodexQA operators.

| Field | Must contain | Forbidden as sole content |
|---|---|---|
| `target` | Executable scenario: **who/entry + input conditions + expected result**; method name may appear as a label | Method name alone; cryptic arg fragments without场景 |
| `why` | Plain risk/business reason to retest | Unexplained acronyms only |
| `evidence` | Human-readable basis: which class/method behavior changed, which callers/entries are affected | Only `05-…` / `impact/…` paths, `source:N`, bare UUID / `symbol <id>`, tags like `hot-but-thin` |

Internal artifact paths or symbol ids may appear in parentheses after a plain sentence, never as the whole cell.
Derive scenarios from graph callers / entries / diffs — still evidence-backed, but **worded for execution**.

## Reader prose (dimension cards + findings + summary)

Audience for **all human-facing report text** (dimension `risk` / notes / `complexity.hotspots`,
finding `title`/`risk`/`evidence`/`fix`, `summary`, `sensitive`, `test_gaps[].note`,
`residual_risks`): a teammate who did **not** open the evidence pack.

| Write | Avoid as the main sentence |
|---|---|
| What can go wrong for users / maintainers, in plain words | Raw metric dumps: `loc=186`, `loc_high+untested`, `edges-in=17`, `tested_count=0`, `hops=0` |
| Where it lives (file + function name is OK) | Pack-only jargon: `graph 无 tests 边`, `BM25`, `strategy_b`, bare UUID |
| Why it matters now (crash, wrong UI, hard to change safely, no regression net) | Signal-file names alone as the “risk” |
| Soft numbers in parentheses after the plain claim | Making the whole field a semicolon-joined telemetry line |

**Every concern dimension card must include `risk`:** a plain-language statement of the
**specific code risk in this repo** (which code, which user/runtime path, what breaks).
HTML renders it as **风险说明**. Do not ship a concern dimension with only `verdict` + signal
filename. Complexity may put the same prose in `risk` and/or `hotspots` (renderer uses
`risk // hotspots`). Design-fit concern subsections put the risk in `risk` or `notes`.

**Complexity `hotspots` / `risk`:** 2–4 short sentences. Pattern:
「哪个函数偏长/难改 → 它在什么用户路径上 → 缺测时改坏会怎样」.
Do **not** paste `hot_methods` rows verbatim.

**Dimension `evidence`:** one plain sentence of why we believe this, then optional
`(信号: 11-complexity-signals.json)` appendix.

**Finding HTML surface** (`render-review-html.sh`): shows 位置 / 变更 / 分类 / 风险 /
**调用链路** / 依据 / 入口 / 修复建议. Does **not** show `symbol_id`, `tested_count`,
`confidence`, or a standalone「影响面示意」section. `change_status` is mapped for readers:
`add`→本次新增, `change`→本次修改, `default`→既有代码（全仓）或未纳入本次 diff.

**`call_chain` (preferred over top-level `diagrams[]` for HTML):** pack-backed call path
rendered as pure HTML nodes + arrows (no Mermaid / CDN). Shape:
`{ title?, paths: string[][], focus?: string[] }` or a single `string[]` path.
If omitted, renderer may fall back from `callers[]` to a fan-in sketch. Concern
dimension cards should also set `call_chain` when a concrete path is known.

**Finding `evidence`:** same rule as regression evidence — human basis first,
artifact path last.
