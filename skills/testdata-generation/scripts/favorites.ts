#!/usr/bin/env node
/** Pinned skill cheat-sheet. No marketplace lookup; local path checks only. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { expandUser, isFile } from "./adapters/config.ts";
import type { JsonObject } from "./adapters/config.ts";

const ENV_PATH_KEY = "DATA_BUILD_FAVORITES_PATH";
const PROJECT_PATH = join("testdata", "data-build-favorites.json");
const USER_PATH = join(homedir(), ".testdata", "favorites.json");
const DEFAULT_LIMIT = 20;
const SCHEMA_VERSION = 1;

function safeInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function envPath(): string | null {
  const raw = process.env[ENV_PATH_KEY];
  return raw ? expandUser(raw) : null;
}

export function resolvePaths(): string[] {
  const env = envPath();
  if (env !== null) return isFile(env) ? [env] : [];
  return [USER_PATH, PROJECT_PATH].filter((p) => isFile(p));
}

function writeTarget(scope: string): string {
  const env = envPath();
  if (env !== null) return env;
  return scope === "project" ? PROJECT_PATH : USER_PATH;
}

function readFile(path: string): JsonObject {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { version: SCHEMA_VERSION, favorites: [] };
    }
    if (!Array.isArray(data.favorites)) data.favorites = [];
    return data as JsonObject;
  } catch {
    return { version: SCHEMA_VERSION, favorites: [] };
  }
}

function writeFile(path: string, data: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function entryKey(fav: JsonObject): string {
  return String(fav.id || fav.skillName || fav.skillUuid || "").trim();
}

export function loadFavorites(limit = DEFAULT_LIMIT): JsonObject[] {
  const merged = new Map<string, JsonObject>();
  const order: string[] = [];
  for (const path of resolvePaths()) {
    const favs = readFile(path).favorites;
    if (!Array.isArray(favs)) continue;
    for (const fav of favs) {
      if (!fav || typeof fav !== "object" || Array.isArray(fav)) continue;
      const row = fav as JsonObject;
      const key = entryKey(row);
      if (!key) continue;
      if (!merged.has(key)) order.push(key);
      merged.set(key, row);
    }
  }
  const favorites = order.map((k) => merged.get(k)!);
  favorites.sort((a, b) => {
    const pa = safeInt(a.priority);
    const pb = safeInt(b.priority);
    if (pb !== pa) return pb - pa;
    return String(b.pinnedAt || "").localeCompare(String(a.pinnedAt || ""));
  });
  return limit && limit > 0 ? favorites.slice(0, limit) : favorites;
}

export function toPinnedMatch(fav: JsonObject): JsonObject {
  const name = fav.skillName || fav.name || "";
  const uuid = fav.skillUuid || fav.uuid || name;
  return {
    uuid,
    name,
    description: fav.description || "",
    pinned: true,
    skillPath: fav.skillPath || "",
    priority: safeInt(fav.priority),
    available: fav.available ?? null,
  };
}

function checkLocalPath(skillPath: string): boolean {
  return Boolean(skillPath) && isFile(join(expandUser(skillPath), "SKILL.md"));
}

export function validateFavorites(favs: JsonObject[]): void {
  for (const fav of favs) {
    const skillPath = String(fav.skillPath || "");
    fav.available = skillPath ? checkLocalPath(skillPath) : false;
  }
}

function slugify(text: string): string {
  const slug = text.trim().replace(/[^\w]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug || "fav";
}

function cmdAdd(args: Record<string, unknown>): number {
  if (!args.name) {
    process.stderr.write("error: --name is required\n");
    return 2;
  }
  const target = writeTarget(String(args.scope || "user"));
  const data = isFile(target) ? readFile(target) : { version: SCHEMA_VERSION, favorites: [] };
  const name = String(args.name);
  const uuidVal = String(args.uuid || name);
  const entryId = String(args.id || slugify(name || uuidVal)).trim();
  const entry: JsonObject = {
    id: entryId,
    skillUuid: uuidVal,
    skillName: name,
    description: String(args.desc || ""),
    skillPath: String(args.path || ""),
    priority: Number(args.priority || 0),
    pinnedAt: new Date().toISOString().slice(0, 10),
  };
  const existing = Array.isArray(data.favorites) ? (data.favorites as JsonObject[]) : [];
  const favorites = existing.filter(
    (f) => String(f.id) !== entryId && String(f.skillUuid) !== uuidVal && String(f.skillName) !== name,
  );
  favorites.push(entry);
  data.favorites = favorites;
  data.version ??= SCHEMA_VERSION;
  writeFile(target, data);
  process.stdout.write(`pinned ${name} (id=${entryId}) -> ${target}\n`);
  return 0;
}

function cmdList(args: Record<string, unknown>): number {
  const favs = loadFavorites(0);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(favs, null, 2)}\n`);
    return 0;
  }
  if (!favs.length) {
    process.stdout.write("No pinned skills. Use favorites.ts add.\n");
    return 0;
  }
  process.stdout.write(`Pinned skills (${favs.length}):\n\n`);
  favs.forEach((fav, i) => {
    process.stdout.write(`  [${i + 1}] ${fav.skillName || "?"}  (id=${fav.id || "?"})\n`);
    if (fav.description) process.stdout.write(`      ${fav.description}\n`);
    if (fav.skillPath) process.stdout.write(`      ${fav.skillPath}\n`);
  });
  return 0;
}

function cmdRm(args: Record<string, unknown>): number {
  if (!args.id && !args.uuid && !args.name) {
    process.stderr.write("provide --id, --uuid, or --name\n");
    return 1;
  }
  let removedTotal = 0;
  for (const path of resolvePaths()) {
    const data = readFile(path);
    const kept: JsonObject[] = [];
    let removed = 0;
    for (const fav of (Array.isArray(data.favorites) ? data.favorites : []) as JsonObject[]) {
      const match =
        (args.id && String(fav.id) === args.id) ||
        (args.uuid && String(fav.skillUuid) === args.uuid) ||
        (args.name && String(fav.skillName) === args.name);
      if (match) removed += 1;
      else kept.push(fav);
    }
    if (removed) {
      data.favorites = kept;
      writeFile(path, data);
      removedTotal += removed;
      process.stdout.write(`removed ${removed} from ${path}\n`);
    }
  }
  if (!removedTotal) {
    process.stdout.write("no matching pinned skill\n");
    return 1;
  }
  return 0;
}

function cmdVerify(args: Record<string, unknown>): number {
  const favs = loadFavorites(0);
  validateFavorites(favs);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(favs, null, 2)}\n`);
    return 0;
  }
  if (!favs.length) {
    process.stdout.write("No pinned skills.\n");
    return 0;
  }
  const bad = favs.filter((f) => !f.available);
  process.stdout.write(`Pinned skill check (${favs.length} total, ${bad.length} unavailable):\n\n`);
  for (const fav of favs) {
    process.stdout.write(`  [${fav.available ? "ok" : "missing"}] ${fav.skillName || "?"}\n`);
  }
  return 0;
}

function printHelp(command?: string): void {
  if (command === "add") {
    process.stdout.write(`Usage: node favorites.ts add --name <name> [options]

Pin a skill so later searches return it first.

Options:
  --name <name>         Skill name (required)
  --desc <text>         When to use this skill
  --path <dir>          Local directory that contains SKILL.md
  --uuid <uuid>         Optional skill uuid (defaults to --name)
  --id <id>             Optional favorite id
  --priority <n>        Higher wins (default: 0)
  --scope <scope>       user | project (default: user)
  -h, --help            Show this help and exit

Example:
  node favorites.ts add --name "catalog" --desc "catalog product and order construction" --path "<dir with SKILL.md>"
`);
    return;
  }
  if (command === "list") {
    process.stdout.write(`Usage: node favorites.ts list [--json]

Show pinned skills.

Options:
  --json         Print JSON
  -h, --help     Show this help and exit

Example:
  node favorites.ts list
`);
    return;
  }
  if (command === "rm") {
    process.stdout.write(`Usage: node favorites.ts rm (--name <name> | --uuid <uuid> | --id <id>)

Unpin a skill.

Options:
  --name <name>   Match by skill name
  --uuid <uuid>   Match by skill uuid
  --id <id>       Match by favorite id
  -h, --help      Show this help and exit

Example:
  node favorites.ts rm --name "catalog"
`);
    return;
  }
  if (command === "verify") {
    process.stdout.write(`Usage: node favorites.ts verify [--json]

Check that each pinned skillPath still contains SKILL.md.

Options:
  --json         Print JSON
  -h, --help     Show this help and exit

Example:
  node favorites.ts verify
`);
    return;
  }
  process.stdout.write(`Usage: node favorites.ts <command> [options]

Pinned skill cheat-sheet. No marketplace lookup; local path checks only.

Commands:
  add       Pin a skill
  list      Show pinned skills
  rm        Unpin a skill
  verify    Check pinned skill paths

Global options:
  -h, --help    Show this help and exit

Examples:
  node favorites.ts add --name "catalog" --desc "catalog product" --path "<dir with SKILL.md>"
  node favorites.ts list
  node favorites.ts rm --name "catalog"
  node favorites.ts verify

Run \`node favorites.ts <command> --help\` for command-specific flags.
`);
}

function main(): number {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      name: { type: "string" },
      uuid: { type: "string" },
      desc: { type: "string" },
      path: { type: "string" },
      id: { type: "string" },
      priority: { type: "string", default: "0" },
      scope: { type: "string", default: "user" },
      json: { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (values.help) {
    printHelp(command);
    return 0;
  }
  if (command === "add") return cmdAdd(values);
  if (command === "list") return cmdList(values);
  if (command === "rm") return cmdRm(values);
  if (command === "verify") return cmdVerify(values);
  process.stderr.write("usage: favorites.ts add|list|rm|verify\n");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("favorites.ts")) {
  process.exit(main());
}
