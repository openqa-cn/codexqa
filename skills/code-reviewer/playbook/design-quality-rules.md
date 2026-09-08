# Software Design Quality CR Rules

> This document covers "design-layer" issues — not coding-style mistakes, but structural / responsibility / extensibility defects.
> **Key principle**: report only issues with concrete evidence in the diff. Do not emit unfounded generic advice such as "consider refactoring".
> Rules here are usually P1/P2; raise to P0 only when a performance issue causes user-visible jank, or a robustness defect is certain to fire.

---

## 📋 Rule Quick-Reference Index

| Section | Rule | Severity | Detectable signal |
|------|------|------|-----------|
| §1.1 | Repeated API calls inside a loop (N+1) | P0/P1 | Loop body contains `await fetch`/`axios`/`request` |
| §1.2 | Expensive work on a high-frequency render path | P1 | `filter`/`map`/`sort` in a render function/component with no `useMemo` |
| §1.3 | Importing a tree-shakable library as a whole package | P1 | `import _ from 'lodash'` instead of `import debounce from 'lodash/debounce'` |
| §2.1 | Missing boundary-condition handling | P1 | Array/object accessed without a null check; empty array/object not handled |
| §2.2 | Network requests with no timeout | P1 | `fetch`/`axios` call has no `timeout` and is not handled by a shared framework |
| §2.3 | Missing loading/error state | P1 | Async request exists but the component has no matching `isLoading`/`error` state |
| §3.1 | Duplicated logic (DRY violation) | P1 | Similar blocks >10 lines appear 3+ times and can be abstracted into a function/Hook |
| §3.2 | Hardcoded props (should be parameterized) | P1 | Component has business-bound hardcoded strings/numbers that should come from props |
| §3.3 | Deep props drilling | P2 | The same data is passed down through 3+ component layers |
| §4.1 | God Component | P1 | A single component >300 lines with multiple unrelated responsibilities |
| §4.2 | Business logic leaking into the UI layer | P1 | Component has complex conditions/transforms not extracted to a hook/service |
| §4.3 | Switch-based type dispatch (prefer Strategy) | P2 | `switch(type)` has 4+ cases and will keep growing |
| §5.1 | Cross-layer dependency | P1 | UI component calls a low-level service/store method, bypassing the agreed layer |
| §5.2 | Types defined in the wrong place | P2 | Business types scattered inside component files instead of a types/ directory |
| §6.1 | Magic strings (also in the JS rules; business cases here) | P1 | Route paths / event names / status values hardcoded as string literals |
| §6.2 | Config coupled to logic | P1 | Enums / thresholds / flags scattered in business logic and cannot be changed independently |
| §7.1 | No runInAction after await | P0 | Store async method assigns `this.xxx =` after `await` without `runInAction` |
| §7.2 | MobX data used without observer | P1 | Component calls `useStore()` but the function is not wrapped in `observer(` |
| §7.3 | Observable mutated outside the store | P1 | Component/Hook has `someStore.xxx =` assignment |
| §8 | Circular import between any modules A↔B | P1 | Two files import each other (not limited to Store↔UI) |
| §9 | Selector nesting no deeper than 3 levels | P2 | `.a { .b { .c { .d { } } } }` |

---

## 1. Performance Traps (Detectable in the Diff)

### 1.1 Repeated API calls inside a loop (N+1)

```typescript
// ❌ N+1: N userIds means N requests; large data freezes the page
async function renderUserList(userIds: string[]) {
  for (const id of userIds) {
    const user = await getUserById(id);  // ← await inside the loop
    renderUser(user);
  }
}

// ❌ same problem; forEach + async is easier to miss
userIds.forEach(async (id) => {
  const user = await getUserById(id);   // ← forEach does not await, and concurrency is unbounded
});

// ✅ batch API or Promise.all
async function renderUserList(userIds: string[]) {
  // option 1: batch API (preferred)
  const users = await getUsersByIds(userIds);

  // option 2: Promise.all (when there is no batch API); cap concurrency
  const users = await Promise.all(userIds.map(id => getUserById(id)));
  users.forEach(renderUser);
}
```

**CR checkpoint**: Does a loop body (`for`/`forEach`/`map`) `await` an API? If it cannot become a batch call, at least use `Promise.all` and check that concurrency is bounded.

---

### 1.2 Expensive work on a high-frequency render path

