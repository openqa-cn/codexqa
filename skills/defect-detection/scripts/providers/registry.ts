import { ApiKeyAuthProvider } from "./auth/api_key.ts";
import type { AuthProvider } from "./auth/base.ts";
import { BearerAuthProvider } from "./auth/bearer.ts";
import { NoneAuthProvider } from "./auth/none.ts";
import { load_settings, type Settings } from "./config.ts";
import { HttpDocProvider } from "./docs/http.ts";
import { LocalDocProvider } from "./docs/local.ts";
import { GitHubIssueProvider } from "./issues/github.ts";
import { HttpIssueProvider } from "./issues/http.ts";
import { LocalIssueProvider } from "./issues/local.ts";
import { HttpPlanProvider } from "./plan/http.ts";
import { LocalPlanProvider } from "./plan/local.ts";
import { HttpPlatformProvider } from "./platform/http.ts";
import { LocalPlatformProvider } from "./platform/local.ts";
import { HttpTestCaseProvider } from "./testcase/http.ts";
import { LocalTestCaseProvider } from "./testcase/local.ts";
import { HttpTraceProvider } from "./traces/http.ts";
import { LocalTraceProvider } from "./traces/local.ts";

let _settings: Settings | null = null;
let _auth: AuthProvider | null = null;
let _platform: any = null;
let _plan: any = null;
let _testcases: any = null;
let _issues: any = null;
let _docs: any = null;
let _traces: any = null;

export function reset_providers(): void {
  _settings = null;
  _auth = null;
  _platform = null;
  _plan = null;
  _testcases = null;
  _issues = null;
  _docs = null;
  _traces = null;
}

export function get_settings(): Settings {
  if (_settings === null) _settings = load_settings();
  return _settings;
}

export function get_auth(): AuthProvider {
  if (_auth === null) {
    const spec = get_settings().auth;
    const kind = spec.kind.toLowerCase();
    if (["none", "local", "disabled"].includes(kind)) _auth = new NoneAuthProvider();
    else if (["bearer", "token", "oidc"].includes(kind)) _auth = new BearerAuthProvider(spec.options);
    else if (["api_key", "apikey"].includes(kind)) _auth = new ApiKeyAuthProvider(spec.options);
    else throw new Error(`unknown auth provider kind: ${spec.kind}`);
  }
  return _auth;
}

export function set_manual_token(token: string): void {
  const auth = get_auth();
  if (typeof auth.set_token === "function") auth.set_token(token);
}

export function get_platform(): any {
  if (_platform === null) {
    const settings = get_settings();
    const spec = settings.platform;
    const kind = spec.kind.toLowerCase();
    if (["local", "file"].includes(kind)) {
      _platform = new LocalPlatformProvider(settings.platform_store_dir, {
        report_base_url: settings.report_base_url || spec.options.report_base_url || "",
      });
    } else if (kind === "http") {
      _platform = new HttpPlatformProvider(spec.options, get_auth());
    } else {
      throw new Error(`unknown platform provider kind: ${spec.kind}`);
    }
  }
  return _platform;
}

function _enterprise_http_options(spec: { options: Record<string, any> }): Record<string, any> {
  const options = { ...(spec.options || {}) };
  if (!options.base_url) {
    const fallback = get_settings().enterprise_http_base_url;
    if (fallback) options.base_url = fallback;
  }
  return options;
}

export function get_plan(): any {
  if (_plan === null) {
    const settings = get_settings();
    const spec = settings.plan;
    const kind = spec.kind.toLowerCase();
    if (["local", "file"].includes(kind)) _plan = new LocalPlanProvider(settings.enterprise_dir);
    else if (kind === "http") _plan = new HttpPlanProvider(_enterprise_http_options(spec), get_auth());
    else throw new Error(`unknown plan provider kind: ${spec.kind}`);
  }
  return _plan;
}

export function get_testcases(): any {
  if (_testcases === null) {
    const settings = get_settings();
    const spec = settings.testcase;
    const kind = spec.kind.toLowerCase();
    if (["local", "file"].includes(kind)) _testcases = new LocalTestCaseProvider(settings.enterprise_dir);
    else if (kind === "http") _testcases = new HttpTestCaseProvider(_enterprise_http_options(spec), get_auth());
    else throw new Error(`unknown testcase provider kind: ${spec.kind}`);
  }
  return _testcases;
}

export function get_issues(): any {
  if (_issues === null) {
    const settings = get_settings();
    const spec = settings.issues;
    const kind = spec.kind.toLowerCase();
    if (["local", "file"].includes(kind)) _issues = new LocalIssueProvider(settings.enterprise_dir, settings.data_dir);
    else if (kind === "github") _issues = new GitHubIssueProvider(spec.options, get_auth());
    else if (kind === "http") _issues = new HttpIssueProvider(_enterprise_http_options(spec), get_auth());
    else throw new Error(`unknown issues provider kind: ${spec.kind}`);
  }
  return _issues;
}

export function get_docs(): any {
  if (_docs === null) {
    const settings = get_settings();
    const spec = settings.docs;
    const kind = spec.kind.toLowerCase();
    if (["local", "file", "url"].includes(kind)) _docs = new LocalDocProvider(settings.enterprise_dir);
    else if (kind === "http") _docs = new HttpDocProvider(_enterprise_http_options(spec), get_auth());
    else throw new Error(`unknown docs provider kind: ${spec.kind}`);
  }
  return _docs;
}

export function get_traces(): any {
  if (_traces === null) {
    const settings = get_settings();
    const spec = settings.traces;
    const kind = spec.kind.toLowerCase();
    if (["local", "file"].includes(kind)) _traces = new LocalTraceProvider(settings.enterprise_dir);
    else if (kind === "http") _traces = new HttpTraceProvider(_enterprise_http_options(spec), get_auth());
    else throw new Error(`unknown traces provider kind: ${spec.kind}`);
  }
  return _traces;
}
