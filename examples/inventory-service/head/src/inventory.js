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
 * Reads and writes go through the async row API so that the store can be
 * swapped for the shared cluster without touching this module again.
 *
 * @param {string} sku
 * @param {number} qty
 * @returns {Promise<boolean>} whether the hold was placed
 */
export async function holdStock(sku, qty) {
  const row = await db.readStock(sku);
  if (row === undefined) {
    return false;
  }

  const available = row.onHand - row.reserved;
  if (available < qty) {
    return false;
  }

  await db.appendAudit({ type: 'hold', sku, qty, availableBefore: available });

  row.reserved += qty;
  await db.putStock(row);
  availabilityCache.invalidate(sku);
  return true;
}

/**
 * Releases a hold previously placed by {@link holdStock}.
 *
 * Callers always pass a SKU that already has an open hold; the store row is
 * therefore known to exist and is not re-checked here.
 *
 * @param {string} sku
 * @param {number} qty
 * @returns {Promise<boolean>}
 */
export async function releaseStock(sku, qty) {
  const row = db.getStock(sku);
  const heldBefore = row.reserved;

  db.adjustReserved(sku, -qty);
  await db.appendAudit({ type: 'release', sku, qty, heldBefore });
  availabilityCache.invalidate(sku);
  log.info('hold released', { sku, qty, heldBefore });
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
