/** Call one integration capability. stdout is a single JSON object. */

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { parseArgs } from "node:util";
import { URL } from "node:url";
import {
  CAPABILITIES,
  applyRequestMap,
  applyResponseMap,
  expandEnv,
  jsonpathGet,
  loadConfig,
  workspaceConfigPath,
} from "./integrations_lib.ts";

type Dict = Record<string, unknown>;
type Cookie = { name: string; value: string };

const TOKEN_CACHE = new Map<string, { token: string; exp: number }>();

function emit(payload: Dict, code = 0): number {
  console.log(JSON.stringify(payload));
  return code;
}

function errText(exc: unknown): string {
  if (exc instanceof Error) return exc.message;
  return String(exc);
}

function parseKv(items: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const eq = item.indexOf("=");
    if (eq < 0) throw new Error(`invalid --arg ${JSON.stringify(item)}, expected key=value`);
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

function isMacJunk(name: string): boolean {
  return name === "__MACOSX" || name === ".DS_Store" || name.startsWith("._");
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const name of fs.readdirSync(dir)) {
      if (isMacJunk(name)) continue;
      const p = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) out.push(p);
    }
  }
  return out;
}

function localSpecLookup(workspace: string, args: Record<string, string>): Dict {
  const specs = path.join(workspace, "prd", "specs");
  const hits: string[] = [];
  const needle = [args.serviceId, args.method].filter(Boolean).join(" ");
  if (fs.existsSync(specs) && fs.statSync(specs).isDirectory() && needle.trim()) {
    const parts = needle.split(/\s+/).filter(Boolean);
    for (const p of walkFiles(specs)) {
      let text = "";
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        continue;
      }
      if (parts.every((part) => text.includes(part) || p.includes(part))) {
        hits.push(path.relative(workspace, p));
      }
    }
  }
  return {
    qualifiedName: null,
    protocol: null,
    requestExample: null,
    responseExample: null,
    source: hits.length ? "local:prd/specs" : "local:none",
    paths: hits.slice(0, 20),
  };
}

function localKnowledgeSearch(workspace: string, args: Record<string, string>): Dict {
  const roots = [path.join(workspace, "knowledge")];
  if (args.knowledgePath) roots.push(args.knowledgePath);
  const terms = (args.query || "").split(/\s+/).filter(Boolean);
  const hits: Dict[] = [];
  const allow = new Set([".md", ".json", ".txt", ".yml", ".yaml"]);
  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const p of walkFiles(root)) {
      if (!allow.has(path.extname(p).toLowerCase())) continue;
      let text = "";
      try {
        text = fs.readFileSync(p, "utf8");
      } catch {
        continue;
      }
      const base = path.basename(p);
      if (terms.length && !terms.every((t) => text.includes(t) || base.includes(t))) continue;
      const snippet = text.trim().replace(/\n/g, " ").slice(0, 240);
      hits.push({ title: base, uri: p, snippet });
      if (hits.length >= 10) return { hits };
    }
  }
  return { hits };
}

function localEnvInfo(workspace: string, _args: Record<string, string>): Dict {
  const ctx = path.join(workspace, ".project", "context.json");
  let env = "";
  let lane = "";
  if (fs.existsSync(ctx) && fs.statSync(ctx).isFile()) {
    try {
      const data = JSON.parse(fs.readFileSync(ctx, "utf8"));
      const plan = data.testPlan || {};
      env = plan.env || "";
      lane = plan.lane || "";
    } catch {
      /* ignore */
    }
  }
  return { env, lane };
}

function localPending(kind: string, args: Record<string, string>): Dict {
  if (kind === "config_lookup") return { key: args.key, value: null, description: "TBD" };
  if (kind === "middleware_lookup") return { kind: args.kind, fields: {} };
  if (kind === "experiment_lookup") return { experimentKey: args.experimentKey, groups: {} };
  return {};
}

const LOCAL_HANDLERS: Record<
  string,
  (ws: string, a: Record<string, string>) => Dict
> = {
  spec_lookup: localSpecLookup,
  knowledge_search: localKnowledgeSearch,
  env_info: localEnvInfo,
  config_lookup: (ws, a) => localPending("config_lookup", a),
  middleware_lookup: (ws, a) => localPending("middleware_lookup", a),
  experiment_lookup: (ws, a) => localPending("experiment_lookup", a),
};

