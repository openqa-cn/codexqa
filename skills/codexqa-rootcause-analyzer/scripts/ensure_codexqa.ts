import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const PACKAGE_NAME = "@openqa-cn/codexqa";
export const BINARY_NAME = "codexqa";
export const NPM_REGISTRY = "https://registry.npmjs.org/";
export const INSTALL_TIMEOUT = 300;
export const INDEX_TIMEOUT = 600;
export const QUERY_TIMEOUT = 60;
export const VERSION_TIMEOUT = 20;
export const QUERY_CONCURRENCY = 6;
const MAX_CAPTURE = 20 * 1024 * 1024;

export type RunResult = { returncode: number; stdout: string; stderr: string; parsed?: any };

export const codexqaHooks = {
  which: _which,
  run: _run,
  runAsync: _runAsync_dispatch,
};

function _runAsync_dispatch(cmd: string[], timeout: number, cwd: string | null = null): Promise<RunResult> {
  if (codexqaHooks.run !== _run) {
    return Promise.resolve(codexqaHooks.run(cmd, timeout, cwd));
  }
  return _runAsync(cmd, timeout, cwd);
}

function _which(cmd: string): string | null {
  if (!cmd) return null;
  if (cmd.includes("/") || cmd.includes("\\")) {
    return existsSync(cmd) ? cmd : null;
  }
  const pathEnv = process.env.PATH || "";
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE").split(";") : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

function _run(cmd: string[], timeout: number, cwd: string | null = null): RunResult {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    timeout: timeout * 1000,
    cwd: cwd || undefined,
    maxBuffer: MAX_CAPTURE,
  });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ETIMEDOUT") {
      const e: any = new Error(`Command '${cmd[0]}' timed out after ${timeout} seconds`);
      e.name = "TimeoutExpired";
      throw e;
    }
    throw result.error;
  }
  return {
    returncode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function _runAsync(cmd: string[], timeout: number, cwd: string | null = null): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: cwd || undefined,
      timeout: timeout * 1000,
    });
    let stdout = "";
    let stderr = "";
    const bump = (buf: Buffer | string, which: "out" | "err") => {
      const chunk = String(buf);
      if (which === "out") {
        stdout += chunk;
        if (stdout.length > MAX_CAPTURE) child.kill("SIGTERM");
      } else {
        stderr += chunk;
      }
    };
    child.stdout?.on("data", (d) => bump(d, "out"));
    child.stderr?.on("data", (d) => bump(d, "err"));
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ETIMEDOUT") {
        const e: any = new Error(`Command '${cmd[0]}' timed out after ${timeout} seconds`);
        e.name = "TimeoutExpired";
        reject(e);
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ returncode: code ?? 1, stdout, stderr });
    });
  });
}

