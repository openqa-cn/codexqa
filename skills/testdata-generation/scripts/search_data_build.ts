#!/usr/bin/env node
/** Search data-build skills, proven methods, and pin favorites. */

import { parseArgs } from "node:util";
import { buildRuntime } from "./adapters/index.ts";
import type { JsonObject } from "./adapters/config.ts";
import { loadFavorites, toPinnedMatch, validateFavorites } from "./favorites.ts";

export async function runSearch(opts: {
  keywords?: string[] | null;
  queryText?: string | null;
  registryKey?: string | null;
  entryType?: string;
  domain?: string | null;
  limit?: number;
  useFavorites?: boolean;
  validateFavorites?: boolean;
}): Promise<JsonObject> {
  const {
    keywords = null,
    queryText = null,
    registryKey = null,
    entryType = "entity",
    domain = null,
    limit = 20,
    useFavorites = true,
    validateFavorites: doValidate = false,
  } = opts;
  const runtime = buildRuntime();
  let pinned: JsonObject[] = [];
  if (useFavorites) {
    try {
      const raw = loadFavorites();
      if (doValidate) validateFavorites(raw);
      pinned = raw.map(toPinnedMatch);
    } catch (exc) {
      process.stderr.write(`warning: favorites load failed: ${exc}\n`);
    }
  }

  const skillsPromise = Promise.race([
    runtime.skill_marketplace.search(keywords, limit),
    new Promise<JsonObject[]>((_, reject) => setTimeout(() => reject(new Error("timeout")), 25_000)),
  ]).catch((exc) => {
    process.stderr.write(`warning: skill search failed: ${exc}\n`);
    return [] as JsonObject[];
  });

  const provenPromise = (async () => {
    if (!(queryText || registryKey)) return [] as JsonObject[];
    const resp = await runtime.experience_store.fetch(
      [{ key: registryKey || "", type: entryType, query_text: queryText || registryKey || "" }],
      domain,
      3,
    );
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    const matches: JsonObject[] = [];
    for (const group of (Array.isArray(data.results) ? data.results : []) as JsonObject[]) {
      matches.push(...((Array.isArray(group.matches) ? group.matches : []) as JsonObject[]));
    }
    return matches;
  })();

  const provenTimed = Promise.race([
    provenPromise,
    new Promise<JsonObject[]>((_, reject) => setTimeout(() => reject(new Error("timeout")), 25_000)),
  ]).catch((exc) => {
    process.stderr.write(`warning: experience search failed: ${exc}\n`);
    return [] as JsonObject[];
  });

  const [skillsRaw, proven] = await Promise.all([skillsPromise, provenTimed]);
  let skills = skillsRaw;
  if (pinned.length) {
    const pinnedKeys = new Set(
      pinned
        .filter((p) => p.name || p.uuid)
        .map((p) => String(p.name || p.uuid || "").trim().toLowerCase()),
    );
    skills = skills.filter(
      (s) =>
        !pinnedKeys.has(String(s.name || "").trim().toLowerCase()) &&
        !pinnedKeys.has(String(s.uuid || "").trim().toLowerCase()),
    );
  }
  return {
    pinned_matches: pinned,
    proven_matches: proven,
    skill_matches: skills,
    config_source: runtime.cfg.source,
  };
}

function printHuman(result: JsonObject): void {
  const pinned = (Array.isArray(result.pinned_matches) ? result.pinned_matches : []) as JsonObject[];
  const proven = (Array.isArray(result.proven_matches) ? result.proven_matches : []) as JsonObject[];
  const skills = (Array.isArray(result.skill_matches) ? result.skill_matches : []) as JsonObject[];
  if (pinned.length) {
    process.stdout.write(`\nPinned skills (${pinned.length}):\n\n`);
    pinned.forEach((item, i) => {
      process.stdout.write(`  [${i + 1}] ${item.name}  path=${item.skillPath || "-"}\n`);
      if (item.description) process.stdout.write(`      ${String(item.description).slice(0, 160)}\n`);
    });
  }
  if (proven.length) {
    process.stdout.write(`\nProven methods (${proven.length}):\n\n`);
    proven.forEach((item, i) => {
      process.stdout.write(`  [${i + 1}] ${item.registry_key}  sim=${item.similarity}\n`);
      const binding = (item.tool_binding && typeof item.tool_binding === "object" ? item.tool_binding : {}) as JsonObject;
      process.stdout.write(`      tool=${binding.toolType} id=${binding.resourceId}\n`);
    });
  }
  if (skills.length) {
    process.stdout.write(`\nSkill matches (${skills.length}):\n\n`);
    skills.forEach((item, i) => {
      process.stdout.write(`  [${i + 1}] ${item.name}  [${item.source}]\n`);
      if (item.description) process.stdout.write(`      ${String(item.description).slice(0, 160)}\n`);
      if (item.skillPath) process.stdout.write(`      path: ${item.skillPath}\n`);
    });
  }
  if (!pinned.length && !proven.length && !skills.length) {
    process.stdout.write("No matches. Continue with tool_registry or api_catalog.\n");
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      keywords: { type: "string", multiple: true },
      query: { type: "string" },
      "registry-key": { type: "string" },
      "entry-type": { type: "string", default: "entity" },
      domain: { type: "string" },
      limit: { type: "string", default: "20" },
      json: { type: "boolean", default: false },
      "no-favorites": { type: "boolean", default: false },
      "validate-favorites": { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node search_data_build.ts [options]

Search data-build skills, proven methods, and pinned favorites.

Options:
  --keywords <noun>          Domain nouns (repeatable). Falls back to a full scan if omitted
  --query <sentence>         Natural-language query for proven-method search
  --registry-key <key>       Semantic key, e.g. catalog-order::create
  --entry-type <type>        entity | action (default: entity)
  --domain <domain>          Optional domain filter
  --limit <n>                Max skill matches (default: 20)
  --json                     Print JSON instead of a human listing
  --no-favorites             Skip pinned favorites
  --validate-favorites       Validate pinned skill paths
  -h, --help                 Show this help and exit

Examples:
  node search_data_build.ts --keywords catalog --query "create a catalog product" --registry-key catalog-order::create --entry-type entity --json
  node search_data_build.ts --keywords catalog --no-favorites
`);
    return 0;
  }
  const entryType = values["entry-type"] || "entity";
  if (entryType !== "entity" && entryType !== "action") {
    process.stderr.write("error: --entry-type must be entity or action\n");
    return 2;
  }
  const result = await runSearch({
    keywords: values.keywords,
    queryText: values.query,
    registryKey: values["registry-key"],
    entryType,
    domain: values.domain,
    limit: Number(values.limit || 20),
    useFavorites: !values["no-favorites"],
    validateFavorites: values["validate-favorites"],
  });
  if (values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printHuman(result);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("search_data_build.ts")) {
  process.exit(await main());
}
