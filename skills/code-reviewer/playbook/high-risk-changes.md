# The five core focus areas, in detail

## Why these 5?

These five high-risk change types keep showing up in public postmortems:

| Focus area | Historical incidents | Users affected | Money lost | Time to diagnose |
|------------|---------------------|----------------|------------|------------------|
| Project config changes | 8 | 5000+ | 0 | avg 4 hours |
| Existing-logic changes | 12 | 20000+ | 0 | avg 6 hours |
| Money calculation | 3 | 500+ | ¥500,000 | avg 8 hours |
| Dependency upgrades | 5 | 10000+ | 0 | avg 3 hours |
| Exception handling | 15 | 8000+ | 0 | avg 5 hours |

That is why these 5 are P0 must-check items.

---

## 1. Project config changes, in detail

### Why high risk?

**One config affects everyone:**
- Wrong webpack config → everyone's build fails
- Missing env var → every environment is affected
- Wrong CI/CD config → cannot deploy

### Historical incident cases

#### Case 1: Wrong webpack publicPath

**Background:**
Developer A changed `publicPath` in webpack.config.js while debugging locally, from `/` to `/app/`.

**Code change:**
```javascript
// webpack.config.js
module.exports = {
  output: {
-   publicPath: '/',
+   publicPath: '/app/',
  }
}
```

**Result:**
- After commit, 5 other developers pulled
- Local dev environments all 404 (static assets not found)
- 3 hours spent diagnosing (assumed it was their own environment)
- Root cause turned out to be the config change

**Lessons:**
1. Config changes must explain why in the PR
2. The whole team must be notified
3. README.md must be updated

**Prevention:**
```bash
# tooling/check-config-changes.sh
# Auto-detect config file changes and warn

CONFIG_FILES="webpack.config.js tsconfig.json .env package.json"

for file in $CONFIG_FILES; do
  if git diff --name-only origin/main | grep -q "$file"; then
    echo "⚠️  Config file change detected: $file"
    echo "   Please ensure:"
    echo "   1. Explain the change in the PR description"
    echo "   2. Notify the whole team"
    echo "   3. Update related docs"
  fi
done
```

#### Case 2: Missing environment variable

[Detailed case...]

---

## 2. Existing-logic changes, in detail

### Why high risk?

**Butterfly effect:**
- One condition change can affect 10 features
- One state-transition change can break the whole business flow

### Historical incident cases

#### Case 1: Permission condition change

**Background:**
Needed a "super admin" role. Developer B changed the permission check.

**Code change:**
```javascript
// Original — only admin can delete users
function canDeleteUser(user) {
- return user.role === 'admin';
+ return user.role === 'admin' || user.role === 'super_admin';
}
```

**Looks fine? In reality:**

This function is called from 15 places:
1. User admin page — show delete button
2. User API — delete-user endpoint
3. Bulk actions — bulk delete users
4. Audit log — record delete operations
5. Data export — export the list of deletable users
6. ... (10 more places)

**Result:**
- Only the user admin page was tested
- The other 14 places were not tested
- After launch, data export broke (did not handle super_admin)
- Audit log recorded incorrectly
- 500+ users affected

**Lessons:**
1. Before changing existing logic, globally search every call site
2. Must have complete unit and integration tests
3. Must consider data compatibility

**Prevention:**
```javascript
// ✅ Better: handle it explicitly, do not change implicitly
const ADMIN_ROLES = ['admin', 'super_admin'];

function canDeleteUser(user) {
  return ADMIN_ROLES.includes(user.role);
}

// And add complete tests
describe('canDeleteUser', () => {
  it('should return true for admin', () => {
    expect(canDeleteUser({ role: 'admin' })).toBe(true);
  });
  
  it('should return true for super_admin', () => {
    expect(canDeleteUser({ role: 'super_admin' })).toBe(true);
  });
  
  it('should return false for regular user', () => {
    expect(canDeleteUser({ role: 'user' })).toBe(false);
  });
  
  it('should return false for undefined role', () => {
    expect(canDeleteUser({ role: undefined })).toBe(false);
  });
});
```

[More cases...]

---

## 3. Money calculation, in detail

### Why high risk?

**Money loss = real money lost.**

### Historical incident cases

#### Case 1: Float precision caused over-refunds

**Background:**
Implemented refunds using floating-point math for the refund amount.

**Code:**
```javascript
function calculateRefund(orderAmount, refundRate) {
  return orderAmount * refundRate; // ❌ floating-point math
}

// Actual use
const refund = calculateRefund(299.9, 0.5); // should refund 149.95
console.log(refund); // prints 149.95000000000002
```

**Result:**
- System rounded and refunded 150 yuan (0.05 yuan extra)
- 1000 refunds that day
- Extra refunded: 50 yuan

Looks small? But:
- The bug existed for 3 months before discovery
- Cumulative extra refunds = 50 yuan × 90 days = 4500 yuan
- And it could not be clawed back (already in user accounts)

**Lessons:**
1. Money math must use integers (fen as the unit)
2. Must have strict unit tests, including boundary values
3. Must confirm rounding rules with finance

**Correct approach:**
```javascript
// ✅ Integer math (fen as the unit)
function calculateRefund(orderAmountCents, refundRate) {
  // Compute first, then truncate
  return Math.floor(orderAmountCents * refundRate);
}

// Actual use
const orderAmount = 29990; // 299.90 yuan = 29990 fen
const refund = calculateRefund(orderAmount, 0.5); // 14995 fen = 149.95 yuan

// Tests
describe('calculateRefund', () => {
  it('should handle standard case', () => {
    expect(calculateRefund(29990, 0.5)).toBe(14995);
  });
  
  it('should handle rounding down', () => {
    expect(calculateRefund(100, 0.33)).toBe(33); // not 33.33
  });
  
  it('should handle zero', () => {
    expect(calculateRefund(0, 0.5)).toBe(0);
  });
  
  it('should handle large numbers', () => {
    expect(calculateRefund(999999999, 0.5)).toBe(499999999);
  });
});
```

[More cases...]
