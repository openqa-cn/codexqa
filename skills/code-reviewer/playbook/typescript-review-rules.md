# TypeScript CR Critical Rules

> Includes only rules that require semantic understanding. Formatting issues covered by ESLint static checks are out of scope.

## 📋 Rule Quick-Reference Index

| Section | Rule | Severity | Quick identification |
|------|------|------|------------|
| §1 | any abuse | P0 | `: any` or `as any` in core logic |
| §2 | Type assertion without a guard | P0 | `as User` with no prior `instanceof`/`in`/property check |
| §2 | `?.!` chain | P0 | `obj?.prop!` optional chaining followed by `!` |
| §3 | async function missing Promise return type | P1 | `async function fn()` without `: Promise<T>` |
| §4 | enum not explicitly initialized | P1 | `enum Status { A, B }` with no numeric assignment |
| §4 | enum mixing numbers/strings | P1 | Same enum has both `= 1` and `= 'x'` |
| §5 | Commas instead of semicolons in interface | P2 | `{ name: string, age: number }` |
| §5 | Overriding a parent method without override | P1 | Subclass method matches parent name but has no `override` keyword |
| §6 | Missing import type | P1 | `import { SomeType }` instead of `import type { SomeType }` |
| §8 | `delete` only on object properties | P1 | TypeScript | `delete orders[i]` on an array |
| §9 | `for...in` must filter own properties | P1 | TypeScript | `for (const k in obj)` with no `hasOwn` / `Object.keys` |
| §10 | `Array.sort` needs a compare for numbers | P1 | TypeScript | `[10, 2].sort()`; sort of `price` / `amount` |
| §11 | `super()` before `this` in a subclass | P1 | TypeScript | `this.x` before `super()`; missing `super()` |
| §12 | `for` update must move toward the end | P1 | TypeScript | `for (i = 0; i < n; i--)` |
| §13 | `parseInt` must pass a radix | P1 | TypeScript | `parseInt(raw)` with one argument |
| §14 | `=+` / `=-` / `=!` are not `+=` / `-=` / `!=` | P1 | TypeScript | `count =+ 1`; `flag =! flag` |
| §15 | Create an `Error` only to throw it; do not use a void return | P1 | TypeScript | `new Error("…")` unused; `const x = log()` |
| §16 | `try` does not catch a Promise reject without `await` | P1 | TypeScript | `try { fetch() } catch` with no `await` |
| §17 | Exclusive tests must not land | P1 | TypeScript | `it.only` / `describe.only` / `fit` / `fdescribe` |
| §18 | No `return` / `throw` / `break` in `finally` | P1 | TypeScript | `finally { return }` |
| §19 | Negate `in` / `instanceof`, not the left operand | P1 | TypeScript | `!key in map`; `!obj instanceof Order` |
| §20 | Template placeholders do not work in quotes | P1 | TypeScript | `'Hello ${name}'` |
| §21 | Hardcoded IP addresses are security-sensitive | P2 | TypeScript | `'10.0.0.1'` / `'192.168.'` in source |

---

## 1. any Type Usage Rules (🔴 P0)

### 1.1 Do not use any in core logic

```typescript
// ❌ using any to dodge type checks and hide real problems
function processOrder(data: any) {
  return data.price * data.quantity; // may blow up at runtime
}

// ✅ define a concrete interface
interface OrderData {
  price: number;
  quantity: number;
}
function processOrder(data: OrderData) {
  return data.price * data.quantity;
}
```

**Legitimate uses of any** (must comment why):
- Temporary handling when a third-party library has no type declarations
- Intermediate steps in type-level programming
- Transitional JS → TS code (mark with `// TODO: add types`)

### 1.2 Do not access members of an any type

```typescript
// ❌ reading properties from any; type safety is completely lost
declare const response: any;
const userId = response.data.user.id; // chained access on any is extremely dangerous

// ✅ assert or narrow the type first
interface ApiResponse { data: { user: { id: string } } }
const typed = response as ApiResponse;
const userId = typed.data.user.id;
```

### 1.3 Function parameters and return values must not involve any

```typescript
// ❌
function foo1() { return 1 as any; }
function foo2(data: any) { return data.value; }

// ✅ exported functions must explicitly annotate parameter and return types
export function processData(data: UserData): ProcessedResult {
  return transform(data);
}
```

---

## 2. Type Assertion Rules (🔴 P0)

### 2.1 Do not make unjustified type assertions

