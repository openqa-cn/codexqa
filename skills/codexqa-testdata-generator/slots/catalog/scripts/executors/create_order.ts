#!/usr/bin/env node
/** Create a catalog order for an existing product. */

import { callHttp, runMain } from "../../../common/client.ts";

/** Demo default: a near-future date, so the example stays valid as time passes. */
function defaultFulfillOn(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  return date.toISOString().slice(0, 10);
}

export async function main(params: Record<string, unknown>): Promise<{
  success: boolean;
  data: unknown;
  error: string | null;
}> {
  const productId = params.productId;
  const userId = params.userId;
  if (!productId || !userId) {
    return { success: false, data: null, error: "missing required param: productId or userId" };
  }
  const body = {
    productId,
    userId,
    fulfillOn: params.fulfillOn || defaultFulfillOn(),
    quantity: Math.trunc(Number(params.quantity || 1)),
  };
  const result = await callHttp("/v1/orders", body, "POST");
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("create_order.ts")) {
  await runMain(main, process.argv, {
    description: "Create a catalog order for an existing product.",
    exampleJson: `{"productId":"p_1","userId":"u_1","fulfillOn":"${defaultFulfillOn()}","quantity":1}`,
  });
}
