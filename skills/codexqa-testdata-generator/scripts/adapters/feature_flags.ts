#!/usr/bin/env node
/** Optional feature-flag / experiment adapter. Default is noop. */

import type { AuthAdapter } from "./auth.ts";
import { Config, type JsonObject } from "./config.ts";
import { joinUrl, requestJson } from "./httputil.ts";

export class FeatureFlags {
  cfg: Config;
  auth: AuthAdapter;
  block: JsonObject;

  constructor(cfg: Config, auth: AuthAdapter) {
    this.cfg = cfg;
    this.auth = auth;
    this.block = cfg.adapter("feature_flags");
  }

  get enabled(): boolean {
    return String(this.block.type || "noop") !== "noop";
  }

  detail(flagKey: string, environment: string): Promise<JsonObject> {
    return this.call("detail_path", "/v1/flags/detail", { flagKey, environment });
  }

  addWhitelist(flagKey: string, strategyKey: string, subject: string, environment: string): Promise<JsonObject> {
    return this.call("whitelist_path", "/v1/flags/whitelist", {
      action: "add",
      flagKey,
      strategyKey,
      subject,
      environment,
    });
  }

  removeWhitelist(flagKey: string, strategyKey: string, subject: string, environment: string): Promise<JsonObject> {
    return this.call("whitelist_path", "/v1/flags/whitelist", {
      action: "remove",
      flagKey,
      strategyKey,
      subject,
      environment,
    });
  }

  evaluate(flagKey: string, subject: string, environment: string): Promise<JsonObject> {
    return this.call("evaluate_path", "/v1/flags/evaluate", { flagKey, subject, environment });
  }

  private async call(pathKey: string, defaultPath: string, body: JsonObject): Promise<JsonObject> {
    if (!this.enabled) {
      return { ok: false, error: "feature_flags adapter is noop; configure type=http to enable" };
    }
    const http = this.block.http && typeof this.block.http === "object" && !Array.isArray(this.block.http)
      ? (this.block.http as JsonObject)
      : {};
    const base = String(http.base_url || "");
    if (!base) return { ok: false, error: "feature_flags base_url is empty" };
    return requestJson(joinUrl(base, String(http[pathKey] || defaultPath)), "POST", body, await this.auth.headers());
  }
}
