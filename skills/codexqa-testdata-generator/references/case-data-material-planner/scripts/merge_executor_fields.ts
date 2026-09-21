#!/usr/bin/env node
/** Merge executor / tool-registry responses into entity.fields. */

import { parseArgs } from "node:util";
import type { Json, JsonObject } from "../../../scripts/adapters/config.ts";
import { flattenGuard } from "./safe_io.ts";

export const ENVELOPE_KEYS = new Set([
  "success",
  "ok",
  "error",
  "code",
  "message",
  "traceId",
  "requestId",
]);

const IMPLEMENTATION_CMD_RE = /(?:^|\b)(?:node|python3?|bash|npx|npm|config-store)\b|```/;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function isEnvelopeKey(key: string): boolean {
  return ENVELOPE_KEYS.has(key);
}

export function isImplementationValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return IMPLEMENTATION_CMD_RE.test(value.trim());
}

export function flattenBusinessScalars(payload: unknown, prefix = "", depth = 0): JsonObject {
  const out: JsonObject = {};
  if (payload === null || payload === undefined) return out;
  if (typeof payload !== "object") {
    if (prefix && payload !== "") out[prefix] = payload as Json;
    return out;
  }
  if (Array.isArray(payload)) {
    if (prefix && payload.length) out[prefix] = payload as Json;
    return out;
  }
  for (const [key, raw] of Object.entries(payload as JsonObject)) {
    if (isEnvelopeKey(key) || !flattenGuard(key, depth, Object.keys(out).length)) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    if (raw === null || raw === undefined || raw === "") continue;
    if (isImplementationValue(raw)) continue;
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const nested = flattenBusinessScalars(raw, "", depth + 1);
      if (Object.keys(nested).length) {
        for (const [nk, nv] of Object.entries(nested)) {
          if (!flattenGuard(nk, depth + 1, Object.keys(out).length)) continue;
          if (out[nk] === undefined) out[nk] = nv;
        }
      }
      continue;
    }
    out[next] = raw as Json;
  }
  return out;
}

export function extractPayload(raw: unknown): unknown {
  const obj = asObject(raw);
  if (obj.data !== undefined && obj.data !== null) return obj.data;
  return raw;
}

export function mergeExecutorFields(
  declared: JsonObject,
  response: unknown,
  extras: JsonObject = {},
): JsonObject {
  const merged: JsonObject = { ...declared };
  const fromResponse = flattenBusinessScalars(extractPayload(response));
  const fromExtras = flattenBusinessScalars(extras);
  for (const [key, value] of Object.entries({ ...fromExtras, ...fromResponse })) {
    if (value === null || value === undefined || value === "") continue;
    if (isEnvelopeKey(key) || isImplementationValue(value) || !flattenGuard(key, 0, 0)) continue;
    merged[key] = value;
  }
  return merged;
}

export function missingDeclaredKeys(declared: JsonObject, merged: JsonObject): string[] {
  return Object.keys(declared).filter((key) => {
    const val = merged[key];
    return val === null || val === undefined || val === "";
  });
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      declared: { type: "string", default: "{}" },
      response: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node merge_executor_fields.ts --response '<json>' [--declared '<json>']

Merge an executor/tool response into declared entity fields.

Options:
  --response <json>   Executor or registry JSON (required)
  --declared <json>   Existing fields object (default: {})
  -h, --help          Show this help and exit

Example:
  node merge_executor_fields.ts --declared '{"productId":null}' --response '{"success":true,"data":{"productId":"p_1","name":"Northwind"}}'
`);
    return 0;
  }
  if (!values.response) {
    process.stderr.write("ERROR: --response is required\n");
    return 2;
  }
  let declared: JsonObject = {};
  let response: unknown;
  try {
    declared = asObject(JSON.parse(String(values.declared)));
    response = JSON.parse(values.response);
  } catch {
    process.stderr.write("ERROR: --declared and --response must be valid JSON\n");
    return 2;
  }
  const fields = mergeExecutorFields(declared, response);
  process.stdout.write(`${JSON.stringify({ fields, missing: missingDeclaredKeys(declared, fields) })}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("merge_executor_fields.ts")) {
  process.exit(main());
}
