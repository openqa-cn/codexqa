# MobX Store lifecycle (guard against leftover state across sessions)

> **When to load**: Path contains `store/` / `stores/` / `.store.ts` / `.store.js`; or class name contains `Store`; or `@observable` / `runInAction` / `open(` / `init(` / `reset(` / `dispose(` appears.

## Quick-reference index

| # | Rule | Signal | Level |
|---|------|--------|-------|
| S1 | Opening / initializing a Store must **explicitly reset every observable that is read or written externally** | `open`/`init`/`show` neither calls `reset()` nor assigns every mutable field | **P0 (G9)** |
| S2 | Conditional assignments must **cover every branch** | `if (xxx) { this.a = ... }` with no else, or an `if/else if` chain with no fallback | **P0 (G9)** |
| S3 | "Delayed assignment" in `queryXxx` / async callbacks must have **both success and failure paths** | Assigns only when validation passes; failure path silently no-ops and leaves a leftover value | **P0** |
| S4 | Deleting an existing `reset()` / `clear()` / `this.xxx = undefined` must have an **equivalent replacement** | Diff `-` removes a cleanup line and the function has no new zeroing semantics | **P0 (G10)** |
| S5 | Edit / view / create state entries must be **symmetric** | One of the three modes skips the reset path | P0 |
| S6 | Especially dangerous when the Store is a **long-lived singleton** | `@inject`, external `useLocalStore`, global provider | After this trigger, every rule above upgrades to P0 |
| S7 | `dispose()` / `hide()` / `close()` must clear **every observable produced by this interaction** | Leftover fields will be read by the next `open` | P0 |
| S8 | Observable assignments must complete inside `runInAction` | After `await`, `this.xxx = ...` without wrapping `runInAction` | P1 |
| S9 | Callers outside the Store must not assign observable properties directly | Component does `store.xxx = ...` instead of `store.setXxx()` / `store.update()` | P1 |

---

## 1. Why leftover Store state is P0

In many codebases a Store is a **long-lived singleton** (hung on a global Provider, injected via `@inject` in many places). A singleton means:

- **The instance is constructed once, but `open()` is called many times**
- Each `open` is conceptually "a new session", but **physically reuses the same instance**
- So any observable not explicitly rewritten on `open` **carries the previous session's value into this session**

**Runtime consequence** (checkout form switching site templates):
- User opens the form the first time → picks site template A → `rawSelectedSite = A`
- Closes the form (`dispose()` does not clear `rawSelectedSite`)
- User opens the form a second time → picks site template B → `open()` only runs `restoreSelectedSite` in "create" mode, not in "edit" → `rawSelectedSite` is still A
- UI child-form fields reuse A's data → user sees stale data; it feels like "template switch does nothing"

Traits of this bug:
- **Very hard to catch in solo testing** (reproduces only on the second or later open)
- **Invisible from a diff fragment** (you must look at full `open` / `dispose` / callback symmetry)
- **No error, no throw, no crash** — a silent logic bug

So leftover Store init, once identified, is immediate **P0**, same tier as XSS / money floats / empty catch.

---

## 2. Five-question check for open / init

For a Store's `open` / `init` / `show` (collectively `open`), answer each:

| # | Question | Pass standard |
|---|----------|---------------|
| 1 | Which observables of this Store are read externally? | A complete list (at least everything the diff touches) |
| 2 | In this `open`, is every observable **written explicitly once**? | A `reset()` call / or field-by-field assignment |
| 3 | Are there `if / else if / switch` branches in the method? | Every branch must answer whether every listed field is assigned |
| 4 | For fields assigned in async callbacks (`then` / after `await`), are they also handled on **callback failure / early return**? | Failure path must not silently no-op |
| 5 | Does `dispose` / `close` / `hide` (closing a dialog / switching a step) clear the fields this session produced? | Observables return to their initial state on close |

**If any question cannot be answered → G9 P0 candidate; you must Read the full Store file and re-verify.**

---

## 3. BadCase: Store conditional branch missing else

### ❌ Wrong (real incident sketch)

