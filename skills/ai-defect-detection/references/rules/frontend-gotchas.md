# Frontend project detection notes

> This file collects JS/TS/frontend-specific notes for the full defect-detection pipeline.
> When `content.json` `service[].language` is `javascript` or `typescript`, the Agent should read this file before entering Phase 2.
> Backend Java projects can ignore this file.

---

## 0. Phase 1 entry optimization (client plan when services is empty)

When the test plan's `services` field is empty, that usually means this is a **client (frontend) project plan**. Do not ask the user to provide the repo URL and branch name by hand. The Agent should:

1. **Automatically judge** that this is a client plan
2. **Automatically extract** the repo URL and the branch to detect from plan info
3. **Call** `node "$SKILL_SCRIPT" extract-client-plan-info --task-id $TASK_ID --plan-id $TEST_PLAN_ID`

See `SKILL-PHASE1.md#step-1.3a`.

---

## 1. Pending list and class-level aggregation (optimization)

Frontend `get-pending` often returns class-level records only. After fetching the pending list, the Agent should aggregate with `--group-by-class`:

```bash
# Fetch frontend pending list and aggregate by class
node open_detect.ts get-pending --batch-id <parentBatchId> --group-by-class
```

**Class-aggregation result format**:

```json
{
  "code": 0,
  "data": [
    {
      "className": "src/components/UserProfile",
      "methods": [],
      "totalCount": 3,
      "processId": 123,
      "taskId": 456,
      "git": "...",
      "branch": "..."
    }
  ],
  "_meta": {
    "mode": "grouped_by_class",
    "classCount": 10,
    "methodCount": 42
  }
}
```

`methods` contains every method record under that class; `totalCount` is the method count.

**Writeback note**: after class-level aggregation, writeback is still per method (each method's `processId` / `methodName` is written independently). The platform accepts writeback for records not in the pending list (a class without a matching processId is created), so you can analyze and write back any detected class.

---

## 1. AST scan (Step 2.1) — skip on frontend

> **Frontend projects do not run AST scan**. The current AST rule set applies only to Java services and has no effective coverage for JS/TS. Frontend projects skip Step 2.1 and start from Step 2.2 method-level analysis.

---

## 2. Method-level analysis (Step 2.2) — switch to frontend context

In STEP C the Agent **must switch to a frontend context** and watch these frontend-specific defect patterns:

| Defect category | Typical issues |
|---|---|
| Hook rule violations | useEffect missing deps, conditional Hook calls, missing cleanup |
| Reactive side effects | Vue watch/immediate misuse, computed side effects, ref unwrap timing |
| Type safety | Abusive type assertions (`as any`), non-null assertions (`!`) bypassing checks |
| Event management | Listeners never unbound, global event leaks, wrong event delegation |
| DOM operations | Direct DOM (`document.getElementById`) bypassing the framework, XSS risk |
| Async handling | Uncaught Promise, race conditions, swallowed errors in async functions |
| State management | Closures capturing stale state, misuse of batch updates, global state without validation |
| Style safety | CSS injection, dynamic style objects not sanitized |

---

## 3. Cross-repo dependencies (Step 2.0) — frontend degrade strategy

Frontend "external classes" are usually npm packages or monorepo sub-packages. They **do not follow Java's dependency-package / RPC reverse-lookup**.

**How to identify**:
- External npm package: `import {...} from 'react'` / `import {...} from '@acme/xxx'` — present in node_modules but not under the project's src
- Monorepo sub-package: `import {...} from '@shared/utils'` — under packages/ but not in the current package

**Handling strategy**:

| Strategy | Condition | Action |
|---|---|---|
| A. Monorepo sub-package | Source found under the local repo's `packages/` | Read the sub-package source → normal detection |
| B. npm package unreachable | External npm dependency; no local source | Write back as no defect; thinking explains it is an npm package |
| C. User-specified | User provided the dependency source repo | clone that repo → normal detection |

**Strategy B degrade writeback points**:
- `source` records `npm:<package>` or `monorepo:<sub-package path>`
- `fileCodes.git` fills **this project's** git URL (same as Java cross-repo degrade, so the clone gate passes)
- `fileCodes.filePath` uses the in-project reference path (e.g. `node_modules/@acme/xxx/index.d.ts` or an inferred path)
- Do not clone the source repo. thinking must honestly say "this class comes from npm package xxx; source is unavailable for analysis"

---

## 4. Writeback content language tags

When the Agent writes fix/improvement code blocks in the `content` field, it **must use the project's actual language tag**:

| Project type | Code-block tag | filePath example |
|---|---|---|
| React (TS) | ` ```typescript ` | `src/hooks/useAuth.ts` |
| React (JS) | ` ```javascript ` | `src/components/Login.jsx` |
| Vue SFC | ` ```vue ` | `src/components/UserProfile.vue` |
| CSS/styles | ` ```css ` / ` ```scss ` | `src/styles/variables.scss` |
| Pure TS util library | ` ```typescript ` | `packages/utils/src/format.ts` |

**Never hard-code ` ```java `**. `open_validate.ts` does not validate code-block language tags, but report readers will be confused by a mismatched tag.

---

## 5. Frontend-specific rules

- When the project language is JS/TS, STEP C L0 **automatically loads the frontend-specific rule set** (merged with strategy=11 generic rules)
- Frontend-specific rules cover XSS, unsafe DOM operations, state-management issues, React/Vue anti-patterns, etc.
- Exclusion rules still apply: if a frontend-specific rule has a matching exclusion, prefer the exclusion scene first

---

## 6. Business detection (strategy=11) frontend adaptation

Frontend business-detection Call-chain analysis differs from backend:
- Do not follow dependency-package / RPC Call chains. Use **module-import analysis**: `Component → Hook → API Service → Store`
- thinking chain format: `ComponentA(L12) → useCustomHook(L34) → api.fetchData(L56) → store.setData(L78)`
- fileCodes includes every file on the chain (.vue/.tsx/.ts), not only the backend-style Controller→Service→Dao

---

## 7. filePath and className conventions

- **className**: frontend projects use a class name derived from the file relative path (e.g. `src/components/Foo`). **Do not** apply a Java package path
- **filePath**: keep the source relative path (e.g. `src/components/Foo.vue`, `packages/bar/src/index.ts`)
- **Do not** add a Java Maven-style module prefix (e.g. `xxx-server/src/...`). Frontend projects usually organize under `packages/` or `src/`

---

## 8. Phase 2 completeness self-review — frontend extras (supplement to Step 2.6 item 9)

Besides the generic self-review items, frontend projects must also confirm:
- Were frontend-specific rules loaded and applied in STEP C?
- Do all content code-block language tags use frontend languages (no leaked ` ```java `)?
- Does filePath keep the source relative path (no accidental Java module prefix)?
- Did cross-repo degrade use npm/monorepo (not dependency-package / RPC reverse-lookup)?

