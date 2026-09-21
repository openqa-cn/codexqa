#!/usr/bin/env node
/** Shared HTTP helper for example slot executors. */

const DEFAULT_BASE = process.env.DATA_BUILD_API_BASE || "http://127.0.0.1:8765";

export type CallHttpResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

export type ExecutorResult = {
  success: boolean;
  data: unknown;
  error: string | null;
};

export async function callHttp(
  path: string,
  body: unknown = null,
  method = "POST",
  timeout = 30,
): Promise<CallHttpResult> {
  const url = path.startsWith("http") ? path : DEFAULT_BASE.replace(/\/+$/, "") + path;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.DATA_BUILD_TOKEN;
  if (token) headers.Authorization = "Bearer " + token;
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout * 1000),
    });
    const raw = (await resp.text()) || "{}";
    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status}: ${raw.slice(0, 300)}` };
    }
    return { success: true, data: JSON.parse(raw) };
  } catch (exc) {
    return { success: false, error: exc instanceof Error ? exc.message : String(exc) };
  }
}

export type ExecutorHelp = {
  description: string;
  exampleJson: string;
};

export async function runMain(
  mainFn: (params: Record<string, unknown>) => Promise<ExecutorResult> | ExecutorResult,
  argv: string[],
  help?: ExecutorHelp,
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    const script = (argv[1] || "executor.ts").split(/[/\\]/).pop() || "executor.ts";
    const description = help?.description || "Slot executor.";
    const exampleJson = help?.exampleJson || "{}";
    process.stdout.write(
      `Usage: node ${script} [--json '<params>']\n` +
        `\n${description}\n\n` +
        `Options:\n` +
        `  --json <json>   JSON object of executor params\n` +
        `  -h, --help      Show this help and exit\n\n` +
        `Example:\n` +
        `  node ${script} --json '${exampleJson}'\n`,
    );
    return;
  }
  let payload: Record<string, unknown> = {};
  const idx = argv.indexOf("--json");
  if (idx >= 0 && argv[idx + 1] !== undefined) {
    payload = JSON.parse(argv[idx + 1]) as Record<string, unknown>;
  }
  const result = await mainFn(payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
