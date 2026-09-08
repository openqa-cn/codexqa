#!/usr/bin/env node
/** Create a standard catalog product. */

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
  const body = {
    name,
    city: params.city || "demo-city",
    kind: "standard",
  };
  const result = await callHttp("/v1/products", body, "POST");
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("create_product.ts")) {
  await runMain(main, process.argv, {
    description: "Create a standard catalog product.",
    exampleJson: '{"name":"demo-product","city":"demo-city"}',
  });
}
