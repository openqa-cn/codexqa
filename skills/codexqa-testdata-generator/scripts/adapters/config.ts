#!/usr/bin/env node
/** Load data-build configuration from env, project, or user YAML. */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export const ENV_CONFIG = "DATA_BUILD_CONFIG";
export const ENV_ROOT = "DATA_GENERATE_SKILLS_ROOT";
export const ENV_SKILL = "DATA_GENERATE_SKILL_DIR";
const PROJECT_CONFIG = join("testdata", "config.yaml");
const USER_CONFIG = join(homedir(), ".testdata", "config.yaml");
const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

export function expandUser(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function* walkParents(start: string): Generator<string> {
  let cur = resolve(start);
  while (true) {
    yield cur;
    const next = dirname(cur);
    if (next === cur) return;
    cur = next;
  }
}

export function resolveSkillDir(): string {
  const raw = process.env[ENV_SKILL] || process.env.DATA_BUILD_SKILL_DIR;
  if (raw) return resolve(expandUser(raw));
  const here = fileURLToPath(import.meta.url);
  for (const parent of walkParents(here)) {
    if (isFile(join(parent, "SKILL.md")) && isDir(join(parent, "scripts", "adapters"))) {
      return parent;
    }
  }
  return resolve(here, "../../..");
}

export function resolvePackRoot(): string {
  const raw = process.env[ENV_ROOT];
  if (raw) return resolve(expandUser(raw));
  const skill = resolveSkillDir();
  if (isDir(join(skill, "slots"))) return skill;
  if (isDir(join(skill, "..", "slots"))) return resolve(skill, "..");
  return skill;
}

function expand(value: unknown, extra?: Record<string, string>): unknown {
  if (typeof value === "string") {
    const mapping: Record<string, string> = { ...process.env } as Record<string, string>;
    mapping.HOME ??= homedir();
    mapping.USER ??= process.env.USER || process.env.USERNAME || "local";
    mapping[ENV_ROOT] ??= resolvePackRoot();
    mapping[ENV_SKILL] ??= resolveSkillDir();
    if (extra) Object.assign(mapping, extra);
    return value.replace(ENV_PATTERN, (all, name: string) => mapping[name] ?? all);
  }
  if (Array.isArray(value)) return value.map((v) => expand(v, extra));
  if (value && typeof value === "object") {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value as JsonObject)) {
      out[k] = expand(v, extra) as Json;
    }
    return out;
  }
  return value;
}

export function parseSimpleYaml(text: string): JsonObject {
  const parseValue = (raw: string): Json => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "~" || trimmed === "null") return null;
    if (trimmed === "true" || trimmed === "True") return true;
    if (trimmed === "false" || trimmed === "False") return false;
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  };

  const root: JsonObject = {};
  const stack: Array<[number, Json]> = [[-1, root]];
  let pendingKey: [number, JsonObject, string] | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1][0]) stack.pop();
    let parent = stack[stack.length - 1][1];

    if (line.startsWith("- ")) {
      const itemRaw = line.slice(2);
      if (pendingKey && pendingKey[0] < indent) {
        const container = pendingKey[1];
        const key = pendingKey[2];
        if (!Array.isArray(container[key])) container[key] = [];
        parent = container[key];
        pendingKey = null;
      }
      if (!Array.isArray(parent)) continue;
      if (itemRaw.includes(":") && !itemRaw.startsWith("{")) {
        const idx = itemRaw.indexOf(":");
        const node: JsonObject = { [itemRaw.slice(0, idx).trim()]: parseValue(itemRaw.slice(idx + 1)) };
        parent.push(node);
        stack.push([indent, node]);
      } else {
        parent.push(parseValue(itemRaw));
      }
      continue;
    }

    if (line.includes(":")) {
      const idx = line.indexOf(":");
      const key = line.slice(0, idx).trim();
      const rest = line.slice(idx + 1).trim();
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) continue;
      const dict = parent as JsonObject;
      if (rest === "") {
        dict[key] = {};
        pendingKey = [indent, dict, key];
        stack.push([indent, dict[key]]);
      } else {
        dict[key] = parseValue(rest);
        pendingKey = null;
      }
    }
  }
  return root;
}

function readYaml(path: string): JsonObject {
  const data = parseSimpleYaml(readFileSync(path, "utf8"));
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export class Config {
  data: JsonObject;
  source: string;

  constructor(data: JsonObject, source: string) {
    this.data = data;
    this.source = source;
  }

  get(keys: string[], defaultValue: unknown = undefined): unknown {
    let cur: unknown = this.data;
    for (const key of keys) {
      if (!cur || typeof cur !== "object" || Array.isArray(cur) || !(key in (cur as JsonObject))) {
        return defaultValue;
      }
      cur = (cur as JsonObject)[key];
    }
    return cur;
  }

  adapter(name: string): JsonObject {
    const block = this.get(["adapters", name], {});
    return block && typeof block === "object" && !Array.isArray(block) ? (block as JsonObject) : {};
  }

  get testdataDir(): string {
    return expandUser(String(this.get(["workspace", "testdata_dir"], "./testdata")));
  }

  get contributor(): string {
    return String(this.get(["workspace", "contributor"], process.env.USER || "local"));
  }
}

export function defaultConfigData(): JsonObject {
  const root = resolvePackRoot();
  const skill = resolveSkillDir();
  const slotPaths = [`${root}/slots`];
  if (!slotPaths.includes(`${skill}/slots`)) slotPaths.unshift(`${skill}/slots`);
  return {
    workspace: {
      testdata_dir: "./testdata",
      contributor: process.env.USER || "local",
    },
    adapters: {
      skill_marketplace: { type: "local", paths: slotPaths },
      tool_registry: { type: "local", path: "./testdata/tools" },
      api_catalog: {
        type: "openapi",
        paths: ["./testdata/openapi"],
      },
      experience_store: { type: "local", path: "./testdata/experience" },
      auth: {
        type: "env",
        token_env: "DATA_BUILD_TOKEN",
        header: "Authorization",
        prefix: "Bearer ",
      },
      data_store: { type: "none", dsn_env: "DATABASE_DSN" },
      config_store: { type: "file", path: "./testdata/config-store.yaml" },
      feature_flags: { type: "noop" },
      doc_source: { type: "local" },
      case_writeback: { type: "local", path: "./testdata/case-materials" },
      workspace_context: { type: "local", path: "./testdata/context.json" },
    },
  };
}

export function resolveConfigPath(explicit?: string | null): string | null {
  if (explicit) {
    const path = expandUser(explicit);
    return isFile(path) ? path : null;
  }
  const env = process.env[ENV_CONFIG];
  if (env) {
    const path = expandUser(env);
    return isFile(path) ? path : null;
  }
  for (const candidate of [PROJECT_CONFIG, USER_CONFIG]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function deepMerge(base: JsonObject, overlay: JsonObject): JsonObject {
  for (const [key, value] of Object.entries(overlay)) {
    const current = base[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      deepMerge(current as JsonObject, value as JsonObject);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export function loadConfig(explicit?: string | null): Config {
  const path = resolveConfigPath(explicit);
  let data: JsonObject;
  let source: string;
  if (path === null) {
    data = defaultConfigData();
    source = "defaults";
  } else {
    data = defaultConfigData();
    deepMerge(data, readYaml(path));
    source = path;
  }
  const extra = {
    [ENV_ROOT]: resolvePackRoot(),
    [ENV_SKILL]: resolveSkillDir(),
  };
  return new Config(expand(data, extra) as JsonObject, source);
}
