# Full-repo review prompt (optional mode)

Produce a repository health / architecture risk review from a CodexQA full-repo evidence pack. This is **not** a PR diff review.

## Role

Staff engineer assessing structural risk across **any** language stack: hotspots, untested high fan-in symbols, sensitive surfaces, layering drift, entry concentration. Evidence-only; no product scorecard fluff.

## CodexQA-only gate (all languages)

1. Pack must pass `validate-evidence.sh --mode full`.
2. `manifest.engine` must be `codexqa` (or legacy with codexqa in commands/log).
3. Missing CodexQA pack → blocked (`missing_codexqa_engine`). Do not substitute directory tours or language-specific tools as primary analysis.

## Inputs (required)

1. Evidence pack with `manifest.mode == full` after `validate-evidence.sh --mode full`
2. `09-language-profile.json` + `manifest.primary_language` (legacy: WARN + summary hint)
3. `01-stats`, `02-summary` (`lang_stats`), `04-hot-symbols`, `05-untested-hotspots`, `07-tags.json`, `imports/`, optional sensitive hits

Do **not** invent `change_status` / PR conclusions without a diff index.

## Process

1. Read `09-language-profile.json` / `manifest.primary_language` — lock primary language; note `is_polyglot` + secondaries.
2. Read summary (`lang_stats`), node/edge scale, `manifest.index_quality`.
3. From `05-untested-hotspots.json`, list top hot-but-thin symbols (prefer high `edges_in_count` / real callers; `from_count` is NOT fan-in). For names matching `equals` / `hashCode` / `compare*` / `compareTo` / `cmp`, read symbol bodies / available diffs per [references/dimensions/correctness-family-checks.md](../references/dimensions/correctness-family-checks.md).
3b. **Step 0 — Risk tier (pre-pipeline):** read `20-risk-tier.json` (paths from files sample + tags + sensitive + rollout surfaces) and apply [references/dimensions/risk-tier.md](../references/dimensions/risk-tier.md). Lock T0–T3 evidence floor into conclusion `risk_tier` **before** design-fit. **T0** (auth/pay/migration/IaC): `full_checklist` — all registry dimensions; graph edges-in/reach required; ≥2 evidence cites per finding; paired review recommended; never downgrade for small diffs. **T1**: `trimmed_checklist` — all dimensions; callers/entries required. **T2**: `spot_check` — more explicit `None` OK; behavioral/spot deep-read; fail → escalate. **T3**: `sample_ci` — sample + pack green; any auth/pay/migration/IaC path → **re-tier T0**. Missing file → escalate one tier. Highest-wins; ratchet up only.
4. Use `impact/*/edges-in|reach-in|tests-reach` for blast radius on those hotspots (full-repo collect writes these for `IMPACT_TOP_N`). When edges-in empty for annotated methods, cite `19-annotation-edges.json`.
5. From `06-sensitive-hits.json`, map to symbols/files; note entry proximity via `07-tags.json` when present. New T0 surfaces → re-tier upward.
6. From `imports/*` (+ `imports/index.json` / `*-ondisk.json`) and `10-design-fit-signals.json`, apply **Design fit** ([references/dimensions/design-fit.md](../references/dimensions/design-fit.md)) in **four subsections** (Belong / Layer / Over-engineering / Timing). Layer must use package/import/path heuristics even when CodexQA `imports` query is empty. Build architecture Mermaid only from real pack nodes.
7. From `11-complexity-signals.json` (and hotspots / untested symbols), apply **Complexity** ([references/dimensions/complexity.md](../references/dimensions/complexity.md)).
8. From `12-dependency-signals.json` (root/sample manifests), apply **Dependencies** ([references/dimensions/dependencies.md](../references/dimensions/dependencies.md)). Never invent CVEs. If the repo contains supply-chain **checker / rule-engine** code under review, also apply that card’s full **When reviewing supply-chain checker** checklist (whitelist parity, floating matcher polarity, license npm-only, osv contains, necessity without observed union, etc.).
9. Continue registry **Correctness** (logic/state) via hotspots / bodies + [references/dimensions/correctness-family-checks.md](../references/dimensions/correctness-family-checks.md) where applicable — do not re-badge failure-path policy as correctness.
10. From `14-resilience-signals.json`, apply **Resilience** ([references/dimensions/resilience.md](../references/dimensions/resilience.md)) (timeout / retry / swallow / degrade / partial / idempotency). **Hard gate:** non-empty `silent_swallows` / `timeout_gaps` / `retry_risks` / `partial_failure_gaps` / `idempotency_gaps` must become findings or explicit deferred residuals with `path:line` — never Resilience `None` while those arrays have hits. Never invent SLO/chaos conclusions; do not re-litigate logic bugs.
11. From sensitive hits + graph, apply **Security**; then from `13-privacy-signals.json` apply **Privacy** ([references/dimensions/privacy.md](../references/dimensions/privacy.md)). Never invent GDPR/compliance conclusions.
12. Apply **API / contract** (signature/behavior drift when caller evidence exists); then from `15-rollout-signals.json`, apply **Change / rollout** ([references/dimensions/rollout.md](../references/dimensions/rollout.md)) (migration / dual-write / flags / compat / announce / rollback). Never invent canary/ops conclusions; do not re-litigate contract caller drift as rollout; **Javadoc/comments naming remedy keywords do not waive gaps**. If `residual_rollout` is non-empty, report as residual (not automatic P1).
13. Entry concentration: tagged samples under `entries/tagged/` — flag overly central entries if evidenced.
14. Continue remaining registry dimensions (concurrency / regression / test gaps / observability / maintainability) per [references/dimension-registry.md](../references/dimension-registry.md) / [references/review-dimensions.md](../references/review-dimensions.md) for the primary language.
14b. From `21-performance-signals.json`, apply **Performance** ([references/dimensions/performance.md](../references/dimensions/performance.md)) (hot path / N+1 / unbounded allocation). **Hard gate:** non-empty `n_plus_one_risks` / `hot_path_risks` / `unbounded_allocation` must become findings or explicit deferred residuals with `path:line` — never Performance `None` while those arrays have hits. Never invent profiler/SLO/p99; do not re-litigate Complexity nesting or Resilience timeout/retry. If `residual_performance` is non-empty, report as residual (not automatic P1).
15. Produce prioritized remediation backlog (P0/P1/P2) — systemic risks, not style nits.
16. State confidence limits (sample size of symbol query, stub/collision rate, language confidence).

