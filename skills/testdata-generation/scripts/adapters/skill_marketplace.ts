#!/usr/bin/env node
/** Discover domain skills from local slot/skill directories or an HTTP market. */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Config, expandUser, type JsonObject } from "./config.ts";
import { listSlotDirs, loadSlotManifest } from "./slot_roots.ts";
import type { AuthAdapter } from "./auth.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class SkillMarketplace {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("skill_marketplace");
  }

  async search(keywords: string[] | string | null = null, limit = 20): Promise<JsonObject[]> {
    if (typeof keywords === "string") keywords = keywords.trim() ? [keywords] : null;
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.searchHttp(keywords, limit);
      if (remote.length) return remote;
    }
    return this.searchLocal(keywords, limit);
  }

  async install(name: string, targetDir: string): Promise<JsonObject> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const result = await this.installHttp(name, targetDir);
      if (result.ok) return result;
    }
    return this.installLocal(name, targetDir);
  }

  private searchLocal(keywords: string[] | null, limit: number): JsonObject[] {
    const matched = this.collectLocal(keywords, limit);
    if (matched.length) return matched;
    if (keywords) return this.collectLocal(null, limit);
    return [];
  }

  private collectLocal(keywords: string[] | null, limit: number): JsonObject[] {
    const results: JsonObject[] = [];
    const seen = new Set<string>();
    for (const dir of listSlotDirs()) {
      const manifest = loadSlotManifest(dir);
      const name = manifest.name;
      const record: JsonObject = {
        id: name,
        name,
        uuid: name,
        description: manifest.description || "",
        domain: manifest.domain || "",
        source: "local",
        skillPath: dir,
        installCmd: `cp -R '${dir}' <target_dir>/${name}`,
        available: true,
      };
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      if (keywords && !SkillMarketplace.matches(record, keywords)) continue;
      seen.add(key);
      results.push(record);
      if (results.length >= limit) return results;
    }
    return results;
  }

  private async searchHttp(keywords: string[] | null, limit: number): Promise<JsonObject[]> {
    const items = await this.httpSearchOnce(keywords, limit);
    if (items.length) return items;
    if (keywords) return this.httpSearchOnce(null, limit);
    return [];
  }

  private async httpSearchOnce(keywords: string[] | null, limit: number): Promise<JsonObject[]> {
    const http = (this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? this.block.http
      : {}) as JsonObject;
    const base = String(http.base_url || "");
    if (!base) return [];
    const url = joinUrl(base, String(http.search_path || "/v1/skills/search"));
    const resp = await requestJson(url, "POST", { keywords: keywords || [], limit }, await this.auth.headers());
    if (!resp.ok) return [];
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    const items = (data.items || data.skills || []) as unknown[];
    const out: JsonObject[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as JsonObject;
      const name = String(row.name || row.id || "");
      out.push({
        id: row.id || name,
        name,
        uuid: row.uuid || name,
        description: row.description || "",
        source: "http",
        skillPath: row.skillPath || "",
        installCmd: row.installCmd || `skill-market install ${name}`,
        available: true,
      });
    }
    return out.slice(0, limit);
  }

  private installLocal(name: string, targetDir: string): JsonObject {
    const matches = this.searchLocal([name], 50).filter((s) => s.name === name);
    if (!matches.length) return { ok: false, error: `skill not found locally: ${name}` };
    const src = String(matches[0].skillPath);
    const dest = join(expandUser(targetDir), name);
    mkdirSync(dirnameSafe(dest), { recursive: true });
    if (existsSync(dest)) return { ok: true, data: { skillPath: dest, alreadyInstalled: true } };
    cpSync(src, dest, { recursive: true });
    return { ok: true, data: { skillPath: dest } };
  }

  private async installHttp(name: string, targetDir: string): Promise<JsonObject> {
    const http = (this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? this.block.http
      : {}) as JsonObject;
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "skill marketplace base_url is empty" };
    const url = joinUrl(base, String(http.install_path || "/v1/skills/install"));
    return requestJson(url, "POST", { name, targetDir: String(targetDir) }, await this.auth.headers());
  }

  static matches(record: JsonObject, keywords: string[]): boolean {
    const blob = [record.name, record.description, record.domain].map((v) => String(v || "")).join(" ").toLowerCase();
    return keywords.some((kw) => kw && blob.includes(kw.toLowerCase()));
  }
}

function dirnameSafe(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx) : ".";
}
