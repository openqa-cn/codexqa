import { createLogger } from './logger.js';

const log = createLogger('db');

const SLOW_LOCK_MS = 250;

/**
 * @typedef {{ sku: string, onHand: number, reserved: number, version: number }} StockRow
 */

const state = {
  /** @type {Map<string, StockRow>} */
  stock: new Map(),
  /** @type {Map<string, object>} */
  orders: new Map(),
  /** @type {Map<string, object>} */
  reservations: new Map(),
  /** @type {object[]} */
  audit: [],
};

const heldLocks = new Set();
/** @type {Map<string, Array<() => void>>} */
const lockWaiters = new Map();
let sequence = 0;

/** Simulates the latency of a round trip to the persistence layer. */
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

export function reset() {
  state.stock.clear();
  state.orders.clear();
  state.reservations.clear();
  state.audit.length = 0;
  heldLocks.clear();
  lockWaiters.clear();
  sequence = 0;
}

/**
 * @param {Array<{ sku: string, onHand: number, reserved?: number }>} rows
 */
export function seedStock(rows) {
  for (const row of rows) {
    state.stock.set(row.sku, {
      sku: row.sku,
      onHand: row.onHand,
      reserved: row.reserved ?? 0,
      version: 1,
    });
  }
}

/**
 * Live row accessor. The returned object is the one held in the store, so
 * callers that mutate it write through immediately.
 *
 * @param {string} sku
 * @returns {StockRow | undefined}
 */
export function getStock(sku) {
  return state.stock.get(sku);
}

/**
 * Snapshot read through the async row API.
 *
 * @param {string} sku
 * @returns {Promise<StockRow | undefined>}
 */
export async function readStock(sku) {
  await tick();
  const row = state.stock.get(sku);
  return row === undefined ? undefined : { ...row };
}

/**
 * Writes a full row back to the store and bumps its version.
 *
 * @param {StockRow} row
 */
export async function putStock(row) {
  await tick();
  state.stock.set(row.sku, { ...row, version: row.version + 1 });
}

/**
 * @param {string} sku
 * @param {number} delta
 */
export function adjustOnHand(sku, delta) {
  const row = state.stock.get(sku);
  if (row === undefined) return undefined;
  row.onHand = Math.max(0, row.onHand + delta);
  row.version += 1;
  return row;
}

/**
 * @param {string} sku
 * @param {number} delta
 */
export function adjustReserved(sku, delta) {
  const row = state.stock.get(sku);
  if (row === undefined) return undefined;
  row.reserved = Math.max(0, row.reserved + delta);
  row.version += 1;
  return row;
}

export function getOrder(orderId) {
  return state.orders.get(orderId);
}

export function saveOrder(order) {
  state.orders.set(order.id, order);
  return order;
}

export function getReservation(reservationId) {
  return state.reservations.get(reservationId);
}

export function saveReservation(reservation) {
  state.reservations.set(reservation.id, reservation);
  return reservation;
}

export function listReservations() {
  return [...state.reservations.values()];
}

export async function appendAudit(entry) {
  await tick();
  state.audit.push({ ...entry, at: Date.now() });
}

export function auditTrail() {
  return [...state.audit];
}

export function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(5, '0')}`;
}

function acquireLock(key) {
  if (!heldLocks.has(key)) {
    heldLocks.add(key);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const queue = lockWaiters.get(key) ?? [];
    queue.push(() => {
      heldLocks.add(key);
      resolve();
    });
    lockWaiters.set(key, queue);
  });
}

function releaseLock(key) {
  heldLocks.delete(key);
  const queue = lockWaiters.get(key);
  if (queue === undefined || queue.length === 0) {
    lockWaiters.delete(key);
    return;
  }
  const next = queue.shift();
  next();
}

/**
 * Serialises the critical sections that touch a single order or reservation.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLock(key, fn) {
  await acquireLock(key);
  try {
    return await fn();
  } finally {
    releaseLock(key);
  }
}

export function lockDiagnostics() {
  return {
    held: [...heldLocks],
    waiting: [...lockWaiters.entries()].map(([key, queue]) => ({ key, waiters: queue.length })),
    slowLockThresholdMs: SLOW_LOCK_MS,
  };
}
