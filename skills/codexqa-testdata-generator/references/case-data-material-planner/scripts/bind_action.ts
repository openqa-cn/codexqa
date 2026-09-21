#!/usr/bin/env node
/** Substitute action cmdTemplate placeholders into filledCmd. */

import { parseArgs } from "node:util";
import type { JsonObject } from "../../../scripts/adapters/config.ts";
import { dumpManifest, loadManifest } from "./manifest_io.ts";
import { sanitizeParamValue } from "./safe_io.ts";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asObjects(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []) as JsonObject[];
}

export type BindResult = {
  actionId: string;
  filledCmd: string;
  cmdStatus: string;
  cmdConfidence: number;
  verifyNote: string | null;
  failReason: string | null;
};

const GENERATORS: Record<string, (args: JsonObject) => string> = {
  RANDOM_ID: (args) => {
    const length = typeof args.length === "number" ? args.length : 15;
    const n = Math.max(length - 10, 4);
    return `$(date +%s)$(printf '%0${n}d' $((RANDOM*RANDOM%10**${n})))`;
  },
  UUID: () => "$(uuidgen)",
  TIMESTAMP_MS: () => "$(date +%s%3N 2>/dev/null || node -e 'console.log(Date.now())')",
  DATE_OFFSET: (args) => {
    const days = typeof args.offsetDays === "number" ? args.offsetDays : 0;
    const sign = days >= 0 ? `+${days}` : String(days);
    return `$(date -v${sign}d +%Y-%m-%d 2>/dev/null || date -d "${days} days" +%Y-%m-%d)`;
  },
};

function findEntity(manifest: JsonObject, entityId: string): JsonObject | null {
  return asObjects(manifest.entities).find((e) => e.entityId === entityId) || null;
}

function findAction(manifest: JsonObject, actionId: string): JsonObject | null {
  return asObjects(manifest.actions).find((a) => a.actionId === actionId) || null;
}

function replacePlaceholder(cmd: string, paramName: string, value: string, splitQuotes: boolean): string {
  const token = `__${paramName}__`;
  if (!cmd.includes(token)) return cmd;
  if (splitQuotes) {
    const quoted = `"__${paramName}__"`;
    if (cmd.includes(quoted)) return cmd.split(quoted).join(`"'"${value}"'"`);
  }
  return cmd.split(token).join(value);
}

function stripSubstitutions(cmd: string): string {
  let out = cmd;
  for (let i = 0; i < 16; i += 1) {
    if (!/\$\((?:[^()]|\([^()]*\))*\)/.test(out) && !/\$\(\([^()]*\)\)/.test(out)) break;
    out = out.replace(/\$\(\([^()]*\)\)/g, "");
    out = out.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, "");
  }
  out = out.replace(/<<[A-Z][0-9]+\.[A-Za-z_][A-Za-z0-9_]*>>/g, "");
  return out;
}

export function residualViolations(cmd: string): string[] {
  const rest = stripSubstitutions(cmd);
  const hits: string[] = [];
  if (/__[A-Za-z_][A-Za-z0-9_]*__/.test(rest)) hits.push("unsubstituted __param__");
  if (/\$\{[^}]+\}/.test(rest)) hits.push("literal ${var}");
  if (/\$[A-Z_][A-Z0-9_]*/.test(rest)) hits.push("bare $VAR");
  return hits;
}

