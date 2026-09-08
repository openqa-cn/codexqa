# React CR Critical Rules

> Includes only rules that ESLint cannot detect and that require AI semantic understanding. Formatting is covered by Prettier and is not repeated here.

## 📋 Rule Quick-Reference Index

| Section | Rule | Severity | Quick identification |
|------|------|------|------------|
| §1.1 | Incomplete useEffect dependency array | P1 | deps array is missing variables used in the function body |
| §1.2 | Depending on external mutable variables (not state/prop) | P1 | deps array includes module-level variables or externals other than ref |
| §1.3 | Child callback not wrapped in useCallback | P1 | Function literal passed to a child is a new reference every render |
| §2 | Array index used as key | P0 | `key={index}` in a list that can be sorted/deleted |
| §3.1 | Stateless component implemented as class | P1 | Component with no state/lifecycle uses `class extends` |
| §3.2 | Spreading props directly | P1 | `<Component {...props} />` without filtering |
| §3.3 | Lifecycle methods as arrow functions | P1 | `componentDidMount = () =>` form |
| §4 | string ref | P0 | `ref="myRef"` string form (deprecated) |
| §6 | Updating from current state without a functional updater | P1 | `setCount(count + 1)` / `setItems([...items, x])` |
| §7 | `render` / the component must return UI | P1 | React | `render()` with no `return`; function component falls off the end |
| §8 | Do not render a non-boolean as a condition | P1 | React | `{count && <Row />}` when `count` is a number |
| §9 | Setter must not be called with its matching state variable | P1 | React | `setOrder(order)` with no change |

---

## 1. Hooks Rules (🔴 P0)

### 1.1 Do not call Hooks inside conditions / loops / callbacks

```jsx
// ❌ calling a Hook inside a condition breaks call order
function UserProfile({ isLoggedIn }) {
  if (isLoggedIn) {
    const [data, setData] = useState(null); // violation!
  }
}

// ✅ always call at the top level; use conditions to control logic
function UserProfile({ isLoggedIn }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (isLoggedIn) fetchData();
  }, [isLoggedIn]);
}
```

### 1.2 useEffect dependency arrays must be complete

```jsx
// ❌ userId is used in the effect but not declared as a dependency
useEffect(() => {
  fetchUser(userId);
}, []); // will not re-run when userId changes

// ✅ complete dependencies
useEffect(() => {
  fetchUser(userId);
}, [userId]);

// ⚠️ note: ref and setState are stable references and may be omitted
const ref = useRef();
const [, setState] = useState();
useEffect(() => {
  ref.current = value; // ref may be omitted
  setState(x);         // setState may be omitted
}, [value]);
```

### 1.3 Do not use external variables as Hook dependencies

```jsx
// ❌ externalConfig is a module-level variable, not a reactive value; listing it as a dep is meaningless and may leak memory
const externalConfig = { timeout: 5000 };
useEffect(() => {
  startTimer(externalConfig.timeout);
}, [externalConfig]); // dangerous!

// ✅ depend only on props, state, and variables declared in the component
function Timer({ timeout }) {
  useEffect(() => {
    startTimer(timeout);
  }, [timeout]); // timeout is a prop, a reactive value
}
```

### 1.4 Functions passed to child components must be wrapped in useCallback

```jsx
// ❌ a new function reference is created every render, so React.memo on the child is useless
function Parent({ userId }) {
  const handleClick = () => onUserClick(userId); // new function every render
  return <MemoChild onClick={handleClick} />;
}

// ✅ stable reference
function Parent({ userId }) {
  const handleClick = useCallback(() => onUserClick(userId), [userId]);
  return <MemoChild onClick={handleClick} />;
}
```

---

## 2. Key Attribute Rules (🔴 P0)

### 2.1 Do not use array indexes as keys

```jsx
// ❌ when the array is reordered, elements with internal state shift
{items.map((item, index) => (
  <Input key={index} defaultValue={item.name} />
))}

// ✅ use a unique ID
{items.map((item) => (
  <Input key={item.id} defaultValue={item.name} />
))}

// ✅ when there is no unique ID, generate one with uuid
import { v4 as uuid } from 'uuid';
const itemsWithId = items.map(item => ({ ...item, _key: uuid() }));
```

---

## 3. Component Design Rules (🟡 P1)

### 3.1 Components with no state must be function components

```jsx
// ❌ no state, but implemented as a class component
class Title extends React.Component {
  render() {
    return <h1>{this.props.text}</h1>;
  }
}

// ✅ function component
const Title = ({ text }) => <h1>{text}</h1>;
```