```tsx
// ❌ filter+sort on every render; long lists jank on every interaction
function ProductList({ products, category }) {
  const filtered = products
    .filter(p => p.category === category)  // ← computed directly in render
    .sort((a, b) => b.price - a.price);

  return <ul>{filtered.map(p => <ProductItem key={p.id} {...p} />)}</ul>;
}

// ✅ cache with useMemo; recompute only when deps change
function ProductList({ products, category }) {
  const filtered = useMemo(
    () => products.filter(p => p.category === category).sort((a, b) => b.price - a.price),
    [products, category]  // ← explicit deps
  );

  return <ul>{filtered.map(p => <ProductItem key={p.id} {...p} />)}</ul>;
}
```

**CR checkpoint**: Are `filter`/`map`/`sort`/`reduce` on large arrays inside a render function/component wrapped in `useMemo`? If the data is bounded (<50 items) and interaction is infrequent, P2 is optional; large data or frequent interaction raises to P1.

---

### 1.3 Importing a tree-shakable library as a whole package

```typescript
// ❌ whole-package lodash; bundle grows 72KB
import _ from 'lodash';
const result = _.debounce(fn, 300);

// ❌ whole-package date-fns
import dateFns from 'date-fns';

// ✅ import what you need so tree-shaking works
import debounce from 'lodash/debounce';
import { format } from 'date-fns';
```

---

## 2. Robustness (Defensive Programming)

### 2.1 Missing boundary conditions

```typescript
// ❌ empty array, null, and undefined not handled
function getTopProduct(products: Product[]) {
  return products.sort((a, b) => b.sales - a.sales)[0].name;
  //                                                  ^^^ [0] is undefined on an empty array!
}

function renderUserName(user: User) {
  return user.profile.nickname.trim();
  //          ^^^^^^^ crashes when user or profile is null
}

// ✅ handle boundaries explicitly
function getTopProduct(products: Product[]) {
  if (!products.length) return null;  // or return 'No products'
  return products.sort((a, b) => b.sales - a.sales)[0].name;
}

function renderUserName(user: User | null) {
  return user?.profile?.nickname?.trim() ?? 'Anonymous';
}
```

**CR checkpoint**: Can the function's inputs be empty / an empty array / undefined? Is there matching boundary handling? Especially: is array `[0]` guarded by a length check, and are chained property accesses using `?.` or a prior null check?

---

### 2.2 Async requests missing loading/error state

```tsx
// ❌ no loading or error state; user gets no feedback; errors show a blank page
function UserPage() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchUser().then(setUser);
    // ❌ no catch, no loading control
  }, []);

  return <div>{user?.name}</div>; // nothing shown while user is null
}

// ✅ complete state management
function UserPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchUser()
      .then(setUser)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton />;
  if (error) return <ErrorMessage error={error} />;
  return <div>{user?.name}</div>;
}
```

---

## 3. Reuse (DRY)

### 3.1 Duplicated logic blocks

```tsx
// ❌ two pages with almost identical logic; only the API differs
// CheckoutPage.tsx
const [list, setList] = useState([]);
const [loading, setLoading] = useState(false);
useEffect(() => {
  setLoading(true);
  fetchCheckoutList().then(setList).finally(() => setLoading(false));
}, []);

// CustomerPage.tsx (copy-paste)
const [list, setList] = useState([]);
const [loading, setLoading] = useState(false);
useEffect(() => {
  setLoading(true);
  fetchCustomerList().then(setList).finally(() => setLoading(false));
}, []);

// ✅ abstract a generic Hook
function useList<T>(fetcher: () => Promise<T[]>) {
  const [list, setList] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    fetcher().then(setList).finally(() => setLoading(false));
  }, [fetcher]);
  return { list, loading };
}

// usage
const { list, loading } = useList(fetchCheckoutList);
```

**CR checkpoint**: Does the diff have similar blocks >10 lines appearing **3+ times**? They need not be identical; same core logic with a few different parameters should be abstracted. 2 duplicates may be P2; 3+ raises to P1.

---

### 3.2 Hardcoded props (parameterizable but not parameterized)

```tsx
// ❌ button color and copy are hardcoded; the component cannot be reused
function SubmitButton() {
  return (
    <button style={{ background: '#1890ff', color: '#fff' }}>
      Submit checkout
    </button>
  );
}

// ✅ control via props so the component is reusable
interface ButtonProps {
  label: string;
  color?: string;
  onClick?: () => void;
}
function SubmitButton({ label, color = '#1890ff', onClick }: ButtonProps) {
  return <button style={{ background: color }} onClick={onClick}>{label}</button>;
}
```

---

## 4. Design Patterns

### 4.1 God Component

**Detection signal**: a single component file >300 lines that contains multiple unrelated business blocks.

