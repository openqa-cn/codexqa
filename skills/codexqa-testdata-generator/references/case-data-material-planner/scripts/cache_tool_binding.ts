#!/usr/bin/env node
/** cache_tool_binding: requirement-level tool-binding cache manager (v2). */

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
import { parseArgs } from "node:util";
import type { Json, JsonObject } from "../../../scripts/adapters/config.ts";
import { batchFetch, feedback, report } from "./experience_compat.ts";

export const PROVEN_CONFIDENCE_THRESHOLD = 0.6;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
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

function emptyCache(): JsonObject {
  return { version: "2.0", entityBindings: {}, actionBindings: {} };
}

function utcStampCompact(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "").slice(0, 14);
}

function utcNowZ(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function loadCache(path: string): JsonObject {
  if (!existsSync(path) || !statSync(path).isFile()) return emptyCache();
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data) || !("entityBindings" in data)) {
      throw new Error("invalid cache structure");
    }
    return data as JsonObject;
  } catch (err) {
    if (err instanceof SyntaxError || (err instanceof Error && err.message === "invalid cache structure")) {
      const backup = `${path}.corrupt.${utcStampCompact()}`;
      try {
        renameSync(path, backup);
      } catch {
        /* ignore */
      }
      process.stderr.write(
        `${JSON.stringify({ warning: `cache corrupted, backed up to ${backup}, starting fresh` })}\n`,
      );
      return emptyCache();
    }
    throw err;
  }
}

