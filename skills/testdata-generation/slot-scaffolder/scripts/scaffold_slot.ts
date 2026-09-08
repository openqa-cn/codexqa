#!/usr/bin/env node
/** Generate a domain slot skeleton from OpenAPI files. */

import { chmodSync, copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ApiCatalog } from "../../scripts/adapters/api_catalog.ts";
import { expandUser, isDir, loadConfig, type JsonObject } from "../../scripts/adapters/config.ts";
import { tokensFromId } from "../../scripts/adapters/slot_roots.ts";
import { syncSlot } from "../../scripts/sync_slot.ts";

function executorStub(operationId: string, summary: string, path: string, method: string, filename: string): string {
  return `#!/usr/bin/env node
/** Executor for ${operationId}: ${summary} */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";

export async function callHttp(path: string, body: unknown = null, method = "POST") {
  const url = path.startsWith("http") ? path : BASE_URL.replace(/\\/+$/, "") + path;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.DATA_BUILD_TOKEN;
  if (token) headers.Authorization = "Bearer " + token;
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const raw = (await resp.text()) || "{}";
    if (!resp.ok) {
      return { success: false, error: \`HTTP \${resp.status}: \${raw.slice(0, 300)}\` };
    }
    return { success: true, data: JSON.parse(raw) };
  } catch (exc) {
    return { success: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export async function main(params: Record<string, unknown>) {
  if (!params || typeof params !== "object" || !Object.keys(params).length) {
    return { success: false, data: null, error: "missing params" };
  }
  const result = await callHttp(${JSON.stringify(path)}, params, ${JSON.stringify(method)});
  if (!result.success) {
    return { success: false, data: null, error: result.error ?? null };
  }
  return { success: true, data: result.data, error: null };
}

function isDirectRun() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch {
    return argv1.replace(/\\\\/g, "/").endsWith(${JSON.stringify(filename)});
  }
}
if (isDirectRun()) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(\`Usage: node ${filename} [--json '<params>']\\n\\nExecutor for ${operationId}: ${summary}\\n\\nOptions:\\n  --json <json>   JSON object of executor params\\n  -h, --help      Show this help and exit\\n\\nExample:\\n  node ${filename} --json '{}'\\n\`);
    process.exit(0);
  }
  let payload: Record<string, unknown> = {};
  const idx = process.argv.indexOf("--json");
  if (idx >= 0 && process.argv[idx + 1] !== undefined) {
    payload = JSON.parse(process.argv[idx + 1]) as Record<string, unknown>;
  }
  const result = await main(payload);
  process.stdout.write(\`\${JSON.stringify(result, null, 2)}\\n\`);
}
`;
}

export function slug(text: string): string {
  const value = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return value || "operation";
}

function openapiFiles(openapiDir: string): string[] {
  if (!isDir(openapiDir)) return [];
  return readdirSync(openapiDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".json"))
    .map((name) => join(openapiDir, name));
}

async function collectOps(openapiDir: string): Promise<JsonObject[]> {
  const cfg = loadConfig();
  const adapters =
    cfg.data.adapters && typeof cfg.data.adapters === "object" && !Array.isArray(cfg.data.adapters)
      ? (cfg.data.adapters as JsonObject)
      : {};
  cfg.data.adapters = adapters;
  const apiCatalog =
    adapters.api_catalog && typeof adapters.api_catalog === "object" && !Array.isArray(adapters.api_catalog)
      ? (adapters.api_catalog as JsonObject)
      : {};
  adapters.api_catalog = apiCatalog;
  apiCatalog.paths = [openapiDir];
  const catalog = new ApiCatalog(cfg, { headers: async () => ({}) } as never);
  return catalog.search("", 200);
}

export async function scaffold(domain: string, openapiDir: string, output: string): Promise<void> {
  const specs = openapiFiles(openapiDir);
  if (!specs.length) {
    throw new Error(
      "need_user_input: missing OpenAPI files. " +
        "Provide --openapi <dir> containing at least one .yaml/.yml/.json spec. " +
        "Do not scaffold a fake operation.",
    );
  }
  const ops = await collectOps(openapiDir);
  if (!ops.length) {
    throw new Error(
      "need_user_input: OpenAPI directory has files but no operations. " +
        "Confirm the specs contain paths/operations, then retry.",
    );
  }
  mkdirSync(join(output, "scripts", "executors"), { recursive: true });
  mkdirSync(join(output, "references"), { recursive: true });
  const destOa = join(output, "assets", "openapi");
  mkdirSync(destOa, { recursive: true });
  if (isDir(openapiDir)) {
    for (const src of openapiFiles(openapiDir)) {
      copyFileSync(src, join(destOa, basename(src)));
    }
  }

  const entities: Array<{ id: string; action: string; executor: string }> = [];
  for (const op of ops) {
    const opId = String(op.operationId || slug(String(op.path || "op")));
    const filename = `${slug(opId)}.ts`;
    const dest = join(output, "scripts", "executors", filename);
    writeFileSync(
      dest,
      executorStub(opId, String(op.summary || opId), String(op.path || `/v1/${domain}`), String(op.method || "POST"), filename),
      "utf8",
    );
    chmodSync(dest, 0o755);
    const id = slug(opId);
    entities.push({
      id,
      action: String(op.method || "").toUpperCase() === "POST" ? "create" : "call",
      executor: `scripts/executors/${filename}`,
    });
  }

  const lines = [`name: ${domain}`, `domain: ${domain}`, 'version: "1.0"', "entities:"];
  for (const ent of entities) {
    const aliases = tokensFromId(ent.id);
    lines.push(`  - id: ${ent.id}`);
    lines.push(`    action: ${ent.action}`);
    lines.push(`    executor: ${ent.executor}`);
    if (aliases.length) lines.push(`    aliases: [${aliases.join(", ")}]`);
    lines.push(`    invokeParams: [name]`);
  }
  lines.push("actions: []");
  lines.push("scenes: []");
  writeFileSync(join(output, "slot.yaml"), `${lines.join("\n")}\n`, "utf8");
  syncSlot(output, true);
  process.stdout.write(`${JSON.stringify({ ok: true, output, executors: entities.length }, null, 2)}\n`);
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      domain: { type: "string" },
      openapi: { type: "string" },
      output: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node scaffold_slot.ts --domain <domain> --openapi <dir> [--output <dir>]

Generate a domain slot skeleton from OpenAPI files.

Options:
  --domain <slug>    Short English domain name (required)
  --openapi <dir>    Directory of OpenAPI YAML/JSON files (required)
  --output <dir>     Destination (default: ../slots/<domain>)
  -h, --help         Show this help and exit

Example:
  node scaffold_slot.ts --domain payments --openapi ./openapi --output ../slots/payments
`);
    return 0;
  }
  if (!String(values.domain || "").trim()) {
    process.stderr.write("need_user_input: missing --domain\n");
    return 2;
  }
  if (!String(values.openapi || "").trim()) {
    process.stderr.write("need_user_input: missing --openapi\n");
    return 2;
  }
  const domain = slug(String(values.domain));
  const openapiDir = resolve(expandUser(String(values.openapi || "")));
  const output = values.output
    ? resolve(expandUser(values.output))
    : resolve(fileURLToPath(import.meta.url), "../../slots", domain);
  try {
    await scaffold(domain, openapiDir, output);
  } catch (exc) {
    process.stderr.write(`${exc instanceof Error ? exc.message : String(exc)}\n`);
    return 2;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("scaffold_slot.ts")) {
  process.exit(await main());
}
