/**
 * Detect / install GitNexus once, then analyze or fall back to grep.
 *
 * Install is attempted at most once per machine (stamp file) unless force=True.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { content_base_dir } from "./store.ts";
import { run, which } from "./sys.ts";

const INSTALL_TIMEOUT = 300;
const ANALYZE_TIMEOUT = 90;
const VERSION_TIMEOUT = 20;

function _stamp_path(): string {
  const root = content_base_dir();
  mkdirSync(root, { recursive: true });
  return join(root, "_gitnexus_install.json");
}

function _read_stamp(): Record<string, any> {
  const path = _stamp_path();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function _write_stamp(payload: Record<string, any>): void {
  writeFileSync(_stamp_path(), JSON.stringify(payload, null, 2), "utf8");
}

/** Throwing wrapper over sys.run: callers here treat spawn failures as exceptions. */
function _run(
  cmd: string[],
  timeout: number,
  cwd: string | null = null,
): { returncode: number; stdout: string; stderr: string } {
  const result = run(cmd, { timeout_s: timeout, cwd, maxBuffer: 20 * 1024 * 1024 });
  if (result.error) {
    if (result.timedOut) {
      const e: any = new Error(`Command '${cmd[0]}' timed out after ${timeout} seconds`);
      e.name = "TimeoutExpired";
      throw e;
    }
    throw result.error;
  }
  return { returncode: result.returncode, stdout: result.stdout, stderr: result.stderr };
}

export const gitnexusHooks = {
  which,
  run: _run,
};

export function detect(skip_version = false): Record<string, any> {
  const binary = gitnexusHooks.which("gitnexus");
  if (!binary) {
    return { installed: false, binary: "", version: "" };
  }
  if (skip_version) {
    const stamp = _read_stamp();
    return { installed: true, binary, version: stamp.version || "", versionSkipped: true };
  }
  try {
    const proc = gitnexusHooks.run([binary, "--version"], VERSION_TIMEOUT);
    const version =
      proc.returncode === 0
        ? (proc.stdout || proc.stderr || "").trim().split(/\r?\n/)[0] || ""
        : "";
    if (proc.returncode !== 0) {
      return { installed: false, binary, version: "", error: (proc.stderr || "").slice(0, 300) };
    }
    return { installed: true, binary, version };
  } catch (exc: any) {
    return { installed: false, binary, version: "", error: String(exc) };
  }
}

function _analyze_stamp_path(local_dir: string): string {
  return join(local_dir, ".gitnexus-analyze.json");
}

function _head_commit(local_dir: string): string {
  try {
    const proc = gitnexusHooks.run(["git", "-C", local_dir, "rev-parse", "HEAD"], 10);
    return proc.returncode === 0 ? (proc.stdout || "").trim() : "";
  } catch {
    return "";
  }
}

export function analyze_already_done(local_dir: string): { skip: boolean; commitId: string; reason: string } {
  const commitId = _head_commit(local_dir);
  const stamp_path = _analyze_stamp_path(local_dir);
  if (existsSync(stamp_path)) {
    try {
      const stamp = JSON.parse(readFileSync(stamp_path, "utf8"));
      if (stamp.ok && commitId && stamp.commitId === commitId) {
        return { skip: true, commitId, reason: "graph already built for this commit" };
      }
    } catch {
      // fall through
    }
  }
  return { skip: false, commitId, reason: "" };
}

function _write_analyze_stamp(local_dir: string, commitId: string, ok: boolean): void {
  try {
    writeFileSync(
      _analyze_stamp_path(local_dir),
      JSON.stringify({ ok, commitId, analyzedAt: Date.now() / 1000 }, null, 2),
      "utf8",
    );
  } catch {
    // pass
  }
}

function _install_command(): [string[], string] | [null, string] {
  const npm = gitnexusHooks.which("npm");
  if (npm) return [[npm, "install", "-g", "gitnexus@latest"], "npm"];
  const pnpm = gitnexusHooks.which("pnpm");
  if (pnpm) return [[pnpm, "add", "-g", "gitnexus@latest"], "pnpm"];
  return [null, "node/npm missing (need Node.js >= 18)"];
}

