# Phase 2: Detection execution + Phase 3: Validation and close

> **Prerequisite**: Phase 1 is complete (start card already output). You must load `SKILL-WRITEBACK.md` first.
> **Detailed scripts**: `references/analysis/phase2-scripts.md`. **Analysis framework**: `references/analysis/analysis-framework.md`.

---

## Step 2.0-pre: Prerequisite readiness check [GATE — cannot skip]

**The first action on entering Phase 2 must be this check**, confirming all Phase 1 prep is done:

```bash
node "$SKILL_SCRIPT" check-phase2-readiness --task-id $TASK_ID
```

**What is checked**:
- Every service has finished git clone and `register-repo-clone` is registered (code-clone gate)
- Diff data has been obtained
- tagIds have been loaded
- **[New] Document parse quality**: when there is a document source, `extractedRules` must be non-empty (blocking)
- **[New] Test-case bodies**: when there are testCaseIds, testCases must be non-empty (blocking)
- **[New] Already-filed defects**: fetching deliveryDefects is recommended (warning, not blocking)

**>>> GATE**: continue only when `ready=true`. When `ready=false`, fix each item in `issues` and re-check. Distinguish ❌ (blocking) from ⚠️ (warning, not blocking).

> ⚠️ **Design principle: detect and write back as you go; do not "analyze first, clone later"**
>
> If this check finds clone is not registered, Phase 1 Step 1.3b was skipped.
> The Agent must **go back to Phase 1 to clone + register**, not patch it temporarily in Phase 2.
> Reason: entering the "analysis" stage without cloned code means every conclusion is fabricated;
> cloning later and then writing back is forging the detection process and violates core constraint 2 (real detection).

---

## Engineering hygiene (Phase 2 execution rules)

> **The task directory may only contain standard artifacts. Do not leave Agent-written one-off scripts or intermediate files.**

Standard-artifact whitelist (only these may stay long-term in `data/{taskId}/`):
`meta.json`, `static.json`, `context.json`, `test_cases.json`, `plan.json`, `writebacks.json`, `findings.json`, `local_state.json`(+`.lock`), `DOC_SUMMARY.md`.

Four rules:

1. **Always go through the CLI**: all data reads/writes go through `open_detect.ts` subcommands. Do not drop one-off scripts into the task directory to "assemble data / batch write-back / probe APIs". If you truly need one-off logic, check `--help` first for an existing subcommand; do not write a file.
2. **No leftovers**: no intermediate files (temp json, `pending*.json`, `batch_*.json`, `*.log`/`*.err`, `*.bak`, generated scripts) may remain under `data/`; `data/_tmp/` is for instantaneous use only and must be cleared immediately.
3. **Do not leave `.bak` when changing code**: when editing skill code itself, do not leave `*.bak.<timestamp>` backups in the code directory; rely on version control, not hand copies.
4. **Clean at close**: after each detection task converges (or routinely), run cleanup so the workspace stays tidy.

```bash
# Preview what will be cleaned (strongly recommended to dry-run first)
node "$SKILL_SCRIPT" cleanup-stale-data --dry-run
# Actual cleanup: delete >48h stale task directories + scrub temp artifacts/.bak/_tmp in all directories
node "$SKILL_SCRIPT" cleanup-stale-data
# Scrub temp artifacts only; keep all task data (do not delete stale directories)
node "$SKILL_SCRIPT" cleanup-stale-data --scrub-only
```

Cleanup is absolutely safe for whitelist standard artifacts (only their `.bak` backups are removed). Active task directories themselves are always kept.

---

## Pre-write-back validation (required on every write-back)

```
Build the request body → submit directly (update_process / batch_update_process already auto-pre-fix format + validate internally); validation_failed means a quality problem — re-analyze, do not retry by tweaking format
```

Auto-fix: missing prefix, bolded line numbers, empty filePath, bolded field names.
Hard intercept (not auto-fixed): thinking <30 characters, empty processSteps conclusion.

**Confidence and open-question output (user-facing requirements)**:

- The thinking field must include a `[Confidence:HIGH/MED/LOW]` marker (when bugStatus=6/7)
- When `[Confidence:MED/LOW]`, thinking must include a `[Needs confirmation]` section (open question + current assumption + what the user must confirm)
- The content field must also include confidence and open-question info (see `analysis-framework.md` → "Pending user confirmation" chapter)
- When something is in doubt, do not assume arbitrarily, and do not hide it from the user — you must explicitly tell the user there is an open question (see `SKILL-WRITEBACK.md` → "Confidence and open-question output validation")

---

## Step 2.0: Cross-repo dependency handling [must run before Phase 2 starts]

Compare get-pending className values against local clone directories. If the file does not exist → cross-repo dependency class. Try these four strategies in order:

- **A** Found in another service clone directory from this iteration → analyze together with that source
- **B** Source repo URL can be inferred → clone and analyze
- **C** User provides a URL → clone and analyze
- **D** Source unreachable → **do not skip with bugStatus=2**. Still analyze from this service's caller-side code (parameter validation / return handling / exception catch). Degrade, do not skip.

**Two inviolable hard constraints**: after A/B/C clone you must `register-repo-clone`; D must explain in thinking "cross-repo source unreachable; analyzing from caller-side code".

> **Default: use GitNexus for cross-repo locate**:
> Call MCP `impact({target, direction:"downstream"})` / `context({name, kind, content:true})` to query downstream call targets and service identities.
> After you have target-service info you can infer the matching Git repo URL and raise strategy B success rate; remote interface method signatures also make strategy D caller-side analysis more precise.
> GitNexus must have been probed/installed via `ensure-gitnexus`. Only if install failed and the Agent cannot fix it, or analyze failed, degrade to grep / naming-pattern inference (see SKILL-PHASE1.md Step 1.2b / 1.6c).

> Identification methods, analysis content, fileCodes.git write-back rules, and other **full templates** for the four strategies: `references/analysis/phase2-scripts.md#step-2.0` (single source of truth).

---

## Step 2.1: AST scan (strategy=8) [run first; Java services only]

