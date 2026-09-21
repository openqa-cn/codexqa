#!/usr/bin/env node
/** Code orchestrator for case-data-material-planner. LLM is only used for parse / knowledge-build / select-tool. */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { JsonObject } from "../../../scripts/adapters/config.ts";
import { bindAction } from "./bind_action.ts";
import { computeCaseConfidence } from "./finalize.ts";
import { processManifest as generateConfig } from "./generate_config_commands.ts";
import { defaultMaterialsRoot, initManifest } from "./init_manifest.ts";
import { invokeEntity } from "./invoke_entity.ts";
import { judge } from "./lint_manifest.ts";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import { InputError, loadJsonObjectFile } from "./safe_io.ts";
import { EXIT_NEED_LLM, selectTool } from "./select_tool.ts";
import { commit, preview } from "./slot_render.ts";

export const EXIT_NEED_PARSE = 11;
export const EXIT_NEED_KNOWLEDGE = 12;
export const EXIT_LINT_C3 = 20;

const HERE = dirname(fileURLToPath(import.meta.url));

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

function pipe(manifest: JsonObject, name: string): JsonObject {
  const pipelines = asObject(manifest.pipelines);
  if (!manifest.pipelines || typeof manifest.pipelines !== "object" || Array.isArray(manifest.pipelines)) {
    manifest.pipelines = pipelines;
  }
  const cur = asObject(pipelines[name]);
  (manifest.pipelines as JsonObject)[name] = cur;
  return cur;
}

function emitNeed(need: string, extra: JsonObject, code: number): number {
  process.stdout.write(`${JSON.stringify({ need, ...extra })}\n`);
  return code;
}

function parseDone(manifest: JsonObject): boolean {
  const status = String(pipe(manifest, "parse").status || "");
  if (status === "done") return true;
  return asObjects(manifest.entities).length + asObjects(manifest.actions).length > 0;
}

function hasKnowledgeInputs(manifest: JsonObject): boolean {
  const ki = asObject(manifest.knowledgeInputs);
  return Boolean(ki.prdSource || ki.techDesignSource || ki.testPlanId);
}