export function install_once(force = false): Record<string, any> {
  // Installing a global npm package is a visible side effect on the operator's machine;
  // let them opt out (the analysis then falls back to grep/find).
  if (["1", "true", "yes"].includes(String(process.env.DETECTION_SKIP_GITNEXUS || "").toLowerCase())) {
    return {
      attempted: false,
      skipped: true,
      ok: false,
      reason: "DETECTION_SKIP_GITNEXUS is set; skipping global gitnexus install (grep/find fallback)",
    };
  }
  const stamp = _read_stamp();
  if (stamp.attempted && !stamp.ok && !force) {
    return {
      attempted: false,
      skipped: true,
      ok: false,
      reason: "previous install failed; use --force-install to retry",
      error: stamp.error || "",
    };
  }

  const [cmd, manager] = _install_command();
  if (!cmd) {
    const result = { attempted: true, ok: false, manager: "", error: manager };
    _write_stamp({ ...result, attemptedAt: Date.now() / 1000 });
    return result;
  }

  let result: Record<string, any>;
  try {
    const proc = gitnexusHooks.run(cmd, INSTALL_TIMEOUT);
    const ok = proc.returncode === 0;
    const err = ok ? "" : (proc.stderr || proc.stdout || "").slice(0, 500);
    result = {
      attempted: true,
      ok,
      manager,
      error: err,
      returncode: proc.returncode,
    };
  } catch (exc: any) {
    if (exc && exc.name === "TimeoutExpired") {
      result = {
        attempted: true,
        ok: false,
        manager,
        error: `install timed out after ${INSTALL_TIMEOUT}s`,
      };
    } else {
      result = { attempted: true, ok: false, manager, error: String(exc) };
    }
  }
  _write_stamp({ ...result, attemptedAt: Date.now() / 1000 });
  return result;
}

export function analyze(local_dir: string): Record<string, any> {
  return run_cli("analyze", local_dir ? [local_dir] : [], local_dir, ANALYZE_TIMEOUT);
}

export function run_cli(
  subcommand: string,
  extra: string[] | null = null,
  local_dir: string | null = null,
  timeout = 60,
): Record<string, any> {
  const binary = gitnexusHooks.which("gitnexus");
  if (!binary) {
    return { ok: false, error: "gitnexus not on PATH" };
  }
  const cwd = local_dir || null;
  if (cwd) {
    try {
      if (!statSync(cwd).isDirectory()) {
        return { ok: false, error: `local_dir not found: ${cwd}` };
      }
    } catch {
      return { ok: false, error: `local_dir not found: ${cwd}` };
    }
  }
  const cmd = [binary, subcommand, ...(extra || [])];
  try {
    const proc = gitnexusHooks.run(cmd, timeout, cwd);
    const payload: Record<string, any> = {
      ok: proc.returncode === 0,
      command: cmd,
      returncode: proc.returncode,
      output: (proc.stdout || "").slice(0, 8000),
    };
    if (proc.returncode !== 0) {
      payload.error = (proc.stderr || proc.stdout || "").slice(0, 800);
    } else if (subcommand === "analyze") {
      payload.output = (proc.stdout || "").slice(0, 400);
    }
    return payload;
  } catch (exc: any) {
    if (exc && exc.name === "TimeoutExpired") {
      return { ok: false, error: `gitnexus ${subcommand} timed out after ${timeout}s` };
    }
    return { ok: false, error: String(exc) };
  }
}

export function ensure(
  force_install = false,
  local_dir: string | null = null,
  run_analyze = true,
): Record<string, any> {
  let found = detect(true);
  const out: Record<string, any> = {
    ready: false,
    fallback: "none",
    detected: found,
    install: null,
    analyze: null,
    callGraph: "gitnexus",
  };
  if (!found.installed) {
    out.install = install_once(force_install);
    found = detect(false);
    out.detected = found;
  }

  if (found.installed) {
    out.ready = true;
    if (run_analyze && local_dir) {
      const prior = analyze_already_done(local_dir);
      if (prior.skip) {
        out.analyze = { ok: true, skipped: true, reason: prior.reason, commitId: prior.commitId };
        return out;
      }
      const analyzed = analyze(local_dir);
      out.analyze = analyzed;
      _write_analyze_stamp(local_dir, prior.commitId, Boolean(analyzed.ok));
      if (!analyzed.ok) {
        out.ready = false;
        out.fallback = "grep";
        out.callGraph = "grep";
        out.nextActions = [
          "gitnexus is installed but analyze failed; Phase 2 STEP B uses grep/find.",
        ];
        return out;
      }
    }
    return out;
  }

  out.fallback = "grep";
  out.callGraph = "grep";
  out.nextActions = [
    "GitNexus install failed or is unavailable. Phase 2 STEP B uses grep/find.",
    "Agent may retry once with: node detect.ts ensure-gitnexus --force-install",
    "If Node/npm is missing, install Node.js >= 18, then --force-install. Otherwise continue with grep.",
  ];
  return out;
}