```typescript
// ❌ assert directly without validating the shape; may crash at runtime
const user = apiResponse.data as User;
user.email.toLowerCase(); // if email is actually undefined, this throws

// ✅ validate with a type guard first
function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'email' in data;
}
if (isUser(apiResponse.data)) {
  apiResponse.data.email.toLowerCase(); // safe
}

// ✅ or fall back with optional chaining + nullish coalescing
const email = (apiResponse.data as User)?.email ?? '';
```

### 2.2 Do not make unnecessary type assertions

```typescript
// ❌ type is already known; the assertion is redundant
const foo = 3;
const bar = foo as number; // foo is already number

// ❌ chained non-null assertions
const val = obj!!!.prop;

// ✅ assert only when needed, and back the assertion with a type guard
```

### 2.3 Do not use a non-null assertion after optional chaining

```typescript
// ❌ contradictory: ? means it may be empty, ! means it is definitely not empty
foo?.bar!;
foo?.bar()!;

// ✅
foo?.bar ?? defaultValue;
```

---

## 3. Async Type Rules (🟡 P1)

### 3.1 Functions that return a Promise must annotate the return type

```typescript
// ❌ unannotated; callers cannot know the resolve type
const fetchUser = () => Promise.resolve({ id: 1, name: 'Alice' });

// ✅ annotate explicitly
const fetchUser = (): Promise<User> => Promise.resolve({ id: 1, name: 'Alice' });

async function loadData(): Promise<DataResult> {
  const response = await api.get('/data');
  return response.data;
}
```

---

## 4. Enum Rules (🟡 P1)

### 4.1 Enum members must be explicitly initialized; do not mix numbers and strings

```typescript
// ❌ implicit increment; reordering changes values
enum Status {
  Open = 1,
  Close, // implicit = 2, fragile
}

// ❌ mixing numbers and strings
enum Mixed {
  A = 0,
  B = 'B', // mixed!
}

// ✅ all explicit; all strings (preferred) or all numbers
enum Status {
  Open = 'Open',
  Close = 'Close',
  Pending = 'Pending',
}
```

### 4.2 Enum members must not share the same value

```typescript
// ❌ two members have the same value; logic error
enum Direction {
  Up = 0,
  Down = 0, // duplicate!
}

// ✅
enum Direction {
  Up = 0,
  Down = 1,
}
```

---

## 5. Interface / Type Rules (🟡 P1)

### 5.1 Type imports must use import type

```typescript
// ❌ runtime import, but it is only used as a type
import { User } from './types';
const x: User = {};

// ✅ erased at compile time; does not affect the bundle
import type { User } from './types';
const x: User = {};
```

### 5.2 Interface members end with semicolons, not commas

```typescript
// ❌
interface Foo {
  name: string,
  age: number,
}

// ✅
interface Foo {
  name: string;
  age: number;
}
```

### 5.3 Overriding a parent method must use explicit override

```typescript
// ❌ silent override; easy to miss during refactors
class Child extends Base {
  setup() {} // no override; unclear whether this is an override or a new method
}

// ✅
class Child extends Base {
  override setup() {}
}
```

---

## 6. Module Rules (🟡 P1)

### 6.1 Distinguish values and types explicitly when exporting

```typescript
// ❌ mixed export; unclear which names are types
export { Button, ButtonProps };

// ✅ export types separately with export type
export { Button };
export type { ButtonProps };
```

---

## 7. High-Frequency CR Issues Cheat Sheet

| Issue | Severity | Quick identification |
|------|---------|---------|
| any in core logic | P0 | `: any` / `as any` |
| Type assertion without a guard | P0 | `as SomeType` with no prior isXxx check |
| Non-null assertion after optional chaining | P1 | `?.xxx!` |
| Enum value not explicitly initialized | P1 | enum member has no `=` assignment |
| Promise return type not annotated | P1 | `async function foo()` has no return type |
| Type import not using import type | P1 | used only as a type but imported as a value |
| Class property not initialized | P1 | class property declared but not assigned in the constructor |

---

## 8. `delete` only on object properties

`delete` removes an object property. On an array it leaves a hole (`length` unchanged) and breaks iteration. Use `splice` / `filter` / a `Map`. `Lang: TypeScript`.

```typescript
// ❌
delete orders[index];

// ✅
orders.splice(index, 1);
```

---

## 9. `for...in` must filter own properties

`for...in` walks the prototype chain. Use `Object.hasOwn` / `Object.keys` / `for...of`. `Lang: TypeScript`.

```typescript
// ❌
for (const key in order) {
  total += order[key];
}

// ✅
for (const key of Object.keys(order)) {
  total += order[key];
}
```

