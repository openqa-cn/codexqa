#!/usr/bin/env node
/** Invoke a bound tool/skill/script and merge all business fields into the entity. */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { buildRuntime } from "../../../scripts/adapters/index.ts";
import { resolvePackRoot, resolveSkillDir, type JsonObject } from "../../../scripts/adapters/config.ts";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import { mergeExecutorFields, missingDeclaredKeys } from "./merge_executor_fields.ts";
import { extractJsonObject, isAllowedExecutorPath } from "./safe_io.ts";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

export type InvokeResult = {
  entityId: string;
  entityStatus: string;
  dataConfidence: number;
  fields: JsonObject;
  verifyNote: string | null;
  failReason: string | null;
};

const SKIP_STRATEGIES = new Set(["static-value", "config", "runtime"]);

function findEntity(manifest: JsonObject, entityId: string): JsonObject | null {
  return asObjects(manifest.entities).find((e) => e.entityId === entityId) || null;
}

function resolveDependencyParams(entity: JsonObject, manifest: JsonObject): { params: JsonObject; blocked: string | null } {
  const params: JsonObject = { ...asObject(entity.fields) };
  for (const dep of asObjects(entity.dependencies)) {
    const srcId = String(dep.entityId || "");
    const field = String(dep.field || "");
    const asParam = String(dep.asParam || field);
    const src = findEntity(manifest, srcId);
    if (!src) return { params, blocked: `[dep-blocked] missing entity ${srcId}` };
    const status = String(src.entityStatus || "");
    if (status === "failed" || status === "missing-dependency" || !status) {
      return { params, blocked: `[dep-blocked] ${srcId} status=${status || "null"}` };
    }
    const value = asObject(src.fields)[field];
    if (value === null || value === undefined || value === "") {
      return { params, blocked: `[dep-blocked] ${srcId} has no field ${field}` };
    }
    params[asParam] = value;
  }
  return { params, blocked: null };
}

export function substituteInvokeCmd(invokeCmd: string, params: JsonObject, caseId: string, entityId: string): string {
  return invokeCmd.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (full, name: string) => {
    const value = params[name];
    if (value !== null && value !== undefined && value !== "") return String(value);
    if (name === "name") return `${caseId || "case"}-${entityId}`;
    return full;
  });
}

export function parseJsonFlag(cmd: string): JsonObject {
  const m = cmd.match(/--json\s+('(?:\\'|[^'])*'|"(?:\\"|[^"])*")/);
  if (!m) return {};
  let raw = m[1];
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1);
  }
  try {
    const parsed = JSON.parse(raw);
    return asObject(parsed);
  } catch {
    return {};
  }
}

function extractScriptPath(cmd: string): string | null {
  const trimmed = cmd.trim();
  const m = trimmed.match(/^(?:node|npx)\s+(\S+\.(?:ts|js))/);
  return m ? m[1] : null;
}

export function resolveExecutorPath(relOrAbs: string, toolBinding: JsonObject): string | null {
  const skillRoot = String(toolBinding.skillRoot || "") || null;
  const resourceId = String(toolBinding.resourceId || "");
  const pack = resolvePackRoot();
  const skill = resolveSkillDir();
  const candidates = [
    isAbsolute(relOrAbs) ? relOrAbs : "",
    skillRoot ? join(skillRoot, relOrAbs) : "",
    join(pack, relOrAbs),
    resourceId ? join(pack, "slots", resourceId, relOrAbs) : "",
    join(skill, relOrAbs),
    join(pack, "slots", resourceId, "scripts", "executors", relOrAbs.split("/").pop() || ""),
  ].filter(Boolean);
  for (const cand of candidates) {
    if (!existsSync(cand)) continue;
    if (!isAllowedExecutorPath(cand, skillRoot)) continue;
    return cand;
  }
  return null;
}

