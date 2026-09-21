/** Load executor bind rules from discovered domain slots. */

import { join } from "node:path";
import { listSlotDirs, loadSlotManifest, type SlotItem } from "../../../scripts/adapters/slot_roots.ts";
import { resolvePackRoot, type JsonObject } from "../../../scripts/adapters/config.ts";

export type SlotEntityRule = {
  skill: string;
  skillPath: string;
  id: string;
  script: string;
  types: string[];
  test: (text: string) => boolean;
  invokeKeys: string[];
};

export type SlotActionRule = {
  skill: string;
  skillPath: string;
  id: string;
  script: string;
  params: string[];
  test: (text: string) => boolean;
};

function compileTest(parts: string[]): (text: string) => boolean {
  const uniq = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  if (!uniq.length) return () => false;
  const escaped = uniq.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(escaped, "i");
  return (text: string) => re.test(text);
}

function toEntity(skill: string, skillPath: string, item: SlotItem): SlotEntityRule {
  const types = item.aliases.length ? item.aliases : [item.id];
  return {
    skill,
    skillPath,
    id: item.id,
    script: item.executor,
    types,
    test: compileTest(types),
    invokeKeys: item.invokeParams.length ? item.invokeParams : item.params.length ? item.params : ["name"],
  };
}

function toAction(skill: string, skillPath: string, item: SlotItem): SlotActionRule {
  const types = item.aliases.length ? item.aliases : [item.id];
  return {
    skill,
    skillPath,
    id: item.id,
    script: item.executor,
    params: item.params,
    test: compileTest(types),
  };
}

export function listSlotDirsFromCatalog(): string[] {
  return listSlotDirs();
}

export function loadSlotExecutorRules(): { entities: SlotEntityRule[]; actions: SlotActionRule[] } {
  const entities: SlotEntityRule[] = [];
  const actions: SlotActionRule[] = [];
  for (const dir of listSlotDirs()) {
    const manifest = loadSlotManifest(dir);
    for (const item of manifest.entities) entities.push(toEntity(manifest.name, dir, item));
    for (const item of manifest.actions) actions.push(toAction(manifest.name, dir, item));
  }
  return { entities, actions };
}

export function packSlotPath(skill: string, script: string): string {
  return join(resolvePackRoot(), "slots", skill, script);
}

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}
