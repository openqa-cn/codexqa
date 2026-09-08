# Team Coding Conventions

> Convention source priority: target repo `code-reviewer.config.json` (or `.code-reviewer.json`) > README / contributing guide > examples in this file. Skip items that do not apply. Do not treat them as cross-project hard bans, and do not call unconfigured external services.

---

## 1. Naming

### File names

| Type | Convention | Examples |
|------|------|------|
| Component files | PascalCase.tsx | `UserCard.tsx`, `CheckoutList.tsx` |
| Style files | kebab-case.module.scss | `user-card.module.scss` |
| Hook files | use + PascalCase.ts | `useUserData.ts`, `useOrderList.ts` |
| Utility functions | camelCase.ts | `formatDate.ts`, `moneyUtils.ts` |
| Constant files | camelCase or UPPER_SNAKE_CASE | `orderStatus.ts`, `ROUTE_CONFIG.ts` |

### Variable / function names

```typescript
// ✅ API request functions: requestXxx prefix, distinguished by operation
requestGetUserList()       // query
requestCreateOrder()       // create
requestUpdateCheckout()    // update
requestDeleteDiscount()    // delete

// ✅ type definitions: PascalCase + semantic suffix
interface UserDTO {}          // data transfer object
interface CreateOrderReq {}   // request body
interface GetListResponse {}  // response body

// ✅ constants: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const DEFAULT_PAGE_SIZE = 20;

// ✅ enums: PascalCase (members all caps)
enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
}

// ✅ MobX Store: raw prefix for raw API data; getters for derived data
class UserStore {
  rawUserList: UserDTO[] = [];           // raw prefix = raw API data
  get activeUsers() {                    // getter = derived data
    return this.rawUserList.filter(u => u.status === 'ACTIVE');
  }
}

// ✅ booleans: is/has/can prefix
isLoading, hasPermission, canSubmit

// ✅ event handlers: handle prefix
handleSubmit, handleClick, handleSearch
```

---

## 2. Directory Structure

```
src/
  pages/                       # pages and routes
  components/                  # UI components
  stores/                      # MobX Store (business logic)
  api/                         # hand-edits banned only when README / generator marks it generated
  lib/                         # infrastructure (HTTP wrapper, logging, etc.)
  hooks/                       # custom Hooks
  modules/                     # components / Hooks grouped by business module
```

**Call direction (strictly one-way)**:

```
src/pages/ + src/components/ (UI)
    ↓  useStore() / custom Hook
src/stores/ (MobX Store, business logic)
    ↓  import API functions
src/api/ (hand-written or generated; components must not depend upward)
```

If the README says "components only go through Store / Hook", do not import `src/api/` from a page. Skip this when that layering is not documented.

---

## 3. Component Design

### File content order (must follow this order)

```tsx
// 1. import statements (external libs → internal modules → styles)
import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import styles from './user-card.module.scss';

// 2. interface / type definitions (Props types, etc.)
interface UserCardProps {
  userId: string;
  onFollow?: () => void;
}

// 3. component implementation
const UserCard: React.FC<UserCardProps> = observer(({ userId, onFollow }) => {
  // ...
});

// 4. export (named or default)
export default UserCard;
```

### Component rules

```typescript
// ✅ components that react to MobX data must be wrapped in observer()
const UserList = observer(() => {
  const { userStore } = useStore();
  return <div>{userStore.activeUsers.map(...)}</div>;
});

// ❌ forgot observer: the component will not re-render when store data changes
const UserList = () => {
  const { userStore } = useStore();
  return <div>{userStore.activeUsers.map(...)}</div>; // will not react to store changes!
};
```

**Component size limit**: a single component file must not exceed **300 lines**; split into child components or Hooks if it does.

**Props depth limit**: the same data must not be passed down more than **3 layers**; beyond that, use a MobX Store or React Context.

---

## 4. API Request Conventions

### Core rules

```typescript
// ✅ if the project documents "src/api is generated", only call it; do not edit generated files
// file headers usually include "// This file is auto-generated"
import { requestGetUserList } from 'src/api/userApi';

// ✅ call APIs in the Store; components access data via useStore()
class UserStore {
  rawUserList: UserDTO[] = [];

  async fetchUserList(params: GetUserListReq) {
    const res = await requestGetUserList(params);
    runInAction(() => {
      this.rawUserList = res.data.list;
    });
  }
}

// ❌ do not call API functions directly from UI components
function UserPage() {
  useEffect(() => {
    requestGetUserList({ page: 1 }); // ❌ component-layer API call bypasses the Store
  }, []);
}

// ❌ skip the project's existing request wrapper (path per README)
import axios from 'axios';
fetch('/api/users');
```

