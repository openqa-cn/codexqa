# Agent LLM judgment pass (order 16)

Run **after** risk_tier + registry dimensions 1–15 have draft findings and
dimension verdicts. Uses the **host agent’s embedded model** — no extra CodexQA
calls and no external LLM vendor.

## Goal

Catch semantic / logic / API-misuse issues that derive heuristics miss, then
**dedupe-merge** so final `p0`/`p1`/`p2` never double-report the same defect.

## Steps

1. **Scope reads** (bounded):
   - Top change groups from `03-change-groups.json`
   - Matching `diffs/<id>.diff.json`
   - For top-risk symbols: on-disk source under `manifest.repo` (prefer changed
     hunks; avoid dumping whole files >400 lines — truncate with note)
   - Callers from `impact/<id>/edges-in.json` when present
2. **Draft LLM candidates** as finding objects (same shape as conclusion
   template). Prefer semantic `category` (`correctness`, `security`, …). Always
   set `source: "llm_judgment"`. Stay in change / hotspot scope.
3. **Write** `<OUT_DIR>/llm-candidates.json`:
   ```json
   { "p0": [], "p1": [...], "p2": [...] }
   ```
4. **Write** `<OUT_DIR>/baseline-findings.json` from the heuristic draft lists
   (pre-LLM `p0`/`p1`/`p2` only).
5. **Merge**:
   ```bash
   ./scripts/acr-python ./scripts/lib/merge-llm-findings.py \
     --baseline <OUT_DIR>/baseline-findings.json \
     --candidates <OUT_DIR>/llm-candidates.json \
     --out <OUT_DIR>/merged-findings.json \
     --report <OUT_DIR>/22-llm-judgment.json \
     --mode pr
   ```
6. Copy merged `p0`/`p1`/`p2` into `review-conclusion.json`; set counts;
   fill `llm_judgment` dimension block from `22-llm-judgment.json` totals.
7. If candidates empty → `llm_judgment.verdict: ok` (or `none` when pack too
   thin to read) and still list `llm_judgment` in `dimensions_covered`.

## Rules

- Never invent callers, `tested_count`, CVEs, or compliance certifications.
- Never skip CodexQA pack validation to “save time” for this pass.
- Duplicates must be dropped or enriched — **not** emitted as a second finding.
- HTML shows the merged lists only; dimension card summarizes novel vs deduped counts.
- Bilingual prose still required (`title_en`, `risk_en`, …) for novel findings.

## Card

See [references/dimensions/llm-judgment.md](../references/dimensions/llm-judgment.md).
