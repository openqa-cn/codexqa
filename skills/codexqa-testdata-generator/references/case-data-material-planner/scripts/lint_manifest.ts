#!/usr/bin/env node
/** lint-gate judgement script. */

import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { Json, JsonObject } from "../../../scripts/adapters/config.ts";

const POLICY: Record<string, { THRESH_DATA_CONF_MIN: number; THRESH_VERIFY_FAIL_RATIO: number; THRESH_MAX_ROUND: number }> = {
  "1.0.0": { THRESH_DATA_CONF_MIN: 0.5, THRESH_VERIFY_FAIL_RATIO: 0.3, THRESH_MAX_ROUND: 3 },
  "1.1.0": { THRESH_DATA_CONF_MIN: 0.5, THRESH_VERIFY_FAIL_RATIO: 0.3, THRESH_MAX_ROUND: 3 },
  "2.0.0": { THRESH_DATA_CONF_MIN: 0.6, THRESH_VERIFY_FAIL_RATIO: 0.3, THRESH_MAX_ROUND: 3 },
};

const VERIFY_UNREACHABLE_PREFIXES = [
  "验证工具不可达/不可用",
  "verify tool unreachable/unavailable",
] as const;
const REFILL_FAIL_PREFIXES = ["[exec-failed] input-list mismatch", "[exec-failed] unsafe value"] as const;
const EMPTY_FAILING = { entities: [] as string[], actions: [] as string[] };

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function ensureObj(parent: JsonObject, key: string): JsonObject {
  const cur = parent[key];
  if (cur && typeof cur === "object" && !Array.isArray(cur)) return cur as JsonObject;
  const obj: JsonObject = {};
  parent[key] = obj;
  return obj;
}

function ensureArr(parent: JsonObject, key: string): Json[] {
  const cur = parent[key];
  if (Array.isArray(cur)) return cur;
  const arr: Json[] = [];
  parent[key] = arr;
  return arr;
}

export function expandRescanEntities(entities: JsonObject[], seedIds: string[]): string[] {
  const byId = new Map<string, JsonObject>();
  for (const e of entities) {
    if (typeof e.entityId === "string") byId.set(e.entityId, e);
  }
  const rescanStatuses = new Set<unknown>([null, undefined, "failed", "missing-dependency"]);
  const result = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length) {
    const eid = queue.pop()!;
    const e = byId.get(eid);
    if (!e) continue;
    for (const dep of asObjects(e.dependencies)) {
      const depId = dep.entityId;
      if (typeof depId !== "string" || !depId || result.has(depId)) continue;
      const depE = byId.get(depId);
      if (depE && rescanStatuses.has(depE.entityStatus ?? null)) {
        result.add(depId);
        queue.push(depId);
      }
    }
  }
  return [...result].sort();
}

export function getPolicy(manifest: JsonObject): {
  THRESH_DATA_CONF_MIN: number;
  THRESH_VERIFY_FAIL_RATIO: number;
  THRESH_MAX_ROUND: number;
} {
  const version = String(manifest.policyVersion ?? "1.0.0");
  return POLICY[version] || POLICY["1.0.0"];
}

