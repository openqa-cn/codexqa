import { createLogger } from './logger.js';

const log = createLogger('gateway');

let queuedFailures = 0;
let calls = 0;

/**
 * Stand-in for the payment provider SDK. The real client lives behind
 * `@acme/payments`; this module keeps the service runnable in isolation.
 *
 * @param {string} paymentRef
 * @param {number} amount
 * @returns {Promise<{ id: string, paymentRef: string, amount: number, settledAt: string }>}
 */
export async function refund(paymentRef, amount) {
  calls += 1;
  await new Promise((resolve) => setTimeout(resolve, 1));

  if (queuedFailures > 0) {
    queuedFailures -= 1;
    throw new Error(`gateway declined refund of ${amount} for ${paymentRef}`);
  }

  const receipt = {
    id: `rf_${calls.toString(36).padStart(6, '0')}`,
    paymentRef,
    amount,
    settledAt: new Date().toISOString(),
  };
  log.info('refund settled', { paymentRef, amount, receipt: receipt.id });
  return receipt;
}

/**
 * Test seam used by the integration suite to drive the failure path.
 *
 * @param {number} count
 */
export function failNextRefunds(count) {
  queuedFailures = count;
}

export function callCount() {
  return calls;
}
