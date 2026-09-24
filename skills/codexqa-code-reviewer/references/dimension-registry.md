# Dimension registry (extension contract)

**Single source of pipeline order** for codexqa-code-reviewer. Prompts and
[review-dimensions.md](review-dimensions.md) must follow this table — do not
re-order dimensions in prompts alone.

When adding a detection rule or scanner shape, follow
[rule-construction.md](rule-construction.md) first. Join family F1–F5 (or
justify a new family). Do not add a look-for that only matches the sample
that motivated the rule.

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
| 4 | `correctness` | Correctness / state | both | reuse | 0 | [dimensions/correctness.md](dimensions/correctness.md) |
| 5 | `resilience` | Error handling / resilience | both | derive | 0 | [dimensions/resilience.md](dimensions/resilience.md) |
| 6 | `security` | Security / sensitive | both | reuse | 0 | [dimensions/security.md](dimensions/security.md) |
| 7 | `privacy` | Privacy / compliance | both | derive | 0 | [dimensions/privacy.md](dimensions/privacy.md) |
| 8 | `contract` | API / contract | both | derive | 0 | [dimensions/contract.md](dimensions/contract.md) |
| 9 | `rollout` | Change / rollout | both | derive | 0 | [dimensions/rollout.md](dimensions/rollout.md) |
| 10 | `concurrency` | Concurrency / consistency | both | reuse | 0 | [dimensions/concurrency.md](dimensions/concurrency.md) |
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
| `sast` | `23-sast-signals.json` | `scripts/lib/derive-sast.sh` (Semgrep, Bandit, gosec, gitleaks, osv-scanner, ruff, eslint) |

Missing derived files on legacy packs → validate **WARN** only; review may still
apply the dimension thinly from pack artifacts or skip with explicit None.
`22-llm-judgment.json` is written **after** the agent LLM pass; collectors do not
emit it, and validate must not hard-fail when it is absent.

## Detection rule index

Synced from the defect-analyzer policy pack (v1.1.0). **Do not re-order the
pipeline** to match defect types. Each rule is applied inside its owner
dimension (card **Detection rules** table). New or edited look-for text must
pass [rule-construction.md](rule-construction.md). The order-16 Agent LLM pass
re-checks every shape in the look-for cell, including shapes the scanner did
not emit, then dedupes. One hit does not close the `rule_id`.

`finding_category` stays the owner dimension. Set optional `rule_id` on the
finding. A hit cites every signal row for that id. Two different `rule_id`s
on one line are two findings. Read judgment rules from pack diffs and bounded source. Scanner-shaped
defects follow per-hit `disposition` in `23-sast-signals.json`: `report` is a
card and skips the model, `drop` is discarded, `suspect` is the only SAST
input to the model (`suspects[]` slice plus that row’s policy). Class
`llm_report_policy` remains: `allow` records a scanner gap and does not
rescan the class, `suppress_obvious` does not re-file an obvious hit,
`dedupe_loci` means certain hits are already filed. A tool with
`skipped_no_files` does not cover a class.

Global skip: style-only edits; TODO/FIXME older than the diff; a do-not-report
case on the rule; the same class already filed at the same file:line.
Float/double money is not `BIZ-003`. `TXN-001`, `CONC-001`, and `PAY-001` stay
separate when the code has each shape. `rule_coverage` lists every id below as
`hit` or `skip`.

| rule_id | defect type | owner | category | default |
|---|---|---|---|---|
| `SEC-001` | security | security | `security` | P0 |
| `AUTH-001` | security | security | `security` | P0 |
| `AUTH-002` | security | security | `security` | P0 |
| `TEN-002` | security | security | `security` | P0 |
| `TEN-004` | security | security | `security` | P1 |
| `TEN-005` | security | security | `security` | P0 |
| `TEN-006` | security | security | `security` | P1 |
| `HYG-001` | hygiene | security | `security` | P2 |
| `NULL-001` | null_safety | correctness | `correctness` | P1 |
| `RES-001` | resource_leak | correctness | `correctness` | P1 |
| `LOGIC-001` | logic | correctness | `correctness` | P2 |
| `BIZ-001` | logic | correctness | `correctness` | P1 |
| `BIZ-002` | logic | correctness | `correctness` | P1 |
| `BIZ-003` | logic | correctness | `correctness` | P2 |
| `BND-001` | logic | correctness | `correctness` | P1 |
| `BIZ-004` | logic | correctness | `correctness` | P1 |
| `BIZ-005` | logic | correctness | `correctness` | P1 |
| `TXN-001` | transaction | correctness | `correctness` | P1 |
| `PAY-001` | transaction | correctness | `correctness` | P0 |
| `PAY-002` | transaction | correctness | `correctness` | P0 |
| `PAY-004` | transaction | correctness | `correctness` | P1 |
| `PAY-005` | transaction | correctness | `correctness` | P1 |
| `PAY-006` | transaction | correctness | `correctness` | P1 |
| `PAY-007` | transaction | correctness | `correctness` | P1 |
| `CONC-001` | concurrency | concurrency | `concurrency` | P1 |
| `CONC-002` | concurrency | concurrency | `concurrency` | P1 |
| `CONC-003` | concurrency | concurrency | `concurrency` | P1 |
| `ARCH-001` | architecture | design | `design` | P2 |
| `DES-001` | architecture | design | `design` | P2 |
| `GLOB-001` | security | security | `security` | P1 |
| `API-001` | architecture | contract | `contract` | P2 |
| `PERF-001` | architecture | performance | `performance` | P2 |
| `ERR-001` | hygiene | resilience | `resilience` | P2 |

There is no `AUTH-003`. Auth-bypass branches are `SEC-001` on Security, or the
authz half of `ARCH-001` when the defect is a layer that skips auth. File that
half as `security`, not a second design finding, unless the same code also
skips a layer boundary (`ARCH-001` only then). A personal identifier in a
human-visible sink is both `HYG-001` and a Privacy finding; do not drop
hygiene because privacy already filed. Alias rows live in
[rule-construction.md](rule-construction.md).