> **Prerequisite**: run AST scan only when `content.json` has `service[].language = "java"`. Frontend projects (javascript/typescript) **skip this step** and go straight to Step 2.2.

```bash
# Recommended for PR / git-diff tasks (default when --task-id is set): scan changed files only
node "$SKILL_SCRIPT" run-ast-scan \
  --code-dir <local repo> \
  --rules-json '<$RULES full rules JSON>' \
  --task-id $TASK_ID
# Equivalent explicit form:
#   --changed-only   or   --diff-files '<$DIFF_FILES>'
# Whole-repo (opt-in only): add --full-repo. Out-of-diff hits are tagged inDiff=false.
```

**Scan scope (PR/diff tasks default to changed files in both modes)**:

| Execution mode | AST scan scope | Notes |
|---|---|---|
| **PR / git-diff (recommended)** | **Only Java files in `diff.files`** | Pass `--task-id` (loads persisted diff) or `--diff-files` / `--changed-only`. This is the default when `--task-id` is present. |
| **`--full-repo` (opt-in)** | All `.java` files in the repo | Each finding is tagged `inDiff`. Hits with `inDiff=false` are T0 / auto-dismiss — **do not read or verify them one by one**. |
| **light** (changed lines < 200) | Same as PR/diff (changed files) | Incremental classes only |

`astRuleCount` only counts rules actually loaded by this scan. Do **not** silently drop in-diff hits (`inDiff=true` / `inDiff=null` and `autoGenerated=false`).

> 🔴 **In-diff verification (no sampling)**: every **in-diff, non-generated** finding must get an LLM authenticity check.
> - **No sampling of in-diff hits**: do not "only verify the first N / spot-check a few / treat similar in-diff hits as a group".
> - **Out-of-diff hits are not a verification queue**: when `inDiff=false`, treat as stock code outside this PR. Auto-dismiss as bugStatus=2 (T0). **Forbidden**: 抽查 then 批量提取全部 N 个存量命中逐一验证.
> - **Do not batch-clean unverified *in-diff* findings**: `batch-dismiss-by-strategy` may clean leftover bugStatus=0 items after in-diff hits were verified. Pass `--verified-count` = `verifyRequiredFindings` and `--dismissible-count` = `dismissibleFindings` from `run-ast-scan`.
> - **⚡ Auto-generated + out-of-diff exemption**: `autoGenerated=true` **or** `inDiff=false` may skip LLM verification and be treated as no defect. Only `autoGenerated=false` **and** `inDiff!==false` findings go through the full LLM verification flow.

### findings decision tree

```
Empty → call batch-dismiss-by-strategy(parentBatchId, strategyCode=8) to set all strategy=8 to bugStatus=2 at once
Non-empty → classify, then verify only the in-diff subset:
  autoGenerated=true → mark as no defect (generated exemption; pending batch)
  inDiff=false → mark as no defect (T0 / stock code outside this PR; pending batch; no file read)
  autoGenerated=false AND inDiff!==false →
    hasExclusionRules=true → read the exclusion description
      ├── Matches exclusion → mark as no defect (pending batch)
      └── Does not match → LLM verification
    hasExclusionRules=false → LLM verification
      ├── False positive → mark as no defect (pending batch)
      └── Real defect → bugStatus=6/7 (content labeled [This change] or [Pre-existing])
```

### AST write-back flow (two steps)

1. **Write defects first**: write every record judged as a real defect (bugStatus=6/7) one by one via `update-process` (fill thinking/content/processSteps and other details)
2. **Then batch-clean the rest**: call `batch-dismiss-by-strategy(parentBatchId, strategyCode=8)` to set all remaining bugStatus=0 strategy=8 records to bugStatus=2 (no defect) at once

> ⚠️ Order must not be reversed: write defects first, or batch-clean will also set unprocessed defects to no defect.
> ⚠️ `batch-dismiss-by-strategy` is only for the AST strategy (strategyCode=8). Other strategies still write back one by one via `update-process`.

> 🔴 **AST defect write-back rule**: an **in-diff** finding verified by LLM as a real defect must be written back as bugStatus=6/7. Do not drop in-diff hits.
>
> **Out-of-diff / generated**: auto-dismiss as bugStatus=2 (T0). Do not spend the run reading stock files that are not in `diff.files`. Opt in to `--full-repo` only when the user asks for a whole-repo AST sweep; even then, `inDiff=false` hits stay auto-dismissable.
>
> If you still verify an out-of-diff hit and it is a real defect, write it back as bugStatus=6/7 with a [Pre-existing] tag — but that is optional extra work, not the default PR path.

> Rule grouping and frontend detection details: `references/analysis/phase2-scripts.md#step-2.1` and `references/rules/frontend-gotchas.md`

---

## Step 2.2: Method-level business detection (strategy=11)

> The Agent chooses analysis depth from method difficulty (detectTier): simple methods get code-logic analysis; complex methods add call-chain analysis + business-knowledge compare. Historical leftover processes are analyzed under strategy=11 rules.

### Fast write-back for trivial methods (Phase 1 Step 1.8a pre-filter results)

If Phase 1 `prep-and-plan --submit-trivial` or `trivial-method-filter --submit` already succeeded, **do not compose thinking blobs**. Those getters/setters are already bugStatus=2. Continue only with `deepAnalysis[]`.

If the filter ran without `--submit`:

```bash
node "$SKILL_SCRIPT" trivial-method-filter --task-id $TASK_ID --submit
```

- Do **not** hand-build a 60-item `batch-update-process` for GETTER/SETTER
- After CLI write-back, immediately enter full analysis for non-trivial methods
- If `trivial-method-filter` was not run or failed, every method follows the original full STEP A→D flow

### Grouping: call-chain groups first, className fallback

> Full call-chain group spec: `references/analysis/detection-plan-spec.md#chainGroupId call-chain clustering rules`. Shared-read mechanism: `references/analysis/analysis-framework.md` → STEP B "call-chain group shared read".

- `chainGroupId` non-empty → put into a call-chain group; STEP A/B are shared-read once inside the group; STEP C/C.5/D run in parallel; then batch write-back (order-preserving).
- `chainGroupId=null` → group by className as usual. Degrade **must never** skip any pending process.
- Call-chain groups and className groups **must** run in parallel when they do not share a file. Do not wait to finish `SecurityCodeBiz` before starting `IntelligenceAdaptor` (or any other independent class). Issue independent groups in the same tool-call batch.

