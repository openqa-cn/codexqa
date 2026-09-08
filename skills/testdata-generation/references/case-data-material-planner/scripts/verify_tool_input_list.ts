#!/usr/bin/env node
/** Verify filled action params against tool_registry input schema. */

import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import { buildRuntime } from "../../../scripts/adapters/index.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

async function schema(resourceId: string): Promise<JsonObject[]> {
  return buildRuntime().tool_registry.queryInputList(resourceId);
}

export async function check(action: JsonObject): Promise<[string, string]> {
  const binding = asObject(action.toolBinding);
  const toolType = String(binding.toolType ?? "");
  if (!["tool", "script", "skill"].includes(toolType)) return ["skip", "not a registry tool"];
  const resourceId = String(binding.resourceId ?? "");
  const items = await schema(resourceId);
  if (!items.length) return ["pass", "no schema registered; skipped strict check"];
  const required = new Set(
    items.filter((item) => item.required).map((item) => String(item.name)),
  );
  const actual = action.filledParams ?? action.params ?? {};
  let actualNames = new Set<string>();
  if (Array.isArray(actual)) {
    actualNames = new Set(
      actual
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => String((item as JsonObject).name)),
    );
  } else if (actual && typeof actual === "object") {
    actualNames = new Set(Object.keys(actual as JsonObject));
  }
  const missing = [...required].filter((n) => !actualNames.has(n)).sort();
  if (missing.length) return ["fail", `required missing=${JSON.stringify(missing).replace(/"/g, "'")}`];
  return ["pass", `schema ok required=${required.size}`];
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      "action-ids": { type: "string", default: "" },
      "write-back": { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node verify_tool_input_list.ts --manifest <path> [options]

Verify filled action params against tool_registry input schema.

Options:
  --manifest <path>      Manifest JSON (required)
  --action-ids <ids>     Optional comma-separated actionId filter
  --write-back           Mark failing actions as missing-param
  -h, --help             Show this help and exit

Example:
  node verify_tool_input_list.ts --manifest ./testdata/case-materials/case-1/manifest.json --action-ids A1
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }
  const manifest = loadManifest(values.manifest);
  const wanted = new Set(
    String(values["action-ids"] || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  );
  const results: JsonObject[] = [];
  for (const action of asObjects(manifest.actions)) {
    if (wanted.size && !wanted.has(String(action.actionId))) continue;
    if (action.cmdStatus !== "filled") continue;
    const [outcome, reason] = await check(action);
    results.push({ actionId: action.actionId ?? null, outcome, reason });
    if (values["write-back"] && outcome === "fail") {
      action.cmdStatus = "missing-param";
      action.failReason = `[exec-failed] ${reason}`;
    }
  }
  if (values["write-back"]) dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  return results.every((r) => r.outcome !== "fail") ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify_tool_input_list.ts")) {
  process.exit(await main());
}
