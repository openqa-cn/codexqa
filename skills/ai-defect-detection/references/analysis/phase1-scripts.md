# Phase 1 scripts and template reference

> This file contains the detailed bash scripts, templates, and degrade strategies for each SKILL-PHASE1.md step.
> Cite it only on first execution of a step or when you hit a problem. Do not load it every time.

---

## Step 1.1: locate the script

```bash
# 1) OpenClaw / Cursor injected skill root  2) same dir as SKILL.md  3) common install roots  4) find
SKILL_SCRIPT="${SKILL_DIR:-${baseDir:-}}/open_detect.ts"
if [ ! -f "$SKILL_SCRIPT" ]; then
  SKILL_SCRIPT="$(cd "$(dirname "$0")" && pwd)/open_detect.ts"
fi
if [ ! -f "$SKILL_SCRIPT" ]; then
  for base in \
      "$HOME/.cursor/skills" \
      "$HOME/.openclaw/skills" \
      "$HOME/.openclaw/workspace/skills" \
      "$HOME/.agents/skills" \
      "$HOME/.claude/skills" \
      "$HOME/.codex/skills" \
      ".cursor/skills"
  do
    [ -d "$base" ] || continue
    candidate=$(find "$base" \( -path "*/ai-defect-detection/open_detect.ts" -o -path "*/defect-detection/open_detect.ts" -o -path "*/defect-detection-*/open_detect.ts" \) 2>/dev/null | head -1)
    if [ -n "$candidate" ]; then SKILL_SCRIPT="$candidate"; break; fi
  done
fi
if [ ! -f "$SKILL_SCRIPT" ]; then
  SKILL_SCRIPT=$(find "$HOME" -name open_detect.ts -path "*defect-detection*" -not -path "*node_modules*" 2>/dev/null | head -1)
fi
```

---

## Step 1.3b: code-permission precheck script

> ⚠️ **Clone-directory dimension**: the local clone directory is based on the hash of `git_url + branch`, not the service key.
> The same git repo + same branch is reused across services/batches, avoiding "same repo cloned and analyzed twice".
> Prefer the `clone-and-diff` all-in-one command (this logic is built in). Do not hand-assemble directories from the service key.
>
> **Java Call chain (default)**: after a successful clone, `ensure-gitnexus` (probe → force-install once if missing → `gitnexus analyze`). See `SKILL-PHASE1.md` Step 1.2b. Degrade to grep only if install fails and cannot be repaired.

```bash
# REPO_HASH = first 12 chars of md5(git_url@branch); local directory dimension (do not split by service key)
# Compatible with Linux(md5sum) and macOS(md5)
REPO_HASH=$(printf '%s@%s' "$GIT_URL" "$BRANCH" | { md5sum 2>/dev/null || md5; } | tr -dc 'a-f0-9' | cut -c1-12)
LOCAL_DIR="/tmp/defect-detection/${REPO_HASH}"
if [ -d "$LOCAL_DIR/.git" ]; then
  cd "$LOCAL_DIR" && git fetch origin "$BRANCH" 2>&1 | head -5
  if [ $? -eq 0 ]; then
    git checkout "$BRANCH" && git reset --hard "origin/$BRANCH"
    echo "CLONE_SUCCESS"
  else
    echo "CLONE_FAILED"
  fi
else
  git clone --depth=1 -b "$BRANCH" "$GIT_URL" "$LOCAL_DIR" 2>&1 | head -5
  if [ $? -eq 0 ]; then
    echo "CLONE_SUCCESS"
  else
    echo "CLONE_FAILED"
    rm -rf "$LOCAL_DIR"
  fi
fi
```

### Template: ask the user when there is no permission

```
⚠️ Insufficient code permission

The following services cannot pull code:
- {serviceKey}: {branch}（{gitUrl}）

Please choose how to proceed:
1. Ignore services without permission: skip them and detect only services you can access
2. Request code permission: contact the repo owner, add permission, then retry
3. Abort the task
```

### Handling after the user chooses

| Choice | Action |
|------|------|
| 1 | Remove from `$SERVICES[]` → if the task is already submitted, also call `skip-service-batch` |
| 2 | Abort; prompt to request permission |
| 3 | Abort |

### skip-service-batch (skip a no-permission service after submit)

```bash
node "$SKILL_SCRIPT" skip-service-batch \
  --parent-batch-id $PARENT_BATCH_ID \
  --reason "git clone failed: <clone error summary>"
```

> 💡 `submit-plan` creates batch/process records per service and sets them to "in progress".
> Without `skip-service-batch`, that service stays "in progress" forever and the `complete-task` gate cannot pass.

---

## Step 1.4: submit the detection task

```bash
node "$SKILL_SCRIPT" submit-plan \
  --plan-id $TEST_PLAN_ID \
  --plan-type 2 \
  --submit-user $USER_ID
```

