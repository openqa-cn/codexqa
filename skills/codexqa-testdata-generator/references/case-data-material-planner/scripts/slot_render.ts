#!/usr/bin/env node
/** slot_render: render entity/action targetLocation slots and write back case-executable.md. */

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

const CASE_EXECUTABLE_FILENAME = "case-executable.md";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

export function loadSourceLines(path: string): string[] {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  if (!text) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

export function saveLines(path: string, lines: string[]): void {
  let payload = lines.join("\n");
  if (!lines.length || lines[lines.length - 1] !== "") payload += "\n";
  writeFileSync(path, payload, "utf8");
}

const ENVELOPE_FIELD_RE = /^(success|ok|error|code|message|traceId|requestId)$/;
const IMPLEMENTATION_CMD_RE = /(?:^|\b)(?:node|python3?|bash|npx|npm|config-store)\b|```/;

function renderFieldPairs(fields: JsonObject): string[] {
  const pairs: string[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    if (ENVELOPE_FIELD_RE.test(key)) continue;
    if (raw === null || raw === undefined || raw === "") continue;
    if (typeof raw === "object") {
      const text = JSON.stringify(raw);
      if (text === "{}" || text === "[]") continue;
      pairs.push(`${key}=${text}`);
      continue;
    }
    const text = String(raw).trim();
    if (!text || IMPLEMENTATION_CMD_RE.test(text)) continue;
    pairs.push(`${key}=${text}`);
  }
  return pairs;
}

export function renderEntity(entity: JsonObject): string {
  const strategy = entity.constructionStrategy;
  if (strategy === "config") return renderConfigEntity(entity);
  if (strategy === "runtime") return renderRuntimeEntity(entity);

  const etype = String(entity.entityType || "entity");
  const pairs = renderFieldPairs(asObject(entity.fields));
  let constraints = String(entity.constraints || "").trim();
  if (constraints.length > 40) constraints = `${constraints.slice(0, 40)}…`;
  const head = pairs.length ? `${etype}（${pairs.join("，")}）` : etype;
  const parts = [head];
  if (constraints) parts.push(constraints);
  return `- ${parts.join("，")}`;
}

function renderConfigEntity(entity: JsonObject): string {
  const etype = String(entity.entityType || "配置项");
  const fields = asObject(entity.fields);
  const pairs: string[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === null || raw === "") continue;
    const text = String(raw).trim();
    if (IMPLEMENTATION_CMD_RE.test(text)) {
      pairs.push(key);
      continue;
    }
    const last = text.includes("\n") ? text.split("\n").at(-1)!.trim() : text;
    pairs.push(last.includes("=") && !last.includes(" ") ? last : `${key}=${last}`);
  }
  return pairs.length ? `- ${etype}（${pairs.join("，")}）` : `- ${etype}`;
}

function renderRuntimeEntity(entity: JsonObject): string {
  const etype = String(entity.entityType || "entity");
  const source = asObject(entity.runtimeSource);
  const srcAction = source.sourceActionId ?? "?";
  const srcField = source.sourceOutputField ?? "?";
  return `- ${etype}（由步骤 ${srcAction} 执行时产出 ${srcField}）`;
}

const PRIOR_ACTION_PLACEHOLDER_RE = /<<([A-Z][0-9]+)\.([A-Za-z_][A-Za-z0-9_]*)>>/g;

function collectPriorRefs(filledCmd: string): Array<[string, string]> {
  const seen = new Set<string>();
  const result: Array<[string, string]> = [];
  for (const m of filledCmd.matchAll(PRIOR_ACTION_PLACEHOLDER_RE)) {
    const key = `${m[1]}.${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([m[1], m[2]]);
  }
  return result;
}

function stepOf(actionsById: Map<string, JsonObject>, aid: string): string {
  const action = actionsById.get(aid) || {};
  return action.stepIdx !== undefined && action.stepIdx !== null ? String(action.stepIdx) : "?";
}

function entityById(entities: JsonObject[], id: string): JsonObject {
  return entities.find((e) => e.entityId === id) || {};
}