export function saveCache(path: string, cache: JsonObject): void {
  const dirName = dirname(path) || ".";
  mkdirSync(dirName, { recursive: true });
  cache.version = "2.0";
  const tmpPath = join(dirName, `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, `${JSON.stringify(cache, null, 2)}\n`, 0, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmpPath, path);
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

export function loadContext(path: string): JsonObject {
  if (!path || !existsSync(path) || !statSync(path).isFile()) return {};
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function normalizeEntityKey(key: string): string {
  return key.includes("::") ? key.split("::")[0] : key;
}

function buildAliasIndex(entityGraph: JsonObject): Record<string, string> {
  const index: Record<string, string> = {};
  for (const [etype, meta] of Object.entries(entityGraph)) {
    index[etype] = etype;
    const aliases = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as JsonObject).aliases : [];
    for (const alias of Array.isArray(aliases) ? aliases : []) {
      index[String(alias)] = etype;
    }
  }
  return index;
}

export function normalizeStatus(entry: JsonObject): string {
  const s = entry.status;
  if (s === "proven") return "proven";
  if (s !== undefined && s !== null && s !== "candidate" && s !== "available") {
    process.stderr.write(
      `${JSON.stringify({ warning: `unexpected cache entry status: ${JSON.stringify(s)}, treating as candidate` })}\n`,
    );
  }
  return "candidate";
}

function makeLookupResult(key: string, entry: JsonObject): JsonObject {
  const status = normalizeStatus(entry);
  const result: JsonObject = { hit: true, key, status };
  for (const field of ["aliases", "toolBinding", "confidence", "cachedAt", "provenAt"]) {
    if (field in entry) result[field] = entry[field] as Json;
  }
  if (status === "proven" && "provenInvocation" in entry) {
    result.provenInvocation = entry.provenInvocation as Json;
  }
  return result;
}

function findEntry(
  key: string,
  bindings: JsonObject,
  context: JsonObject,
  entryType: string,
): [string, JsonObject] | [null, null] {
  if (key in bindings) return [key, asObject(bindings[key])];

  for (const [canonical, entryRaw] of Object.entries(bindings)) {
    const entry = asObject(entryRaw);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    if (aliases.includes(key)) return [canonical, entry];
  }

  if (entryType === "entity") {
    const entityGraph = asObject(context.entityGraph);
    if (!Object.keys(entityGraph).length) return [null, null];
    const aliasIndex = buildAliasIndex(entityGraph);
    const lookupType = normalizeEntityKey(key);
    const canonicalType = aliasIndex[lookupType];
    if (canonicalType === undefined) return [null, null];
    for (const [bk, bkEntry] of Object.entries(bindings)) {
      const bkType = normalizeEntityKey(bk);
      const bkCanonical = aliasIndex[bkType];
      if (bkCanonical === canonicalType) return [bk, asObject(bkEntry)];
    }
  } else {
    const sysDeps = asObject(context.systemDependencies);
    if (!Object.keys(sysDeps).length) return [null, null];
    for (const depKey of Object.keys(sysDeps)) {
      if (depKey === key && depKey in bindings) return [depKey, asObject(bindings[depKey])];
    }
    for (const depKey of Object.keys(sysDeps)) {
      if ((key.startsWith(depKey) || key.endsWith(depKey)) && depKey in bindings) {
        return [depKey, asObject(bindings[depKey])];
      }
    }
  }
  return [null, null];
}

function computeNearMiss(key: string, bindings: JsonObject, context: JsonObject, entryType: string): string[] {
  if (!Object.keys(bindings).length) return [];
  const candidates: string[] = [];
  if (entryType === "entity") {
    const entityGraph = asObject(context.entityGraph);
    if (!Object.keys(entityGraph).length) return [];
    const aliasIndex = buildAliasIndex(entityGraph);
    const lookupType = normalizeEntityKey(key);
    const lookupCanonical = aliasIndex[lookupType];
    if (!lookupCanonical || !(lookupCanonical in entityGraph)) return [];
    const relatedTypes = new Set<string>([lookupCanonical]);
    const node = entityGraph[lookupCanonical];
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const u of Array.isArray((node as JsonObject).upstream) ? ((node as JsonObject).upstream as Json[]) : []) {
        relatedTypes.add(String(u));
      }
      for (const d of Array.isArray((node as JsonObject).downstream) ? ((node as JsonObject).downstream as Json[]) : []) {
        relatedTypes.add(String(d));
      }
    }
    for (const bk of Object.keys(bindings)) {
      const bkType = normalizeEntityKey(bk);
      const bkCanonical = aliasIndex[bkType];
      if (bkCanonical !== undefined && relatedTypes.has(bkCanonical) && bk !== key) {
        candidates.push(bk);
        if (candidates.length >= 3) break;
      }
    }
  } else {
    const sysDeps = asObject(context.systemDependencies);
    if (Object.keys(sysDeps).length) {
      for (const [depKey, depMeta] of Object.entries(sysDeps)) {
        const depAliases =
          depMeta && typeof depMeta === "object" && !Array.isArray(depMeta)
            ? Array.isArray((depMeta as JsonObject).aliases)
              ? ((depMeta as JsonObject).aliases as Json[])
              : []
            : [];
        const allNames = [depKey, ...depAliases.map(String)];
        if (allNames.some((n) => n.length >= 2 && (key.includes(n) || n.includes(key)))) {
          for (const bk of Object.keys(bindings)) {
            if (bk !== key) {
              candidates.push(bk);
              if (candidates.length >= 3) break;
            }
          }
        }
        if (candidates.length >= 3) break;
      }
    }
  }
  return candidates;
}

export function lookupEntity(key: string, cache: JsonObject, context: JsonObject): JsonObject {
  const bindings = asObject(cache.entityBindings);
  const [canonical, entry] = findEntry(key, bindings, context, "entity");
  if (canonical !== null) return makeLookupResult(canonical, entry);
  return { hit: false, nearMissCandidates: computeNearMiss(key, bindings, context, "entity") };
}

export function lookupAction(key: string, cache: JsonObject, context: JsonObject): JsonObject {
  const bindings = asObject(cache.actionBindings);
  const [canonical, entry] = findEntry(key, bindings, context, "action");
  if (canonical !== null) return makeLookupResult(canonical, entry);
  return { hit: false, nearMissCandidates: computeNearMiss(key, bindings, context, "action") };
}

export function writeEntry(
  cache: JsonObject,
  entryType: string,
  key: string,
  toolBinding: JsonObject,
  status = "candidate",
): JsonObject {
  const section = entryType === "entity" ? "entityBindings" : "actionBindings";
  if (!cache[section] || typeof cache[section] !== "object" || Array.isArray(cache[section])) {
    cache[section] = {};
  }
  const bindings = cache[section] as JsonObject;

  const existing = bindings[key] && typeof bindings[key] === "object" && !Array.isArray(bindings[key])
    ? (bindings[key] as JsonObject)
    : null;
  if (existing && normalizeStatus(existing) === "proven") {
    return { written: false, key, reason: "proven entry exists, skip candidate write" };
  }

  const resourceId = toolBinding.resourceId;
  if (resourceId) {
    for (const [existingKey, existingEntryRaw] of Object.entries(bindings)) {
      if (existingKey === key) continue;
      const existingEntry = asObject(existingEntryRaw);
      const existingRid = asObject(existingEntry.toolBinding).resourceId;
      if (existingRid === resourceId) {
        const aliases = Array.isArray(existingEntry.aliases) ? (existingEntry.aliases as Json[]) : [];
        existingEntry.aliases = aliases;
        if (!aliases.includes(key) && key !== existingKey) aliases.push(key);
        return { written: true, key: existingKey, merged: true, alias: key };
      }
    }
  }

  const now = utcNowZ();
  const normalizedStatus = status === "available" || status === "candidate" ? "candidate" : status;
  bindings[key] = {
    aliases: [],
    toolBinding,
    status: normalizedStatus,
    confidence: null,
    cachedAt: now,
    provenAt: null,
    provenInvocation: null,
  };
  return { written: true, key, merged: false };
}

const VERIFIED_BY_PRIORITY: Record<string, number> = { user: 3, verify: 2, invoke: 1, recovery: 1 };

function shouldOverride(existing: JsonObject, newConfidence: number, newInvocation: JsonObject): boolean {
  if (normalizeStatus(existing) !== "proven") return true;
  const oldConf = (existing.confidence as number) || 0;
  const oldVerified = String(asObject(existing.provenInvocation).verifiedBy ?? "invoke");
  const newVerified = String(newInvocation.verifiedBy ?? "invoke");
  const oldPriority = VERIFIED_BY_PRIORITY[oldVerified] ?? 0;
  const newPriority = VERIFIED_BY_PRIORITY[newVerified] ?? 0;
  if (newPriority > oldPriority) return true;
  if (newPriority === oldPriority) return newConfidence > oldConf;
  return false;
}

export function promoteEntry(
  cache: JsonObject,
  entryType: string,
  key: string,
  confidence: number,
  invocation: JsonObject,
): JsonObject {
  const section = entryType === "entity" ? "entityBindings" : "actionBindings";
  if (!cache[section] || typeof cache[section] !== "object" || Array.isArray(cache[section])) {
    cache[section] = {};
  }
  const bindings = cache[section] as JsonObject;

  if (confidence < PROVEN_CONFIDENCE_THRESHOLD) {
    return {
      promoted: false,
      key,
      reason: `confidence ${confidence} below threshold ${PROVEN_CONFIDENCE_THRESHOLD}`,
    };
  }

  const now = utcNowZ();
  const existing = bindings[key] && typeof bindings[key] === "object" && !Array.isArray(bindings[key])
    ? (bindings[key] as JsonObject)
    : null;
  if (existing) {
    if (!shouldOverride(existing, confidence, invocation)) {
      return {
        promoted: false,
        key,
        reason:
          `existing proven not overridable (conf=${existing.confidence}, ` +
          `verifiedBy=${asObject(existing.provenInvocation).verifiedBy ?? "invoke"})`,
      };
    }
    existing.status = "proven";
    existing.confidence = confidence;
    existing.provenAt = now;
    existing.provenInvocation = invocation;
    return { promoted: true, key, upgraded: true };
  }

  for (const [canonical, entryRaw] of Object.entries(bindings)) {
    const entry = asObject(entryRaw);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    if (aliases.includes(key)) {
      if (!shouldOverride(entry, confidence, invocation)) {
        return {
          promoted: false,
          key: canonical,
          reason: `existing proven not overridable (conf=${entry.confidence})`,
        };
      }
      entry.status = "proven";
      entry.confidence = confidence;
      entry.provenAt = now;
      entry.provenInvocation = invocation;
      return { promoted: true, key: canonical, upgraded: true, originalKey: key };
    }
  }

  const tb = invocation.toolBinding;
  if (!tb || typeof tb !== "object" || Array.isArray(tb)) {
    return { promoted: false, key, reason: "invocation missing toolBinding, cannot create new entry" };
  }
  const writeResult = writeEntry(cache, entryType, key, tb as JsonObject, "candidate");
  const actualKey = String(writeResult.key ?? key);
  const target = bindings[actualKey] && typeof bindings[actualKey] === "object" && !Array.isArray(bindings[actualKey])
    ? (bindings[actualKey] as JsonObject)
    : null;
  if (target) {
    if (!shouldOverride(target, confidence, invocation)) {
      return {
        promoted: false,
        key: actualKey,
        reason: `existing proven not overridable (conf=${target.confidence})`,
      };
    }
    target.status = "proven";
    target.confidence = confidence;
    target.provenAt = now;
    target.provenInvocation = invocation;
  }
  return {
    promoted: true,
    key: actualKey,
    upgraded: false,
    newEntry: !writeResult.merged,
    mergedViaWrite: Boolean(writeResult.merged),
  };
}

export function invalidateEntry(cache: JsonObject, key: string): JsonObject {
  let removed = false;
  let removedStatus: string | null = null;
  let removedFromSection: string | null = null;

  for (const section of ["entityBindings", "actionBindings"]) {
    const bindings = asObject(cache[section]);
    cache[section] = bindings;
    if (key in bindings) {
      removedStatus = normalizeStatus(asObject(bindings[key]));
      delete bindings[key];
      removed = true;
      removedFromSection = section;
      break;
    }
  }

  if (removed && removedFromSection) {
    const bindings = asObject(cache[removedFromSection]);
    for (const entryRaw of Object.values(bindings)) {
      const entry = asObject(entryRaw);
      const aliases = Array.isArray(entry.aliases) ? (entry.aliases as Json[]) : [];
      if (aliases.includes(key)) {
        entry.aliases = aliases.filter((a) => a !== key);
      }
    }
  }

  if (!removed) {
    for (const section of ["entityBindings", "actionBindings"]) {
      const bindings = asObject(cache[section]);
      cache[section] = bindings;
      for (const entryRaw of Object.values(bindings)) {
        const entry = asObject(entryRaw);
        const aliases = Array.isArray(entry.aliases) ? (entry.aliases as Json[]) : [];
        if (aliases.includes(key)) {
          entry.aliases = aliases.filter((a) => a !== key);
          removed = true;
        }
      }
    }
  }

  const result: JsonObject = { invalidated: removed, key };
  if (removed && removedStatus === "proven") {
    result.warning = "invalidated a proven entry";
    process.stderr.write(`${JSON.stringify({ warning: `invalidated proven entry: ${key}` })}\n`);
  }
  return result;
}

export async function experienceFetch(
  cachePath: string,
  queries: JsonObject[],
  domain: string | null = null,
  topK = 3,
  minSimilarity = 0.7,
): Promise<JsonObject> {
  if (!queries.length) return { ok: true, results: [], error: null };
  let resp: JsonObject;
  try {
    resp = await batchFetch(queries, domain, topK, minSimilarity);
  } catch (exc) {
    process.stderr.write(`${JSON.stringify({ warning: `experience store fetch failed: ${exc}` })}\n`);
    return { ok: false, error: String(exc), results: [] };
  }
  if (!resp.ok) return { ok: false, error: (resp.error as Json) ?? "unknown", results: [] };

  const queryTypeMap: Record<string, string> = {};
  for (const q of queries) queryTypeMap[String(q.key ?? "")] = String(q.type ?? "entity");

  const cache = loadCache(cachePath);
  const backfillResults: JsonObject[] = [];
  let dirty = false;
  const data = asObject(resp.data);
  for (const qr of Array.isArray(data.results) ? (data.results as JsonObject[]) : []) {
    const queryKey = String(qr.query_key ?? "");
    const matches = Array.isArray(qr.matches) ? (qr.matches as JsonObject[]) : [];
    if (!matches.length) {
      backfillResults.push({ query_key: queryKey, hit: false });
      continue;
    }
    const best = matches[0];
    const entryType = queryTypeMap[queryKey] || "entity";
    const bindings = (entryType === "entity" ? cache.entityBindings : cache.actionBindings) as JsonObject;
    const existing = bindings[queryKey] && typeof bindings[queryKey] === "object" && !Array.isArray(bindings[queryKey])
      ? (bindings[queryKey] as JsonObject)
      : null;
    if (existing && normalizeStatus(existing) === "proven") {
      const existingRid = asObject(existing.toolBinding).resourceId;
      const remoteRid = asObject(best.tool_binding).resourceId;
      if (existingRid === remoteRid) {
        backfillResults.push({
          query_key: queryKey,
          hit: true,
          source: "l1_proven",
          experience_id: (best.experience_id as Json) ?? null,
        });
        continue;
      }
    }
    const toolBinding = best.tool_binding;
    if (!toolBinding || typeof toolBinding !== "object" || Array.isArray(toolBinding)) {
      backfillResults.push({ query_key: queryKey, hit: false });
      continue;
    }
    const writeResult = writeEntry(cache, entryType, queryKey, toolBinding as JsonObject, "candidate");
    const actualKey = String(writeResult.key);
    dirty = true;
    if (best.proven_invocation && Number(best.confidence ?? 0) >= PROVEN_CONFIDENCE_THRESHOLD) {
      promoteEntry(cache, entryType, actualKey, Number(best.confidence), asObject(best.proven_invocation));
    }
    backfillResults.push({
      query_key: queryKey,
      hit: true,
      source: "experience",
      experience_id: (best.experience_id as Json) ?? null,
      match_type: (best.match_type as Json) ?? null,
      similarity: (best.similarity as Json) ?? null,
      quality_score: (best.quality_score as Json) ?? null,
      backfilled_key: actualKey,
    });
  }
  if (dirty) saveCache(cachePath, cache);
  return { ok: true, results: backfillResults, error: null };
}

export async function experienceReport(
  cachePath: string,
  entryType: string,
  key: string,
  contributor: string,
): Promise<JsonObject> {
  const cache = loadCache(cachePath);
  const bindings = (entryType === "entity" ? cache.entityBindings : cache.actionBindings) as JsonObject;
  const entry = bindings[key] && typeof bindings[key] === "object" && !Array.isArray(bindings[key])
    ? (bindings[key] as JsonObject)
    : null;
  if (!entry || normalizeStatus(entry) !== "proven") {
    return { ok: false, error: `no L1 proven entry: ${key}` };
  }
  try {
    return await report({
      registry_key: key,
      entry_type: entryType,
      tool_binding: (entry.toolBinding as Json) ?? {},
      proven_invocation: (entry.provenInvocation as Json) ?? {},
      confidence: (entry.confidence as Json) ?? 0.6,
      contributor,
      aliases: (entry.aliases as Json) ?? [],
    });
  } catch (exc) {
    process.stderr.write(`${JSON.stringify({ warning: `experience store report failed: ${exc}` })}\n`);
    return { ok: false, error: String(exc) };
  }
}

export async function experienceFeedback(
  experienceId: string,
  outcome: string,
  contributor: string,
  failReason: string | null = null,
): Promise<JsonObject> {
  try {
    return await feedback({
      experience_id: experienceId,
      outcome,
      contributor,
      fail_reason: failReason,
    });
  } catch (exc) {
    process.stderr.write(`${JSON.stringify({ warning: `experience store feedback failed: ${exc}` })}\n`);
    return { ok: false, error: String(exc) };
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function cmdTest(): number {
  process.stdout.write("=== cache_tool_binding v2 self-test ===\n");
  const cache: JsonObject = { version: "2.0", entityBindings: {}, actionBindings: {} };
  const context: JsonObject = {
    entityGraph: {
      product: {
        fields: ["productId"],
        states: [],
        upstream: ["catalog"],
        downstream: [],
        aliases: ["catalog-product", "product-variant", "test-product"],
      },
    },
    systemDependencies: {
      "tag-refresh": { type: "offline-task", service: "catalog-tag", interface: "/refresh" },
    },
  };

  let r = writeEntry(cache, "entity", "product::create", { toolType: "skill", resourceId: "uuid-001" });
  assert(r.written && !r.merged, `expected new entry, got ${JSON.stringify(r)}`);

  r = writeEntry(cache, "entity", "product-variant::create", { toolType: "skill", resourceId: "uuid-001" });
  assert(r.merged && r.alias === "product-variant::create", `expected merge, got ${JSON.stringify(r)}`);

  r = lookupEntity("product::create", cache, context);
  assert(r.hit && r.status === "candidate", `expected candidate hit: ${JSON.stringify(r)}`);
  assert(r.provenInvocation == null, `candidate should have no invocation: ${JSON.stringify(r)}`);

  r = lookupEntity("product-variant::create", cache, context);
  assert(r.hit && r.key === "product::create", `alias hit failed: ${JSON.stringify(r)}`);

  r = lookupEntity("test-product::create", cache, context);
  assert(r.hit && r.key === "product::create", `entityGraph alias hit failed: ${JSON.stringify(r)}`);

  writeEntry(cache, "entity", "product::create", { toolType: "tool", resourceId: "uuid-002" });
  r = lookupEntity("product-detail::create", cache, context);
  assert(!r.hit, `product-detail should not match product without aliases declaration: ${JSON.stringify(r)}`);

  const invocation: JsonObject = {
    invokeCmdTemplate: "node product_builder.ts --city-id ${cityId}",
    paramMapping: [{ param: "cityId", source: "dependency" }],
    outputFields: ["productId"],
    successSignal: "exit_code=0",
    provenExample: { args: { cityId: "1" }, outputSnapshot: { productId: "88001" } },
  };
  r = promoteEntry(cache, "entity", "product::create", 0.85, invocation);
  assert(r.promoted, `promote failed: ${JSON.stringify(r)}`);

  r = lookupEntity("product::create", cache, context);
  assert(r.hit && r.status === "proven", `expected proven hit: ${JSON.stringify(r)}`);
  assert(
    asObject(r.provenInvocation).outputFields &&
      JSON.stringify(asObject(r.provenInvocation).outputFields) === JSON.stringify(["productId"]),
    `invocation mismatch: ${JSON.stringify(r)}`,
  );

  r = writeEntry(cache, "entity", "product::create", { toolType: "tool", resourceId: "uuid-999" });
  assert(!r.written, `candidate should not overwrite proven: ${JSON.stringify(r)}`);

  r = promoteEntry(cache, "entity", "product::create", 0.7, { dummy: true });
  assert(!r.promoted, `lower confidence should not overwrite: ${JSON.stringify(r)}`);

  const betterInvocation = { ...invocation, successSignal: "exit_code=0 AND productId>0" };
  r = promoteEntry(cache, "entity", "product::create", 0.95, betterInvocation);
  assert(r.promoted, `higher confidence should overwrite: ${JSON.stringify(r)}`);

  r = promoteEntry(cache, "entity", "new-entity::create", 0.3, invocation);
  assert(!r.promoted, `below threshold should reject: ${JSON.stringify(r)}`);

  r = promoteEntry(cache, "entity", "ghost-entity::create", 0.85, { dummy: true });
  assert(!r.promoted, `missing toolBinding should reject: ${JSON.stringify(r)}`);

  r = promoteEntry(cache, "entity", "ghost-entity::create", 0.85, {
    ...invocation,
    toolBinding: { toolType: "skill", resourceId: "uuid-ghost" },
  });
  assert(r.promoted && r.newEntry, `new entry with toolBinding should succeed: ${JSON.stringify(r)}`);

  writeEntry(cache, "action", "tag-refresh", {
    toolType: "tool",
    resourceId: "uuid-010",
    cmdTemplate: "...",
  });
  r = lookupAction("tag-refresh", cache, context);
  assert(r.hit && r.key === "tag-refresh", `action exact match failed: ${JSON.stringify(r)}`);

  r = lookupAction("trigger-tag-refresh", cache, context);
  assert(r.hit && r.key === "tag-refresh", `action sysDeps suffix match failed: ${JSON.stringify(r)}`);

  r = lookupEntity("supplier::create", cache, {});
  assert(!r.hit, `should miss: ${JSON.stringify(r)}`);
  assert("nearMissCandidates" in r, `miss should have nearMissCandidates: ${JSON.stringify(r)}`);

  r = invalidateEntry(cache, "product::create");
  assert(r.invalidated && r.warning, `invalidate proven should warn: ${JSON.stringify(r)}`);
  r = lookupEntity("product::create", cache, {});
  assert(!r.hit, `should be gone after invalidate: ${JSON.stringify(r)}`);

  asObject(cache.entityBindings)["legacy-entry"] = {
    aliases: [],
    toolBinding: { toolType: "tool" },
    toolStatus: "available",
    cachedAt: "2026-01-01T00:00:00Z",
  };
  r = lookupEntity("legacy-entry", cache, {});
  assert(r.hit && r.status === "candidate", `v1 compat failed: ${JSON.stringify(r)}`);

  process.stdout.write("All tests passed.\n");
  return 0;
}

function requireFlag(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (v === undefined || v === null || v === "") {
    process.stderr.write(`ERROR: --${name} is required\n`);
    process.exit(2);
  }
  return String(v);
}

function usage(): void {
  process.stderr.write(
    "usage: cache_tool_binding.ts {lookup,write,promote,invalidate,test,experience-fetch,experience-report,experience-feedback} ...\n",
  );
}

function printHelp(command?: string): void {
  const commands: Record<string, string> = {
    lookup: `Usage: node cache_tool_binding.ts lookup --cache <path> --type entity|action --key <key> [--context <path>]

Look up a cached tool binding.

Options:
  --cache <path>      tool-binding-cache.json (required)
  --type <type>       entity | action (required)
  --key <key>         Cache key, e.g. product::create (required)
  --context <path>    Optional business-context.json
  -h, --help          Show this help and exit

Example:
  node cache_tool_binding.ts lookup --cache ./testdata/case-materials/tool-binding-cache.json --type entity --key "product::create"
`,
    write: `Usage: node cache_tool_binding.ts write --cache <path> --type entity|action --key <key> --binding <json> [--status candidate]

Write a candidate/proven cache entry.

Options:
  --cache <path>      tool-binding-cache.json (required)
  --type <type>       entity | action (required)
  --key <key>         Cache key (required)
  --binding <json>    toolBinding JSON (required)
  --status <status>   candidate | proven (default: candidate)
  -h, --help          Show this help and exit

Example:
  node cache_tool_binding.ts write --cache ./testdata/case-materials/tool-binding-cache.json --type entity --key "product::create" --binding '{"toolType":"tool","resourceId":"create-product"}'
`,
    promote: `Usage: node cache_tool_binding.ts promote --cache <path> --type entity|action --key <key> --confidence <n> --invocation <json>

Promote a candidate entry to proven.

Options:
  --cache <path>         tool-binding-cache.json (required)
  --type <type>          entity | action (required)
  --key <key>            Cache key (required)
  --confidence <n>       Confidence score (required)
  --invocation <json>    provenInvocation JSON (required)
  -h, --help             Show this help and exit
`,
    invalidate: `Usage: node cache_tool_binding.ts invalidate --cache <path> --key <key>

Invalidate one cache key.

Options:
  --cache <path>   tool-binding-cache.json (required)
  --key <key>      Cache key (required)
  -h, --help       Show this help and exit
`,
    test: `Usage: node cache_tool_binding.ts test

Run the built-in cache self-test.

Options:
  -h, --help   Show this help and exit
`,
    "experience-fetch": `Usage: node cache_tool_binding.ts experience-fetch --cache <path> --queries <json> [options]

Prefetch proven methods into the L1 cache.

Options:
  --cache <path>           tool-binding-cache.json (required)
  --queries <json>         JSON array of {key, type, query_text} (required)
  --domain <domain>        Optional domain filter
  --top-k <n>              Max matches per query (default: 3)
  --min-similarity <n>     Minimum similarity (default: 0.70)
  -h, --help               Show this help and exit

Example:
  node cache_tool_binding.ts experience-fetch --cache ./testdata/case-materials/tool-binding-cache.json --queries '[{"key":"product::create","type":"entity","query_text":"create a catalog product"}]'
`,
    "experience-report": `Usage: node cache_tool_binding.ts experience-report --cache <path> --type entity|action --key <key> --contributor <name>

Report a successful construct from a cache entry.

Options:
  --cache <path>        tool-binding-cache.json (required)
  --type <type>         entity | action (required)
  --key <key>           Cache key (required)
  --contributor <name>  Contributor id (required)
  -h, --help            Show this help and exit
`,
    "experience-feedback": `Usage: node cache_tool_binding.ts experience-feedback --experience-id <id> --outcome success|failure --contributor <name> [--fail-reason <text>]

Send outcome feedback for a prior experience_id.

Options:
  --experience-id <id>   Experience id (required)
  --outcome <outcome>    success | failure (required)
  --contributor <name>   Contributor id (required)
  --fail-reason <text>   Optional failure reason
  -h, --help             Show this help and exit
`,
  };
  if (command && commands[command]) {
    process.stdout.write(commands[command]);
    return;
  }
  process.stdout.write(`Usage: node cache_tool_binding.ts <command> [options]

Local tool-binding cache + experience-store bridge.

Commands:
  lookup                 Look up a cached binding
  write                  Write a candidate/proven entry
  promote                Promote a candidate to proven
  invalidate             Drop one cache key
  test                   Run the built-in self-test
  experience-fetch       Prefetch proven methods into L1
  experience-report      Report a successful construct
  experience-feedback    Send outcome feedback

Global options:
  -h, --help    Show this help and exit

Examples:
  node cache_tool_binding.ts lookup --cache ./testdata/case-materials/tool-binding-cache.json --type entity --key "product::create"
  node cache_tool_binding.ts experience-fetch --cache ./testdata/case-materials/tool-binding-cache.json --queries '[{"key":"product::create","type":"entity","query_text":"create a catalog product"}]'

Run \`node cache_tool_binding.ts <command> --help\` for command-specific flags.
`);
}