export function bindAction(manifest: JsonObject, actionId: string): BindResult {
  const action = findAction(manifest, actionId);
  const empty: BindResult = {
    actionId,
    filledCmd: "",
    cmdStatus: "gen-failed",
    cmdConfidence: 0,
    verifyNote: null,
    failReason: `[capability-mismatch] action not found: ${actionId}`,
  };
  if (!action) return empty;

  const binding = asObject(action.toolBinding);
  const template = String(binding.cmdTemplate || "");
  if (!template) {
    const result: BindResult = {
      actionId,
      filledCmd: "",
      cmdStatus: "gen-failed",
      cmdConfidence: 0,
      verifyNote: null,
      failReason: "[capability-mismatch] cmdTemplate missing",
    };
    action.filledCmd = result.filledCmd;
    action.cmdStatus = result.cmdStatus;
    action.cmdConfidence = result.cmdConfidence;
    action.failReason = result.failReason;
    action.verifyNote = result.verifyNote;
    return result;
  }
  if (binding.toolStatus !== "available") {
    const result: BindResult = {
      actionId,
      filledCmd: "",
      cmdStatus: "gen-failed",
      cmdConfidence: 0,
      verifyNote: null,
      failReason: `[capability-mismatch] toolBinding.toolStatus=${String(binding.toolStatus || "null")}`,
    };
    action.filledCmd = result.filledCmd;
    action.cmdStatus = result.cmdStatus;
    action.cmdConfidence = result.cmdConfidence;
    action.failReason = result.failReason;
    return result;
  }

  const seen = new Set<string>();
  let cmd = template;
  let missing = false;
  let fail: string | null = null;

  const markDup = (name: string): boolean => {
    if (seen.has(name)) {
      fail = `[capability-mismatch] duplicate paramName across sources: ${name}`;
      return true;
    }
    seen.add(name);
    return false;
  };

  for (const p of asObjects(action.paramsFromEntities)) {
    const name = String(p.paramName || "");
    if (!name || markDup(name)) continue;
    const src = findEntity(manifest, String(p.sourceEntityId || ""));
    if (!src) {
      fail = `[dep-blocked] missing entity ${String(p.sourceEntityId || "")}`;
      missing = true;
      continue;
    }
    const status = String(src.entityStatus || "");
    if (status === "failed" || status === "missing-dependency" || !status) {
      missing = true;
      continue;
    }
    const value = asObject(src.fields)[String(p.sourceField || "")];
    if (value === null || value === undefined || value === "") {
      missing = true;
      continue;
    }
    const safe = sanitizeParamValue(value);
    if (safe === null) {
      fail = `[capability-mismatch] unsafe value for ${name}`;
      continue;
    }
    cmd = replacePlaceholder(cmd, name, safe, false);
  }

  for (const p of asObjects(action.paramsFromGenerators)) {
    const name = String(p.paramName || "");
    if (!name || markDup(name)) continue;
    const genName = String(p.generator || "");
    const gen = GENERATORS[genName];
    if (!gen) {
      fail = `[capability-mismatch] invalid generator: ${genName || "SEQ (deprecated)"}`;
      continue;
    }
    cmd = replacePlaceholder(cmd, name, gen(asObject(p.args)), true);
  }

  for (const p of asObjects(action.paramsFromPriorActions)) {
    const name = String(p.paramName || "");
    if (!name || markDup(name)) continue;
    const src = String(p.sourceActionId || "?");
    const field = String(p.sourceOutputField || name);
    cmd = replacePlaceholder(cmd, name, `<<${src}.${field}>>`, false);
  }

  let result: BindResult;
  if (fail && fail.startsWith("[capability-mismatch]")) {
    result = {
      actionId,
      filledCmd: cmd,
      cmdStatus: "gen-failed",
      cmdConfidence: 0,
      verifyNote: null,
      failReason: fail,
    };
  } else if (missing) {
    result = {
      actionId,
      filledCmd: cmd,
      cmdStatus: "missing-param",
      cmdConfidence: 0.3,
      verifyNote: null,
      failReason: fail || "[dep-blocked] source entity field not ready",
    };
  } else {
    const residuals = residualViolations(cmd);
    if (residuals.length) {
      result = {
        actionId,
        filledCmd: cmd,
        cmdStatus: "gen-failed",
        cmdConfidence: 0,
        verifyNote: null,
        failReason: `[capability-mismatch] residual placeholders: ${residuals.join(",")}`,
      };
    } else {
      result = {
        actionId,
        filledCmd: cmd,
        cmdStatus: "filled",
        cmdConfidence: 0.7,
        verifyNote: "syntax check + value-sanity scan passed",
        failReason: null,
      };
    }
  }

  action.filledCmd = result.filledCmd;
  action.cmdStatus = result.cmdStatus;
  action.cmdConfidence = result.cmdConfidence;
  action.verifyNote = result.verifyNote;
  action.failReason = result.failReason;
  return result;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      manifest: { type: "string" },
      "action-id": { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node bind_action.ts --manifest <path> --action-id <id>

Substitute cmdTemplate placeholders into filledCmd.

Options:
  --manifest <path>    Manifest JSON (required)
  --action-id <id>     Action to bind (required)
  -h, --help           Show this help and exit

Example:
  node bind_action.ts --manifest ./testdata/case-materials/case-1/manifest.json --action-id A01
`);
    return 0;
  }
  if (!values.manifest || !values["action-id"]) {
    process.stderr.write("ERROR: --manifest and --action-id are required\n");
    return 2;
  }
  const manifest = loadManifest(values.manifest);
  const result = bindAction(manifest, values["action-id"]);
  dumpManifest(values.manifest, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.cmdStatus === "filled" ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("bind_action.ts")) {
  process.exit(await main());
}
