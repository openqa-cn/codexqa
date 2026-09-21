#!/usr/bin/env node
/** Load requirement or design documents from file, URL, or HTTP doc service. */

import { readFileSync } from "node:fs";
import type { AuthAdapter } from "./auth.ts";
import { Config, expandUser, isFile, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class DocSource {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("doc_source");
  }

  async get(ref: string): Promise<JsonObject> {
    if (String(this.block.type || "local") === "http" && !this.looksLocal(ref)) {
      const remote = await this.http(ref);
      if (remote.ok) return remote;
    }
    const path = expandUser(ref);
    if (isFile(path)) {
      return { ok: true, data: { content: readFileSync(path, "utf8"), source: path } };
    }
    if (ref.startsWith("http://") || ref.startsWith("https://")) {
      try {
        const resp = await fetch(ref, { headers: await this.auth.headers(), signal: AbortSignal.timeout(20_000) });
        const content = await resp.text();
        return { ok: true, data: { content, source: ref } };
      } catch (exc) {
        return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
      }
    }
    return { ok: false, error: `document not found: ${ref}` };
  }

  private looksLocal(ref: string): boolean {
    return isFile(expandUser(ref));
  }

  private async http(ref: string): Promise<JsonObject> {
    const http = this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "doc_source base_url is empty" };
    return requestJson(
      joinUrl(base, String(http.get_path || "/v1/docs/get")),
      "POST",
      { ref },
      await this.auth.headers(),
    );
  }
}
