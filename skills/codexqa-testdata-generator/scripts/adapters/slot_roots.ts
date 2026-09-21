/** Single discovery surface for domain slots. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandUser, isDir, isFile, loadConfig, resolvePackRoot, resolveSkillDir } from "./config.ts";

export type SlotItem = {
  id: string;
  action?: string;
  executor: string;
  aliases: string[];
  params: string[];
  invokeParams: string[];
};

export type SlotScene = { id: string; steps: string[] };

export type SlotManifest = {
  name: string;
  domain: string;
  description: string;
  skillPath: string;
  entities: SlotItem[];
  actions: SlotItem[];
  scenes: SlotScene[];
};

function parseInlineList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((p) => p.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "operation";
}

export function tokensFromId(id: string): string[] {
  return id
    .split(/[-_]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 1 && !["create", "update", "call", "setup", "enroll"].includes(p));
}

/** Keep only id tokens that do not also appear on a sibling item. Shared stems such as `product` in `limited-product` / `catalog-product` must not become aliases, or `entityType=product` binds the more specific sibling. */
export function uniqueIdTokens(ids: string[]): string[][] {
  const perItem = ids.map((id) => tokensFromId(id));
  const counts = new Map<string, number>();
  for (const toks of perItem) {
    for (const token of new Set(toks)) counts.set(token, (counts.get(token) || 0) + 1);
  }
  return perItem.map((toks) => toks.filter((token) => counts.get(token) === 1));
}

export function listSlotRoots(): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const dir = resolve(expandUser(raw));
    if (!isDir(dir) || seen.has(dir)) return;
    seen.add(dir);
    roots.push(dir);
  };
  add(join(resolvePackRoot(), "slots"));
  add(join(resolveSkillDir(), "slots"));
  try {
    const cfg = loadConfig();
    const extra = cfg.get(["workspace", "slot_roots"], []);
    if (Array.isArray(extra)) {
      for (const item of extra) add(String(item));
    }
    const market = cfg.adapter("skill_marketplace").paths;
    if (Array.isArray(market)) {
      for (const item of market) add(String(item));
    }
  } catch {
    /* config optional */
  }
  return roots;
}

export function isSlotDir(dir: string): boolean {
  return isFile(join(dir, "SKILL.md")) || isFile(join(dir, "slot.yaml"));
}

export function listSlotDirs(): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    const key = resolve(dir);
    if (seen.has(key) || !isSlotDir(key)) return;
    seen.add(key);
    dirs.push(key);
  };
  for (const root of listSlotRoots()) {
    add(root);
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) add(join(root, name));
  }
  return dirs;
}

export function listSlotOpenApiDirs(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    if (!isDir(dir) || seen.has(dir)) return;
    seen.add(dir);
    out.push(dir);
  };
  for (const slot of listSlotDirs()) add(join(slot, "assets", "openapi"));
  try {
    const extra = loadConfig().adapter("api_catalog").paths;
    if (Array.isArray(extra)) {
      for (const raw of extra) {
        const path = resolve(expandUser(String(raw)));
        add(isFile(path) ? path.replace(/[/\\][^/\\]+$/, "") : path);
      }
    }
  } catch {
    /* optional */
  }
  return out;
}

