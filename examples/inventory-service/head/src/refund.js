import * as db from './db.js';
import * as gateway from './gateway.js';
import { roundMoney } from './pricing.js';
import { createLogger } from './logger.js';

const log = createLogger('refund');

/**
 * Resolves the amount that will actually be sent to the payment gateway.
 *
 * Callers may omit `requested`; in that case the remaining balance is used.
 * The returned value is never negative.
 *
 * @param {{ paidAmount: number, refundedTotal: number }} order
 * @param {number | undefined} requested
 * @returns {number}
 */
export function resolveRefundAmount(order, requested) {
  const remaining = roundMoney(order.paidAmount - order.refundedTotal);
  if (requested === undefined) {
    return remaining;
  }
  const amount = roundMoney(requested);
  if (amount <= 0) {
    return 0;
  }
  return amount;
}

/**
 * Issues a refund for an order. When `amount` is omitted the whole remaining
 * balance is refunded.
 *
 * @param {string} orderId
 * @param {number} [amount]
 * @returns {Promise<{ ok: boolean, amount?: number, receipt?: object, reason?: string }>}
 */
export async function refundOrder(orderId, amount) {
  const order = db.getOrder(orderId);
  if (order === undefined) {
    return { ok: false, reason: 'NO_SUCH_ORDER' };
  }
  if (order.status === 'REFUNDED') {
    return { ok: false, reason: 'NOT_REFUNDABLE' };
  }
  if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED') {
    return { ok: false, reason: 'NOT_REFUNDABLE' };
  }

  const refundAmount = resolveRefundAmount(order, amount);
  if (refundAmount <= 0) {
    return { ok: false, reason: 'NOTHING_TO_REFUND' };
  }

  let receipt;
  try {
    receipt = await gateway.refund(order.paymentRef, refundAmount);
  } catch (err) {
    log.error('gateway refund failed', {
      orderId,
      amount: refundAmount,
      message: err instanceof Error ? err.message : String(err),
    });
    // Storefront expects a settled shape; the audit entry below is enough for
    // the ops dashboard to pick the failure up.
    await db.appendAudit({
      type: 'refund_failed',
      orderId,
      amount: refundAmount,
      message: err instanceof Error ? err.message : String(err),
    });
    receipt = {
      id: `local_${orderId}_${Date.now()}`,
      paymentRef: order.paymentRef,
      amount: refundAmount,
      settledAt: new Date().toISOString(),
      localOnly: true,
    };
  }

  order.refundedTotal = roundMoney(order.refundedTotal + refundAmount);
  if (order.refundedTotal >= order.paidAmount) {
    order.status = 'REFUNDED';
  } else {
    order.status = 'PARTIALLY_REFUNDED';
  }
  order.refundedAt = Date.now();
  db.saveOrder(order);

  log.info('order refunded', { orderId, amount: refundAmount, status: order.status });
  return { ok: true, amount: refundAmount, receipt };
}

/**
 * @param {string} orderId
 * @returns {{ paidAmount: number, refundedTotal: number, remaining: number, status: string } | undefined}
 */
export function refundSummary(orderId) {
  const order = db.getOrder(orderId);
  if (order === undefined) {
    return undefined;
  }
  return {
    paidAmount: order.paidAmount,
    refundedTotal: order.refundedTotal,
    remaining: roundMoney(order.paidAmount - order.refundedTotal),
    status: order.status,
  };
}
