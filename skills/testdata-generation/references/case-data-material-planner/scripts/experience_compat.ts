#!/usr/bin/env node
/** Compatibility CLI for the experience_store adapter. */

import { parseArgs } from "node:util";
import { buildRuntime } from "../../../scripts/adapters/index.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

export async function batchFetch(
  queries: JsonObject[],
  domain: string | null = null,
  topK = 3,
  minSimilarity = 0.7,
): Promise<JsonObject> {
  return buildRuntime().experience_store.fetch(queries, domain, topK, minSimilarity);
}

export async function report(body: JsonObject): Promise<JsonObject> {
  return buildRuntime().experience_store.report(body);
}

export async function feedback(opts: {
  experience_id?: string | null;
  outcome?: string | null;
  contributor?: string | null;
  fail_reason?: string | null;
} & JsonObject): Promise<JsonObject> {
  const body: JsonObject = {
    experience_id: opts.experience_id ?? null,
    outcome: opts.outcome ?? null,
    contributor: opts.contributor ?? null,
    fail_reason: opts.fail_reason ?? null,
  };
  return buildRuntime().experience_store.feedback(body);
}

function printHelp(command?: string): void {
  if (command === "fetch") {
    process.stdout.write(`Usage: node experience_compat.ts fetch --queries <json> [options]

Fetch proven methods from the experience store.

Options:
  --queries <json>   JSON array of query objects (required)
  --domain <domain>  Optional domain filter
  --top-k <n>        Max matches per query (default: 3)
  -h, --help         Show this help and exit

Example:
  node experience_compat.ts fetch --queries '[{"key":"product::create","type":"entity","query_text":"create a catalog product"}]'
`);
    return;
  }
  if (command === "report" || command === "feedback") {
    process.stdout.write(`Usage: node experience_compat.ts ${command} --body <json>

${command === "report" ? "Record a successful construct." : "Send success/failure feedback."}

Options:
  --body <json>   JSON payload (required)
  -h, --help      Show this help and exit

Example:
  node experience_compat.ts ${command} --body '{"experience_id":"<id>","outcome":"success"}'
`);
    return;
  }
  process.stdout.write(`Usage: node experience_compat.ts <command> [options]

Compatibility CLI for the experience_store adapter.

Commands:
  fetch       Query proven methods
  report      Record a successful construct
  feedback    Send outcome feedback

Global options:
  -h, --help    Show this help and exit

Examples:
  node experience_compat.ts fetch --queries '[{"key":"product::create","type":"entity","query_text":"create a catalog product"}]'
  node experience_compat.ts report --body '{"resourceId":"catalog","toolType":"skill"}'

Run \`node experience_compat.ts <command> --help\` for command-specific flags.
`);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      queries: { type: "string" },
      domain: { type: "string" },
      "top-k": { type: "string", default: "3" },
      body: { type: "string" },
    },
  });
  const command = positionals[0];
  if (values.help) {
    printHelp(command);
    return 0;
  }
  let result: JsonObject;
  if (command === "fetch") {
    if (!values.queries) {
      process.stderr.write("error: --queries is required\n");
      return 2;
    }
    result = await batchFetch(JSON.parse(String(values.queries)), values.domain, Number(values["top-k"] || 3));
  } else if (command === "report") {
    if (!values.body) {
      process.stderr.write("error: --body is required\n");
      return 2;
    }
    result = await report(JSON.parse(String(values.body)));
  } else if (command === "feedback") {
    if (!values.body) {
      process.stderr.write("error: --body is required\n");
      return 2;
    }
    result = await feedback(JSON.parse(String(values.body)));
  } else {
    process.stderr.write("usage: experience_compat.ts fetch|report|feedback\n");
    return 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("experience_compat.ts")) {
  process.exit(await main());
}