```tsx
// ❌ one component handles: form validation + API + transform + auth + render
// CheckoutFormPage.tsx (500 lines)
function CheckoutFormPage() {
  // form state (50 lines)
  // auth checks (40 lines)
  // image upload (60 lines)
  // API submit (80 lines)
  // data transform (30 lines)
  // JSX (200 lines)
}

// ✅ split responsibilities
function CheckoutFormPage() {      // orchestration only, <100 lines
  const form = useCheckoutForm();     // form logic
  const upload = useImageUpload();    // upload logic
  const submit = useCheckoutSubmit(); // submit logic
  return <CheckoutFormView form={form} upload={upload} submit={submit} />;
}
```

**CR checkpoint**: Does a new or heavily changed component in the diff take on more than 2 unrelated responsibilities (data fetch, transform, business logic, UI render)?

---

### 4.2 Business logic leaking into the UI layer

```tsx
// ❌ complex business math done directly in the component
function OrderCard({ order }) {
  // this discount logic belongs in the business layer, not a UI component
  const discount = order.accountTier === 'premium'
    ? order.amount * 0.8
    : order.licenseIds.length > 0
      ? order.amount - order.licenseDiscount
      : order.amount;

  const statusText = order.status === 1 ? 'Pending payment'
    : order.status === 2 ? 'Paid'
    : order.status === 3 ? 'Shipped' : 'Unknown status';

  return <div>{statusText}: ¥{discount}</div>;
}

// ✅ encapsulate business logic in a hook or util
function useOrderDisplay(order: Order) {
  const discount = calculateOrderDiscount(order);   // utils/orderUtils.ts
  const statusText = getOrderStatusText(order.status); // constants/orderStatus.ts
  return { discount, statusText };
}

function OrderCard({ order }) {
  const { discount, statusText } = useOrderDisplay(order);
  return <div>{statusText}: ¥{discount}</div>;
}
```

---

### 4.3 Switch-based type dispatch (consider Strategy)

```typescript
// ❌ switch grows with the product; every new type requires an edit here
function renderWidget(type: string, data: any) {
  switch (type) {
    case 'banner': return <BannerWidget data={data} />;
    case 'notice': return <NoticeWidget data={data} />;
    case 'discount': return <DiscountWidget data={data} />;
    case 'product': return <ProductWidget data={data} />;
    // every new type edits this → violates Open/Closed
  }
}

// ✅ Strategy: new types register; the dispatcher is unchanged
const widgetRegistry: Record<string, React.ComponentType<any>> = {
  banner: BannerWidget,
  notice: NoticeWidget,
  discount: DiscountWidget,
  product: ProductWidget,
};

function renderWidget(type: string, data: any) {
  const Widget = widgetRegistry[type];
  if (!Widget) return <FallbackWidget />;
  return <Widget data={data} />;
}
```

**CR checkpoint**: Does a `switch` or `if-else if` chain have 4+ branches and will clearly keep gaining cases? Suggest a Map/Registry. This is P2, not mandatory, but call out the extension risk.

---

## 5. Architecture Boundaries

### 5.1 Cross-layer dependency

**Agreed call direction (one-way, not reversible)**:

```
pages/views/ (UI components)
    ↓  useStore() / custom Hook
src/stores/ (MobX Store; holds all business logic)
    ↓  import requestXxx functions
src/api/ (if the README marks it generated, do not hand-edit; components must not import it directly)
```

```typescript
// ❌ UI skips the Store and calls the API layer (P1)
// src/pages/UserPage.tsx
import { requestGetUserList } from 'src/api/userApi';   // ← component imports the API layer

function UserPage() {
  useEffect(() => {
    requestGetUserList({ page: 1 }).then(setList);  // ❌ bypasses the Store
  }, []);
}

// ✅ component follows useStore() → Store.action → API
// src/pages/UserPage.tsx
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';

const UserPage = observer(() => {
  const { userStore } = useStore();                  // ✅ access via Store

  useEffect(() => {
    userStore.fetchUserList({ page: 1 });            // ✅ call a Store action
  }, []);

  return <UserList users={userStore.activeUsers} />;
});

// ❌ Store imports a UI component (circular dependency)
// src/stores/userStore.ts
import UserCard from 'src/components/UserCard'; // ❌ forbidden
```

**CR checkpoint** (only when the target repo README documents this layering):
- Do pages / components skip the Store and `import` `src/api/` directly?
- Are MobX-consuming components missing `observer()`?
- Does `src/stores/` import UI components?

---

## 6. Maintainability

### 6.1 Config coupled to logic

