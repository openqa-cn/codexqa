# JavaScript CR Critical Rules

> Includes only rules that require semantic understanding. Formatting issues covered by ESLint / Prettier static checks are out of scope.

## 📋 Rule Quick-Reference Index (scan this table first, then read details as needed)

| Section | Rule | Severity | Quick identification |
|------|------|------|------------|
| §1.1 | Incomplete Promise branches | P0 | `new Promise` has `if` without `else` resolve/reject |
| §1.2 | Promise object used in a condition | P0 | Async call used directly with `&&`/`if`/`return`, no `await` |
| §1.3 | async without a real await | P1 | `async function` body has no `await` |
| §2.1 | Number 0 / empty-string falsy trap | P0 | `if (count)` when count may be 0 |
| §2.2 | isNaN instead of Number.isNaN | P1 | Global `isNaN()` call |
| §3.1 | Mutating function parameters | P1 | `param.xxx = ...` or `Object.assign(param, ...)` inside a function |
| §3.2 | Arrow function returning an object without parentheses | P1 | `() => { key: val }` instead of `() => ({ key: val })` |
| §4 | Missing switch break | P0 | case ends without break/return (see cheat sheet G7) |
| §5 | JSON.parse without try-catch | P0 | Bare `JSON.parse(...)` |
| §6 | Floating-point money arithmetic | P0 | Direct multiply/divide on price/amount fields (see cheat sheet G6) |
| §7 | Variable shadowing | P1 | catch/callback variable name matches an outer name |
| §8 | Magic numbers | P1 | Conditions like `=== 1`/`=== 3` with no semantic name |
| §8.5 | Promise.all missing parentheses | P1 | `Promise.all([fn, fn()])` mixes references and calls |
| §10 | Oversized integer IDs must be string | P1 | Resource/order business IDs declared as `number` |
| §11 | Exceptions used as control flow | P1 | try-catch used instead of a normal `if` branch |
| §12 | `=== NaN` | P1 | `value === NaN` (always false) |
| §13 | Recursion without termination | P1 | Recursive function has no clear exit or depth limit |
| §14 | Always-true / always-false conditions | P1 | `if (true)` / `a > 10 && a < 5` |
| §15 | Loop out of bounds | P1 | `for (let i = 0; i <= arr.length; i++)` |

---

## 1. Promise / Async Traps (🔴 P0)

### 1.1 Promise constructor: every branch must resolve or reject

```javascript
// ❌ lat=0 is falsy, so the if fails and the Promise stays pending forever → page hangs
// Reference case: INC-002, location page hung for 8 days
function getLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      if (pos.coords.latitude) {  // ❌ 0 is a valid latitude, but falsy!
        resolve(pos.coords);
      }
      // ❌ else branch: Promise is left hanging, never resolve/reject
    });
    // ❌ no error callback: errors also stay pending forever
  });
}

// ✅ every branch has an exit
function getLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (lat !== undefined && lng !== undefined) {
          resolve({ lat, lng });
        } else {
          reject(new Error('Invalid location data'));
        }
      },
      reject
    );
  });
}
```

**CR checkpoint**: In a Promise constructor, do `resolve`/`reject` cover **all conditional branches** (including else)? Are both success and failure of dual-callback APIs (location, request, etc.) wired up?

---

### 1.2 Do not use a Promise object directly in a condition

```javascript
// ❌ A Promise object is truthy, so this always returns true and permission checks fail
// Reference case: INC-004, multi-environment deploy failed for 22 hours
async function myController(ctx) {
  return ctx.service.checkout.checkPermission() && list.length > 0;
  //     ^^^^ forgot await; this is a Promise object, not a boolean!
}

// ✅ must await
async function myController(ctx) {
  const checkResult = await ctx.service.checkout.checkPermission();
  return checkResult && list.length > 0;
}
```

**CR checkpoint**: Are calls that return a Promise all `await`ed? Do not use a Promise object directly in `&&`, `||`, or `if` conditions.

---

### 1.3 async functions must have a meaningful await

