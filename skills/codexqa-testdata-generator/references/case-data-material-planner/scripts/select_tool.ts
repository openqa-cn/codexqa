#!/usr/bin/env node
/** Fast-path tool binding. Exit 10 when an LLM select-tool Agent is required. */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolvePackRoot, type Json, type JsonObject } from "../../../scripts/adapters/config.ts";
import { loadCache, loadContext, lookupAction, lookupEntity } from "./cache_tool_binding.ts";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import { runParallelSearch } from "./parallel_search.ts";
import { loadSlotExecutorRules, type SlotActionRule, type SlotEntityRule } from "./slot_catalog.ts";

export const EXIT_NEED_LLM = 10;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

export type SelectResult = {
  targetType: "entity" | "action";
  targetId: string;
  bound: boolean;
  needLlm: boolean;
  toolBinding: JsonObject | null;
  candidates?: Json;
};

function alreadyBound(binding: JsonObject, kind: "entity" | "action"): boolean {
  if (binding.toolType === "reuse" || binding.toolType === "api-setup") return true;
  if (binding.toolStatus !== "available") return false;
  if (kind === "entity") return Boolean(binding.invokeCmd);
  return Boolean(binding.cmdTemplate);
}

function applyBinding(target: JsonObject, binding: JsonObject): void {
  target.toolBinding = binding;
}

function textOf(obj: JsonObject, kind: "entity" | "action"): string {
  if (kind === "entity") {
    return `${obj.entityType || ""} ${obj.constraints || ""} ${asObject(obj.queries).angleA || ""} ${asObject(obj.queries).angleB || ""}`;
  }
  return `${obj.actionDesc || ""} ${asObject(obj.queries).angleA || ""} ${asObject(obj.queries).angleB || ""}`;
}

function keywordsOf(text: string): string[] {
  const words = text.match(/[A-Za-z\u4e00-\u9fff]{2,}/g) || [];
  const picked = words.filter((w) => !/^(create|using|with|from|that|this|测试|使用|创建)$/i.test(w));
  return [...new Set(picked)].slice(0, 2);
}

function executorExists(skill: string, script: string, skillPath?: string): boolean {
  if (skillPath && existsSync(join(skillPath, script))) return true;
  return existsSync(join(resolvePackRoot(), "slots", skill, script));
}

function entityInvokeCmd(script: string, keys: string[] = ["name"]): string {
  const body = keys.map((key) => `"${key}":"\${${key}}"`).join(",");
  return `node ${script} --json '{${body}}'`;
}

function typeAffinity(types: string[] | undefined, entityType: string): number {
  if (!entityType) return 0;
  const et = entityType.toLowerCase();
  const normalized = (types || []).map((t) => t.toLowerCase()).filter(Boolean);
  if (normalized.some((t) => t === et)) return 2;
  if (normalized.some((t) => et.includes(t) || t.includes(et))) return 1;
  return 0;
}

function mergedEntityRules(): Array<SlotEntityRule & { types?: string[] }> {
  return loadSlotExecutorRules().entities;
}

function mergedActionRules(): SlotActionRule[] {
  return loadSlotExecutorRules().actions;
}

function actionCmdTemplate(script: string, params: string[]): string {
  const body = params.map((p) => `"${p}":"__${p}__"`).join(",");
  return `node ${script} --json '{${body}}'`;
}

function skillNames(search: JsonObject): string[] {
  const skill = asObject(search.skill);
  const names = [
    ...asObjects(search.pinned).map((s) => String(s.name || "")),
    ...asObjects(skill.skills).map((s) => String(s.name || "")),
  ]
    .map((n) => n.toLowerCase())
    .filter(Boolean);
  return [...new Set(names)];
}

