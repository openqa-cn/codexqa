#!/usr/bin/env node
/** Generate SKILL.md + tools-guide.md from slot.yaml (or inferred executors / OpenAPI). */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isFile } from "./adapters/config.ts";
import { isSlotDir, loadSlotManifest, renderSlotSkillMd, renderToolsGuide } from "./adapters/slot_roots.ts";

function generated(path: string): boolean {
  if (!isFile(path)) return true;
  return readFileSync(path, "utf8").includes("generated-from: slot.yaml");
}

export function syncSlot(dir: string, force = false): { ok: boolean; skillMd: string; toolsGuide: string } {
  const root = resolve(dir);
  if (!isSlotDir(root)) {
    throw new Error(`not a slot directory: ${root} (need SKILL.md or slot.yaml)`);
  }
  const manifest = loadSlotManifest(root);
  const skillMd = join(root, "SKILL.md");
  const toolsGuide = join(root, "references", "tools-guide.md");
  mkdirSync(join(root, "references"), { recursive: true });
  if (force || generated(skillMd)) writeFileSync(skillMd, renderSlotSkillMd(manifest), "utf8");
  if (force || generated(toolsGuide) || !isFile(toolsGuide)) {
    writeFileSync(toolsGuide, renderToolsGuide(manifest), "utf8");
  }
  return { ok: true, skillMd, toolsGuide };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      dir: { type: "string" },
      force: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`Usage: node sync_slot.ts --dir <slot-dir> [--force]

Regenerate SKILL.md and references/tools-guide.md from slot.yaml.
Hand-written SKILL.md is left alone unless it contains "generated-from: slot.yaml" or you pass --force.

Options:
  --dir <path>   Slot directory (required)
  --force        Overwrite even a hand-written SKILL.md
  -h, --help     Show this help and exit
`);
    return 0;
  }
  if (!values.dir) {
    process.stderr.write("error: --dir is required\n");
    return 2;
  }
  try {
    const result = syncSlot(values.dir, Boolean(values.force));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sync_slot.ts")) {
  process.exit(await main());
}