```javascript
// ❌ unnecessary async; wastes work and misleads callers
async function formatName(name) {
  return name.trim().toUpperCase(); // purely sync — why async?
}

// ❌ forgot await, so async is pointless
async function loadAndProcess() {
  const data = fetchData(); // returns a Promise; forgot await
  return process(data);     // data is a Promise, not the payload!
}

// ✅ use async only when there is a real async operation
async function loadAndProcess() {
  const data = await fetchData();
  return process(data);
}
```

**CR checkpoint**: Does the `async` function body have at least one meaningful `await`? If not, remove `async`.

---

## 2. Truthiness Traps (🔴 P0)

### 2.1 Number 0 / empty-string falsy trap

```javascript
// ❌ 0 is a valid business value, but if (count) treats it as "no data"
function renderCount(count) {
  if (count) {
    showCount(count);
  } else {
    showEmpty(); // count = 0 incorrectly shows the empty state!
  }
}

// ✅ check undefined/null explicitly, not falsy
function renderCount(count) {
  if (count != null) {  // count = 0 still displays normally
    showCount(count);
  } else {
    showEmpty();
  }
}

// ❌ string "0" is truthy, but Number("0") is falsy; mixed types make the check unpredictable
const value = "0";
if (value) { /* enters this branch */ }
if (Number(value)) { /* does not enter this branch */ }
```

**CR checkpoint**: When a variable may be numeric `0`, empty string `""`, or `false`, do conditions use `=== 0`, `=== ""`, `!== null` instead of relying on implicit falsy conversion?

---

### 2.2 Use Number.isNaN instead of global isNaN

```javascript
// ❌ global isNaN coerces first; behavior is easy to miss
isNaN('1.2');    // false → '1.2' is coerced to a number, not NaN!
isNaN('hello'); // true

// ✅ Number.isNaN does no coercion; semantics are precise
Number.isNaN('hello'); // false → a string is not NaN, it is a string
Number.isNaN(NaN);     // true ← the only correct NaN
Number.isNaN(Number('hello')); // true ← coerce first, then check
```

**CR checkpoint**: Replace every `isNaN()`/`isFinite()` call with `Number.isNaN()`/`Number.isFinite()`.

---

## 3. Function Side Effects (🟡 P1)

### 3.1 Do not mutate incoming parameter objects

```javascript
// ❌ mutates the caller's object; hidden side effect
function processUser(user) {
  user.role = 'admin'; // the caller's object is changed too!
  user.updatedAt = Date.now();
  return user;
}

// ❌ Object.assign's first argument is the target and mutates original
const merged = Object.assign(original, newData); // original is mutated!

// ✅ create a new object with the spread operator
function processUser(user) {
  return { ...user, role: 'admin', updatedAt: Date.now() };
}

// ✅ use an empty object as the first argument
const merged = Object.assign({}, original, newData);
const merged2 = { ...original, ...newData };
```

**CR checkpoint**: Does the function assign to properties of an incoming object? Is `Object.assign`'s first argument the original reference?

---

### 3.2 Arrow functions that return an object literal must wrap it in parentheses

```javascript
// ❌ braces are parsed as a function body, not an object literal; returns undefined
const getConfig = () => { timeout: 5000 };   // function body, not an object!
const items = list.map(item => { id: item.id }); // same

// ❌ same mistake with a React component prop default
function MyComp({ config = () => {} }) {
  config.theme; // TypeError: config is a function, not an object
}

// ✅ wrap the object literal in parentheses
const getConfig = () => ({ timeout: 5000 });
const items = list.map(item => ({ id: item.id }));

// ✅ React prop defaults should be an object
function MyComp({ config = {} }) {
  config.theme; // safe
}
```

**CR checkpoint**: When an arrow function implicitly returns an object (no `return` keyword), is it wrapped in `({...})`?

---

## 4. Switch Fall-Through (🔴 P0)

### 4.1 Every non-empty case must have break or return