### Initialize content.json

```bash
node "$SKILL_SCRIPT" init-content \
  --task-id $TASK_ID \
  --test-plan-id $TEST_PLAN_ID \
  --plan-name "$PLAN_NAME" \
  --user-id $USER_ID
```

If the return has `remappedFrom`, change `$TASK_ID` to the new `taskId`. Do not delete the old directory. Skip this step when resuming the same task.

---

## Step 1.5: register services into content.json

```bash
for svc in $SERVICES; do
  node "$SKILL_SCRIPT" add-service-to-content \
    --task-id $TASK_ID \
    --git-url "$svc.gitUrl" \
    --branch "$svc.branch" \
    --service-key "$svc.serviceKey" \
    --batch-ids "$BATCH_IDS_STR"
done
```

---

## Step 1.6: parallel data-fetch command list

> `$DIFF_FILES[]`, `$COMMIT_ID`, and `$LOCAL_DIR` already come from Step 1.3b `clone-and-diff`. Do not run git commands by hand.

| Sub-step | Command | Output |
|---|---|---|
| ~~1.6a~~ | ~~Already done by clone-and-diff~~ | `$DIFF_FILES[]` (already have) |
| ~~1.6b~~ | ~~Already done by clone-and-diff~~ | `$COMMIT_ID` (already have) |
| 1.6c | `node "$SKILL_SCRIPT" get-tag-list` | `$VALID_TAG_IDS[]` |
| 1.6d | `node "$SKILL_SCRIPT" get-rules --git <gitUrl> --user-id <userId>` | `$RULES[]` |
| 1.6e | `node "$SKILL_SCRIPT" get-confirmed-defect-history --git <gitUrl> --fix-status "0,2"` | `$HISTORY_DEFECTS[]` |
| 1.6f | `node "$SKILL_SCRIPT" get-exception-traces --plan-id $TEST_PLAN_ID --plan-type 2 --service-key <serviceKey>` | `$TRACES[]` |
| 1.6g | test-case provider `get_case` fetches `$CASE_IDS[]` one by one | `$CASES[]` |
| 1.6h | Submitted defects: prefer `node "$SKILL_SCRIPT" get-delivery-defects --plan-id $TEST_PLAN_ID --plan-type 2` (plan provider); degrade `node "$SKILL_SCRIPT" get-delivery-defects --plan-id $TEST_PLAN_ID --plan-type 2` | `$DELIVERY_DEFECTS[]` |

> **1.6h notes (submitted defects, used by Phase 2 L2.1 same-class problem check)**:
> - Prefer the **plan provider** to query submitted defects under this test plan / iteration: `get-delivery-defects --plan-id <planId>`, or iteration detail page `get-delivery-defects --plan-id <iterationId> --plan-type 4` (mutually exclusive with `-p`).
> - If the plan provider has no permission / cannot fetch, degrade to built-in `get-delivery-defects`.
> - Store results in `$DELIVERY_DEFECTS[]`. Phase 2 STEP C L2.1 uses them to check per method whether "the same class of problem still exists / a historical defect is fully fixed".

### Hard rule 19 — clone registration (required)

```bash
node "$SKILL_SCRIPT" register-repo-clone \
  --task-id $TASK_ID --batch-id $BATCH_ID \
  --git-url "$GIT_URL" --local-dir "$LOCAL_DIR" \
  --branch "$BRANCH" --commit-id "$COMMIT_ID"
```

### Batch code-read pre-registration (Hard rule 14)

```bash
for CLASS in $(node "$SKILL_SCRIPT" get-pending --batch-id $BATCH_ID | jq -r '.[].className'); do
  FILE_PATH=$(echo "$CLASS" | tr '/' '/' | sed 's|$|.java|; s|^|src/main/java/|')
  node "$SKILL_SCRIPT" register-code-read \
    --task-id $TASK_ID --batch-id $BATCH_ID \
    --class-name "$CLASS" --file-path "$FILE_PATH" \
    --code-snippet "pre-registered"
done
```

### content.json batch sync

```bash
# 1. Backfill commitId, localDir
node "$SKILL_SCRIPT" update-service-in-content \
  --task-id $TASK_ID --git-url "$GIT_URL" \
  --commit-id "$COMMIT_ID" --local-dir "$LOCAL_DIR" --verified true

# 2. Write Git Diff
node "$SKILL_SCRIPT" set-diff-files --task-id $TASK_ID --files "$DIFF_FILES_STR"
node "$SKILL_SCRIPT" set-changed-methods --task-id $TASK_ID --methods-map "$CHANGED_METHODS_JSON"

# 3. Write rules / tags / historical defects
node "$SKILL_SCRIPT" set-meta-field --task-id $TASK_ID --field "rules" --value "$(echo "$RULES" | base64 -w0)"
node "$SKILL_SCRIPT" set-meta-field --task-id $TASK_ID --field "tags" --value "$(echo "$VALID_TAG_IDS" | base64 -w0)"
node "$SKILL_SCRIPT" set-meta-field --task-id $TASK_ID --field "historyDefects" --value "$(echo "$HISTORY_DEFECTS" | base64 -w0)"
```

