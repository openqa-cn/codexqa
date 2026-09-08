# Async programming best practices (team hard-won lessons)

## Contents
1. [Promises that stay pending](#promises-that-stay-pending)
2. [Forgotten await in async functions](#forgotten-await-in-async-functions)
3. [Promise error handling](#promise-error-handling)

---

## 1. Promises that stay pending

### Problem

If a Promise neither resolves nor rejects, it stays pending forever, causing:
- `await` waits forever and the program hangs
- `Promise.all` never completes
- Memory leaks (the Promise object cannot be released)

### Real team case

#### BadCase
```javascript
// Get user location
function getLocation() {
  return new Promise(function (resolve, reject) {
    navigator.geolocation.getCurrentPosition((pos) => {
      if (pos.coords.latitude) {
        resolve(pos.coords);
      }
      // ❌ If lat=0, nothing happens
      // Promise stays pending forever!
    });
  });
}

// Usage
async function showMap() {
  const location = await getLocation(); // ❌ If lat=0, waits forever
  renderMap(location);
}
```

**Result:**
- User near the equator (lat=0, lng≠0)
- Map page loads forever
- User cannot use the map
- Users affected: about 200/day

### Correct approach
```javascript
// ✅ Option 1: Complete resolve/reject
function getLocation() {
  return new Promise(function (resolve, reject) {
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

// ✅ Option 2: Add a timeout
function getLocationWithTimeout(timeout = 5000) {
  return Promise.race([
    getLocation(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Location timeout')), timeout)
    )
  ]);
}

// Usage
async function showMap() {
  try {
    const location = await getLocationWithTimeout();
    renderMap(location);
  } catch (error) {
    console.error('Failed to get location:', error);
    // Fallback: use a default location
    renderMap({ lat: 39.9, lng: 116.4 }); // Beijing
  }
}
```

### Checklist

When reviewing Promise code, always check:

- [ ] **Does every branch resolve or reject?**
```javascript
  new Promise((resolve, reject) => {
    if (condition1) {
      resolve(value1);
    } else if (condition2) {
      resolve(value2);
    } else {
      // ❌ Missing else handling
      // ✅ Should add: reject(new Error('Unknown condition'))
    }
  });
```

- [ ] **Are both success and failure callbacks handled?**
```javascript
  new Promise((resolve, reject) => {
    someAsyncAPI({
      success: resolve,
      fail: reject  // ✅ Do not forget fail
    });
  });
```

- [ ] **Is a timeout needed?**
  - Network requests: suggest 5-10 seconds
  - User interaction: suggest 30 seconds
  - Long operations: tell the user explicitly

### Automated detection (ESLint rule)

Create a custom rule:
```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-pending-promise': 'error'
  }
};

// Rule implementation (simplified)
// Check whether every path in a Promise constructor has resolve/reject
```

---

## 2. Forgotten await in async functions

### Problem

An async function returns a Promise. If you forget await:
- You get the Promise object instead of the async result
- Conditions are always true (a Promise is an object, truthy)
- Async errors are ignored

### Real team case

#### BadCase
```javascript
// Check group-message permission
async function myController(ctx) {
  const list = ['123'];

  // ❌ check() returns a Promise, not a boolean
  return ctx.service.checkout.checkPermission() && list.length > 0;
  
  // Actual return:
  // Promise { <pending> } && true
  // = Promise object (truthy)
  // Always returns a Promise object, not a boolean!
}

// Usage
if (await myController(ctx)) {
  sendMessage(); // ✅ This works because it is awaited
}

// But without await
if (myController(ctx)) {
  sendMessage(); // ❌ Always runs (Promise is truthy)
}
```

**Result:**
- Permission check failed, but messages were still sent
- Unauthorized users could send group messages
- 500+ violating messages had already been sent when discovered

### Correct approach
```javascript
// ✅ Option 1: await correctly
async function myController(ctx) {
  const list = ['123'];
  
  // Await the result first
  const checkResult = await ctx.service.checkout.checkPermission();
  
  // Then use the result in the condition
  return checkResult && list.length > 0;
}

// ✅ Option 2: type hints (TypeScript)
async function check(): Promise<boolean> {
  // ...
}

async function myController(ctx) {
  const list = ['123'];
  
  // TypeScript will report:
  // Operator '&&' cannot be applied to types 'Promise<boolean>' and 'boolean'
  return ctx.service.checkout.checkPermission() && list.length > 0;
  //     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 
  //     Type error!
}
```

### Checklist

When reviewing async/await code, always check:

- [ ] **Is the async call awaited?**
```javascript
  // ❌ No await
  const result = asyncFunction();
  
  // ✅ Has await
  const result = await asyncFunction();
```

- [ ] **Is a Promise in a condition awaited?**
```javascript
  // ❌ Using a Promise object as a condition
  if (asyncCheck() && someCondition) { }
  
  // ✅ Await, then check
  const checkResult = await asyncCheck();
  if (checkResult && someCondition) { }
```

- [ ] **Are Promises in Promise.all/race correct?**
```javascript
  // ❌ Forgot to call (missing parentheses)
  await Promise.all([
    fetchUser,     // this is a function, not a Promise
    fetchOrders()  // this is a Promise
  ]);
  
  // ✅ Correct
  await Promise.all([
    fetchUser(),
    fetchOrders()
  ]);
```

### Automated detection
```bash
# ESLint rules
{
  "rules": {
    "@typescript-eslint/no-floating-promises": "error",
    "require-await": "error"
  }
}
```
```bash
# Script detection (regex search)
grep -rn "return.*\\..*() &&" src/
# Find "return xxx() && yyy" patterns
# Manually review whether await was forgotten
```

---

## 3. Promise error handling

### Best-practice summary
```javascript
// ✅ Complete error-handling pattern
async function robustAsyncOperation() {
  try {
    // 1. Timeout protection
    const result = await Promise.race([
      actualOperation(),
      timeout(5000)
    ]);
    
    // 2. Result validation
    if (!result || !result.data) {
      throw new Error('Invalid result');
    }
    
    return result.data;
    
  } catch (error) {
    // 3. Classify errors
    if (error.code === 'TIMEOUT') {
      console.error('Operation timeout');
      // Report to monitoring
      Sentry.captureException(error);
      // Return a fallback
      return getDefaultValue();
    }
    
    if (error.code === 'NETWORK_ERROR') {
      console.error('Network error');
      // Ask the user to check the network
      showNetworkError();
      return null;
    }
    
    // 4. Unknown errors
    console.error('Unknown error:', error);
    Sentry.captureException(error);
    throw error; // or return a default
  }
}

// Timeout helper
function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject({ code: 'TIMEOUT' }), ms)
  );
}
```

---

## Rule summary

### Mandatory rules

1. ✅ **Every Promise must have a reject path**
2. ✅ **Async function calls must be awaited**
3. ✅ **Long async operations must have a timeout**
4. ✅ **Promise errors must be handled (try-catch or .catch)**

### Recommended rules

1. 💡 Use TypeScript and lean on type checking
2. 💡 Wrap a shared async utility
3. 💡 Report important async operations to monitoring
4. 💡 Give users friendly error messages

### Tooling

- ESLint: `@typescript-eslint/no-floating-promises`
- ESLint: `require-await`

---

## Real incident catalog

See: [examples/async-incidents.md](../examples/async-incidents.md) and [incident-catalog.md](incident-catalog.md).
