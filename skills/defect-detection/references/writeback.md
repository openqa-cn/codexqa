# Write-back spec and behavior rules

> **When to load**: before the first Phase 2 write-back. This file is the complete write-back reference: field rules, content format, and behavior rules.
> **Validation authority**: `scripts/validate.ts` is the only programmatic implementation of the rules. This file is for understanding; if they conflict, the code validation wins.
>
> **💡 Quick reference**: if you only need to check fields and format quickly, prefer `references/writeback/writeback-quickref.md` (compact cheat sheet, <80 lines).
> This file is for first-time learning or diagnosing complex write-back issues end to end.

---

## Contents

- [Core principles (4 items; R1–R8 all live here)](#core-principles-4-items-r1r8-all-live-here)
- [bugStatus semantics (unified value domain, globally consistent)](#bugstatus-semantics-unified-value-domain-globally-consistent)
- [Fast fill-in templates](#fast-fill-in-templates)
- [Pre-write-back self-check list](#pre-write-back-self-check-list)
- [Field constraints](#field-constraints)
- [content field format spec](#content-field-format-spec)
- [bugStatus=6 vs bugStatus=7 judgment](#bugstatus6-vs-bugstatus7-judgment)
- [content views by strategy](#content-views-by-strategy)
- [processSteps structure](#processsteps-structure)
- [fileCodes coverage](#filecodes-coverage)
- [🔑 fileCodes authoritative mapping (root fix for "gitUrl and filePath mapped wrong")](#filecodes-authoritative-mapping-root-fix-for-giturl-and-filepath-mapped-wrong)
- [Model-prediction feedback](#model-prediction-feedback)
- [Development-stage exemption (R8)](#development-stage-exemption-r8)
- [🎯 Full write-back Python code examples](#full-write-back-python-code-examples)

---

## Core principles (4 items; R1–R8 all live here)

> R1–R8 are behavior rules, not operation commands. Concrete operations are in each field spec and content template.

| # | Principle | Key points |
|---|---|---|
| **R1 Quality floor** | No empty detection | thinking must have real analysis (including line-number / variable-name citations), processSteps must have real conclusions, fileCodes must include filePath/git/branch/commitId |
| **R2 Complete defects** | Write back as soon as found | Real issues are always bugStatus=6/7; do not downgrade because "not this change". Distinguish [This change] and [Pre-existing] via Problem tags in content; this does not affect write-back itself |
| **R3 Strategy consistency** | Analysis view matches the strategy | Each process's analysis dimensions must match the view required by strategyCode (see the content-view table) |
| **R4 Verifiability** | content can be checked by the user | Must include: Impact scope + Trigger conditions + Expected vs actual (bugStatus=6) or Current impact + Rationale (bugStatus=7) |

---

## bugStatus semantics (unified value domain, globally consistent)

> **Value domain is globally unified**: `bugStatus` meanings stay the same in every command / context / document. There are not three different semantic tables for process, rank, and report.

| Value | Meaning | Owner | Notes |
|---|---|---|---|
| 0 | Initial (unprocessed) | System | Default `get-pending` state; Agent still to analyze |
| 2 | no defect | AI conclusion | After analysis, judged No defect in this code |
| 6 | suspected defect (functional exception / error / data error) | AI conclusion | needs confirmation |
| 7 | Improvement (function works but quality can be improved) | AI conclusion | needs confirmation |
| 3 | Needs fix (user confirmed) | User decision | User confirmed item 6 as a real defect |
| 4 | Invalid defect (user confirmed) | User decision | User judged it a false positive |
| 5 | Later improvement (user confirmed) | User decision | User thinks it can be deferred |
| 8 | Duplicate defect (user confirmed) | User decision | Duplicates another defect |

**Per-command constraints**:
- `batch-dismiss-by-strategy`: bugStatus=0 (unprocessed) → 2 (no defect); only for AST (strategy=8) batch cleanup
- **Local write-back protect**: a later bugStatus=2 for the same class+method+strategy **cannot overwrite** an existing bugStatus=6/7 record. `batch-update-process` skips those items (conflict). Do not put already-written defects into a later no-defect batch.
- `finalize-rank`: accepts only 6 or 7 (methods with no defect do not need a rank)
- When `reconcile-report` reconciles, 3/6/7/8 all count as "has a defect" (3 and 8 are post-confirm evolutions)
- `mark-bug`: accepts 3/4/5/8 (user-decision states; does not accept AI conclusions 2/6/7)

---

### R2 supplement: AST scan scope

PR/diff tasks default to **changed-file** AST (`run-ast-scan --task-id`). Whole-repo is opt-in (`--full-repo`).
- **In-diff** hits verified as real defects → bugStatus=6/7 (do not drop).
- **Out-of-diff** hits (`inDiff=false`) and generated hits → auto-dismiss as bugStatus=2 (T0). Do not verify 58 stock hits one by one.
- If an out-of-diff hit is still verified and is real → write bugStatus=6/7 with a [Pre-existing] tag.

---

## Fast fill-in templates

> ⭐ **Preferred practice: before you start filling, take a "live sample" and adapt it. Do not learn by submitting and reading errors.**
>
> ```bash
> # Get a sample for the strategy and conclusion you are about to write (strategy: 2 general / 11 business detection / 8 AST; bug-status: 2 no defect / 6 suspected defect / 7 Improvement)
> node "$SKILL_SCRIPT" process-sample --strategy 11 --bug-status 6
> ```
>
> This command outputs a complete batch-item JSON **already filled with real example values and already passing local validation**. You only replace every `<fill:...>` placeholder with real values (parentBatchId/processId/className/methodName/real line numbers/real code/tagId, etc.) and copy the rest of the structure. **You do not need to walk validation rules one by one.** This is the most direct way to see what a correct process looks like — format is guaranteed by "sample-forward guidance", not "validation bouncing you back".
>
> Full CLI / API fill-in templates (templates A–F + strategy extras): `references/writeback/writeback-templates.md`.
> This file keeps the **field-constraint cheat sheet** and the **pre-write-back self-check list**. Check them before write-back.

### End-to-end workflow from pending to write-back (recommended)

> **Core principle**: the `get-pending` response already carries all context needed for write-back. Do not hand-assemble git/branch/filePath.

**Step 1: get pending data (including repo context)**

```bash
node "$SKILL_SCRIPT" get-pending --task-id $TASK_ID --batch-id $BATCH_ID
```

Return structure (enriched response):
```json
{
  "parentBatchId": 952025,
  "git": "git@github.com:org/repo.git",
  "repoName": "order-service",
  "serviceName": "order-service",
  "developBranch": "feature/xxx",
  "pendingCount": 12,
  "pendingMethods": [
    {
      "className": "com/example/order/OrderService",
      "methodName": "createOrder",
      "methodHash": "abc123",
      "processes": [{"processId": 12345, "strategyCode": 11, ...}]
    }
  ]
}
```

**Step 2: generate a template for a concrete process**

```bash
# gen-writeback-template can accept --task-id/--class-name/--method-name to prefill context
node "$SKILL_SCRIPT" gen-writeback-template \
  --strategy-code 11 --bug-status 6 \
  --task-id $TASK_ID \
  --class-name "com/example/order/OrderService" \
  --method-name "createOrder"
```

When `--task-id` is passed, the template auto-fills `fileCodes` `filePath/git/branch/commitId` from task-persisted data (resolve-writeback-context logic). The output JSON can be used for write-back directly.

**Step 3: fill the analysis conclusion and submit**

Merge Step 1 `processId` / `parentBatchId` with Step 2 template `fileCodes` (already resolved), fill real `thinking` / `content` / `processSteps`, then submit:

```bash
node "$SKILL_SCRIPT" batch-update-process --task-id $TASK_ID --items-json batch.json
```

> **Key points**:
> - `className` supports short class names: the platform fuzzy-matches to the stored full-path format (e.g. `OrderService` → `com/example/order/OrderService`)
> - `register-code-read` may use the short class name or the slash/dot FQCN; Hard rule 14 matches both (do not re-register just to change the format)
> - `fileCodes` `git` / `branch` / `commitId` come from top-level fields of the pending response. **Do not hand-assemble them from script variables or meta.json**
> - When `--task-id` is passed, fileCodes are auto-corrected; even a wrong fill is rewritten to the authoritative value (stderr prints a `🔧` hint)
> - On validation failure the platform **returns every error at once** (not one by one); fix them in batch from the error list

### Frontend / client project extras

> Full frontend detection notes (AST scan, false-positive traps, etc.): `references/rules/frontend-gotchas.md`.

- **Code-block language tag**: JS/TS use `javascript`/`typescript`; Kotlin uses `kotlin`; Swift uses `swift`; Objective-C uses `objc` (do not use `java`)
- **thinking must state**: the client tech-stack type and that stack's runtime characteristics
- **Layer 4 contract analysis**: if Layer 4 triggers (client + backend mixed), content must include "upstream/downstream contract analysis"
- **fileCodes coverage**: must include client code and (if any) backend interface definitions involved in the call
- **Memory / OOM defects**: must clearly state "OOM after long running" or "memory not released after leaving the page"
- **Container compatibility issues**: must clearly state which container (React Native / WebView / mini program / Flutter / flexbox) crashed or misbehaved

---

## Pre-write-back self-check list

> **Dedup note**: `scripts/validate.ts` already hard-intercepts validation rules 0–22 (including Affected business / Reproduction path / plain-text format / Problem tags / exclusion_rule_filter / register-code-read / register-repo-clone, etc.). Submissions that fail are blocked automatically with clear fix guidance. **Do not repeat that list here.** Full intercept items: `references/rules/validation-rules.md`.
>
> The table below **only lists document-level soft constraints that scripts/validate.ts does not intercept** (mainly frontend/client-stack wording). The Agent must check them itself.

### ⚠️ Confidence and open-question output validation [MUST — cannot omit when in doubt]

**Purpose**: make sure confidence in the analysis conclusion is evidence-based, and open questions are explicitly output to the user (not assumed arbitrarily or silently ignored).

**Trigger**: when STEP C.5 D9 concludes "partially holds" or there is reasonable doubt that cannot be ruled out, this item is required.

**Validation requirements**:

| Check | Requirement | thinking fix example when it fails |
|---|---|---|
| Confidence marker | When bugStatus=6/7, thinking must end with `[Confidence:HIGH/MED/LOW]` | `"...Conclusion: partially holds. [Confidence:MED][C5✓]"` |
| Needs-confirmation when in doubt | When `[Confidence:MED/LOW]`, thinking must include a `[Needs confirmation]` section (open question + current assumption + what the user must confirm) | `"[Needs confirmation] Whether this path is reachable in production. Current assumption: production enables this config. Please confirm: whether that switch is already on. [Confidence:LOW]"` |
| content also outputs it | When bugStatus=6/7 and in doubt, content must also include `[Confidence:LOW]` and a `[Needs confirmation]` section — same marker as in thinking (see format example below) | — |
| No arbitrary assumption | Do not skip write-back because you are "unsure", and do not "treat as defect" or "treat as no defect" without telling the user | — |

**Example format for confidence and pending confirmation in content**:

```
## Defect description

[Confidence:LOW]
[Needs confirmation]
- Open question: actual call frequency and caller distribution of this API in production
- Current assumption: only called by the internal admin console; impact is small
- Please confirm: is there a path where end users hit this API directly? Does it need user-facing rate limiting?

---(standard fields below)---

Location: com.example.order.xxxService#processOrder
Lines: 156-178
...
```

> **Why you still write back bugStatus=6/7 when in doubt**: in doubt ≠ false positive. If the code really has a triggerable defect path, even if final confirmation depends on business config or usage, write it back so the user knows and can decide. Open questions reach the user through the `[Needs confirmation]` block in the write-back and the 🔔[Pending confirmation] section of the final summary; the user decides whether a fix is needed.

### ⚠️ Line-to-method ownership check [MUST — cannot skip]

> **Historical lesson**: content line numbers once did not match `--method-name` (the lines belonged to another method in the file), so the report method name and problem lines did not correspond and users could not locate the issue.

**Before writing bugStatus=6/7 content, the Agent must run this check**:

1. Extract start line X from `Lines:X-Y` in content
2. In the source file, confirm line X **actually falls inside** the `methodName` method body being written (declaration line ≤ X ≤ method end line)
3. Check method: search upward for the nearest method declaration (`public/private/protected ... methodName(`) and confirm it matches
4. **On mismatch**: the line belongs to another method. You must correct `--method-name` and `--class-name` to the method that actually owns the line, or correct the line numbers to the right place inside the current method

**Same rule for `finalize-rank`**: `--method-name` must match the method that owns the line numbers in `--content`.

**Quick check command** (optional helper):
```bash
# Find which method owns line X in the source file
grep -n "public\|private\|protected" <file> | awk -F: -v line=X '$1 <= line' | tail -1
```

```
□ [Frontend/client project] Does thinking state the tech-stack type (React Native / WebView / mini program / Flutter / Android / iOS)?
□ [Frontend/client project] Is the code-block language tag correct (JS/TS/Kotlin/Swift/Objective-C; do not use java)?
□ [Frontend/client has a defect and Layer4 triggered] Does content include "upstream/downstream contract analysis"?
□ [Frontend/client has a defect; memory leak] Does content clearly state "long-running OOM" or "memory not released"?
□ [caseRelevance=direct/indirect] Does thinking cite concrete test-case content (validation rule 7 only checks that referencedSources / case citations exist; content quality is a self-check)?
```

**Unmet soft constraints are not programmatically blocked, but they lower report quality. Check them yourself before submit. All other field/format issues are intercepted by scripts/validate.ts; you do not need to "submit first, then fix from errors".**

---

## Field constraints

> **Authoritative full definition**: field constraints and the content format below are authoritative in this file; `references/writeback/writeback-quickref.md` is a compact mirror (for a quick pre-write-back check). If they disagree, this file wins; ultimately `scripts/validate.ts` programmatic validation wins.

| # | Constraint | Notes |
|---|---|---|
| C0 | **processId must be written back** | Take each record's `processId` from `get-pending` and pass it on write-back. Omitting it makes the platform create a new record instead of updating the existing pending one |
| C1 | Write back only one method at a time | The quadruple `(parentBatchId, className, methodName, strategyCode)` is unique |
| C2 | thinking is required | Whether or not there is a defect |
| C3 | processSteps is non-empty | Must not be an empty array |
| C4 | ruleId is required when a rule strategy has a defect | AST rule (strategyCode=8) and bugStatus=6/7 |
| C5 | tagId is required when there is a defect | bugStatus=6/7 |
| C6 | fileCodes is non-empty | Each item includes filePath/git/branch/commitId, **and must come from the authoritative mapping** (see "fileCodes authoritative mapping" below). Do not assemble a path with `FILE_PREFIX + className` or use a hard-coded GIT_URL from a script |
| C7 | hitRuleIds — required when strategy=8 has a defect | |
| C8 | astRuleCount — required for strategy=8 and >0 | Taken from run-ast-scan output |

---

## content field format spec

> **⚠️ Platform render limit**: the detection platform report **does not render Markdown bold** (`**text**` shows as asterisks).
> All field names must be **plain text** (e.g. `Problem description:` not `**Problem description:**`).
> Only `## heading` and ` ```code block``` ` render normally.

### no defect (bugStatus=2)

🔒 **content is fixed to this one sentence. Do not rewrite, polish, or add reasons** (reasons go in the `thinking` field):

```
No defect in this code
```

> This fixed value is the script constant `NO_DEFECT_CONTENT`, auto-generated by `process-sample --bug-status 2`. Do not hand-write other copy (e.g. "no defect found" / "code has no issue" are all out of spec).

### suspected defect (bugStatus=6)

```markdown
## Defect: <one-line title>

Lines: <start>-<end>

Problem description: <cite concrete line numbers and code; describe the risk>

Problem tags: [<tag name>][This change / Pre-existing]

Impact scope: <describe the affected feature in business language>

Affected business: <which concrete business feature / flow / scenario this defect affects>

Reproduction path: <call API A → pass parameter X → hit branch Y → produce error Z>

Trigger conditions:
1. <condition 1>
2. <condition 2>

Expected vs actual:
- Expected: <normal behavior>
- Actual: <exception caused by the defect>

Fix suggestion: <direction>

```java
// fix code
```
```

### Improvement (bugStatus=7)

```markdown
## Improvement: <one-line title>

Lines: <start>-<end>

Problem description: <what is unreasonable about the current writing>

Problem tags: [<tag name>][This change / Pre-existing]

Impact scope: <involved features>

Affected business: <which concrete business feature / flow / scenario this issue affects>

Reproduction path: <call API A → pass parameter X → hit branch Y → expose issue Z>

Current impact: <it does not fail now, but when might it fail>

Rationale: <cite a best practice or spec>

Improvement plan: <direction>

```java
// improvement code
```
```

### Problem tags format spec

- Every single tag must be wrapped in [], e.g.: `[Parameter / null check]`
- You must append an introduction-period tag: `[This change]` or `[Pre-existing]`
- Judgment rules:
- [This change]: the defective code was added or modified in this change (diff)
- [Pre-existing]: the defective code already existed before this change; this change did not touch that line
- Full example: `Problem tags: [Parameter / null check][This change]`
- Multi-tag example: `Problem tags: [Parameter / null check][Concurrency safety][Pre-existing]`

### tagId ↔ Problem tags consistency check

> **The Agent must keep tagId consistent with the tag name in content** — the CLI only warns; it no longer auto-corrects or hard-blocks.

How it works: before write-back, `validate_update_process` runs tag-name consistency validation:

1. Look up the standard name from the tag lookup table (`tagId→tagName` map returned by `get-tag-list`) using `tagId`
2. If content `Problem tags: [xxx]` does not match the standard name, **only print a warning** (stderr) and do not block write-back
3. It will not auto-replace or auto-insert a "Problem tags" field — the Agent must write them correctly

**The Agent must ensure**: `tagId` is chosen correctly (the best match from `$VALID_TAG_IDS`), and content `Problem tags: […]` uses that tagId's standard name, so the two stay consistent.

### tagId supports child tags (multi-level tag structure)

> Tag data from `get-tag-list` is a **tree** (top-level tags have a `children` array). The validation cache **recursively collects IDs at every level**, so child-tag IDs are also valid tagIds.

**Selection strategy**: prefer the most precise child tag (a finer defect class); fall back to the parent only if no child matches.

Example: tag "Implementation logic and data validity" (id=6) has child "Self-assignment / invalid assignment" (id=61). If the defect is a self-assignment, choose `tagId=61`; if it belongs to no child class, choose parent `tagId=6`.

---

## bugStatus=6 vs bugStatus=7 judgment

| Dimension | bugStatus=6 | bugStatus=7 |
|---|---|---|
| Functional impact | Will cause functional exception / error / data error | Function works, but quality can be improved |
| Title prefix | `Defect:` | `Improvement:` |
| Verifiable fields | Trigger conditions + Expected vs actual (required) | Current impact + Rationale (required) |
| Fix fields | `Fix suggestion` + code block | `Improvement plan` + code block |

> Judgment principle: ask yourself "if we do not fix this, will production break?" — yes → 6; no, but it is not good enough → 7

---

## content views by strategy

| strategyCode | View that content must show |
|---|---|
| 2 | SQL syntax / index / injection / slow query |
| 3 | Inside the method: input validation, boundary values, exception handling, NPE |
| 4 | **Call chain**: full path with line numbers + problem node + propagation path |
| 6 | **Business scenario**: which scenario in the test case / requirement doc it does not match |
| 7 | Exception handling: catch types, swallowed exceptions, unchecked exceptions escaping |
| 8 | AST/Semgrep rule hit + match location + risk point |
| 9 | Custom-rule hit scenario |
| 10 | **Client tech stack**: stack type + runtime characteristics + upstream/downstream contract consistency (if Layer 4) |

> **Test-case conclusion visibility rule** (all strategyCodes, when caseRelevance≠none):
> If the defect was found by comparing a test case, content must include a `Test case ID: [ID](url)` citation.
> When the task has no test cases (`HAS_CASES=false`), omit that line — do not invent a case ID.
> and the "Expected vs actual" field should describe the deviation against the case expected result.
> Whenever analysis used a test case to reach a conclusion, content must show that source.

---

## processSteps structure

```json
{
  "step": "first_round_detection",
  "stepKey": "first_round_detection",
  "question": "full prompt sent to the LLM (required)",
  "conclusion": "full raw LLM output (required)",
  "hasBug": true,
  "stepStatus": "executed",
  "referencedSources": [{"sourceType": "test_case", "sourceId": "...", "sourceName": "..."}],
  "refCaseIds": [3469805],
  "refDocUrls": ["https://docs.example.com/page/xxx"]
}
```

**stepStatus enum:** `executed` / `skipped` / `failed`

**Predefined step values:** `first_round_detection`, `validate_target_method`, `llm_validation`, `keyword_question`, `tagging`, `exclusion_rule_filter`, `dev_stage_question`, `model_prediction_rethink`, `defect_correctness_verify`

---

## fileCodes coverage

fileCodes cannot contain only the target method. You must write back the full context needed to understand the conclusion: the target method's own code (required), upstream callers, downstream callees, and related config files.

Judgment: could someone who does not know the project understand and verify this defect from fileCodes + content alone?

### fileCodes construction for callee-defect scenarios

When the defect is actually in a called method (see `references/phase2-detection.md` STEP C.7), the independently written callee process must include source from both the callee and the caller:

- **Callee source first (primary)**: reviewers need the callee implementation to verify the defect
- **Caller source after (context)**: reviewers need the trigger path — from which changed method's call chain they entered the callee

If you only describe the callee problem in the caller process and fileCodes has no callee code, reviewers cannot open the source and verify the conclusion themselves.

---

## 🔑 fileCodes authoritative mapping (root fix for "gitUrl and filePath mapped wrong")

Write-backs used to fail often by guessing `filePath` as `FILE_PREFIX + className + suffix` and filling git info from a hard-coded `GIT_URL/BRANCH/COMMIT_ID` in a script — once multiple repos / services mix, the mapping is wrong.

**Correct approach: filePath comes from the plan item; git info comes from meta.services; both are provided uniformly by task-persisted data.** Two ways to get them:

### Method A: look up the authoritative mapping yourself (resolve-writeback-context)

```bash
node scripts/detect.ts resolve-writeback-context \
  --task-id <TASK_ID> \
  --class-name <ClassName> \
  --method-name <methodName> \
  --strategy-code <int>
```

Output is authoritative JSON. Key fields:
- `filePath`: from the plan item (`build-detection-plan` / `clone-and-diff --with-plan` fill it from the diff); no more concatenation
- `gitUrl` / `branch` / `commitId` / `localDir`: from `meta.services`, reverse-looked-up by batchId
- `fileCodesItem`: a single item you can put into fileCodes directly (fields already assembled)
- `resolved`: only `true` is trustworthy; `false` means no plan/meta hit and you must check by hand — **do not hard-fill**

In a write-back script, read `ctx["fileCodesItem"]`. Do not assemble `filePath` yourself and do not use a global `GIT_URL`.

### Method B: auto-correct on write-back (recommended, --task-id)

Pass `--task-id` to `update-process` / `batch-update-process`. Before write-back the script runs resolve on each fileCodes item: when filePath/git/branch/commitId disagree with the authoritative values it **auto-corrects** (stderr prints a `🔧` hint); when empty it **auto-fills**; and it records a local write-back.

```bash
# update-process takes one field per flag (--class-name, --method-name, --bug-status, --thinking, --content, ...)
node scripts/detect.ts update-process --task-id <TASK_ID> --class-name ... --method-name ... --bug-status 6 ...
# batch-update-process takes a JSON array — inline or a file path
node scripts/detect.ts batch-update-process --task-id <TASK_ID> --items-json batch.json
```

> Without `--task-id` behavior is unchanged (write the passed fileCodes as-is), but you lose auto-correct protection. **Whenever you write back in a task context, pass `--task-id`.**

---

## Model-prediction feedback

When writing back a defect, the platform may auto-run a negative model:

- `modelPredictionResult=2` (high-confidence false-positive judgment) → re-examine the conclusion; you may change it or keep it (append step=`model_prediction_rethink`)
- `modelPredictionResult=0/null` → no action needed

---

## Development-stage exemption (R8)

TODO / Mock / self-test code → bugStatus=2 + thinking explains why + processSteps adds `dev_stage_question` + the final summary shows a "development-stage code reminder".

---

## 🎯 Full write-back Python code examples

> **Example code has moved to `references/writeback/writeback-examples.md`** (~600 lines), including:
> - Example 1: batch bugStatus=2 write-back (general)
> - Examples 2a/2b/2c: defective write-back (strategy=11 / strategy=8)
> - Example 3: cross-repo-dependency degrade write-back (Java + frontend)
> - Example 4: finalize-rank write-back
> - Example 5: batch write-back with content_store persistence
> - Common write-back failure troubleshooting
> - fileCodes authoritative mapping (resolve-writeback-context / --task-id auto-correct)
>
> Read that file for a complete reference on your first write-back.
