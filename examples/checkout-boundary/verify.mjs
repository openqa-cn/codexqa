import assert from 'node:assert/strict';
import { checkout as good } from './good.mjs';
import { checkout as defective } from './defective.mjs';
function contract(checkout) {
  assert.deepEqual(checkout(1), { accepted: true, amount: 1 });
  for (const amount of [-1, NaN, Infinity]) assert.throws(() => checkout(amount));
  assert.throws(() => checkout(0), /amount must be positive/);
}
contract(good);
console.log('PASS: known-good implementation satisfies sampled contract');
assert.throws(() => contract(defective), { code: 'ERR_ASSERTION' });
assert.deepEqual(defective(0), { accepted: true, amount: 0 });
console.log('EXPECTED FAILURE: defective implementation accepts zero');
console.log('Fixture verified; no AI detection claim.');
