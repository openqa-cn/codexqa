#!/usr/bin/env node
/** Workspace / test-plan context. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, isFile, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class WorkspaceContext {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("workspace_context");
  }

  load(): JsonObject {
    const candidates: string[] = [];
    const configured = String(this.block.path || "").trim();
    if (configured) candidates.push(expandUser(configured));
    candidates.push("./testdata/context.json", "./.biz/context.json");
    const seen = new Set<string>();
    let lastError: string | null = null;
    for (const path of candidates) {
      const key = isFile(path) ? resolve(path) : path;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isFile(path)) continue;
      try {
        const data = JSON.parse(readFileSync(path, "utf8"));
        if (data && typeof data === "object" && !Array.isArray(data)) {
          return { ok: true, data, path };
        }
      } catch (exc) {
        lastError = exc instanceof Error ? exc.message : String(exc);
      }
    }
    if (lastError) return { ok: false, error: lastError };
    return { ok: true, data: {} };
  }

  planId(): string {
    const loaded = this.load();
    const data = (loaded.data && typeof loaded.data === "object" ? loaded.data : {}) as JsonObject;
    const plan = data.testPlan && typeof data.testPlan === "object" && !Array.isArray(data.testPlan)
      ? (data.testPlan as JsonObject)
      : {};
    return String(plan.id || data.planId || data.testPlanId || "");
  }

  serviceIds(): string[] {
    const loaded = this.load();
    const data = (loaded.data && typeof loaded.data === "object" ? loaded.data : {}) as JsonObject;
    const ids: string[] = [];
    for (const key of ["targetRepositories", "relatedJobs"]) {
      const rows = data[key];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const sid = (row as JsonObject).serviceId || (row as JsonObject).service;
        if (sid && !ids.includes(String(sid))) ids.push(String(sid));
      }
    }
    return ids;
  }

  changedApis(): unknown[] {
    const loaded = this.load();
    const data = (loaded.data && typeof loaded.data === "object" ? loaded.data : {}) as JsonObject;
    const plan = data.testPlan && typeof data.testPlan === "object" && !Array.isArray(data.testPlan)
      ? (data.testPlan as JsonObject)
      : {};
    const apis = plan.changedApis || data.changedApis || [];
    return Array.isArray(apis) ? apis : [];
  }

  async getPlan(planId: string): Promise<JsonObject> {
    if (String(this.block.type || "local") === "http") {
      const http = this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
        ? (this.block.http as JsonObject)
        : {};
      const base = String(http.base_url || "");
      if (base) {
        const url = joinUrl(base, String(http.plan_path || "/v1/test-plans/{id}"), { id: planId });
        const remote = await requestJson(url, "GET", null, await this.auth.headers());
        if (remote.ok) return remote;
      }
    }
    const local = this.load();
    const data = (local.data && typeof local.data === "object" ? local.data : {}) as JsonObject;
    const plan = data.testPlan && typeof data.testPlan === "object" && !Array.isArray(data.testPlan)
      ? (data.testPlan as JsonObject)
      : {};
    if (String(plan.id || data.planId || "") === String(planId)) return { ok: true, data };
    return { ok: false, error: `test plan not found locally: ${planId}` };
  }
}