> ⚠️ What is shared is "analysis understanding", not "write-back credentials" — each className still needs its own `register-code-read` (code-read gate); each strategy=11 method still needs its own `register-context-read` ≥2 (context-read gate).

> ⚠️ **Full coverage + layered-depth detection**: every pending process must be written back (cannot skip). Analysis depth is differentiated by `detectTier` (T1/T2/T3). Tier rules: `references/analysis/detection-plan-spec.md#detectTier layering rules`. Forbidden: skip a process, T3 template batch-fill (batch write-back gate), lower the Tier yourself. When >50 items, execute T1→T2→T3 priority and write back in batches.

> **Write back as soon as found (R2)**: real issues are always written back as bugStatus=6/7. Distinguish [This change] / [Pre-existing] via "Problem tags"; this does not affect the write-back decision. See `SKILL-WRITEBACK.md` R2.

### Mandatory flow per process

```
STEP A: read code → STEP B: read context → STEP C: analyze and judge → STEP C.5: self-review → STEP D: write-back
```

> Full step definitions: `references/analysis/analysis-framework.md`

### STEP A→B→C→C.5→D execution points

> Full dimensions, self-review checklists, and strategy extras: `references/analysis/analysis-framework.md`. Below are only key decision points.

**STEP A**: read code → `register-code-read` (**MUST; register immediately after finishing that className; do not batch-register just before write-back**). File/method does not exist → skip with bugStatus=2.

**STEP B** (Tier difference: T1 full ≥2 hops / T2 only 1 hop / **T3 skip — do not spend a turn on GitNexus or extra file reads**): every context file you *do* read must `register-context-read`. Quality gate: T1 ≥2, T2 ≥1, T3 and `trivial=true` are exempt. Do not run STEP B on T3 just to satisfy an old ≥2 rule.

#### STEP B context read: analyze the call chain via GitNexus [Java services]

**Default method**: query the already-built GitNexus graph, get callers/callees paths and remote boundaries → read the matching source → `register-context-read` for each file (context-read gate).

Query order:

1. If the host tool list **actually has** GitNexus MCP, call `impact` / `context`
2. Otherwise (Cursor did not run `gitnexus setup`, mcp.json is empty, etc.) you must use the CLI; **do not grep while `meta.gitnexus.ready=true`**:

```bash
node "$SKILL_SCRIPT" gitnexus-impact --task-id $TASK_ID --target Class#method --direction upstream
node "$SKILL_SCRIPT" gitnexus-impact --task-id $TASK_ID --target Class#method --direction downstream
node "$SKILL_SCRIPT" gitnexus-context --task-id $TASK_ID --name Class#method --content
```

**Degrade**: only when `ensure-gitnexus` was already attempted and `ready=false` (install/analyze failed) may you degrade to grepping method names. Missing MCP ≠ graph unavailable.

- GitNexus returns a structured call chain (depth layers d=1/d=2/d=3 + confidence). After reading it, the Agent decides "which files to read". There is no directly walkable `$CALL_CHAINS` structured field
- The graph must be built after clone (`gitnexus analyze`, typically 5-15s); call-chain analysis for each Java method defaults to GitNexus
- **The context-read gate always applies**: whether you use GitNexus or degrade to grep, every context file you read must `register-context-read`. Call-chain analysis only helps the Agent decide "which files to read"; the register action cannot be omitted

**STEP C**: business detection analysis (strategy=11). The Agent chooses depth from detectTier and method complexity: T3 methods focus on code logic; T2 methods add call-chain analysis; T1 methods add business-knowledge compare. Hard requirements: thinking cites ≥1 line number/variable name; if there are rules → L0 compare; if there are docs → cite business rules; if there are test cases → cite case steps; if there are already-filed defects → L2.1 check the three new-issue types (see `analysis-framework.md#L2.1`); must not go below `minDetectLevel` (minimum detection-depth gate).

**STEP C+**: findings with bugStatus=6/7 **must** `register-finding` (risk/insight); bugStatus=2 only records valuable findings.

**STEP C.5**: for bugStatus=2 confirm D1+D2 **+ D10 (spec-vs-implementation scan: compare case/doc constraints vs code constraints per parameter; if inconsistent, upgrade to bugStatus=6)** → `[C5✓]`; for bugStatus=6/7 do full D1-D8 + 8 taboos (Tier difference: T1 all 8 / T2 fast 3 / T3 skip; if issues are found, raise to T2 and fill in).

**STEP C.7** (callee-defect write-back): when analysis finds the defect is actually in a called method (not the changed method), **write a separate process for the callee**. Do not hang the callee's problem under the caller's process.

> 🔴 **Why write it independently**: if hung under the caller process, fileCodes do not include callee code and reviewers cannot verify the conclusion. After an independent write-back the callee has its own process + rank + source, and reviewers can check it themselves.

#### Core mechanism

`batch-update-process` itself supports insert — without a processId the platform auto-creates a new process for that className+methodName. So the operation matches a normal write-back; the only difference is:

- **Methods changed this time** (present in `get-pending`): write-back with processId (update)
- **Methods not changed this time** (callees): omit processId; fill className / methodName with the callee and write back; the platform auto-inserts

Other fields (thinking / content / processSteps / fileCodes / tagId, etc.) follow the same rules as a normal defective write-back.

#### Notes

- **fileCodes covers both sides**: callee source first (primary, for reviewers to verify), caller source after (context, to understand the trigger path). See `SKILL-WRITEBACK.md` "fileCodes construction for callee-defect scenarios"
- **finalize-rank uses callee info**: `--class-name` / `--method-name` fill the callee
- **Caller process is written independently**: if the caller itself has no defect, bugStatus=2; if it has its own issue, write that issue and do not repeat the callee defect
- **Cross-repo scenarios**: follow Step 2.0 four strategies; when strategy D degrades, analyze the caller side in the caller process and do not create a separate extra process

