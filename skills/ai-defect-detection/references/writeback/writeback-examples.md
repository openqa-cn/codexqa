# Writeback Python code examples

> This file contains complete writeback code examples for the Agent to consult when it needs an implementation reference.
> On the first writeback, read example 1 in full; later look up the matching strategy example as needed.

---

## 🎯 Complete writeback Python examples

### Example 1: batch bugStatus=2 writeback script (generic)


```python
import sys, json
sys.path.insert(0, '<SKILL_SCRIPT_DIR>')  # defect-detection directory
from open_platform import batch_update_process
from open_auth import load_token
from open_state import register_code_read, register_repo_clone
from open_store import ContentStore

load_token()

# ════════ Config ════════
TASK_ID = <task_id>
BATCH_ID = <batch_id>
AST_RULE_COUNT = <N>  # AST rule count from get-rules

# 🔴 Do not hand-fill or assemble paths with globals like GIT_URL/BRANCH/COMMIT_ID/FILE_PREFIX!
#    filePath and git info are always read from the local authoritative map (plan filePath + meta.services git).
#    This is the root fix for "gitUrl and filePath often mapped wrong on writeback".
store = ContentStore(TASK_ID)

# ════════ Build writeback items ════════
items = []
for class_name, method_name, strategy_code, thinking in METHODS_TO_WRITE:
    # ✅ Single-point resolve of the authoritative map: className(+method+strategy) → filePath/git/branch/commitId
    #    Equivalent CLI: node open_detect.ts resolve-writeback-context \
    #              --task-id TASK_ID --class-name <class> --method-name <m> --strategy-code <s>
    ctx = store.resolve_writeback_context(class_name, method_name, strategy_code)
    if not ctx["resolved"]:
        # plan has no filePath or services has no git → do not guess! Complete the plan first (set-plan-file-path)
        # / confirm the service is registered (submit-git), or the mapping will be wrong.
        print(f"⚠️ Cannot resolve authoritative map, skip: {class_name}#{method_name}（source={ctx['source']}）")
        continue
    file_path = ctx["filePath"]
    file_codes_item = ctx["fileCodesItem"]  # already has the correct filePath/git/branch/commitId

    # Pre-register repo clone (repo-clone gate / validation rule 19): git/branch/commitId also come from the authoritative map
    register_repo_clone(
        task_id=TASK_ID, batch_id=ctx["parentBatchId"] or BATCH_ID,
        git_url=ctx["gitUrl"], local_dir=ctx["localDir"],
        branch=ctx["branch"], commit_id=ctx["commitId"],
    )

    # Register code read (required for the code-read gate / validation rule 14 when strategy≠8)
    if strategy_code != 8:
        register_code_read(task_id=TASK_ID, batch_id=ctx["parentBatchId"] or BATCH_ID,
                          class_name=class_name, file_path=file_path)

    item = {
        "parentBatchId": ctx["parentBatchId"] or BATCH_ID,
        "className": class_name,
        "methodName": method_name,
        "strategyCode": strategy_code,
        "bugStatus": 2,
        "thinking": thinking,  # ≥30 chars; cite method name / line numbers
        "content": "No defect in this code",  # 🔒 no-defect content is this fixed sentence; do not rewrite
        "fileCodes": [file_codes_item],
        "processSteps": [{
            "step": "first_round_detection",
            "stepKey": "first_round_detection",
            "question": f"Analyze whether {class_name.split('/')[-1]}.{method_name} has a defect",
            "conclusion": thinking,  # same as thinking or more detailed
            "hasBug": False,
            "stepStatus": "executed"
        }]
    }

    # Strategy-specific fields
    if strategy_code == 8:
        item["astRuleCount"] = AST_RULE_COUNT
    if strategy_code in (6, 11):
        item["processSteps"][0]["referencedSources"] = [{
            "sourceType": "tech_doc",  # or prd_doc / test_case
            "sourceId": "<doc/case ID>",
            "sourceName": "<doc/case name>"
        }]

    items.append(item)

# ════════ Submit ════════
result = batch_update_process(items)
print(json.dumps(result, indent=2, ensure_ascii=False))
```