function parseSlotYaml(text: string): {
  name?: string;
  domain?: string;
  description?: string;
  entities: SlotItem[];
  actions: SlotItem[];
  scenes: SlotScene[];
} {
  const entities: SlotItem[] = [];
  const actions: SlotItem[] = [];
  const scenes: SlotScene[] = [];
  let meta: { name?: string; domain?: string; description?: string } = {};
  let section: "entities" | "actions" | "scenes" | null = null;
  let current: SlotItem | null = null;
  let scene: SlotScene | null = null;
  const flushItem = () => {
    if (!current?.id || !current.executor) return;
    if (section === "entities") entities.push(current);
    if (section === "actions") actions.push(current);
  };
  const flushScene = () => {
    if (scene?.id) scenes.push(scene);
  };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (/^name:\s*(.+)\s*$/.test(raw) && !section) {
      meta.name = raw.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
      continue;
    }
    if (/^domain:\s*(.+)\s*$/.test(raw) && !section) {
      meta.domain = raw.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
      continue;
    }
    if (/^description:\s*(.+)\s*$/.test(raw) && !section) {
      meta.description = raw.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
      continue;
    }
    if (/^entities:\s*$/.test(raw)) {
      flushItem();
      flushScene();
      current = null;
      scene = null;
      section = "entities";
      continue;
    }
    if (/^actions:\s*$/.test(raw)) {
      flushItem();
      flushScene();
      current = null;
      scene = null;
      section = "actions";
      continue;
    }
    if (/^scenes:\s*$/.test(raw)) {
      flushItem();
      flushScene();
      current = null;
      scene = null;
      section = "scenes";
      continue;
    }
    if (/^[a-zA-Z]/.test(raw) && raw.includes(":")) {
      flushItem();
      flushScene();
      current = null;
      scene = null;
      section = null;
      continue;
    }
    const item = raw.match(/^\s+-\s+id:\s*(.+)\s*$/);
    if (item && (section === "entities" || section === "actions")) {
      flushItem();
      current = {
        id: item[1].trim().replace(/^["']|["']$/g, ""),
        executor: "",
        aliases: [],
        params: [],
        invokeParams: [],
      };
      continue;
    }
    if (item && section === "scenes") {
      flushScene();
      scene = { id: item[1].trim().replace(/^["']|["']$/g, ""), steps: [] };
      continue;
    }
    if (current) {
      const field = raw.match(/^\s{4}([A-Za-z][A-Za-zA-Z0-9]*):\s*(.*)\s*$/);
      if (field) {
        const key = field[1];
        const value = field[2].trim().replace(/^["']|["']$/g, "");
        if (key === "executor") current.executor = value;
        else if (key === "action") current.action = value;
        else if (key === "aliases") current.aliases = parseInlineList(value);
        else if (key === "params") current.params = parseInlineList(value);
        else if (key === "invokeParams") current.invokeParams = parseInlineList(value);
      }
      continue;
    }
    if (scene) {
      const inline = raw.match(/^\s{4}steps:\s*(\[.*\])\s*$/);
      if (inline) {
        scene.steps = parseInlineList(inline[1]);
        continue;
      }
      const step = raw.match(/^\s+-\s+(.+)\s*$/);
      if (step && !/^id:/.test(step[1])) scene.steps.push(step[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  flushItem();
  flushScene();
  return { ...meta, entities, actions, scenes };
}

function extractOpenApiOps(openapiDir: string): Array<{ operationId: string; method: string; path: string }> {
  if (!isDir(openapiDir)) return [];
  const ops: Array<{ operationId: string; method: string; path: string }> = [];
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (isDir(full)) {
        walk(full);
        continue;
      }
      if (!/\.(json|ya?ml)$/i.test(name)) continue;
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      let path = "";
      let method = "";
      for (const raw of text.split(/\r?\n/)) {
        const p = raw.match(/^\s{2}(\/[^\s:]*):\s*$/);
        if (p) {
          path = p[1];
          method = "";
          continue;
        }
        const m = raw.match(/^\s{4}(get|post|put|patch|delete):\s*$/i);
        if (m) {
          method = m[1].toUpperCase();
          continue;
        }
        const op = raw.match(/^\s+operationId:\s*(\S+)\s*$/);
        if (op && path) ops.push({ operationId: op[1].replace(/^["']|["']$/g, ""), method: method || "POST", path });
      }
    }
  };
  walk(openapiDir);
  return ops;
}

function inferItems(dir: string): SlotItem[] {
  const execDir = join(dir, "scripts", "executors");
  const files = isDir(execDir)
    ? readdirSync(execDir).filter((name) => name.endsWith(".ts") || name.endsWith(".js"))
    : [];
  const ops = extractOpenApiOps(join(dir, "assets", "openapi"));
  const items: SlotItem[] = [];
  const used = new Set<string>();
  for (const op of ops) {
    const stem = slug(op.operationId).replace(/-/g, "");
    const file = files.find((name) => name.replace(/\.(ts|js)$/i, "").replace(/-/g, "").toLowerCase() === stem);
    if (!file) continue;
    used.add(file);
    const id = slug(op.operationId);
    items.push({
      id,
      action: op.method === "POST" ? "create" : "call",
      executor: `scripts/executors/${file}`,
      aliases: tokensFromId(id),
      params: [],
      invokeParams: ["name"],
    });
  }
  for (const file of files) {
    if (used.has(file)) continue;
    const id = file.replace(/\.(ts|js)$/i, "");
    items.push({
      id,
      action: "create",
      executor: `scripts/executors/${file}`,
      aliases: tokensFromId(id),
      params: [],
      invokeParams: ["name"],
    });
  }
  return items;
}

function readSkillDescription(dir: string): string {
  const skillMd = join(dir, "SKILL.md");
  if (!isFile(skillMd)) return "";
  const text = readFileSync(skillMd, "utf8");
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return "";
  const fm = block[1];
  const start = fm.match(/^description:\s*(.*)$/m);
  if (!start) return "";
  const first = start[1].trim().replace(/^["']|["']$/g, "");
  // Folded (`>` / `>-`) and literal (`|`) blocks continue on indented lines.
  // Do not use `/m` + `$` to find the end — `$` matches each line, so a
  // non-greedy scan would keep only the first line and drop domain nouns.
  if (first && !["|", ">", ">-", "|-"].includes(first)) return first;
  const after = fm.slice(fm.indexOf(start[0]) + start[0].length);
  const lines: string[] = [];
  for (const line of after.split(/\n/)) {
    if (/^[a-zA-Z][a-zA-Z0-9_-]*:/.test(line)) break;
    const trimmed = line.trim().replace(/^["']|["']$/g, "");
    if (trimmed) lines.push(trimmed);
  }
  return lines.join(" ");
}

export function loadSlotManifest(dir: string): SlotManifest {
  const name = dir.split(/[/\\]/).pop() || "slot";
  const yamlPath = join(dir, "slot.yaml");
  if (existsSync(yamlPath)) {
    const parsed = parseSlotYaml(readFileSync(yamlPath, "utf8"));
    const entityTokens = uniqueIdTokens(parsed.entities.map((item) => item.id));
    const actionTokens = uniqueIdTokens(parsed.actions.map((item) => item.id));
    const entities = parsed.entities.map((item, i) => ({
      ...item,
      aliases: [...new Set([...entityTokens[i], ...item.aliases])],
      invokeParams: item.invokeParams.length ? item.invokeParams : item.params.length ? item.params : ["name"],
    }));
    const actions = parsed.actions.map((item, i) => ({
      ...item,
      aliases: [...new Set([...actionTokens[i], ...item.aliases])],
    }));
    return {
      name: parsed.name || name,
      domain: parsed.domain || name,
      description: parsed.description || readSkillDescription(dir),
      skillPath: dir,
      entities,
      actions,
      scenes: parsed.scenes,
    };
  }
  const inferred = inferItems(dir);
  return {
    name,
    domain: name,
    description: readSkillDescription(dir),
    skillPath: dir,
    entities: inferred,
    actions: [],
    scenes: [],
  };
}

export function renderSlotSkillMd(manifest: SlotManifest): string {
  const rows = [
    ...manifest.entities.map((e) => `| \`${e.id}\` | entity | \`${e.executor}\` |`),
    ...manifest.actions.map((a) => `| \`${a.id}\` | action | \`${a.executor}\` |`),
  ];
  const table = ["| Id | Kind | Script |", "|---|---|---|", ...rows].join("\n") || "| — | — | — |";
  const scenes = manifest.scenes.length
    ? manifest.scenes.map((s) => `- **${s.id}**: ${s.steps.join(" → ")}`).join("\n")
    : "Single-step: pick an executor from the table.";
  return `---
name: ${manifest.name}
description: >-
  ${manifest.description || `Domain data-build slot for ${manifest.domain}.`}
license: Apache-2.0
metadata:
  generated-from: slot.yaml
---

# ${manifest.domain} data-build slot

<!-- generated-from: slot.yaml -->

${table}

## Scenes

${scenes}

Pass upstream \`data\` into the next step. Do not invent core IDs.
`;
}

export function renderToolsGuide(manifest: SlotManifest): string {
  const rows = [
    ...manifest.entities.map((e) => `| ${e.id} | \`${e.executor}\` | ${(e.invokeParams.length ? e.invokeParams : e.params).join(", ") || "—"} |`),
    ...manifest.actions.map((a) => `| ${a.id} | \`${a.executor}\` | ${a.params.join(", ") || "—"} |`),
  ];
  return `# ${manifest.domain} tools

<!-- generated-from: slot.yaml -->

| Tool | Script | Params |
|---|---|---|
${rows.join("\n")}
`;
}
