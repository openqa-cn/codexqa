# Production incident catalog

> Cases use neutral industry scenes (checkout, customer, site) to describe reproducible patterns. When CR finds a similar pattern, cite the matching case as evidence.

---

## Case 1: Phantom dependency caused a white-screen page

**Incident**: INC-001 — Admin discount-stacking settings page white-screened for about 48 hours, 15000+ users affected

**Code problem**:
```javascript
import _ from 'lodash'; // ❌ not declared in package.json; pulled in transitively via some-ui-lib
export function formatPrice(price) {
  return _.round(price, 2);
}
```

**Trigger**: After `some-ui-lib` upgraded to 3.0 it dropped the lodash transitive dependency, lodash was no longer installed, and 20+ pages white-screened.

**Fix**: Explicitly declare every directly used package in `package.json`.

**CR checkpoint**: For every imported package, is it **explicitly declared** in `package.json` `dependencies` or `devDependencies`?

---

## Case 2: Promise stays pending and the page hangs

**Incident**: INC-002 — Checkout location page failed to open for some users, lasted about 8 days

**Code problem**:
```javascript
function getLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      if (pos.coords.latitude) {  // ❌ lat=0 is falsy; nothing happens; Promise stays pending
        resolve(pos.coords);
      }
    });
    // ❌ no error callback
  });
}
```

**Fix**:
```javascript
function getLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (lat !== undefined && lng !== undefined) {
          resolve({ lat, lng });
        } else {
          reject(new Error('Invalid location'));
        }
      },
      reject
    );
  });
}
```

**CR checkpoint**: In a Promise constructor, does every branch resolve or reject? Are both success and failure of dual-callback APIs wired up?

---

## Case 3: switch-case missing break caused fall-through

**Incident**: INC-003

**Code problem**:
```javascript
switch (moduleType) {
  case 'address':
    config = getAddressConfig();
    // ❌ missing break; falls through to the next case
  case 'payment':
    config = getPaymentConfig(); // address module also reaches here; config is overwritten
    break;
}
```

**CR checkpoint**: Does every non-empty switch case have a break or return?

---

## Case 4: Forgotten await in an async function disabled the permission check

**Incident**: INC-004 — About 7-10 projects could not deploy normally, lasted about 22 hours

**Code problem**:
```javascript
async function myController(ctx) {
  const list = ['123'];
  // ❌ check() returns a Promise; used in && without await
  // A Promise object is truthy, so this always returns true; the permission check is a no-op
  return ctx.service.checkout.checkPermission() && list.length > 0;
}
```

**Fix**:
```javascript
async function myController(ctx) {
  const list = ['123'];
  const checkResult = await ctx.service.checkout.checkPermission();
  return checkResult && list.length > 0;
}
```

**CR checkpoint**: Is a Promise-returning call awaited? Do not use a Promise object as a condition (it is always truthy).

---

## Case 5: Unprotected JSON.parse blocked rendering

**Incident**: INC-005 — Checkout page tip cards did not show, lasted about 7 days

**Code problem**:
```javascript
// ❌ When the backend omits content, JSON.parse throws and all later rendering is blocked
const data = JSON.parse(message.content);
renderMessage(data);
```

**Fix**:
```javascript
let data = null;
try {
  data = JSON.parse(message.content);
} catch (e) {
  console.error('Failed to parse message:', e, message);
  data = { type: 'unknown' }; // fallback; do not block rendering
}
renderMessage(data);
```

**CR checkpoint**: Does every `JSON.parse` have try-catch? Does the catch have a fallback instead of an empty block?

---

## Case 6: Float precision caused refund money loss

**Incident**: INC-006 — Discount amount calculated wrong (16.9 yuan → 16.89 yuan), money loss ¥50,000+

**Code problem**:
```javascript
const voucherAmount = 16.9;
const discountedAmount = voucherAmount * 0.9; // ❌ = 15.209999999999999
// Rounding produced the wrong amount
```

**Fix**:
```javascript
// ✅ Integer math (fen as the unit)
const voucherAmountCents = 1690;
const discountedCents = Math.floor(voucherAmountCents * 90 / 100); // 1521 fen
const display = discountedCents / 100; // 15.21 yuan

// ✅ or decimal.js
import Decimal from 'decimal.js';
new Decimal(16.9).mul(0.9).toFixed(2); // "15.21"
```

**CR checkpoint**: For money / points / discount math, are integers (fen) or decimal.js used?

---

## Case 7: Wrong Vue/React default-value arrow-function syntax

**Incident**: None (style issue; shows up often in CR)

**Code problem**:
```javascript
// ❌ Vue props default
default: () => {}  // this is a function body; returns undefined!

// ❌ React parameter default
function MyComp({ config = () => {} }) {
  config.theme; // TypeError: Cannot read property 'theme' of undefined
}
```

