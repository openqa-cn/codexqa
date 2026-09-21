# param-source-spec

> Authoritative definition of action parameter sources. `parse-case` / `bind_action.ts` / `slot_render.ts` / `verify_tool_input_list.ts` all follow this document. Where older wording says `action-pipeline`, that stage is `bind_action.ts`.

## Three parameter sources

Every `cmdTemplate` placeholder `__paramName__` on an action must be covered by **exactly one** of the following three kinds of entry:

| Source | Field | Semantics | Form in filledCmd |
|---|---|---|---|
| entity fields | `paramsFromEntities[]` | Field values already constructed by a prior entity (static) | **literal value** |
| runtime generation | `paramsFromGenerators[]` | Generated ad hoc by the shell at execution time | **inline shell command substitution `$(...)`** |
| upstream action output | `paramsFromPriorActions[]` | Take a field produced at runtime by a previous action in this case | **human-readable placeholder `<<A01.orderId>>`** |

The three are **mutually exclusive**: a given `paramName` may belong to only one kind; duplicate registration → `bind_action.ts` marks `gen-failed`.

---

## Design rationale: why priorAction uses "placeholder + note line" instead of a shell variable

tool-registry (and most business tools) **does not provide an output-schema query API**, so the planner cannot reliably generate a jq expression to extract fields from the response at bind time. The earlier approach of pre-embedding `$_CASE_A01_orderId` plus `jq -r '.data.orderId // empty'` as capture was **blind guessing**: once the real response structure drifted from the `.data.*` convention, `// empty` silently swallowed the error, downstream steps continued with an empty string, and the user only hit the wall at real execution time.

