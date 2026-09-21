#!/usr/bin/env node
/** Search APIs from local OpenAPI files or an HTTP catalog. */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, isDir, isFile, type JsonObject } from "./config.ts";
import { listSlotOpenApiDirs } from "./slot_roots.ts";
import { joinUrl, requestJson } from "./httputil.ts";
import { WorkspaceContext } from "./workspace_context.ts";

export class ApiCatalog {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("api_catalog");
  }

  async search(query: string, limit = 20): Promise<JsonObject[]> {
    const kind = String(this.block.type || "openapi");
    if (kind === "http") {
      const remote = await this.searchHttp(query, limit);
      if (remote.length) return remote;
    }
    return this.searchLocal(query, limit);
  }

  async detail(operationId: string): Promise<JsonObject | null> {
    const kind = String(this.block.type || "openapi");
    if (kind === "http") {
      const remote = await this.detailHttp(operationId);
      if (remote) return remote;
    }
    return this.iterLocal().find((item) => item.operationId === operationId || item.id === operationId) || null;
  }

  async searchPlanChanges(planId: string): Promise<JsonObject[]> {
    const kind = String(this.block.type || "openapi");
    if (kind === "http") {
      const remote = await this.planChangesHttp(planId);
      if (remote.length) return remote;
    }
    const ctx = new WorkspaceContext(this.cfg, this.auth);
    const apis = ctx.changedApis();
    if (apis.length) {
      const out: JsonObject[] = [];
      for (const raw of apis) {
        if (raw && typeof raw === "object" && !Array.isArray(raw)) out.push(raw as JsonObject);
        else if (typeof raw === "string") {
          const found = await this.detail(raw);
          out.push(found || { id: raw, operationId: raw });
        }
      }
      return out;
    }
    return this.search(planId);
  }

  async listByService(serviceId: string, name: string | null = null): Promise<JsonObject[]> {
    const kind = String(this.block.type || "openapi");
    if (kind === "http") {
      const remote = await this.listHttp(serviceId, name);
      if (remote.length) return remote;
    }
    const tokens = (name || "").replace(/[/-]/g, " ").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    const out: JsonObject[] = [];
    for (const item of this.iterLocal()) {
      const blob = [item.serviceId, item.operationId, item.summary, item.path, item.source]
        .map((v) => String(v || ""))
        .join(" ")
        .toLowerCase();
      if (!blob.includes(serviceId.toLowerCase())) continue;
      if (tokens.length && !tokens.some((t) => blob.includes(t))) continue;
      out.push(item);
    }
    return out;
  }

  private async detailHttp(operationId: string): Promise<JsonObject | null> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return null;
    const url = joinUrl(base, String(http.detail_path || "/v1/apis/detail"));
    const resp = await requestJson(url, "POST", { operationId }, await this.auth.headers());
    if (!resp.ok || !resp.data || typeof resp.data !== "object" || Array.isArray(resp.data)) return null;
    return resp.data as JsonObject;
  }

  private async planChangesHttp(planId: string): Promise<JsonObject[]> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return [];
    const url = joinUrl(base, String(http.plan_changes_path || "/v1/apis/plan-changes"));
    const resp = await requestJson(url, "POST", { planId }, await this.auth.headers());
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    return Array.isArray(data.items) ? (data.items as JsonObject[]) : [];
  }

  private async listHttp(serviceId: string, name: string | null): Promise<JsonObject[]> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return [];
    const url = joinUrl(base, String(http.list_path || "/v1/apis/list"));
    const body: JsonObject = { serviceId };
    if (name) body.name = name;
    const resp = await requestJson(url, "POST", body, await this.auth.headers());
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    return Array.isArray(data.items) ? (data.items as JsonObject[]) : [];
  }

  private async searchHttp(query: string, limit: number): Promise<JsonObject[]> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return [];
    const url = joinUrl(base, String(http.search_path || "/v1/apis/search"));
    const resp = await requestJson(url, "POST", { query, limit }, await this.auth.headers());
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    return Array.isArray(data.items) ? (data.items as JsonObject[]) : [];
  }

  private searchLocal(query: string, limit: number): JsonObject[] {
    const tokens = query.replace(/[/-]/g, " ").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    const scored: JsonObject[] = [];
    for (const item of this.iterLocal()) {
      const blob = [item.operationId, item.summary, item.path, item.method]
        .map((v) => String(v || ""))
        .join(" ")
        .toLowerCase();
      const score = tokens.reduce((n, t) => n + (blob.includes(t) ? 1 : 0), 0);
      if (score || !tokens.length) scored.push({ ...item, score });
    }
    scored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return scored.slice(0, limit);
  }

  private iterLocal(): JsonObject[] {
    const items: JsonObject[] = [];
    for (const root of this.roots()) {
      for (const path of walkOpenApi(root)) items.push(...this.parseOpenapi(path));
    }
    return items;
  }

  private roots(): string[] {
    const roots: string[] = [];
    const seen = new Set<string>();
    const add = (path: string) => {
      if (!path || seen.has(path) || !isDir(path)) return;
      seen.add(path);
      roots.push(path);
    };
    for (const dir of listSlotOpenApiDirs()) add(dir);
    const paths = (Array.isArray(this.block.paths) ? this.block.paths : []) as unknown[];
    for (const raw of paths) {
      const path = expandUser(String(raw));
      add(isFile(path) ? path.replace(/[/\\][^/\\]+$/, "") : path);
    }
    return roots;
  }

  private parseOpenapi(path: string): JsonObject[] {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    let spec: unknown;
    if (extname(path).toLowerCase() === ".json") {
      try {
        spec = JSON.parse(text);
      } catch {
        return [];
      }
    } else {
      spec = liteOpenapi(text);
    }
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return [];
    const obj = spec as JsonObject;
    const paths = (obj.paths && typeof obj.paths === "object" ? obj.paths : {}) as JsonObject;
    const servers = Array.isArray(obj.servers) ? obj.servers : [];
    let baseUrl = "";
    if (servers[0] && typeof servers[0] === "object" && !Array.isArray(servers[0])) {
      baseUrl = String((servers[0] as JsonObject).url || "");
    }
    const items: JsonObject[] = [];
    for (const [urlPath, ops] of Object.entries(paths)) {
      if (!ops || typeof ops !== "object" || Array.isArray(ops)) continue;
      for (const [method, op] of Object.entries(ops as JsonObject)) {
        if (method.startsWith("x-") || !op || typeof op !== "object" || Array.isArray(op)) continue;
        const operation = op as JsonObject;
        items.push({
          id: operation.operationId || `${method}:${urlPath}`,
          operationId: operation.operationId || "",
          method: method.toUpperCase(),
          path: urlPath,
          summary: operation.summary || operation.description || "",
          baseUrl,
          source: path,
        });
      }
    }
    return items;
  }

  private httpBlock(): JsonObject {
    return this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
  }
}

