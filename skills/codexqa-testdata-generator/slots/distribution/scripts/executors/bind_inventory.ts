#!/usr/bin/env node
/** Bind a catalog product to a distributor. */

import { callHttp, runMain } from "../../../common/client.ts";

export async function main(params: Record<string, unknown>): Promise<{
  success: boolean;
  data: unknown;
  error: string | null;
}> {
  const distributorId = params.distributorId;
  const productId = params.productId;
  if (!distributorId || !productId) {
    return { success: false, data: null, error: "missing required param: distributorId or productId" };
  }
  const result = await callHttp(
    `/v1/distributors/${distributorId}/inventory`,
    { productId },
    "POST",
  );
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("bind_inventory.ts")) {
  await runMain(main, process.argv, {
    description: "Bind a catalog product to a distributor.",
    exampleJson: '{"distributorId":"d_1","productId":"p_1"}',
  });
}
