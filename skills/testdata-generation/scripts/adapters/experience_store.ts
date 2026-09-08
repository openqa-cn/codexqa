#!/usr/bin/env node
/** Proven-method store: local JSON or remote HTTP. */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, isFile, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

function tokens(text: string): Set<string> {
  const parts = text
    .split("")
    .map((ch) => (/[a-zA-Z0-9]/.test(ch) ? ch.toLowerCase() : " "))
    .join("")
    .split(/\s+/)
    .filter((p) => p.length > 1);
  return new Set(parts);
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter += 1;
  return inter / new Set([...left, ...right]).size;
}

export class ExperienceStore {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("experience_store");
  }

  async fetch(
    queries: JsonObject[],
    domain: string | null = null,
    topK = 3,
    minSimilarity = 0.15,
  ): Promise<JsonObject> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.fetchHttp(queries, domain, topK, minSimilarity);
      if (remote.ok) return remote;
    }
    return this.fetchLocal(queries, domain, topK, minSimilarity);
  }

  async report(body: JsonObject): Promise<JsonObject> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.postHttp("report_path", "/v1/experience/report", body);
      if (remote.ok) return remote;
    }
    return this.reportLocal(body);
  }

  async feedback(body: JsonObject): Promise<JsonObject> {
    const kind = String(this.block.type || "local");
    if (kind === "http") {
      const remote = await this.postHttp("feedback_path", "/v1/experience/feedback", body);
      if (remote.ok) return remote;
    }
    return this.feedbackLocal(body);
  }

  private dir(): string {
    const path = expandUser(String(this.block.path || "./testdata/experience"));
    mkdirSync(path, { recursive: true });
    return path;
  }

  private indexPath(): string {
    return join(this.dir(), "entries.json");
  }

  private load(): JsonObject[] {
    const path = this.indexPath();
    if (!isFile(path)) return [];
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(data)) return data as JsonObject[];
      return Array.isArray(data.entries) ? (data.entries as JsonObject[]) : [];
    } catch {
      return [];
    }
  }

  private save(entries: JsonObject[]): void {
    writeFileSync(this.indexPath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  }

  private fetchLocal(queries: JsonObject[], domain: string | null, topK: number, minSimilarity: number): JsonObject {
    const entries = this.load();
    const results: JsonObject[] = [];
    for (const query of queries) {
      const key = String(query.key || query.registry_key || "");
      const text = String(query.query_text || query.query || key);
      const matches: JsonObject[] = [];
      for (const entry of entries) {
        if (domain && entry.domain && entry.domain !== domain) continue;
        const invocation = (entry.proven_invocation && typeof entry.proven_invocation === "object"
          ? entry.proven_invocation
          : {}) as JsonObject;
        const aliases = Array.isArray(entry.aliases) ? entry.aliases.join(" ") : "";
        const hay = [entry.registry_key, aliases, invocation.invokeCmdTemplate].map((v) => String(v || "")).join(" ");
        const sim = Math.max(similarity(text, hay), similarity(key, String(entry.registry_key || "")));
        if (sim >= minSimilarity) matches.push({ ...entry, similarity: Math.round(sim * 10000) / 10000 });
      }
      matches.sort((a, b) => Number(b.similarity || 0) - Number(a.similarity || 0) || Number(b.confidence || 0) - Number(a.confidence || 0));
      results.push({ key, matches: matches.slice(0, topK) });
    }
    return { ok: true, data: { results } };
  }

  private reportLocal(body: JsonObject): JsonObject {
    const entries = this.load();
    const entry = { ...body };
    entry.experience_id ??= randomUUID();
    entry.created_at ??= new Date().toISOString();
    entries.push(entry);
    this.save(entries);
    return { ok: true, data: { experience_id: entry.experience_id } };
  }

  private feedbackLocal(body: JsonObject): JsonObject {
    const entries = this.load();
    const target = String(body.experience_id || "");
    for (const entry of entries) {
      if (String(entry.experience_id || "") === target) {
        const feedbacks = Array.isArray(entry.feedback) ? (entry.feedback as JsonObject[]) : [];
        feedbacks.push({
          outcome: body.outcome ?? null,
          contributor: body.contributor ?? null,
          fail_reason: body.fail_reason ?? null,
          at: new Date().toISOString(),
        });
        entry.feedback = feedbacks;
        this.save(entries);
        return { ok: true, data: { experience_id: target } };
      }
    }
    appendFileSync(join(this.dir(), "feedback.jsonl"), `${JSON.stringify(body)}\n`, "utf8");
    return { ok: true, data: { appended: true } };
  }

  private async fetchHttp(
    queries: JsonObject[],
    domain: string | null,
    topK: number,
    minSimilarity: number,
  ): Promise<JsonObject> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "experience store base_url is empty" };
    const url = joinUrl(base, String(http.fetch_path || "/v1/experience/fetch"));
    return requestJson(
      url,
      "POST",
      { queries, domain, top_k: topK, min_similarity: minSimilarity },
      await this.auth.headers(),
    );
  }

  private async postHttp(pathKey: string, defaultPath: string, body: JsonObject): Promise<JsonObject> {
    const http = this.httpBlock();
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "experience store base_url is empty" };
    const url = joinUrl(base, String(http[pathKey] || defaultPath));
    return requestJson(url, "POST", body, await this.auth.headers());
  }

  private httpBlock(): JsonObject {
    return this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
  }
}