function collectActionInputs(action: JsonObject, allActions: JsonObject[], entities: JsonObject[]): string[] {
  const actionsById = new Map<string, JsonObject>();
  for (const a of allActions) {
    if (typeof a.actionId === "string") actionsById.set(a.actionId, a);
  }
  const inputs: string[] = [];
  const seen = new Set<string>();
  const push = (name: string, value: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    inputs.push(`${name}=${value}`);
  };
  for (const p of asObjects(action.paramsFromEntities)) {
    const name = String(p.paramName || "");
    const src = entityById(entities, String(p.sourceEntityId || ""));
    const val = asObject(src.fields)[String(p.sourceField || "")];
    push(name, val !== undefined && val !== null && val !== "" ? String(val) : "—");
  }
  for (const p of asObjects(action.paramsFromPriorActions)) {
    const name = String(p.paramName || "");
    const aid = String(p.sourceActionId || "?");
    const field = String(p.sourceOutputField || name || "?");
    push(name, `第${stepOf(actionsById, aid)}步产出的 ${field}`);
  }
  for (const p of asObjects(action.paramsFromGenerators)) {
    push(String(p.paramName || ""), "运行时生成");
  }
  for (const [aid, field] of collectPriorRefs(String(action.filledCmd || ""))) {
    if (seen.has(field)) continue;
    push(field, `第${stepOf(actionsById, aid)}步产出的 ${field}`);
  }
  return inputs;
}

function collectActionOutputs(action: JsonObject): string[] {
  return Object.keys(asObject(action.outputs)).filter(Boolean);
}

export function renderAction(action: JsonObject, allActions: JsonObject[], entities: JsonObject[] = []): string {
  if (!action.filledCmd || action.cmdStatus !== "filled") return "";
  const inputs = collectActionInputs(action, allActions, entities);
  const outputs = collectActionOutputs(action);
  const parts: string[] = [];
  if (inputs.length) parts.push(`入参：${inputs.join("，")}`);
  if (outputs.length) parts.push(`产出：${outputs.join("、")}`);
  return parts.length ? `（${parts.join("；")}）` : "（已绑定）";
}

export function preview(manifest: JsonObject): JsonObject {
  const entities = asObjects(manifest.entities);
  const actions = asObjects(manifest.actions);
  let updated = 0;
  let skipped = 0;
  for (const e of entities) {
    if (!e.targetLocation) continue;
    e.renderPreview = renderEntity(e);
    updated += 1;
  }
  for (const a of actions) {
    if (!a.targetLocation) continue;
    const rendered = renderAction(a, actions, entities);
    if (!rendered) {
      a.renderPreview = null;
      a.failReason = `action not ready: cmdStatus=${a.cmdStatus}`;
      skipped += 1;
      continue;
    }
    a.renderPreview = rendered;
    updated += 1;
  }
  return { updated, skipped };
}

const LOCATION_RE =
  /^(?<section>[\w-]+)\.(?<container>list|table)(?:\[(?<top>\d+)\])?(?:\.row\[(?<row>\d+)\])?(?:\.(?<cell>[\w-]+))?(?:\.entity\[(?<sub>\d+)\])?$/;

export type Location = {
  section: string;
  container: string;
  top: number | null;
  row: number | null;
  cell: string | null;
  sub: number | null;
};

export function parseLocation(loc: string): Location {
  const m = LOCATION_RE.exec(loc);
  if (!m || !m.groups) throw new Error(`invalid location: ${loc}`);
  const gd = m.groups;
  return {
    section: gd.section,
    container: gd.container,
    top: gd.top !== undefined ? Number(gd.top) : null,
    row: gd.row !== undefined ? Number(gd.row) : null,
    cell: gd.cell ?? null,
    sub: gd.sub !== undefined ? Number(gd.sub) : null,
  };
}

export function findSectionHeading(lines: string[], section: string): number {
  const sectionAliases: Record<string, string[]> = {
    precondition: ["precondition", "前置", "preconditio"],
    steps: ["steps", "操作步骤", "步骤", "step"],
  };
  const aliases = sectionAliases[section] || [section];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s+/.test(line)) {
      const lower = line.toLowerCase();
      for (const alias of aliases) {
        if (line.includes(alias) || lower.includes(alias.toLowerCase())) return i;
      }
    }
  }
  return -1;
}

export function nextHeading(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

export function findListItems(lines: string[], start: number, end: number): number[] {
  const idxs: number[] = [];
  for (let i = start; i < end; i++) {
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) idxs.push(i);
  }
  return idxs;
}