### Example 2: writeback with a defect (by strategy)

> ⚠️ **The same method may be covered by multiple strategies**. The same `className+methodName` is **written back as independent detection items** per `strategyCode` (8, 11). Each thinking/content is built independently. Never reuse a conclusion across strategies.
>
> 🔴 **Authoritative source of fileCodes (root fix for mapping mismatches)**: in the examples below, `filePath`/`git`/`branch`/`commitId` in `fileCodes` **must not be hand-filled, path-assembled, or taken from globals**. Always take them from the authoritative map as in example 1:
> ```python
> ctx = store.resolve_writeback_context(class_name, method_name, strategy_code)
> file_codes_item = ctx["fileCodesItem"]   # already has the correct filePath/git/branch/commitId
> ```
> `GIT_URL` / `BRANCH` / `COMMIT_ID` in the examples below are only field-structure placeholders. On real writeback replace them with `ctx["gitUrl"]` / `ctx["branch"]` / `ctx["commitId"]`, and use `ctx["filePath"]` for `filePath`.
> Or just use `update-process --task-id <id>` / `batch-update-process --task-id <id>`; the command will auto-validate and correct the fileCodes you pass using the local authoritative map.

#### Example 2a: strategy=11 (business detection: code logic + chain + business compare)

> The Agent decides depth by method difficulty: simple methods focus on code logic; complex methods add the chain + business compare.

