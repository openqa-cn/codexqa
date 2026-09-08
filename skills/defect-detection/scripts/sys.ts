/**
 * Platform layer — the only module that is allowed to know about OS differences.
 *
 * Everything else asks this module for three things:
 *   1. `which(cmd)`      — locate an executable on PATH (honours PATHEXT on Windows)
 *   2. `run(argv, opts)` — run a child process synchronously with a timeout;
 *                          handles Windows `.cmd` / `.bat` shims (npm, gitnexus, …)
 *                          that Node refuses to spawn without a shell
 *   3. `scratch_dir()` / `to_posix()` — scratch space under the data dir instead of
 *                          `/tmp`, and forward-slash normalisation for paths we persist
 *
 * Hard-coding `/tmp`, calling `spawnSync("npm", …)` directly, or splitting file
 * system paths on "/" outside this module are bugs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

import { content_base_dir } from "./store.ts";

export const IS_WINDOWS = process.platform === "win32";

/** Resolve `cmd` to an absolute executable path, or null when it is not on PATH. */
export function which(cmd: string): string | null {
  if (!cmd) return null;
  if (cmd.includes("/") || cmd.includes("\\")) {
    return existsSync(cmd) ? cmd : null;
  }
  const path_env = process.env.PATH || "";
  const exts = IS_WINDOWS ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of path_env.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      if (existsSync(full)) return full;
    }
    // Windows: an explicit extension in `cmd` (e.g. "npm.cmd") must still resolve.
    if (IS_WINDOWS && extname(cmd)) {
      const full = join(dir, cmd);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

export interface RunResult {
  /** Exit status; -1 when the process could not be started or timed out. */
  returncode: number;
  stdout: string;
  stderr: string;
  /** Present when spawning failed (ENOENT, ETIMEDOUT, …). */
  error?: NodeJS.ErrnoException;
  timedOut: boolean;
  notFound: boolean;
}

export interface RunOptions {
  timeout_s?: number;
  cwd?: string | null;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

const _WIN_SHIM_EXTS = new Set([".cmd", ".bat"]);

/** Quote one argument for cmd.exe when we are forced to go through a `.cmd` shim. */
function _quote_for_cmd(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Run `argv` synchronously. argv[0] is resolved through `which`; on Windows a
 * `.cmd`/`.bat` shim is executed via `cmd.exe /d /s /c` because Node (>= 18.20 /
 * 20.12) rejects spawning batch files without a shell.
 */
export function run(argv: string[], opts: RunOptions = {}): RunResult {
  const timeout_ms = (opts.timeout_s ?? 60) * 1000;
  const [cmd, ...args] = argv;

  const resolved = which(cmd);
  if (!resolved) {
    const err: NodeJS.ErrnoException = new Error(`command not found: ${cmd}`);
    err.code = "ENOENT";
    return { returncode: -1, stdout: "", stderr: err.message, error: err, timedOut: false, notFound: true };
  }

  let file = resolved;
  let file_args = args;
  let verbatim = false;
  if (IS_WINDOWS && _WIN_SHIM_EXTS.has(extname(resolved).toLowerCase())) {
    file = process.env.ComSpec || "cmd.exe";
    const line = [resolved, ...args].map(_quote_for_cmd).join(" ");
    file_args = ["/d", "/s", "/c", `"${line}"`];
    verbatim = true;
  }

  const r = spawnSync(file, file_args, {
    encoding: "utf8",
    timeout: timeout_ms,
    cwd: opts.cwd || undefined,
    env: opts.env,
    maxBuffer: opts.maxBuffer ?? 50 * 1024 * 1024,
    windowsVerbatimArguments: verbatim,
    windowsHide: true,
  });

  const error = r.error as NodeJS.ErrnoException | undefined;
  const timed_out = error?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
  return {
    returncode: r.status ?? -1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    error,
    timedOut: timed_out,
    notFound: error?.code === "ENOENT",
  };
}

/** Scratch directory under the data dir (`<data dir>/_tmp`); wiped by cleanup-stale-data. */
export function scratch_dir(...segments: string[]): string {
  const dir = join(content_base_dir(), "_tmp", ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Forward-slash form for paths we persist or compare (git, Semgrep and class paths all use "/"). */
export function to_posix(p: string): string {
  return String(p || "").replace(/\\/g, "/");
}
