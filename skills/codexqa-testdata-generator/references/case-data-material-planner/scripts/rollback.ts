#!/usr/bin/env node
/** Clear object state from lint-gate failingIds so items return to a pending-rerun state. */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { Json, JsonObject } from "../../../scripts/adapters/config.ts";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function ensureObj(parent: JsonObject, key: string): JsonObject {
  const cur = parent[key];
  if (cur && typeof cur === "object" && !Array.isArray(cur)) return cur as JsonObject;
  const obj: JsonObject = {};
  parent[key] = obj;
  return obj;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCacheLock<T>(cachePath: string, fn: () => T | Promise<T>): Promise<T> {
  const lockPath = `${cachePath}.lock`;
  const dirName = dirname(lockPath) || ".";
  mkdirSync(dirName, { recursive: true });
  const retryMs = 50;
  const maxWaitMs = 30_000;
  const start = Date.now();
  let fd: number | undefined;
  while (Date.now() - start < maxWaitMs) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        await sleep(retryMs);
        continue;
      }
      throw err;
    }
  }
  if (fd === undefined) throw new Error(`timeout acquiring lock: ${lockPath}`);
  try {
    return await fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

export function clearEntity(entity: JsonObject): void {
  entity.toolBinding = {
    toolType: null,
    resourceId: null,
    invokeCmd: null,
    toolStatus: null,
  };
  const fields = asObject(entity.fields);
  const cleared: JsonObject = {};
  for (const k of Object.keys(fields)) cleared[k] = null;
  entity.fields = cleared;
  entity.entityStatus = null;
  entity.dataConfidence = null;
  entity.verifyNote = null;
  entity.failReason = null;
}

export function clearAction(action: JsonObject): void {
  action.toolBinding = {
    toolType: null,
    resourceId: null,
    cmdTemplate: null,
    toolStatus: null,
  };
  action.filledCmd = null;
  action.cmdStatus = null;
  action.cmdConfidence = null;
  action.verifyNote = null;
  action.failReason = null;
}

function buildCacheKeyForEntity(entity: JsonObject): string {
  const etype = String(entity.entityType ?? "");
  const intent = String(entity.constructionIntent ?? "create");
  return `${etype}::${intent}`;
}

function shouldInvalidateCache(failReason: unknown): boolean {
  if (!failReason) return false;
  return String(failReason).startsWith("[capability-mismatch]");
}

async function invalidateCacheEntries(cachePath: string, keys: string[]): Promise<string[]> {
  if (!existsSync(cachePath) || !statSync(cachePath).isFile()) return [];
  return withCacheLock(cachePath, () => {
    let cache: JsonObject;
    try {
      cache = JSON.parse(readFileSync(cachePath, "utf8")) as JsonObject;
    } catch {
      return [];
    }
    const invalidated: string[] = [];
    for (const key of keys) {
      for (const section of ["entityBindings", "actionBindings"]) {
        const bindings = asObject(cache[section]);
        cache[section] = bindings;
        if (key in bindings) {
          delete bindings[key];
          invalidated.push(key);
          break;
        }
        for (const entry of Object.values(bindings)) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
          const aliases = (entry as JsonObject).aliases;
          if (Array.isArray(aliases) && aliases.includes(key)) {
            (entry as JsonObject).aliases = aliases.filter((a) => a !== key);
          }
        }
      }
    }
    if (invalidated.length) {
      const dirName = dirname(cachePath) || ".";
      const tmpPath = join(dirName, `.${randomBytes(8).toString("hex")}.tmp`);
      const fd = openSync(tmpPath, "w");
      try {
        writeSync(fd, `${JSON.stringify(cache, null, 2)}\n`, 0, "utf8");
        fsyncSync(fd);
        closeSync(fd);
        renameSync(tmpPath, cachePath);
      } catch (err) {
        try {
          closeSync(fd);
        } catch {
          /* already closed */
        }
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        throw err;
      }
    }
    return invalidated;
  });
}

export async function apply(manifest: JsonObject, cachePath: string | null = null): Promise<JsonObject> {
  const gate = asObject(asObject(manifest.pipelines)["lint-gate"]);
  const failing = asObject(gate.failingIds);
  const fe = new Set((Array.isArray(failing.entities) ? failing.entities : []).map(String));
  const fa = new Set((Array.isArray(failing.actions) ? failing.actions : []).map(String));

  if (!Array.isArray(manifest.entities)) manifest.entities = [];
  if (!Array.isArray(manifest.actions)) manifest.actions = [];
  const entities = manifest.entities as JsonObject[];
  const actions = manifest.actions as JsonObject[];
  const pipelines = ensureObj(manifest, "pipelines");

  const affected: JsonObject = {
    entities: [],
    actions: [],
    cacheInvalidated: [],
    cachePreserved: [],
  };
  const cacheKeys: string[] = [];

  for (const e of entities) {
    if (fe.has(String(e.entityId))) {
      const cacheKey = buildCacheKeyForEntity(e);
      if (shouldInvalidateCache(e.failReason)) {
        cacheKeys.push(cacheKey);
      } else {
        (affected.cachePreserved as JsonObject[]).push({
          id: e.entityId as Json,
          key: cacheKey,
          reason: ("failReason" in e ? e.failReason : "(no failReason)") as Json,
        });
      }
      clearEntity(e);
      (affected.entities as string[]).push(String(e.entityId));
    }
  }

  for (const a of actions) {
    if (fa.has(String(a.actionId))) {
      const desc = String(a.actionDesc ?? "");
      if (desc) {
        if (shouldInvalidateCache(a.failReason)) {
          cacheKeys.push(desc);
        } else {
          (affected.cachePreserved as JsonObject[]).push({
            id: a.actionId as Json,
            key: desc,
            reason: ("failReason" in a ? a.failReason : "(no failReason)") as Json,
          });
        }
      }
      clearAction(a);
      (affected.actions as string[]).push(String(a.actionId));
    }
  }

  if ((affected.entities as string[]).length) ensureObj(pipelines, "data-track").status = "running";
  if ((affected.actions as string[]).length) ensureObj(pipelines, "action-track").status = "running";
  ensureObj(pipelines, "lint-gate").status = "pending";

  if (cachePath && cacheKeys.length) {
    affected.cacheInvalidated = await invalidateCacheEntries(cachePath, cacheKeys);
  }
  return affected;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      cache: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node rollback.ts --manifest <path> [--cache <path>]

Roll back a failed lint-gate / execute pass and optionally invalidate cache keys.

Options:
  --manifest <path>   Manifest JSON (required)
  --cache <path>      Optional tool-binding cache to invalidate
  -h, --help          Show this help and exit

Example:
  node rollback.ts --manifest ./testdata/case-materials/case-1/manifest.json --cache ./testdata/case-materials/tool-binding-cache.json
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }
  const manifest = loadManifest(values.manifest);
  const affected = await apply(manifest, values.cache ?? null);
  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify({ affected })}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("rollback.ts")) {
  process.exit(await main());
}