**Fix**:
```javascript
// ✅ Vue: wrap the object literal in parentheses
default: () => ({})

// ✅ React: use an object literal directly
function MyComp({ config = {} }) {}
```

**CR checkpoint**: When an arrow function returns an object literal, it must be wrapped: `() => ({})`.

---

## Case N: After switching site templates on checkout, child-form fields did not update (leftover Store state)

**Scene**: After the checkout requirement launched, product reported "when switching site templates, child-form field info does not update". Users had to refresh or reselect the customer to see the correct content.

**Trigger path** (classic incident: a singleton Store is reused):
1. User opens the customer form the first time → `CustomerStore.open({ isEdit: true, customer: A })`
2. An async callback in `open` assigns `rawSelectedSite` = A's site record
3. User submits and closes the dialog (`dispose` does not clear `rawSelectedSite`)
4. User opens the form again → `open({ isEdit: true, customer: B })`
5. This `open` does `if (isEdit) { /* only assigns initSite, not rawSelectedSite */ }`
6. UI child form reads `rawSelectedSite = A` and shows stale data

**Code problem**:

```ts
// src/stores/customer.ts
class CustomerStore {
  @observable rawSelectedSite: SiteRecord | null = null
  @observable initSite: SiteRecord | undefined = undefined

  @action
  open({ isEdit, customer, siteIds, onCustomerChange }: OpenParams) {
    this.siteIds = siteIds || []
    this.onCustomerChange = onCustomerChange

    if (isEdit) {
      if (customer?.customerType === SITE_KIND.BRANCH && customer.linkedSites?.[0]) {
        this.initSite = customer.linkedSites[0]
      }
      // ❌ no else: rawSelectedSite keeps the value from the last open
    } else {
      this.restoreSelectedSite(customer)
    }
  }

  @action
  onQueryDone(result: CustomerDetail) {
    if (this.initSite && result?.linkedSites) {
      const stillExists = result.linkedSites.some(s => s.id === this.initSite!.id)
      if (stillExists) {
        this.rawSelectedSite = this.initSite
      }
      // ❌ when stillExists=false, silently no-ops; rawSelectedSite keeps the old value
      this.initSite = undefined
    }
  }
}
```

**Clues in this diff** (signals CR missed):
- The diff **deleted** one reset assignment to `rawSelectedSite` (classic G10)
- `open` was rewritten so "conditional branches assign only some observables" (classic G9)
- Prior CR only checked whether the new code was semantically correct; it did not check "who now owns" the deleted lines, and did not check `open/dispose` symmetry

**Fix**:

```ts
@action
open({ isEdit, customer, siteIds, onCustomerChange }: OpenParams) {
  this.reset()  // key: zero all observables at the entry
  this.siteIds = siteIds || []
  this.onCustomerChange = onCustomerChange

  if (isEdit) {
    this.initSite =
      customer?.customerType === SITE_KIND.BRANCH ? customer.linkedSites?.[0] : undefined
    // rawSelectedSite is zeroed by reset(); onQueryDone will overwrite it
  } else {
    this.restoreSelectedSite(customer)
  }
}

@action
onQueryDone(result: CustomerDetail) {
  const exists =
    this.initSite && result?.linkedSites?.some(s => s.id === this.initSite!.id)
  // Whether true or false, rawSelectedSite is written explicitly once
  this.rawSelectedSite = exists ? this.initSite! : null
  this.initSite = undefined
}

@action
private reset() {
  this.rawSelectedSite = null
  this.initSite = undefined
  this.siteIds = []
}
```

**CR checkpoints (hard rules for the skill)**:
1. A path containing `store/` or a class name containing `Store` enters the diff → force-load `client-state-lifecycle.md`
2. When `open` / `init` / `show` has conditional branches, run the "five-question check" (see client-state-lifecycle §2)
3. Any `-` line in the diff with state-cleanup semantics (`reset()` / `= undefined` / `= null` / `= []`) must be judged separately: "who now owns this?"; no equivalent replacement → G10, immediate P0
4. For a singleton / long-lived Store, `dispose` / `close` / `hide` must clear every observable written by this `open`

---

## Case N+1: Discount-settlement PR over-engineering (retrospective of 28 human CR comments)

**Scene**: Discount-settlement requirement submitted a PR. Human CR produced 28 comments (13 unresolved / 15 resolved). The skill's AI CR produced almost no useful comments, exposing the subtractive-review blind spot.

**This PR's problems fall into four types**:

| Type | Hit comments | Representative comments | Rules violated |
|------|--------------|-------------------------|----------------|
| A. Over-engineering / redundancy | 10 | "lines 22 to 101 are all unnecessary"; "this entire file did not need to change"; "this function is not needed, one line is enough"; "just `...item`" | **G11 / M2 / M3 / M9** |
| B. API DTO contract mismatch | 6 | "`customerDTO` does not need to be flattened"; "`feePercent` argument is missing"; "all-undefined DTO sent to the backend" | **G12 / M4 / M5 / M6** |
| C. React intent misuse | 4 | "`defaultValue` holds `customerList`"; "what is this useEffect for"; "why watch `customerList`" | **M7 / M8** |
| D. Naming / magic numbers / copy | 4 | "what is magic number 0"; "`NO_CUSTOMER` vs `NO_SELECTED_CUSTOMER` difference"; typo `catalg → catalog` | **M12 / M13** |

**The sharpest comment (human reviewer, verbatim)**:
> "Sigh, I think you didn't look at anything and just let AI write this. You didn't sort out the original logic, didn't look at the API change, didn't review what AI wrote. On Monday you must sort this out carefully — the whole thing barely needed a few places changed."

**Root issue**: The PR author did **addition**, not **subtraction**. The API change needed a few lines; the author wrote hundreds. Prior AI CR only asked "is the change correct?", not "should it change at all?".

**Typical antipattern 1: Flatten DTO then reassemble (M4)**

```ts
// ❌ Antipattern
const [customerId, setId] = useState(data.customerDTO?.customerId)
const [customerName, setName] = useState(data.customerDTO?.customerName)
const [customerType, setType] = useState(data.customerDTO?.customerType)

submit({ customerDTO: { customerId, customerName, customerType } })

// ✅ Correct
const [customerDTO, setCustomerDTO] = useState(data.customerDTO)
submit({ customerDTO })
```

**Typical antipattern 2: Redundant helper (M3)**

```ts
// ❌ Wrote a 15-line helper
function formatCustomer(row) {
  if (!row.customerDTO) return '-'
  const id = row.customerDTO.customerId
  const name = row.customerDTO.customerName
  return `${id}:${name}`
}

// ✅ One-line ternary
const formatCustomer = row =>
  row.customerDTO ? `${row.customerDTO.customerId}:${row.customerDTO.customerName}` : '-'
```

**Typical antipattern 3: `defaultValue` holds a list (M7)**

```tsx
// ❌ defaultValue holds customerList (a data list)
<Form.Item name="customers" defaultValue={customerList} />

// ✅ customerList goes in useState; defaultValue holds a "one-time initial value"
const [customerList, setCustomerList] = useState<Customer[]>([])
<Form.Item name="customers" defaultValue={data.selectedCustomer} />
```

**Typical antipattern 4: Sending an all-undefined DTO (M6)**

```ts
// ❌ Always creates a DTO whether fields are complete or not
const toSubmitDTO = item => ({
  customerDTO: {
    customerId: item.customerId,       // undefined
    customerName: item.customerName,   // undefined
    customerType: item.customerType,   // undefined
  }
})

// ✅ Decide whether to attach after a null check
const toSubmitDTO = item => {
  const dto = buildCustomerDTO(item)
  return dto ? { customerDTO: dto } : {}
}
```

**CR checkpoints (hard rules for the skill)**:
1. Load `change-necessity-rules.md` (always-on for feature PRs)
2. Step 0.1 must collect PR change intent; if the commit is empty, ask the author
3. Step 3.0 must run necessity questions N1-N5 on every new block ≥ 5 lines
4. The report must include both **🔎 Necessity review conclusion** and **🔎 Unclear-intent change list**
5. File coverage matrix must name every diff file; no omissions

**Lessons**:
- "Correct" ≠ "good"
- Code bloat is itself a defect (maintenance cost / contract drift / review fatigue)
- If AI CR does not force "subtract", it only encourages "add by default" — this case is the proof

---

## Incident stats

| Type | Incident ID | Count | Typical users affected | Money lost |
|------|-------------|-------|------------------------|------------|
| Phantom dependency | INC-001 | 3 | 15000+ | — |
| Promise pending | INC-002 | 5 | 8000+ | — |
| Forgotten await | INC-004 | 4 | Multi-project deploy failure | — |
| Unprotected JSON.parse | INC-005 | 2 | 2000+ | — |
| switch missing break | INC-003 | 2 | 3000+ | — |
| Floating-point math | INC-006 | 1 | 500+ | ¥50,000 |
| Leftover Store state (G9/G10) | Checkout form | 1 | All checkout users | Product-felt bug |
| Over-engineering / redundancy / contract mismatch (G11-G13) | Discount settlement | 1 PR | Code bloat + review cost | 28 human CR comments |