```javascript
// ❌ missing break; fall-through overwrites the config
// Reference case: INC-003
switch (moduleType) {
  case 'address':
    config = getAddressConfig();
    // ❌ no break, execution continues into the payment case!
  case 'payment':
    config = getPaymentConfig(); // the address module ran this too
    break;
}

// ✅ every non-empty case has a clear exit
switch (moduleType) {
  case 'address':
    config = getAddressConfig();
    break; // ← required
  case 'payment':
    config = getPaymentConfig();
    break;
  default:
    config = getDefaultConfig();
}
```

**CR checkpoint**: In a `switch`, does every `case` with executable logic have `break`, `return`, or `throw`? Intentional fall-through needs a `// falls through` comment.

---

## 5. JSON Parse Protection (🔴 P0)

### 5.1 JSON.parse must be protected by try-catch

```javascript
// ❌ if the backend payload is malformed, JSON.parse throws and all later rendering is blocked
// Reference case: INC-005, checkout tip message not shown for 7 days
const data = JSON.parse(message.content);
renderMessage(data);

// ✅ protect with try-catch, and the catch block must not be empty
let data = null;
try {
  data = JSON.parse(message.content);
} catch (e) {
  console.error('Failed to parse message content:', e, message); // ← must log
  data = { type: 'unknown' }; // ← fallback data; do not block rendering
}
renderMessage(data);
```

**CR checkpoint**: Do all `JSON.parse()` calls have `try-catch`? Does the `catch` block log and provide a fallback (not an empty block)?

---

## 6. Money Precision (🔴 P0)

### 6.1 Do not use floating-point arithmetic for money / points / discounts

```javascript
// ❌ floating-point precision causes incorrect money math
// Reference case: INC-006, financial loss ¥50,000
const amount = 16.9;
const discounted = amount * 0.9; // = 15.209999999999999, rounding goes wrong!

// ✅ option 1: integer arithmetic in cents
const amountCents = 1690;
const discountedCents = Math.floor(amountCents * 90 / 100); // = 1521
const display = discountedCents / 100; // = 15.21

// ✅ option 2: exact math with decimal.js
import Decimal from 'decimal.js';
const result = new Decimal(16.9).mul(0.9).toFixed(2); // "15.21"
```

**CR checkpoint**: For money, points, or discount arithmetic, is integer (cents) math or `decimal.js` used? Do not multiply/divide floats and then round.

---

## 7. Variable Shadowing (🟡 P1)

### 7.1 Do not declare a nested variable with the same name as an outer one

```javascript
// ❌ inner error shadows outer error, so the outer catch uses the wrong variable
let error = null;
try {
  await fetchData();
} catch (error) {     // ← shadows the outer error!
  logError(error);    // here error is the new one
}
setError(error);      // here error is the outer null, not the error just caught!

// ✅ use different names
let capturedError = null;
try {
  await fetchData();
} catch (fetchError) {
  logError(fetchError);
  capturedError = fetchError;
}
setError(capturedError);
```

**CR checkpoint**: Do `catch (e)` parameters, loop variables, or callback parameters share names with outer-scope variables? Pay special attention to `catch` parameters shadowing outer variables.

---

## 8. Magic Numbers (🟡 P1)

### 8.1 Magic numbers in business logic must be named constants

```javascript
// ❌ magic numbers; meaning is unclear and they cannot be changed globally
if (status === 3) {
  showRefundButton();
}
setTimeout(retry, 5000);

// ✅ meaningful constant names
const ORDER_STATUS = {
  PENDING: 1,
  PAID: 2,
  REFUNDING: 3,
  COMPLETED: 4,
};
const RETRY_DELAY_MS = 5000;

if (status === ORDER_STATUS.REFUNDING) {
  showRefundButton();
}
setTimeout(retry, RETRY_DELAY_MS);
```

**CR checkpoint**: Are hardcoded numbers in conditions, array indexes, delays, and ratios defined as named constants? Pay special attention to business status codes.

---

## 8.5 Promise.all missing parentheses (🟡 P1)

```javascript
// ❌ missing parentheses → you passed a function reference, not a Promise; it never runs
await Promise.all([
  fetchUser,    // ← function, not a Promise!
  fetchOrders() // ← this one is correct
]);

// ✅ every element is a call result
await Promise.all([
  fetchUser(),
  fetchOrders()
]);

// ✅ when timeout protection is needed
const TIMEOUT_MS = 5000;
await Promise.all([
  Promise.race([fetchUser(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))]),
  fetchOrders()
]);
```

