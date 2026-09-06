#!/usr/bin/env node
/**
 * open_tags.ts — persist the platform tag catalog to local JSON files.
 *
 * Uses the configured platform provider (`get_tag_list`), so local mode
 * works offline and HTTP mode talks to `/v1/tags`.
 *
 * Outputs:
 *     {SKILL_DIR}/data/tags.json       — flat map (tagId → tagName)
 *     {SKILL_DIR}/data/tag_tree.json   — tree (level-1 + children)
 *
 * Usage:
 *     node open_tags.ts
 *     node open_tags.ts --output-flat ./tags.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { SKILL_ROOT } from "./providers/config.ts";
import { get_platform } from "./providers/registry.ts";

const SCRIPT_DIR = SKILL_ROOT;
const DATA_DIR = join(SCRIPT_DIR, "data");
mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_FLAT = join(DATA_DIR, "tags.json");
const DEFAULT_TREE = join(DATA_DIR, "tag_tree.json");

function _local_isoformat(d = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}`;
}

function _parse_cli(argv: string[]): Record<string, any> {
  const out: Record<string, any> = {
    output_flat: DEFAULT_FLAT,
    output_tree: DEFAULT_TREE,
    dry_run: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "-h" || tok === "--help") {
      console.log(
        "usage: open_tags.ts [-h] [--output-flat OUTPUT_FLAT] [--output-tree OUTPUT_TREE] [--dry-run]\n\n" +
          "Sync the tag list to local JSON\n\n" +
          "options:\n" +
          "  -h, --help            show this help message and exit\n" +
          `  --output-flat OUTPUT_FLAT\n` +
          `                        flat mapping file path (default: ${DEFAULT_FLAT})\n` +
          "  --output-tree OUTPUT_TREE\n" +
          `                        hierarchical tree file path (default: ${DEFAULT_TREE})\n` +
          "  --dry-run             print only, do not write files",
      );
      process.exit(0);
    } else if (tok === "--output-flat") {
      const raw = argv[++i];
      if (raw === undefined) {
        console.error("open_tags.ts: error: option --output-flat requires an argument");
        process.exit(2);
      }
      out.output_flat = raw;
    } else if (tok === "--output-tree") {
      const raw = argv[++i];
      if (raw === undefined) {
        console.error("open_tags.ts: error: option --output-tree requires an argument");
        process.exit(2);
      }
      out.output_tree = raw;
    } else if (tok === "--dry-run") {
      out.dry_run = true;
    } else {
      console.error(`open_tags.ts: error: unrecognized arguments: ${tok}`);
      process.exit(2);
    }
  }
  return out;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = _parse_cli(argv);

  const result = get_platform().get_tag_list();
  if ("_error" in result) {
    console.error(`[open_tags] ❌ request failed: ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0 && result.code != null) {
    console.error(
      `[open_tags] ❌ API returned an error: code=${result.code}, msg=${result.msg}`,
    );
    process.exit(1);
  }

  let tags_raw: any = result.data || [];
  if (tags_raw && typeof tags_raw === "object" && !Array.isArray(tags_raw)) {
    tags_raw = tags_raw.tags || tags_raw.list || [];
  }
  if (!Array.isArray(tags_raw) || !tags_raw.length) {
    console.error("[open_tags] ❌ returned data is empty or not a list");
    process.exit(1);
  }

  const flat_mapping: Record<string, string> = {};
  const first_level: Record<string, any>[] = [];
  let second_level_count = 0;

  for (const t1 of tags_raw) {
    const t1_id = t1.id || t1.tagId;
    const t1_name = t1.name || t1.tagName || "";
    if (t1_id) {
      flat_mapping[String(t1_id)] = t1_name;
    }

    const children = t1.children || [];
    const t1_children: Record<string, any>[] = [];
    for (const t2 of children) {
      const t2_id = t2.id || t2.tagId;
      const t2_name = t2.name || t2.tagName || "";
      if (t2_id) {
        flat_mapping[String(t2_id)] = t2_name;
        for (const t3 of t2.children || []) {
          const t3_id = t3.id || t3.tagId;
          if (t3_id) {
            flat_mapping[String(t3_id)] = t3.name || t3.tagName || "";
          }
        }
        t1_children.push({
          id: t2_id,
          name: t2_name,
          children: t2.children || [],
        });
        second_level_count += 1;
      }
    }

    first_level.push({
      id: t1_id,
      name: t1_name,
      children: t1_children,
    });
  }

  console.log(
    `[open_tags] ✅ fetch succeeded! ${first_level.length} level-1 tags, ` +
      `${second_level_count} level-2 tags, ${Object.keys(flat_mapping).length} tagIds in total`,
  );
  console.log();
  console.log("[Tag list preview]");
  for (const t1 of first_level) {
    const cnames = (t1.children || []).map((c: any) => c.name);
    const cstr = cnames.length ? cnames.join(" | ") : "(no child tags)";
    console.log(`  [${t1.id}] ${t1.name}: ${cstr}`);
  }

  if (args.dry_run) {
    console.log("\n[open_tags] DRY-RUN, skip write");
    return;
  }

  const now = _local_isoformat();
  const flat_payload = {
    generated_at: now,
    source: "platform.get_tag_list",
    total_count: Object.keys(flat_mapping).length,
    first_level_count: first_level.length,
    second_level_count,
    mapping: flat_mapping,
  };
  writeFileSync(args.output_flat, JSON.stringify(flat_payload, null, 2), "utf8");
  console.log(`\n[open_tags] 📄 flat mapping written: ${args.output_flat}`);

  const tree_payload = {
    generated_at: now,
    source: "platform.get_tag_list",
    first_level,
    first_level_count: first_level.length,
    second_level_count,
  };
  writeFileSync(args.output_tree, JSON.stringify(tree_payload, null, 2), "utf8");
  console.log(`[open_tags] 🌲 hierarchical tree written: ${args.output_tree}`);
}

function _is_main(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
  } catch {
    return false;
  }
}

if (_is_main()) {
  main();
}