### HTTP library (optional handwritten convention)

If config has `conventions.httpWrapper` or the README names a shared HTTP wrapper (for example `src/lib/http`), new code uses the wrapper, not raw `axios`/`fetch`. Without that convention, do not treat "must use a private wrapper package" as a defect.

---

## 5. State Management (MobX)

**Convention**: keep the state library the repo already chose. Do not introduce a second one in the same feature. Examples below use MobX because the sample app does.

```typescript
// ✅ standard Store shape
import { makeAutoObservable, runInAction } from 'mobx';

class OrderStore {
  // raw data (raw prefix)
  rawOrderList: OrderDTO[] = [];
  isLoading = false;
  error: Error | null = null;

  constructor() {
    makeAutoObservable(this);   // ✅ must be called in the constructor
  }

  // derived data via getters (automatically computed)
  get pendingOrders() {
    return this.rawOrderList.filter(o => o.status === OrderStatus.PENDING);
  }

  // ✅ async work: state changes after await must be inside runInAction
  async fetchOrderList(params: GetOrderListReq) {
    this.isLoading = true;        // ✅ sync assignment can stay in the action
    try {
      const res = await requestGetOrderList(params);
      runInAction(() => {          // ✅ state changes after await must be in runInAction
        this.rawOrderList = res.data.list;
        this.isLoading = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e as Error;
        this.isLoading = false;
      });
    }
  }
}

// ❌ wrong: assign after await; MobX strict mode throws
async fetchOrderList() {
  const res = await requestGetOrderList();
  this.rawOrderList = res.data.list;  // ❌ must go in runInAction
}

// ✅ get the Store instance via the useStore() hook
function OrderPage() {
  const { orderStore } = useStore();
  // ...
}

// ❌ do not new Store inside a component (breaks the singleton)
function OrderPage() {
  const store = new OrderStore(); // ❌
}

// ❌ do not mutate observable properties outside the Store
const { orderStore } = useStore();
orderStore.rawOrderList = [];    // ❌ must mutate via a Store action
```

---

## 6. Style Conventions

```scss
// ✅ use CSS Modules; file name kebab-case.module.scss
// user-card.module.scss
.container { ... }
.header { ... }
.title { ... }

// import in the component
import styles from './user-card.module.scss';
<div className={styles.container}>

// ❌ ban inline style for purely static values
<div style={{ color: 'red', fontSize: 14 }}>  // ❌

// ✅ dynamic values may be inline (inline only when JS must compute them)
<div style={{ width: `${progress}%` }}>       // ✅ dynamic width

// ❌ ban global CSS class names (easy to pollute)
import './user-card.css';   // ❌ use .module.scss
```

---

## 7. Comment Conventions

```typescript
// ✅ public functions/Hooks must have JSDoc
/**
 * Fetch a user's order list
 * @param userId user ID
 * @param pageSize page size, default 20
 * @returns order list, newest created first
 */
async function fetchUserOrders(userId: string, pageSize = 20): Promise<OrderDTO[]> { }

// ✅ comment complex business logic for "why", not "what"
// refunds remain allowed for 24h after payment; after that the status becomes non-refundable
const canRefund = order.status === 'PAID' &&
  Date.now() - order.paidAt < 24 * 60 * 60 * 1000;

// ❌ do not commit commented-out code (recover it from git)
// const oldLogic = calculateDiscount(amount);
```

---

## 8. Test Conventions

```
Core business logic (money math, auth checks, state transitions): coverage recommended
Utilities (utils/, constants/): coverage recommended
Pure presentational components: optional
Code marked generated: no hand-written tests required

Test file location: __tests__/ in the same directory, or *.test.ts
```

---

## 9. Git Commit Conventions

```
feat:     new feature
fix:      bug fix
refactor: refactor (no behavior change, no new bugs)
perf:     performance
test:     tests
chore:    build / tooling / dependency updates
docs:     documentation

examples:
  feat(checkout): add customer fields on the checkout page
  fix(order): fix refund amount precision
  refactor(user): split the user-info Store into a standalone module
```

---

## 10. Review Bans (Check Against Target-Repo Conventions)

