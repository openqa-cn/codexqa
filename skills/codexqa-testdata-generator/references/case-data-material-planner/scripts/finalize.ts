#!/usr/bin/env node
/** finalize: mark the manifest complete and compute caseConfidence. */

import { parseArgs } from "node:util";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

const POLICY: Record<string, { w_data: number; w_action: number; force_pass_discount: number }> = {
  "1.0.0": { w_data: 0.6, w_action: 0.4, force_pass_discount: 0.8 },
  "1.1.0": { w_data: 0.6, w_action: 0.4, force_pass_discount: 0.8 },
  "2.0.0": { w_data: 0.6, w_action: 0.4, force_pass_discount: 0.8 },
};

export function avg(values: unknown[]): number {
  const clean = values.filter((v) => typeof v === "number") as number[];
  if (!clean.length) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export function computeCaseConfidence(manifest: JsonObject): number {
  const version = String(manifest.policyVersion || "1.0.0");
  const policy = POLICY[version] || POLICY["1.0.0"];
  const entities = (Array.isArray(manifest.entities) ? manifest.entities : []) as JsonObject[];
  const actions = (Array.isArray(manifest.actions) ? manifest.actions : []) as JsonObject[];
  const excluded = new Set(["config", "runtime"]);
  const scorable = entities.filter((e) => !excluded.has(String(e.constructionStrategy || "")));
  const dataAvg = scorable.length ? avg(scorable.map((e) => e.dataConfidence)) : null;
  const cmdAvg = actions.length ? avg(actions.map((a) => a.cmdConfidence)) : null;
  let score: number;
  if (dataAvg === null && cmdAvg === null) return 0;
  if (dataAvg === null) score = cmdAvg as number;
  else if (cmdAvg === null) score = dataAvg;
  else score = policy.w_data * dataAvg + policy.w_action * cmdAvg;
  const forcePass = ((Array.isArray(manifest.confirmations) ? manifest.confirmations : []) as JsonObject[]).some(
    (c) => c.decision === "force-pass",
  );
  if (forcePass) score *= policy.force_pass_discount;
  return Math.round(score * 10000) / 10000;
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node finalize.ts --manifest <path>

Mark the manifest complete and compute caseConfidence.

Options:
  --manifest <path>   Manifest JSON (required)
  -h, --help          Show this help and exit

Example:
  node finalize.ts --manifest ./testdata/case-materials/case-1/manifest.json
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("--manifest is required\n");
    return 2;
  }
  const manifest = loadManifest(values.manifest);
  manifest.caseConfidence = computeCaseConfidence(manifest);
  manifest.generatedAt = new Date().toISOString();
  const pipelines = (manifest.pipelines && typeof manifest.pipelines === "object"
    ? manifest.pipelines
    : (manifest.pipelines = {})) as JsonObject;
  const wb = (pipelines.writeback && typeof pipelines.writeback === "object"
    ? pipelines.writeback
    : (pipelines.writeback = {})) as JsonObject;
  if (wb.status !== "done") wb.status = "done";
  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify({ caseConfidence: manifest.caseConfidence, generatedAt: manifest.generatedAt })}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("finalize.ts")) {
  process.exit(main());
}
