import * as db from './db.js';
import * as inventory from './inventory.js';
import { computeOrderTotal } from './pricing.js';
import { createLogger } from './logger.js';

const log = createLogger('reservation');

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * @typedef {{ sku: string, qty: number, unitPrice: number }} OrderLine
 */

/**
 * Holds stock for an order so the customer can finish checkout.
 *
 * @param {{ orderId: string, lines: OrderLine[], ttlMs?: number }} request
 * @returns {Promise<{ ok: boolean, reservation?: object, reason?: string, sku?: string }>}
 */
export async function createReservation(request) {
  const { orderId, lines, ttlMs = DEFAULT_TTL_MS } = request;

  return db.withLock(`order:${orderId}`, async () => {
    const holds = [];

    for (const line of lines) {
      const held = await inventory.holdStock(line.sku, line.qty);
      if (!held) {
        for (const placed of holds) {
          await inventory.releaseStock(placed.sku, placed.qty);
        }
        log.info('reservation rejected', { orderId, sku: line.sku, qty: line.qty });
        return { ok: false, reason: 'OUT_OF_STOCK', sku: line.sku };
      }
      holds.push({ sku: line.sku, qty: line.qty });
    }

    const now = Date.now();
    const reservation = {
      id: db.nextId('res'),
      orderId,
      lines: lines.map((line) => ({ ...line })),
      holds,
      status: 'HELD',
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    db.saveReservation(reservation);
    log.info('reservation held', { reservationId: reservation.id, orderId, lines: lines.length });
    return { ok: true, reservation };
  });
}

/**
 * Turns a held reservation into a paid order.
 *
 * @param {string} reservationId
 * @returns {Promise<{ ok: boolean, order?: object, reason?: string }>}
 */
export async function commitReservation(reservationId) {
  return db.withLock(`res:${reservationId}`, async () => {
    const reservation = db.getReservation(reservationId);
    if (reservation === undefined) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (reservation.status !== 'HELD') {
      return { ok: false, reason: 'NOT_HELD' };
    }

    for (const hold of reservation.holds) {
      await inventory.releaseStock(hold.sku, hold.qty);
      await inventory.consumeStock(hold.sku, hold.qty);
    }

    reservation.status = 'COMMITTED';
    reservation.committedAt = Date.now();
    db.saveReservation(reservation);

    const totals = computeOrderTotal(reservation.lines);
    const order = db.saveOrder({
      id: reservation.orderId,
      reservationId: reservation.id,
      lines: reservation.lines,
      paidAmount: totals.total,
      refundedTotal: 0,
      paymentRef: `pay_${reservation.orderId}`,
      status: 'PAID',
      createdAt: Date.now(),
    });

    log.info('reservation committed', { reservationId, orderId: order.id, total: order.paidAmount });
    return { ok: true, order };
  });
}

/**
 * Releases a held reservation before it is committed.
 *
 * @param {string} reservationId
 * @param {string} [reason]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function cancelReservation(reservationId, reason = 'CUSTOMER_CANCELLED') {
  return db.withLock(`res:${reservationId}`, async () => {
    const reservation = db.getReservation(reservationId);
    if (reservation === undefined || reservation.status !== 'HELD') {
      return { ok: false, reason: 'NOT_HELD' };
    }

    for (const hold of reservation.holds) {
      await inventory.releaseStock(hold.sku, hold.qty);
    }

    reservation.status = 'CANCELLED';
    reservation.cancelledAt = Date.now();
    reservation.cancelReason = reason;
    db.saveReservation(reservation);

    log.info('reservation cancelled', { reservationId, reason });
    return { ok: true };
  });
}
