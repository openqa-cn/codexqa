import * as db from './src/db.js';
import * as inventory from './src/inventory.js';
import * as reservation from './src/reservation.js';
import * as refund from './src/refund.js';
import { computeOrderTotal } from './src/pricing.js';

let failures = 0;

function check(condition, label) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}`);
  }
}

db.reset();
db.seedStock([
  { sku: 'WIDGET-1', onHand: 100 },
  { sku: 'GIZMO-2', onHand: 40 },
]);

console.log('- availability');
const initial = await inventory.checkAvailability('WIDGET-1');
check(initial === 100, `WIDGET-1 availability is ${initial}`);

console.log('- quote');
const quote = computeOrderTotal([
  { sku: 'WIDGET-1', qty: 3, unitPrice: 19.99 },
  { sku: 'GIZMO-2', qty: 1, unitPrice: 5.5 },
]);
check(quote.total > 0, `quote total ${quote.total}`);

console.log('- reserve');
const created = await reservation.createReservation({
  orderId: 'ORD-1001',
  lines: [
    { sku: 'WIDGET-1', qty: 3, unitPrice: 19.99 },
    { sku: 'GIZMO-2', qty: 1, unitPrice: 5.5 },
  ],
});
check(created.ok === true, 'reservation accepted');
check(created.reservation?.status === 'HELD', 'reservation is held');

console.log('- commit');
const committed = await reservation.commitReservation(created.reservation.id);
check(committed.ok === true, 'reservation committed');
check(committed.order?.status === 'PAID', `order ${committed.order?.id} is paid`);

console.log('- refund');
const refunded = await refund.refundOrder('ORD-1001', 5);
check(refunded.ok === true, `refund of ${refunded.amount} accepted`);
check(refund.refundSummary('ORD-1001').refundedTotal > 0, 'refund ledger updated');

console.log('- second reservation and cancel');
const second = await reservation.createReservation({
  orderId: 'ORD-1002',
  lines: [{ sku: 'WIDGET-1', qty: 2, unitPrice: 19.99 }],
});
check(second.ok === true, 'second reservation accepted');
const cancelled = await reservation.cancelReservation(second.reservation.id);
check(cancelled.ok === true, 'second reservation cancelled');

console.log('- rejection path');
const tooBig = await reservation.createReservation({
  orderId: 'ORD-1003',
  lines: [{ sku: 'GIZMO-2', qty: 9999, unitPrice: 5.5 }],
});
check(tooBig.ok === false && tooBig.reason === 'OUT_OF_STOCK', 'oversized request rejected');

console.log('- hold window clamp');
const longHold = await reservation.createReservation({
  orderId: 'ORD-1004',
  lines: [{ sku: 'WIDGET-1', qty: 1, unitPrice: 19.99 }],
  ttlMs: 5 * 60 * 60 * 1000,
});
check(longHold.ok === true, 'long hold accepted');
const windowMs = longHold.reservation.expiresAt - longHold.reservation.createdAt;
check(windowMs === 60 * 60 * 1000, `hold window clamped to ${windowMs}ms`);
await reservation.cancelReservation(longHold.reservation.id);

if (failures > 0) {
  console.error(`\nsmoke failed: ${failures} check(s)`);
  process.exit(1);
}
console.log('\nsmoke passed');
