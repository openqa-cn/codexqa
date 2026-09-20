# Dimension card: Blast-radius risk tier (triage)

**Pre-pipeline meta** — assign T0–T3 **before** design-fit / other findings.
Drives review **depth**, not a substitute for Security / Rollout findings.

## Why this bar (industry best practice — not “exists ⇒ best”)

Selected model: **ShipWithAI T0–T3** where **T0 = highest blast radius**
([Part 2 triage](https://shipwithai.io/blog/reviewing-ai-generated-pull-requests-2026--part2--senior-dev--en/),
[Part 3 CI encoding](https://shipwithai.io/blog/reviewing-ai-generated-pull-requests-2026--part3--senior-dev--en/)).

| Criterion | Why this model wins |
|---|---|
| Blast ≠ diff size | 3-line IAM is T0; 300-line tests ≈ T3 — finite read budget |
| Path + pack signals, not LLM self-tier | Agents mis-label scope; Part 3 uses path heuristics |
| Highest-wins, ratchet up only | Avoids first-match under-escalation on mixed PRs |
| auth / pay / migration / IaC → deepest | Converges with ShipWithAI T0, GitHub path Rulesets / CODEOWNERS, agentpatterns human-only for auth/payments |

**Rejected:** Greenlit inverted T0=low; LLM self-tier; Decepticon three-tier alone (weaker pay/migration granularity).
Alias: `industry_tier` Tier3↔T0 / Tier2↔T1 / Tier1↔T2–T3.

| Field | Value |
|---|---|
| id | `risk_tier` |
| title | Blast-radius risk tier |
| order | pre-pipeline (before registry order 1) |
| modes | pr, full |
| finding_category | `risk_tier` |
| algorithm | derive (`20-risk-tier.json`) from `04` + `06` + `07` + `15` surfaces |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Tier** — What is the pack-level T0–T3 (highest file wins)?
2. **Drivers** — Which path families / sensitive / tags / rollout surfaces forced the tier?
3. **Evidence floor** — Does the review meet `review_depth.evidence_floor` for that tier?
4. **Ratchet** — If spot-check or new auth/pay/migration/IaC evidence appears mid-review, escalate (never downgrade).

## Soft thresholds (auditable heuristics)

| Signal | Tier effect |
|---|---|
| Path IaC (`*.tf`, terraform, helm, k8s, Dockerfile*, `.github/workflows`, IAM, …) | **T0** |
| Path / rollout migration or destructive DDL | **T0** |
| Path auth / oauth / jwt / rbac / security middleware | **T0** |
| Path pay / billing / wallet / ledger / checkout charge | **T0** |
| `06-sensitive-hits` ∩ changed paths (auth/token/pay/secret) | **T0** |
| Rollout `surfaces.money` with migration/destructive | **T0** |
| Production + entry-ish tags; breaking/storage_switch without flag; core business path (`services/` / `domain/` / `core/` / …) | **T1** (if not T0) |
| Feature-flagged / isolated prod without T0 surfaces | **T2** |
| Docs / tests / fixtures / formatting only | **T3** |
| Missing inputs / uncertainty | **Escalate one tier** (never down) |

## Evidence floor by tier

| Tier | `evidence_floor` | Reviewer obligation |
|---|---|---|
| T0 | `full_checklist` | All registry dimensions; graph edges-in/reach required; ≥2 evidence cites per finding; paired review recommended; no “small diff” downgrade |
| T1 | `trimmed_checklist` | All dimensions; callers/entries required; minor polish skips OK if CI/pack green |
| T2 | `spot_check` | More explicit `None` OK; behavioral/spot deep-read one non-highlighted file; fail → escalate |
| T3 | `sample_ci` | Sample + pack green; any auth/pay/migration/IaC path → **re-tier T0** |

## Evidence map

| Signal | Source |
|---|---|
| Changed paths | `04-changed-files.json` (full: sample / bounded) |
| Tags / entry | `07-tags.json` |
| Sensitive | `06-sensitive-hits.json` |
| Rollout surfaces | `15-rollout-signals.json` `.surfaces` |

## Output

- Always emit / consume `20-risk-tier.json` when collect ran.
- Optional `risk_tier` object on `review-conclusion.json`.
- Include `risk_tier` in `dimensions_covered` when used.
- Do **not** invent Security/Rollout findings from tier alone — tier only sets depth.

## Non-goals

- No extra CodexQA; do not raise `TOP_N` / `REACH_DEPTH`.
- No GitHub label / Rulesets bot (platform-side).
- Missing `20-` → thin triage from paths/sensitive manually or escalate; validate WARN only.
