import { AuthenticationError } from "./providers/auth/base.ts";
import { request_json } from "./providers/http_util.ts";
import { get_auth, get_settings } from "./providers/registry.ts";

export { AuthenticationError };

export const BASE_URL = process.env.DETECTION_PLATFORM_URL || "";
export const SKILL_PREFIX = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/v1` : "";
export const REPORT_PREFIX = SKILL_PREFIX;
export const ADMIN_PREFIX = SKILL_PREFIX;

export function _headers_with_auth(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  Object.assign(headers, get_auth().headers());
  return headers;
}

export function _headers_no_auth(): Record<string, string> {
  return { Accept: "application/json" };
}

export function invalidate_auth_cache(): void {
  return;
}

export function get(url: string, params: Record<string, any> | null = null, auth = true): Record<string, any> {
  try {
    const headers = auth ? _headers_with_auth() : _headers_no_auth();
    return request_json("GET", url, { headers, params });
  } catch (exc: any) {
    return { _error: String(exc.message || exc) };
  }
}

export function post(url: string, body: Record<string, any>): Record<string, any> {
  try {
    return request_json("POST", url, { headers: _headers_with_auth(), body });
  } catch (exc: any) {
    return { _error: String(exc.message || exc) };
  }
}

export function report_base_url(): string {
  return get_settings().report_base_url;
}
