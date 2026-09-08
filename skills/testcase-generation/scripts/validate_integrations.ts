/** Validate integrations.yaml and optionally write integrations-resolved.json. */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, resolvePublic, validateConfig } from "./integrations_lib.ts";

function main(): number {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      workspace: { type: "string", default: "." },
      "resolve-out": { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`usage: validate_integrations.ts [-h] [--workspace WORKSPACE] [--resolve-out RESOLVE_OUT]

Validate skill integration config

options:
  -h, --help            show this help message and exit
  --workspace WORKSPACE
                        Workspace root
  --resolve-out RESOLVE_OUT
                        Write public resolved JSON (no secrets) to this path`);
    return 0;
  }
  const workspace = path.resolve(values.workspace || ".");
  let data: Record<string, unknown>;
  try {
    data = loadConfig(workspace);
  } catch (exc) {
    console.log(JSON.stringify({ ok: false, errors: [String(exc)] }));
    return 2;
  }
  const errors = validateConfig(data);
  if (errors.length) {
    console.log(
      JSON.stringify({ ok: false, source: data._source, errors }, null, 2),
    );
    return 1;
  }
  const resolved = resolvePublic(data) as Record<string, unknown>;
  if (values["resolve-out"]) {
    let out = path.isAbsolute(values["resolve-out"])
      ? values["resolve-out"]
      : path.join(workspace, values["resolve-out"]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(resolved, null, 2) + "\n", "utf8");
    resolved.wrote = out;
  }
  console.log(JSON.stringify({ ok: true, ...resolved }, null, 2));
  return 0;
}

process.exit(main());
