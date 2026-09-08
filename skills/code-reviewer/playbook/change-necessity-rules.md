# Minimal-change principle and subtractive review (team over-engineering antipatterns)

> **When to load**: Required for every feature PR (same priority as project-conventions.md / design-quality-rules.md; always-on knowledge).
>
> **Why a separate playbook**: The team often ships PRs that are "correct but too large", "over-abstracted", or "changed for the sake of changing". These are not bugs, but they bloat the codebase, explode review cost, and silently change backend contracts. This playbook isolates subtractive-review rules and treats them as equal to correctness review (SECURITY / ASYNC / TS).

## Quick-reference index

| # | Rule | Quick signal | Level |
|---|------|--------------|-------|
| M1 | Change must match PR intent | Change maps to none of the stated goals in the commit / PR body | **P1 (G13)** |
| M2 | Delete when you can | Equivalent no-op / existing fallback already covers it / add-and-delete of the same semantics | **P1 (G11)** |
| M3 | Simplify when you can | New function ≥ 20 lines that a one-line ternary / destructure / existing util can express | **P1 (G11)** |
| M4 | DTO contract consistency | Response DTO is flattened into state / props / `defaultValue`, then manually reassembled on submit | **P0 (G12)** |
| M5 | Submit payload completeness | Backend-defined fields are not all passed in the submit function (especially new fields for this requirement) | **P0 (G12)** |
| M6 | Do not send empty DTOs | Building an "all-fields-undefined object" and sending it to the backend (should pass undefined, or omit after a null check) | **P0 (G12)** |
| M7 | React intent match: `defaultValue` vs `useState` | `defaultValue` means "initial value on first form render"; do not put data lists / dynamic data / state that must update | **P1 (G12/React)** |
| M8 | useEffect purpose must be clear | A useEffect exists but you cannot say in one sentence "when it fires + what it does + why these deps" | **P1 (React)** |
| M9 | Destructure-then-copy is a no-op | `{ ...item, a: item.a, b: item.b }`; or `const a = item.a; const b = item.b; return { a, b }` | **P1 (G11)** |
| M10 | Redundant boolean wrapping | `Boolean(x)` inside `if` or ternaries; `if (xxx) return true; else return false` | **P1 (G11)** |
| M11 | Redundant default args | Passing `false` / `undefined` into a branch that never runs; extra pre-checks when a fallback already exists | **P1 (G11)** |
| M12 | Error-code / copy explosion | Same meaning split into multiple ERROR_CODEs (`NO_CUSTOMER` vs `NO_SELECTED_CUSTOMER`); ≥ 3 copy branches for the same scenario | **P1 (naming/UX)** |
| M13 | Magic numbers / unnamed constants | Bare `0` / `1` / `-1` used as business meaning, no constant name | **P1 (naming)** |
| M14 | Change for the sake of change / no-op moves | Only `export` order changes / rename with same meaning / file move with no required import-graph change | **P1 (G13)** |

---

## 1. Three basic subtractive moves

For every change that enters review, **subtract first, then add**:

### Move 1: Revert-Reading

"**If this entire change were reverted, would the PR still meet the goals in the intent statement?**"

- ✅ Yes → this change is redundant; P1, recommend revert (M2 / G11)
- ❌ No → go to move 2

> Example: Revert the whole block at `discount-edit/index.tsx` line 119; PR intent still holds → human reviewer: "this entire file did not need to change"

### Move 2: One-Liner Challenge

For every new **function / util / helper**, force these questions:
- Can a **one-line ternary** express it?
- Can **one destructure + a direct reference** express it?
- Can you reuse an **existing util / type / constant**?

> Example:
> ```ts
> // ❌ New 15-line helper
> function formatCustomer(row) {
>   if (row.customerDTO) {
>     const id = row.customerDTO.customerId
>     const name = row.customerDTO.customerName
>     return `${id}:${name}`
>   }
>   return '-'
> }
>
> // ✅ One line
> const formatCustomer = (row) => row.customerDTO ? `${row.customerDTO.customerId}:${row.customerDTO.customerName}` : '-'
> ```

### Move 3: Diff Cancellation

In the same diff, look for:
- Adding something, then deleting it a few lines later (`+ a` + `- a`)
- Checking x, then falling back on x a few lines later (classic M11)
- Destructuring fields, then reassembling them under the same names (classic M9)

Net effect of these changes = 0; they must be deleted.

---

## 2. DTO contract review (G12's main battlefield)

### 2.1 Flatten / reassemble antipattern

Backend returns `customerDTO: { customerId, customerName, customerType, ... }`:

```ts
// ❌ Antipattern: flatten first, reassemble on submit
const [customerId, setId] = useState(data.customerDTO?.customerId)
const [customerName, setName] = useState(data.customerDTO?.customerName)
// ... omit 5-10 more pieces of state

// On submit
submit({
  customerDTO: { customerId, customerName, /* ...reassembled */ }
})
```

**Why this is P0**:
- Adds two places that can miss fields during "flatten → reassemble" (M5 / M6 trigger)
- When the backend adds a field, the frontend must change two places (extract + reassemble)
- Default-value semantics are lost (`undefined` may be wrongly filled as `null` / `''` while flattening)

