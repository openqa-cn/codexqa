#!/usr/bin/env node
/** Shared HTTP helper. Never logs tokens. */

import type { Json, JsonObject } from "./config.ts";

export type RequestResult = JsonObject & {
  ok: boolean;
  data?: Json;
  error?: string;
  status?: number;
};

export async function requestJson(
  url: string,
  method = "GET",
  body: JsonObject | Json[] | null = null,
  headers: Record<string, string> | null = null,
  timeout = 20,
): Promise<RequestResult> {
  const reqHeaders: Record<string, string> = { Accept: "application/json" };
  let payload: string | undefined;
  if (body !== null) {
    payload = JSON.stringify(body);
    reqHeaders["Content-Type"] = "application/json";
  }
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (v) reqHeaders[k] = v;
    }
  }
  try {
    const resp = await fetch(url, {
      method,
      headers: reqHeaders,
      body: payload,
      signal: AbortSignal.timeout(timeout * 1000),
    });
    const raw = (await resp.text()) || "{}";
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${raw.slice(0, 300)}`, status: resp.status };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (exc) {
      return { ok: false, error: `invalid JSON: ${exc}` };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, data: parsed as Json, status: resp.status };
    }
    return { ok: true, data: { result: parsed as Json }, status: resp.status };
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    if (message.includes("abort") || message.includes("Timeout")) {
      return { ok: false, error: `network: ${message}` };
    }
    if (message.startsWith("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
      return { ok: false, error: `network: ${message}` };
    }
    return { ok: false, error: message };
  }
}

export function joinUrl(base: string, path: string, params: Record<string, unknown> = {}): string {
  const trimmed = (base || "").replace(/\/+$/, "");
  let rendered = path.replace(/\{([^}]+)\}/g, (_all, key: string) =>
    encodeURIComponent(String(params[key] ?? "")),
  );
  if (!rendered.startsWith("/")) rendered = `/${rendered}`;
  let url = trimmed + rendered;
  const query: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (!path.includes(`{${k}}`) && v !== null && v !== undefined) {
      query.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  if (query.length) url += `?${query.join("&")}`;
  return url;
}