function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (wantsHelp(argv) && (!command || command === "--help" || command === "-h")) {
    printHelp();
    return 0;
  }
  if (!command || command.startsWith("-")) {
    usage();
    return 1;
  }
  if (wantsHelp(argv)) {
    printHelp(command);
    return 0;
  }
  const rest = argv.slice(1);

  if (command === "test") {
    return cmdTest();
  }

  if (command === "lookup") {
    const { values } = parseArgs({
      args: rest,
      options: {
        cache: { type: "string" },
        type: { type: "string" },
        key: { type: "string" },
        context: { type: "string" },
      },
    });
    const cachePath = requireFlag(values, "cache");
    const typ = requireFlag(values, "type");
    const key = requireFlag(values, "key");
    if (typ !== "entity" && typ !== "action") {
      process.stderr.write("ERROR: --type must be entity or action\n");
      return 2;
    }
    const result = await withFileLock(cachePath, () => {
      const cache = loadCache(cachePath);
      const context = values.context ? loadContext(values.context) : {};
      return typ === "entity" ? lookupEntity(key, cache, context) : lookupAction(key, cache, context);
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (command === "write") {
    const { values } = parseArgs({
      args: rest,
      options: {
        cache: { type: "string" },
        type: { type: "string" },
        key: { type: "string" },
        binding: { type: "string" },
        status: { type: "string", default: "candidate" },
      },
    });
    const cachePath = requireFlag(values, "cache");
    const typ = requireFlag(values, "type");
    const key = requireFlag(values, "key");
    const bindingRaw = requireFlag(values, "binding");
    if (typ !== "entity" && typ !== "action") {
      process.stderr.write("ERROR: --type must be entity or action\n");
      return 2;
    }
    let toolBinding: JsonObject;
    try {
      toolBinding = JSON.parse(bindingRaw) as JsonObject;
    } catch {
      process.stderr.write(`${JSON.stringify({ error: "invalid --binding JSON" })}\n`);
      return 1;
    }
    const result = await withFileLock(cachePath, () => {
      const cache = loadCache(cachePath);
      const out = writeEntry(cache, typ, key, toolBinding, values.status || "candidate");
      saveCache(cachePath, cache);
      return out;
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (command === "promote") {
    const { values } = parseArgs({
      args: rest,
      options: {
        cache: { type: "string" },
        type: { type: "string" },
        key: { type: "string" },
        confidence: { type: "string" },
        invocation: { type: "string" },
      },
    });
    const cachePath = requireFlag(values, "cache");
    const typ = requireFlag(values, "type");
    const key = requireFlag(values, "key");
    const confidenceRaw = requireFlag(values, "confidence");
    const invocationRaw = requireFlag(values, "invocation");
    if (typ !== "entity" && typ !== "action") {
      process.stderr.write("ERROR: --type must be entity or action\n");
      return 2;
    }
    const confidence = Number(confidenceRaw);
    let invocation: JsonObject;
    try {
      invocation = JSON.parse(invocationRaw) as JsonObject;
    } catch {
      process.stderr.write(`${JSON.stringify({ error: "invalid --invocation JSON" })}\n`);
      return 1;
    }
    const result = await withFileLock(cachePath, () => {
      const cache = loadCache(cachePath);
      const out = promoteEntry(cache, typ, key, confidence, invocation);
      if (out.promoted) saveCache(cachePath, cache);
      return out;
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (command === "invalidate") {
    const { values } = parseArgs({
      args: rest,
      options: {
        cache: { type: "string" },
        key: { type: "string" },
      },
    });
    const cachePath = requireFlag(values, "cache");
    const key = requireFlag(values, "key");
    const result = await withFileLock(cachePath, () => {
      const cache = loadCache(cachePath);
      const out = invalidateEntry(cache, key);
      if (out.invalidated) saveCache(cachePath, cache);
      return out;
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (command === "experience-fetch") {
    const { values } = parseArgs({
      args: rest,
      options: {
        cache: { type: "string" },
        queries: { type: "string" },
        domain: { type: "string" },
        "top-k": { type: "string", default: "3" },
        "min-similarity": { type: "string", default: "0.70" },
      },
    });
    const cachePath = requireFlag(values, "cache");
    const queriesRaw = requireFlag(values, "queries");
    let queries: JsonObject[];
    try {
      queries = JSON.parse(queriesRaw) as JsonObject[];
    } catch {
      process.stderr.write(`${JSON.stringify({ error: "invalid --queries JSON" })}\n`);
      return 1;
    }
    const result = await withFileLock(cachePath, () =>
      experienceFetch(
        cachePath,
        queries,
        values.domain ?? null,
        Number(values["top-k"] || 3),
        Number(values["min-similarity"] || 0.7),
      ),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }

  if (command === "experience-report") {
    const { values } = parseArgs({
      args: rest,
      options: {
        cache: { type: "string" },
        type: { type: "string" },
        key: { type: "string" },
        contributor: { type: "string" },
      },
    });
    const cachePath = requireFlag(values, "cache");
    const typ = requireFlag(values, "type");
    const key = requireFlag(values, "key");
    const contributor = requireFlag(values, "contributor");
    if (typ !== "entity" && typ !== "action") {
      process.stderr.write("ERROR: --type must be entity or action\n");
      return 2;
    }
    const result = await experienceReport(cachePath, typ, key, contributor);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }

  if (command === "experience-feedback") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "experience-id": { type: "string" },
        outcome: { type: "string" },
        contributor: { type: "string" },
        "fail-reason": { type: "string" },
      },
    });
    const experienceId = requireFlag(values, "experience-id");
    const outcome = requireFlag(values, "outcome");
    const contributor = requireFlag(values, "contributor");
    if (outcome !== "success" && outcome !== "failure") {
      process.stderr.write("ERROR: --outcome must be success or failure\n");
      return 2;
    }
    const result = await experienceFeedback(experienceId, outcome, contributor, values["fail-reason"] ?? null);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }

  usage();
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cache_tool_binding.ts")) {
  process.exit(await main());
}
