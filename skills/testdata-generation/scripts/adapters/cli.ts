#!/usr/bin/env node
/** CLI replacement for `python3 -c "from adapters import build_runtime; ..."`. */

import { buildRuntime } from "./index.ts";
import type { Json, JsonObject } from "./config.ts";

function parseArg(raw: string): unknown {
  const trimmed = raw.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function camelName(name: string): string {
  return name.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase());
}

const METHOD_HELP: Record<string, string> = {
  "tool_registry.query": `Usage: node scripts/adapters/cli.ts tool_registry.query <sentence>

Query the tool registry with a natural-language sentence.

Example:
  node scripts/adapters/cli.ts tool_registry.query "create a catalog test product"
`,
  "tool_registry.get": `Usage: node scripts/adapters/cli.ts tool_registry.get <resource-id>

Look up a published tool by id.

Example:
  node scripts/adapters/cli.ts tool_registry.get <resource-id>
`,
  "tool_registry.execute": `Usage: node scripts/adapters/cli.ts tool_registry.execute <id> '<json>'

Execute a published tool with a JSON params object.

Example:
  node scripts/adapters/cli.ts tool_registry.execute <id> '{"param":1}'
`,
  "tool_registry.publish": `Usage: node scripts/adapters/cli.ts tool_registry.publish <name> <desc> <script> '<inputs-json>'

Publish a local construction script to the tool registry.

Example:
  node scripts/adapters/cli.ts tool_registry.publish 'create-product' 'create a catalog product' './testdata/create-product.ts' '[{"name":"name","type":"string","required":true}]'
`,
  "tool_registry.query_input_list": `Usage: node scripts/adapters/cli.ts tool_registry.query_input_list <resource-id>

List input schema fields for a published tool.

Example:
  node scripts/adapters/cli.ts tool_registry.query_input_list <resource-id>
`,
  "skill_marketplace.install": `Usage: node scripts/adapters/cli.ts skill_marketplace.install <name> <targetDir>

Install a domain skill into a skills directory.

Example:
  node scripts/adapters/cli.ts skill_marketplace.install catalog ./installed-skills
`,
  "skill_marketplace.search": `Usage: node scripts/adapters/cli.ts skill_marketplace.search <keywords> [limit]

Search installed / marketplace skills by keywords.

Example:
  node scripts/adapters/cli.ts skill_marketplace.search catalog
`,
  "api_catalog.search": `Usage: node scripts/adapters/cli.ts api_catalog.search <keyword>

Keyword / service search over the API catalog.

Example:
  node scripts/adapters/cli.ts api_catalog.search "create catalog product"
`,
  "api_catalog.detail": `Usage: node scripts/adapters/cli.ts api_catalog.detail <operationId>

Show one API operation.

Example:
  node scripts/adapters/cli.ts api_catalog.detail createProduct
`,
  "api_catalog.list_by_service": `Usage: node scripts/adapters/cli.ts api_catalog.list_by_service <serviceId> [name-filter]

List APIs for a known service id.

Example:
  node scripts/adapters/cli.ts api_catalog.list_by_service <serviceId> create
`,
  "api_catalog.search_plan_changes": `Usage: node scripts/adapters/cli.ts api_catalog.search_plan_changes <planId>

List change APIs for a test plan.

Example:
  node scripts/adapters/cli.ts api_catalog.search_plan_changes <planId>
`,
};

function printTopHelp(): void {
  process.stderr.write(
    "usage: node scripts/adapters/cli.ts <adapter.method> [args...]\n" +
      "examples:\n" +
      "  node scripts/adapters/cli.ts tool_registry.query \"create a catalog test product\"\n" +
      "  node scripts/adapters/cli.ts tool_registry.get <resource-id>\n" +
      "  node scripts/adapters/cli.ts tool_registry.execute <id> '{\"param\":1}'\n" +
      "  node scripts/adapters/cli.ts skill_marketplace.install <name> <targetDir>\n" +
      "  node scripts/adapters/cli.ts api_catalog.search \"create catalog product\"\n" +
      "  node scripts/adapters/cli.ts <adapter.method> --help\n",
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const helpIdx = argv.findIndex((a) => a === "-h" || a === "--help");
  if (!argv.length || helpIdx === 0) {
    printTopHelp();
    return argv.length ? 0 : 2;
  }
  if (helpIdx > 0) {
    const target = argv[0];
    process.stdout.write(
      METHOD_HELP[target] ||
        `Usage: node scripts/adapters/cli.ts ${target} [args...]\n\n` +
          `Invoke adapter method ${target} and print JSON.\n\n` +
          `See: node scripts/adapters/cli.ts --help\n`,
    );
    return 0;
  }

  const [target, ...rest] = argv;
  const dot = target.lastIndexOf(".");
  if (dot < 0) {
    process.stderr.write(`invalid target: ${target}\n`);
    return 2;
  }
  const adapterName = target.slice(0, dot);
  const methodName = target.slice(dot + 1);
  const runtime = buildRuntime() as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>;
  const adapter = runtime[adapterName];
  const fn = adapter?.[methodName] || adapter?.[camelName(methodName)];
  if (!adapter || typeof fn !== "function") {
    process.stderr.write(`unknown method: ${target}\n`);
    return 2;
  }

  const args = rest.map(parseArg);
  if (adapterName === "tool_registry" && methodName === "publish") {
    const [name, desc, script, inputs] = args;
    const parsedInputs = Array.isArray(inputs) ? inputs : typeof inputs === "string" ? JSON.parse(inputs) : [];
    printJson(await adapter.publish(name, desc, script, parsedInputs));
    return 0;
  }
  if (adapterName === "tool_registry" && methodName === "execute") {
    const [id, params] = args;
    const body = (params && typeof params === "object" ? params : {}) as JsonObject;
    printJson(await adapter.execute(id, body));
    return 0;
  }
  if (adapterName === "api_catalog" && methodName === "list_by_service") {
    printJson(await adapter.listByService(args[0], args[1] ?? null));
    return 0;
  }
  if (adapterName === "api_catalog" && methodName === "search_plan_changes") {
    printJson(await adapter.searchPlanChanges(args[0]));
    return 0;
  }
  if (adapterName === "config_store" && methodName === "set") {
    printJson(await adapter.set(args[0], args[1] as Json, (args[2] as string) ?? null));
    return 0;
  }
  if (adapterName === "skill_marketplace" && methodName === "search") {
    const keywords = typeof args[0] === "string" ? String(args[0]).split(/\s+/).filter(Boolean) : args[0];
    printJson(await adapter.search(keywords, args[1] ?? 20));
    return 0;
  }
  printJson(await fn.apply(adapter, args));
  return 0;
}

process.exit(await main());
