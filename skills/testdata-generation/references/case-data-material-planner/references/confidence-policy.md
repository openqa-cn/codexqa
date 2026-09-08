# confidence-policy

> This document is the **single authoritative source** of thresholds read by `lint_manifest.ts` / `finalize.ts`. Invoke / bind write confidence; there is no verify-* Agent.
> When raising a threshold you must add a new policyVersion and register it in the POLICY dictionaries of `lint_manifest.ts` / `finalize.ts`.
> Historical manifests are interpreted by their own `policyVersion` field; no live migration is performed.

## Current version

policyVersion = `"2.0.0"`

## dataConfidence scoring table (per entity)

| Value | Meaning | constructionStrategy |
|---|---|---|
| 0.0  | Construction failed / missing-dependency | tool-build |
| 0.5  | Deterministic config generation (not executed manually) | config |
| 0.7  | Tool call succeeded, no explicit success marker | tool-build |
| 0.85 | Tool call succeeded, includes confirmation (code=0/success=true) | tool-build |
| 0.85 | static-value filled directly by parse-case | static-value |
| null | runtime-deferred (produced at execution time) | runtime |

Written to entity.dataConfidence by `invoke_entity.ts` (final value decided immediately after a successful invoke).
Entities with `constructionStrategy ∈ {"config", "runtime"}` do not participate in lint-gate low-confidence detection or caseConfidence aggregation.

## cmdConfidence scoring table (per action)

| Value | Meaning |
|---|---|
| 0.0 | Tool not found / gen-failed / tool schema comparison failed |
| 0.3 | Command still contains unfilled templates (missing-param) |
| 0.7 | Command fully filled, no semantic check (non-tool tool and no dry-run capability) |
| 0.9 | Command fully filled, and passed tool input-list comparison or another tool's dry-run |
| 1.0 | 0.9 plus tool health check passed |

Written to action.cmdConfidence by `bind_action.ts` / `verify_tool_input_list.ts` (initial value at bind, upgraded at verify).

> **tool-specific**: for an action with `toolType=="tool"`, `bind_action.ts` must call `scripts/verify_tool_input_list.ts`; that script pulls the schema via adapter `tool_registry.query_input_list` and runs four checks — required-coverage / no-orphan / type-sanity / value-sanity. All pass → 0.9; any failure → 0.0. There is no 0.7 fallback.

## caseConfidence aggregation formula

```
caseConfidence = w_data * avg(scorable_entities.dataConfidence)
               + w_action * avg(actions.cmdConfidence)
```

- `scorable_entities` = the subset of entities whose `constructionStrategy ∉ {"config", "runtime"}`
- `w_data = 0.6`
- `w_action = 0.4`
- On a single-track short-circuit (scorable_entities or actions is empty), weights are not re-normalized; caseConfidence is the mean of the side that exists
- On `force-pass` (confirmations contains decision="force-pass") → caseConfidence *= 0.8

## lint-gate thresholds

| Constant | Value | Purpose |
|---|---|---|
| `THRESH_DATA_CONF_MIN`     | 0.6 | Lower bound on data-track average confidence (tool-build entities only); below this → FAIL (suggestedAction: rerun-data-pipeline) |
| `THRESH_VERIFY_FAIL_RATIO` | 0.3 | Action-side verify-report ratio of "verification tool unreachable"; above this → FAIL (suggestedAction: rerun-action-pipeline). Entity side is no longer checked |
| `THRESH_MAX_ROUND`         | 3   | Maximum bounce-back rounds; exceeding this becomes ROUND_EXCEEDED for a forced user decision |

## proven cache policy

Tool-binding cache has two levels: `candidate` (written after search) and `proven` (promoted after a successful invoke/verify).
A proven entry holds successful-call experience (call template, parameter mapping, produced fields) for concurrent Agents to reuse when invoke fails.

### proven write thresholds

| Side | Write condition | Threshold |
|-----|---------|------|
| entity | promote after successful invoke | dataConfidence >= 0.6 |
| action | promote after verify passes | cmdConfidence >= 0.6 |

Successful results below the threshold are not written to the proven cache (only the candidate-level entry is kept).
Rationale: a low-confidence "success" may be a misjudgment (e.g. the tool returned 200 but the data is incomplete); propagating it to other Agents would amplify the error.

### proven consumption rules

| Consumption scenario | Behavior |
|---------|------|
| cache hit proven at Agent start | Adopt the proven call template directly; skip search |
| cache hit proven after Agent invoke/bind failure | Retry once with the proven template (proven recovery) |
| proven recovery still fails | Do not look up again; fall through to the existing failover logic |

### proven overwrite rules

A proven entry for the same key is overwritten only when the new confidence is higher.
A candidate write does not overwrite an existing proven entry (proven outranks candidate).

### cache key format

| Side | key format | Rationale |
|-----|---------|------|
| entity | `entityType::constructionIntent` | create / transition / clear of the same entityType need different tools |
| action | `actionDesc` (unchanged) | An action is naturally identified by its operation description |

## Upgrade process

1. Add a new policyVersion (e.g. "1.1.0") and append a section in this document
2. Add a new key in the POLICY dictionaries of `lint_manifest.ts` / `finalize.ts`; keep the old-version keys
3. The manifest template's `policyVersion` points at the new version; historical manifest fields are left untouched and looked up by their own version at read time

## Historical versions

### 1.1.0

- Added `paramsFromGenerators` / `paramsFromPriorActions` parameter sources
- THRESH_DATA_CONF_MIN = 0.5

### 1.0.0

- Initial version
- cmdConfidence 0.9 = "dry-run passed", 0.7 = "no dry-run, passed syntax check"
- Only one parameter source: `paramsFromEntities`
