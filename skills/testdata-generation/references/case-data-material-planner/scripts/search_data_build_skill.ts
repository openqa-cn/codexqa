#!/usr/bin/env node
/** Planner-facing wrapper around the parent skill marketplace search. */

import { parseArgs } from "node:util";
import { runSearch } from "../../../scripts/search_data_build.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

export async function searchSkills(keywords: string[] | null = null, limit = 20): Promise<JsonObject[]> {
  const result = await runSearch({ keywords, limit, useFavorites: false });
  return (Array.isArray(result.skill_matches) ? result.skill_matches : []) as JsonObject[];
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
      json: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node search_data_build_skill.ts [options]

Planner-facing wrapper around the parent skill marketplace search.

Options:
  --keywords <noun>      Domain nouns (repeatable)
  --query <sentence>     Natural-language query for proven-method search
  --registry-key <key>   Semantic key, e.g. catalog-order::create
  --entry-type <type>    entity | action (default: entity)
  --domain <domain>      Optional domain filter
  --json                 Print full search JSON
  -h, --help             Show this help and exit

Example:
  node search_data_build_skill.ts --keywords catalog --json
`);
    return 0;
  }
  const result = await runSearch({
    keywords: values.keywords,
    queryText: values.query,
    registryKey: values["registry-key"],
    entryType: values["entry-type"],
    domain: values.domain,
  });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const item of (Array.isArray(result.skill_matches) ? result.skill_matches : []) as JsonObject[]) {
      process.stdout.write(`${item.name}: ${item.skillPath}\n`);
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("search_data_build_skill.ts")) {
  process.exit(await main());
}