function mergeQuery(url: string, extra: Record<string, unknown>): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && String(v) !== "") clean[k] = String(v);
  }
  if (!Object.keys(clean).length) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(clean)) u.searchParams.set(k, v);
  return u.toString();
}

class CookieJar {
  cookies: Cookie[] = [];

  absorb(setCookie: string | string[] | undefined) {
    const list = setCookie == null ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of list) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.cookies = this.cookies.filter((c) => c.name.toLowerCase() !== name.toLowerCase());
      this.cookies.push({ name, value });
    }
  }

  header(): string {
    return this.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  keepNames(names: string[]) {
    const allow = new Set(names.map((n) => n.toLowerCase()));
    this.cookies = this.cookies.filter((c) => allow.has(c.name.toLowerCase()));
  }
}

function tlsAgent(tls: Dict | null): https.Agent | undefined {
  if (!tls) return undefined;
  const opts: https.AgentOptions = {};
  if (tls.caFile) {
    if (!fs.existsSync(String(tls.caFile))) {
      throw new Error(`tls.caFile not found: ${tls.caFile}`);
    }
    opts.ca = fs.readFileSync(String(tls.caFile));
  }
  if (tls.certFile) {
    if (!fs.existsSync(String(tls.certFile))) {
      throw new Error(`tls.certFile not found: ${tls.certFile}`);
    }
    if (tls.keyFile && !fs.existsSync(String(tls.keyFile))) {
      throw new Error(`tls.keyFile not found: ${tls.keyFile}`);
    }
    opts.cert = fs.readFileSync(String(tls.certFile));
    if (tls.keyFile) opts.key = fs.readFileSync(String(tls.keyFile));
  }
  return new https.Agent(opts);
}

function requestJson(
  url: string,
  method: string,
  headers: Record<string, string>,
  data: Buffer | null,
  timeout: number,
  agent: https.Agent | undefined,
  jar: CookieJar | null,
): Promise<[number, unknown]> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const hdrs = { ...headers };
    if (data) hdrs["Content-Length"] = String(data.length);
    if (jar) {
      const cookie = jar.header();
      if (cookie) hdrs.Cookie = cookie;
    }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method,
        headers: hdrs,
        agent: u.protocol === "https:" ? agent : undefined,
        timeout: Math.round(timeout * 1000),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (jar) jar.absorb(res.headers["set-cookie"]);
          const status = res.statusCode || 0;
          const raw = Buffer.concat(chunks).toString("utf8");
          let body: unknown = {};
          if (raw.trim()) {
            try {
              body = JSON.parse(raw);
            } catch {
              reject(new Error(`invalid JSON from ${url}`));
              return;
            }
          }
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status} from ${url}`));
            return;
          }
          resolve([status, body]);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timeout from ${url}`));
    });
    if (data) req.write(data);
    req.end();
  });
}

function encodeBody(payload: Dict, contentType: string): Buffer {
  if (contentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      params.set(k, v == null ? "" : String(v));
    }
    return Buffer.from(params.toString(), "utf8");
  }
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function injectToken(headers: Record<string, string>, query: Dict, auth: Dict, token: string) {
  const inject = (auth.inject || {}) as Dict;
  const headerName = inject.header as string | undefined;
  const queryName = (inject.query as string | undefined) || (auth.queryParam as string | undefined);
  if (headerName || !queryName) {
    const name = headerName || "Authorization";
    let prefix = inject.prefix as string | undefined;
    if (prefix == null && name.toLowerCase() === "authorization") prefix = "Bearer ";
    headers[name] = `${prefix || ""}${token}`;
  }
  if (queryName) query[queryName] = token;
}

function cachedToken(key: string, factory: () => Promise<[string, number]>): Promise<string> {
  const now = Date.now() / 1000;
  const hit = TOKEN_CACHE.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.token);
  return factory().then(([token, ttl]) => {
    TOKEN_CACHE.set(key, { token, exp: now + Math.max(30, ttl) });
    return token;
  });
}

