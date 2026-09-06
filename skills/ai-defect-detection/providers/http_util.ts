import { spawnSync } from "node:child_process";

export class HttpError extends Error {
  status: number | null;
  body: string;
  constructor(message: string, status: number | null = null, body = "") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export function request_json(
  method: string,
  url: string,
  opts: {
    headers?: Record<string, string> | null;
    params?: Record<string, any> | null;
    body?: any;
    timeout?: number;
  } = {},
): Record<string, any> {
  let finalUrl = url;
  if (opts.params) {
    const filtered = Object.entries(opts.params).filter(([, v]) => v !== undefined && v !== null);
    if (filtered.length) {
      const qs = new URLSearchParams();
      for (const [k, v] of filtered) qs.set(k, String(v));
      finalUrl = `${url}?${qs.toString()}`;
    }
  }
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers || {}) };
  const timeout = opts.timeout ?? 30;
  const spec = JSON.stringify({
    method,
    url: finalUrl,
    headers,
    body: opts.body === undefined ? null : opts.body,
    timeout,
  });
  const script = `
const spec = JSON.parse(process.env.HTTP_SPEC || "{}");
const ctrl = AbortSignal.timeout((spec.timeout || 30) * 1000);
const init = { method: spec.method, headers: spec.headers || {}, signal: ctrl };
if (spec.body != null) {
  init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
  init.body = JSON.stringify(spec.body);
}
try {
  const res = await fetch(spec.url, init);
  const text = await res.text();
  if (!res.ok) {
    process.stdout.write(JSON.stringify({ __httpError: true, status: res.status, body: text.slice(0, 500) }));
    process.exit(2);
  }
  process.stdout.write(text || "{}");
} catch (e) {
  process.stdout.write(JSON.stringify({ __httpError: true, status: null, body: String(e) }));
  process.exit(3);
}
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, HTTP_SPEC: spec },
    maxBuffer: 20 * 1024 * 1024,
  });
  const raw = (result.stdout || "").trim();
  if (result.status === 2 || result.status === 3) {
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      parsed = { body: raw };
    }
    if (result.status === 3) {
      throw new HttpError(`request failed: ${parsed.body || raw}`);
    }
    throw new HttpError(`HTTP ${parsed.status}: ${parsed.body || ""}`, parsed.status, parsed.body || "");
  }
  if (result.status !== 0) {
    throw new HttpError(`request failed: ${result.stderr || raw || "spawn error"}`);
  }
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
    return { data };
  } catch {
    throw new HttpError(`non-JSON response: ${raw.slice(0, 300)}`);
  }
}

export function ok(data: any = null, msg = "success"): Record<string, any> {
  return { code: 0, msg, data };
}

export function fail(msg: string, code = -1): Record<string, any> {
  return { code, msg, data: null };
}
