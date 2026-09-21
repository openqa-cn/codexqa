#!/usr/bin/env node
/** Parallel multi-angle tool + skill search via adapters. */

import { parseArgs } from "node:util";
import { buildRuntime } from "../../../scripts/adapters/index.ts";
import type { Json, JsonObject } from "../../../scripts/adapters/config.ts";
import { runSearch } from "../../../scripts/search_data_build.ts";
import { loadFavorites, toPinnedMatch } from "../../../scripts/favorites.ts";

const SEARCH_TIMEOUT = 30_000;

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function searchTools(query: string): Promise<JsonObject> {
  const runtime = buildRuntime();
  try {
    const items = (await runtime.tool_registry.query(query)) || [];
    return { query, ok: true, results: items };
  } catch (exc) {
    return { query, ok: false, error: String(exc), results: [] };
  }
}

export async function searchSkills(keywords: string[]): Promise<JsonObject> {
  try {
    const parsed = (await runSearch({
      keywords: keywords.length ? keywords : null,
      queryText: null,
      registryKey: null,
      entryType: "entity",
      domain: null,
      limit: 20,
      useFavorites: false,
    })) || {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        ok: true,
        skills: (parsed as JsonObject).skill_matches || [],
        proven: (parsed as JsonObject).proven_matches || [],
      };
    }
    if (Array.isArray(parsed)) return { ok: true, skills: parsed, proven: [] };
    return { ok: true, skills: [], proven: [] };
  } catch (exc) {
    return { ok: false, error: String(exc), skills: [], proven: [] };
  }
}

export function loadPinned(): JsonObject[] {
  try {
    return loadFavorites().map((f) => toPinnedMatch(f));
  } catch (exc) {
    process.stderr.write(`warning: favorites load failed: ${exc}\n`);
    return [];
  }
}

export function dedupeToolResults(perQuery: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  const merged: JsonObject[] = [];
  for (const row of perQuery) {
    for (const item of asObjects(row.results)) {
      const rid = String(item.resourceId || item.id || item.name || "");
      if (rid && seen.has(rid)) continue;
      if (rid) seen.add(rid);
      merged.push(item);
    }
  }
  return merged;
}

function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export async function runParallelSearch(queries: string[], keywords: string[]): Promise<JsonObject> {
  const toolPromises = queries.map((q) =>
    withTimeout(searchTools(q), SEARCH_TIMEOUT).catch((exc) => ({
      query: q,
      ok: false,
      error: String(exc),
      results: [] as Json[],
    })),
  );
  const skillPromise = keywords.length
    ? withTimeout(searchSkills(keywords), SEARCH_TIMEOUT).catch((exc) => ({
        ok: false,
        error: String(exc),
        skills: [] as Json[],
        proven: [] as Json[],
      }))
    : Promise.resolve({ ok: true, skills: [] as Json[], proven: [] as Json[] });
  const pinnedPromise = withTimeout(Promise.resolve().then(() => loadPinned()), SEARCH_TIMEOUT).catch((exc) => {
    process.stderr.write(`warning: favorites load failed: ${exc}\n`);
    return [] as JsonObject[];
  });
  const [toolRows, skillResult, pinned] = await Promise.all([
    Promise.all(toolPromises),
    skillPromise,
    pinnedPromise,
  ]);
  if (pinned.length) {
    const pinnedKeys = new Set(
      pinned
        .filter((p) => p.name || p.uuid)
        .map((p) => String(p.name || p.uuid || "").trim().toLowerCase()),
    );
    const skills = asObjects(skillResult.skills).filter(
      (s) =>
        !pinnedKeys.has(String(s.name || "").trim().toLowerCase()) &&
        !pinnedKeys.has(String(s.uuid || s.id || "").trim().toLowerCase()),
    );
    skillResult.skills = skills;
  }
  return {
    pinned,
    tools: {
      queries,
      results: dedupeToolResults(toolRows),
      perQuery: toolRows,
    },
    skill: skillResult,
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      queries: { type: "string", default: "[]" },
      keywords: { type: "string", default: "[]" },
      json: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node parallel_search.ts [options]

Run skill-keyword search and multi-angle tool search in parallel.

Options:
  --queries <json>    JSON array of tool-search sentences (default: [])
  --keywords <json>   JSON array of skill-name nouns (default: [])
  --json              Print JSON instead of a human listing
  -h, --help          Show this help and exit

Example:
  node parallel_search.ts --queries '["create a catalog test product","customer books a standard product"]' --keywords '["catalog"]' --json
`);
    return 0;
  }

  let queriesRaw: unknown;
  try {
    queriesRaw = JSON.parse(String(values.queries));
  } catch {
    process.stderr.write("ERROR: --queries must be valid JSON array\n");
    return 1;
  }
  let keywordsRaw: unknown;
  try {
    keywordsRaw = JSON.parse(String(values.keywords));
  } catch {
    process.stderr.write("ERROR: --keywords must be valid JSON array\n");
    return 1;
  }

  const queries = toList(queriesRaw).map((q) => String(q));
  const keywords = toList(keywordsRaw).map((k) => String(k));
  const output = await runParallelSearch(queries, keywords);

  if (values.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    const pinned = asObjects(output.pinned);
    if (pinned.length) {
      process.stdout.write(`=== pinned: ${pinned.length} favorite skill(s) ===\n`);
      pinned.forEach((item, i) => {
        process.stdout.write(`  [${i + 1}] ${item.name ?? "?"}  path=${item.skillPath || "-"}\n`);
      });
    }
    const tools = asObject(output.tools);
    const merged = asObjects(tools.results);
    process.stdout.write(`=== tools: ${merged.length} unique results from ${queries.length} queries ===\n`);
    merged.forEach((item, i) => {
      process.stdout.write(`  [${i + 1}] ${item.name || item.id || "?"}\n`);
    });
    const skills = asObjects(asObject(output.skill).skills);
    process.stdout.write(`=== skill: ${skills.length} results from keywords=${JSON.stringify(keywords)} ===\n`);
    skills.forEach((item, i) => {
      process.stdout.write(`  [${i + 1}] ${item.name ?? "?"}  [${item.source ?? "local"}]\n`);
    });
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("parallel_search.ts")) {
  process.exit(await main());
}
