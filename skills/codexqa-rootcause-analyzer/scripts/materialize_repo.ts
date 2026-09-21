import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type { StackFrame } from "./parse_exception.ts";

export const SOURCE_EXT =
  /\.(java|kt|kts|scala|groovy|py|js|jsx|ts|tsx|mjs|cjs|go|cs|cpp|cc|cxx|c|h|hpp|m|mm|rb|php|rs|swift|xml)$/i;

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "data",
  "dist",
  "build",
  "target",
  "__pycache__",
  ".idea",
  ".vscode",
  ".codexqa-testcase-generator",
  "_skill-backup",
]);

const GIT_ENV = {
  GIT_AUTHOR_NAME: "diagnose",
  GIT_AUTHOR_EMAIL: "diagnose@local",
  GIT_COMMITTER_NAME: "diagnose",
  GIT_COMMITTER_EMAIL: "diagnose@local",
};

export type MaterializeResult = {
  localDir: string;
  originDir: string;
  materialized: boolean;
  copiedFiles: string[];
  source: "git-dir" | "materialized";
};

function is_dir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function is_file(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function is_git_repo(dir: string): boolean {
  return is_dir(join(dir, ".git")) || is_file(join(dir, ".git"));
}

export function find_git_root(start: string): string | null {
  let cur = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (is_git_repo(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export function is_source_path(path: string): boolean {
  return SOURCE_EXT.test(path);
}

function git_local(args: string[], cwd: string) {
  const result = spawnSync("git", ["-c", "user.name=diagnose", "-c", "user.email=diagnose@local", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...GIT_ENV },
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    returncode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function list_top_level_sources(dir: string, allowExts: Set<string> | null): string[] {
  if (!is_dir(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const abs = join(dir, name);
    if (!is_file(abs)) continue;
    if (!is_source_path(name)) continue;
    if (allowExts && allowExts.size && !allowExts.has(extname(name).toLowerCase())) continue;
    out.push(abs);
  }
  return out;
}

function bundle_exts(uploadedFile: string | null | undefined, frames?: StackFrame[]): Set<string> | null {
  const exts = new Set<string>();
  if (uploadedFile) exts.add(extname(uploadedFile).toLowerCase());
  for (const frame of frames || []) {
    if (frame.file) exts.add(extname(frame.file).toLowerCase());
  }
  exts.delete("");
  return exts.size ? exts : null;
}

function resolve_frame_file(originDir: string, frameFile: string | null): string | null {
  if (!frameFile) return null;
  const base = basename(frameFile.replace(/\\/g, "/"));
  const direct = join(originDir, base);
  if (is_file(direct)) return direct;
  const abs = frameFile.startsWith("/") ? frameFile : join(originDir, frameFile);
  if (is_file(abs)) return abs;
  return null;
}

export function collect_upload_bundle(opts: {
  originDir: string;
  uploadedFile?: string | null;
  frames?: StackFrame[];
}): string[] {
  const files = new Map<string, string>();
  const add = (abs: string) => {
    if (!is_file(abs) || !is_source_path(abs)) return;
    files.set(resolve(abs), abs);
  };

  if (opts.uploadedFile && is_file(opts.uploadedFile)) add(opts.uploadedFile);

  for (const frame of opts.frames || []) {
    const hit = resolve_frame_file(opts.originDir, frame.file);
    if (hit) add(hit);
  }

  for (const abs of list_top_level_sources(opts.originDir, bundle_exts(opts.uploadedFile, opts.frames))) add(abs);

  return [...files.values()].sort();
}

function seed_git_repo(dest: string, files: string[], originDir: string): void {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  let init = git_local(["init", "-b", "main"], dest);
  if (init.returncode !== 0) {
    init = git_local(["init"], dest);
    if (init.returncode !== 0) {
      throw new Error(`git init (task-local) failed: ${init.stderr.slice(0, 300)}`);
    }
    git_local(["checkout", "-b", "main"], dest);
  }
  for (const abs of files) {
    const rel = basename(abs);
    const target = join(dest, rel);
    copyFileSync(abs, target);
  }
  if (!files.length) {
    writeFileSync(join(dest, "README.md"), `materialized from ${originDir}\n`, "utf8");
  }
  const add = git_local(["add", "-A"], dest);
  if (add.returncode !== 0) throw new Error(`git add failed: ${add.stderr.slice(0, 300)}`);
  const commit = git_local(["commit", "-m", "diagnose: uploaded business sources"], dest);
  if (commit.returncode !== 0) {
    throw new Error(`git commit (task-local) failed: ${commit.stderr.slice(0, 300)}`);
  }
}

export function materialize_for_codexqa(opts: {
  dest: string;
  originDir: string;
  uploadedFile?: string | null;
  frames?: StackFrame[];
}): MaterializeResult {
  const gitRoot = is_git_repo(opts.originDir) ? opts.originDir : find_git_root(opts.originDir);
  if (gitRoot) {
    return {
      localDir: gitRoot,
      originDir: opts.originDir,
      materialized: false,
      copiedFiles: [],
      source: "git-dir",
    };
  }
  const copied = collect_upload_bundle({
    originDir: opts.originDir,
    uploadedFile: opts.uploadedFile,
    frames: opts.frames,
  });
  if (!copied.length) {
    throw new Error(
      `no source files to materialize from ${opts.originDir}; pass --file with a business source file`,
    );
  }
  seed_git_repo(opts.dest, copied, opts.originDir);
  return {
    localDir: opts.dest,
    originDir: opts.originDir,
    materialized: true,
    copiedFiles: copied.map((p) => basename(p)),
    source: "materialized",
  };
}

export function origin_from_inputs(opts: {
  file?: string | null;
  dir?: string | null;
  cwd?: string;
}): { originDir: string; uploadedFile: string | null } {
  const cwd = opts.cwd || process.cwd();
  if (opts.file) {
    const abs = resolve(cwd, opts.file);
    if (!existsSync(abs)) throw new Error(`--file not found: ${abs}`);
    if (is_dir(abs)) return { originDir: abs, uploadedFile: null };
    return { originDir: dirname(abs), uploadedFile: abs };
  }
  if (opts.dir) {
    const abs = resolve(cwd, opts.dir);
    if (!existsSync(abs)) throw new Error(`--dir does not exist: ${abs}`);
    if (is_file(abs)) return { originDir: dirname(abs), uploadedFile: abs };
    return { originDir: abs, uploadedFile: null };
  }
  return { originDir: cwd, uploadedFile: null };
}

export { SKIP_DIR };