---

## 10. `Array.sort` needs a compare for numbers

Default `sort` is lexicographic: `[10, 2]` becomes `[10, 2]`. Numeric / money / date fields need an explicit compare. Money still goes through G6. `Lang: TypeScript`.

```typescript
// ❌
amounts.sort();

// ✅
amounts.sort((a, b) => a - b);
```

---

## 11. `super()` before `this` in a subclass

A derived constructor must call `super()` before reading or writing `this`. `Lang: TypeScript`.

```typescript
// ❌
constructor(customerId: string) {
  this.customerId = customerId;
  super();
}

// ✅
constructor(customerId: string) {
  super();
  this.customerId = customerId;
}
```

---

## 12. `for` update must move toward the end

The update clause must approach the end condition (`i++` when `i < n`, `i--` when `i > 0`). Complements `javascript-review-rules.md` §15 and does **not** retune it. `Lang: TypeScript`.

```typescript
// ❌
for (let i = 0; i < orders.length; i--) { /* … */ }

// ✅
for (let i = 0; i < orders.length; i++) { /* … */ }
```

---

## 13. `parseInt` must pass a radix

`parseInt(raw)` can treat a leading `0` as octal in older engines. Always pass `10` (or `16` when hex is intended). `Lang: TypeScript`.

```typescript
// ❌
const count = parseInt(raw);

// ✅
const count = parseInt(raw, 10);
```

---

## 14. `=+` / `=-` / `=!` are not `+=` / `-=` / `!=`

`count =+ 1` assigns `+1`; `flag =! flag` assigns `!flag` once, it does not toggle with `!=`. Complements `go-review-rules.md` §16 and does **not** retune it. `Lang: TypeScript`.

```typescript
// ❌
count =+ 1;
flag =! flag;

// ✅
count += 1;
flag = !flag;
```

---

## 15. Create an `Error` only to throw it; do not use a void return

`new Error("…")` with no `throw` / `reject` is a no-op. Do not assign the result of a function that returns `void`. `Lang: TypeScript`.

```typescript
// ❌
new Error("order missing");
const out = persist(order); // persist returns void

// ✅
throw new Error("order missing");
persist(order);
```

---

## 16. `try` does not catch a Promise reject without `await`

`try { loadOrders() } catch` does not handle a rejected Promise. Use `await` or `.catch`. Complements `javascript-review-rules.md` §1.2 and does **not** retune it. `Lang: TypeScript`.

```typescript
// ❌
try {
  loadOrders();
} catch (e) {
  recover(e);
}

// ✅
try {
  await loadOrders();
} catch (e) {
  recover(e);
}
```

---

## 17. Exclusive tests must not land

`it.only` / `describe.only` / `fit` / `fdescribe` / `test.only` hide the rest of the suite. Do not commit them. This is not the deprecated “failed tests must be fixed” gate. `Lang: TypeScript`.

```typescript
// ❌
it.only("charges the order", async () => { /* … */ });

// ✅
it("charges the order", async () => { /* … */ });
```

---

## 18. No `return` / `throw` / `break` in `finally`

A jump in `finally` swallows the `try` exception (same atom as `java-review-rules.md` §8). Do **not** retune the Java card. `Lang: TypeScript`.

```typescript
// ❌
try {
  return charge(order);
} finally {
  return cached;
}

// ✅
try {
  return charge(order);
} finally {
  lock.release();
}
```

---

## 19. Negate `in` / `instanceof`, not the left operand

`!key in map` is `(!key) in map`, not a membership check. Use `!(key in map)` / `!(obj instanceof Order)`. `Lang: TypeScript`.

```typescript
// ❌
if (!key in order) { /* … */ }

// ✅
if (!(key in order)) { /* … */ }
```

---

## 20. Template placeholders do not work in quotes

`'Hello ${name}'` / `"Hello ${name}"` is a literal dollar-brace, not interpolation. Use a template literal. `Lang: TypeScript`.

```typescript
// ❌
const label = "Order ${orderId}";

// ✅
const label = `Order ${orderId}`;
```

---

## 21. Hardcoded IP addresses are security-sensitive

Literal `10.*` / `192.168.*` / `127.0.0.1` / public IPs in source couple the client to one host and leak topology. Prefer config / DNS. This is **not** G5 (secrets) and does not retune G5. `Lang: TypeScript`.

```typescript
// ❌
const host = "10.1.2.3";

// ✅
const host = process.env.ORDER_HOST ?? "orders.example.com";
```