async function oauth2Token(
  auth: Dict,
  timeout: number,
  agent: https.Agent | undefined,
): Promise<string> {
  const key = JSON.stringify(["oauth2", auth.tokenUrl, auth.clientId, auth.scope]);
  return cachedToken(key, async () => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...((auth.headers || {}) as Record<string, string>),
    };
    const form: Dict = { grant_type: "client_credentials" };
    if (auth.scope) form.scope = auth.scope;
    if (auth.audience) form.audience = auth.audience;
    const extra = auth.body;
    if (extra && typeof extra === "object" && !Array.isArray(extra)) {
      for (const [k, v] of Object.entries(extra as Dict)) {
        if (!(k in form)) form[k] = v;
      }
    }
    if ((auth.clientAuth || "body") === "basic") {
      headers.Authorization =
        "Basic " + Buffer.from(`${auth.clientId}:${auth.clientSecret}`, "utf8").toString("base64");
    } else {
      form.client_id = auth.clientId;
      form.client_secret = auth.clientSecret;
    }
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) params.set(k, v == null ? "" : String(v));
    const [, body] = await requestJson(
      String(auth.tokenUrl),
      "POST",
      headers,
      Buffer.from(params.toString(), "utf8"),
      timeout,
      agent,
      null,
    );
    const expr = (auth.tokenResponse as string) || "$.access_token";
    let token = jsonpathGet(body, expr);
    if (!token && body && typeof body === "object") token = (body as Dict).access_token;
    if (!token) throw new Error("oauth2 token response missing access_token");
    const ttlExpr = (auth.expiresInResponse as string) || "$.expires_in";
    let ttl = jsonpathGet(body, ttlExpr);
    const n = Number.parseInt(String(ttl), 10);
    return [String(token), Number.isFinite(n) ? n : 300];
  });
}

async function exchangeToken(
  auth: Dict,
  args: Record<string, string>,
  timeout: number,
  agent: https.Agent | undefined,
): Promise<string> {
  const key = JSON.stringify(["exchange", auth.tokenUrl, auth.body || {}]);
  return cachedToken(key, async () => {
    const method = (auth.method as string) || "POST";
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...((auth.headers || {}) as Record<string, string>),
    };
    const payload = {
      ...((auth.body || {}) as Dict),
      ...applyRequestMap((auth.requestMap || {}) as Record<string, string>, args),
    };
    const contentType = (auth.contentType as string) || "application/json";
    let url = String(auth.tokenUrl);
    let data: Buffer | null = null;
    if (method === "GET") {
      url = mergeQuery(url, payload);
    } else {
      if (!headers["Content-Type"]) headers["Content-Type"] = contentType;
      data = encodeBody(payload, contentType);
    }
    const [, body] = await requestJson(url, method, headers, data, timeout, agent, null);
    const token = jsonpathGet(body, (auth.tokenResponse as string) || "$.access_token");
    if (!token) throw new Error("token_exchange response missing token");
    const ttl = jsonpathGet(body, (auth.expiresInResponse as string) || "$.expires_in");
    const n = Number.parseInt(String(ttl), 10);
    return [String(token), Number.isFinite(n) ? n : 300];
  });
}

async function sessionLogin(
  auth: Dict,
  timeout: number,
  agent: https.Agent | undefined,
  jar: CookieJar,
) {
  const method = (auth.method as string) || "POST";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((auth.headers || {}) as Record<string, string>),
  };
  const payload = { ...((auth.body || {}) as Dict) };
  const contentType = (auth.contentType as string) || "application/json";
  let url = String(auth.loginUrl);
  let data: Buffer | null = null;
  if (method === "GET") {
    url = mergeQuery(url, payload);
  } else {
    if (!headers["Content-Type"]) headers["Content-Type"] = contentType;
    data = encodeBody(payload, contentType);
  }
  await requestJson(url, method, headers, data, timeout, agent, jar);
  const names = ((auth.cookieNames || []) as unknown[]).map((n) => String(n));
  if (names.length) jar.keepNames(names);
}

async function applyAuth(
  auth: Dict,
  args: Record<string, string>,
  headers: Record<string, string>,
  query: Dict,
  timeout: number,
  agent: https.Agent | undefined,
  jar: CookieJar | null,
) {
  if (!auth) return;
  const kind = (auth.kind as string) || "none";
  if (kind === "none") return;
  if (kind === "header") {
    injectToken(headers, query, auth, String(auth.token));
    return;
  }
  if (kind === "query") {
    injectToken(
      headers,
      query,
      {
        ...auth,
        inject: {
          query: auth.queryParam || ((auth.inject || {}) as Dict).query,
        },
      },
      String(auth.token),
    );
    return;
  }
  if (kind === "oauth2_client_credentials") {
    injectToken(headers, query, auth, await oauth2Token(auth, timeout, agent));
    return;
  }
  if (kind === "token_exchange") {
    injectToken(headers, query, auth, await exchangeToken(auth, args, timeout, agent));
    return;
  }
  if (kind === "session") {
    if (!jar) throw new Error("session auth requires cookie jar");
    await sessionLogin(auth, timeout, agent, jar);
    return;
  }
  throw new Error(`unsupported auth.kind: ${kind}`);
}

