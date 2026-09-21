#!/usr/bin/env node
/** Enroll a catalog product and user in account credit. */

import { callHttp, runMain } from "../../../common/client.ts";

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
    credits: Math.trunc(Number(params.credits || 1000)),
  };
  const result = await callHttp("/v1/credits/enroll", body, "POST");
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("setup_account_credit.ts")) {
  await runMain(main, process.argv, {
    description: "Enroll a catalog product and user in account credit.",
    exampleJson: '{"productId":"p_1","userId":"u_1","credits":1000}',
  });
}
