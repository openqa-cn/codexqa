#!/usr/bin/env node
/** merge_patch: merge sidecar patch files written by Agents into the manifest. */

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

const TARGET_TYPE_TO_KEY: Record<string, string> = {
  entity: "entities",
  action: "actions",
};

const ID_FIELD: Record<string, string> = {
  entity: "entityId",
  action: "actionId",
};

const META_ALLOWED_ROOT_KEYS = new Set(["businessContext"]);

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function expandGlob(pattern: string): string[] {
  const dir = dirname(pattern);
  const name = basename(pattern);
  if (!name.includes("*") && !name.includes("?")) {
    return existsSync(pattern) ? [pattern] : [];
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const re = new RegExp(
    `^${name.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
  );
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => join(dir, f))
    .sort();
}

export function loadPatches(path: string): JsonObject[] {
  let files: string[];
  if (existsSync(path) && statSync(path).isDirectory()) {
    files = readdirSync(path)
      .filter((f) => f.endsWith(".patch.json"))
      .map((f) => join(path, f))
      .sort();
  } else if (existsSync(path) && statSync(path).isFile()) {
    files = [path];
  } else {
    files = expandGlob(path);
  }
  return files.map((f) => JSON.parse(readFileSync(f, "utf8")) as JsonObject);
}

export function findTarget(manifest: JsonObject, targetType: string, targetId: string): JsonObject | null {
  const key = TARGET_TYPE_TO_KEY[targetType];
  if (!key) return null;
  const idField = ID_FIELD[targetType];
  for (const obj of asObjects(manifest[key])) {
    if (obj[idField] === targetId) return obj;
  }
  return null;
}

type FieldPerm = {
  targetType?: string;
  allowed_fields?: Set<string>;
  bulk?: boolean;
  meta?: boolean;
  allowed_top_keys?: Set<string>;
  allowed_root_keys?: Set<string>;
};

export const AGENT_WRITE_PERMISSIONS: Record<string, FieldPerm | FieldPerm[]> = {
  "knowledge-build": {
    meta: true,
    allowed_root_keys: new Set(["businessContext"]),
  },
  "parse-case": {
    bulk: true,
    allowed_top_keys: new Set(["entities", "actions"]),
  },
  "search-data-tool": {
    targetType: "entity",
    allowed_fields: new Set(["toolBinding"]),
  },
  "search-action-tool": {
    targetType: "action",
    allowed_fields: new Set(["toolBinding", "paramsFromEntities", "paramsFromGenerators", "paramsFromPriorActions"]),
  },
  "invoke-data": {
    targetType: "entity",
    allowed_fields: new Set(["fields", "entityStatus", "dataConfidence", "failReason"]),
  },
  "bind-action": {
    targetType: "action",
    allowed_fields: new Set(["filledCmd", "cmdStatus", "cmdConfidence", "failReason"]),
  },
  "verify-data": {
    targetType: "entity",
    allowed_fields: new Set(["entityStatus", "dataConfidence", "verifyNote", "failReason"]),
  },
  "verify-action": {
    targetType: "action",
    allowed_fields: new Set(["cmdConfidence", "verifyNote", "failReason", "cmdStatus"]),
  },
  "data-pipeline": {
    targetType: "entity",
    allowed_fields: new Set(["toolBinding", "fields", "entityStatus", "dataConfidence", "verifyNote", "failReason"]),
  },
  "action-pipeline": {
    targetType: "action",
    allowed_fields: new Set([
      "toolBinding",
      "paramsFromEntities",
      "paramsFromGenerators",
      "paramsFromPriorActions",
      "filledCmd",
      "cmdStatus",
      "cmdConfidence",
      "verifyNote",
      "failReason",
    ]),
  },
  "select-tool": [
    { targetType: "entity", allowed_fields: new Set(["toolBinding"]) },
    { targetType: "action", allowed_fields: new Set(["toolBinding"]) },
  ],
  writeback: [
    { targetType: "entity", allowed_fields: new Set(["writeStatus", "failReason"]) },
    { targetType: "action", allowed_fields: new Set(["writeStatus", "failReason"]) },
  ],
};

const VALID_ENTITY_STATUS = new Set<unknown>([
  null,
  "building",
  "unverified",
  "verified",
  "verify-failed",
  "failed",
  "missing-dependency",
  "runtime-deferred",
]);
const VALID_CMD_STATUS = new Set<unknown>([null, "filled", "missing-param", "gen-failed", "manual"]);
const VALID_TOOL_TYPES = new Set<unknown>([null, "tool", "skill", "script", "reuse", "api-setup", "config-script"]);
const FAIL_REASON_PREFIXES = ["[capability-mismatch]", "[exec-failed]", "[dep-blocked]", "[write-failed]"] as const;

function pyList(items: Iterable<string>): string {
  return `[${[...items].sort().map((s) => `'${s}'`).join(", ")}]`;
}

export function validatePatch(patch: JsonObject): string | null {
  const agent = String(patch.agent ?? "");
  let perm = AGENT_WRITE_PERMISSIONS[agent];
  if (perm === undefined) return `[${agent}] unregistered agent name`;

  const targetType = patch.targetType;
  const fields = asObject(patch.fields);

  if (targetType === "bulk") {
    if (Array.isArray(perm)) return `[${agent}] no bulk write permission`;
    const bulkPerm = perm;
    if (!bulkPerm.bulk) return `[${agent}] no bulk write permission`;
    const extra = Object.keys(fields).filter((k) => !bulkPerm.allowed_top_keys?.has(k));
    if (extra.length) return `[${agent}] bulk patch overreaches top-level keys: ${pyList(extra)}`;
    return null;
  }

  if (targetType === "meta") {
    if (Array.isArray(perm)) return `[${agent}] no meta write permission`;
    const metaPerm = perm;
    if (!metaPerm.meta) return `[${agent}] no meta write permission`;
    const extra = Object.keys(fields).filter((k) => !metaPerm.allowed_root_keys?.has(k));
    if (extra.length) return `[${agent}] meta patch overreaches root keys: ${pyList(extra)}`;
    return null;
  }

  if (Array.isArray(perm)) {
    const matched = perm.find((p) => p.targetType === targetType);
    if (!matched) {
      return (
        `[${agent}] targetType mismatch: ` +
        `patch=${targetType}, allowed=${JSON.stringify(perm.map((p) => p.targetType))}`
      );
    }
    perm = matched;
  }

  const expectedType = perm.targetType;
  if (expectedType && targetType !== expectedType) {
    return `[${agent}] targetType mismatch: patch=${targetType}, permission table=${expectedType}`;
  }

  const allowed = perm.allowed_fields ?? new Set<string>();
  const extra = Object.keys(fields).filter((k) => !allowed.has(k));
  if (extra.length) {
    return `[${agent}] overreach fields: ${pyList(extra)}, allowed: ${pyList(allowed)}`;
  }
  return validateValues(agent, fields);
}

function validateValues(agent: string, fields: JsonObject): string | null {
  if ("entityStatus" in fields && !VALID_ENTITY_STATUS.has(fields.entityStatus ?? null)) {
    return `[${agent}] illegal entityStatus value: ${JSON.stringify(fields.entityStatus)}`;
  }
  if ("cmdStatus" in fields && !VALID_CMD_STATUS.has(fields.cmdStatus ?? null)) {
    return `[${agent}] illegal cmdStatus value: ${JSON.stringify(fields.cmdStatus)}`;
  }
  for (const confKey of ["dataConfidence", "cmdConfidence"]) {
    if (confKey in fields) {
      const v = fields[confKey];
      if (v !== null && v !== undefined) {
        if (typeof v !== "number" || v < 0 || v > 1) {
          return `[${agent}] ${confKey} out of [0.0, 1.0]: ${JSON.stringify(v)}`;
        }
      }
    }
  }
  const tb = fields.toolBinding;
  if (tb && typeof tb === "object" && !Array.isArray(tb)) {
    const tt = (tb as JsonObject).toolType ?? null;
    if (!VALID_TOOL_TYPES.has(tt)) {
      return `[${agent}] illegal toolBinding.toolType value: ${JSON.stringify(tt)}`;
    }
  }
  const fr = fields.failReason;
  if (fr !== null && fr !== undefined && fr !== "" && !FAIL_REASON_PREFIXES.some((p) => String(fr).startsWith(p))) {
    return (
      `[${agent}] failReason does not start with a legal prefix: ${JSON.stringify(String(fr).slice(0, 60))}, ` +
      `legal prefixes: (${FAIL_REASON_PREFIXES.map((p) => `'${p}'`).join(", ")})`
    );
  }

  if (agent === "data-pipeline") {
    const binding = asObject(fields.toolBinding);
    if (fields.toolBinding && typeof fields.toolBinding === "object" && !Array.isArray(fields.toolBinding)
      && binding.toolStatus === "available") {
      const es = fields.entityStatus;
      if (es === null || es === undefined) {
        return (
          `[${agent}] toolStatus=available but entityStatus=null, ` +
          "invoke step was not executed (search-only patch is forbidden)"
        );
      }
      const entityFields = fields.fields;
      if (es === "unverified" && entityFields && typeof entityFields === "object" && !Array.isArray(entityFields)) {
        const values = Object.values(entityFields as JsonObject);
        if (values.length && values.every((v) => v === null)) {
          return (
            `[${agent}] toolStatus=available + entityStatus=unverified ` +
            "but all fields are null; invoke produced no field values"
          );
        }
      }
    }
  }
  return null;
}

export function mergeOne(manifest: JsonObject, patch: JsonObject): string | null {
  const targetType = patch.targetType;
  const targetId = patch.targetId;
  const fields = patch.fields;
  const agent = String(patch.agent ?? "unknown");

  if (!targetType || !fields || typeof fields !== "object" || Array.isArray(fields)) {
    return `[${agent}] patch missing targetType or fields`;
  }
  const fieldObj = fields as JsonObject;

  if (targetType === "bulk") {
    for (const key of ["entities", "actions"]) {
      if (key in fieldObj) manifest[key] = fieldObj[key];
    }
    return null;
  }

  if (targetType === "meta") {
    for (const k of META_ALLOWED_ROOT_KEYS) {
      if (k in fieldObj) manifest[k] = fieldObj[k];
    }
    return null;
  }

  if (!targetId) return `[${agent}] non-bulk patch missing targetId`;

  const target = findTarget(manifest, String(targetType), String(targetId));
  if (target === null) return `[${agent}] ${targetType} ${targetId} does not exist in manifest`;

  for (const [k, v] of Object.entries(fieldObj)) target[k] = v;
  return null;
}

function cleanPatches(path: string): void {
  if (existsSync(path) && statSync(path).isDirectory()) {
    for (const f of readdirSync(path).filter((name) => name.endsWith(".patch.json"))) {
      unlinkSync(join(path, f));
    }
    return;
  }
  if (existsSync(path) && statSync(path).isFile()) {
    unlinkSync(path);
    return;
  }
  for (const f of expandGlob(path)) unlinkSync(f);
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      patch: { type: "string" },
      validate: { type: "boolean", default: true },
      "no-validate": { type: "boolean", default: false },
      clean: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node merge_patch.ts --manifest <path> --patch <file-or-dir> [options]

Merge agent patch files into a case-materials manifest.

Options:
  --manifest <path>     Manifest JSON (required)
  --patch <path>        Patch file or directory (required)
  --validate            Validate patches before merge (default)
  --no-validate         Skip patch validation
  --clean               Delete consumed patch files after a successful merge
  -h, --help            Show this help and exit

Examples:
  node merge_patch.ts --manifest ./testdata/case-materials/case-1/manifest.json --patch patches/ --clean
  node merge_patch.ts --manifest ./testdata/case-materials/case-1/manifest.json --patch patches/ --validate --clean
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }
  if (!values.patch) {
    process.stderr.write("ERROR: --patch is required\n");
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

  const patches = loadPatches(values.patch);
  if (!patches.length) {
    process.stdout.write(`${JSON.stringify({ merged: 0, errors: [] })}\n`);
    return 0;
  }

  patches.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));

  const errors: string[] = [];
  let merged = 0;
  const shouldValidate = !values["no-validate"];

  for (const p of patches) {
    if (shouldValidate) {
      const vErr = validatePatch(p);
      if (vErr) {
        errors.push(vErr);
        continue;
      }
    }
    const err = mergeOne(manifest, p);
    if (err) errors.push(err);
    else merged += 1;
  }

  if (errors.length) {
    for (const e of errors) process.stderr.write(`ERROR: ${e}\n`);
    return 1;
  }

  dumpManifest(values.manifest, manifest);
  if (values.clean) cleanPatches(values.patch);
  process.stdout.write(`${JSON.stringify({ merged, errors })}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("merge_patch.ts")) {
  process.exit(main());
}
