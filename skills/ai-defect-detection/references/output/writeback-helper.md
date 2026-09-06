# Writeback helper data (written in Phase 1 / read in Phase 2)

> This file is generated after Phase 1 Step 1.6c and 1.6d, written to `$CONTENT_STORE/writeback-helper.json`.
> Read it once before Phase 2 writeback so the Agent does not keep hitting APIs; take required data from the local file.
> Every Phase 2 writeback `updateProcess` / `batch-update-process` should build the request body from this file.

---

## Generated JSON structure

```json
{
  "taskId": "<TASK_ID>",
  "generatedAt": "<timestamp>",
  "tagLookup": {
    "<tagId>": "<tagName>",
    "116": "Null pointer risk",
    "117": "Resource leak",
    ...
  },
  "fileCodeMap": [
    {
      "className": "com/example/order/service/OrderService",
      "fileCode": "fc_order_service_v2",
      "git": "git@github.com:acme/order.git",
      "branch": "feature/order-v2",
      "commitId": "a3f8c12d",
      "filePath": "src/main/java/com/example/order/service/OrderService.java",
      "localDir": "/tmp/defect/order-service/feature/order-v2"
    }
  ],
  "contentTemplates": {
    "T1_defect": {
      "prefix": "Defect:",
      "requiredFields": [
        "Problem tags: [tag name][This change/Pre-existing]",
        "Affected business:",
        "Reproduction path:",
        "Root cause:",
        "Lines:<startLine>-<endLine>"
      ],
      "forbidden": ["**", "##", "defect overview", "suggestion"]
    },
    "T2_nndefect": {
      "prefix": "Improvement:",
      "requiredFields": ["Problem tags: [tag name]", "Affected business:", "Lines:"],
      "forbidden": ["**", "##"]
    }
  },
  "rankTemplates": {
    "T1_blocking": {
      "mustInclude": ["Affected business:", "Reproduction path:", "Lines:"],
      "forbidden": ["##", "**", "defect overview", "suggestion"]
    },
    "T2_quality": {
      "mustInclude": ["Affected business:", "Lines:"],
      "forbidden": ["**", "##"]
    }
  }
}
```

---

## Phase 1 construction steps

### After Step 1.6c: build tagLookup

```bash
# Extract id→name map from get-tag-list result
node "$SKILL_SCRIPT" get-tag-list \
  | jq 'map({ (.id | tostring): .name }) | add' \
  > "$CONTENT_STORE/tags.json"
```

### After Step 1.5: build fileCodeMap

```bash
# Build from add-service-to-content return value or the local clone directory
# For each cloned service, enumerate all .java files under src/main/java/
node "$SKILL_SCRIPT" build-file-code-map \
  --task-id $TASK_ID \
  --services-json "$SERVICES_JSON" \
  --output "$CONTENT_STORE/file_code_map.json"
```

> In `fileCodeMap`, className uses slash format (e.g. `com/example/...`),
> matching the `className` returned by `get-pending`.

### After Step 1.8: merge into writeback-helper.json

```bash
node "$SKILL_SCRIPT" build-writeback-helper \
  --task-id $TASK_ID \
  --tag-lookup "$CONTENT_STORE/tags.json" \
  --file-code-map "$CONTENT_STORE/file_code_map.json" \
  --output "$CONTENT_STORE/writeback-helper.json"
```

---

## Phase 2 read pattern

```python
import json

with open("$CONTENT_STORE/writeback-helper.json") as f:
    helper = json.load(f)

# Look up the English name for a tagId on writeback
tag_name = helper["tagLookup"].get(str(tag_id), "Uncategorized")

# Find fileCode by className on writeback (authoritative source for resolve-writeback-context)
file_code_entry = next(
    (e for e in helper["fileCodeMap"]
     if e["className"] == class_name),
    None
)
if file_code_entry:
    git = file_code_entry["git"]
    file_path = file_code_entry["filePath"]
    local_dir = file_code_entry["localDir"]
```

---

## Coverage scenarios

| Error scenario | Prevention |
|---|---|
| Wrong tagId on writeback (platform rejects) | Look up from `tagLookup` only; do not guess |
| `fileCodes[].git` / `filePath` assembled wrong (platform rejects) | Read from `fileCodeMap` only; do not hand-write |
| Forgot the `Defect:` prefix in content (platform rejects) | Copy the format from `contentTemplates` |
| Line numbers wrapped in `**bold**` (platform rejects) | `contentTemplates` lists `forbidden`; filter accordingly |
| Forgot `Affected business:` / `Reproduction path:` (Hard rule 15/16) | `rankTemplates` lists `mustInclude` |