```python
item_biz = {
    "parentBatchId": BATCH_ID,
    "className": "com/example/xxx/MyService",
    "methodName": "targetMethod",
    "strategyCode": 11,
    "bugStatus": 6,
    "tagId": <pick from $VALID_TAG_IDS>,
    "confidenceScore": 0.85,
    "thinking": (
        "Analyze MyService.targetMethod (lines 45-78):\n"
        "Line 52 obj.getList() may return null (upstream RPC returns null on timeout),\n"
        "but line 55 calls list.size() with no null check.\n"
        "Trace the Call chain: upstream ServiceA.queryData() → MyService.targetMethod() → line 55 NPE risk.\n"
        "This method was added in this change (diff +45~+78); it is a newly introduced defect."
    ),
    "content": (
        "## Defect: targetMethod null-pointer risk\n\n"
        "Lines: 52-55\n\n"
        "Problem description: line 52 obj.getList() returns null when the RPC times out, "
        "line 55 calling list.size() will throw NullPointerException\n\n"
        "Problem tags: [Parameter/null check][This change]\n\n"
        "Impact scope: affects every upstream entry that calls targetMethod\n\n"
        "Affected business: the product-list query API returns 500 when the RPC times out\n\n"
        "Reproduction path: call queryProducts → ServiceA RPC timeout → "
        "targetMethod line 55 NPE → API error\n\n"
        "Trigger conditions:\n1. ServiceA RPC response times out\n2. Returns null instead of an empty list\n\n"
        "Expected vs actual:\n"
        "- Expected: on RPC timeout return an empty list or a degraded result\n"
        "- Actual: NPE causes an API exception\n\n"
        "Fix suggestion: add a null check at line 52\n\n"
        "```java\n"
        "List<Item> list = obj.getList();\n"
        "if (list == null) {\n"
        "    list = Collections.emptyList();\n"
        "}\n"
        "```"
    ),
    "fileCodes": [{
        "filePath": "src/main/java/com/example/xxx/MyService.java",
        "methodNames": ["targetMethod"],
        "git": GIT_URL,
        "branch": BRANCH,
        "commitId": COMMIT_ID
    }],
    "processSteps": [{
        "step": "first_round_detection",
        "stepKey": "first_round_detection",
        "question": "Analyze whether MyService.targetMethod has NPE or other safety defects",
        "conclusion": "Found NPE risk: line 52 getList() may return null; line 55 has no null check",
        "hasBug": True,
        "stepStatus": "executed"
    }]
}
```

#### Example 2b: strategy=8 (AST-hit writeback)

> LLM verification conclusion after an AST scan hit. Must include `astRuleCount` and `hitRuleIds`; `processSteps` must include `exclusion_rule_filter` and `llm_validation`.

```python
item_ast = {
    "parentBatchId": BATCH_ID,
    "className": "com/example/xxx/MyService",
    "methodName": "targetMethod",
    "strategyCode": 8,
    "bugStatus": 6,
    "tagId": <pick from $VALID_TAG_IDS>,
    "confidenceScore": 0.9,
    "astRuleCount": 39,
    "hitRuleIds": ["npe-null-deref", "unsafe-deserialize"],
    "thinking": (
        "AST scan hit 2 rules: object dereferenced without a null check, "
        "deserialization without a class whitelist.\n"
        "Exclusion-rule filter: hits are not on the exclusion list.\n"
        "Recheck confirmed: line 55 list.size() indeed has no null check, and line 68 "
        "objectMapper.readValue() does not restrict types — remote code execution risk."
    ),
    "content": (
        "## Defect: targetMethod has dual NPE + unsafe-deserialization risk\n\n"
        "Lines: 55, 68\n\n"
        "Problem description:\n"
        "1. Line 55: list.size() with no null check; NPE when the RPC times out.\n"
        "2. Line 68: objectMapper.readValue(json, Object.class) has no class whitelist; "
        "an attacker may craft a malicious payload and trigger remote code execution.\n\n"
        "Problem tags: [Parameter/null check][Remote code execution][This change]\n\n"
        "Impact scope: affects every upstream entry that calls targetMethod\n\n"
        "Affected business: product-list query returns 500 on RPC timeout; the deserialize API may be exploited\n\n"
        "Reproduction path:\n"
        "- NPE: call queryProducts → ServiceA RPC timeout → targetMethod line 55 NPE\n"
        "- Deserialization: forge a JSON payload → line 68 readValue → load a malicious class\n\n"
        "Trigger conditions:\n1. ServiceA RPC timeout returns null\n2. Unvalidated JSON is passed in from outside\n\n"
        "Expected vs actual:\n"
        "- Expected: nulls are guarded; deserialization has a class whitelist\n"
        "- Actual: NPE causes an API exception; unrestricted deserialization can RCE\n\n"
        "Fix suggestion:\n"
        "1. Before line 55 add `if (list == null) list = Collections.emptyList();`\n"
        "2. Change line 68 to `readValue(json, new TypeReference<SafeDTO>(){})` or enable activateDefaultTyping\n\n"
        "```java\n"
        "// Fix 1: null guard\n"
        "List<Item> list = obj.getList();\n"
        "if (list == null) { list = Collections.emptyList(); }\n\n"
        "// Fix 2: restrict deserialization type\n"
        "SafeDTO dto = objectMapper.readValue(json, new TypeReference<SafeDTO>(){});\n"
        "```"
    ),
    "fileCodes": [{
        "filePath": "src/main/java/com/example/xxx/MyService.java",
        "methodNames": ["targetMethod"],
        "git": GIT_URL,
        "branch": BRANCH,
        "commitId": COMMIT_ID
    }],
    "processSteps": [
        {
            "step": "exclusion_rule_filter",
            "stepKey": "exclusion_rule_filter",
            "question": "Check whether hit rules are on the exclusion list",
            "conclusion": "Hit null-deref and unsafe-deserialization; "
                        "neither matched an exclusion rule; enter recheck",
            "hasBug": True,
            "stepStatus": "executed"
        },
        {
            "step": "llm_validation",
            "stepKey": "llm_validation",
            "question": "Manually recheck AST hits and confirm whether they are real defects",
            "conclusion": "Confirmed real defects: line 55 NPE + line 68 unsafe deserialization",
            "hasBug": True,
            "stepStatus": "executed"
        }
    ]
}
```

#### Example 2c: strategy=11 (Call-chain defect)

> Call-chain view: must include the full chain path (with line numbers) and the involved class code.

```python
item_biz = {
    "parentBatchId": BATCH_ID,
    "className": "com/example/xxx/MyService",
    "methodName": "targetMethod",
    "strategyCode": 11,
    "bugStatus": 6,
    "tagId": <pick from $VALID_TAG_IDS>,
    "confidenceScore": 0.82,
    "thinking": (
        "Call-chain analysis:\n"
        "Controller.queryProducts(L24) → MyService.targetMethod(L52) → "
        "RpcClient.callServiceA(L88) → ServiceA.queryData(L45)\n"
        "Problem node: RpcClient.callServiceA returns null on timeout; MyService.targetMethod "
        "line 55 dereferences without a null check.\n"
        "Propagation: null travels back along the chain to the Controller and the API returns 500."
    ),
    "content": (
        "## Defect: queryProducts Call-chain null-pointer propagation\n\n"
        "Lines: 24(Controller) → 55(MyService) → 88(RpcClient)\n\n"
        "Problem description: RpcClient.callServiceA returns null on timeout; "
        "MyService.targetMethod line 55 dereferences without a null check; "
        "the null travels back along the Call chain to the Controller and the API fails\n\n"
        "Problem tags: [Parameter/null check][Call-chain propagation][This change]\n\n"
        "Impact scope: affects every caller of the queryProducts API\n\n"
        "Affected business: product-list query returns 500 when the RPC times out\n\n"
        "Reproduction path:\n"
        "User request → Controller.queryProducts(L24) → MyService.targetMethod(L52) "
        "→ RpcClient.callServiceA(L88) → ServiceA.queryData(L45) times out and returns null "
        "→ targetMethod line 55 NPE → API 500\n\n"
        "Trigger conditions:\n1. ServiceA RPC response times out\n2. The returned null is not caught on the chain\n\n"
        "Expected vs actual:\n"
        "- Expected: a mid-chain node null-guards or degrades; the Controller returns degraded data\n"
        "- Actual: NPE is thrown in targetMethod and the API returns 500\n\n"
        "Fix suggestion: add a null guard at the RpcClient return or the MyService entry\n\n"
        "```java\n"
        "// MyService.targetMethod fix\n"
        "Result result = rpcClient.callServiceA(param);\n"
        "if (result == null || result.getList() == null) {\n"
        "    return Result.success(Collections.emptyList());\n"
        "}\n"
        "```"
    ),
    "fileCodes": [
        {
            "filePath": "src/main/java/com/example/xxx/Controller.java",
            "methodNames": ["queryProducts"],
            "git": GIT_URL,
            "branch": BRANCH,
            "commitId": COMMIT_ID
        },
        {
            "filePath": "src/main/java/com/example/xxx/MyService.java",
            "methodNames": ["targetMethod"],
            "git": GIT_URL,
            "branch": BRANCH,
            "commitId": COMMIT_ID
        },
        {
            "filePath": "src/main/java/com/example/xxx/RpcClient.java",
            "methodNames": ["callServiceA"],
            "git": GIT_URL,
            "branch": BRANCH,
            "commitId": COMMIT_ID
        }
    ],
    "processSteps": [{
        "step": "first_round_detection",
        "stepKey": "first_round_detection",
        "question": "Analyze whether the queryProducts → targetMethod → callServiceA Call chain has defect propagation",
        "conclusion": "Chain defect: RpcClient returns null on timeout; targetMethod has no null guard; NPE propagates along the chain",
        "hasBug": True,
        "stepStatus": "executed"
    }]
}
```

### Example 3: cross-repo dependency-class degrade writeback

```python
item = {
    "parentBatchId": BATCH_ID,
    "className": "com/example/external/ThirdPartyService",
    "methodName": "externalMethod",
    "strategyCode": 3,
    "bugStatus": 2,
    "thinking": (
        "This class (com.example.external.ThirdPartyService) is in an external dependency package; "
        "the source-repo URL cannot be determined (not a service linked to this iteration); cannot clone source for analysis. "
        "Package-path analysis: com.example.external is not this service's package (com.example.xxx), "
        "and no matching .java file was found in the local repo. Skip this class; mark as no defect."
    ),
    "content": "No defect in this code",
    "fileCodes": [{
        "filePath": "src/main/java/com/example/external/ThirdPartyService.java",
        "git": GIT_URL,  # fill this service's git (so the repo-clone gate passes)
        "branch": BRANCH,
        "commitId": COMMIT_ID
    }],
    "processSteps": [{
        "step": "first_round_detection",
        "stepKey": "first_round_detection",
        "stepStatus": "skipped",
        "hasBug": False,
        "conclusion": "Cross-repo dependency class; source unreachable; skip detection",
        "question": "Analyze whether ThirdPartyService.externalMethod has a defect"
    }]
}
```

### Example 3-FE: frontend cross-repo dependency degrade writeback

> **When to use**: frontend projects that hit an npm package or monorepo sub-package whose source cannot be obtained.
> Difference from template I (Java cross-repo): className uses the source relative path; fileCodes file_path has a `.ts`/`.vue` extension; thinking marks the dependency type as `npm:<package>` or `monorepo:<sub-package path>`.

```python
item = {
    "parentBatchId": BATCH_ID,
    "className": "node_modules/lodash-es/lodash",
    "methodName": "debounce",
    "strategyCode": 3,
    "bugStatus": 2,
    "thinking": (
        "This method is a function in the external npm dependency lodash-es; "
        "source lives under node_modules/ and is not this repo's business code. "
        "Dependency type: npm:lodash-es; cannot obtain a source repo for analysis. "
        "Degrade: skip this function; mark as no defect."
    ),
    "content": "No defect in this code",
    "fileCodes": [{
        "filePath": "node_modules/lodash-es/debounce.js",
        "git": GIT_URL,  # fill this service's git (so the repo-clone gate passes)
        "branch": BRANCH,
        "commitId": COMMIT_ID
    }],
    "processSteps": [{
        "step": "first_round_detection",
        "stepKey": "first_round_detection",
        "stepStatus": "skipped",
        "hasBug": False,
        "conclusion": "Frontend cross-repo dependency (npm:lodash-es); source unreachable; skip detection",
        "question": "Analyze whether lodash.debounce has a defect"
    }]
}

