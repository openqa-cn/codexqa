# PR / diff review prompt (default)

Produce a risk-driven, graph-evidence code review for this PR/branch vs `diff_base`.

## Role

Senior reviewer for **any** language / polyglot system. Prefer relational graph facts over patch-only opinions. Critique code, not people. Do not rubber-stamp LGTM.

## CodexQA-only gate (all languages)

Before any finding:

1. Evidence pack must exist and pass `validate-evidence.sh --mode pr`.
2. `manifest.engine` must be `codexqa` (or legacy pack with `codexqa` in `commands` / `commands.log`).
3. If CodexQA pack is missing → **blocked** (`missing_codexqa_engine`). Do **not** fall back to git-diff-only, grep-only, or language-native SAST as the primary review.

`lang_stats` + `09-language-profile.json` identify the **primary** and change-focus languages;
still use the same CodexQA pack for all of them.

## Inputs (required)

1. Evidence pack directory with valid `manifest.json` (`mode: pr`) after `validate-evidence.sh --mode pr`
2. `09-language-profile.json` (or legacy WARN + inferred hint from summary)
3. Artifacts listed in the manifest (especially `03-change-groups`, `05-changed-symbols`, `diffs/*.diff.json`, `impact/`, `07-tags.json`, `08-hot-but-thin.json`, `20-risk-tier.json`, `10-design-fit-signals.json`, `11-complexity-signals.json`, `12-dependency-signals.json`, `13-privacy-signals.json`, `14-resilience-signals.json`, `15-rollout-signals.json`, `21-performance-signals.json` when present)
4. Optional: business goal, team norms, known incidents

If validation failed or gates missing → only blocked template from SKILL.md.

## Process

1. Read `manifest.json` (`engine`, `primary_language`, `review_language_focus`, `index_quality`, `lang_stats`) and `09-language-profile.json` — lock primary / focus language before findings.
2. Read `01-stats.json`, `02-summary.json` — note index quality and raw `lang_stats`.
3. Rank work via `03-change-groups.json` (max fan-in first). If empty → blocked / re-index.
3b. **Step 0 — Risk tier first (pre-pipeline):** read `20-risk-tier.json` (or escalate one tier if missing) and apply [references/dimensions/risk-tier.md](../references/dimensions/risk-tier.md). Lock `tier` / `review_depth.evidence_floor` into conclusion `risk_tier` **before** design-fit. **T0** (auth/pay/migration/IaC): `full_checklist` — all registry dimensions, graph edges-in/reach required, ≥2 evidence cites per finding, paired review recommended; never downgrade for small diffs. **T1**: `trimmed_checklist` — all dimensions; callers/entries required; minor polish skips OK. **T2**: `spot_check` — more explicit `None` OK; deep-read one non-highlighted file; fail → escalate. **T3**: `sample_ci` — sample + pack green; any auth/pay/migration/IaC path → **re-tier T0**. Highest-wins; ratchet up only.
4. For top groups: read `diffs/<id>.diff.json` as the only authoritative “what changed” text (CodexQA symbol-diff).
5. For each high-risk symbol: read `impact/<id>/edges-in.json`, `reach-in.json`, `tests-reach.json`, and `paths/`.
6. Entry risk: from reach hops with `from_count==0` and/or `07-tags.json` tagged nodes; use `path` artifacts — do not invent entries.
7. Check `08-hot-but-thin.json` for changed symbols with `tested_count==0`. Escalate untested + entry-reachable (or edges-in) gaps. Prefer `edges_in_count` / edges-in callers; `from_count` is NOT fan-in. Under `stubs>=20`, keep blast-radius confidence at `UNKNOWN`.
7b. When `impact/*/edges-in` is empty for high-severity symbols, check `19-annotation-edges.json` for Spring/Resilience4j synthetic callers (`fallbackMethod`, `@GetMapping`, etc.) before citing callers as UNKNOWN-only.
   For hot-but-thin names matching `equals` / `hashCode` / `compare*` / `compareTo` / `cmp`: **open the matching `diffs/<id>.diff.json` and review the body** per [references/dimensions/correctness-family-checks.md](../references/dimensions/correctness-family-checks.md) — do not judge by name alone.