export function findTableRows(lines: string[], start: number, end: number): number[] {
  const rows: number[] = [];
  let inTable = false;
  let headerSeen = false;
  let sepSeen = false;
  for (let i = start; i < end; i++) {
    const line = lines[i];
    const isPipe = line.includes("|") && line.trim().startsWith("|");
    if (!isPipe) {
      inTable = false;
      headerSeen = false;
      sepSeen = false;
      continue;
    }
    if (!inTable) {
      inTable = true;
      headerSeen = true;
      continue;
    }
    if (headerSeen && !sepSeen) {
      if (/^\s*\|?\s*[:\-\s|]+\|?\s*$/.test(line)) {
        sepSeen = true;
        continue;
      }
    }
    rows.push(i);
  }
  return rows;
}

export function splitTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

export function joinTableCells(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

const CELL_ALIAS: Record<string, string[]> = {
  "op-cell": ["operation", "op", "cmd", "操作", "命令"],
  "expected-cell": ["expected", "期望", "预期"],
};

function findCellIndex(headerLine: string, cellName: string | null): number {
  if (!cellName) return 1;
  const hdrCells = splitTableCells(headerLine);
  const aliases = CELL_ALIAS[cellName] || [cellName];
  for (let i = 0; i < hdrCells.length; i++) {
    const lower = hdrCells[i].trim().toLowerCase();
    for (const alias of aliases) {
      if (lower.includes(alias.toLowerCase())) return i;
    }
  }
  return 1;
}

export function applySlot(lines: string[], loc: Location, previewText: string): string[] {
  const secIdx = findSectionHeading(lines, loc.section);
  if (secIdx < 0) throw new Error(`section heading not found: ${loc.section}`);
  const endIdx = nextHeading(lines, secIdx);

  if (loc.container === "list") {
    const items = findListItems(lines, secIdx + 1, endIdx);
    const top = loc.top ?? 0;
    if (top < 0 || top >= items.length) {
      throw new Error(`list index out of range: ${top} (section has ${items.length} items)`);
    }
    const target = items[top];
    const indentMatch = lines[target].match(/^(\s*)(?:[-*+]|\d+\.)\s+/);
    const indent = indentMatch ? indentMatch[1] : "";
    const markerMatch = lines[target].match(/^\s*([-*+]|\d+\.)\s+/);
    const marker = markerMatch ? markerMatch[1] : "-";
    const sub = loc.sub;
    if (sub !== null) {
      const sep = "；";
      let clean = previewText.replace(/^\s+/, "");
      if (clean.startsWith("-")) clean = clean.slice(1).replace(/^\s+/, "");
      if (sub === 0) {
        lines[target] = `${indent}${marker} ${clean}`;
      } else {
        const current = lines[target].replace(/\s+$/, "");
        lines[target] = `${current}${sep}${clean}`;
      }
    } else {
      let clean = previewText.replace(/^\s+/, "");
      if (clean.startsWith("-")) clean = clean.slice(1).replace(/^\s+/, "");
      lines[target] = `${indent}${marker} ${clean}`;
    }
    return lines;
  }

  if (loc.container === "table") {
    const rows = findTableRows(lines, secIdx + 1, endIdx);
    const row = loc.row ?? 0;
    if (row < 0 || row >= rows.length) {
      throw new Error(`table row out of range: ${row} (section has ${rows.length} rows)`);
    }
    const target = rows[row];
    const cells = splitTableCells(lines[target]);
    let headerLine: string | null = null;
    for (let i = secIdx + 1; i < target; i++) {
      if (lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        headerLine = lines[i];
        break;
      }
    }
    let opCellIndex = headerLine ? findCellIndex(headerLine, loc.cell) : 1;
    if (opCellIndex >= cells.length) opCellIndex = cells.length - 1;
    const existing = cells[opCellIndex];
    let appended: string;
    appended = `${existing} ${previewText.trim()}`.trim();
    cells[opCellIndex] = appended;
    lines[target] = joinTableCells(cells);
    return lines;
  }

  throw new Error(`unsupported container: ${loc.container}`);
}

export function commit(manifest: JsonObject, manifestPath: string): JsonObject {
  const source = asObject(manifest.caseSource).original;
  if (!source) throw new Error("manifest.caseSource.original missing");
  const sourcePath = String(source);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error(`source file not found: ${sourcePath}`);
  }
  if (statSync(sourcePath).size > 2_000_000) {
    throw new Error(`source file too large: ${sourcePath}`);
  }

  const target = join(dirname(manifestPath), CASE_EXECUTABLE_FILENAME);
  if (!existsSync(target)) copyFileSync(String(source), target);
  const lines = loadSourceLines(target);

  const entities = asObjects(manifest.entities);
  const actions = asObjects(manifest.actions);
  const allItems: Array<["entity" | "action", JsonObject]> = [];
  for (const e of entities) {
    if (e.targetLocation) allItems.push(["entity", e]);
  }
  for (const a of actions) {
    if (a.targetLocation) allItems.push(["action", a]);
  }
  allItems.sort((a, b) => {
    const kindCmp = Number(a[0] !== "entity") - Number(b[0] !== "entity");
    if (kindCmp !== 0) return kindCmp;
    return String(a[1].targetLocation || "").localeCompare(String(b[1].targetLocation || ""));
  });

  let done = 0;
  let skipped = 0;
  for (const [, obj] of allItems) {
    if (obj.writeStatus === "done") continue;
    const rp = obj.renderPreview;
    if (!rp) {
      obj.writeStatus = "skipped";
      if (!("failReason" in obj)) obj.failReason = "no renderPreview";
      skipped += 1;
      continue;
    }
    try {
      const loc = parseLocation(String(obj.targetLocation));
      applySlot(lines, loc, String(rp));
      obj.writeStatus = "done";
      done += 1;
    } catch (e) {
      obj.writeStatus = "skipped";
      obj.failReason = `render failed: ${e instanceof Error ? e.message : String(e)}`;
      skipped += 1;
    }
  }

  for (const e of entities) {
    if (e.targetLocation && e.writeStatus !== "done" && e.writeStatus !== "skipped") {
      e.writeStatus = "skipped";
      if (!("failReason" in e)) e.failReason = "no renderPreview";
      skipped += 1;
    }
  }
  for (const a of actions) {
    if (a.targetLocation && a.writeStatus !== "done" && a.writeStatus !== "skipped") {
      a.writeStatus = "skipped";
      if (!("failReason" in a)) a.failReason = "no renderPreview";
      skipped += 1;
    }
  }

  saveLines(target, lines);
  const pipelines = manifest.pipelines && typeof manifest.pipelines === "object" && !Array.isArray(manifest.pipelines)
    ? (manifest.pipelines as JsonObject)
    : ((manifest.pipelines = {}) as JsonObject);
  const wb = pipelines.writeback && typeof pipelines.writeback === "object" && !Array.isArray(pipelines.writeback)
    ? (pipelines.writeback as JsonObject)
    : ((pipelines.writeback = {}) as JsonObject);
  wb.status = "done";
  return { target, done, skipped };
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      "preview-only": { type: "boolean", default: false },
      commit: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node slot_render.ts --manifest <path> (--preview-only | --commit)

Render entity/action targetLocation slots and write back case-executable.md.

Options:
  --manifest <path>   Manifest JSON (required)
  --preview-only      Write renderPreview fields only (mutually exclusive with --commit)
  --commit            Write case-executable.md (mutually exclusive with --preview-only)
  -h, --help          Show this help and exit

Examples:
  node slot_render.ts --manifest ./testdata/case-materials/case-1/manifest.json --preview-only
  node slot_render.ts --manifest ./testdata/case-materials/case-1/manifest.json --commit
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }
  if (!values["preview-only"] && !values.commit) {
    process.stderr.write("ERROR: one of --preview-only or --commit is required\n");
    return 2;
  }
  if (values["preview-only"] && values.commit) {
    process.stderr.write("ERROR: --preview-only and --commit are mutually exclusive\n");
    return 2;
  }

  let manifest: JsonObject;
  try {
    manifest = loadManifest(values.manifest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`ERROR: manifest not found: ${values.manifest}\n`);
      return 2;
    }
    throw err;
  }

  if (values["preview-only"]) {
    const result = preview(manifest);
    dumpManifest(values.manifest, manifest);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  const result = commit(manifest, values.manifest);
  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("slot_render.ts")) {
  process.exit(main());
}
