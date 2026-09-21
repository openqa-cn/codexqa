#!/usr/bin/env node
/**
 * Data-build script: <one-line description>
 *
 * Related APIs:
 *   - <operationId> <HTTP METHOD /path>
 *
 * Parameters:
 *   params.param1: required
 *   params.param2: optional
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV = process.env.DATA_BUILD_ENV || "test";
export const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";

export async function callHttp(
  path: string,
  body: unknown = null,
  method = "POST",
  extraHeaders: Record<string, string> | null = null,
  timeout = 30,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  try {
    const { buildRuntime } = await import("../scripts/adapters/index.ts");
    Object.assign(headers, await buildRuntime().auth.headers());
  } catch {
    const token = process.env.DATA_BUILD_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const url = path.startsWith("http") ? path : BASE_URL.replace(/\/+$/, "") + path;
  const sent: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) sent[key] = value;
  }
  try {
    const resp = await fetch(url, {
      method,
      headers: sent,
      body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout * 1000),
    });
    const raw = (await resp.text()) || "{}";
    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status}: ${raw.slice(0, 300)}` };
    }
    return { success: true, data: JSON.parse(raw) };
  } catch (exc) {
    return { success: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export async function callSql(sql: string) {
  try {
    const { buildRuntime } = await import("../scripts/adapters/index.ts");
    return buildRuntime().data_store.query(sql);
  } catch (exc) {
    return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export async function getConfig(key: string, namespace: string | null = null) {
  try {
    const { buildRuntime } = await import("../scripts/adapters/index.ts");
    return await buildRuntime().config_store.get(key, namespace);
  } catch (exc) {
    return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export async function callFeatureFlag(
  operation: string,
  opts: { flag_key?: string; environment?: string; subject?: string } = {},
) {
  try {
    const { buildRuntime } = await import("../scripts/adapters/index.ts");
    const flags = buildRuntime().feature_flags;
    if (operation === "detail") {
      return await flags.detail(String(opts.flag_key), String(opts.environment));
    }
    if (operation === "evaluate") {
      return await flags.evaluate(String(opts.flag_key), String(opts.subject), String(opts.environment));
    }
    return { ok: false, error: `unsupported feature-flag operation: ${operation}` };
  } catch (exc) {
    return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export async function main(params: Record<string, unknown>): Promise<{
  success: boolean;
  data: unknown;
  error: string | null;
}> {
  const name = params.name;
  if (!name) {
    return { success: false, data: null, error: "missing required param: name" };
  }
  // Replace path and body from the discovered API. Do not invent the backend id.
  const result = await callHttp("/v1/resource", { name }, "POST");
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch {
    return argv1.replace(/\\/g, "/").endsWith("script-template.ts");
  }
}

if (isDirectRun()) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(`Usage: node script-template.ts [--json '<params>']

Template for a local data-build construction script.

Options:
  --json <json>   JSON object of params (default in this template: {"name":"demo-record"})
  -h, --help      Show this help and exit

Example:
  node script-template.ts --json '{"name":"demo-record"}'
`);
    process.exit(0);
  }
  let mock: Record<string, unknown> = { name: "demo-record" };
  const idx = process.argv.indexOf("--json");
  if (idx >= 0 && process.argv[idx + 1] !== undefined) {
    mock = JSON.parse(process.argv[idx + 1]) as Record<string, unknown>;
  }
  const result = await main(mock);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
