# Frontend Performance Optimization Guide

## React Performance

### 1. Component Re-render Optimization

#### How it works
A React component re-renders when:
1. Its own state changes
2. Its parent re-renders (by default all children re-render)
3. A Context value changes

#### Case study

**Problem code:**
```jsx
function App() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
      <ExpensiveList items={items} /> {/* re-renders on every count change */}
    </div>
  );
}
```

**Performance impact:**
- Every count +1 re-renders ExpensiveList
- If ExpensiveList has 1000 items, each re-render costs 100ms
- UX: clicking the button feels janky

**Fix 1: React.memo**
```jsx
const ExpensiveList = React.memo(({ items }) => {
  console.log('ExpensiveList rendered');
  return (
    <ul>
      {items.map(item => <li key={item.id}>{item.name}</li>)}
    </ul>
  );
});

// now it re-renders only when items change
```

**Fix 2: split the component**
```jsx
function App() {
  return (
    <div>
      <CounterSection />      {/* count changes only affect this */}
      <ExpensiveList items={items} />  {/* no longer affected */}
    </div>
  );
}

function CounterSection() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

### 2. Virtualization

#### When to use
- List items > 100
- Each item is expensive to render

#### Implementation

**react-window (recommended)**
```jsx
import { FixedSizeList } from 'react-window';

function VirtualList({ items }) {
  return (
    <FixedSizeList
      height={600}
      itemCount={items.length}
      itemSize={50}
      width="100%"
    >
      {({ index, style }) => (
        <div style={style}>
          {items[index].name}
        </div>
      )}
    </FixedSizeList>
  );
}
```

**Performance comparison:**
- Naive render of 1000 items: first paint 500ms, memory 50MB
- Virtualization: first paint 50ms, memory 5MB
- **Improvement: 10x!**

[More details...]
