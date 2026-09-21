#!/usr/bin/env node
/** Read-only SQL adapter. SELECT only. */

import { DatabaseSync } from "node:sqlite";
import { Config, type JsonObject } from "./config.ts";

const WRITE = /\b(insert|update|delete|drop|alter|truncate|create|replace|grant|revoke)\b/i;

export class DataStore {
  cfg: Config;
  block: JsonObject;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.block = cfg.adapter("data_store");
  }

  query(sql: string, params: unknown[] | null = null): JsonObject {
    if (WRITE.test(sql)) return { ok: false, error: "data_store allows SELECT only" };
    const kind = String(this.block.type || "none");
    if (kind === "none" || kind === "" || kind === "noop") {
      return {
        ok: false,
        error: "data_store is not configured (set adapters.data_store.type=dsn and DATABASE_DSN)",
      };
    }
    const dsn = process.env[String(this.block.dsn_env || "DATABASE_DSN")] || "";
    if (!dsn) return { ok: false, error: "DATABASE_DSN is empty" };
    return this.queryDsn(dsn, sql, params);
  }

  private queryDsn(dsn: string, sql: string, params: unknown[] | null): JsonObject {
    if (!dsn.startsWith("sqlite:")) {
      return { ok: false, error: "unsupported DSN; use sqlite:///path or an HTTP SQL gateway" };
    }
    const path = sqliteFilePath(dsn);
    try {
      const conn = new DatabaseSync(path);
      const stmt = conn.prepare(sql);
      const rows = (params ? stmt.all(...(params as never[])) : stmt.all()) as JsonObject[];
      conn.close();
      return { ok: true, data: rows };
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
    }
  }
}

/** sqlite:///rel.db → rel.db; sqlite:///tmp/db.db and sqlite:////tmp/db.db → /tmp/db.db */
export function sqliteFilePath(dsn: string): string {
  const rest = dsn.split("sqlite:").slice(1).join("sqlite:");
  if (rest.startsWith("////")) return rest.slice(3);
  if (rest.startsWith("///")) {
    const inner = rest.slice(3);
    if (inner.startsWith("/") || inner.startsWith("./") || !inner.includes("/")) return inner;
    return `/${inner}`;
  }
  return rest.replace("///", "").replace("//", "");
}
