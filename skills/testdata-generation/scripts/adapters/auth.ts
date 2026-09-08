#!/usr/bin/env node
/** Auth adapter: environment token or optional OAuth2 client credentials. */

import { Config, type JsonObject } from "./config.ts";
import { requestJson } from "./httputil.ts";

export class AuthAdapter {
  cfg: Config;
  block: JsonObject;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.block = cfg.adapter("auth");
  }

  get kind(): string {
    return String(this.block.type || "env");
  }

  async token(): Promise<string> {
    if (this.kind === "oauth") return this.oauthToken();
    const envName = String(this.block.token_env || "DATA_BUILD_TOKEN");
    return process.env[envName] || "";
  }

  async headers(): Promise<Record<string, string>> {
    const token = await this.token();
    if (!token) return {};
    const header = String(this.block.header || "Authorization");
    const prefix = String(this.block.prefix || "Bearer ");
    return { [header]: `${prefix}${token}` };
  }

  private async oauthToken(): Promise<string> {
    const oauth = (this.block.oauth && typeof this.block.oauth === "object" && !Array.isArray(this.block.oauth)
      ? this.block.oauth
      : {}) as JsonObject;
    const tokenUrl = String(oauth.token_url || "");
    if (!tokenUrl) return "";
    const clientId = process.env[String(oauth.client_id_env || "DATA_BUILD_CLIENT_ID")] || "";
    const clientSecret = process.env[String(oauth.client_secret_env || "DATA_BUILD_CLIENT_SECRET")] || "";
    if (!clientId || !clientSecret) return "";
    const body: JsonObject = {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    };
    if (oauth.scope) body.scope = oauth.scope;
    const resp = await requestJson(tokenUrl, "POST", body, null, 15);
    if (!resp.ok) return "";
    const data = (resp.data && typeof resp.data === "object" ? resp.data : {}) as JsonObject;
    return String(data.access_token || data.token || "");
  }
}
