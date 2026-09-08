import { createLogger } from './logger.js';

const log = createLogger('pricing');

const TAX_RATE = 0.0825;

/**
 * Rounds a monetary amount to two decimals, half up.
 *
 * @param {number} value
 * @returns {number}
 */
export function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {{ sku: string, qty: number, unitPrice: number }} line
 * @returns {number}
 */
export function lineSubtotal(line) {
  if (!Number.isFinite(line.unitPrice) || !Number.isFinite(line.qty)) {
    throw new TypeError(`invalid order line for sku ${line.sku}`);
  }
  return roundMoney(line.unitPrice * line.qty);
}

/**
 * @param {Array<{ qty: number }>} lines
 * @returns {number}
 */
export function totalUnits(lines) {
  return lines.reduce((units, line) => units + line.qty, 0);
}

/**
 * Prices a set of order lines.
 *
 * @param {Array<{ sku: string, qty: number, unitPrice: number }>} lines
 * @param {{ taxRate?: number }} [options]
 * @returns {{ subtotal: number, tax: number, total: number, units: number }}
 */
export function computeOrderTotal(lines, options = {}) {
  const taxRate = options.taxRate ?? TAX_RATE;
  let subtotal = 0;
  for (const line of lines) {
    subtotal += lineSubtotal(line);
  }
  subtotal = roundMoney(subtotal);

  const tax = roundMoney(subtotal * taxRate);
  const total = roundMoney(subtotal + tax);
  const units = totalUnits(lines);

  log.info('priced order', { units, subtotal, total });
  return { subtotal, tax, total, units };
}
