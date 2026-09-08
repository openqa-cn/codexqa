/** Shared loader/resolver for integrations.yaml (Node built-ins only). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CAPABILITIES = [
  "spec_lookup",
  "knowledge_search",
  "env_info",
  "config_lookup",
  "middleware_lookup",
  "experiment_lookup",
] as const;

export const COMPONENT_IDS = ["database", "cache", "mq", "config", "experiment"] as const;
export const AUTH_KINDS = [
  "none",
  "header",
  "query",
  "oauth2_client_credentials",
  "token_exchange",
  "session",
] as const;

const SECRET_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const RAW_SECRET_RE =
  /(bearer\s+[A-Za-z0-9._\-]{12,}|sk-[A-Za-z0-9]{12,}|[A-Fa-f0-9]{32,})/i;

export function skillRoot(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

export function defaultConfigPath(): string {
  return path.join(skillRoot(), "config", "integrations.default.yaml");
}

export function workspaceConfigPath(workspace: string): string {
  return path.join(workspace, ".ai-testcase", "integrations.yaml");
}

export function loadYaml(text: string): unknown {
  const lines: string[] = [];
  for (let raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (raw.includes(" #")) raw = raw.slice(0, raw.indexOf(" #"));
    lines.push(raw.replace(/\s+$/, ""));
  }
  let idx = 0;

  const indentOf = (s: string) => s.length - s.trimStart().length;

  const parseScalar = (s: string): unknown => {
    s = s.trim();
    if (s === "true" || s === "True") return true;
    if (s === "false" || s === "False") return false;
    if (s === "null" || s === "Null" || s === "~" || s === "") return null;
    if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      return s.slice(1, -1);
    }
    return s;
  };

  const parseFlowList = (s: string): unknown[] => {
    const inner = s.trim().slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((p) => parseScalar(p));
  };

  const parseBlock = (minIndent: number): unknown => {
    if (idx >= lines.length) return null;
    const first = lines[idx];
    const ind = indentOf(first);
    if (ind < minIndent) return null;
    if (first.trimStart().startsWith("- ")) {
      const items: unknown[] = [];
      while (
        idx < lines.length &&
        indentOf(lines[idx]) === ind &&
        lines[idx].trimStart().startsWith("- ")
      ) {
        const itemLine = lines[idx].trimStart().slice(2);
        idx += 1;
        if (!itemLine) {
          items.push(parseBlock(ind + 1));
          continue;
        }
        if (itemLine.startsWith("[") && itemLine.endsWith("]")) {
          items.push(parseFlowList(itemLine));
          continue;
        }
        if (itemLine.includes(":") && !itemLine.startsWith("{")) {
          const colon = itemLine.indexOf(":");
          const key = itemLine.slice(0, colon);
          let rest = itemLine.slice(colon + 1).trim();
          const obj: Record<string, unknown> = {};
          if (rest.startsWith("[") && rest.endsWith("]")) {
            obj[key.trim()] = parseFlowList(rest);
          } else if (rest) {
            obj[key.trim()] = parseScalar(rest);
          }
          const child = parseBlock(ind + 2);
          if (child && typeof child === "object" && !Array.isArray(child)) {
            Object.assign(obj, child);
          } else if (child != null && !rest) {
            obj[key.trim()] = child;
          }
          items.push(obj);
        } else {
          items.push(parseScalar(itemLine));
        }
      }
      return items;
    }

    const mapping: Record<string, unknown> = {};
    while (
      idx < lines.length &&
      indentOf(lines[idx]) === ind &&
      !lines[idx].trimStart().startsWith("- ")
    ) {
      const line = lines[idx];
      const stripped = line.trimStart();
      const colon = stripped.indexOf(":");
      const key = (colon >= 0 ? stripped.slice(0, colon) : stripped).trim();
      const rest = (colon >= 0 ? stripped.slice(colon + 1) : "").trim();
      idx += 1;
      if (rest.startsWith("[") && rest.endsWith("]")) {
        mapping[key] = parseFlowList(rest);
      } else if (rest) {
        mapping[key] = parseScalar(rest);
      } else {
        mapping[key] = parseBlock(ind + 2);
      }
    }
    return mapping;
  };

  return parseBlock(0);
}

export function expandEnv(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnv(v);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v));
  if (typeof value === "string") {
    return value.replace(SECRET_RE, (_m, name: string) => {
      if (!(name in process.env) || process.env[name] == null) {
        throw new Error(`environment variable ${name} is not set`);
      }
      return process.env[name] as string;
    });
  }
  return value;
}

export function findRawSecrets(obj: unknown, pathPrefix = ""): string[] {
  const hits: string[] = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      hits.push(...findRawSecrets(v, pathPrefix ? `${pathPrefix}.${k}` : k));
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => hits.push(...findRawSecrets(v, `${pathPrefix}[${i}]`)));
  } else if (typeof obj === "string") {
    SECRET_RE.lastIndex = 0;
    if (SECRET_RE.test(obj)) return hits;
    if (RAW_SECRET_RE.test(obj)) hits.push(pathPrefix);
  }
  return hits;
}

export function jsonpathGet(data: unknown, expr: string): unknown {
  if (!expr || expr === "$") return data;
  if (!expr.startsWith("$")) {
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)[expr]
      : undefined;
  }
  let cur: unknown = data;
  const re = /\.([A-Za-z0-9_]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const key = m[1];
    const idx = m[2];
    if (idx) {
      if (!Array.isArray(cur)) return undefined;
      const n = Number.parseInt(idx, 10);
      if (n >= cur.length) return undefined;
      cur = cur[n];
    } else {
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

export function applyRequestMap(
  requestMap: Record<string, string> | undefined,
  args: Record<string, string>,
): Record<string, string> {
  if (!requestMap || Object.keys(requestMap).length === 0) return { ...args };
  const out: Record<string, string> = {};
  for (const [dest, src] of Object.entries(requestMap)) {
    if (src in args) out[dest] = args[src];
  }
  return out;
}

export function applyResponseMap(
  responseMap: Record<string, string> | undefined,
  body: unknown,
): unknown {
  if (!responseMap || Object.keys(responseMap).length === 0) return body;
  const out: Record<string, unknown> = {};
  for (const [dest, expr] of Object.entries(responseMap)) {
    out[dest] = jsonpathGet(body, expr);
  }
  return out;
}

export function loadConfig(workspace: string): Record<string, unknown> {
  const ws = workspaceConfigPath(workspace);
  const cfgPath = fs.existsSync(ws) && fs.statSync(ws).isFile() ? ws : defaultConfigPath();
  const text = fs.readFileSync(cfgPath, "utf8");
  const data = loadYaml(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`invalid integrations file: ${cfgPath}`);
  }
  const rec = data as Record<string, unknown>;
  rec._source = cfgPath;
  return rec;
}

export function validateHttpExtras(name: string, http: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const query = http.query;
  if (query != null && (typeof query !== "object" || Array.isArray(query))) {
    errors.push(`${name}.http.query must be a mapping`);
  }
  const tls = http.tls;
  if (tls != null) {
    if (typeof tls !== "object" || Array.isArray(tls)) {
      errors.push(`${name}.http.tls must be a mapping`);
    } else {
      const t = tls as Record<string, unknown>;
      if (t.certFile && !t.keyFile) {
        errors.push(`${name}.http.tls.keyFile is required when certFile is set`);
      }
      if (t.keyFile && !t.certFile) {
        errors.push(`${name}.http.tls.certFile is required when keyFile is set`);
      }
    }
  }
  const auth = http.auth;
  if (auth == null) return errors;
  if (typeof auth !== "object" || Array.isArray(auth)) {
    errors.push(`${name}.http.auth must be a mapping`);
    return errors;
  }
  const a = auth as Record<string, unknown>;
  const kind = (a.kind as string) || "none";
  if (!(AUTH_KINDS as readonly string[]).includes(kind)) {
    errors.push(`${name}.http.auth.kind must be one of ${AUTH_KINDS.join(", ")}`);
    return errors;
  }
  const inject = a.inject;
  if (inject != null && (typeof inject !== "object" || Array.isArray(inject))) {
    errors.push(`${name}.http.auth.inject must be a mapping`);
  }
  if (kind === "header" && !a.token) {
    errors.push(`${name}.http.auth.token is required when kind=header`);
  }
  if (kind === "query") {
    if (!a.token) errors.push(`${name}.http.auth.token is required when kind=query`);
    const injectObj =
      inject && typeof inject === "object" && !Array.isArray(inject)
        ? (inject as Record<string, unknown>)
        : null;
    if (!a.queryParam && !(injectObj && injectObj.query)) {
      errors.push(
        `${name}.http.auth.queryParam or inject.query is required when kind=query`,
      );
    }
  }
  if (kind === "oauth2_client_credentials") {
    for (const req of ["tokenUrl", "clientId", "clientSecret"]) {
      if (!a[req]) {
        errors.push(`${name}.http.auth.${req} is required when kind=oauth2_client_credentials`);
      }
    }
    if (a.clientAuth != null && a.clientAuth !== "body" && a.clientAuth !== "basic") {
      errors.push(`${name}.http.auth.clientAuth must be body or basic`);
    }
  }
  if (kind === "token_exchange") {
    if (!a.tokenUrl) {
      errors.push(`${name}.http.auth.tokenUrl is required when kind=token_exchange`);
    }
    if (!a.tokenResponse) {
      errors.push(`${name}.http.auth.tokenResponse is required when kind=token_exchange`);
    }
  }
  if (kind === "session" && !a.loginUrl) {
    errors.push(`${name}.http.auth.loginUrl is required when kind=session`);
  }
  if (kind === "oauth2_client_credentials" || kind === "token_exchange" || kind === "header") {
    if (
      inject &&
      typeof inject === "object" &&
      !Array.isArray(inject) &&
      !(inject as Record<string, unknown>).header &&
      !(inject as Record<string, unknown>).query
    ) {
      errors.push(`${name}.http.auth.inject needs header or query`);
    }
  }
  return errors;
}

export function validateConfig(data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (data.version !== 1) errors.push("version must be 1");
  const profile = (data.profile || {}) as Record<string, unknown>;
  const caps = (data.capabilities || {}) as Record<string, unknown>;
  if (typeof profile !== "object" || Array.isArray(profile)) {
    errors.push("profile must be a mapping");
    return errors;
  }
  const protocols = profile.protocols;
  if (!Array.isArray(protocols) || protocols.length === 0) {
    errors.push("profile.protocols must be a non-empty list");
  }
  const components = profile.components;
  if (!Array.isArray(components) || components.length === 0) {
    errors.push("profile.components must be a non-empty list");
  } else {
    const seen = new Set<string>();
    for (const c of components) {
      if (!c || typeof c !== "object" || !("id" in c) || !("fields" in c)) {
        errors.push("each component needs id and fields");
        continue;
      }
      const rec = c as Record<string, unknown>;
      const id = String(rec.id);
      if (!(COMPONENT_IDS as readonly string[]).includes(id)) {
        errors.push(`unknown component id: ${id}`);
      }
      if (seen.has(id)) errors.push(`duplicate component id: ${id}`);
      seen.add(id);
      if (!Array.isArray(rec.fields) || rec.fields.length === 0) {
        errors.push(`component ${id} fields must be a non-empty list`);
      }
    }
  }
  if (typeof caps !== "object" || Array.isArray(caps)) {
    errors.push("capabilities must be a mapping");
    return errors;
  }
  for (const name of Object.keys(caps)) {
    if (!(CAPABILITIES as readonly string[]).includes(name)) {
      errors.push(`unknown capability: ${name}`);
    }
  }
  for (const [name, capVal] of Object.entries(caps)) {
    if (!capVal || typeof capVal !== "object" || Array.isArray(capVal)) {
      errors.push(`${name} must be a mapping`);
      continue;
    }
    const cap = capVal as Record<string, unknown>;
    if (!("enabled" in cap) || !("provider" in cap)) {
      errors.push(`${name} needs enabled and provider`);
      continue;
    }
    if (cap.provider !== "local" && cap.provider !== "http") {
      errors.push(`${name}.provider must be local or http`);
    }
    if (cap.enabled && cap.provider === "http") {
      const http = cap.http;
      if (!http || typeof http !== "object" || Array.isArray(http)) {
        errors.push(`${name}.http is required when provider=http`);
      } else {
        const h = http as Record<string, unknown>;
        for (const req of ["baseUrl", "path", "method"]) {
          if (!h[req]) errors.push(`${name}.http.${req} is required`);
        }
        if (h.method != null && h.method !== "GET" && h.method !== "POST") {
          errors.push(`${name}.http.method must be GET or POST`);
        }
        if (!h.responseMap) errors.push(`${name}.http.responseMap is required`);
        if (h.method === "POST" && !h.requestMap) {
          errors.push(`${name}.http.requestMap is required`);
        }
        errors.push(...validateHttpExtras(name, h));
      }
    }
  }
  errors.push(
    ...findRawSecrets(data.capabilities || {}).map((p) => `possible raw secret at ${p}`),
  );
  return errors;
}

const DEFAULT_LABELS: Record<string, string> = {
  database: "Database",
  cache: "Cache",
  mq: "MQ",
  config: "Config service",
  experiment: "Experiment",
};

export function resolvePublic(data: Record<string, unknown>): Record<string, unknown> {
  const caps: Record<string, unknown> = {};
  const srcCaps = (data.capabilities || {}) as Record<string, Record<string, unknown>>;
  for (const name of CAPABILITIES) {
    const cap = srcCaps[name] || { enabled: false, provider: "local", fallback: "local" };
    const http = (cap.http || {}) as Record<string, unknown>;
    const auth =
      http.auth && typeof http.auth === "object" && !Array.isArray(http.auth)
        ? (http.auth as Record<string, unknown>)
        : {};
    const tls =
      http.tls && typeof http.tls === "object" && !Array.isArray(http.tls)
        ? (http.tls as Record<string, unknown>)
        : {};
    caps[name] = {
      enabled: Boolean(cap.enabled),
      provider: cap.provider || "local",
      fallback: cap.fallback || "local",
      hasHttp: Boolean(http.baseUrl && http.path),
      authKind: auth.kind || "none",
      hasQuery: Boolean(http.query),
      hasTls: Boolean(tls.certFile || tls.caFile),
    };
  }
  const components: Record<string, unknown>[] = [];
  const profile = (data.profile || {}) as Record<string, unknown>;
  const rawComps = (profile.components || []) as Record<string, unknown>[];
  for (const c of rawComps) {
    components.push({
      id: c.id,
      label: c.label || DEFAULT_LABELS[String(c.id)] || c.id,
      fields: Array.isArray(c.fields) ? [...c.fields] : [],
    });
  }
  return {
    version: 1,
    source: data._source || "",
    profile: {
      protocols: Array.isArray(profile.protocols) ? [...profile.protocols] : ["http"],
      mockableProtocols: Array.isArray(profile.mockableProtocols)
        ? [...profile.mockableProtocols]
        : [],
      components,
    },
    capabilities: caps,
  };
}

export function loadResolved(workspace: string): Record<string, unknown> {
  const resolved = path.join(workspace, "usecases", "testdocs", "integrations-resolved.json");
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }
  return resolvePublic(loadConfig(workspace));
}
