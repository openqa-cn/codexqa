#!/usr/bin/env node
/** CLI for the experience_store adapter. */

import { parseArgs } from "node:util";
import { buildRuntime } from "./adapters/index.ts";
import type { JsonObject } from "./adapters/config.ts";

function printHelp(command?: string): void {
  if (command === "fetch") {
    process.stdout.write(`Usage: node experience_client.ts fetch --queries <json> [options]

Fetch proven methods from the experience store.

Options:
  --queries <json>   JSON array of {key, type, query_text} (required)
  --domain <domain>  Optional domain filter
  --top-k <n>        Max matches per query (default: 3)
  -h, --help         Show this help and exit

Example:
  node experience_client.ts fetch --queries '[{"key":"catalog-order::create","type":"entity","query_text":"create a catalog order"}]' --domain catalog
`);
    return;
  }
  if (command === "report") {
    process.stdout.write(`Usage: node experience_client.ts report --body <json>

Record a successful construct in the experience store.

Options:
  --body <json>   Report payload (required)
  -h, --help      Show this help and exit

Example:
  node experience_client.ts report --body '{"resourceId":"catalog","toolType":"skill"}'
`);
    return;
  }
  if (command === "feedback") {
    process.stdout.write(`Usage: node experience_client.ts feedback --body <json>

Send success/failure feedback for a prior experience_id.

Options:
  --body <json>   Feedback payload (required)
  -h, --help      Show this help and exit

Example:
  node experience_client.ts feedback --body '{"experience_id":"<id>","outcome":"success"}'
`);
    return;
  }
  process.stdout.write(`Usage: node experience_client.ts <command> [options]

CLI for the experience_store adapter.

Commands:
  fetch       Query proven methods
  report      Record a successful construct
  feedback    Send outcome feedback

Global options:
  -h, --help    Show this help and exit

Examples:
  node experience_client.ts fetch --queries '[{"key":"catalog-order::create","type":"entity","query_text":"create a catalog order"}]'
  node experience_client.ts report --body '{"resourceId":"catalog","toolType":"skill"}'

Run \`node experience_client.ts <command> --help\` for command-specific flags.
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
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
  const store = buildRuntime().experience_store;
  let result: JsonObject;
  if (command === "fetch") {
    if (!values.queries) {
      process.stderr.write("error: --queries is required\n");
      return 2;
    }
    result = await store.fetch(JSON.parse(values.queries), values.domain, Number(values["top-k"] || 3));
  } else if (command === "report") {
    if (!values.body) {
      process.stderr.write("error: --body is required\n");
      return 2;
    }
    result = await store.report(JSON.parse(values.body));
  } else if (command === "feedback") {
    if (!values.body) {
      process.stderr.write("error: --body is required\n");
      return 2;
    }
    result = await store.feedback(JSON.parse(values.body));
  } else {
    process.stderr.write("usage: experience_client.ts fetch|report|feedback\n");
    return 2;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

const invoked = process.argv[1];
if (invoked && (import.meta.url === `file://${invoked}` || invoked.endsWith("experience_client.ts"))) {
  process.exit(await main());
}