function runNodeJson(scriptPath: string, params: JsonObject): JsonObject {
  const stdout = execFileSync(process.execPath, [scriptPath, "--json", JSON.stringify(params)], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1_000_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return asObject(extractJsonObject(stdout));
}

function applyEntityResult(entity: JsonObject, result: InvokeResult): void {
  entity.fields = result.fields;
  entity.entityStatus = result.entityStatus;
  entity.dataConfidence = result.dataConfidence;
  entity.verifyNote = result.verifyNote;
  entity.failReason = result.failReason;
}

function finish(entity: JsonObject | null, result: InvokeResult): InvokeResult {
  if (entity) applyEntityResult(entity, result);
  return result;
}

export async function invokeEntity(manifest: JsonObject, entityId: string): Promise<InvokeResult> {
  const entity = findEntity(manifest, entityId);
  if (!entity) {
    return {
      entityId,
      entityStatus: "failed",
      dataConfidence: 0,
      fields: {},
      verifyNote: null,
      failReason: `[capability-mismatch] entity not found: ${entityId}`,
    };
  }
  const strategy = String(entity.constructionStrategy || "tool-build");
  if (SKIP_STRATEGIES.has(strategy)) {
    return finish(entity, {
      entityId,
      entityStatus: String(entity.entityStatus || "verified"),
      dataConfidence: typeof entity.dataConfidence === "number" ? entity.dataConfidence : 0.85,
      fields: asObject(entity.fields),
      verifyNote: "skipped non-tool-build strategy",
      failReason: null,
    });
  }

  const binding = asObject(entity.toolBinding);
  const toolType = String(binding.toolType || "");
  const declared = asObject(entity.fields);
  const caseId = String(manifest.caseId || "case");

  if (toolType === "reuse") {
    const ref = String(binding.resourceId || "");
    if (!/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
      return finish(entity, {
        entityId,
        entityStatus: "failed",
        dataConfidence: 0,
        fields: declared,
        verifyNote: null,
        failReason: `[capability-mismatch] reuse resourceId must be EntityId.field`,
      });
    }
    const [srcId, srcField] = ref.split(".");
    const src = findEntity(manifest, srcId);
    if (!src) {
      return finish(entity, {
        entityId,
        entityStatus: "missing-dependency",
        dataConfidence: 0,
        fields: declared,
        verifyNote: null,
        failReason: `[dep-blocked] reuse source missing: ${srcId}`,
      });
    }
    const copied = srcField && src ? asObject(src.fields)[srcField] : null;
    const fields = mergeExecutorFields(declared, src ? src.fields : {}, srcField && copied != null ? { [srcField]: copied } : {});
    const result: InvokeResult = {
      entityId,
      entityStatus: "unverified",
      dataConfidence: 0.7,
      fields,
      verifyNote: `reuse ${ref}`,
      failReason: null,
    };
    applyEntityResult(entity, result);
    return result;
  }

  if (toolType === "api-setup") {
    const result: InvokeResult = {
      entityId,
      entityStatus: "unverified",
      dataConfidence: 0.7,
      fields: declared,
      verifyNote: "api-setup is deferred; not submitted during construct",
      failReason: null,
    };
    applyEntityResult(entity, result);
    return result;
  }

  const { params, blocked } = resolveDependencyParams(entity, manifest);
  if (blocked) {
    return finish(entity, {
      entityId,
      entityStatus: "missing-dependency",
      dataConfidence: 0,
      fields: declared,
      verifyNote: null,
      failReason: blocked,
    });
  }

  if (binding.toolStatus !== "available") {
    return finish(entity, {
      entityId,
      entityStatus: "failed",
      dataConfidence: 0,
      fields: declared,
      verifyNote: null,
      failReason: `[capability-mismatch] toolBinding.toolStatus=${String(binding.toolStatus || "null")}`,
    });
  }

  const invokeCmd = substituteInvokeCmd(String(binding.invokeCmd || ""), params, caseId, entityId);
  if (/\$\{[A-Za-z_]/.test(invokeCmd) && toolType !== "tool") {
    return finish(entity, {
      entityId,
      entityStatus: "missing-dependency",
      dataConfidence: 0,
      fields: declared,
      verifyNote: null,
      failReason: `[dep-blocked] unsubstituted placeholder in invokeCmd`,
    });
  }
  const jsonParams = { ...params, ...parseJsonFlag(invokeCmd) };

  try {
    let response: JsonObject;
    if (toolType === "tool") {
      const resourceId = String(binding.resourceId || "");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(resourceId)) {
        return finish(entity, {
          entityId,
          entityStatus: "failed",
          dataConfidence: 0,
          fields: declared,
          verifyNote: null,
          failReason: `[capability-mismatch] invalid tool resourceId`,
        });
      }
      const runtime = buildRuntime();
      response = asObject(await runtime.tool_registry.execute(resourceId, jsonParams));
    } else if (toolType === "skill" || toolType === "script") {
      const rel = extractScriptPath(invokeCmd) || String(binding.invokeCmd || "");
      const abs = resolveExecutorPath(rel, binding);
      if (!abs) {
        return finish(entity, {
          entityId,
          entityStatus: "failed",
          dataConfidence: 0,
          fields: declared,
          verifyNote: null,
          failReason: `[capability-mismatch] executor not found: ${rel}`,
        });
      }
      response = runNodeJson(abs, jsonParams);
    } else {
      return finish(entity, {
        entityId,
        entityStatus: "failed",
        dataConfidence: 0,
        fields: declared,
        verifyNote: null,
        failReason: `[capability-mismatch] unsupported toolType=${toolType || "null"}`,
      });
    }

    const ok = response.success === true || response.ok === true || response.error == null;
    if (!ok && response.success === false) {
      return finish(entity, {
        entityId,
        entityStatus: "failed",
        dataConfidence: 0,
        fields: declared,
        verifyNote: null,
        failReason: `[exec-failed] ${String(response.error || "invoke failed")}`,
      });
    }
    const fields = mergeExecutorFields(declared, response, jsonParams);
    const missing = missingDeclaredKeys(declared, fields).filter((k) => /Id$|ID$|^id$/.test(k));
    if (missing.length) {
      return finish(entity, {
        entityId,
        entityStatus: "failed",
        dataConfidence: 0,
        fields,
        verifyNote: null,
        failReason: `[exec-failed] missing declared fields: ${missing.join(",")}`,
      });
    }
    const confirmed = response.success === true || response.ok === true;
    const result: InvokeResult = {
      entityId,
      entityStatus: confirmed ? "verified" : "unverified",
      dataConfidence: confirmed ? 0.85 : 0.7,
      fields,
      verifyNote: confirmed ? "invoke confirmed" : "fields extracted without explicit success marker",
      failReason: null,
    };
    applyEntityResult(entity, result);
    return result;
  } catch (err) {
    return finish(entity, {
      entityId,
      entityStatus: "failed",
      dataConfidence: 0,
      fields: declared,
      verifyNote: null,
      failReason: `[exec-failed] ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function printHelp(): void {
  process.stdout.write(`Usage: node invoke_entity.ts --manifest <path> --entity-id <id>

Invoke a bound skill/tool/script and merge every business field into the entity.

Options:
  --manifest <path>    Manifest JSON (required)
  --entity-id <id>     Entity to invoke (required)
  -h, --help           Show this help and exit

Example:
  node invoke_entity.ts --manifest ./testdata/case-materials/case-1/manifest.json --entity-id E01
`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      "entity-id": { type: "string" },
    },
  });
  if (values.help) {
    printHelp();
    return 0;
  }
  if (!values.manifest || !values["entity-id"]) {
    process.stderr.write("ERROR: --manifest and --entity-id are required\n");
    return 2;
  }
  let manifest;
  try {
    manifest = loadManifest(values.manifest);
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const result = await invokeEntity(manifest, values["entity-id"]);
  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.entityStatus === "failed" || result.entityStatus === "missing-dependency" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("invoke_entity.ts")) {
  process.exit(await main());
}
