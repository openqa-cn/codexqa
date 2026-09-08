#!/usr/bin/env node
/** Write executable case artifacts locally or to a case platform. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class CaseWriteback {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("case_writeback");
  }

  async write(caseId: string, markdown: string, extra: JsonObject | null = null): Promise<JsonObject> {
    if (String(this.block.type || "local") === "http") {
      const remote = await this.http(caseId, markdown, extra || {});
      if (remote.ok) return remote;
    }
    const destDir = join(expandUser(String(this.block.path || "./testdata/case-materials")), caseId);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, "case-executable.md");
    writeFileSync(dest, markdown, "utf8");
    return { ok: true, data: { path: dest } };
  }

  private async http(caseId: string, markdown: string, extra: JsonObject): Promise<JsonObject> {
    const http = this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "case_writeback base_url is empty" };
    return requestJson(
      joinUrl(base, String(http.update_path || "/v1/cases/update")),
      "POST",
      { caseId, markdown, ...extra },
      await this.auth.headers(),
    );
  }
}
