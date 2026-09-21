#!/usr/bin/env node
/** Local or HTTP registry of reusable data-build tools. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class ToolRegistry {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("tool_registry");
  }

  async query(query: string, limit = 10): Promise<JsonObject[]> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.queryHttp(query, limit);
      if (remote.length) return remote;
    }
    return this.queryLocal(query, limit);
  }

  async execute(resourceId: string, params: JsonObject | null = null): Promise<JsonObject> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const result = await this.executeHttp(resourceId, params || {});
      if (result.ok || result.data) return result;
    }
    return this.executeLocal(resourceId, params || {});
  }

  async publish(name: string, description: string, scriptPath: string, inputs: JsonObject[]): Promise<JsonObject> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const result = await this.publishHttp(name, description, scriptPath, inputs);
      if (result.ok) return result;
    }
    return this.publishLocal(name, description, scriptPath, inputs);
  }

  async get(resourceId: string): Promise<JsonObject | null> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.getHttp(resourceId);
      if (remote) return remote;
    }
    return this.iterLocal().find((t) => t.id === resourceId || t.name === resourceId) || null;
  }

  async queryInputList(resourceId: string): Promise<JsonObject[]> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.inputsHttp(resourceId);
      if (remote.length) return remote;
    }
    const tool = await this.get(resourceId);
    const inputs = tool?.inputs;
    return Array.isArray(inputs) ? (inputs as JsonObject[]) : [];
  }

  private async getHttp(resourceId: string): Promise<JsonObject | null> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return null;
    const url = joinUrl(base, String(http.get_path || "/v1/tools/get"));
    const resp = await requestJson(url, "POST", { resourceId }, await this.auth.headers());
    if (!resp.ok || !resp.data || typeof resp.data !== "object" || Array.isArray(resp.data)) return null;
    return resp.data as JsonObject;
  }

  private async inputsHttp(resourceId: string): Promise<JsonObject[]> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return [];
    const url = joinUrl(base, String(http.inputs_path || "/v1/tools/inputs"));
    const resp = await requestJson(url, "POST", { resourceId }, await this.auth.headers());
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    const items = data.inputs || data.items || [];
    return Array.isArray(items) ? (items as JsonObject[]) : [];
  }

  private localDir(): string {
    const path = expandUser(String(this.block.path || "./testdata/tools"));
    mkdirSync(path, { recursive: true });
    return path;
  }

  private iterLocal(): JsonObject[] {
    const tools: JsonObject[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(this.localDir()).filter((n) => n.endsWith(".json")).sort();
    } catch {
      return tools;
    }
    for (const name of names) {
      const path = join(this.localDir(), name);
      try {
        const data = JSON.parse(readFileSync(path, "utf8"));
        if (data && typeof data === "object" && !Array.isArray(data)) {
          if (data.id === undefined) data.id = name.replace(/\.json$/, "");
          tools.push(data);
        }
      } catch {
        continue;
      }
    }
    return tools;
  }

  private queryLocal(query: string, limit: number): JsonObject[] {
    const tokens = query.replace(/-/g, " ").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    const scored: JsonObject[] = [];
    for (const tool of this.iterLocal()) {
      const aliases = Array.isArray(tool.aliases) ? tool.aliases.join(" ") : "";
      const blob = [tool.name, tool.description, aliases].map((v) => String(v || "")).join(" ").toLowerCase();
      const score = tokens.reduce((n, t) => n + (blob.includes(t) ? 1 : 0), 0);
      if (score || !tokens.length) scored.push({ ...tool, score });
    }
    scored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return scored.slice(0, limit);
  }

  private executeLocal(resourceId: string, params: JsonObject): JsonObject {
    const tool = this.iterLocal().find((t) => t.id === resourceId || t.name === resourceId);
    if (!tool) return { ok: false, error: `tool not found: ${resourceId}` };
    const script = tool.script;
    if (!script) return { ok: false, error: "tool has no script" };
    const scriptPath = String(script);
    const ext = extname(scriptPath).toLowerCase();
    const runner = ext === ".py" ? "python3" : "node";
    const cmd = [scriptPath, "--json", JSON.stringify(params)];
    try {
      const stdout = execFileSync(runner, cmd, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
      try {
        return { ok: true, data: JSON.parse(stdout) };
      } catch {
        return { ok: true, data: { stdout } };
      }
    } catch (exc) {
      const err = exc as { stderr?: string; status?: number; message?: string };
      return { ok: false, error: (err.stderr || "").trim() || err.message || `exit ${err.status ?? 1}` };
    }
  }

  private publishLocal(name: string, description: string, scriptPath: string, inputs: JsonObject[]): JsonObject {
    const slug = name.toLowerCase().replace(/ /g, "-");
    const payload = { id: slug, name, description, script: scriptPath, inputs };
    const dest = join(this.localDir(), `${slug}.json`);
    writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { ok: true, data: { resourceId: slug, path: dest } };
  }

  private async queryHttp(query: string, limit: number): Promise<JsonObject[]> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return [];
    const url = joinUrl(base, String(http.query_path || "/v1/tools/query"));
    const resp = await requestJson(url, "POST", { query, limit }, await this.auth.headers());
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    return Array.isArray(data.items) ? (data.items as JsonObject[]) : [];
  }

  private async executeHttp(resourceId: string, params: JsonObject): Promise<JsonObject> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "tool registry base_url is empty" };
    const url = joinUrl(base, String(http.execute_path || "/v1/tools/execute"));
    return requestJson(url, "POST", { resourceId, params }, await this.auth.headers());
  }

  private async publishHttp(name: string, description: string, scriptPath: string, inputs: JsonObject[]): Promise<JsonObject> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "tool registry base_url is empty" };
    const url = joinUrl(base, String(http.publish_path || "/v1/tools/publish"));
    return requestJson(
      url,
      "POST",
      { name, description, scriptPath, inputs },
      await this.auth.headers(),
    );
  }

  private httpBlock(): JsonObject {
    return this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
  }
}
