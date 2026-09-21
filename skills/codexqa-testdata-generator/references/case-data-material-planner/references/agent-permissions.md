# agent-permissions

> Authoritative basis for `merge_patch.ts --validate`. Any change to Agent write permissions must update this file and the `AGENT_WRITE_PERMISSIONS` dictionary in the script together.

## Write-permission table

| Agent | targetType | Fields allowed to write |
|---|---|---|
| `knowledge-build` | `meta` | `businessContext` (written as a manifest root-level field) |
| `parse-case` | `bulk` | `entities` / `actions` (full-array replace) |
| `search-data-tool` | `entity` | `toolBinding` (backward-compatible with old patches) |
| `search-action-tool` | `action` | `toolBinding` / `paramsFromEntities` / `paramsFromGenerators` / `paramsFromPriorActions` (backward-compatible with old patches) |
| `invoke-data` | `entity` | `fields` / `entityStatus` / `dataConfidence` / `failReason` (backward-compatible with old patches) |
| `bind-action` | `action` | `filledCmd` / `cmdStatus` / `cmdConfidence` / `failReason` (backward-compatible with old patches) |
| `verify-data` | `entity` | `entityStatus` / `dataConfidence` / `verifyNote` / `failReason` (backward-compatible with old patches) |
| `verify-action` | `action` | `cmdConfidence` / `verifyNote` / `failReason` / `cmdStatus` (backward-compatible with old patches) |
| `data-pipeline` | `entity` | retired (kept for dirty-disk patches) |
| `action-pipeline` | `action` | retired (kept for dirty-disk patches) |
| `select-tool` | `entity` / `action` | `toolBinding` only |
| `writeback` | `entity` / `action` | `writeStatus` / `failReason` (now written by `slot_render.ts`) |

## Value-level constraints

| Field | Legal values |
|---|---|
| `entityStatus` | `null` / `"building"` / `"unverified"` / `"verified"` / `"verify-failed"` / `"failed"` / `"missing-dependency"` |
| `cmdStatus` | `null` / `"filled"` / `"missing-param"` / `"gen-failed"` / `"manual"` |
| `dataConfidence` / `cmdConfidence` | `null` or a float in `[0.0, 1.0]` |
| `toolBinding.toolType` | `null` / `"tool"` / `"skill"` / `"script"` / `"reuse"` / `"api-setup"` |
| `failReason` | When non-empty, must start with `[capability-mismatch]` / `[exec-failed]` / `[dep-blocked]` |

## Privilege violations

When `merge_patch.ts --validate` detects a privilege violation:
1. That patch is not merged (skipped)
2. Privilege-violation details are written to stderr
3. exit code = 1
4. After a non-zero exit, the host discards the patch and records a warning. Only knowledge-build / parse-case / select-tool still write patches.
