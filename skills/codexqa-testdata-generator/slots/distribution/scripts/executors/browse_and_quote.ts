#!/usr/bin/env node
/** Browse distributor supply and return a quote. */

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
    `/v1/distributors/${distributorId}/quote`,
    { productId },
    "POST",
  );
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("browse_and_quote.ts")) {
  await runMain(main, process.argv, {
    description: "Browse distributor supply and return a quote.",
    exampleJson: '{"distributorId":"d_1","productId":"p_1"}',
  });
}
