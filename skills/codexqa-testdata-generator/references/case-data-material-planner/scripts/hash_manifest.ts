#!/usr/bin/env node
/** Compute an audit hash for the manifest. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const EXCLUDED_TOP_KEYS = ["confirmations", "generatedAt", "lintRounds"] as const;

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj as object).sort()) {
      out[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return out;
  }
  return obj;
}

export function computeHash(manifestPath: string): string {
  const data = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  for (const key of EXCLUDED_TOP_KEYS) delete data[key];
  const payload = JSON.stringify(sortKeys(data));
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
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
    process.stdout.write(`Usage: node hash_manifest.ts --manifest <path>

Compute an audit hash for the manifest (excludes confirmations, generatedAt, lintRounds).

Options:
  --manifest <path>   Manifest JSON (required)
  -h, --help          Show this help and exit

Example:
  node hash_manifest.ts --manifest ./testdata/case-materials/case-1/manifest.json
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: --manifest is required\n");
    return 2;
  }
  try {
    process.stdout.write(`${computeHash(values.manifest)}\n`);
    return 0;
  } catch (exc) {
    const err = exc as { code?: string; message?: string };
    if (err.code === "ENOENT") {
      process.stderr.write(`ERROR: manifest not found: ${values.manifest}\n`);
      return 2;
    }
    process.stderr.write(`ERROR: invalid JSON in manifest: ${err.message}\n`);
    return 3;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("hash_manifest.ts")) {
  process.exit(main());
}
