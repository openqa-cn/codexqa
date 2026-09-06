#!/usr/bin/env node
/**
 * open_lessons.ts — silent lessons-learned detection and storage
 *
 * Responsibilities:
 *   - After detection, automatically scan the task ContentStore shards / execution logs / timing data
 *   - Match detection_pattern in references/lessons-learned.md and record hits to lessons/<task_id>.json
 *   - Consumers (peek/report) are an Agent-internal loop and must **never be exposed to the user**
 *
 * Usage:
 *     node open_lessons.ts detect --task-id 42       # fully silent, empty stdout
 *     node open_lessons.ts peek --category phase1     # return Top-N lessons JSON
 *     node open_lessons.ts report --days 7            # Markdown frequency stats
 *
 * > ⚠️ Zero leak: all output from this module is Agent-internal only; do not write user-facing output.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentStore } from "./open_store.ts";
import { SKILL_ROOT } from "./providers/config.ts";

const SKILL_DIR = SKILL_ROOT;
const LESSONS_FILE = join(SKILL_DIR, "references", "lessons-learned.md");
const LESSONS_DB_DIR = join(SKILL_DIR, "references", "lessons");

function _parse_lessons(): Record<string, any>[] {
  if (!existsSync(LESSONS_FILE)) return [];
  const text = readFileSync(LESSONS_FILE, "utf8");
  const blocks = text.split(/\n---\n/);
  const lessons: Record<string, any>[] = [];
  const headingRe = /^##\s+(LL-[A-Z]+-\d+)\s+\[(P\d+)\]\s+.*/m;
  for (const blk of blocks) {
    const m = headingRe.exec(blk);
    if (!m) continue;
    const item: Record<string, any> = { id: m[1], severity: m[2], raw: blk };
    for (const field of ["description", "root_cause", "correct_action"]) {
      const fmatch = new RegExp(`-${field}:\\s*(.*?)(?=\\n\\w+-|\\n---|$)`, "s").exec(blk);
      item[field] = fmatch ? fmatch[1].trim() : "";
    }
    const dpm = new RegExp(
      "detection_pattern:\\s*" +
        "\\n\\s+-\\s*type:\\s*(\\w+)" +
        "\\n\\s+-\\s*condition:\\s*(.*?)(?=\\n\\w+-|\\n---|\\n##|$)",
      "s",
    ).exec(blk);
    if (dpm) {
      item.pattern = { type: dpm[1], condition: dpm[2].trim() };
    } else {
      item.pattern = null;
    }
    lessons.push(item);
  }
  return lessons;
}

function _load_task_content(task_id: number): Record<string, any> | null {
  try {
    const store = new ContentStore(task_id);
    const meta = store.load_meta_only();
    if (!meta || (typeof meta === "object" && !Object.keys(meta).length)) {
      return null;
    }
    const plan_data = store.load_plan_only();
    const wb_data = store.load_writebacks_only();
    const case_data = store.load_test_cases_only();
    return {
      services: meta.services || [],
      detectionPlan: plan_data.detectionPlan || [],
      processWritebacks: wb_data.processWritebacks || [],
      testCases: case_data.testCases || [],
    };
  } catch {
    return null;
  }
}