After switching to **human-readable placeholders + note lines**:
- the planner only does what it knows: declare the dependency (A02 uses A01's orderId)
- the execution side (LLM agent or human) can see the **actual response** from the previous step and extract the field themselves — a capability the execution side already has
- the placeholder `<<A01.orderId>>` is clearly visible in the cell and will not be treated as bash that can be run as-is

---

## `paramsFromGenerators` whitelist

**Only the following 4 generators are allowed.** Any other name is illegal.

| generator | Description | args | Inline rendering (action-pipeline replaces `__param__` directly) |
|---|---|---|---|
| `RANDOM_ID` | Numeric random ID (order number, serial number) | `length` (int, default 15) | `$(date +%s)$(printf '%0<L>d' $((RANDOM*RANDOM%10**<L>)))`, where `<L>=max(length-10, 4)` |
| `UUID` | Standard UUID v4 | — | `$(uuidgen)` |
| `TIMESTAMP_MS` | Millisecond timestamp | — | `$(date +%s%3N 2>/dev/null \|\| node -e 'console.log(Date.now())')` |
| `DATE_OFFSET` | Date relative to today (YYYY-MM-DD) | `offsetDays` (int, may be negative) | `$(date -v+<offsetDays>d +%Y-%m-%d 2>/dev/null \|\| date -d "+<offsetDays> days" +%Y-%m-%d)` |

**Revoked**: `SEQ` (global counter) — an inline form cannot keep monotonic state across cells; use `RANDOM_ID` instead when needed.

### Embedding inside a JSON string (required reading)

Placeholders in cmdTemplate often sit inside a JSON string wrapped by the tool's outer single quotes, such as `--input-list '[...]'`. Shell does not expand `$(...)` inside single quotes, so action-pipeline **must break the single quotes** when substituting:

cmdTemplate:
```
node "$SKILL_DIR/scripts/adapters/cli.ts" tool_registry.execute 'xx' '{"orderSn":"__orderSn__"}'
```

paramsFromGenerators:
```jsonc
[{ "paramName": "orderSn", "generator": "RANDOM_ID", "args": {"length": 15} }]
```

filledCmd:
```
node "$SKILL_DIR/scripts/adapters/cli.ts" tool_registry.execute 'xx' '{"orderSn":"'"$(date +%s)$(printf '%05d' $((RANDOM*RANDOM%10**5)))"'"}'
```

Replacement rule: `"__paramName__"` → `"'"<inline fragment>"'"` (close the single quote + wrap `$(...)` in double quotes + reopen the single quote).

If the cmdTemplate as a whole uses double quotes or no quotes (rare), replace with the inline fragment directly.

---

## `paramsFromPriorActions` contract

### Fields

```jsonc
{
  "paramName": "prePaidOrderId",
  "sourceActionId": "A02",
  "sourceOutputField": "orderId"
}
```

### Reference constraints

1. `sourceActionId` must be an action that **already exists** in the same manifest
2. The source action's `stepIdx` must be **strictly less than** the current action's `stepIdx` (no self-loops, no forward references)
3. The source action must pre-declare that field in `outputs[<sourceOutputField>]` (see the next section)

If any constraint fails → `lint_manifest.ts` verdict FAIL (suggestedAction: `rerun-action-pipeline`).

### Rendering

`action-pipeline` replaces `__<paramName>__` **directly** with a readable placeholder:

```
<<<sourceActionId>.<sourceOutputField>>>
```

Example: `__prePaidOrderId__` → `<<A02.orderId>>`.

The placeholder format must strictly match the regex `<<[A-Z][0-9]+\.[A-Za-z_][A-Za-z0-9_]*>>`.

**Do not break quotes for JSON embedding** (the placeholder itself is not shell syntax and will not be expanded; leaving it inside the JSON string is fine).

filledCmd example:
```
node "$SKILL_DIR/scripts/adapters/cli.ts" tool_registry.execute 'yy' '{"orderId":"<<A02.orderId>>"}'
```

### Execution-side convention

`slot_render.ts` appends a Markdown note line at the end of any cell that has `paramsFromPriorActions`, for example:

```markdown
> ⚠️ At execution time, replace `<<A02.orderId>>` with the order ID from step 2's response (A02.outputs.orderId: order ID generated by placing the order)
```

After reading the note, the execution side (LLM agent or human) extracts the field from the previous step's actual response, fills it in, then runs the command.

---

## Action `outputs` declaration

Any action referenced by a downstream step must pre-declare every output field that may be referenced in its own `outputs` field:

```jsonc
"outputs": {
  "orderId": {
    "description": "Order ID generated by placing the order",
    "hint": "Usually at path .data.orderId in the response (execution-side hint only, not a hard constraint)"
  }
}
```

- `description` (required): field semantics. slot_render appends it to the end of the note line so the execution side immediately knows what to look for
- `hint` (optional): an LLM path suggestion based on industry common sense; **not used by any automation logic**, hint for humans/agents only
- An action that is not referenced by any downstream action may omit `outputs` (leave `{}` or omit the field)

**The `extractJq` field has been removed** — the planner cannot generate it reliably, so it is better not to have it.

---

## Placeholder rules (coordinated with action-pipeline)

- The **only legal placeholder form** inside `cmdTemplate` is `__paramName__` (double underscores wrapping `[A-Za-z_][A-Za-z0-9_]*`)
- `cmdTemplate` **must not** contain any literal `${...}` / `$VAR` string (every runtime value must be registered under one of the three parameter sources)
- After action-pipeline rendering, `filledCmd` **may** contain:
  - `$(...)` (command substitution, including bash builtins such as `$RANDOM` / `$((...))` inside it)
  - `<<[A-Z][0-9]+\.[\w]+>>` (priorAction placeholder)
  - literal values (entity-fields render result)
- **Must not** contain: bare `${VAR}` / `$VAR` literal variables (outside the whitelist), unreplaced `__x__`, or the literals `"null"` / `"undefined"` / `"None"`

---

## Value legality (shared by action-pipeline / verify_tool_input_list)

Scan each value in the tool `--input-list` JSON.

**Preprocess before scanning**: first strip the contents of every `$(...)` and `$((...))` (these are legal shell syntax already registered by the planner), then apply the following reject rules to the remaining string:

| pattern | Meaning |
|---|---|
| regex `__\w+__` | Placeholder that action-pipeline did not finish replacing |
| regex `\$\{[^}]+\}` | Unregistered literal variable (typical: `${RANDOM}`) |
| regex `\$[A-Z_][A-Z0-9_]*` | Bare shell variable |
| empty-string value when `required=true` | Required field missing |
| literal `"null"` / `"undefined"` / `"None"` | Typical LLM hallucination |

**Allow**: `$(...)` command substitution (already stripped by preprocess), `<<[A-Z][0-9]+\.\w+>>` priorAction placeholder.

Any hit → `cmdStatus="gen-failed"`, `cmdConfidence=0.0`, `failReason="[exec-failed] unsafe value in input-list: <name>=<value>"`.
