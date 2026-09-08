#!/usr/bin/env node
/** File or HTTP configuration store. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, isFile, type Json, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class ConfigStore {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("config_store");
  }

  async get(key: string, namespace: string | null = null): Promise<JsonObject> {
    if (String(this.block.type || "file") === "http") {
      const remote = await this.http("get_path", "/v1/config/get", { key, namespace });
      if (remote.ok) return remote;
    }
    const data = this.load();
    const scoped = data[namespace || "_"];
    if (scoped && typeof scoped === "object" && !Array.isArray(scoped) && key in (scoped as JsonObject)) {
      return { ok: true, data: (scoped as JsonObject)[key] };
    }
    if (key in data) return { ok: true, data: data[key] };
    return { ok: false, error: `config key not found: ${key}` };
  }

  async set(key: string, value: Json, namespace: string | null = null): Promise<JsonObject> {
    if (String(this.block.type || "file") === "http") {
      const remote = await this.http("set_path", "/v1/config/set", { key, value, namespace });
      if (remote.ok) return remote;
    }
    const data = this.load();
    const bucket = namespace || "_";
    if (data[bucket] === undefined) data[bucket] = {};
    if (data[bucket] && typeof data[bucket] === "object" && !Array.isArray(data[bucket])) {
      (data[bucket] as JsonObject)[key] = value;
    } else {
      data[key] = value;
    }
    this.save(data);
    return { ok: true, data: { key } };
  }

  private path(): string {
    const path = expandUser(String(this.block.path || "./testdata/config-store.yaml"));
    mkdirSync(dirname(path), { recursive: true });
    return path;
  }

  private load(): JsonObject {
    const path = this.path();
    if (!isFile(path)) return {};
    const text = readFileSync(path, "utf8");
    if (path.toLowerCase().endsWith(".json")) {
      try {
        const data = JSON.parse(text);
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    }
    const data: JsonObject = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#") || !line.includes(":")) continue;
      const idx = line.indexOf(":");
      data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    }
    return data;
  }

  private save(data: JsonObject): void {
    const path = this.path();
    if (path.toLowerCase().endsWith(".json")) {
      writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      return;
    }
    const lines: string[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (!(v && typeof v === "object" && !Array.isArray(v))) lines.push(`${k}: ${v}`);
    }
    for (const [ns, inner] of Object.entries(data)) {
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        lines.push(`${ns}:`);
        for (const [key, value] of Object.entries(inner)) lines.push(`  ${key}: ${value}`);
      }
    }
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  }

  private async http(pathKey: string, defaultPath: string, body: JsonObject): Promise<JsonObject> {
    const http = this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "config store base_url is empty" };
    return requestJson(joinUrl(base, String(http[pathKey] || defaultPath)), "POST", body, await this.auth.headers());
  }
}