**STEP D**: pick a template → fill values → line-to-method ownership check (see `SKILL-WRITEBACK.md`) → batch submit. **If STEP C.7 triggered a callee insert**, that process is also submitted in this step (className/methodName/fileCodes rules: STEP C.7).

**strategy=11 extras**: content includes a call-chain path `A#method(L12)→B#method(L45)→C#method(L88)`; fileCodes includes every involved class. The Agent chooses analysis depth from method difficulty:
- **Simple methods** (detectTier=T3 or GETTER/SETTER/DELEGATE): focus on code-logic analysis; the chain description may be simplified
- **Medium methods** (detectTier=T2): code logic + 1-hop call-chain analysis
- **Complex methods** (detectTier=T1 or associated with a test case): full call-chain analysis + business-knowledge compare; content must include both the call-chain path and business-case citations

When there are test cases (HAS_CASES=true), business-knowledge compare must be completed regardless of difficulty (cite concrete case steps).

> **GitNexus call-chain analysis** (strategy=11 default):
> - The call-chain path in content is concatenated by the Agent after getting an exact path from MCP (`context()` / `impact({direction:"upstream"})` + `impact({direction:"downstream"})`)
> - Identified remote calls must be marked as risk points in thinking (cross-service call = potential failure boundary)
> - `context()` helps understand the entry trigger path; `impact()` depth layers (d=1/d=2/d=3) help judge impact scope
> - When conclusion confidence is not high, the Agent still must read source to verify the call relation
> - **content format does not change**: always `A#method(L12)→B#method(L45)→C#method(L88)`
> - Only when `ensure-gitnexus` already attempted install and is still `ready=false` may you degrade to concatenating by hand with grep

**Frontend project extras**: frontend/client projects automatically load the frontend-specific rule set (see `references/rules/frontend-gotchas.md`) and merge it with strategy=11 general rules. Frontend projects should also run `run-frontend-rules` to get the strategyCode=10 frontend-specific defect-pattern list (FE-001 ~ FE-012) and compare them one by one during STEP C analysis.

---

## 🚀 Batch write-back (batch write-back gate — inviolable)

**Mandatory aggregation strategy**:

| Stage | Aggregation grain | Count limit |
|---|---|---|
| After AST scan completes | All strategy=8 in one batch | **No upper limit** (hundreds still in one submit) |
| After one className is analyzed | That className's strategy=11 in one batch | Suggested ≤50 per batch |
| After everything completes | Aggregate the remainder by parentBatchId | Suggested ≤50 per batch |

Stage first, then unify with `batch-update-process` at stage end. Do not write one-by-one serially.

`batch-update-process` is the supported batch write-back. Hollow-check template detection compares method-specific thinking only: it strips class/method names and the mandated `Call chain:` / `调用链：` suffix. Independent analyses on the same chain can be submitted together. True copy-paste templates are still blocked. High no-defect ratio alone is a warning, not a block.

A later no-defect batch **must not include** methods already written as bugStatus=6/7. The CLI refuses that overwrite (local record stays a defect; those items are dropped from the submit). Do not put confirmed defects into a 32-item bugStatus=2 batch.

**AST batch write-back special rules**:
- AST scan (strategy=8) batch write-back is **fully exempt from empty-check intercept** and has no count limit
- Reason: a full-repo AST scan may produce hundreds of processes, most of them bugStatus=2 (no rule hit / out-of-diff T0); that is normal
- thinking content is naturally similar (all "AST scan did not hit a rule" style) and must not be intercepted by template detection

### Immediate write-back consistency check (reduce post-close reconcile loops)

The `batch-update-process` command already has a built-in `--verify` option (on by default). After each batch write-back it automatically runs a **lightweight immediate reconcile**:

```bash
# Default behavior (verify=true): after write-back, immediately check this batch landed consistently
node "$SKILL_SCRIPT" batch-update-process --task-id $TASK_ID --batch-id $BATCH_ID \
  --processes '[...]'
# Return value additionally includes an _verify field
```

**Immediate check content** (does not pull the full report; only this batch):
1. Whether bugStatus=6/7 processes in this batch were successfully written to the platform (API returned success)
2. Whether the written bugStatus matches the locally submitted value (prevent silent platform rewrite)
3. Whether ranks for defective processes are already registered (`finalize-rank` pre-reminder)

**`_verify` field in the return value**:

```json
{
  "_verify": {
    "status": "CONSISTENT",    // CONSISTENT | DRIFT
    "driftItems": [],           // inconsistent items (non-empty when DRIFT)
    "pendingRanks": ["com/xx/Service#method"]  // methods that still need finalize-rank
  }
}
```

**Handling rules**:
- `CONSISTENT` → continue the next analysis batch
- `DRIFT` → **fix on the spot** (`driftItems` gives concrete processId + expected vs actual), then resubmit that item
- `pendingRanks` non-empty → for defective methods in this batch, **immediately** `finalize-rank` after write-back → **then immediately `record-rank` to local disk** (see Step 2.4 dual-write gate); do not accumulate until Phase 3

> **Why immediate check reduces reconcile loops**:
> Drift usually comes from: ① write-back params were silently corrected by the platform ② bugStatus was written correctly but rank was forgotten ③ API returned success but nothing was stored.
> Immediate check catches these three after each batch and fixes them on the spot, so Phase 3 `reconcile-report` usually passes on the first try.
> Measured effect: the close stage used to need 2-3 reconcile loops on average (30s-1min each); after immediate check, 90%+ of tasks pass on the first round.

> Failure degrade strategy: `references/analysis/phase2-scripts.md#batch-write-back-best-practices`

---

## Step 2.3: Business-knowledge compare (extra duty of strategy=11 when HAS_CASES/HAS_DOC)

> ⚠️ **strategy=11 business compare**: when HAS_CASES=true or there are docs, the Agent **must additionally complete business-knowledge compare** during strategy=11 analysis — this is one of strategy=11's deep-analysis dimensions. The Agent decides from detectTier whether full chain+business compare is needed (T1/T2) or only code-logic analysis (T3), but when a test case is associated, business compare cannot be skipped.

