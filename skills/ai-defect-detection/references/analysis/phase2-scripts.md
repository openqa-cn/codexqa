# Phase 2 scripts and template reference

> This file contains the detailed bash scripts, batch-writeback strategy, and cross-repo handling for each SKILL-PHASE2.md step.
> Cite it only on first execution of a step or when you hit a problem.

---

## Auto-fix before writeback

> ✅ **Pre-fix is already built into the `update_process` / `batch_update_process` main flow**: every writeback automatically runs
> `pre_validate_and_fix`. Deterministic format issues (prefix / line-number wrapping / filePath / bold) are silently fixed. **The Agent does not need to call it.**
> Therefore **do not trial-and-error tweak format errors** — submit as-is. What can be auto-fixed will be auto-fixed; only unfixable cases return an error.

```python
from open_platform import update_process  # or batch_update_process

# Submit directly; format issues are already auto pre-fixed inside
result = update_process(request_body)
if result.get("code") != 0:
    # Reaching here = a "quality issue" pre-fix cannot handle (thinking too short / empty conclusion)
    # → must re-run a real analysis, not retry after changing format
    ...
```

### Auto pre-fix coverage (no Agent intervention; built in)

| Error type | Auto fix |
|---|---|
| content missing `Defect:` / `Improvement:` prefix | Auto-add |
| Line numbers wrapped as `**Lines:**` | Strip bold |
| fileCodes[].filePath empty | Derive from className |
| content field names used `**bold**` | Strip (platform does not render) |

### Hard intercept (pre-fix cannot repair; must re-analyze; no format-tweak retry)

| Error type | Reason |
|---|---|
| thinking <30 chars | Must re-analyze in depth |
| processSteps[].conclusion empty | Must actually execute that step |

> 💡 **Judgment**: when writeback returns `validation_failed`, first check whether it is a "quality issue" in the table above.
> Yes → re-analyze this method (read code / expand the Call chain), rewrite thinking and conclusion;
> No → most likely already handled by pre-fix; no manual format change needed.

---

## Step 2.0-pre: filter non-business files (run first)

Test classes and build/config files do not carry business logic and **need no real defect detection**. Identify and drop them before cross-repo dependency handling.

### Identification list

Test classes (any match is enough):

- className / class-name suffix: `*Test`, `*Tests`, `*IT`, `*ITCase`, `*TestCase`
- Path contains: `src/test/`, `/test/`, `/tests/`, `__tests__/`
- Frontend test files: `*.test.js`, `*.test.ts`, `*.spec.js`, `*.spec.ts`

Build/config files (any match is enough):

- Build: `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `package.json`, `*.lock`
- Config: `*.properties`, `*.yml`, `*.yaml`, config-only `*.xml` (e.g. spring/log config other than mybatis)

### Handling

| Entry type | Enter `$DETECTION_PLAN`? | How to close the placeholder process |
|----------|--------------------------|------------------------|
| Test class (`.java`) | No; skip | If get-pending issues a process, `update-process bugStatus=2`, thinking writes "test class; does not carry business logic; no detection needed" (test classes are real `.java`, so className validation can pass) |
| Non-`.java` config such as `pom.xml` (frontend-specific rules) | No; skip | ✅ Call `update-process bugStatus=2` normally, same idea as test classes (non-Java className validation bypass is now supported) |

### ✅ Fixed: placeholder process for non-Java files (pom.xml / *.properties, etc.) can now be closed

**What was fixed** (2026-07-06):
- Platform `update-process` className validation was relaxed
- For non-Java files (judged by suffix `.xml`, `.thrift`, etc., or a multi-language file-type mark), className validation failure **may be bypassed**
- **Applies to all bugStatus (2/6/7)**: no defect, suspected defect, and Improvement are all supported
- Reason: non-Java file content (frontend rules, config files) is fully provided via `fileCodes.filePath`; git lookup is not needed. This is a normal workflow
- Java files must still pass git validation (so the code source is traceable)

**How to use** (can close directly now):
- After identifying a placeholder process for `pom.xml` / `*.properties` or other non-Java files, **call `update-process` normally regardless of bugStatus**
- Pass `className` as the file name or path (e.g. `pom.xml`, `src/main/resources/application.properties`)
- The server auto-recognizes a non-Java file, skips git validation, and persists (bugStatus=2/6/7 all supported)

**Verify the fix**:
```bash
# Example 1: no defect (bugStatus=2)
node "$SKILL_SCRIPT" update-process \
  --task-id $TASK_ID --rank-id $RANK_ID \
  --bug-status 2 \
  --className "pom.xml" \
  --thinking "Non-business file; does not carry business logic; no detection needed" \
  --content "No defect in this code"

# ✅ Successfully returns processId