---

## 9. Common frontend false-positive traps

| Scene | False-positive tendency | Correct judgment |
|---|---|---|
| `useEffect(() => {}, [])` empty deps | Looks like missing deps | If the effect references no reactive values, empty deps are correct (mount-only effect) |
| `as any` type assertion | Looks type-unsafe | If it is a temporary bypass for a missing third-party type definition, mark as Improvement, not Defect |
| Event listener `addEventListener` | Looks unbound | Confirm whether the effect cleanup has `removeEventListener`; if yes, no issue |
| `document.getElementById` | Looks like bypassing the framework | If used outside React/Vue ownership (e.g. third-party SDK integration), it may be reasonable |

---

## 10. Frontend-specific rule detection (strategy=10, Step 2.2 enhancement)

### Command

```bash
node "$SKILL_SCRIPT" run-frontend-rules [--diff-files <changed file list>]
```

### How it works

The command outputs 12 structured frontend defect-pattern rules (ruleId FE-001 ~ FE-012), covering:

- **hook_rules**: React Hook rule violations (useEffect deps, cleanup)
- **type_safety**: Abusive type assertions (as any, non-null assertion !)
- **event_management**: Unbound listeners / global event leaks
- **async_race**: Race conditions and uncaught exceptions
- **state_management**: Closures capturing stale state, misuse of batch updates
- **dom_operation**: Direct DOM bypassing the framework, XSS risk
- **expose_dedup**: Exposure / tracking missing dedup
- **storage_asymmetry**: Storage read/write namespace mismatch
- **frequency_control**: Display logic missing frequency limits
- **context_strip**: Critical fields stripped when passing context
- **component_lifecycle**: Side effects fired at the wrong lifecycle moment
- **nullable_access**: Null access, missing optional chaining / nullish coalescing

### How the Agent uses it

When analyzing each changed method in Phase 2 STEP C, the Agent should:

1. Call `run-frontend-rules` to get the rule list (once; reuse for all methods)
2. Compare each changed method against every rule's checkPoints
3. On a hit, cite the ruleId and concrete code line numbers in thinking
4. Describe the concrete defect in content: confirmed defects as suspected defects; code-quality issues as Improvement
5. Use strategyCode 10 on writeback

### Relationship with business detection (strategy=11)

- strategy=10 focuses on **frontend technical defect patterns** (Hooks, events, type safety, etc.)
- strategy=11 focuses on **business-logic defects** (Call chain, business-rule comparison)
- Both can be used together; they complement each other
- Frontend business-detection Call-chain analysis uses module-import analysis (Component → Hook → API Service → Store), not dependency packages / RPC

### Defect-pattern examples (generic)

These patterns come from real detections and are already in the rule list. Example function names are fictional and only illustrate the judgment:

- **FE-007 Exposure dedup**: `onItemAppear` callback has no Set/Map dedup; list scroll retriggers tracking
- **FE-008 Storage mismatch**: reads go to `localStorage` while writes go to `sessionStorage`, or read/write key namespaces disagree
- **FE-009 Frequency-control miss**: the display entry sets `shouldShow=true` directly, bypassing "shown count ≤ cap"
- **FE-010 Context strip**: assembling downstream context actively deletes `limit` / `enabled`, so downstream cannot judge
- **FE-011 Lifecycle side effect**: `componentDidMount` unconditionally fires an exposure callback, missing visibility or dedup checks