**Correct approach**:
```ts
// ✅ Hold the object as a whole
const [customerDTO, setCustomerDTO] = useState(data.customerDTO)

// On submit
submit({ customerDTO })
```

### 2.2 Misusing `defaultValue`

```ts
// ❌ Putting a data list in defaultValue
<Form.Item defaultValue={customerList}>  // customerList is an array, not a form initial value
```

`defaultValue` means **"the initial controlled value on first form render"**. It should:
- Hold "this field's initial value" (a single value / single object)
- **Not** hold a data-source list (lists belong in `useState` / `useMemo`)
- **Not** hold dynamic data that will update (use `value` + external state instead)

### 2.3 Empty-DTO send check

```ts
// ❌ Building a DTO even when every field is undefined
const toSubmit = (item) => ({
  customerDTO: {
    customerId: item.customerId,
    customerName: item.customerName,
    customerType: item.customerType,
  },
})

// Backend receives { customerDTO: { customerId: undefined, customerName: undefined, customerType: undefined } }
// Likely deserialization errors / validation failures / dirty data written
```

**Correct approach**:
```ts
// ✅ Decide whether to attach the DTO after a null check
const toSubmit = (item) => {
  const dto = buildCustomerDTO(item)  // completeness check inside
  return dto ? { customerDTO: dto } : {}
}
```

### 2.4 Payload completeness check (required)

When reviewing `toSubmitXxx` / `onSubmit` / `buildPayload`, **move the cursor to the API type definition and Grep**, then check field by field:
- API defines fields A/B/C/D/E
- Submit function sends A/B/C/D/X (**E missing, X extra**)

Example: human reviewer: "why is the `feePercent` argument missing?" = the frontend submit function omitted `feePercent`.

---

## 3. React intent-match checklist

For every React Hook / form field / state block, force these three questions:

| Element | Must answer |
|---------|-------------|
| `useState(initial)` | When does this state change? Who triggers it? Why is this the initial value? |
| `useEffect(fn, deps)` | When does it fire? What does it do? Why these deps? What if one is missing? What if one is extra? |
| `<Form.Item defaultValue={x}>` | Is `x` a "one-time initial value" or "data that will change"? A "single value/object" or a "list"? |
| `<Form.Item value={x} onChange>` | Should this be `defaultValue` instead? Is `onChange` missing? |
| `{ ...item, a: item.a }` | Is `a` overwritten by another value? If not → M9 redundancy; just `...item` |

**Typical missed reviews**:
- Human reviewer: "this is redundant, just `...item`" → M9
- Human reviewer: "I don't understand what this useEffect is for" → M8
- Human reviewer: "why watch customerList" → M8 (deps do not match the side-effect logic)

---

## 4. Copy / error-code explosion review (M12)

When a diff contains both:
- ≥ 2 `ERROR_MESSAGES.XXX` constants
- or ≥ 2 copy branches for the same scenario

You must Grep the repo for same-meaning constants and decide whether near-duplicate error codes exist independently. Example:
- `ERROR_MESSAGES.NO_CUSTOMER` — no customer
- `ERROR_MESSAGES.NO_SELECTED_CUSTOMER` — no selected customer

These can usually be merged (different triggers, similar copy). Merge decision flow:
1. List the trigger scenario for each error code
2. Check whether product actually needs two distinct messages
3. If "the user-facing prompt is effectively the same sentence", recommend merge

---

## 5. Standard output for unclear-intent changes (M1 / G13)

For changes that fail N1, collect them in the report section **"🔎 Unclear-intent change list"**, format:

```
| File:line | Change summary | Question |
|----------|----------------|----------|
| src/pages/checkout/discount-details/index.tsx:47 | Only reordered exports | This PR's intent is "add DTO submit fields"; why change this? Can it be reverted? |
| src/pages/checkout/discount-edit/index.tsx:119 | Large rewrite of the whole file | Reverting still satisfies PR intent; why are these changes necessary? |
```

This is a question list the PR author must answer, not items the AI should "judge right/wrong". These items **do not count toward official P0/P1 bug totals**, but they must appear in the report.

---

## 6. Relationship to other knowledge files

| Dimension | This file | Other files |
|-----------|-----------|-------------|
| Is the change correct | — | frontend-security / async-failure-modes / typescript / react-review-rules |
| Is the change necessary (subtract) | ✅ This file exclusive | — |
| Is the change concise (subtract) | ✅ This file exclusive | — |
| Store state lifecycle | Cross-cut (M4 flatten ↔ client-state-lifecycle §2) | client-state-lifecycle.md |
| Naming / magic numbers | ✅ M12 / M13 | design-quality-rules.md (high-level design) |

**Hard rule**: Every feature PR CR report must include all three:
- 🔴 Correctness issues (G1-G10 / other knowledge files)
- 🟡 Necessity / conciseness issues (G11-G13 / this file M1-M14)
- 🔎 Unclear-intent change list (N1 output)

All three are required for a complete CR.