```ts
// src/stores/customer.ts
class CustomerStore {
  @observable rawSelectedSite: SiteRecord | null = null
  @observable initSite: SiteRecord | undefined = undefined
  @observable siteIds: number[] = []

  @action
  open({ isEdit, customer, siteIds, onCustomerChange }: OpenParams) {
    this.siteIds = siteIds || []
    this.onCustomerChange = onCustomerChange

    if (isEdit) {
      // Edit mode: stash old site data
      if (customer?.customerType === SITE_KIND.BRANCH && customer.linkedSites?.[0]) {
        this.initSite = customer.linkedSites[0]
      }
      // ❌ no else: rawSelectedSite keeps the value from the last open
    } else {
      this.restoreSelectedSite(customer)
    }
  }

  // Async query callback
  @action
  onQueryDone(result: CustomerDetail) {
    if (this.initSite && result?.linkedSites) {
      const stillExists = result.linkedSites.some(s => s.id === this.initSite!.id)
      if (stillExists) {
        this.rawSelectedSite = this.initSite
      }
      // ❌ no else: when stillExists=false, rawSelectedSite silently no-ops and keeps the last value
      this.initSite = undefined
    }
  }
}
```

### ✅ Correct

```ts
@action
open({ isEdit, customer, siteIds, onCustomerChange }: OpenParams) {
  // Key: before any branch, reset "every observable this method will touch" to the initial state
  this.reset()

  this.siteIds = siteIds || []
  this.onCustomerChange = onCustomerChange

  if (isEdit) {
    if (customer?.customerType === SITE_KIND.BRANCH && customer.linkedSites?.[0]) {
      this.initSite = customer.linkedSites[0]
    } else {
      this.initSite = undefined
      this.rawSelectedSite = null
    }
  } else {
    this.restoreSelectedSite(customer)
  }
}

@action
private reset() {
  this.rawSelectedSite = null
  this.initSite = undefined
  this.siteIds = []
  // ... list every observable
}

@action
onQueryDone(result: CustomerDetail) {
  const exists =
    this.initSite &&
    result?.linkedSites?.some(s => s.id === this.initSite!.id)

  // Whether exists is true or false, rawSelectedSite is written explicitly once
  this.rawSelectedSite = exists ? this.initSite! : null
  this.initSite = undefined
}
```

---

## 4. Recognizing cleanup semantics in deleted diff lines (G10 only)

Every **deleted line starting with `-`** in a Store / Context / global singleton class file must be **judged on its own**:

| Deleted-line pattern | Deletion meaning | P0? |
|----------------------|------------------|-----|
| `- this.xxx = undefined` / `- this.xxx = null` / `- this.xxx = []` / `- this.xxx = {}` | Zero an observable | No equivalent replacement after delete → **P0** |
| `- this.reset()` / `- this.clear()` / `- this.dispose()` | Bulk zero | Same → **P0** |
| `- runInAction(() => { this.xxx = ... })` | Reset state inside a transaction | Same → **P0** |
| `- delete this.xxx` | Delete a property | Same → **P0** |
| `- this.$reset()` / Vuex / Pinia | Zero | Same → **P0** |
| `- // reset ...` comment | Comment only | P2 |

**Judgment flow**:
1. `grep '^-'` the diff for all deleted lines
2. For each line matching the patterns above, **Read the whole method** and confirm whether the same function has an equivalent replacement
3. No equivalent replacement → immediate P0 candidate, cite G10; **then run step 4 "five-question verification"** to confirm line numbers and runtime consequence before outputting

**Pits AI often falls into**:
- Only looking at `+` lines to judge "is the new logic correct", ignoring `-` lines: "who now does what the old code did"
- Assuming "deleted a blank line" or "deleted a comment" needs no check. Cleanup-semantic deletes must be reviewed one by one.

---

## 5. Caller patterns (component / page) that often trigger leftover state

When reviewing the component side, if you see these patterns, **go back to the Store and re-check symmetry**:

```ts
// ❌ open on enter, no dispose on exit
useEffect(() => {
  store.open(params)
  // missing return () => store.dispose() !
}, [])

// ❌ Using open as a setter: repeatedly open the same singleton when switching entities
const onChangeTemplate = (tpl) => {
  store.open({ template: tpl })  // depends on open rewriting every field
}

// ❌ Not calling a store method; stuffing the field directly
store.rawSelectedSite = null  // violates S9
```

---

## 6. Review-pattern shorthand (cite when outputting)

| Basis | Abbreviation |
|-------|--------------|
| This file §1 / §2 | `client-state-lifecycle.md §1`, `§2` |
| Missing else in a conditional branch leaves old state | `G9 / client-state-lifecycle.md §3` |
| Diff deletes a cleanup statement with no equivalent replacement | `G10 / client-state-lifecycle.md §4` |

> **Final hard rule**: In the CR report for a Store class file, the `📋 Context analysis` section must explicitly say:
> "✅ Verified open/init/reset/dispose symmetry" or "⚠️ Found X fields missing from reset".
> Missing that line = this Store review was not executed and must be redone.