### 3.2 Do not export components as arrow functions

```jsx
// ❌ anonymous arrow-function export; DevTools shows Anonymous
export default () => <div>Hello</div>;

// ✅ named function export; the component name is clear when debugging
export default function UserCard({ user }) {
  return <div>{user.name}</div>;
}

// ✅ or a named arrow function
const UserCard = ({ user }) => <div>{user.name}</div>;
export default UserCard;
```

### 3.3 Class-component lifecycle methods must not be arrow functions

```jsx
// ❌ declaring a lifecycle as an arrow function; subclasses cannot override correctly
class UserProfile extends React.Component {
  componentDidMount = () => {
    this.fetchData();
  }
}

// ✅ ordinary method
class UserProfile extends React.Component {
  componentDidMount() {
    this.fetchData();
  }
  // event handlers may be arrow functions (to avoid bind)
  handleClick = () => this.setState({ clicked: true });
}
```

### 3.4 Do not spread this.props (except in HOCs)

```jsx
// ❌ forwards every prop, including internal ones that should not be passed
class Button extends React.Component {
  render() {
    return <button {...this.props}>Click</button>; // may pass props that should not go down
  }
}

// ✅ explicitly pick the props you need
class Button extends React.Component {
  render() {
    const { onClick, children, disabled } = this.props;
    return <button onClick={onClick} disabled={disabled}>{children}</button>;
  }
}
```

---

## 4. Refs Rules (🔴 P0)

### 4.1 Do not use string refs

```jsx
// ❌ string refs are deprecated
class Comp extends React.Component {
  componentDidMount() {
    this.refs.input.focus(); // dangerous!
  }
  render() {
    return <input ref="input" />;
  }
}

// ✅ use useRef or createRef
function Comp() {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return <input ref={inputRef} />;
}
```

---

## 5. High-Frequency CR Issues Cheat Sheet

| Issue | Severity | Quick identification |
|------|---------|---------|
| Incomplete useEffect dependency array | P1 | deps array has fewer variables than the effect uses |
| Array index as key | P0 | `key={index}` |
| Function passed to a child without useCallback | P1 | `<Child onClick={() => ...} />` |
| Lifecycle as an arrow function | P1 | `componentDidMount = () =>` |
| Exporting a component as an anonymous arrow function | P2 | `export default () =>` |
| Spreading props | P1 | `{...this.props}` or `{...props}` passed to a DOM element |
| Hook called inside a condition/loop | P0 | a `use*` call inside an if/for block |
| Updating from current state without prev | P1 | `setCount(count + 1)` in async / successive updates |

---

## 6. Updates Based on Current State Must Be Functional

If a `setState` / `useState` setter reads the **current** state to compute the next value, it must use `setX(prev => …)`. `count` / `items` captured in a closure may be stale during batched updates or async callbacks.

```jsx
// ❌ two quick clicks may only +1
setCount(count + 1);
setItems([...items, newItem]);

// ✅
setCount((prev) => prev + 1);
setItems((prev) => [...prev, newItem]);
```

**CR checkpoint**: Does a `setX(` argument in the diff reference the same-named state? If so, switch to a functional updater. Not required when the new value is independent of old state (`setOpen(true)`).

---

## 7. `render` / the component must return UI

A class `render` and a function component must `return` an element, `null`, or `false`. Falling off the end renders nothing and hides mistakes. Hooks-in-conditions still go through §1 and are **not** re-judged here. `Lang: React`.

```jsx
// ❌
function OrderRow({ order }) {
  <td>{order.customerId}</td>;
}

// ✅
function OrderRow({ order }) {
  return <td>{order.customerId}</td>;
}
```

---

## 8. Do not render a non-boolean as a condition

`{count && <Row />}` prints `0` when `count` is `0`. Use `count > 0` / `Boolean(count)`. Complements `javascript-review-rules.md` §2.1 and does **not** retune it. `Lang: React`.

```jsx
// ❌
{count && <OrderRow order={order} />}

// ✅
{count > 0 ? <OrderRow order={order} /> : null}
```

---

## 9. Setter must not be called with its matching state variable

`setOrder(order)` with the same variable is a no-op (and can still retrigger in some runtimes). Mutate a copy or pass a new value. Complements §6 (functional updater) and does **not** replace it. Do not treat “`useState` in the component body” as a defect — that is the correct hook call site. `Lang: React`.

```jsx
// ❌
setOrder(order);

// ✅
setOrder({ ...order, status: "paid" });
```
