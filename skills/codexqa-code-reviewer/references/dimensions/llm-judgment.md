# Dimension card: Agent LLM judgment (semantic code review)

**Host-agent embedded model pass** — not a CodexQA derive heuristic and not a
replacement for graph evidence. Complements deterministic dimensions by catching
semantic / logic / API-misuse issues that regex and path signals miss.

## Why this bar

| Criterion | Why this wins |
|---|---|
| Heuristics miss intent bugs | Empty catch, N+1, PII regexes are covered elsewhere; wrong branch / off-by-one / misuse of library APIs need reading the diff |
| Agent already has an LLM | Zero new vendor API; the invoking agent runs one bounded review pass on pack-scoped code |
| Duplicate findings hurt trust | Mandatory **dedupe/merge** against heuristic findings so HTML/P0–P2 lists stay unique |

**Rejected:** LLM-only review without CodexQA pack; inventing callers/coverage;
emitting a second finding that restates Complexity/Resilience/Privacy already filed.

| Field | Value |
|---|---|
| id | `llm_judgment` |
| title | Agent LLM judgment |
| order | **16** (last — after all derive/reuse dims) |
| modes | pr, full, adhoc |
| finding_category | Prefer semantic category (`correctness`, `security`, …); set `source: "llm_judgment"` |
| algorithm | **agent** (host LLM) + local merge helper |
| max_extra_codexqa | **0** |

## When to run

After registry orders 1–15 (and pre-pipeline `risk_tier`) have draft findings /
dimension verdicts. Never run as the sole review engine when the pack is missing.

## Questions (must attempt)

1. **Semantic correctness** — Does the changed logic do what `intent`/`scope` claim? Off-by-one, inverted predicates, missing null/empty guards that family checks did not already cover?
2. **API / contract misuse** — Wrong argument order, ignored return values, unsafe casts, broken invariants vs callers in `edges-in`?
3. **Cross-cutting gaps** — Resource leaks, TODOs that mask incomplete paths, confusing control flow — only when **not** already owned by Maintainability/Complexity cards with the same `path:line`.
4. **Dedupe** — For every candidate, ask: would a teammate reading P0/P1/P2 say “same as finding X”? If yes → merge or drop, never duplicate.

## Soft thresholds

| Signal | Default | Escalate |
|---|---|---|
| Novel logic/API bug with pack citation | P1 | Entry-reachable / pay/auth → may P0 |
| Novel smell / readability with concrete risk | P2 | — |
| Duplicate of heuristic finding (same file±3 lines or same symbol + similar title/risk) | **drop or enrich** | Never second card |
| Thin pack / stubs≥20 | residual / low confidence | Cap blast claims at UNKNOWN |

Confidence default `medium`. Prefer citing `diffs/<id>.diff.json` + on-disk lines under `--repo`.

## Dedupe / merge contract (mandatory)

Use `scripts/lib/merge-llm-findings.py` (via `scripts/acr-python`) before writing
final `p0`/`p1`/`p2`:

1. Build **baseline** from heuristic dimension findings already drafted.
2. Pass LLM **candidates** (same finding shape as conclusion template).
3. Script classifies each candidate:
   - `duplicate` → omit from final lists; optionally append one sentence to the
     matched finding’s `evidence` / `evidence_en` (enrichment).
   - `novel` → keep; ensure `source: "llm_judgment"`.
4. Write `22-llm-judgment.json` with counts + `dedupe_report`.
5. Final HTML findings must be the **merged** lists only.

Match keys (any one is enough for duplicate):

- Same `symbol_id` (non-empty) **and** token overlap ≥ 0.5 on `title`+`risk`
- Same normalized `file`/`location` path **and** line within ±3 **and** same
  `category` family (or either category is `llm_judgment`)
- Jaccard token overlap ≥ 0.55 on normalized `title`+`risk` with same path

## Split vs siblings

| Sibling | Owns | This card owns |
|---|---|---|
| Correctness / Resilience / Privacy / … | Deterministic signal → finding hard gates | Semantic issues **not** already filed |
| Complexity | Nesting / LOC / YAGNI hotspots | Logic intent bugs inside those methods |
| codexqa-defect-analyzer skill | SAST + agent scan reports | Pack-scoped CR inside this skill only |

## Evidence map

| Signal | Source |
|---|---|
| What changed | `diffs/*.diff.json`, `04-changed-files.json`, `05-changed-symbols.json` |
| Blast context | `impact/*/edges-in.json`, `07-tags.json` |
| Prior findings | Draft `p0`/`p1`/`p2` + dimension verdicts |
| Merge audit | `22-llm-judgment.json` |

## Output

- Always evaluate into `review-conclusion.json` as `llm_judgment` (findings **or**
  `ok`/`none`) and include `llm_judgment` in `dimensions_covered`.
- **Report/HTML:** section only when `verdict` is `concern`/`unknown`.
- Novel findings appear in `p0`/`p1`/`p2` with `source: "llm_judgment"`; do not
  mirror the same issue only under the dimension card.

## Non-goals

- No extra CodexQA calls; do not raise `TOP_N` / `REACH_DEPTH`.
- No inventing graph edges, test coverage, CVEs, or compliance certifications.
- No second full-repo LLM “style guide” dump — stay in change / hotspot scope.
- Missing `22-` on legacy packs → thin/`none` OK; validate does not hard-fail.
