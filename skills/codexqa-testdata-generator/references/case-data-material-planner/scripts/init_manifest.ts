#!/usr/bin/env node
/** Copy the manifest template into a case-materials directory. */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { JsonObject } from "../../../scripts/adapters/config.ts";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import { InputError, assertSafeCaseId } from "./safe_io.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "..", "templates", "manifest-template.json");

export function defaultMaterialsRoot(cwd = process.cwd()): string {
  return join(cwd, "testdata", "case-materials");
}

export function initManifest(opts: {
  caseId: string;
  sourcePath: string;
  sourceType?: string;
  materialsRoot?: string;
  contextPath?: string | null;
  allowMissingSource?: boolean;
}): { manifestPath: string; created: boolean } {
  const caseId = assertSafeCaseId(opts.caseId);
  if (opts.sourcePath) {
    if (!existsSync(opts.sourcePath)) {
      throw new InputError(`source not found: ${opts.sourcePath}`, "ENOENT");
    }
  } else if (!opts.allowMissingSource) {
    throw new InputError("source not found: ", "ENOENT");
  }
  const root = opts.materialsRoot || defaultMaterialsRoot();
  const dir = join(root, caseId);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, "manifest.json");
  const created = !existsSync(manifestPath);
  if (created) {
    if (!existsSync(TEMPLATE)) throw new Error(`manifest template missing: ${TEMPLATE}`);
    copyFileSync(TEMPLATE, manifestPath);
  }
  const manifest = loadManifest(manifestPath);
  manifest.caseId = caseId;
  const source = (manifest.caseSource && typeof manifest.caseSource === "object" && !Array.isArray(manifest.caseSource)
    ? manifest.caseSource
    : (manifest.caseSource = {})) as JsonObject;
  source.type = opts.sourceType || (opts.sourcePath ? "local-file" : "pending");
  source.original = opts.sourcePath || null;
  if (opts.contextPath) manifest.businessContext = opts.contextPath;
  dumpManifest(manifestPath, manifest);
  return { manifestPath, created };
}

function main(): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      "case-id": { type: "string" },
      source: { type: "string" },
      "source-type": { type: "string", default: "local-file" },
      "materials-root": { type: "string" },
      context: { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node init_manifest.ts --case-id <id> --source <path> [options]

Create testdata/case-materials/<id>/manifest.json from the template.

Options:
  --case-id <id>           Case id (required)
  --source <path>          Original case document (required)
  --source-type <type>     local-file | paste | remote-case | planId
  --materials-root <dir>   Default: ./testdata/case-materials
  --context <path>         Optional business-context.json
  -h, --help               Show this help and exit

Example:
  node init_manifest.ts --case-id case-1 --source ./testdata/case-materials/case-1/case-original.md
`);
    return 0;
  }
  if (!values["case-id"] || !values.source) {
    process.stderr.write("ERROR: --case-id and --source are required\n");
    return 2;
  }
  try {
    const result = initManifest({
      caseId: values["case-id"],
      sourcePath: values.source,
      sourceType: values["source-type"],
      materialsRoot: values["materials-root"],
      contextPath: values.context || null,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    return err instanceof InputError ? 2 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("init_manifest.ts")) {
  process.exit(main());
}
