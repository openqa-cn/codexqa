#!/usr/bin/env node
/** Create a distributor account. */

import { callHttp, runMain } from "../../../common/client.ts";

export async function main(params: Record<string, unknown>): Promise<{
  success: boolean;
  data: unknown;
  error: string | null;
}> {
  const name = params.name;
  if (!name) {
    return { success: false, data: null, error: "missing required param: name" };
  }
  const result = await callHttp(
    "/v1/distributors",
    { name, region: params.region || "domestic" },
    "POST",
  );
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("create_distributor.ts")) {
  await runMain(main, process.argv, {
    description: "Create a distributor account.",
    exampleJson: '{"name":"demo-distributor","region":"domestic"}',
  });
}