export async function selectTool(
  manifest: JsonObject,
  targetType: "entity" | "action",
  targetId: string,
  cachePath: string | null,
  contextPath: string | null,
): Promise<SelectResult> {
  const list = targetType === "entity" ? asObjects(manifest.entities) : asObjects(manifest.actions);
  const idField = targetType === "entity" ? "entityId" : "actionId";
  const target = list.find((row) => row[idField] === targetId);
  if (!target) {
    return { targetType, targetId, bound: false, needLlm: false, toolBinding: null };
  }
  const current = asObject(target.toolBinding);
  if (alreadyBound(current, targetType)) {
    if ((current.toolType === "reuse" || current.toolType === "api-setup") && current.toolStatus !== "available") {
      current.toolStatus = "available";
      applyBinding(target, current);
    }
    return { targetType, targetId, bound: true, needLlm: false, toolBinding: current };
  }

  if (cachePath && existsSync(cachePath)) {
    const cache = loadCache(cachePath);
    const context = contextPath && existsSync(contextPath) ? loadContext(contextPath) : {};
    const key = targetType === "entity"
      ? `${String(target.entityType || "")}::create`
      : String(target.actionDesc || targetId);
    const hit = targetType === "entity" ? lookupEntity(key, cache, context) : lookupAction(key, cache, context);
    if (hit.hit === true && (hit.status === "proven" || hit.status === "candidate") && hit.toolBinding) {
      const binding = asObject(hit.toolBinding);
      const proven = asObject(hit.provenInvocation);
      if (targetType === "entity" && proven.invokeCmdTemplate && !binding.invokeCmd) {
        binding.invokeCmd = proven.invokeCmdTemplate;
      }
      if (targetType === "action" && (proven.filledCmdTemplate || binding.cmdTemplate)) {
        binding.cmdTemplate = String(binding.cmdTemplate || proven.filledCmdTemplate || "");
      }
      if (binding.toolStatus !== "available") binding.toolStatus = "available";
      if (alreadyBound(binding, targetType) || binding.toolType === "skill" || binding.toolType === "tool") {
        applyBinding(target, binding);
        return { targetType, targetId, bound: true, needLlm: false, toolBinding: binding };
      }
    }
  }

  const blob = textOf(target, targetType);
  const queries = [String(asObject(target.queries).angleA || blob), String(asObject(target.queries).angleB || blob)].filter(
    (q) => q.trim(),
  );
  const search = await runParallelSearch(queries, keywordsOf(blob));
  const names = skillNames(search);

  const entityType = String(target.entityType || "").toLowerCase();
  if (targetType === "entity") {
    const entityRules = mergedEntityRules();
    let owner: (typeof entityRules)[number] | undefined;
    let ownerScore = 0;
    for (const rule of entityRules) {
      const score = typeAffinity(rule.types, entityType);
      if (score > ownerScore) {
        owner = rule;
        ownerScore = score;
      }
    }
    for (const rule of entityRules) {
      const typeHit = typeAffinity(rule.types, entityType) > 0;
      if (!typeHit && !rule.test(blob)) continue;
      if (owner && owner !== rule && entityRules.indexOf(rule) > entityRules.indexOf(owner)) continue;
      if (names.length && !names.includes(rule.skill)) continue;
      if (!executorExists(rule.skill, rule.script, rule.skillPath)) continue;
      const binding: JsonObject = {
        toolType: "skill",
        resourceId: rule.skill,
        skillRoot: rule.skillPath || null,
        invokeCmd: entityInvokeCmd(rule.script, rule.invokeKeys),
        toolStatus: "available",
      };
      applyBinding(target, binding);
      return { targetType, targetId, bound: true, needLlm: false, toolBinding: binding };
    }
  } else {
    for (const rule of mergedActionRules()) {
      if (!rule.test(blob)) continue;
      if (names.length && !names.includes(rule.skill)) continue;
      if (!executorExists(rule.skill, rule.script, rule.skillPath)) continue;
      const binding: JsonObject = {
        toolType: "skill",
        resourceId: rule.skill,
        skillRoot: rule.skillPath || null,
        cmdTemplate: actionCmdTemplate(rule.script, rule.params),
        toolStatus: "available",
      };
      applyBinding(target, binding);
      return { targetType, targetId, bound: true, needLlm: false, toolBinding: binding };
    }
  }

  const tools = asObjects(asObject(search.tools).results);
  if (tools.length === 1) {
    const tool = tools[0];
    const resourceId = String(tool.resourceId || tool.id || tool.name || "");
    if (resourceId) {
      const binding: JsonObject = {
        toolType: "tool",
        resourceId,
        skillRoot: null,
        invokeCmd: null,
        cmdTemplate: null,
        toolStatus: "available",
      };
      if (targetType === "action") {
        return {
          targetType,
          targetId,
          bound: false,
          needLlm: true,
          toolBinding: binding,
          candidates: search,
        };
      }
      applyBinding(target, binding);
      return { targetType, targetId, bound: true, needLlm: false, toolBinding: binding };
    }
  }

  return { targetType, targetId, bound: false, needLlm: true, toolBinding: null, candidates: search };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      type: { type: "string" },
      id: { type: "string" },
      cache: { type: "string" },
      context: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node select_tool.ts --manifest <path> --type entity|action --id <id> [options]

Bind a tool from cache or a unique slot-executor hit. Exit 10 when an LLM select-tool Agent is required.

Options:
  --manifest <path>   Manifest JSON (required)
  --type entity|action
  --id <id>           entityId or actionId
  --cache <path>      Optional tool-binding cache
  --context <path>    Optional business-context.json
  -h, --help          Show this help and exit

Example:
  node select_tool.ts --manifest ./testdata/case-materials/case-1/manifest.json --type entity --id E01
`);
    return 0;
  }
  if (!values.manifest || !values.type || !values.id) {
    process.stderr.write("ERROR: --manifest, --type and --id are required\n");
    return 2;
  }
  if (values.type !== "entity" && values.type !== "action") {
    process.stderr.write("ERROR: --type must be entity or action\n");
    return 2;
  }
  const manifest = loadManifest(values.manifest);
  const result = await selectTool(manifest, values.type, values.id, values.cache || null, values.context || null);
  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.needLlm) return EXIT_NEED_LLM;
  return result.bound ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("select_tool.ts")) {
  process.exit(await main());
}
