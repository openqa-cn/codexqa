import * as db from './db.js';
import { TtlCache } from './cache.js';
import { createLogger } from './logger.js';

const log = createLogger('inventory');

const AVAILABILITY_TTL_MS = 2000;

/**
 * Availability is read far more often than it is written (storefront listing
 * pages hit it on every render), so it is cached. Every mutator in this module
 * invalidates the SKU it touches.
 */
const availabilityCache = new TtlCache({ ttlMs: AVAILABILITY_TTL_MS, name: 'availability' });

/**
 * Units a customer can still buy: on hand minus everything currently held by
 * open reservations.
 *
 * @param {string} sku
 * @returns {Promise<number>}
 */
export async function checkAvailability(sku) {
  const cached = availabilityCache.get(sku);
  if (cached !== undefined) {
    return cached;
  }

  const row = await db.readStock(sku);
  if (row === undefined) {
    return 0;
  }

  const available = Math.max(0, row.onHand - row.reserved);
  availabilityCache.set(sku, available);
  return available;
}

/**
 * Places a hold on `qty` units of `sku`.
 *
 * @param {string} sku
 * @param {number} qty
 * @returns {Promise<boolean>} whether the hold was placed
 */
export async function holdStock(sku, qty) {
  const row = db.getStock(sku);
  if (row === undefined) {
    return false;
  }
  if (row.onHand - row.reserved < qty) {
    return false;
  }

  db.adjustReserved(sku, qty);
  await db.appendAudit({ type: 'hold', sku, qty });
  availabilityCache.invalidate(sku);
  return true;
}

/**
 * Releases a hold previously placed by {@link holdStock}.
 *
 * @param {string} sku
 * @param {number} qty
 * @returns {Promise<boolean>}
 */
export async function releaseStock(sku, qty) {
  const row = db.getStock(sku);
  if (row === undefined) {
    return false;
  }

  db.adjustReserved(sku, -qty);
  await db.appendAudit({ type: 'release', sku, qty });
  availabilityCache.invalidate(sku);
  return true;
}

/**
 * Reduces on-hand stock for units that have left the warehouse. The matching
 * hold is not touched here; callers release it separately with
 * {@link releaseStock}.
 *
 * @param {string} sku
 * @param {number} qty
 */
export async function consumeStock(sku, qty) {
  db.adjustOnHand(sku, -qty);
  await db.appendAudit({ type: 'consume', sku, qty });
  availabilityCache.invalidate(sku);
  log.info('stock consumed', { sku, qty });
}

export function availabilityCacheStats() {
  return availabilityCache.stats();
}
