/**
 * Shared CLI helpers. Keep stdout JSON contract identical to the Python skill.
 */

export const NO_DEFECT_CONTENT = "No defect in this code";

const TERMINAL_LANGUAGES = new Set(["javascript", "typescript", "js", "ts", "jsx", "tsx"]);
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

export function _should_inject_frontend_strategy(
  services: any[] | null = null,
  git_url: string | null = null,
  detect_type: string | null = null,
): boolean {
  if (services) {
    for (const svc of services) {
      const lang = String(svc?.language || "").toLowerCase();
      if (TERMINAL_LANGUAGES.has(lang)) return true;
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