function try_parse_json(text: string): any {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function binary_path(): string | null {
  return codexqaHooks.which(BINARY_NAME);
}

export function ensure_binary(forceInstall = false): {
  ready: boolean;
  binary: string | null;
  install: Record<string, any> | null;
  error?: string;
} {
  let bin = binary_path();
  if (bin && !forceInstall) {
    try {
      const ver = codexqaHooks.run([bin, "--version"], VERSION_TIMEOUT);
      if (ver.returncode === 0) {
        return { ready: true, binary: bin, install: null };
      }
    } catch {
      // fall through to install
    }
  }

  const npm = codexqaHooks.which("npm");
  if (!npm) {
    return { ready: false, binary: bin, install: null, error: "npm not found; cannot install CodexQA CLI" };
  }

  const installCmd = [npm, "install", "-g", PACKAGE_NAME, "--registry", NPM_REGISTRY];
  let installResult: RunResult;
  try {
    installResult = codexqaHooks.run(installCmd, INSTALL_TIMEOUT);
  } catch (err: any) {
    return {
      ready: false,
      binary: bin,
      install: { ok: false, manager: "npm", error: String(err?.message || err) },
      error: String(err?.message || err),
    };
  }

  bin = binary_path();
  if (!bin && installResult.returncode === 0) {
    try {
      const prefix = codexqaHooks.run([npm, "prefix", "-g"], VERSION_TIMEOUT);
      const root = (prefix.stdout || "").trim();
      const candidate = join(root, "bin", BINARY_NAME);
      if (existsSync(candidate)) bin = candidate;
    } catch {
      // ignore
    }
  }

  const ok = !!(bin && installResult.returncode === 0);
  return {
    ready: ok,
    binary: bin,
    install: {
      ok,
      manager: "npm",
      package: PACKAGE_NAME,
      returncode: installResult.returncode,
      stderr: installResult.stderr,
    },
    error: ok ? undefined : installResult.stderr || "codexqa install failed",
  };
}

export function run_cli(args: string[], cwd: string | null = null, timeout = QUERY_TIMEOUT): RunResult {
  const bin = binary_path();
  if (!bin) {
    return { returncode: 1, stdout: "", stderr: "codexqa binary not found", parsed: null };
  }
  const result = codexqaHooks.run([bin, ...args], timeout, cwd);
  result.parsed = try_parse_json(result.stdout);
  return result;
}

export async function run_cli_async(
  args: string[],
  cwd: string | null = null,
  timeout = QUERY_TIMEOUT,
): Promise<RunResult> {
  const bin = binary_path();
  if (!bin) {
    return { returncode: 1, stdout: "", stderr: "codexqa binary not found", parsed: null };
  }
  const result = await codexqaHooks.runAsync([bin, ...args], timeout, cwd);
  result.parsed = try_parse_json(result.stdout);
  return result;
}

export function index_repo(local_dir: string, full = false): RunResult {
  const args = ["index", "--format", "json"];
  if (full) args.push("--full");
  args.push(local_dir);
  return run_cli(args, local_dir, INDEX_TIMEOUT);
}

export function run_query(local_dir: string, op: string, extra: string[] | null = null): RunResult {
  return run_cli(["query", "--repo", local_dir, op, ...(extra || [])], local_dir, QUERY_TIMEOUT);
}

export async function run_query_async(
  local_dir: string,
  op: string,
  extra: string[] | null = null,
): Promise<RunResult> {
  return run_cli_async(["query", "--repo", local_dir, op, ...(extra || [])], local_dir, QUERY_TIMEOUT);
}

export async function map_limit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const n = Math.max(1, limit);
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(n, Math.max(1, items.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

export function run_stats(local_dir: string): RunResult {
  return run_cli(["stats", "--format", "json", local_dir], local_dir, QUERY_TIMEOUT);
}

export function nodes_from_parsed(parsed: any): any[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (parsed.kind === "Nodes" && Array.isArray(parsed.nodes)) return parsed.nodes;
  if (parsed.kind === "NodeDetail" && parsed.node) return [parsed.node];
  if (parsed.kind === "GraphReach" && parsed.result) {
    const hops = Array.isArray(parsed.result.hops) ? parsed.result.hops.flat() : [];
    return parsed.result.root ? [parsed.result.root, ...hops] : hops;
  }
  if (parsed.kind === "ShortestPath" && Array.isArray(parsed.result?.path)) return parsed.result.path;
  for (const key of ["nodes", "symbols", "items", "data", "results"]) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  if (parsed.id || parsed.qualifiedName || parsed.name) return [parsed];
  return [];
}

export function edges_from_parsed(parsed: any): any[] {
  if (!parsed) return [];
  if (parsed.kind === "Edges" && Array.isArray(parsed.edges)) return parsed.edges;
  if (parsed.kind === "GraphReach" && Array.isArray(parsed.result?.edges)) return parsed.result.edges;
  if (Array.isArray(parsed.edges)) return parsed.edges;
  return [];
}

export function compact_node(s: any): Record<string, any> {
  if (!s) return {};
  const namespace = s.namespace || "";
  const name = s.name || s.label || s.target || "";
  return {
    id: s.id || s.symbolId || "",
    kind: s.kind || "",
    name,
    qualifiedName:
      s.qualifiedName ||
      s.qualified_name ||
      (namespace && name ? `${namespace}::${name}` : name),
    file: s.file_path || s.filePath || s.file || s.path || "",
    startLine: s.start_line ?? s.startLine ?? null,
    endLine: s.end_line ?? s.endLine ?? null,
    language: s.language || "",
    namespace,
  };
}

export function files_from_parsed(parsed: any): string[] {
  if (!parsed) return [];
  if (parsed.kind === "Files" && Array.isArray(parsed.files)) {
    return parsed.files.map((f: any) => (typeof f === "string" ? f : f?.path || f?.file || "")).filter(Boolean);
  }
  const raw = parsed.files || parsed.items || parsed.paths;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f: any) => (typeof f === "string" ? f : f?.path || f?.file || f?.file_path || ""))
    .filter(Boolean);
}