function runTopo(manifestPath: string, cachePath: string | null): void {
  const args = [join(HERE, "topo_sort_batch.ts"), "--manifest", manifestPath, "--with-sessions"];
  if (cachePath) args.push("--cache", cachePath);
  try {
    execFileSync(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });
  } catch (err) {
    throw new InputError(`topo_sort_batch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export type PipelineOptions = {
  caseId?: string;
  source?: string;
  sourceType?: string;
  manifestPath?: string;
  contextPath?: string | null;
  cachePath?: string | null;
  materialsRoot?: string;
  scope?: string;
  resume?: boolean;
  prdSource?: string | null;
  techDesignSource?: string | null;
  testPlanId?: string | null;
};

export async function runPipeline(opts: PipelineOptions): Promise<number> {
  const scope = opts.scope || "full";
  let manifestPath = opts.manifestPath || "";
  const knowledgeOnly = Boolean(opts.prdSource || opts.techDesignSource || opts.testPlanId);
  if (!manifestPath) {
    if (!opts.caseId || (!opts.source && !knowledgeOnly)) {
      process.stderr.write("ERROR: --manifest or (--case-id and --source) is required\n");
      return 2;
    }
    const inited = initManifest({
      caseId: opts.caseId,
      sourcePath: opts.source || "",
      sourceType: opts.sourceType,
      materialsRoot: opts.materialsRoot,
      contextPath: opts.contextPath,
      allowMissingSource: !opts.source && knowledgeOnly,
    });
    manifestPath = inited.manifestPath;
  }

  let manifest = loadManifest(manifestPath);
  if (opts.source) {
    const cs = asObject(manifest.caseSource);
    manifest.caseSource = cs;
    if (!existsSync(opts.source)) {
      process.stderr.write(`ERROR: source not found: ${opts.source}\n`);
      return 2;
    }
    cs.original = opts.source;
    cs.type = opts.sourceType || (cs.type && cs.type !== "pending" ? String(cs.type) : "local-file");
  }
  if (opts.contextPath) manifest.businessContext = opts.contextPath;
  const knowledgeInputs = asObject(manifest.knowledgeInputs);
  if (opts.prdSource) knowledgeInputs.prdSource = opts.prdSource;
  if (opts.techDesignSource) knowledgeInputs.techDesignSource = opts.techDesignSource;
  if (opts.testPlanId) knowledgeInputs.testPlanId = opts.testPlanId;
  if (opts.prdSource || opts.techDesignSource || opts.testPlanId) manifest.knowledgeInputs = knowledgeInputs;
  const cachePath = opts.cachePath || null;
  const contextPath = opts.contextPath || (typeof manifest.businessContext === "string" ? manifest.businessContext : null);

  if (scope === "writeback-only") {
    return runWriteback(manifest, manifestPath);
  }

  if (scope === "execution" && !parseDone(manifest)) {
    pipe(manifest, "parse").status = "waiting-llm";
    dumpManifest(manifestPath, manifest);
    return emitNeed("parse-case", {
      manifest: manifestPath,
      sourceDoc: asObject(manifest.caseSource).original || opts.source || null,
    }, EXIT_NEED_PARSE);
  }

  if (scope !== "execution") {
    const kb = pipe(manifest, "knowledge-build");
    if (hasKnowledgeInputs(manifest)) {
      if (kb.status !== "done") {
        if (!contextPath || !existsSync(contextPath)) {
          kb.status = "waiting-llm";
          dumpManifest(manifestPath, manifest);
          return emitNeed("knowledge-build", { manifest: manifestPath }, EXIT_NEED_KNOWLEDGE);
        }
        kb.status = "done";
      }
    } else if (kb.status !== "done") {
      kb.status = "skipped";
    }

    if (!parseDone(manifest)) {
      const sourceDoc = String(asObject(manifest.caseSource).original || opts.source || "");
      if (!sourceDoc || !existsSync(sourceDoc)) {
        dumpManifest(manifestPath, manifest);
        process.stdout.write(`${JSON.stringify({ ok: true, waiting: "cases", manifest: manifestPath })}\n`);
        return 0;
      }
      pipe(manifest, "parse").status = "waiting-llm";
      dumpManifest(manifestPath, manifest);
      return emitNeed("parse-case", {
        manifest: manifestPath,
        sourceDoc,
      }, EXIT_NEED_PARSE);
    }
    pipe(manifest, "parse").status = "done";
    dumpManifest(manifestPath, manifest);
    if (scope === "parse-only") {
      process.stdout.write(`${JSON.stringify({ ok: true, stage: "parse", manifest: manifestPath })}\n`);
      return 0;
    }
  }

  manifest = loadManifest(manifestPath);
  const pre = pipe(manifest, "preprocess");
  if (pre.status !== "done") {
    pre.status = "running";
    if (contextPath && existsSync(contextPath)) {
      try {
        const ctx = loadJsonObjectFile(contextPath, "business-context");
        generateConfig(manifest, asObject(ctx.configMap));
      } catch (err) {
        process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
        throw err instanceof InputError ? err : new InputError(String(err));
      }
    }
    dumpManifest(manifestPath, manifest);
    runTopo(manifestPath, cachePath);
    manifest = loadManifest(manifestPath);
    pipe(manifest, "preprocess").status = "done";
    dumpManifest(manifestPath, manifest);
  }

  if (scope === "full" || scope === "execution") {
    const dataCode = await runDataTrack(manifest, manifestPath, cachePath, contextPath);
    if (dataCode !== 0) return dataCode;
    manifest = loadManifest(manifestPath);
    const actionCode = await runActionTrack(manifest, manifestPath, cachePath, contextPath);
    if (actionCode !== 0) return actionCode;
    manifest = loadManifest(manifestPath);
    const lintCode = runLint(manifest, manifestPath);
    if (lintCode !== 0) return lintCode;
    manifest = loadManifest(manifestPath);
    return runWriteback(manifest, manifestPath);
  }

  process.stdout.write(`${JSON.stringify({ ok: true, manifest: manifestPath })}\n`);
  return 0;
}

async function runDataTrack(
  manifest: JsonObject,
  manifestPath: string,
  cachePath: string | null,
  contextPath: string | null,
): Promise<number> {
  const track = pipe(manifest, "data-track");
  if (track.status === "done") return 0;
  track.status = "running";
  const entities = asObjects(manifest.entities).filter((e) => e.constructionStrategy === "tool-build");
  entities.sort((a, b) => {
    const left = Number(a.executionBatch);
    const right = Number(b.executionBatch);
    return (Number.isFinite(left) ? left : 1) - (Number.isFinite(right) ? right : 1);
  });
  for (const entity of entities) {
    const id = String(entity.entityId || "");
    if (!id) {
      process.stderr.write("ERROR: tool-build entity missing entityId\n");
      return 1;
    }
    const selected = await selectTool(manifest, "entity", id, cachePath, contextPath);
    dumpManifest(manifestPath, manifest);
    if (selected.needLlm) {
      return emitNeed("select-tool", { manifest: manifestPath, targetType: "entity", targetId: id, candidates: selected.candidates || null }, EXIT_NEED_LLM);
    }
    if (!selected.bound) {
      process.stderr.write(`ERROR: could not bind entity ${id}\n`);
      return 1;
    }
    const result = await invokeEntity(manifest, id);
    dumpManifest(manifestPath, manifest);
    if (result.entityStatus === "failed" || result.entityStatus === "missing-dependency") {
      process.stderr.write(`ERROR: invoke ${id}: ${result.failReason}\n`);
      return 1;
    }
  }
  pipe(manifest, "data-track").status = "done";
  pipe(manifest, "data-track").phase = "done";
  dumpManifest(manifestPath, manifest);
  return 0;
}

async function runActionTrack(
  manifest: JsonObject,
  manifestPath: string,
  cachePath: string | null,
  contextPath: string | null,
): Promise<number> {
  const track = pipe(manifest, "action-track");
  if (track.status === "done") return 0;
  track.status = "running";
  const actions = asObjects(manifest.actions);
  for (const action of actions) {
    const id = String(action.actionId || "");
    if (!id) {
      process.stderr.write("ERROR: action missing actionId\n");
      return 1;
    }
    const selected = await selectTool(manifest, "action", id, cachePath, contextPath);
    dumpManifest(manifestPath, manifest);
    if (selected.needLlm) {
      return emitNeed("select-tool", { manifest: manifestPath, targetType: "action", targetId: id, candidates: selected.candidates || null }, EXIT_NEED_LLM);
    }
    if (!selected.bound) {
      process.stderr.write(`ERROR: could not bind action ${id}\n`);
      return 1;
    }
    const result = bindAction(manifest, id);
    dumpManifest(manifestPath, manifest);
    if (result.cmdStatus !== "filled") {
      process.stderr.write(`ERROR: bind ${id}: ${result.failReason}\n`);
      return 1;
    }
  }
  pipe(manifest, "action-track").status = "done";
  pipe(manifest, "action-track").phase = "done";
  dumpManifest(manifestPath, manifest);
  return 0;
}

function runLint(manifest: JsonObject, manifestPath: string): number {
  const { verdict, reason, failingIds, details } = judge(manifest);
  const gate = pipe(manifest, "lint-gate");
  gate.round = (typeof gate.round === "number" ? gate.round : 0) + 1;
  gate.verdict = verdict;
  gate.failingIds = failingIds;
  gate.details = details;
  gate.status = "done";
  const rounds = Array.isArray(manifest.lintRounds) ? manifest.lintRounds : [];
  rounds.push({
    round: gate.round,
    verdict,
    reason,
    failingIds,
    details,
    timestamp: new Date().toISOString(),
  } as never);
  manifest.lintRounds = rounds;
  dumpManifest(manifestPath, manifest);
  if (verdict === "FAIL" || verdict === "ROUND_EXCEEDED") {
    return emitNeed("c3", { manifest: manifestPath, verdict, reason, failingIds, details }, EXIT_LINT_C3);
  }
  return 0;
}

function runWriteback(manifest: JsonObject, manifestPath: string): number {
  preview(manifest);
  dumpManifest(manifestPath, manifest);
  let result: ReturnType<typeof commit>;
  try {
    result = commit(manifest, manifestPath);
  } catch (err) {
    process.stderr.write(`ERROR: writeback failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  manifest.caseConfidence = computeCaseConfidence(manifest);
  manifest.generatedAt = new Date().toISOString();
  pipe(manifest, "writeback").status = "done";
  dumpManifest(manifestPath, manifest);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      stage: "writeback",
      manifest: manifestPath,
      caseExecutable: result.target,
      caseConfidence: manifest.caseConfidence,
      generatedAt: manifest.generatedAt,
      done: result.done,
      skipped: result.skipped,
    })}\n`,
  );
  return 0;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      "case-id": { type: "string" },
      source: { type: "string" },
      "source-type": { type: "string" },
      manifest: { type: "string" },
      context: { type: "string" },
      cache: { type: "string" },
      prd: { type: "string" },
      "tech-design": { type: "string" },
      "test-plan-id": { type: "string" },
      "materials-root": { type: "string" },
      scope: { type: "string", default: "full" },
      resume: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node pipeline.ts (--case-id <id> --source <path> | --case-id <id> --prd <path> | --manifest <path>) [options]

Code orchestrator. LLM is used only for parse-case, knowledge-build, and select-tool.

Options:
  --case-id <id>          Case id (with --source, or Path A --prd before cases arrive)
  --source <path>         Original case document (can attach later on --resume)
  --manifest <path>       Existing manifest (implies resume)
  --context <path>        business-context.json
  --prd <path>            Path A requirement doc (sets knowledgeInputs.prdSource)
  --tech-design <path>    Path A tech design
  --test-plan-id <id>     Path A plan id
  --cache <path>          tool-binding-cache.json
  --materials-root <dir>  Default ./testdata/case-materials
  --scope full|parse-only|execution|writeback-only
  --resume                Continue from pipelines.* checkpoint
  -h, --help              Show this help and exit

Exit codes:
  0   success or checkpoint written
  10  need LLM select-tool
  11  need LLM parse-case
  12  need LLM knowledge-build
  20  lint-gate C3 (FAIL / ROUND_EXCEEDED)
  2   bad args

Example:
  node pipeline.ts --case-id case-1 --source ./case-original.md
  node pipeline.ts --manifest ./testdata/case-materials/case-1/manifest.json --resume
`);
    return 0;
  }
  const scope = values.scope || "full";
  if (!["full", "parse-only", "execution", "writeback-only"].includes(scope)) {
    process.stderr.write("ERROR: --scope must be full|parse-only|execution|writeback-only\n");
    return 2;
  }
  try {
    return await runPipeline({
      caseId: values["case-id"],
      source: values.source,
      sourceType: values["source-type"],
      manifestPath: values.manifest,
      contextPath: values.context || null,
      cachePath: values.cache || null,
      prdSource: values.prd || null,
      techDesignSource: values["tech-design"] || null,
      testPlanId: values["test-plan-id"] || null,
      materialsRoot: values["materials-root"] || defaultMaterialsRoot(),
      scope,
      resume: Boolean(values.resume || values.manifest),
    });
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    return err instanceof InputError ? 2 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("pipeline.ts")) {
  process.exit(await main());
}