# Example 2: has a defect (bugStatus=6) — failed before the fix; works after
node "$SKILL_SCRIPT" update-process \
  --task-id $TASK_ID --rank-id $RANK_ID \
  --bug-status 6 \
  --className "pom.xml" \
  --thinking "pom.xml Maven dependency versions have risk..." \
  --content "Defect: Lines 10-15, Spring Boot version is too low..."

# ✅ Successfully returns processId; process is closed
```

**History** (already fixed):
- Server className validation used to treat every className as a Java simple class name and failed on non-`.java` files
- Passing `gitFilePath`, `fileCodes.filePath`, etc. could not bypass it (the server only accepted className)
- Placeholder processes with progress=0 could not close, blocking `complete-task` converge
- File-level validation flexibility fully removed this limit

---

## Step 2.0: cross-repo dependency handling

### How to identify

Compare the className from get-pending with the local clone directory:
if `$LOCAL_DIR/src/main/java/<className>.java` does not exist → cross-repo dependency class.

### Handling (try in priority order)

| Strategy | Condition | Action |
|------|------|------|
| A. Already present in another service of this iteration | That className exists in another service's clone directory in this iteration | Detect normally with that service's source |
| B. Reverse-look-up the source repo | Source-repo URL can be inferred from the package name | clone → detect normally |
| C. User-specified | User provided the URL | clone → detect normally |
| D. Source unreachable | Cannot determine / no permission | **Analyze from the caller side** (do not skip) |

### Strategy A steps

1. Walk every already-cloned service directory in this iteration
2. Look for the .java file of that className under each service's `src/main/java/`
3. Found → read the source and analyze together with this service's caller-side code
4. No extra clone or registration (already done in Phase 1)

### Strategy B steps

1. Infer artifactId from the package name
2. Search enterprise Git by artifactId
3. clone and confirm the .java file exists
4. Watch modular projects (sub-module paths)
5. Register the clone → run normally

### Strategy D (source unreachable; still analyze)

**Core principle: do not skip with bugStatus=2.** Even without callee source, you can still find issues on the caller side.

**What to analyze**:
1. Find the call sites of this cross-repo class in this service
2. Analyze whether call arguments are legal (null, type, bounds)
3. Analyze whether the return value is handled correctly (null check, exception type, default)
4. Analyze whether exceptions are caught and handled correctly
5. Analyze whether timeout / degrade / circuit-break is configured

**Writeback rules**:
- Caller-side issue found → bugStatus=6/7, write back normally
- Caller-side code is fine → bugStatus=2, thinking states "cross-repo source unreachable; analyzed caller-side code (arg validation / return handling / exception catch); no issue found"
- fileCodes.git fills **this service's** repo URL; filePath fills the file in this service that calls the class

### fileCodes.git writeback rules

- Strategy A/B/C (source obtained) → git fills the source-repo URL; filePath fills the actual path in that source
- Strategy D (source unreachable) → git fills **this service's** repo URL; filePath fills the file in this service that calls the cross-repo class

### Hard rule 19 coordination

- Strategy A: no extra work (already registered in Phase 1)
- Strategy B/C: after clone, must `register-repo-clone`
- Strategy D: use this service's repo git + clone registration so Hard rule 19 passes

### Record in content.json

```bash
node "$SKILL_SCRIPT" add-cross-repo-class \
  --task-id $TASK_ID --class-name "$EXTERNAL_CLASS" \
  --info-json "$cross_repo_json"
```

---

## Step 2.1: AST scan

```bash
node "$SKILL_SCRIPT" run-ast-scan \
  --code-dir <local repo> \
  --rules-json '<$RULES full rules JSON>' \
  --task-id $TASK_ID \
  --project-language <optional: java|javascript|python|...>
# PR default: changed files from diff.files. Opt-in whole-repo: --full-repo
```

### Key properties

- **PR/diff default = changed files**: `--task-id` loads `diff.files`. Use `--full-repo` only when the user asks for a whole-repo sweep
- **`inDiff` tag**: full-repo hits on files not in `diff.files` are `inDiff=false` (T0 / auto-dismiss; no per-hit read)
- **`--rules-json` takes the full rules**: internally grouped via `open_rules.prepare_rules()`
- **Language auto-filter**: Java projects do not run JS rules, and vice versa
- **Exclusion rules auto-associated**: each finding carries an `exclusionRules` field

### Rule-grouping mechanism

```python
from open_rules import prepare_rules, get_rules_for_ast_strategy, get_rules_for_agent_strategy

grouped = prepare_rules($RULES)

# AST strategy
ast_rules = get_rules_for_ast_strategy(grouped, strategy_code=8)
# ast_rules["scan_rules"]      → category=1, semgrep scan
# ast_rules["exclusion_rules"] → category=3, exclusion judgment