function walkOpenApi(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(json|ya?ml)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

export function liteOpenapi(text: string): JsonObject {
  const spec: JsonObject = { paths: {}, servers: [] };
  const paths = spec.paths as JsonObject;
  const servers = spec.servers as JsonObject[];
  let currentPath = "";
  let currentMethod = "";
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.trim();
    if (stripped.startsWith("url:")) {
      servers.push({ url: stripped.split(":").slice(1).join(":").trim().replace(/^"|"$/g, "") });
    }
    if (stripped.startsWith("/") && stripped.endsWith(":")) {
      currentPath = stripped.slice(0, -1);
      if (!paths[currentPath]) paths[currentPath] = {};
      section = "path";
      continue;
    }
    if (section === "path" && stripped.endsWith(":") && ["get", "post", "put", "patch", "delete"].includes(stripped.slice(0, -1))) {
      currentMethod = stripped.slice(0, -1);
      (paths[currentPath] as JsonObject)[currentMethod] = {};
      continue;
    }
    if (currentPath && currentMethod && stripped.startsWith("operationId:")) {
      (paths[currentPath] as JsonObject)[currentMethod] = {
        ...((paths[currentPath] as JsonObject)[currentMethod] as JsonObject),
        operationId: stripped.split(":").slice(1).join(":").trim(),
      };
    }
    if (currentPath && currentMethod && stripped.startsWith("summary:")) {
      (paths[currentPath] as JsonObject)[currentMethod] = {
        ...((paths[currentPath] as JsonObject)[currentMethod] as JsonObject),
        summary: stripped.split(":").slice(1).join(":").trim().replace(/^"|"$/g, ""),
      };
    }
    if (currentPath && currentMethod && stripped.startsWith("description:")) {
      (paths[currentPath] as JsonObject)[currentMethod] = {
        ...((paths[currentPath] as JsonObject)[currentMethod] as JsonObject),
        description: stripped.split(":").slice(1).join(":").trim().replace(/^"|"$/g, ""),
      };
    }
  }
  return spec;
}
