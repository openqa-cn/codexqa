#!/usr/bin/env node
/** Deterministically compute executionBatch from the entities dependency DAG. */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { Json, JsonObject } from "../../../scripts/adapters/config.ts";

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
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

export function buildGraph(entities: JsonObject[]): {
  adjacency: Map<string, string[]>;
  inDegree: Map<string, number>;
  ids: Set<string>;
} {
  const ids = new Set<string>();
  for (const e of entities) {
    if (typeof e.entityId === "string") ids.add(e.entityId);
  }
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const eid of ids) {
    adjacency.set(eid, []);
    inDegree.set(eid, 0);
  }
  for (const e of entities) {
    const eid = e.entityId;
    if (typeof eid !== "string" || !eid) continue;
    for (const dep of asObjects(e.dependencies)) {
      const depId = dep.entityId;
      if (typeof depId === "string" && depId && ids.has(depId)) {
        adjacency.get(depId)!.push(eid);
        inDegree.set(eid, (inDegree.get(eid) || 0) + 1);
      }
    }
  }
  return { adjacency, inDegree, ids };
}

export function topoSortLayers(
  adjacency: Map<string, string[]>,
  inDegree: Map<string, number>,
): { layers: string[][]; cycleNodes: Set<string> } {
  const queue: string[] = [];
  for (const [eid, deg] of inDegree) {
    if (deg === 0) queue.push(eid);
  }
  const layers: string[][] = [];
  const visited = new Set<string>();

  while (queue.length) {
    const layer: string[] = [];
    const n = queue.length;
    for (let i = 0; i < n; i++) {
      const node = queue.shift()!;
      layer.push(node);
      visited.add(node);
    }
    layers.push([...layer].sort());

    const nextQueue: string[] = [];
    for (const node of layer) {
      for (const neighbor of adjacency.get(node) || []) {
        const next = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, next);
        if (next === 0) nextQueue.push(neighbor);
      }
    }
    queue.push(...nextQueue.sort());
  }

  const cycleNodes = new Set<string>();
  for (const eid of inDegree.keys()) {
    if (!visited.has(eid)) cycleNodes.add(eid);
  }
  return { layers, cycleNodes };
}

export function applyBatches(entities: JsonObject[], layers: string[][]): JsonObject {
  const eidToBatch = new Map<string, number>();
  layers.forEach((layer, i) => {
    for (const eid of layer) eidToBatch.set(eid, i + 1);
  });

  let changed = 0;
  for (const e of entities) {
    const eid = e.entityId;
    if (typeof eid === "string" && eidToBatch.has(eid)) {
      const old = e.executionBatch;
      const next = eidToBatch.get(eid)!;
      if (old !== next) changed += 1;
      e.executionBatch = next;
    }
  }

  const layerMap: JsonObject = {};
  layers.forEach((layer, i) => {
    layerMap[String(i + 1)] = layer;
  });
  return {
    totalEntities: eidToBatch.size,
    totalBatches: layers.length,
    changed,
    layers: layerMap,
  };
}

async function readCacheLocked(cachePath: string): Promise<JsonObject> {
  return withCacheLock(cachePath, () => {
    try {
      const data = JSON.parse(readFileSync(cachePath, "utf8"));
      return asObject(data);
    } catch {
      return {};
    }
  });
}

export async function buildSkillSessions(
  entities: JsonObject[],
  cachePath: string | null,
): Promise<JsonObject[]> {
  const cacheBindings = new Map<string, JsonObject>();
  if (cachePath && existsSync(cachePath)) {
    const cacheData = await readCacheLocked(cachePath);
    const rawBindings = asObject(cacheData.entityBindings);
    for (const [fullKey, entry] of Object.entries(rawBindings)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as JsonObject;
      const baseType = fullKey.includes("::") ? fullKey.split("::")[0] : fullKey;
      const existing = cacheBindings.get(baseType);
      if (existing === undefined) {
        cacheBindings.set(baseType, row);
      } else if (row.status === "proven" && existing.status !== "proven") {
        cacheBindings.set(baseType, row);
      }
    }
  }

  const groups = new Map<string, { batch: Json; etype: string; deps: string[]; entities: JsonObject[] }>();
  for (const e of entities) {
    if (e.constructionStrategy !== "tool-build") continue;
    const batch = e.executionBatch ?? 1;
    const etype = String(e.entityType ?? "");
    const deps = asObjects(e.dependencies)
      .map((d) => String(d.entityId ?? ""))
      .sort();
    const key = `${JSON.stringify(batch)}\0${etype}\0${deps.join("\0")}`;
    const group = groups.get(key);
    if (group) group.entities.push(e);
    else groups.set(key, { batch, etype, deps, entities: [e] });
  }

  const sessions: JsonObject[] = [];
  let sessionIdx = 0;
  for (const { etype, deps, entities: groupEntities } of groups.values()) {
    if (groupEntities.length < 2) continue;
    const cacheEntry = cacheBindings.get(etype) || {};
    const toolBinding = asObject(cacheEntry.toolBinding);
    const skillId = toolBinding.resourceId ?? null;
    const skillRoot = toolBinding.skillRoot ?? null;
    sessionIdx += 1;
    sessions.push({
      sessionId: `SS${String(sessionIdx).padStart(2, "0")}`,
      skillId,
      skillRoot,
      entityIds: groupEntities.map((e) => e.entityId as Json),
      sharedDependency: deps.length === 1 ? deps[0] : null,
      executionMode: "sequential-in-single-agent",
    });
  }
  return sessions;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      "with-sessions": { type: "boolean", default: false },
      cache: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node topo_sort_batch.ts --manifest <path> [options]

Topologically batch entities and optionally attach skill sessions.

Options:
  --manifest <path>   Manifest JSON (required)
  --with-sessions     Build skillSessions (uses --cache when set)
  --cache <path>      Optional tool-binding cache
  -h, --help          Show this help and exit

Example:
  node topo_sort_batch.ts --manifest ./testdata/case-materials/case-1/manifest.json --with-sessions --cache ./testdata/case-materials/tool-binding-cache.json
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
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

  const entities = asObjects(manifest.entities);
  if (!entities.length) {
    process.stdout.write(`${JSON.stringify({ totalEntities: 0, totalBatches: 0, changed: 0, layers: {} })}\n`);
    return 0;
  }

  const { adjacency, inDegree } = buildGraph(entities);
  const { layers, cycleNodes } = topoSortLayers(adjacency, inDegree);

  if (cycleNodes.size) {
    const cyclePath = [...cycleNodes].sort().join(" → ");
    process.stderr.write(`ERROR: circular dependency detected: ${cyclePath}\n`);
    return 1;
  }

  const result = applyBatches(entities, layers);

  if (values["with-sessions"]) {
    const sessions = await buildSkillSessions(entities, values.cache ?? null);
    manifest.skillSessions = sessions;
    result.skillSessions = sessions.length;
  }

  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("topo_sort_batch.ts")) {
  process.exit(await main());
}
