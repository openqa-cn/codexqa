import { createLogger } from './logger.js';

const log = createLogger('pricing');

const TAX_RATE = 0.0825;

const VOLUME_TIER_SMALL = 10;
const VOLUME_TIER_LARGE = 50;
const VOLUME_RATE_SMALL = 0.05;
const VOLUME_RATE_LARGE = 0.1;

/**
 * Rounds a non-negative monetary amount to two decimals, half up.
 *
 * The epsilon nudge is deliberate: amounts such as 1.005 are stored as
 * 1.00499999999999989 in binary floating point and would otherwise round down,
 * which finance flagged during the v1 reconciliation.
 *
 * @param {number} value
 * @returns {number}
 */
export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Discount rate applied to the subtotal for bulk orders.
 *
 * @param {number} units total units across all lines
 * @returns {number} rate between 0 and 1
 */
export function volumeDiscountRate(units) {
  if (units > VOLUME_TIER_LARGE) {
    return VOLUME_RATE_LARGE;
  }
  if (units > VOLUME_TIER_SMALL) {
    return VOLUME_RATE_SMALL;
  }
  return 0;
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
 * Prices a set of order lines. Tax is charged on the discounted subtotal.
 *
 * @param {Array<{ sku: string, qty: number, unitPrice: number }>} lines
 * @param {{ taxRate?: number }} [options]
 * @returns {{ subtotal: number, discount: number, taxable: number, tax: number, total: number, units: number }}
 */
export function computeOrderTotal(lines, options = {}) {
  const taxRate = options.taxRate ?? TAX_RATE;
  let subtotal = 0;
  for (const line of lines) {
    subtotal += lineSubtotal(line);
  }
  subtotal = roundMoney(subtotal);

  const units = totalUnits(lines);
  const discount = roundMoney(subtotal * volumeDiscountRate(units));
  const taxable = roundMoney(subtotal - discount);
  const tax = roundMoney(taxable * taxRate);
  const total = roundMoney(taxable + tax);

  log.info('priced order', { units, subtotal, discount, total });
  return { subtotal, discount, taxable, tax, total, units };
}