### Mandatory requirements (cannot skip when HAS_CASES=true)

1. **Read test-case bodies one by one**: for cases in `$CASES[]` related to the current method, read steps, inputs, and expected results
2. **Build a "business scenario → method" map**: map case scenarios onto concrete code paths
3. **Use the case as input to verify code behavior**: after case step N's input goes through the code, does the result match the case expectation
4. **content must cite a concrete Test case ID**: format `Test case [ID]: step N expected 'XX', code behavior 'YY'`
5. **content must include a call-chain path**: format `A#method(L12)→B#method(L45)→C#method(L88)` (strategy=11 includes call-chain analysis duty)
6. **processSteps must include referencedSources** (sourceType: test_case, sourceId: case ID, sourceName: case title)

**referencedSources inline example (embed directly in processSteps):**

```json
{
  "stepName": "business case compare",
  "stepStatus": "executed",
  "question": "...",
  "conclusion": "...",
  "referencedSources": [
    {"sourceType": "test_case", "sourceId": "TC-12345", "sourceName": "Discount-code blacklist merchant filter scenario"},
    {"sourceType": "tech_doc", "sourceId": "DOC-1001", "sourceName": "Requirement doc - blacklist management"}
  ]
}
```

> **Validation rule 7 reminder**: even when bugStatus=2 (no defect), if strategy=11 and there is a test-case/doc association, at least one processStep must include `referencedSources`.
> Allowed `sourceType` values only: `prd_doc` / `tech_doc` / `test_case`. Missing values are rejected by the platform.

### No empty spinning

The Agent **must not** write only "compared test cases, found no issue" as the entire thinking. thinking must show:
- Which case and which step were actually read
- Which branch/line of code that step maps to
- Why it was judged consistent or inconsistent

### 🔴 No rationalizing divergence (Anti-Rationalization Rule)

> **Core principle: cases/docs are the "spec"; code is the "implementation". When they disagree, the default is that the implementation is wrong — not that you invent reasons for the implementation.**

When comparing test cases with code behavior, the Agent is **forbidden** from these rationalization patterns:

1. **Invent implied conditions for the code**: the case/doc states condition A but does not limit a sub-condition, yet the code hard-codes extra sub-condition B. The Agent must not assume "B is surely satisfied" to rationalize the extra constraint. Correct action: mark it as **the code added a constraint beyond the case expectation; suspected defect or recommended check**.
2. **Use "pre-existing" to ignore inconsistency**: when code behavior does not match the case expectation, do not skip because "historical code was already like this". Pre-existing is still a defect; write it back with a [Pre-existing] tag.
3. **Use code comments as a substitute for the case**: parameter notes in comments are not business requirements. When comments contradict the test case / requirement doc, the case/doc wins.
4. **"Internally consistent" is not "meets the requirement"**: code that does not NPE or go out of bounds is not the same as meeting the business requirement. strategy=11 business-compare duty is to verify **business-behavior correctness**, not whether the code will crash.

**Judgment rules**:

| Test case / doc description | Code implementation | Correct judgment |
|---|---|---|
| Condition A | Condition A + extra condition B | ⚠️ Code has **more constraints** than the requirement; bugStatus=6 or recommended check |
| Condition A + condition B | Condition A (missing B) | ⚠️ Code has **fewer constraints** than the requirement; bugStatus=6 |
| Behavior X | Behavior Y | ⚠️ Behavior inconsistent; bugStatus=6 |
| A parameter is not limited | That parameter is hard-coded to a specific value | ⚠️ Code is **over-constrained**; bugStatus=6 or recommended check |

> **Better to report one extra "recommended check" than miss one real defect.** The Agent's duty is to find differences and report them faithfully; business reasonableness is confirmed by developers.

### Degrade rules

- No test cases → if there are docs, compare against docs (DOC_SUMMARY.md business rules); call-chain analysis depth is chosen by the Agent from method difficulty
- No docs and no test cases → pure code logic + call-chain analysis (business-compare part degrades; call-chain depth follows detectTier)
- Test-case fetch failed → record with `register-finding --category gap` then degrade to doc mode; call-chain analysis depth stays the same

---

## Step 2.4: finalize-rank [required for every defective method]

> 🔴 **Dual-write gate (finalize-rank must be immediately followed by record-rank; both are required)**:
> `finalize-rank` only **submits rank to the platform** (visible on the report side) and returns `aggregatedRankId`; while `check-rank-integrity` / `reconcile-report` / `complete-task` close gates read **local content.json `writebacks.ranks`**.
> Finalize without record causes: the platform report has defects, but local rankDefectCount=0 → complete-task is blocked, reconcile reports drift.
> **Correct order: ① `finalize-rank` (get rankId) → ② immediately `record-rank` (write rankId back to local content.json).** Do not stop after step ① only.

```bash
# 🟢 Recommended: pass --task-id so a successful finalize automatically record-rank to disk (dual-write gate automated)
node "$SKILL_SCRIPT" finalize-rank \
  --task-id $TASK_ID --batch-id $BATCH_ID --class-name "<slash format>" --method-name "<name>" \
  --bug-status <6 or 7> --process-ids "<comma-separated>" --content "<plain text>"
# Output _auto_record_rank.recorded=true means disk write succeeded; no manual record-rank needed

# ⚠️ Old way (without --task-id you must do two manual steps):
# ① Submit to the platform and get aggregatedRankId
node "$SKILL_SCRIPT" finalize-rank \
  --batch-id $BATCH_ID --class-name "<slash format>" --method-name "<name>" \
  --bug-status <6 or 7> --process-ids "<comma-separated>" --content "<plain text>"
# ② Immediately write rankId to local content.json (reconcile / close gates read this)
node "$SKILL_SCRIPT" record-rank \
  --task-id $TASK_ID --rank-json '{"className":"<>","methodName":"<>","bugStatus":<6 or 7>,"rankId":"<aggregatedRankId from the previous step>"}'
```

content format (**fields must be separated by `\n\n` blank lines; do not write one continuous paragraph**):

```
Defect:<one-line title>\n\nLines:<start>-<end>\n\n[Introduction period: this change / pre-existing]\n\n<detailed description>\n\nAffected business:<...>\n\nReproduction path:<...>\n\nFix suggestion:<...>\n\n```java\n<code>\n```
```