# ── monorepo sub-package example ──
item_monorepo = {
    "parentBatchId": BATCH_ID,
    "className": "packages/shared-utils/src/format",
    "methodName": "formatDate",
    "strategyCode": 3,
    "bugStatus": 2,
    "thinking": (
        "This method belongs to monorepo sub-package packages/shared-utils; "
        "its source-repo URL differs from the main project (the sub-package may be published independently). "
        "Dependency type: monorepo:packages/shared-utils; cannot obtain the sub-package source. "
        "Degrade: skip this function; mark as no defect."
    ),
    "content": "No defect in this code",
    "fileCodes": [{
        "filePath": "packages/shared-utils/src/format.ts",
        "git": GIT_URL,  # fill this service's git (so the repo-clone gate passes)
        "branch": BRANCH,
        "commitId": COMMIT_ID
    }],
    "processSteps": [{
        "step": "first_round_detection",
        "stepKey": "first_round_detection",
        "stepStatus": "skipped",
        "hasBug": False,
        "conclusion": "Frontend cross-repo dependency (monorepo:packages/shared-utils); source unreachable; skip detection",
        "question": "Analyze whether formatDate has a defect"
    }]
}
```

### Example 4: finalize-rank writeback

```python
from open_platform import finalize_rank

# ══════ Scene: MyService.targetMethod analyzed as a real defect (bugStatus=6) ══════
rank_result = finalize_rank(
    batch_id=962140,
    class_name="com/example/xxx/MyService",
    method_name="targetMethod",
    bug_status=6,
    process_ids="12345,12346",  # processIds of multiple strategies on the same method, comma-separated
    content=(
        "Defect: targetMethod null-pointer risk\n\n"
        "Lines: 52-55\n\n"
        "Problem description: line 52 obj.getList() returns null when the RPC times out, "
        "line 55 calling list.size() will throw NullPointerException\n\n"
        "Problem tags: [Parameter/null check][This change]\n\n"
        "Impact scope: affects every upstream entry that calls targetMethod\n\n"
        "Affected business: the product-list query API returns 500 when the RPC times out\n\n"
        "Reproduction path: call queryProducts → ServiceA RPC timeout → "
        "targetMethod line 55 NPE → API error\n\n"
        "Trigger conditions:\n"
        "1. ServiceA RPC response times out\n"
        "2. Returns null instead of an empty list\n\n"
        "Expected vs actual:\n"
        "- Expected: on RPC timeout return an empty list or a degraded result\n"
        "- Actual: NPE causes an API exception\n\n"
        "Fix suggestion: add a null check at line 52\n\n"
        "```java\n"
        "List<Item> list = obj.getList();\n"
        "if (list == null) {\n"
        "    list = Collections.emptyList();\n"
        "}\n"
        "```"
    )
)

