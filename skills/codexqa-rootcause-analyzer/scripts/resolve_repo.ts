import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export type RepoResolve = {
  localDir: string;
  cloned: boolean;
  gitUrl: string | null;
  branch: string | null;
  source: "git" | "dir" | "cwd";
};

export function git_run(args: string[], cwd?: string): { returncode: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd,
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    returncode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

export function looks_like_local_path(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("git@") || value.includes("://")) return false;
  return existsSync(value);
}

export function resolve_repo(opts: {
  git?: string | null;
  branch?: string | null;
  dir?: string | null;
  cloneDir: string;
  cwd?: string;
}): RepoResolve {
  const cwd = opts.cwd || process.cwd();
  const git = opts.git ? String(opts.git).trim() : "";
  const dir = opts.dir ? String(opts.dir).trim() : "";
  const branch = opts.branch ? String(opts.branch).trim() : "";

  if (git && looks_like_local_path(git)) {
    const localDir = resolve(git);
    return { localDir, cloned: false, gitUrl: null, branch: branch || null, source: "dir" };
  }

  if (dir) {
    const localDir = isAbsolute(dir) ? dir : resolve(cwd, dir);
    if (!existsSync(localDir)) {
      throw new Error(`--dir does not exist: ${localDir}`);
    }
    return { localDir, cloned: false, gitUrl: git || null, branch: branch || null, source: "dir" };
  }

  if (git) {
    mkdirSync(opts.cloneDir, { recursive: true });
    const args = ["clone", "--depth", "1", "--single-branch"];
    if (branch) args.push("--branch", branch);
    args.push(git, opts.cloneDir);
    const result = git_run(args, cwd);
    if (result.returncode !== 0) {
      throw new Error(`git clone failed: ${result.stderr || result.stdout || "unknown error"}`);
    }
    return {
      localDir: opts.cloneDir,
      cloned: true,
      gitUrl: git,
      branch: branch || null,
      source: "git",
    };
  }

  return { localDir: cwd, cloned: false, gitUrl: null, branch: null, source: "cwd" };
}
