#!/usr/bin/env node
/** Deterministic command generation for config entities. */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function loadContext(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

export function findServiceId(configMap: JsonObject, key: string, hintText = ""): string | null {
  const candidates: Array<[string, string]> = [];
  for (const [cmKey, cmVal] of Object.entries(configMap)) {
    const row = asObject(cmVal);
    const serviceId = String(row.serviceId ?? "");
    const bareKey = cmKey.split("(")[0].trim();
    if (bareKey === key) candidates.push([cmKey, serviceId]);
    else if (cmKey.includes(key)) candidates.push([cmKey, serviceId]);
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0][1];
  for (const [, serviceId] of candidates) {
    if (serviceId && hintText.includes(serviceId)) return serviceId;
  }
  return candidates[0][1];
}

export function resolveEntityRefs(value: string, entities: JsonObject[]): string {
  return value.replace(/\$\{(\w+)\.(\w+)\}/g, (full, entityId: string, fieldName: string) => {
    for (const e of entities) {
      if (e.entityId === entityId) {
        const fields = asObject(e.fields);
        const fval = fields[fieldName];
        if (fval !== undefined && fval !== null) return String(fval);
      }
    }
    return full;
  });
}

export function generateForEntity(
  entity: JsonObject,
  configMap: JsonObject,
  entities: JsonObject[],
): { fields: JsonObject; warnings: string[] } {
  const targetValues = asObject(entity.targetValues);
  const constraints = String(entity.constraints ?? "");
  const queries = asObject(entity.queries);
  const hintText = `${constraints} ${queries.angleA ?? ""} ${queries.angleB ?? ""}`;

  const fields: JsonObject = {};
  const warnings: string[] = [];

  for (const [key, tvRaw] of Object.entries(targetValues)) {
    const tv = asObject(tvRaw);
    const value = tv.value == null ? "" : String(tv.value);
    let serviceId = tv.serviceId == null || tv.serviceId === "" ? null : String(tv.serviceId);
    if (!serviceId) serviceId = findServiceId(configMap, key, hintText);
    if (!serviceId) {
      warnings.push(`entity=${entity.entityId}: key=${key} has no serviceId in configMap`);
      serviceId = "UNKNOWN_SERVICE";
    }
    const resolvedValue = resolveEntityRefs(value, entities);
    const getCmd = `config-store get ${serviceId} ${key}`;
    const setCmd = `config-store set ${serviceId} ${key} ${resolvedValue}`;
    fields[key] = `${getCmd}\n${setCmd}`;
  }
  return { fields, warnings };
}

export function processManifest(manifest: JsonObject, configMap: JsonObject): JsonObject {
  const entities = asObjects(manifest.entities);
  let total = 0;
  const allWarnings: string[] = [];

  for (const entity of entities) {
    if (entity.constructionStrategy !== "config") continue;
    total += 1;
    const result = generateForEntity(entity, configMap, entities);
    entity.fields = result.fields;
    entity.entityStatus = "unverified";
    entity.dataConfidence = 0.5;
    entity.toolBinding = {
      toolType: "config-script",
      resourceId: null,
      skillRoot: null,
      invokeCmd: null,
      toolStatus: "available",
    };
    entity.verifyNote = null;
    entity.failReason = null;
    allWarnings.push(...result.warnings);
  }
  return { processed: total, warnings: allWarnings };
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      context: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node generate_config_commands.ts --manifest <path> --context <path>

Generate deterministic commands for config-strategy entities.

Options:
  --manifest <path>   Manifest JSON (required)
  --context <path>    business-context.json (required)
  -h, --help          Show this help and exit

Example:
  node generate_config_commands.ts --manifest ./testdata/case-materials/case-1/manifest.json --context ./testdata/case-materials/business-context.json
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }
  if (!values.context) {
    process.stderr.write("ERROR: --context is required\n");
    return 2;
  }

  let manifest: JsonObject;
  try {
    manifest = loadManifest(values.manifest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`ERROR: manifest not found: ${values.manifest}\n`);
      return 2;
    }
    throw err;
  }

  let context: JsonObject;
  try {
    context = loadContext(values.context);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`ERROR: context not found: ${values.context}\n`);
      return 2;
    }
    throw err;
  }

  const configMap = asObject(context.configMap);
  const summary = processManifest(manifest, configMap);
  dumpManifest(values.manifest, manifest);
  const warnings = Array.isArray(summary.warnings) ? (summary.warnings as string[]) : [];
  for (const w of warnings) process.stderr.write(`WARNING: ${w}\n`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate_config_commands.ts")) {
  process.exit(main());
}