print(rank_result)
# Return example: {"code": 0, "msg": "success", "data": {"rankId": 888123}}
# rankId is written back into content.json ranks[].rankId
```

**finalize-rank content notes:**
- Start in plain text (no `## `)
- Line-number format: `Lines: 52-55` (plain text, no bold)
- Tag format: `[Parameter/null check][This change]`
- Keep `Test case ID:[ID]<title>` citations when present

---

### Example 5: batch writeback with content_store persistence

```python
import sys
sys.path.insert(0, '<SKILL_SCRIPT_DIR>')
from open_platform import batch_update_process
from open_store import ContentStore
from open_auth import load_token
from open_state import register_code_read, register_repo_clone

load_token()

TASK_ID    = 987654
BATCH_ID   = 962140
GIT_URL    = "git@github.com:acme/order-service.git"
BRANCH     = "feature/coupon-transfer"
COMMIT_ID  = "abc123def456"
AST_COUNT  = 39
store = ContentStore(TASK_ID)                   # load persisted context

# ══════ Get the detection plan from content.json (avoid assembling mappings by hand) ══════
plan_items = [item for item in store.data["detectionPlan"]
              if item.get("status") != "written"]

items_to_write = []
for item in plan_items:
    class_name    = item["className"]
    method_name   = item["methodName"]
    strategy_code = item["strategyCode"]
    file_path     = item.get("filePath", f"src/main/java/{class_name}.java")

    # Pre-register (code-read gate / validation rule 14)
    if strategy_code != 8:
        register_code_read(TASK_ID, BATCH_ID, class_name, file_path,
                           code_snippet="pre-registered")

    # Build writeback (this example is bugStatus=2; after real analysis fill 2/6/7)
    witem = {
        "parentBatchId": BATCH_ID,
        "className": class_name,
        "methodName": method_name,
        "strategyCode": strategy_code,
        "bugStatus": 2,
        "thinking": f"Analyze {class_name.split('/')[-1]}.{method_name}: code review found no safety defect.",
        "content": "No defect in this code",
        "fileCodes": [{
            "filePath": file_path,
            "methodNames": [method_name],
            "git": GIT_URL,
            "branch": BRANCH,
            "commitId": COMMIT_ID
        }],
        "processSteps": [{
            "step": "first_round_detection",
            "stepKey": "first_round_detection",
            "stepStatus": "executed",
            "hasBug": False,
            "conclusion": f"{class_name.split('/')[-1]}.{method_name} has no defect",
            "question": f"Analyze whether {class_name.split('/')[-1]}.{method_name} has a defect"
        }]
    }

    if strategy_code == 8:
        witem["astRuleCount"] = AST_COUNT
    if strategy_code in (6, 11):
        witem["processSteps"][0]["referencedSources"] = [{
            "sourceType": "test_case",
            "sourceId": "<case ID>",
            "sourceName": "<case title>"
        }]

    items_to_write.append(witem)

# ══════ Batch submit ══════
result = batch_update_process(items_to_write)
print(json.dumps(result, indent=2, ensure_ascii=False))

# ══════ Persist writeback records ══════
for witem in items_to_write:
    store.record_process_writeback({
        "parentBatchId": witem["parentBatchId"],
        "className": witem["className"],
        "methodName": witem["methodName"],
        "strategyCode": witem["strategyCode"],
        "bugStatus": witem["bugStatus"],
        "hasExclusion": False,
        "writtenAt": datetime.datetime.now().isoformat(),
        "writeMethod": "batch",
        "errorInfo": None
    })
    store.update_plan_status(
        witem["className"], witem["methodName"], witem["strategyCode"], "written"
    )

store.save()  # atomic write to content.json
```