function detectIssues(manifest: JsonObject): JsonObject[] {
  const policy = getPolicy(manifest);
  const entities = asObjects(manifest.entities);
  const actions = asObjects(manifest.actions);
  const entityIds = new Set(
    entities.map((e) => e.entityId).filter((id): id is string => typeof id === "string"),
  );
  const actionById = new Map<string, JsonObject>();
  for (const a of actions) {
    if (typeof a.actionId === "string") actionById.set(a.actionId, a);
  }

  const details: JsonObject[] = [];

  const missingDepIds = entities
    .filter((e) => e.entityStatus === "missing-dependency")
    .map((e) => String(e.entityId ?? ""));
  if (missingDepIds.length) {
    for (const eid of expandRescanEntities(entities, missingDepIds)) {
      details.push({
        id: eid,
        type: "entity",
        reason: "missing-dependency (transitive rescan)",
        suggestedAction: "rerun-data-pipeline",
      });
    }
  }

  for (const a of actions) {
    const aid = a.actionId;
    let problem: string | null = null;
    for (const p of asObjects(a.paramsFromEntities)) {
      const src = p.sourceEntityId;
      if (src && !entityIds.has(String(src))) {
        problem = `dangling-entity(${src})`;
        break;
      }
    }
    if (!problem) {
      for (const p of asObjects(a.paramsFromPriorActions)) {
        const srcId = p.sourceActionId;
        const field = p.sourceOutputField;
        if (!srcId || !actionById.has(String(srcId))) {
          problem = `dangling-action(${srcId})`;
          break;
        }
        const srcAction = actionById.get(String(srcId))!;
        const srcStep = srcAction.stepIdx;
        const curStep = a.stepIdx;
        if (typeof srcStep === "number" && typeof curStep === "number" && srcStep >= curStep) {
          problem = `forward-ref(${srcId},step=${srcStep}>=cur=${curStep})`;
          break;
        }
        const outputs = asObject(srcAction.outputs);
        if (!field || !(String(field) in outputs)) {
          problem = `undeclared-output(${srcId}.${field})`;
          break;
        }
      }
    }
    if (problem) {
      details.push({
        id: aid as Json,
        type: "action",
        reason: `invalid ref: ${problem}`,
        suggestedAction: "rerun-action-pipeline",
      });
    }
  }

  const excludedStrategies = new Set(["config", "runtime"]);
  const threshConf = policy.THRESH_DATA_CONF_MIN;
  if (entities.length) {
    const scorable = entities.filter((e) => {
      if (excludedStrategies.has(String(e.constructionStrategy ?? ""))) return false;
      const toolType = String(asObject(e.toolBinding).toolType || "");
      return toolType !== "api-setup";
    });
    const confs = scorable.map((e) => e.dataConfidence).filter((v): v is number => typeof v === "number");
    if (confs.length && confs.reduce((a, b) => a + b, 0) / confs.length < threshConf) {
      for (const e of scorable) {
        const dc = e.dataConfidence;
        if (typeof dc === "number" && dc < threshConf) {
          details.push({
            id: e.entityId as Json,
            type: "entity",
            reason: `dataConfidence=${dc} < ${threshConf}`,
            suggestedAction: "rerun-data-pipeline",
          });
        }
      }
    }
    for (const e of entities) {
      if (asObject(e.toolBinding).toolStatus === "failed") {
        details.push({
          id: e.entityId as Json,
          type: "entity",
          reason: "toolStatus=failed",
          suggestedAction: "rerun-data-pipeline",
        });
      }
    }
  }
  for (const a of actions) {
    if (asObject(a.toolBinding).toolStatus === "failed") {
      details.push({
        id: a.actionId as Json,
        type: "action",
        reason: "toolStatus=failed",
        suggestedAction: "rerun-action-pipeline",
      });
    }
  }

  const badEntityStatuses = new Set<unknown>([null, undefined, "failed", "missing-dependency"]);
  for (const a of actions) {
    const cstat = a.cmdStatus;
    if (cstat === "missing-param") {
      let depsReady = true;
      for (const p of asObjects(a.paramsFromEntities)) {
        const srcId = p.sourceEntityId;
        const src = entities.find((e) => e.entityId === srcId);
        if (!src || badEntityStatuses.has(src.entityStatus ?? null)) {
          depsReady = false;
          break;
        }
      }
      if (depsReady) {
        details.push({
          id: a.actionId as Json,
          type: "action",
          reason: "cmdStatus=missing-param (deps ready)",
          suggestedAction: "rerun-action-pipeline",
        });
      }
    } else if (cstat === "gen-failed") {
      const reason = String(a.failReason ?? "");
      if (REFILL_FAIL_PREFIXES.some((p) => reason.startsWith(p))) {
        details.push({
          id: a.actionId as Json,
          type: "action",
          reason: `gen-failed (bind-fixable): ${reason.slice(0, 80)}`,
          suggestedAction: "rerun-action-pipeline",
        });
      }
    }
  }

  const threshRatio = policy.THRESH_VERIFY_FAIL_RATIO;
  if (actions.length) {
    const au = actions.filter(
      (a) =>
        typeof a.verifyNote === "string" &&
        VERIFY_UNREACHABLE_PREFIXES.some((p) => String(a.verifyNote).startsWith(p)),
    );
    if (au.length && au.length / actions.length > threshRatio) {
      for (const a of au) {
        details.push({
          id: a.actionId as Json,
          type: "action",
          reason: "verify unreachable",
          suggestedAction: "rerun-action-pipeline",
        });
      }
    }
  }

  for (const e of entities) {
    const tb = asObject(e.toolBinding);
    if (tb.toolStatus === "available" && (e.entityStatus === null || e.entityStatus === undefined)) {
      details.push({
        id: e.entityId as Json,
        type: "entity",
        reason: "incomplete-pipeline: toolStatus=available but entityStatus=null (invoke skipped)",
        suggestedAction: "rerun-data-pipeline",
      });
    }
  }

  const seen = new Set<unknown>();
  const deduped: JsonObject[] = [];
  for (const d of details) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      deduped.push(d);
    }
  }
  return deduped;
}