```typescript
// ❌ business thresholds scattered in logic; changes require a global search
function checkMemberLevel(points: number) {
  if (points >= 10000) return 'DIAMOND';
  if (points >= 5000) return 'GOLD';
  if (points >= 1000) return 'SILVER';
  return 'NORMAL';
}

// ❌ timeouts, retries, etc. scattered everywhere
fetchData({ timeout: 5000, retries: 3 });
fetchOther({ timeout: 5000, retries: 3 }); // repeated magic numbers

// ✅ centralize config; keep logic and config separate
// constants/memberConfig.ts
export const MEMBER_THRESHOLDS = {
  DIAMOND: 10000,
  GOLD: 5000,
  SILVER: 1000,
} as const;

export const REQUEST_DEFAULTS = {
  TIMEOUT: 5000,
  RETRIES: 3,
} as const;
```

---

## 7. MobX Design Rules (When the Repo Already Uses MobX)

> The following are detectable defects when **the project already chose MobX**. If the repo uses another state library, map the rules to that library's subscribe / action conventions; do not require a switch to MobX.

### 7.1 State changes after await not wrapped in runInAction (P0)

```typescript
// ❌ MobX strict mode error: state mutated outside an action
class OrderStore {
  rawOrderList: OrderDTO[] = [];

  async fetchOrders() {
    const res = await requestGetOrderList();
    this.rawOrderList = res.data.list;   // ❌ assigned after await, not inside an action
  }
}

// ✅ assignments after await must be wrapped in runInAction
async fetchOrders() {
  const res = await requestGetOrderList();
  runInAction(() => {
    this.rawOrderList = res.data.list;   // ✅
  });
}
```

**Quick identification**: a Store class has an `async` method that assigns `this.xxx =` after `await` without wrapping it in `runInAction`.

### 7.2 Component that uses MobX data is not wrapped in observer (P1)

```typescript
// ❌ no observer; store changes do not re-render; data gets out of sync
function OrderList() {
  const { orderStore } = useStore();
  return <ul>{orderStore.rawOrderList.map(...)}</ul>;  // data changes but the UI does not
}

// ✅
const OrderList = observer(() => {
  const { orderStore } = useStore();
  return <ul>{orderStore.rawOrderList.map(...)}</ul>;
});
```

**Quick identification**: the component calls `useStore()` and reads store properties, but the function definition is not wrapped in `observer(`.

### 7.3 Observable properties mutated outside the store (P1)

```typescript
// ❌ mutate store properties in a component or Hook; bypasses MobX actions
function UserCard() {
  const { userStore } = useStore();
  const handleClear = () => {
    userStore.rawUserList = [];    // ❌ assigned in the component layer; bypasses actions
  };
}

// ✅ mutate through a Store action
class UserStore {
  clearUserList() {
    this.rawUserList = [];         // ✅ mutated inside a Store action
  }
}

function UserCard() {
  const { userStore } = useStore();
  const handleClear = () => userStore.clearUserList(); // ✅
}
```

---

## Design Quality Dimensions (For Overall Assessment)

| Dimension | Signals | Notes |
|------|---------|------|
| Performance | N+1, missing useMemo, whole-package imports | Direct UX impact |
| Robustness | Boundary handling, loading/error state | Prevents blank pages / crashes |
| Reuse | Duplicated blocks, hardcoding | Long-term maintenance cost |
| Clear responsibilities | God Component, business logic in UI | Readability and testability |
| Architecture compliance | Cross-layer deps, type location | Collaboration and extension |
| Configurability | Magic numbers/strings, coupled config | Cost of requirement changes |

---

## 8. Circular Dependencies Between Any Modules

§5.1 already covers Store↔UI cross-layer cycles. This section covers **any two modules** importing each other (`a.ts` ↔ `b.ts`, or A→B→C→A). Cycles make init order undefined and can export half-initialized `undefined`.

```ts
// ❌ userService.ts
import { formatUser } from './userFormat';
// userFormat.ts
import { fetchUser } from './userService';

// ✅ extract shared types/pure functions into a third module, or make one side type-only
```

**CR checkpoint**: Does a new import in the diff point at a module that already imports this file? Cycles of three or more edges are also P1.

---

## 9. Selector Nesting No Deeper Than 3 Levels

In `.scss` / `.less` / `.css`, selector nesting (including `&` chains) must not exceed 3 levels. Deeper nesting raises specificity and is hard to override. Record as **P2**.

```scss
// ❌ 4 levels
.card {
  .header {
    .title {
      .icon { color: #333; }
    }
  }
}

// ✅ flat, or at most 3 levels
.card-title-icon { color: #333; }
```

When reviewing `*.scss` / `*.less` / `*.css`: style conventions still come from `project-conventions.md` §6; nesting depth comes from this section.
