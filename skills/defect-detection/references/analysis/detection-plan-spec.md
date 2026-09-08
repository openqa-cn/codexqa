# Detection-plan build spec

> This file is the complete spec for the Step 1.8 detection plan: strategy assignment, minDetectLevel definition, and merge logic.

---

## Core principles

The detection plan is decided by two dimensions together:

- **Method scope (ceiling) = git-diff changed-method set**
- **Strategy floor = platform pending process from get-pending**

Final detection plan = method scope ∪ get-pending method set (union).

If the same method has both AST(s8) and business detection(s11), each strategy is detected and written back independently. Do not merge them.

---

## Three build stages

### Stage 1: extract changed methods from git diff (local)

1. Read `$DIFF_FILES[]` file by file; extract changed classes and methods (signature, line range, change type)
2. Load `DOC_SUMMARY.md` and map business rules to changed methods
3. Annotate `docRelevance` (direct/indirect/none) and `caseRelevance` (direct/indirect/none)

### Stage 2: fetch platform pending process

Run `get-pending` for each `$BATCH_IDS[]` and build `$ALL_PENDING_MAP`:

```
key:   ${parentBatchId}::${className}::${methodName}::${strategyCode}
value: { processId, batchId, strategyCode, parentBatchId }
```

### Stage 3: merge

| Source | source tag | Notes |
|---|---|---|
| get-pending process | `pending` | Platform-mandated; must not be missed |
| git-diff-only methods | `diff` | Extra focus points the Agent identified |

---

## Detection-plan item structure

```json
{
  "className": "com/example/xxx/Service",
  "methodName": "doSomething",
  "strategyCode": 3,
  "parentBatchId": 959440,
  "processId": 12345,
  "batchId": 67890,
  "filePath": "src/main/java/com/example/xxx/Service.java",
  "docRelevance": "direct|indirect|none",
  "caseRelevance": "direct|indirect|none",
  "source": "pending|diff",
  "status": "pending",
  "minDetectLevel": "L1|L1+doc|L2|L2+TC",
  "chainGroupId": "chain-1|null"
}
```

> `chainGroupId`: Call-chain group id. Methods on the same Call chain (e.g. `A→B→C`) share one `chainGroupId`,
> used by Phase 2 "chain-group-first analysis" — the group **reads the full chain code and context once** and shares understanding, avoiding per-method rebuild.
> When no chain relation can be identified (isolated method, unreachable cross-repo dynamic dispatch, etc.) it is `null` and grouping falls back to className.
> **It is only an analysis-orchestration hint, not a hard constraint**: it does not change any process writeback credential requirement (Hard rule 14/22 still validate per process).

---

## chainGroupId clustering rules (run when Phase 1 Step 1.8 builds the detection plan)

Call-chain clustering is an **optional enhancement** of the detection plan. It groups changed methods on the same Call chain
so Phase 2 can share context and cut repeated code reads. Clustering uses local static call relations; no network.

### Clustering inputs

- Changed-method set extracted from `$DIFF_FILES[]` (className/methodName/filePath)
- Call-chain info already on strategy=11 items (Controller→Service→Dao hops)
- Locally cloned source (grep static analysis of "who calls whom")

### Clustering steps

1. **Build call edges**: for each changed method `M`, grep `M`'s method name in local source; find other methods **inside the changed set** that call it or are called by it; create directed call edges (only among changed methods; do not expand to unchanged methods).
2. **Connected-component clustering**: methods connected by call edges share one `chainGroupId` (e.g. `chain-1`, `chain-2`).
3. **Identify the chain entry**: inside each group, methods with in-degree 0 (no changed method calls them) are chain entries; analysis starts at the entry and walks downstream.
4. **Isolated methods**: changed methods with no call edge get `chainGroupId=null` and group by className as usual.

### Clustering degrade (safe fallback when identification is unreliable)

| Situation | Handling |
|---|---|
| Cross-repo source unreachable; cannot grep call relations | That method `chainGroupId=null`; group by className |
| Dynamic dispatch (Spring injection / Thrift / reflection) makes call relations unreliable | Prefer no clustering (`chainGroupId=null`) over wrong clustering that skips analysis |
| Chain group too large (>15 methods) and hard to split | May split by className into sub-groups so one group is not too long for parallelism |

> ⚠️ **Red line**: clustering failure **must never** cause any pending process to be skipped.
> If clustering is unreliable, fall back to "group by className" full analysis. Full-depth detection requirements (Step 2.6) are unchanged.

---

## Strategy assignment

git-diff-only methods get a strategy by these rules:

| Condition | Assigned strategy |
|------|----------|
| Code logic / Call chain / business comparison | strategy=11 (Skill-exclusive business detection) |
| Hits an AST rule | strategy=8 (whole-repo scan, not limited to the diff) |

> The Agent decides analysis depth by method difficulty (detectTier).

---

## minDetectLevel assignment

Highest priority first:

| Condition | minDetectLevel | Meaning |
|---|---|---|
| `caseRelevance=direct` | `L2+TC` | Code logic + test-case step-by-step verification |
| `caseRelevance=indirect` | `L2` | Code logic + business-doc / rule analysis |
| `docRelevance=direct` | `L2` | Code logic + requirement / tech-doc analysis |
| `docRelevance=indirect` | `L1+doc` | Code analysis + read docs for background |
| Other (all none) | `L1` | Pure code-logic analysis |

> `minDetectLevel` is a floor, not a ceiling. Deeper is allowed; shallower is not.

---

## detectTier layering

`detectTier` (T1/T2/T3) decides how much analysis depth a process gets. Phase 1 assigns it from `minDetectLevel` + change importance when building the detection plan.

> "T0" in the docs is only a shorthand for *auto-dismissed* AST hits (out-of-diff / generated). It is not a plan tier and is **rejected by write-back validation** — a write-back's `detectTier` must always be one of `T1|T2|T3` (use the plan item's value; auto-dismissed hits are written with bugStatus=2 under their plan tier).

### Assignment

| Condition (highest priority first) | detectTier | Share (reference) |
|---|---|---|
| minDetectLevel=L2+TC or caseRelevance=direct | **T1** (high) | ~20% |
| minDetectLevel=L2 or docRelevance=direct or source=pending and strategyCode=11 | **T2** (medium) | ~40% |
| Other (minDetectLevel=L1/L1+doc and no special mark) | **T3** (low) | ~40% |

### Execution differences

| detectTier | Steps | thinking requirement |
|---|---|---|
| **T1** | A(full) + B(full) + C(all dimensions) + C.5(8 items) + D | ≥80 chars; cite line numbers + variable names + business rules |
| **T2** | A(full) + B(lite, 1 hop) + C(strategy focus) + C.5(fast 3 items) + D | ≥50 chars; cite line numbers + variable names |
| **T3** | A(full) + C(L1 scan only) + D | ≥30 chars; must cite ≥1 concrete line number |

### Immutability

`detectTier` is fixed by the detection plan. During Phase 2 the Agent **must not self-downgrade** (e.g. T1 → T3). If a T3 method finds an issue during analysis, it may **auto-upgrade** to T2 and backfill C.5.

### Execution-mode differences (light vs strict)

Execution mode is inferred automatically in Phase 1 `get-changed-methods` from total changed lines in `git diff --stat` (additions + deletions): **< 200 lines → light**, **≥ 200 lines → strict**. The mode field is injected into every detection-plan item and passed to scripts/validate.ts via `request_body["_mode"]`.

light mode relaxes these Agent-side Hard rules (Hard rule 15/16 business-impact analysis, Hard rule 17.2 structured field count, Hard rule 21 minDetectLevel depth gate, Hard rule 22 contextReads count):

| Dimension | strict (default) | light (change < 200 lines) |
|---|---|---|
| **Hard rule 15** Affected business annotation | Must fill every item | **Exempt**; not required |
| **Hard rule 16** Reproduction path analysis | Must analyze | **Exempt**; not required |
| **Hard rule 17.2** Structured field count | ≥ 3 | **Lowered to ≥ 1** |
| **Hard rule 21** minDetectLevel depth gate | Enforced (L2/case citations cannot be skipped) | **Exempt**; minDetectLevel is not a hard intercept |
| **Hard rule 22** contextReads count | ≥ 2 files | **Lowered to ≥ 1 file** |

> ⚠️ Other Hard rules (Hard rule 0/1/3/4/4.1/11/12/13/14/17.1/17.3/18/19 and other core field gates) are **not exempt**. light and strict share the same requirements.

---

### Phase 2 mandatory rules

| minDetectLevel | thinking must include | processSteps must include |
|---|---|---|
| `L2+TC` | ≥1 test-case step / expected-result verification | referencedSources(sourceType=test_case) |
| `L2` | ≥1 document business-rule citation | refDocUrls or referencedSources |
| `L1+doc` | One sentence of document background | — |
| `L1` | Concrete line numbers / variable names | — |

A process that violates minDetectLevel must not be written back.

---

## Strategy vs three-layer analysis

| Strategy | Detection dimension | Three-layer focus | Typical concerns |
|---|---|---|---|
| s8 | AST scan | L1 (code patterns) | Whole-repo semgrep scan |
| **s11** | **Skill-exclusive business detection** | **L1+L2+L3** | Code logic + chain + business comparison; Agent decides depth by detectTier |

> s11 uniformly covers "in-method logic", "Call chain", and "business comparison". The Agent decides depth from detectTier and method complexity.

---

## Detection startup flow

```
Phase 1 done ($DETECTION_PLAN ready)
    │
    ▼
Phase 2 start:
    ├── Step 2.1: whole-repo AST scan → match s8 items → batch writeback
    ├── Step 2.2: chain-group-first grouping (non-null chainGroupId grouped; null grouped by className)
    │     ├── Inside a chain group: read full-chain code+context once (shared), analyze methods from entry downstream
    │     └── After each group: batch-write s11 (writeback credentials still registered per method)
    └── Step 2.3: business-knowledge comparison (unified s11; Agent decides Call-chain + business-comparison depth by detectTier)
    │
    ▼
Phase 3 coverage check:
    ├── check-coverage confirms allCompleted=true
    └── complete-task
```