8. Check `06-sensitive-hits.json` (search + `symbols --name` + edges-in) and escalate hits that intersect changed symbols or callers evidenced by **edges-in** (not stub `from_count` alone). If new auth/pay/secret hits contradict a T2/T3 lock, **re-tier upward**.
9. **Design fit first:** read `10-design-fit-signals.json` (package/import layers, `import_cross_layer`, `dead_nested_symbols`, sprawl) and apply [references/dimensions/design-fit.md](../references/dimensions/design-fit.md) as **four subsections** (Belong / Layer / Over-engineering / Timing).
10. **Complexity next:** read `11-complexity-signals.json` (or thin from `05` spans + edges-in if missing) and apply [references/dimensions/complexity.md](../references/dimensions/complexity.md).
11. **Dependencies next:** read `12-dependency-signals.json` (or None if thin/no manifests) and apply [references/dimensions/dependencies.md](../references/dimensions/dependencies.md). Never invent CVEs. **If changed symbols implement supply-chain / SCA / lock / license checkers**, also apply that card’s **When reviewing supply-chain checker / rule-engine code** section (body vs soft thresholds) — do not rely on Complexity hotspots alone.
12. Continue registry order: **Correctness**, then **Resilience:** read `14-resilience-signals.json` (or None if thin) and apply [references/dimensions/resilience.md](../references/dimensions/resilience.md) (timeout / retry / swallow / degrade / partial fail / idempotency — never invent SLO/chaos conclusions; do not re-litigate logic bugs as resilience). **Hard gate:** non-empty `silent_swallows` / `timeout_gaps` / `retry_risks` / `partial_failure_gaps` / `idempotency_gaps` must become findings or explicit deferred residuals with `path:line` — never Resilience `None` while those arrays have hits. If `residual_hardening` is non-empty, report as residual (not automatic P1) even when findings are None. Then security → **Privacy:** read `13-privacy-signals.json` (or None if thin) and apply [references/dimensions/privacy.md](../references/dimensions/privacy.md). Never invent GDPR/compliance conclusions; do not re-litigate auth/token/pay. Then contract → **Change / rollout:** read `15-rollout-signals.json` (or None if thin) and apply [references/dimensions/rollout.md](../references/dimensions/rollout.md) (migration / dual-write / flags / compat window / breaking announce / rollback — never invent canary/ops conclusions; do not re-litigate caller signature drift as rollout; **Javadoc/comments naming remedy keywords do not waive gaps**). If `residual_rollout` is non-empty, report as residual (not automatic P1). Then concurrency → regression → test gaps → observability → maintainability → **Performance:** read `21-performance-signals.json` (or None if thin) and apply [references/dimensions/performance.md](../references/dimensions/performance.md) (hot path / N+1 / unbounded allocation — never invent profiler/SLO/p99; do not re-litigate Complexity nesting or Resilience timeout/retry as performance). **Hard gate:** non-empty `n_plus_one_risks` / `hot_path_risks` / `unbounded_allocation` must become findings or explicit deferred residuals with `path:line` — never Performance `None` while those arrays have hits. If `residual_performance` is non-empty, report as residual (not automatic P1). Apply [references/dimensions/correctness-family-checks.md](../references/dimensions/correctness-family-checks.md) during correctness/concurrency. Depth of each dimension must meet the locked `evidence_floor` from step 3b.
13. Draw ≥1 Mermaid per [references/mermaid-evidence.md](../references/mermaid-evidence.md).
14. Emit report per [templates/review-report.md](../templates/review-report.md). Mark `confidence: UNKNOWN` when graph quality is weak. Cite `primary_language` in the header. P0/P1 objects in `review-conclusion.json` must follow the evidence-binding fields in review-dimensions (template mirrors them). Include optional `risk_tier`, optional `design_fit` (prefer `sections`), optional `complexity`, optional `dependencies`, optional `resilience`, optional `privacy`, optional `rollout`, optional `performance`, + `dimensions_covered`. **Reader prose:** dimension fields (esp. `complexity.hotspots`), finding `risk`/`evidence`, `summary`, and residual notes must state risks in plain language for teammates who did not open the pack — see review-dimensions **Reader prose**. Fill `regression_tests[]` for humans: `target` = detailed scenario to retest; `evidence` = plain-language basis (not raw artifact/UUID-only strings). See review-dimensions **Regression must-test writing**.
15. **Required HTML deliverable:** write `<OUT_DIR>/review-conclusion.json` from
    [templates/review-conclusion.json](../templates/review-conclusion.json) (same findings /
    risk / regression / gaps), then run:

```bash
./scripts/render-review-html.sh --dir <OUT_DIR>
```

Tell the user the path to `REVIEW-REPORT.html`. Do not skip the HTML step when the review completed successfully.

## Rules

- Cite artifact paths and symbol names/ids for P0/P1; include `callers` from **edges-in** when present.
- When edges-in empty, cite `19-annotation-edges.json` synthetic callers (Spring/Resilience4j) before UNKNOWN-only.
- Coverage: only `tested_count` / tests-reach prove test edges.
- If `index_quality` / stats indicate many stubs/collisions, mark confidence low on blast-radius claims.
  When validate WARNs `stubs>=20`, **cap** edge/reach/path findings at `confidence: UNKNOWN`
  (do not claim complete blast radius). Do not use stub-inflated `from_count` as proof of fan-in size;
  still may flag `tested_count==0` using edges-in / entry evidence. Re-index with `--full` if the graph looks stale.
- Stay in change scope; put material caveats into finding risk text or summary — do not emit a dedicated residual HTML section.
- No secrets in examples; use placeholders.
- Do not run wiki/chat unless the user asked.
- Optional linters/SAST notes are secondary; never replace CodexQA graph evidence.

## Minimum coverage

- Primary language + review focus (from language profile) + overall risk (High/Medium/Low)
- Change summary
- Evaluate **Design fit / Complexity / Dependencies / Resilience / Privacy / Rollout** into
  `review-conclusion.json` + `dimensions_covered` (findings or `ok`/`none` verdicts).
  **HTML/report surface:** only emit dimension sections with `concern`/`unknown`
  (Design-fit: only issue subsections). Omit clean `ok`/`none` filler from the report —
  `render-review-html.sh` filters the same way.
- **Dependencies / supply chain** checker PRs: still apply the full **When reviewing
  supply-chain checker** checklist on the dependencies card when that code changes.
- **Risk tier** locked from `20-risk-tier.json` (T0–T3 evidence floor) before design-fit; auth/pay/migration/IaC → T0 deepen (always show when present)
- P0 / P1 / P2 lists (or None)
- Regression must-test: each row is an **executable scenario** (entry/caller + inputs + expected outcome). Evidence column must be **plain-language** (what changed / which method / which callers) — never only pack paths, `source:N`, bare symbol UUIDs, or tags like `hot-but-thin`
- Test gaps (edge-based)
- Sensitive path section (or none)
- Call-chain graphs on findings / concern dimension cards via `call_chain` (pure HTML; see mermaid-evidence.md HTML surface)
- **`review-conclusion.json` + `REVIEW-REPORT.html`** via `scripts/render-review-html.sh`

Do **not** put「建议修复顺序」or「残留风险与假设」in the HTML report.