function _check_pattern(content: Record<string, any>, pattern: Record<string, any> | null): boolean {
  if (pattern === null || pattern === undefined) return false;
  const ptype = pattern.type || "";
  const cond = pattern.condition || "";
  const services = content.services || [];
  const plan = content.detectionPlan || [];
  const writebacks = content.processWritebacks || [];

  if (ptype === "content_json") {
    if (cond.includes("testCaseIds") && cond.includes("testCases")) {
      const case_count = (content.testCases || []).length;
      return case_count === 0 && cond.includes("HAS_CASES");
    }
    if (cond.includes("batchIds") && cond.includes("parentBatchId")) {
      const batch_ids = new Set<any>();
      for (const s of services) {
        for (const b of s.batchIds || []) batch_ids.add(b);
      }
      const covered = new Set(plan.map((p: any) => p.parentBatchId));
      return batch_ids.size > 1 && covered.size < batch_ids.size;
    }
    if (cond.includes("processWritebacks") && cond.includes("detectionPlan")) {
      const analyzed = plan.filter((p: any) => p.status !== "pending").length;
      return writebacks.length < analyzed && analyzed > 0;
    }
    if (cond.includes("fileCodes") && cond.includes("git")) {
      for (const wb of writebacks) {
        for (const fc of wb.fileCodes || []) {
          const git = fc.git || "";
          if (git && !git.includes("@git.example.com")) {
            return true;
          }
        }
      }
      return false;
    }
    if (cond.includes("filePath") && cond.includes("src/main/java/")) {
      for (const p of plan) {
        const fp = p.filePath || "";
        if (fp && fp.startsWith("src/main/java/") && !fp.slice(0, "src/main/java/".length - 1).includes("/")) {
          return true;
        }
      }
      return false;
    }
    if (cond.includes("thinking") && (cond.includes("duplicate") || cond.includes("length") || cond.includes("repeat"))) {
      for (const wb of writebacks) {
        const t = wb.thinking || "";
        if (t.length < 100) return true;
      }
      return false;
    }
    return false;
  }

  if (ptype === "time") {
    return false;
  }

  return false;
}

export function detect(task_id: number, _emit_result = false): Record<string, any> {
  const content = _load_task_content(task_id);
  if (content === null) {
    return { taskId: task_id, matches: [], error: "task data does not exist" };
  }

  const lessons = _parse_lessons();
  const matches: Record<string, any>[] = [];
  for (const ls of lessons) {
    if (_check_pattern(content, ls.pattern)) {
      matches.push({
        id: ls.id,
        severity: ls.severity,
        brief:
          ls.description.length > 80 ? ls.description.slice(0, 80) + "..." : ls.description,
      });
    }
  }

  const result = {
    taskId: task_id,
    detectedAt: _local_isoformat(),
    matches,
  };

  mkdirSync(LESSONS_DB_DIR, { recursive: true });
  const db_path = join(LESSONS_DB_DIR, `${task_id}.json`);
  try {
    writeFileSync(db_path, JSON.stringify(result, null, 2), "utf8");
  } catch {
    /* fail silently */
  }

  if (_emit_result) {
    console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function _local_isoformat(d = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offsetMin) / 60));
  const om = pad(Math.abs(offsetMin) % 60);
  return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}000${sign}${oh}:${om}`;
}

export function peek(category: string | null = null, limit = 3): Record<string, any>[] {
  const lessons = _parse_lessons();
  let filtered = lessons.filter(
    (l) => category === null || l.id.toLowerCase().startsWith(`ll-${category.toLowerCase()}`),
  );
  const sev_order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  filtered = filtered.slice().sort((a, b) => {
    const sa = sev_order[a.severity] ?? 99;
    const sb = sev_order[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const out: Record<string, any>[] = [];
  for (const l of filtered.slice(0, limit)) {
    out.push({
      id: l.id,
      severity: l.severity,
      correct_action: l.correct_action,
    });
  }
  return out;
}

export function report(days = 7): string {
  const cutoff = new Date(Date.now() - days * 86400000);
  const freq: Record<string, number> = {};
  const names = existsSync(LESSONS_DB_DIR) ? readdirSync(LESSONS_DB_DIR) : [];
  for (const fname of names) {
    if (!fname.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(LESSONS_DB_DIR, fname), "utf8"));
      const dt = new Date(data.detectedAt || "1970-01-01T00:00:00");
      if (dt < cutoff) continue;
      for (const m of data.matches || []) {
        freq[m.id] = (freq[m.id] || 0) + 1;
      }
    } catch {
      continue;
    }
  }
  if (!Object.keys(freq).length) {
    return `No lesson trigger records in the last ${days} days.\n`;
  }
  const lines = [
    `## Lessons-learned frequency (last ${days} days)\n`,
    "| Lesson ID | Frequency | Severity |",
    "|---|---|---|",
  ];
  const items = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  for (const [lid, count] of items) {
    const sev = _parse_lessons().find((l) => l.id === lid)?.severity ?? "?";
    lines.push(`| ${lid} | ${count} | ${sev} |`);
  }
  return lines.join("\n") + "\n";
}