## Output

Follow [templates/review-report.md](../templates/review-report.md) with mode header `full-repo`.

**Required:** also write `review-conclusion.json` and render HTML:

```bash
./scripts/render-review-html.sh --dir <OUT_DIR>
```

Sections emphasis:

1. Repo snapshot (primary language, polyglot flag, scale, index quality)
1b. Risk tier / blast-radius triage (`20-risk-tier.json`)
2. Design fit / architecture layer diagram (evidence Mermaid)
3. Complexity / cognitive-load hotspots
4. Dependencies / supply-chain posture
5. Resilience / error-handling posture
6. Privacy / compliance posture
7. Change / rollout posture
7b. Performance / N+1 / hot-path / unbounded alloc (`21-performance-signals.json`)
8. Critical hotspots (untested high fan-in)
9. Sensitive / trust surfaces
10. Entry concentration (if tags exist)
11. Recommended hardening order
12. Gaps / what was not indexed or queried

## Minimum coverage

- Repo snapshot: primary language, polyglot flag, scale, index quality
- Evaluate **Design fit / Complexity / Dependencies / Resilience / Privacy / Rollout / Performance** into
  `review-conclusion.json` + `dimensions_covered`. **HTML/report:** only issue dims
  (`concern`/`unknown`; Design-fit issue subsections only) — omit `ok`/`none` filler;
  renderer enforces the same filter. **Reader prose:** dimension notes / finding risk text
  must explain risks in plain language (see review-dimensions **Reader prose**) — never dump
  `loc_high+untested` / pack paths as the whole field.
- **Risk tier** locked from `20-risk-tier.json` (T0–T3 evidence floor) before deep dimensions
- Critical hotspots (untested high fan-in) with graph cites
- Sensitive / trust surfaces (or none)
- Entry concentration when tags exist (or note absent)
- **`review-conclusion.json` + `REVIEW-REPORT.html`** via `scripts/render-review-html.sh`

Do **not** emit HTML「建议修复顺序」or「残留风险与假设」.

## Rules

- No fake change-group analysis.
- No “tests exist somewhere” claims without tests edges.
- Wiki only if user explicitly requested.
- Optional language linters are secondary to CodexQA graph evidence.
- Complexity must stay pack-backed (symbols / edges-in / bounded file windows) — not a git-diff-only engine.
- Dependencies must stay pack/manifest-backed (bounded local parse) — no network CVE lookups.
- Privacy must stay pack/source-backed (bounded local heuristics) — no network legal lookups.
- Resilience must stay pack/source-backed (bounded local heuristics) — no chaos/SLO probes.
- Change / rollout must stay pack/source-backed (bounded local heuristics) — no ops/canary probes.
