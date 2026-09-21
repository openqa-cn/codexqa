# Dimension registry (extension contract)

**Single source of pipeline order** for ai-code-reviewer. Prompts and
[review-dimensions.md](review-dimensions.md) must follow this table — do not
re-order dimensions in prompts alone.

When adding a new review gap (Naming, Consistency, …):

1. Append a row below (next `order` integer) **or** insert and renumber carefully.
2. Add `references/dimensions/<id>.md` using the card contract.
3. Optionally add a pure-jq/python `scripts/lib/derive-<id>.sh` (`max_extra_codexqa: 0`
   preferred). Do **not** raise default `TOP_N` / `REACH_DEPTH` for a new dimension.
4. Wire prompts / templates / HTML only via optional fields (legacy packs stay valid).
5. Do **not** rename evidence-binding keys of existing dimensions.

## Card contract

```text
id                 stable slug (finding category often matches)
title              human label
order              1-based pipeline position
modes              pr | full | both
evidence_required  artifact globs that must exist for a strong claim
evidence_optional  nice-to-have artifacts
finding_category   value for review-conclusion.json category field
severity_default   P0 | P1 | P2 guidance (see card)
algorithm          derive (local) | reuse (read existing impact only) | agent (host LLM)
max_extra_codexqa  integer; prefer 0
skip_when          conditions to emit None / residual instead of findings
card               path under references/dimensions/
```

## Pipeline (authoritative order)

| order | id | title | modes | algorithm | max_extra_codexqa | card |
|---|---|---|---|---|---|---|
| 1 | `design` | Design fit | both | derive | 0 | [dimensions/design-fit.md](dimensions/design-fit.md) |
| 2 | `complexity` | Complexity | both | derive | 0 | [dimensions/complexity.md](dimensions/complexity.md) |
| 3 | `dependencies` | Dependencies / supply chain | both | derive | 0 | [dimensions/dependencies.md](dimensions/dependencies.md) |
| 4 | `correctness` | Correctness / state | both | reuse | 0 | (inline in review-dimensions.md) |
| 5 | `resilience` | Error handling / resilience | both | derive | 0 | [dimensions/resilience.md](dimensions/resilience.md) |
| 6 | `security` | Security / sensitive | both | reuse | 0 | (inline) |
| 7 | `privacy` | Privacy / compliance | both | derive | 0 | [dimensions/privacy.md](dimensions/privacy.md) |
| 8 | `contract` | API / contract | both | derive | 0 | [dimensions/contract.md](dimensions/contract.md) |
| 9 | `rollout` | Change / rollout | both | derive | 0 | [dimensions/rollout.md](dimensions/rollout.md) |
| 10 | `concurrency` | Concurrency / consistency | both | reuse | 0 | (inline) |
| 11 | `regression` | Regression / blast radius | pr | reuse | 0 | (inline) |
| 12 | `test_gaps` | Test gaps | both | reuse | 0 | (inline) |
| 13 | `observability` | Observability | both | derive | 0 | [dimensions/observability.md](dimensions/observability.md) |
| 14 | `maintainability` | Maintainability | both | derive | 0 | [dimensions/maintainability.md](dimensions/maintainability.md) |
| 15 | `performance` | Performance | both | derive | 0 | [dimensions/performance.md](dimensions/performance.md) |
| 16 | `llm_judgment` | Agent LLM judgment | both | agent | 0 | [dimensions/llm-judgment.md](dimensions/llm-judgment.md) |

## Pre-pipeline triage (mandatory before order 1)

Prompts **MUST** read this artifact and lock review depth **before** design-fit.
It is **not** appended at the end of the finding pipeline.

| id | title | modes | algorithm | max_extra_codexqa | card |
|---|---|---|---|---|---|
| `risk_tier` | Blast-radius risk tier (T0–T3) | both | derive | 0 | [dimensions/risk-tier.md](dimensions/risk-tier.md) |

## Derived artifacts

| id | Artifact | Producer |
|---|---|---|
| `design` | `10-design-fit-signals.json` | `scripts/lib/derive-design-fit.sh` |
| `complexity` | `11-complexity-signals.json` | `scripts/lib/derive-complexity.sh` |
| `dependencies` | `12-dependency-signals.json` | `scripts/lib/derive-dependencies.sh` |
| `privacy` | `13-privacy-signals.json` | `scripts/lib/derive-privacy.sh` |
| `resilience` | `14-resilience-signals.json` | `scripts/lib/derive-resilience.sh` |
| `rollout` | `15-rollout-signals.json` | `scripts/lib/derive-rollout.sh` |
| `observability` | `16-observability-signals.json` | `scripts/lib/derive-observability.sh` |
| `contract` | `17-contract-signals.json` | `scripts/lib/derive-contract.sh` |
| `maintainability` | `18-maintainability-signals.json` | `scripts/lib/derive-maintainability.sh` |
| `performance` | `21-performance-signals.json` | `scripts/lib/derive-performance.sh` |
| `risk_tier` | `20-risk-tier.json` | `scripts/lib/derive-risk-tier.sh` |
| `llm_judgment` | `22-llm-judgment.json` | host agent + `scripts/lib/merge-llm-findings.py` (not a collect-time derive) |

Missing derived files on legacy packs → validate **WARN** only; review may still
apply the dimension thinly from pack artifacts or skip with explicit None.
`22-llm-judgment.json` is written **after** the agent LLM pass; collectors do not
emit it, and validate must not hard-fail when it is absent.