async function httpCall(cap: Dict, args: Record<string, string>): Promise<Dict> {
  const httpCfg = expandEnv(cap.http || {}) as Dict;
  const timeout = Number(httpCfg.timeoutSec || 15);
  const tls = httpCfg.tls && typeof httpCfg.tls === "object" ? (httpCfg.tls as Dict) : null;
  const auth = httpCfg.auth && typeof httpCfg.auth === "object" ? (httpCfg.auth as Dict) : {};
  const jar = auth.kind === "session" ? new CookieJar() : null;
  const agent = tlsAgent(tls);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((httpCfg.headers || {}) as Record<string, string>),
  };
  const query = { ...((httpCfg.query || {}) as Dict) };
  await applyAuth(auth, args, headers, query, timeout, agent, jar);
  let url = mergeQuery(
    `${String(httpCfg.baseUrl).replace(/\/$/, "")}/${String(httpCfg.path).replace(/^\//, "")}`,
    query,
  );
  const method = (httpCfg.method as string) || "POST";
  const payload = applyRequestMap(
    (httpCfg.requestMap || {}) as Record<string, string>,
    args,
  );
  let data: Buffer | null = null;
  if (method === "POST") {
    data = Buffer.from(JSON.stringify(payload), "utf8");
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  } else if (Object.keys(payload).length) {
    url = mergeQuery(url, payload);
  }
  const [status, body] = await requestJson(url, method, headers, data, timeout, agent, jar);
  const mapped = applyResponseMap((httpCfg.responseMap || {}) as Record<string, string>, body);
  return {
    httpStatus: status,
    data: mapped,
    rawKeys: body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [],
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      workspace: { type: "string", default: "." },
      capability: { type: "string" },
      arg: { type: "string", multiple: true, default: [] },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`usage: call_integration.ts [-h] [--workspace WORKSPACE] [--capability CAPABILITY]
                           [--arg ARG]

Call one integration capability

options:
  -h, --help            show this help message and exit
  --workspace WORKSPACE
                        Workspace root
  --capability CAPABILITY
                        Capability name
  --arg ARG             key=value (repeatable)`);
    return 0;
  }
  const capability = values.capability || "";
  if (!(CAPABILITIES as readonly string[]).includes(capability)) {
    return emit({ ok: false, status: "error", error: `unknown capability: ${capability}` }, 2);
  }
  const workspace = path.resolve(values.workspace || ".");
  let kv: Record<string, string>;
  let data: Dict;
  try {
    kv = parseKv((values.arg || []) as string[]);
    data = loadConfig(workspace);
  } catch (exc) {
    return emit({ ok: false, status: "error", error: errText(exc) }, 2);
  }

  const cap = ((data.capabilities as Dict) || {})[capability] as Dict | undefined || {
    enabled: false,
    provider: "local",
    fallback: "local",
  };
  if (!cap.enabled) {
    return emit({
      ok: true,
      status: "skipped",
      capability,
      source: data._source,
      data: {},
    });
  }

  let provider = (cap.provider as string) || "local";
  const fallback = (cap.fallback as string) || "local";

  if (provider === "http") {
    try {
      const result = await httpCall(cap, kv);
      return emit({
        ok: true,
        status: "http",
        capability,
        data: result.data as Dict,
      });
    } catch (exc) {
      if (fallback !== "local") {
        return emit({
          ok: false,
          status: "error",
          capability,
          error: errText(exc),
        }, 1);
      }
      provider = "local";
    }
  }

  const handler = LOCAL_HANDLERS[capability];
  return emit({
    ok: true,
    status: "local",
    capability,
    source: data._source,
    usedWorkspaceConfig: fs.existsSync(workspaceConfigPath(workspace)),
    data: handler(workspace, kv),
  });
}

main().then((code) => process.exit(code));
