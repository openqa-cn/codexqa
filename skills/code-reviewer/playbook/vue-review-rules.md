# Vue Best Practices (Team Incident Lessons)

## 1. Correct Default Values for Components

### Problem

If a Vue component prop default uses an arrow function that returns `{}`, the actual return value is `undefined`.

### Real Team Case

#### Bad case
```javascript
export default {
  props: {
    // ❌ incorrect
    auditShowConfig: {
      type: Object,
      default: () => {}  // returns undefined!
    }
  },
  
  mounted() {
    // ❌ this throws
    console.log(this.auditShowConfig.showAudit);
    // Cannot read property 'showAudit' of undefined
  }
}
```

**Why does this happen?**
```javascript
// arrow-function shorthand
() => {}  // this is a function body; returns undefined

// to return an object, wrap it in parentheses
() => ({})  // this returns an empty object
```

**Impact:**
- Component initialization throws
- Blank page
- Affected 100+ pages using this component

### Correct Approach
```javascript
// ✅ option 1: wrap in parentheses (recommended)
export default {
  props: {
    auditShowConfig: {
      type: Object,
      default: () => ({})  // returns an empty object
    }
  }
}

// ✅ option 2: use a full function body
export default {
  props: {
    auditShowConfig: {
      type: Object,
      default: () => {
        return {};
      }
    }
  }
}

// ✅ option 3: ordinary function (not preferred, but clearer)
export default {
  props: {
    auditShowConfig: {
      type: Object,
      default: function() {
        return {};
      }
    }
  }
}
```

### Checklist

- [ ] Do all Object/Array defaults return from a function?
```javascript
  // ❌ incorrect: use an object directly
  default: {}
  
  // ✅ correct: return from a function
  default: () => ({})
```

- [ ] Are arrow functions that return an object wrapped in parentheses?
```javascript
  // ❌ returns undefined
  default: () => {}
  
  // ✅ returns an empty object
  default: () => ({})
```

- [ ] Does the default match the declared type?
```javascript
  // ❌ type mismatch
  {
    type: Object,
    default: () => []  // returns an array, not an object
  }
  
  // ✅ type matches
  {
    type: Object,
    default: () => ({})
  }
```

### Automatic Detection
```bash
# search for likely problem code
grep -rn "default: () => {}" src/

# ESLint rule (official Vue)
{
  "rules": {
    "vue/require-valid-default-prop": "error"
  }
}
```

### Same Pattern in React
```javascript
// React has a similar issue

// ❌ incorrect
function MyComponent({ config = () => {} }) {
  console.log(config.theme); // undefined
}

// ✅ correct
function MyComponent({ config = {} }) {
  console.log(config.theme);
}

// or use a default parameter object
function MyComponent({ config = { theme: 'light' } }) {
  console.log(config.theme);
}
```