Use the following as a checklist against **handwritten conventions in the target repo**. Skip any row that has no matching README / generator note; do not treat it as a hard ban of this skill:

| # | Forbidden | Correct approach |
|---|---------|---------|
| 1 | Hand-editing files the README / generator marks as generated | Change the API definition or generator config, then regenerate |
| 2 | Introducing a second state library in the same feature | Keep the one the repo already chose |
| 3 | Bumping React to a new major version on its own | Majors have breaking changes; the repo maintainers must decide as a whole |
| 4 | Floating-point arithmetic on money fields | Use integer cents or the project's money utility |
| 5 | Mutating observable properties outside the Store | Mutate via a Store action or `runInAction` |
| 6 | Top-level `await` outside `useEffect` | Wrap in an `async function` and call it from `useEffect` |

---

## 11. Optional Handwritten Conventions (Enable Only When the Target Repo Documents Them)

> Stacks on top of the general conventions. Skip the whole section when there is no matching README / contributing-guide item.

### 🔴 P0 Extra Rules (must fix)

**1. Generated files are banned from hand-edits only when a handwritten convention says so**

```javascript
// only when the README, generator, or file header marks generated:
// ❌ do not hand-edit variables or enums in generated output
// if generation is wrong, change the API definition or generator config, then regenerate
// handwritten src/api modules are not covered by this rule
```

**2. Large pnpm/yarn lockfile changes**

```
❌ large lockfile content changes (more than 10 lines of material change)
    reason: node or pnpm/yarn version is not pinned, so lockfile versions drift and unknown dependency versions appear

✅ how to check:
    - are lockfile changes limited to newly added direct dependencies?
    - did a node/pnpm version change cause a full recalc? reject the merge and align versions first
```

---

### 🟡 P1 Extra Rules (strongly recommended)

**3. Do not overuse optional chaining (excessive null checks)**

```javascript
// ❌ overuse: optional chaining on objects that always exist hides real type issues
const name = this.currentUser?.name;     // if currentUser always exists, ? is redundant
const id = response.data?.user?.id;      // if the API guarantees data and user, ? hides failures

// ✅ null-check values that can actually be empty; access definite values directly
const name = this.currentUser.name;       // clearly states: this value is always present
const id = response.data.user?.id;        // use ? only when the id field itself is uncertain
```

**CR checkpoint**: Is each `?.` justified? If the type system already says a path is non-null, `?.` is a bug risk (a place that should throw is silenced).

**4. Do not rethrow empty exceptions**

```javascript
// ❌ catch then throw with no extra handling; better not to catch
try {
  await saveOrder(data);
} catch (e) {
  throw e; // pointless; wastes the catch opportunity
}

// ❌ swallow the exception; callers cannot see the error
try {
  await saveOrder(data);
} catch (e) {
  // empty catch; the error vanished
}

// ✅ catch either handles (log / fallback / wrap the error type) or is omitted
try {
  await saveOrder(data);
} catch (e) {
  logger.error('Failed to save order', { orderId: data.id, error: e });
  throw new OrderSaveError('Save failed, please retry', { cause: e }); // wrap as a business error
}
```

---

### Process rules

| Violation | Notes |
|---------|------|
| Insufficient self-test | Obvious bugs found after CR; must resubmit |
| Merging with unresolved P0 | Reviewer marked P0 and it was merged unfixed |
| Merging to main while bypassing CR | Merged without review |
| Review comments unanswered for over 48 hours | — |

---

## 12. Inclusive Language

Do not use `whitelist` / `blacklist` for allow/deny sets. New code uses `allowList` / `denyList` (or `allowed` / `denied`). Review only new identifiers in this diff; do not require a repo-wide rename. Style issue → **P2**.

```ts
// ❌
const whitelist = ['admin'];
if (blacklist.includes(userId)) { ... }

// ✅
const allowList = ['admin'];
if (denyList.includes(userId)) { ... }
```

---

## 13. Function Parameters Must Not Exceed 4

More than 4 positional parameters → switch to an options object (or split the function). Especially do not line up a long list of boolean flags. Style issue → **P2**.

```ts
// ❌
function createOrder(customerId, skuId, quantity, licenseId, note) { ... }

// ✅
function createOrder(options: {
  customerId: string;
  skuId: string;
  quantity: number;
  licenseId?: string;
  note?: string;
}) { ... }
```
