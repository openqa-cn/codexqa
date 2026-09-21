import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function data_root(): string {
  const base = process.env.DIAGNOSE_DATA_DIR;
  const root = base ? base : join(SKILL_ROOT, "data");
  mkdirSync(root, { recursive: true });
  return root;
}

export function task_dir(task_id: number | string): string {
  const dir = join(data_root(), String(task_id));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function meta_path(task_id: number | string): string {
  return join(task_dir(task_id), "meta.json");
}

export function analysis_dir(task_id: number | string): string {
  const dir = join(task_dir(task_id), "codexqa");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function analysis_path(task_id: number | string): string {
  return join(analysis_dir(task_id), "analysis.json");
}

export function brief_path(task_id: number | string): string {
  return join(analysis_dir(task_id), "brief.json");
}

export function facts_path(task_id: number | string): string {
  return join(task_dir(task_id), "facts.json");
}

export function read_json(path: string, fallback: any = null): any {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function write_json(path: string, value: any): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function read_meta(task_id: number | string): Record<string, any> {
  const meta = read_json(meta_path(task_id), null);
  if (!meta) {
    throw new Error(`task ${task_id} not found; run submit first`);
  }
  return meta;
}

export function write_meta(task_id: number | string, meta: Record<string, any>): void {
  write_json(meta_path(task_id), meta);
}

export function next_task_id(): number {
  const root = data_root();
  let max = 0;
  for (const name of readdirSync(root)) {
    const n = Number(name);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

export function require_task_id(args: Record<string, any>): number {
  const id = Number(args.task_id);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error("--task-id is required");
  }
  return id;
}
