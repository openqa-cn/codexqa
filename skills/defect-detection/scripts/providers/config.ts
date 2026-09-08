import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Drop a trailing ` # comment` (YAML: `#` after whitespace, outside quotes). */
function _strip_inline_comment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function _coerce(value: string): any {
  if (value === "{}") return {};
  if (value === "[]") return [];
  if (
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  const lowered = value.toLowerCase();
  if (lowered === "true" || lowered === "false") return lowered === "true";
  if (["null", "none", "~"].includes(lowered)) return null;
  const asInt = Number.parseInt(value, 10);
  if (String(asInt) === value) return asInt;
  const asFloat = Number.parseFloat(value);
  if (!Number.isNaN(asFloat) && String(asFloat) === value) return asFloat;
  return value;
}

function _parse_simple_yaml(text: string): Record<string, any> {
  const root: Record<string, any> = {};
  const stack: Array<[number, any]> = [[-1, root]];
  let pending_key: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = _strip_inline_comment(raw.trim());
    if (!line) continue;
    while (
      stack.length &&
      indent <= stack[stack.length - 1][0] &&
      !(line.startsWith("- ") && indent === stack[stack.length - 1][0])
    ) {
      if (indent === stack[stack.length - 1][0] && line.startsWith("- ")) break;
      if (indent <= stack[stack.length - 1][0]) stack.pop();
    }
    const parent = stack[stack.length - 1][1];

    if (line.startsWith("- ")) {
      const item = _coerce(line.slice(2).trim());
      if (Array.isArray(parent)) parent.push(item);
      else if (pending_key !== null && parent && typeof parent === "object") {
        if (!Array.isArray(parent[pending_key])) parent[pending_key] = [];
        parent[pending_key].push(item);
      }
      continue;
    }
    if (!line.includes(":")) continue;
    const colon = line.indexOf(":");
    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();
    pending_key = key;
    if (rest === "" || rest === "|" || rest === ">") {
      const child: Record<string, any> = {};
      parent[key] = child;
      stack.push([indent, child]);
    } else {
      parent[key] = _coerce(rest);
    }
  }
  return root;
}

function _read_yaml(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  return _parse_simple_yaml(text);
}

export class ProviderSpec {
  kind: string;
  options: Record<string, any>;
  constructor(kind = "local", options: Record<string, any> = {}) {
    this.kind = kind;
    this.options = options;
  }
}

export class Settings {
  skill_root = SKILL_ROOT;
  data_dir = join(SKILL_ROOT, "data");
  enterprise_dir = join(SKILL_ROOT, "enterprise");
  report_base_url = "";
  enterprise_http_base_url = "";
  default_user = "local-user";
  auth = new ProviderSpec("none");
  platform = new ProviderSpec();
  plan = new ProviderSpec();
  testcase = new ProviderSpec();
  issues = new ProviderSpec();
  docs = new ProviderSpec();
  traces = new ProviderSpec();

  get platform_store_dir(): string {
    return join(this.data_dir, "platform");
  }
}

function _provider_spec(raw: any, env_kind: string, default_kind = "local"): ProviderSpec {
  if (!raw || typeof raw !== "object") raw = {};
  const kind = process.env[env_kind] || raw.kind || default_kind;
  const options = { ...(raw.options || {}) };
  const prefix = env_kind.replace(/_KIND$/, "");
  for (const [key, env_name] of [
    ["base_url", `${prefix}_BASE_URL`],
    ["token", `${prefix}_TOKEN`],
    ["api_key", `${prefix}_API_KEY`],
    ["timeout", `${prefix}_TIMEOUT`],
  ] as const) {
    const val = process.env[env_name];
    if (val) options[key] = key === "timeout" ? parseInt(val, 10) : val;
  }
  return new ProviderSpec(String(kind), options);
}

export function load_settings(config_path: string | null = null): Settings {
  const path = resolve(
    config_path || process.env.DETECTION_CONFIG || join(SKILL_ROOT, "config.yaml"),
  );
  const raw = existsSync(path) ? _read_yaml(path) : {};

  // Relative paths in config.yaml (`data_dir: ./data`) are anchored to the config
  // file, not to process.cwd(): the agent runs detect.ts from arbitrary working
  // directories and every task/report must still land in the same data dir.
  // Env overrides are explicit and resolve against cwd as usual.
  const config_dir = dirname(path);
  const _dir = (env_value: string | undefined, raw_value: any, fallback: string): string => {
    if (env_value) return resolve(env_value);
    if (raw_value) return resolve(config_dir, String(raw_value));
    return fallback;
  };
  const data_dir = _dir(process.env.DETECTION_DATA_DIR, raw.data_dir, join(SKILL_ROOT, "data"));
  const enterprise_dir = _dir(process.env.DETECTION_ENTERPRISE_DIR, raw.enterprise_dir, join(SKILL_ROOT, "enterprise"));
  const settings = new Settings();
  settings.skill_root = SKILL_ROOT;
  settings.data_dir = data_dir;
  settings.enterprise_dir = enterprise_dir;
  settings.report_base_url = String(
    process.env.DETECTION_REPORT_BASE_URL || raw.report_base_url || "",
  );
  settings.enterprise_http_base_url = String(
    process.env.DETECTION_ENTERPRISE_BASE_URL || raw.enterprise_http_base_url || "",
  ).replace(/\/$/, "");
  settings.default_user = String(process.env.DETECTION_USER || raw.default_user || "local-user");
  const providers = raw.providers && typeof raw.providers === "object" ? raw.providers : {};
  settings.auth = _provider_spec(providers.auth, "DETECTION_AUTH_KIND", "none");
  settings.platform = _provider_spec(providers.platform, "DETECTION_PLATFORM_KIND", "local");
  settings.plan = _provider_spec(providers.plan, "DETECTION_PLAN_KIND", "local");
  settings.testcase = _provider_spec(providers.testcase, "DETECTION_TESTCASE_KIND", "local");
  settings.issues = _provider_spec(providers.issues, "DETECTION_ISSUES_KIND", "local");
  settings.docs = _provider_spec(providers.docs, "DETECTION_DOCS_KIND", "local");
  settings.traces = _provider_spec(providers.traces, "DETECTION_TRACES_KIND", "local");
  mkdirSync(settings.data_dir, { recursive: true });
  mkdirSync(settings.enterprise_dir, { recursive: true });
  return settings;
}
