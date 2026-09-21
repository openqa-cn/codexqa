#!/usr/bin/env node
/** Set a distributor commission rate. */

import { callHttp, runMain } from "../../../common/client.ts";

export async function main(params: Record<string, unknown>): Promise<{
  success: boolean;
  data: unknown;
  error: string | null;
}> {
  const distributorId = params.distributorId;
  if (!distributorId) {
    return { success: false, data: null, error: "missing required param: distributorId" };
  }
  const rate = Number(params.rate !== null && params.rate !== undefined ? params.rate : 0.1);
  const result = await callHttp(
    `/v1/distributors/${distributorId}/commission`,
    { rate },
    "POST",
  );
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("set_commission.ts")) {
  await runMain(main, process.argv, {
    description: "Set a distributor commission rate.",
    exampleJson: '{"distributorId":"d_1","rate":0.1}',
  });
}
