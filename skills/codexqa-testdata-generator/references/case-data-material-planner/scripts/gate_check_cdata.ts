#!/usr/bin/env node
/** C-data pre-gate: verify invoke completed before display. */

import { parseArgs } from "node:util";
import { loadManifest } from "./manifest_io.ts";
import type { JsonObject } from "../../../scripts/adapters/config.ts";

export function check(manifest: JsonObject): [boolean, JsonObject[]] {
  const entities = (Array.isArray(manifest.entities) ? manifest.entities : []) as JsonObject[];
  const failures: JsonObject[] = [];
  for (const e of entities) {
    const eid = e.entityId || "?";
    const tb = (e.toolBinding && typeof e.toolBinding === "object" ? e.toolBinding : {}) as JsonObject;
    const toolStatus = tb.toolStatus;
    const entityStatus = e.entityStatus;
    const fields = (e.fields && typeof e.fields === "object" ? e.fields : {}) as JsonObject;
    if (toolStatus === "available") {
      if (entityStatus === null || entityStatus === undefined) {
        failures.push({ entityId: eid, reason: "entityStatus=null, invoke was not executed" });
      } else if (entityStatus === "unverified" || entityStatus === "verified") {
        const values = Object.values(fields);
        if (values.length && values.every((v) => v === null)) {
          failures.push({ entityId: eid, reason: "all fields are null, invoke produced no field values" });
        }
      }
    }
  }
  return [failures.length === 0, failures];
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
    process.stdout.write(`Usage: node gate_check_cdata.ts --manifest <path>

C-data pre-gate: verify invoke completed before display.

Options:
  --manifest <path>   Manifest JSON (required)
  -h, --help          Show this help and exit

Example:
  node gate_check_cdata.ts --manifest ./testdata/case-materials/case-1/manifest.json
`);
    return 0;
  }
  if (!values.manifest) {
    process.stderr.write("ERROR: manifest not found: undefined\n");
    return 2;
  }
  let manifest: JsonObject;
  try {
    manifest = loadManifest(values.manifest);
  } catch {
    process.stderr.write(`ERROR: manifest not found: ${values.manifest}\n`);
    return 2;
  }
  const [passed, failures] = check(manifest);
  process.stdout.write(`${JSON.stringify({ pass: passed, failures })}\n`);
  return passed ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gate_check_cdata.ts")) {
  process.exit(main());
}