---

## 🔧 Common writeback-failure troubleshooting

| Failure | Root cause | Fix |
|---|---|---|
| `fileCodes[0] cross-repo git filelist fetch failed` (code=1000) | Wrong git URL or filePath does not exist in that repo | 1. Confirm the serviceKey→git map (from the repo id returned by `status`); 2. `find $LOCAL_DIR -name "*.java"` to confirm the file prefix |
| `thinking too short` hard intercept | thinking < 30 chars | Expand thinking; cite concrete code / line numbers / variable names |
| `processSteps[].conclusion is empty` hard intercept | conclusion is an empty string | Fill conclusion with the actual analysis conclusion |
| `repo-clone gate: clone not registered` | register-repo-clone was not called | Call register-repo-clone first, then retry |
| `code-read gate: code not read` | strategy≠8 and register-code-read was not called | Call register-code-read first, then retry |
| `astRuleCount must be >0` | strategy=8 but astRuleCount was not passed | Take the value from run-ast-scan result ruleCount |
| `referencedSources missing` | strategy=11 with linked test cases/docs but processSteps has no referencedSources | Add at least one sourceType+sourceId+sourceName |
| strategy=11 thinking too short | Business-detection thinking < 80 chars | Expand thinking; write the full Call chain A#m → B#m → C#m |
| strategy=11 business-compare thinking too short | Has linked test cases/docs but business-compare thinking < 100 chars | Expand thinking; cite business rules / test-case content |
| `content must include "Lines:"` | bugStatus=6/7 but content has no line numbers | Add `Lines:X-Y` to content |
| `tagId illegal` | An invalid tagId was passed | Re-pick from `$VALID_TAG_IDS[]` |

---

## 🗺️ How to confirm the serviceKey → git repo map

serviceKey and the git repo name often disagree. Ways to get the mapping:

```bash
# Method 1 (recommended): from task status
node "$SKILL_SCRIPT" status --task-id $TASK_ID
# Inspect the returned repo id / git URL

# Method 2: from plan-detail services
node "$SKILL_SCRIPT" get-plan-info --plan-id $TEST_PLAN_ID
# Inspect data.services[].git → full git URL in SSH form

# Method 3 (verification): after clone, confirm the file tree
ls $LOCAL_DIR/*/src/main/java/  # multi-module projects need the correct module prefix
find $LOCAL_DIR -name "*.java" | head -5  # confirm the file-path format
```

**Confirming the filePath prefix on multi-module projects**:
```bash
# If find shows paths containing module names such as "xxx-server/", "xxx-starter/":
# → filePath must include that module prefix
# Example: checkout-server/src/main/java/com/example/...
# Not: src/main/java/com/example/...
```