function _cli_result(code: number, data: any = undefined, msg = ""): void {
  const payload: Record<string, any> = { code };
  if (msg) payload.msg = msg;
  if (data !== undefined && data !== null) payload.data = data;
  console.log(JSON.stringify(payload));
}

function _parse_int(raw: string, flag: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    console.error(`open_lessons.ts: error: argument ${flag}: invalid int value: '${raw}'`);
    process.exit(2);
  }
  return n;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(
      "usage: open_lessons.ts [-h] {detect,peek,report} ...\n\n" +
        "Silent lessons-learned detection module\n\n" +
        "subcommands:\n" +
        "  detect    detect whether a task hits known lesson patterns (silent by default)\n" +
        "  peek      get relevant lessons (Agent-internal context enrichment)\n" +
        "  report    in-period lesson frequency stats (Markdown)",
    );
    if (!cmd) process.exit(0);
    process.exit(0);
  }

  if (cmd === "detect") {
    let task_id: number | undefined;
    let emit = false;
    for (let i = 1; i < argv.length; i++) {
      const tok = argv[i];
      if (tok === "--task-id") {
        const raw = argv[++i];
        if (raw === undefined) {
          console.error("open_lessons.ts: error: option --task-id requires an argument");
          process.exit(2);
        }
        task_id = _parse_int(raw, "--task-id");
      } else if (tok === "--emit") {
        emit = true;
      } else if (tok === "-h" || tok === "--help") {
        console.log(
          "usage: open_lessons.ts detect [-h] --task-id TASK_ID [--emit]\n\n" +
            "Detect whether a task hits known lesson patterns (silent by default)\n\n" +
            "options:\n" +
            "  --task-id TASK_ID\n" +
            "  --emit             emit the result (silent by default)",
        );
        process.exit(0);
      } else {
        console.error(`open_lessons.ts: error: unrecognized arguments: ${tok}`);
        process.exit(2);
      }
    }
    if (task_id === undefined) {
      console.error("open_lessons.ts: error: the following arguments are required: --task-id");
      process.exit(2);
    }
    detect(task_id, emit);
  } else if (cmd === "peek") {
    let category: string | null = null;
    let limit = 3;
    for (let i = 1; i < argv.length; i++) {
      const tok = argv[i];
      if (tok === "--category") {
        const raw = argv[++i];
        if (raw === undefined) {
          console.error("open_lessons.ts: error: option --category requires an argument");
          process.exit(2);
        }
        category = raw;
      } else if (tok === "--limit") {
        const raw = argv[++i];
        if (raw === undefined) {
          console.error("open_lessons.ts: error: option --limit requires an argument");
          process.exit(2);
        }
        limit = _parse_int(raw, "--limit");
      } else if (tok === "-h" || tok === "--help") {
        console.log("usage: open_lessons.ts peek [-h] [--category CATEGORY] [--limit LIMIT]");
        process.exit(0);
      } else {
        console.error(`open_lessons.ts: error: unrecognized arguments: ${tok}`);
        process.exit(2);
      }
    }
    const data = peek(category, limit);
    _cli_result(0, data);
  } else if (cmd === "report") {
    let days = 7;
    for (let i = 1; i < argv.length; i++) {
      const tok = argv[i];
      if (tok === "--days") {
        const raw = argv[++i];
        if (raw === undefined) {
          console.error("open_lessons.ts: error: option --days requires an argument");
          process.exit(2);
        }
        days = _parse_int(raw, "--days");
      } else if (tok === "-h" || tok === "--help") {
        console.log("usage: open_lessons.ts report [-h] [--days DAYS]");
        process.exit(0);
      } else {
        console.error(`open_lessons.ts: error: unrecognized arguments: ${tok}`);
        process.exit(2);
      }
    }
    const md = report(days);
    console.log(md);
  } else {
    console.log(
      "usage: open_lessons.ts [-h] {detect,peek,report} ...\n\n" +
        "Silent lessons-learned detection module\n\n" +
        "subcommands:\n" +
        "  detect    detect whether a task hits known lesson patterns (silent by default)\n" +
        "  peek      get relevant lessons (Agent-internal context enrichment)\n" +
        "  report    in-period lesson frequency stats (Markdown)",
    );
  }
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