> Detailed templates: `references/writeback/writeback-templates.md` templates B/C.

### 🔴 Line-to-method ownership check [GATE — mandatory before finalize-rank; cannot skip]

> **Frequent issue**: after rank write-back, the method name and line numbers in the report do not match, so users cannot locate the problem. Root cause: the Agent submitted without checking line ownership.

**Before finalize-rank you must complete the following checks (not a "suggestion"; this is a prerequisite gate)**:

1. Extract start line X from `Lines:X-Y` in the `--content` about to be submitted
2. In the locally cloned source file, locate line X and confirm that line **actually falls inside** the method body of `--method-name`
3. Check method (pick one):
   - `grep -n "public\|private\|protected\|func \|fun \|def " <file> | awk -F: -v line=X '$1 <= line' | tail -1` → confirm the output contains `methodName`
   - Or read near line X in the source file, walk up to the nearest method declaration, and confirm the method name matches
4. **If it does not match you must fix it**:
   - If the line belongs to another method → correct `--method-name` (and `--class-name` if it crosses classes) to the method that actually owns the line
   - If the line number is wrong → correct it to the right line inside the current method
   - **Do not submit without checking**

> The same applies to `update-process` content line numbers: `--method-name` must match the method that owns the line numbers in content.

---

## Step 2.5: Milestone cards + progress report [25%/50%/75%]

### User-side output

```
🔄 **Detection progress** — {done}/{total} ({percent}%)
- Analyzed {N} methods, found {M} suspected issues
```

### Platform progress report (report-progress)

After finishing analysis of each className, call `report-progress` with a progress snapshot:

```bash
node "$SKILL_SCRIPT" report-progress \
  --task-id $TASK_ID \
  --phase PHASE2_DETECT \
  --percent <current percent> \
  --step "Analyzing <current className>.<methodName>"
```

**Suggested report frequency**:

| Scenario | Frequency |
|---|---|
| After each className completes | Must report |
| Milestone nodes (25%/50%/75%) | Must report |
| When a defect is found | Suggested (`--activity "Found defect: xxx"`) |
| When the phase switches | Must report (switch the phase parameter) |

**phase values**: `PHASE1_PREP` / `PHASE2_DETECT` / `PHASE3_VALIDATE` / `PHASE4_COMPLETE`

**Degrade**: report failure does not block the detection flow; skip silently. Progress data is for frontend live display and is not on the critical path.

---

## Step 2.6: Phase 2 completeness self-review (8 items)

After all write-backs finish and before entering Phase 3, confirm each item:

| # | Self-review item | Action if it fails |
|---|---|---|
| 1 | **Fully complete**: every $DETECTION_PLAN item is written back, nothing omitted; every method in a call-chain group is written one by one (do not skip a method because "the chain was already looked at as a whole") | Write back the omitted methods |
| 2 | **bugStatus=2 is reasonable**: if the share is >90%, inspect the first 3 thinking texts and check they were truly analyzed (not batch-filled "no issue found") | Fill in real analysis |
| 3 | **Case-association coverage**: when HAS_CASES=true, $CASES[] bodies are non-empty; thinking for caseRelevance=direct methods cites concrete case steps | Read the cases and add citations |
| 4 | **Call-chain description complete**: strategy=11 content includes a call-chain path (A#method(L12)→B#method(L45)) | Add call-chain analysis |
| 5 | **Frontend compliance**: frontend projects loaded frontend-specific rules; filePath/code-language markers are correct (JS/TS/kotlin/swift/objc) | Fix |
| 6 | **Already-filed defect cross-check**: when $DELIVERY_DEFECTS[] is non-empty, every changed class had an L2.1 related-issue check | Run the L2.1 check |
| 7 | **Triangle cross-check**: when HAS_CASES=true or HAS_DOC=true, Step 2.7c `cross-view-check` has run and `gate_passed=true` | Run the triangle cross-check |
| 8 | **Cross-repo dependencies handled**: every className whose file does not exist was handled by strategy A/B/C/D (see Step 2.0) | Fill in per strategy |

> ⚠️ **Full-depth detection requirement**: the Agent must not skip other methods in the pending list because it "only analyzed key classes/methods". Every process returned by `get-pending` must go through the full STEP A→B→C→C.5→D flow. If the Agent only analyzed part due to time limits, it must clearly mark "incomplete" in the Step 2.6 self-review and must not enter Phase 3 (`check-coverage` will intercept).

**>>> GATE: all 8 items OK before entering Step 2.6b.**

---

## Step 2.6b: Analysis quality gate [run after self-review passes]

```bash
node "$SKILL_SCRIPT" check-analysis-quality --task-id $TASK_ID --batch-id $BATCH_ID
```

Programmatically checks strategy=11 contextReads depth (T1 ≥2, T2 ≥1, T3 / trivial-filter exempt) and minDetectLevel compliance. Continue when `passed=true`; when `passed=false`, supplement STEP B context reads per `failures` and retry. Do not add context reads for T3 methods to force a pass.

> Details: `references/analysis/analysis-framework.md` → "Phase 3 quality gate".

**>>> GATE: enter Step 2.7 only when `passed=true`.**

---

## Step 2.7: Requirement-coverage check [required when there are docs]

**Purpose**: after all methods are analyzed, check whether business rules extracted from DOC_SUMMARY.md have corresponding implementations in the changed code, and find features "described in the doc but not changed in code" (suspected missed development).

**Prerequisite**: `$HAS_DOC=true` (there is a DOC_SUMMARY.md and extractedRules is non-empty). Skip when there are no docs.

```bash
node "$SKILL_SCRIPT" check-req-coverage --task-id $TASK_ID
```

**Handle uncoveredRules**:

For each item in the returned `uncoveredRules` list, confirm manually:

1. **Open the corresponding code file** and search for the rule keywords → if it is implemented but simply failed to match → ignore
2. **Confirm suspected missed development** → call `register-finding` to record:
   ```bash
   node "$SKILL_SCRIPT" register-finding --task-id $TASK_ID \
     --phase analysis --category gap \
     --text "Suspected missed development: {rule description}; required by the doc but no implementation found in the changed code" \
     --source "req-coverage-check"
   ```
3. **Confirm that feature is implemented by another service/repo** (this repo was never supposed to have it; outside coverage-match scope) → ignore

> ⚠️ This step does not produce a bugStatus write-back. It only records findings for the final summary "requirement-implementation compare" and "risk notes" sections.
>
> 🔴 **Do not misread the red line (see SKILL.md red line 2 supplement)**: "ignore" in point 3 **only means coverage-match differences that are "not a defect"** such as "this feature is implemented by another service and is not this repo's duty". It does **not** mean "any issue outside this change may be ignored".
> - req-coverage checks **requirement-implementation compare (missed development / feature coverage)** and is indeed findings-only, with no bugStatus write-back;
> - but **if during the check you find a real, valid code defect (not a mere coverage mismatch), whether or not it is in this diff, you must immediately create a process for it and write back bugStatus=6/7 (pre-existing ones get a [Pre-existing] tag), then tell the user**. Default AST scope is still the PR diff; this rule is about defects you actually found while reading, not a mandate to verify every out-of-diff AST hit.

---

## Step 2.7b: Test-case vs document-rule coverage check [required when there are both docs and test cases]

**Purpose**: check whether business rules extracted from DOC_SUMMARY.md are covered by existing test cases, find features "described in the doc but not covered by cases", and output them to the user as a **risk note** (suggest adding/revising cases).

**Prerequisite**: `$HAS_DOC=true` and `$HAS_CASES=true`. Skip if either is false.

**How to run**: `check-req-coverage` already has built-in case-coverage compare (the `caseCoverage` field in the return). No extra call is needed.

**Handle caseCoverage.caseUncoveredRules [MUST — semantic verify one by one; do not trust programmatic match results directly]**:

> ⚠️ Programmatic matching is based on keywords/substrings. When a test case covers a rule with a short form or synonym, the program may misjudge it as "uncovered".
> **The Agent must do a semantic-level check one by one and must not treat programmatic uncoveredRules as the final conclusion.**

For each item in the returned `caseUncoveredRules` list, run this verification **one by one**:

1. **Go back to the test-case body** (`$CASES[]` steps/expectedResult fields) and judge with **semantic understanding** (not keyword match) whether the rule is already covered:
   - The case may cover the rule with a short form, synonym, or abbreviation (e.g. "both invalid then absent" = "if the discount code and add-on are both missing or both invalid, the item does not appear in the result")
   - One case step may cover multiple rules at once
   - **As long as you can semantically confirm that some step/expected result of the case verifies the rule, judge it "already covered"**
2. **Confirm already covered (program false negative)** → remove it from findings (do not output to the user), or mark "program match missed but semantically covered"
3. **Confirm truly uncovered** → keep the finding and output it in the final summary
4. **Confirm out of this test scope** (e.g. covered by another test plan) → ignore

**Output locations**:

- Final summary "📊 Document coverage analysis" section: show the test-case coverage number
- Final summary "⚡ Risk notes" section → "Suggest adding/revising cases" items: list requirement rules not covered by cases

> ⚠️ This step does not produce a bugStatus write-back and does not affect the detection conclusion. It is one layer of multi-view protection — making sure the user knows "which requirement points may have insufficient test cases".

---

## Step 2.7c: Triangle cross-view check [required when HAS_CASES=true and there are docs; GATE]

> Details: `references/analysis/cross-view-check.md` (four-way verification model / degrade rules / semantic-verify requirements / gate).

```bash
node "$SKILL_SCRIPT" cross-view-check --task-id $TASK_ID
```

- Run all four directions at once (case→code / requirement→case / requirement→code / code→case→requirement)
- `gate_passed=true` → semantically verify each "uncovered" finding, then enter Phase 3
- `gate_passed=false` + `actionRequired=true` → roll back to STEP C, re-analyze the matching methods, then retry
- **⚠️ Programmatic match is a first filter**; the Agent must semantically verify one by one (prevent keyword-mismatch false negatives)

**>>> GATE**: enter Phase 3 only when `gate_passed=true` and semantic verification is done.

---

# Phase 3: Validation and close

## Step 3.1: Completeness check

```bash
node "$SKILL_SCRIPT" check-coverage --batch-id $BATCH_ID
```

`allCompleted=false` → supplement detection for missedItems, then check again.

## Step 3.2: Rank integrity

```bash
node "$SKILL_SCRIPT" check-rank-integrity --batch-id $BATCH_ID
```

If `missingRankItems` is non-empty → finalize-rank each item.

## Step 3.3: Report ↔ actual analysis compare [GATE; specifically for report vs actual mismatch]

> **Purpose**: prevent "report status / defect list" from drifting away from "what the Agent actually analyzed". Earlier gates only check whether counts are complete (local self-check). This step is a **line-by-line reconcile of both sides** — DoD section B, and the real mark of "done".
>
> **Relation to Phase 2 immediate check**: Phase 2 `batch-update-process --verify` already did a lightweight immediate reconcile after each batch (this-batch landing consistency).
> By Step 3.3, most drift has already been caught and fixed. `reconcile-report` here is the **full final reconcile** —
> it pulls a complete platform-report snapshot and diffs it against the full local result, catching edge cases immediate check cannot cover (e.g. cross-batch rank-state inconsistency, platform async delay).
> In the normal case (every immediate check was CONSISTENT), reconcile-report passes on the first round.

**One-click reconcile (programmatic diff; no hand line-by-line compare)**

```bash
node "$SKILL_SCRIPT" reconcile-report --task-id $TASK_ID
```

This command automatically pulls the platform-report defect list and the local actual analysis result, diffs them, and outputs three reconciles:

| Compare item | Command return field | Fix when inconsistent |
|---|---|---|
| ① No omitted defects | `missingInReport` (local has, report does not) | Re-run `batch-update-process` for that method (correct bugStatus) → `finalize-rank` |
| ② No extras from nowhere | `extraInReport` (report has, local does not; rewritten / wrong object) | Correct the report object or complete local analysis; `update-rank-content` to align the conclusion |
| ③ Counts can be reconciled | `localDefectCount` vs `reportDefectCount` | If the delta is same-root-cause dedup, say so explicitly in the summary "Impact scope"; otherwise fill it in |

- Exit code `0` (`ok=true`) → compare passed.
- Exit code `1` (`ok=false`) → locate methods from `blockers`, fix, then **re-run `reconcile-report`** until it passes.

**Basic pass line** (kept): task status=2, defect counts reconcile, each content ≥80 characters.

**>>> GATE**: the compare passes only when `reconcile-report` returns `ok=true`. **Do not output "detection complete" to the user until it passes** (see `SKILL.md` → detection-complete standard section B).

> When you need a human check that conclusion semantics were not rewritten off-track, you may also compare `get-report` + `get-findings` by eye; but the hard reconcile of counts / omissions / extras is authoritative from `reconcile-report`.

## Step 3.3b: Multi-batch close inventory (when $BATCH_IDS[] >1)

Run `get-pending` again for every batch, diff against content.json, and if anything is missing, supplement write-back and re-check.

## Step 3.4: complete-task [must run]

**Before writing the summary, first pull every finding accumulated this run**:

```bash
node "$SKILL_SCRIPT" get-findings --task-id $TASK_ID
```

Returned `summaryText` lists all findings grouped by category. Write `--summary` from this content, not from memory.

```bash
node "$SKILL_SCRIPT" complete-task --task-id $TASK_ID --batch-ids "$BATCH_IDS" --summary "$DETECTION_SUMMARY"
```

- Pass every parentBatchId (comma-separated)
- **`--summary` must be written back**. Detailed format / section requirements / forbidden items / examples: `references/output/summary-spec.md`

> 🟢 **You can still write back after complete-task**: `complete-task` is a close action (write summary + mark complete), **not a lock**. You may still call `update-process` / `batch-update-process` / `finalize-rank` / `update-summary` at any time to supplement or correct. When you find a missed defect or user feedback requires a corrected conclusion, write it back directly; you do not need to complete-task again.

> **Gate and `--force`/`--failed` mechanism**: `references/analysis/phase2-scripts.md#step-3.4` (single source of truth). complete-task automatically rechecks check-coverage + check-rank-integrity; if they fail it refuses, lists blockers, and you go back to 3.1/3.2 to fill in and retry.

### `--force` scope

`--force` **only skips consistency gates** (process/rank integrity checks) and **does not skip summary format validation** (section markers / forbidden-word detection always run). That is, `--force` only affects whether you may close the task when write-back is incomplete; it does not relax detection-summary content-quality requirements.

### Summary submit and correction

> 🔴 **Read the spec before writing/changing a summary**: before every `complete-task --summary` or `update-summary`, **you must first read `references/output/summary-spec.md`**, confirm format requirements, section structure, and forbidden items, then write. Do not write from memory — the spec may have been updated, and long conversations make details easy to forget.

> Details: `references/output/summary-spec.md` (full usage of validate-summary / --preview / update-summary).

- Before submit, prefer `validate-summary` or `complete-task --preview` for a format self-check
- When `_summary_status=FAILED`, rewrite with `update-summary --task-id $TASK_ID --summary "$FIXED_SUMMARY"`
- `update-summary` may be called independently at any time after complete-task

## Step 3.4b: Mid-detection exception (skip-service-batch)

When a service detection is abnormal and cannot be recovered, call `skip-service-batch --parent-batch-id $ID --failed` to mark failure.
You must tell the user before calling. Other services are unaffected.

## Step 3.4c: Post-close final check — report ↔ actual result compare [GATE; must pass before output]

> After a successful `complete-task` (not `--force`) close, it **automatically runs `reconcile-report` once** and returns `_reconcile_status`: `CONSISTENT` = pass; `DRIFT` = fail.
> On `DRIFT` you must fix write-backs and manually re-run `reconcile-report` until it passes. Reconcile rules are the same as Step 3.3; see `references/rules/definition-of-done.md` section B.

- **Do not enter Step 3.5 and output "detection complete" until the compare is cleared.**

## Step 3.5: Output the final summary

> **Hard prerequisite**: the Step 3.4c final compare has passed (DoD A+B+C all satisfied). Otherwise you must not output.

**The user-facing final summary = detection summary + defect-list digest**. Generation flow:

1. First generate the detection summary (the `--summary` written back in Step 3.4: requirement-change points, analysis scope, risk points)
2. Then append the defect-list digest (suspected-defect table, improvement table, requirement compare, etc.)
3. Combine and output to the user

Templates: `references/output/output-templates.md`. Only part 1 (detection summary) is written back to the platform. What the user sees is the full version (1+2).

---

## Step 3.6: Post-summary self-check [MUST — cannot skip]

> Details: `references/output/summary-spec.md#post-summary-self-check` (five checks: content consistency / readability / authenticity traceability / purpose purity / report link).

After writing the summary back you must immediately self-check: compare `get-findings` and confirm every defect and cross-view finding is shown one by one (no lumping), risk points include the four elements, and the end includes a report link. **Extra checks**: ① items with no problem should not appear in the summary (only talk about what has problems); ② the summary should not contain isolated codes/terms unexplained in context (do not write identifiers the user cannot understand); ③ possible false positives should not be output (only output real findings the user should care about); ④ **every piece of information must be traceable** — verify one by one that line numbers / class names / defect descriptions / stats in the summary come from real detection data; do not invent or guess; delete anything without a source. If it fails, `update-summary` rewrite until it passes.

---

## Step 3.7: Proactively output the report link [MUST]

> **After detection completes, the Agent must proactively give the user a report link**, without waiting to be asked.

When the final summary is output to the user, **the end must include**:

```
> View full report: [Open]({reportUrl})
```

`reportUrl` uses the current platform provider return value. Locally it is written as openable HTML (`file://` link to `data/platform/reports/{taskId}.html`); if the chat link does not open, open that file in the system browser. Remote platforms use the configured `report_base_url`.

This is the user's entry to the full report page. **Missing report link = incomplete summary = detection not complete**.
