/**
 * Shared CLI helpers. Keep stdout JSON contract identical to the Python skill.
 */

import { is_client_language } from "./lang.ts";

export const NO_DEFECT_CONTENT = "No defect in this code";
const FRONTEND_GIT_KEYWORDS = [
  "react-native",
  "reactnative",
  "frontend",
  "webapp",
  "miniprogram",
  "uni-app",
  "nextjs",
  "nuxt",
];

export function _cli_result(code: number, data: any = undefined, msg = "", detail: Record<string, any> | null = null): void {
  const payload: Record<string, any> = { code };
  if (msg) payload.msg = msg;
  if (data !== undefined && data !== null) payload.data = data;
  if (detail) Object.assign(payload, detail);
  console.log(JSON.stringify(payload, null, 2));
}

export function _cli_error(msg: string, detail: Record<string, any> | null = null): never {
  _cli_result(1, undefined, msg, detail);
  process.exit(1);
}

export function _cli_success(data: any = undefined, msg = "", detail: Record<string, any> | null = null): void {
  _cli_result(0, data, msg, detail);
}

/**
 * Reduce whatever the user pasted to a plain branch name. Callers build the
 * remote ref themselves (`origin/<branch>`), so a `origin/master` argument used
 * to become `origin/origin/master` and git could not resolve it. Branch names
 * with slashes (`release/1.0`) must survive, so this strips known prefixes
 * instead of keeping the last path segment.
 */
export function normalize_branch_ref(raw: string | null | undefined): string | null {
  let name = String(raw ?? "").trim();
  if (!name) return null;
  name = name.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
  // Repeat so an already-doubled `origin/origin/master` also collapses.
  while (name.startsWith("origin/")) name = name.slice("origin/".length);
  name = name.replace(/^\/+/, "").replace(/\/+$/, "");
  return name || null;
}

/** Log once when normalisation actually changed the argument, so the run is traceable. */
export function log_branch_normalization(tag: string, flag: string, raw: string | null | undefined, normalized: string | null): void {
  const original = String(raw ?? "").trim();
  if (!original || !normalized || original === normalized) return;
  console.error(`[${tag}] ℹ️ normalized ${flag} '${original}' → '${normalized}'`);
}

function _should_inject_frontend_strategy(
  services: any[] | null = null,
  git_url: string | null = null,
  detect_type: string | null = null,
): boolean {
  if (services) {
    for (const svc of services) {
      if (is_client_language(svc?.language)) return true;
    }
  }
  if (git_url) {
    const gitLower = git_url.toLowerCase();
    if (FRONTEND_GIT_KEYWORDS.some((kw) => gitLower.includes(kw))) return true;
  }
  if (detect_type === "TEST_PLAN" && (!services || services.length === 0)) return true;
  return false;
}

export function _inject_strategy_codes(
  request_body: Record<string, any>,
  user_strategy_codes: string | null = null,
  services: any[] | null = null,
  git_url: string | null = null,
  detect_type: string | null = null,
): void {
  if (user_strategy_codes) {
    request_body.strategyCodes = user_strategy_codes
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => parseInt(x, 10));
    return;
  }
  if (_should_inject_frontend_strategy(services, git_url, detect_type)) {
    request_body.strategyCodes = [10];
  }
}

export function _require_save(store: { save: () => boolean; path: string }): void {
  if (!store.save()) {
    _cli_error(
      `content.json persist failed (disk/permission/IO error); current changes may not be saved. Path: ${store.path}`,
    );
  }
}

export function _parse_json_arg(raw_json: string, label = "argument"): any {
  try {
    return JSON.parse(raw_json);
  } catch (e: any) {
    _cli_error(`${label} JSON parse failed: ${e.message || e}`);
  }
}
