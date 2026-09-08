import * as db from './db.js';
import * as gateway from './gateway.js';
import { roundMoney } from './pricing.js';
import { createLogger } from './logger.js';

const log = createLogger('refund');

/**
 * Refunds an order in full.
 *
 * @param {string} orderId
 * @returns {Promise<{ ok: boolean, amount?: number, receipt?: object, reason?: string }>}
 */
export async function refundOrder(orderId) {
  const order = db.getOrder(orderId);
  if (order === undefined) {
    return { ok: false, reason: 'NO_SUCH_ORDER' };
  }
  if (order.status !== 'PAID') {
    return { ok: false, reason: 'NOT_REFUNDABLE' };
  }

  const amount = roundMoney(order.paidAmount - order.refundedTotal);
  if (amount <= 0) {
    return { ok: false, reason: 'NOTHING_TO_REFUND' };
  }

  const receipt = await gateway.refund(order.paymentRef, amount);

  order.refundedTotal = roundMoney(order.refundedTotal + amount);
  order.status = 'REFUNDED';
  order.refundedAt = Date.now();
  db.saveOrder(order);

  log.info('order refunded', { orderId, amount });
  return { ok: true, amount, receipt };
}

/**
 * @param {string} orderId
 * @returns {{ paidAmount: number, refundedTotal: number, status: string } | undefined}
 */
export function refundSummary(orderId) {
  const order = db.getOrder(orderId);
  if (order === undefined) {
    return undefined;
  }
  return {
    paidAmount: order.paidAmount,
    refundedTotal: order.refundedTotal,
    status: order.status,
  };
}