# s11 business-strategy rules
s11_rules = get_rules_for_agent_strategy(grouped, strategy_code=11)
# s11_rules["custom_rules"]     → category=2, natural-language defect patterns
# s11_rules["exclusion_rules"]  → category=3, exclusion scenes
# s11_rules["system_rules"]     → category=4, generic rules
```

### Rules per strategy

| Strategy | category used | Purpose | How used |
|------|---|---|---|
| s8 | 1+3 | Semgrep rules + exclusion | Program auto-scan |
| s11 | 2+3+4 | Code-logic + chain + business defect patterns | Agent STEP C reference |

### findings decision tree

> 🔴 **In-diff verification (no sampling)**: every **in-diff, non-generated** finding must walk the filter/verify flow. Out-of-diff (`inDiff=false`) and generated hits are auto-dismissable T0 — do not read 58 stock hits one by one. `batchDismissByStrategy` cleans leftovers after in-diff verification; pass `--verified-count` = `verifyRequiredFindings` and `--dismissible-count` = `dismissibleFindings`.

```
findings empty → call batchDismissByStrategy to clean in batch (see writeback flow below)
findings non-empty → classify:
  ├── autoGenerated=true or inDiff=false → no defect (T0 / generated; pending batch; no file read)
  └── in-diff + not generated → filter (no sampling of this subset):
       ├── hasExclusionRules=true → read exclusion description + code context
       │    ├── matches exclusion → mark as no defect (pending batch)
       │    └── does not match → LLM verify
       ├── hasExclusionRules=false → LLM verify directly
       └── LLM verify:
            ├── false positive → mark as no defect (pending batch)
            └── real defect → bugStatus=6/7 (write back one by one first)
```

### AST writeback flow (two steps; order must not flip)

**Step 1: write defects one by one (bugStatus=6/7)**

Write every record judged as a real defect via `updateProcess`, with complete thinking/content/processSteps:

```bash
# Write each real defect one by one
node "$SKILL_SCRIPT" update-process \
  --task-id $TASK_ID --rank-id $RANK_ID \
  --bug-status 6 \
  --thinking "$THINKING" --content "$CONTENT" --process-steps "$STEPS"
```

**Step 2: batch-clean remaining no-defect records**

After all defects are written back, call `batchDismissByStrategy` once to set every still-bugStatus=0 s8 record under that parentBatchId to bugStatus=2:

```bash
# One API call cleans all remaining s8 no-defect records
node "$SKILL_SCRIPT" batch-dismiss-by-strategy \
  --parent-batch-id $PARENT_BATCH_ID --strategy-code 8
```

> ⚠️ Order must not flip: write defects first, or batchDismiss will also mark unprocessed defects as no defect.
> ⚠️ `batch-dismiss-by-strategy` is AST strategy only (strategyCode=8). Other strategies still write via `updateProcess` / `batch-update-process` one by one.

### Write AST results into content.json

```bash
node "$SKILL_SCRIPT" set-plan-ast-result \
  --task-id $TASK_ID --class-name "$CLASS_NAME" --method-name "$METHOD_NAME" \
  --has-finding "$HAS_FINDING" --findings-json "$FINDINGS_JSON" \
  --hit-rule-ids "$HIT_RULE_IDS" --exclusion-rule-ids "$EXCLUSION_RULE_IDS"
```

---

## Batch-writeback best practices

### Performance

- 60 processes one by one: ~60 × 3–5s = 3–5 minutes
- 60 processes in batch: 1 × 5 concurrency = 15–30 seconds

### Command

```bash
echo '$JSON_ARRAY' > /tmp/defect-detection/batch_items.json
node "$SKILL_SCRIPT" batch-update-process --items-json /tmp/defect-detection/batch_items.json
```

### Forced aggregation

| Stage | Aggregation grain | Method |
|---|---|---|
| After AST scan | Defects one-by-one updateProcess → remaining once via batchDismissByStrategy | Server API (s8 only) |
| After one className is analyzed | That className's s11 once as a batch | batch-update-process |
| After all analysis | Aggregate remaining by parentBatchId | batch-update-process |

### Failure degrade

```
whole batch failed
  ├── split into 5-item batches and retry
  ├── still fail → single-item xargs -P3 parallel
  └── single item also fails → record it; note in the summary
```

---

## Step 2.2: process lifecycle records

```bash
# Record after writeback
node "$SKILL_SCRIPT" record-process-writeback \
  --task-id $TASK_ID --batch-id $BATCH_ID \
  --class-name "$CLASS_NAME" --method-name "$METHOD_NAME" \
  --strategy-code "$STRATEGY_CODE" --bug-status "$BUG_STATUS" \
  --has-exclusion false --write-method "batch"