---

## Step 1.7: how to read documents

```bash
# Method 1 (prefer): doc-provider skill
oa-skills doc-provider getDocumentXml --contentId <ID> --output /tmp/defect-detection/<taskId>/docs/tech_<id>.xml

# Method 2 (degrade): doc-search title + content
# Method 3 (last resort): web_fetch
```

### DOC_SUMMARY.md template

```markdown
# Document summary — <PLAN_NAME>
Generated at: <timestamp>
TaskId: <TASK_ID>

## Tech-doc summary
### [doc_id] <document title>
- **URL**: https://docs.example.com/page/<id>
- **Core interfaces**: <interface list>
- **Business rules**:
  1. <rule 1: condition → behavior>
  2. <rule 2: condition → behavior>
- **Degrade strategy**: <switch name> = <default>, <degrade behavior>
- **Data flow**: <input> → <process> → <output>
- **Boundary conditions**: <boundary list>
- **Config dependencies**: <config-item list>

## Requirement-doc summary
(same format)

## Test-case summary
### [case_id] <case title>
- **Preconditions**: <conditions>
- **Steps**: <steps>
- **Expected result**: <result>
- **Related methods**: <methodName>

## Business-rule list (for Phase 2 item-by-item compare)
| # | Rule description | Source | Related code file/method |
|---|---|---|---|
| R1 | <rule> | tech_doc/<id> | <ClassName#method> |
```

### Register documents / cases into content.json

```bash
# Record the summary file path
node "$SKILL_SCRIPT" set-doc-summary \
  --task-id $TASK_ID --path "$DOC_SUMMARY_PATH"

# Register tech docs one by one (--doc-json takes a full JSON object)
node "$SKILL_SCRIPT" add-document \
  --task-id $TASK_ID --doc-type techDocs \
  --doc-json '{"contentId":"123","title":"API design doc","url":"https://docs.example.com/page/123","fetchMethod":"doc-provider","coreInterfaces":"OrderService#createOrder","businessRules":"Allow order only when amount>0","degradeStrategies":"When the switch is off, take the fallback path","dataFlows":"request→validate→persist→return","boundaryConditions":"amount=0 boundary","configDependencies":"config:order_switch","fetchStatus":"success"}'

# Register a test case (--case-json takes a full JSON object)
node "$SKILL_SCRIPT" add-test-case \
  --task-id $TASK_ID \
  --case-json '{"id":"<case ID>","title":"<case title>","preCondition":"<preconditions>","steps":"1.<step 1> 2.<step 2>","expectedResult":"<expected result>","relatedMethods":["<class>#<method>"]}'
```

### Degrade handling

| Scene | Handling |
|---|---|
| doc-provider auth failed | Degrade to doc-search |
| doc-search no results | Degrade to web_fetch |
| All failed | DOC_SUMMARY.md records `[FAILED] <url> - <reason>` |
| Test-case fetch failed | HAS_CASES degrades to false |

---

## Step 1.8: write the detection plan into content.json

```bash
for item in $DETECTION_PLAN; do
  ITEM_JSON=$(cat <<-EOF
  {
    "className": "$item.className",
    "methodName": "$item.methodName",
    "strategyCode": $item.strategyCode,
    "parentBatchId": $item.parentBatchId,
    "processId": ${item.processId:-null},
    "batchId": ${item.batchId:-null},
    "filePath": "$item.filePath",
    "docRelevance": "$item.docRelevance",
    "caseRelevance": "$item.caseRelevance",
    "source": "$item.source"
  }
EOF
  )
  node "$SKILL_SCRIPT" add-detection-plan-item --task-id $TASK_ID --item-json "$ITEM_JSON"
done

node "$SKILL_SCRIPT" content-summary --task-id $TASK_ID
```

---

## Multi-service orchestration model

```
Main Agent (orchestrator)
  ├── Phase 1: unified prep (all services git clone + rule fetch in parallel)
  ├── Phase 2: parallel detection
  │     ├── Sub-agents S1~Sn: per-service AST(s8) scan
  │     └── Sub-agent G: cross-service business detection (strategy=11)
  └── Phase 3: main Agent converge
```

Degrade: single service does not enable orchestration; a service whose clone failed is not detected; if a sub-agent times out >30min the main Agent takes over.

---

## Resume from a checkpoint

```bash
node "$SKILL_SCRIPT" show-local-progress --task-id $TASK_ID
node "$SKILL_SCRIPT" get-pending --batch-id $BATCH_ID --skip-local-done
```

Drop already-done items and continue detection on the rest.
