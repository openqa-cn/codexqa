# Complete guide to money calculation

## Core principles

### Principle 1: Always use integers

**Why?**
- Floating-point numbers cannot be represented exactly
- 0.1 + 0.2 = 0.30000000000000004

**How?**
```javascript
// ❌ Wrong: using floats
const price = 19.99;
const discount = 0.8;
const final = price * discount; // 15.992

// ✅ Correct: use integers (fen as the unit)
const priceCents = 1999; // 19.99 yuan = 1999 fen
const discountRate = 80; // 80%
const finalCents = Math.floor(priceCents * discountRate / 100); // 1599 fen
const finalYuan = finalCents / 100; // 15.99 yuan
```

### Principle 2: Make rounding rules explicit

**Common rules:**
1. **Floor**: favors the user
2. **Ceil**: favors the merchant
3. **Round**: middle ground
4. **Banker's rounding**: round half to even

**You must confirm with product and finance which rule to use!**
```javascript
// Different rounding rules
const value = 1.5;

Math.floor(value);   // 1 - floor
Math.ceil(value);    // 2 - ceil
Math.round(value);   // 2 - half away from zero (JS default)

// Banker's rounding (fairer)
function bankersRound(num) {
  const rounded = Math.round(num);
  const diff = Math.abs(num - Math.floor(num));
  
  if (diff === 0.5) {
    // Exactly 0.5: look at the integer part
    return Math.floor(num) % 2 === 0 
      ? Math.floor(num)  // even → down
      : Math.ceil(num);   // odd → up
  }
  
  return rounded;
}

bankersRound(0.5);  // 0 (0 is even, down)
bankersRound(1.5);  // 2 (1 is odd, up)
bankersRound(2.5);  // 2 (2 is even, down)
```

### Principle 3: Boundary values must be tested

**Required cases:**
- Zero: price = 0
- Negative: price = -100 (are negatives allowed?)
- Large: price = 999999999 (overflow?)
- Small decimal: price = 0.01 (is precision preserved?)
```javascript
describe('calculateDiscount', () => {
  it('should handle zero price', () => {
    expect(calculateDiscount(0, 0.8)).toBe(0);
  });
  
  it('should reject negative price', () => {
    expect(() => calculateDiscount(-100, 0.8)).toThrow();
  });
  
  it('should handle large numbers', () => {
    expect(calculateDiscount(99999999, 0.5)).toBe(49999999);
  });
  
  it('should handle discount rate 0', () => {
    expect(calculateDiscount(100, 0)).toBe(0);
  });
  
  it('should handle discount rate 1', () => {
    expect(calculateDiscount(100, 1)).toBe(100);
  });
  
  it('should reject discount rate > 1', () => {
    expect(() => calculateDiscount(100, 1.5)).toThrow();
  });
});
```

## Real case library

### Case 1: Checkout discount amount calculated wrong

[Detailed case...]

### Case 2: Precision loss on credit / balance redemption

[Detailed case...]

[More cases and details...]
