import type { AuthProvider } from "./auth/base.ts";
import { NoneAuthProvider } from "./auth/none.ts";
import { request_json } from "./http_util.ts";

export const ENTERPRISE_HTTP_SLOTS: Record<string, Record<string, { method: string; path: string }>> = {
  plan: {
    get_plan: { method: "GET", path: "/v1/plans/{plan_id}" },
    list_submitted_defects: { method: "GET", path: "/v1/plans/{plan_id}/defects" },
  },
  testcase: {
    list_groups: { method: "GET", path: "/v1/test-case-groups" },
    list_cases: { method: "GET", path: "/v1/test-cases" },
    get_case: { method: "GET", path: "/v1/test-cases/{case_id}" },
  },
  issues: {
    get_issue: { method: "GET", path: "/v1/issues/{issue_id}" },
    create_issue: { method: "POST", path: "/v1/issues" },
  },
  docs: {
    fetch: { method: "GET", path: "/v1/documents/{doc_id}" },
  },
  traces: {
    list_traces: { method: "GET", path: "/v1/plans/{plan_id}/traces" },
  },
};

export function slot_spec(provider: string, slot: string): { method: string; path: string } {
  const spec = ENTERPRISE_HTTP_SLOTS[provider]?.[slot];
  if (!spec) throw new Error(`unknown HTTP slot ${provider}.${slot}`);
  return spec;
}

export function format_slot_path(template: string, path_vars: Record<string, any> = {}): string {
  const path = template.replace(/\{(\w+)\}/g, (_m, key) => {
    const value = path_vars[key];
    if (value === undefined || value === null) return "";
    return encodeURIComponent(String(value)).replace(/%2E/g, ".").replace(/%2D/g, "-").replace(/%5F/g, "_").replace(/%7E/g, "~");
  });
  return path.startsWith("/") ? path : `/${path}`;
}

export class HttpSlotClient {
  base_url: string;
  auth: AuthProvider;
  timeout: number;
  paths: Record<string, string>;

  constructor(opts: {
    base_url: string;
    auth?: AuthProvider | null;
    timeout?: number;
    paths?: Record<string, any> | null;
    name?: string;
  }) {
    this.base_url = String(opts.base_url || "").replace(/\/$/, "");
    if (!this.base_url) {
      throw new Error(`${opts.name || "http"} requires options.base_url (or enterprise_http_base_url)`);
    }
    this.auth = opts.auth || new NoneAuthProvider();
    this.timeout = Number(opts.timeout || 30);
    this.paths = {};
    for (const [k, v] of Object.entries(opts.paths || {})) {
      if (v) this.paths[String(k)] = String(v);
    }
  }

  resolve(provider: string, slot: string, path_vars: Record<string, any> = {}): [string, string] {
    const spec = slot_spec(provider, slot);
    const template = this.paths[slot] || spec.path;
    return [spec.method, format_slot_path(template, path_vars)];
  }

  call(
    provider: string,
    slot: string,
    opts: { path_vars?: Record<string, any> | null; params?: Record<string, any> | null; body?: any } = {},
  ): Record<string, any> {
    const [method, path] = this.resolve(provider, slot, opts.path_vars || {});
    return request_json(method, `${this.base_url}${path}`, {
      headers: this.auth.headers(),
      params: opts.params,
      body: opts.body,
      timeout: this.timeout,
    });
  }
}

export function client_from_options(
  options: Record<string, any> | null | undefined,
  auth: AuthProvider | null,
  name: string,
): HttpSlotClient {
  const opts = options || {};
  return new HttpSlotClient({
    base_url: String(opts.base_url || ""),
    auth: auth || undefined,
    timeout: Number(opts.timeout || 30),
    paths: opts.paths && typeof opts.paths === "object" ? opts.paths : {},
    name,
  });
}