**CR checkpoint**: Does every item in the `Promise.all([...])` array have `()`? Especially check object method references (`service.fetch` vs `service.fetch()`).

---

## 9. High-Frequency CR Issues Cheat Sheet

| Issue | Severity | Quick identification |
|------|---------|---------|
| Incomplete Promise branches | P0 | `new Promise` has `if` but no `else` resolve/reject |
| Promise object used in a condition | P0 | Missing `await`; async result used directly in `&&`/`if` |
| async without await | P1 | `async function` body has no `await` |
| Number 0 / empty-string falsy trap | P0 | `if (count)` instead of `if (count != null)` |
| Mutating function parameters | P1 | `param.xxx = ...` or `Object.assign(param, ...)` |
| Arrow function returning an object without parentheses | P1 | `() => { key: val }` instead of `() => ({ key: val })` |
| Missing switch break | P0 | case ends without break/return |
| JSON.parse without try-catch | P0 | Bare `JSON.parse(...)` |
| Floating-point money math | P0 | Money computed with `* 0.x` |
| isNaN instead of Number.isNaN | P1 | Global `isNaN()` call |
| Variable shadowing | P1 | catch/callback name matches an outer name |
| Magic numbers | P1 | Unnamed `=== 1`/`=== 3` etc. |
| Oversized integer IDs as number | P1 | `siteId: number` and the value may exceed MAX_SAFE_INTEGER |
| `value === NaN` | P1 | Always false; use `Number.isNaN(value)` |
| Loop `i <= arr.length` | P1 | Last access `arr[length]` is undefined |

---

## 10. Oversized Integer IDs Must Be string

Business IDs (resources, orders, accounts) that exceed `Number.MAX_SAFE_INTEGER` (2^53-1) must be received as `string`. Using `number` silently loses precision, so later comparisons or submits will not match the server.

```ts
// ❌
const siteId: number = response.siteId;

// ✅
const siteId: string = response.siteId;
```

**CR checkpoint**: Are new/changed ID fields typed as `string`? Were oversized numbers in JSON first turned into number by `JSON.parse`?

---

## 11. Exceptions Used as Control Flow

Do not use throw/catch for a normal branch that an `if` can express. Leave try-catch for real failure paths.

```js
// ❌ using exceptions instead of a condition
try {
  if (!user) throw new Error('skip');
  render(user);
} catch {
  renderGuest();
}

// ✅
if (!user) {
  renderGuest();
} else {
  render(user);
}
```

---

## 12. Ban `=== NaN`

`NaN === NaN` is always false. Check NaN with `Number.isNaN` (complements §2.2: that section bans global `isNaN()`; this one bans `=== NaN`).

```js
// ❌
if (value === NaN) { /* never enters */ }

// ✅
if (Number.isNaN(value)) { ... }
```

---

## 13. Recursion Must Have a Termination Condition

A recursive function must show when it stops calling itself and whether depth is bounded. No visible exit, or a termination condition that depends on unvalidated external data → P1.

```js
// ❌ no depth limit; a cyclic tree will blow the stack
function walk(node) {
  node.children.forEach(walk);
}

// ✅
function walk(node, depth = 0) {
  if (!node || depth > 32) return;
  (node.children || []).forEach((child) => walk(child, depth + 1));
}
```

---

## 14. Conditions Must Be Able to Be True or False

Avoid always-true / always-false or self-contradictory checks.

```js
// ❌
if (true) { ... }
if (x !== x) { ... } // always false except for NaN
if (a > 10 && a < 5) { ... }

// ✅
if (status === 'active' && count > 0) { ... }
```

---

## 15. Loop Bounds

Indexes must fall in `[0, length)`. `i <= arr.length` reads `undefined` on the last iteration.

```js
// ❌
for (let i = 0; i <= arr.length; i += 1) {
  use(arr[i]);
}

// ✅
for (let i = 0; i < arr.length; i += 1) {
  use(arr[i]);
}
```