# Update status
node "$SKILL_SCRIPT" update-plan-status \
  --task-id $TASK_ID --class-name "$CLASS_NAME" --method-name "$METHOD_NAME" \
  --strategy-code "$STRATEGY_CODE" --status "written"
```

---

## Step 2.4: finalize-rank

```bash
node "$SKILL_SCRIPT" finalize-rank \
  --batch-id $BATCH_ID \
  --class-name "<className slash format>" \
  --method-name "<methodName>" \
  --bug-status <6 or 7> \
  --process-ids "<comma-separated processId list>" \
  --content "<rank content>"
```

### content format requirements

- Plain text; no `##` heading prefix (start directly with `Defect:` or `Improvement:`)
- Include `Lines:X-Y` (plain text; no `**`)
- All field names are plain text (no bold)
- Problem tags wrapped in [] plus [This change/Pre-existing]
- Include required fields such as Affected business, Reproduction path
- If a test case is cited, keep `Test case ID:[ID]<case title>`

### Record the rank into content.json

```bash
node "$SKILL_SCRIPT" record-rank \
  --task-id $TASK_ID --class-name "$CLASS_NAME" --method-name "$METHOD_NAME" \
  --bug-status "$BUG_STATUS" --rank-id "$RANK_ID"
```

---

## Phase 3: validation and converge commands

### Step 3.1: completeness check

```bash
node "$SKILL_SCRIPT" check-coverage --batch-id $BATCH_ID
```

### Step 3.2: Rank integrity

```bash
node "$SKILL_SCRIPT" check-rank-integrity --batch-id $BATCH_ID
```

### Step 3.3: report reconcile

```bash
node "$SKILL_SCRIPT" get-report --task-id $TASK_ID
```

### Step 3.3b: multi-batch converge inventory

```bash
for BATCH_ID in $BATCH_IDS; do
  node "$SKILL_SCRIPT" get-pending --batch-id $BATCH_ID
done
```

### Step 3.4: complete-task

```bash
node "$SKILL_SCRIPT" complete-task --task-id $TASK_ID --batch-ids "$BATCH_IDS"
```

**Gate notes**:
- Pass `--batch-ids` (comma-separated all parentBatchId)
- Automatically re-checks check-coverage + check-rank-integrity
- Failure refuses converge and lists blockers
- Go back to Step 3.1/3.2, backfill, then retry
- `--force` is forbidden by default

**`--force --failed` warning (irreversible)**:
- Writes a failMsg on every job in the report; old failMsg is not cleared
- Correct action: do not call `--force --failed`; stay "in progress"; converge normally after the problem is fixed
- Use only after confirming you cannot continue (repo deleted / service offline) **and** the user confirms

### Step 3.4b: skip-service-batch (exception mid-detection)

```bash
# Detection exception → mark FAILED(3)
node "$SKILL_SCRIPT" skip-service-batch \
  --parent-batch-id $PARENT_BATCH_ID \
  --failed \
  --reason "Detection exception: <exception summary>"
```

| Scene | Command | Status |
|------|------|------|
| No git permission; user skips | `skip-service-batch --parent-batch-id $ID` | SKIP(4) |
| Exception mid-detection | `skip-service-batch --parent-batch-id $ID --failed` | FAILED(3) |

---

## Common-error lookup

| Error keyword | Cause | Fix |
|---|---|---|
| `content must contain "Defect:"` | Missing prefix | pre_validate_and_fix auto-fixes |
| `must contain "Lines:"` | Missing line numbers | Add `Lines:X-Y` |
| `Lines:start-end` | Wrapped in markdown | Use plain text |
| `tagId illegal` | Invalid | Re-pick from `$VALID_TAG_IDS[]` |
| `thinking cannot be empty` | Not filled | Add ≥30 chars of real analysis |
| `processSteps cannot be empty` | Not passed | At least one step with conclusion |
| `fileCodes cannot be empty` | Not passed | Add an item with filePath/git/branch/commitId |
| `Hard rule 19 (repo-clone gate)` | Not cloned | clone + register-repo-clone first |
| `Hard rule 14 (code-read gate)` | Code not read | read + register-code-read first |
| `Hard rule 15 (Affected business)` | content missing | Add `Affected business:<description>` |
| `Hard rule 16 (Reproduction path)` | content missing | Add `Reproduction path:<path>` |
| `Hard rule 17.1 (no bold)` | Used `**` | Remove; use plain text |
| `Hard rule 17.3 (tag format)` | Not wrapped in [] | Use `[tag name][This change/Pre-existing]` |

Handling: `pre_validate_and_fix` first → if still wrong, fix by this table → silent retry.