function buildFailingIds(details: JsonObject[]): { entities: string[]; actions: string[] } {
  const entities = [...new Set(details.filter((d) => d.type === "entity").map((d) => String(d.id)))].sort();
  const actions = [...new Set(details.filter((d) => d.type === "action").map((d) => String(d.id)))].sort();
  return { entities, actions };
}

export function judge(manifest: JsonObject): {
  verdict: string;
  reason: string;
  failingIds: { entities: string[]; actions: string[] };
  details: JsonObject[];
} {
  const gate = asObject(asObject(manifest.pipelines)["lint-gate"]);
  const currentRound = typeof gate.round === "number" ? gate.round : 0;
  const policy = getPolicy(manifest);
  const threshMax = policy.THRESH_MAX_ROUND;
  const details = detectIssues(manifest);

  if (details.length) {
    return {
      verdict: "FAIL",
      reason: `${details.length} issue(s) detected`,
      failingIds: buildFailingIds(details),
      details,
    };
  }
  if (currentRound >= threshMax) {
    return {
      verdict: "ROUND_EXCEEDED",
      reason: `round ${currentRound} reached THRESH_MAX_ROUND=${threshMax}; no issues detected but max rounds reached`,
      failingIds: { entities: [...EMPTY_FAILING.entities], actions: [...EMPTY_FAILING.actions] },
      details: [],
    };
  }
  return {
    verdict: "PASS",
    reason: "all checks passed",
    failingIds: { entities: [...EMPTY_FAILING.entities], actions: [...EMPTY_FAILING.actions] },
    details: [],
  };
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      "write-back": { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node lint_manifest.ts --manifest <path> [--write-back]

Judge a case-materials manifest (lint-gate).

Options:
  --manifest <path>   Manifest JSON (required)
  --write-back        Persist verdict into the manifest pipelines.lint-gate
  -h, --help          Show this help and exit

Example:
  node lint_manifest.ts --manifest ./testdata/case-materials/case-1/manifest.json --write-back
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }

  let manifest: JsonObject;
  try {
    manifest = loadManifest(values.manifest);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT" || code === "EINVAL" || code === "EFBIG") {
      process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    throw err;
  }

  const { verdict, reason, failingIds, details } = judge(manifest);

  if (values["write-back"]) {
    const pipelines = ensureObj(manifest, "pipelines");
    const gate = ensureObj(pipelines, "lint-gate");
    gate.round = (typeof gate.round === "number" ? gate.round : 0) + 1;
    gate.verdict = verdict;
    gate.failingIds = failingIds;
    gate.details = details;
    gate.status = "done";
    ensureArr(manifest, "lintRounds").push({
      round: gate.round,
      verdict,
      reason,
      failingIds,
      details,
      timestamp: new Date().toISOString(),
    });
    dumpManifest(values.manifest, manifest);
  }

  process.stdout.write(`${JSON.stringify({ verdict, reason, failingIds, details })}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("lint_manifest.ts")) {
  process.exit(main());
}
