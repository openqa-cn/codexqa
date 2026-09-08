/**
 * AST rule batch-scan module (strategyCode=8 acceleration).
 *
 * Core functions:
 *   1. Extract semgrep YAML from category=1 rules
 *   2. Merge into a single rules file
 *   3. Run semgrep against the whole repo (or specified files)
 *   4. Return structured findings
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { LANG_TO_EXTENSIONS, detect_project_language, languages_in_files, semgrep_rule_languages_for } from "./lang.ts";
import { SKILL_ROOT } from "./providers/config.ts";
import { attach_exclusion_context } from "./rules.ts";
import { type RunResult, run, to_posix, which } from "./sys.ts";

function _run(cmd: string[], timeout_s: number, cwd?: string): RunResult {
  return run(cmd, { timeout_s, cwd });
}

export function ensure_semgrep_installed(): boolean {
  if (which("semgrep")) return true;

  console.error("[run-ast-scan] ⚠️  semgrep is not installed, installing automatically...");

  const py = which("python3") || which("python");
  if (py) {
    const pip_cmd = [py, "-m", "pip", "install", "semgrep", "--quiet", "--disable-pip-version-check"];
    try {
      const proc = _run(pip_cmd, 300);
      if (proc.error && proc.error.code === "ETIMEDOUT") {
        console.error("[run-ast-scan] ⚠️  pip install semgrep failed: Command timed out");
      } else if (proc.returncode === 0 && which("semgrep")) {
        console.error("[run-ast-scan] ✅ semgrep installed via pip");
        return true;
      } else {
        // pip --user drops the console script here on POSIX; on Windows it is
        // %APPDATA%\Python\PythonXY\Scripts\semgrep.exe, which pip already reports.
        const user_bin = join(homedir(), ".local", "bin");
        if (existsSync(join(user_bin, "semgrep")) || existsSync(join(user_bin, "semgrep.exe"))) {
          process.env.PATH = user_bin + delimiter + (process.env.PATH || "");
          console.error("[run-ast-scan] ✅ semgrep installed via pip (~/.local/bin)");
          return true;
        }
        if (proc.error) {
          console.error(`[run-ast-scan] ⚠️  pip install semgrep failed: ${proc.error}`);
        }
      }
    } catch (e) {
      console.error(`[run-ast-scan] ⚠️  pip install semgrep failed: ${e}`);
    }
  }

  if (which("brew")) {
    try {
      const proc = _run(["brew", "install", "semgrep"], 300);
      if (proc.error && proc.error.code === "ETIMEDOUT") {
        console.error("[run-ast-scan] ⚠️  brew install semgrep failed: Command timed out");
      } else if (proc.returncode === 0 && which("semgrep")) {
        console.error("[run-ast-scan] ✅ semgrep installed via brew");
        return true;
      } else if (proc.error) {
        console.error(`[run-ast-scan] ⚠️  brew install semgrep failed: ${proc.error}`);
      }
    } catch (e) {
      console.error(`[run-ast-scan] ⚠️  brew install semgrep failed: ${e}`);
    }
  }

  console.error("[run-ast-scan] ❌ semgrep auto-install failed, please run manually: pip3 install semgrep");
  return false;
}

export const astHooks = {
  ensure_semgrep_installed,
};

export function extract_semgrep_yaml_from_rules(rules: any[]): Record<string, any>[] {
  const extracted: Record<string, any>[] = [];
  for (const rule of rules) {
    if (rule.category !== 1) continue;
    const rule_id = rule.id;
    const rule_code = rule.ruleCode || "";
    const title = rule.title || "";

    const desc_raw = rule.description || "";
    if (!desc_raw) continue;

    let desc: any;
    if (typeof desc_raw === "string") {
      try {
        desc = JSON.parse(desc_raw);
      } catch {
        console.error(`[run-ast-scan] ⚠️  rule id=${rule_id} description is invalid JSON, skip`);
        continue;
      }
    } else {
      desc = desc_raw;
    }

    const yaml_text = desc.semgrepYaml || desc.semgrep_yaml || "";
    if (!String(yaml_text).trim()) {
      console.error(`[run-ast-scan] ⚠️  rule id=${rule_id} has no semgrepYaml content, skip`);
      continue;
    }

    extracted.push({
      id: rule_id,
      ruleCode: rule_code,
      title,
      yaml_text: String(yaml_text).trim(),
    });
  }
  return extracted;
}

export function merge_rules_to_yaml(extracted_rules: Record<string, any>[]): string {
  const rule_blocks: string[] = [];
  for (const item of extracted_rules) {
    const yaml_text = item.yaml_text;
    const rule_code = item.ruleCode;
    const rule_id = item.id;

    const lines = yaml_text.split("\n");
    const body_lines: string[] = [];
    let found_rules_key = false;
    for (const line of lines) {
      const stripped = line.trim();
      if (!found_rules_key && stripped === "rules:") {
        found_rules_key = true;
        continue;
      }
      if (found_rules_key) {
        body_lines.push(line);
      } else {
        body_lines.push(line);
      }
    }

    let rule_body = found_rules_key ? body_lines.join("\n") : yaml_text;
    rule_body = rule_body.replace(/\s+$/, "");
    if (!rule_body) {
      console.error(`[run-ast-scan] ⚠️  rule id=${rule_id} YAML body is empty, skip`);
      continue;
    }

    const first_line = rule_body.split("\n", 1)[0];
    const current_indent = first_line.length - first_line.trimStart().length;
    if (current_indent < 2) {
      const indent_diff = 2 - current_indent;
      const padding = " ".repeat(indent_diff);
      rule_body = rule_body
        .split("\n")
        .map((l: string) => (l.trim() ? padding + l : l))
        .join("\n");
    }

    if (rule_code) {
      rule_body = rule_body.replace(/^(\s*-?\s*id\s*:\s*)(.+)$/m, `$1${rule_code}`);
    }

    rule_blocks.push(rule_body);
  }

  if (!rule_blocks.length) return "";
  return "rules:\n" + rule_blocks.join("\n") + "\n";
}

// Language tables live in lang.ts (single source of truth); re-exported here
// because older callers and tests import them from the AST module.
export const _LANG_TO_EXTENSIONS = LANG_TO_EXTENSIONS;
export { detect_project_language };

function _file_ext(f: string): string {
  const base = f.split(/[/\\]/).pop() || "";
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i).toLowerCase();
}

function _extract_rule_languages(yaml_text: string): Set<string> {
  const langs = new Set<string>();
  const bracket_match = yaml_text.match(/languages\s*:\s*\[([^\]]+)\]/);
  if (bracket_match) {
    for (const lang of bracket_match[1].split(",")) {
      langs.add(lang.trim().replace(/^["']|["']$/g, "").toLowerCase());
    }
    return langs;
  }

  const lines = yaml_text.split("\n");
  let in_languages = false;
  for (const line of lines) {
    const stripped = line.trim();
    if (/^languages\s*:/.test(stripped)) {
      const after_colon = stripped.slice(stripped.indexOf(":") + 1).trim();
      if (after_colon && !after_colon.startsWith("[")) {
        langs.add(after_colon.replace(/^["']|["']$/g, "").toLowerCase());
        return langs;
      }
      in_languages = true;
      continue;
    }
    if (in_languages) {
      if (stripped.startsWith("- ")) {
        const lang_val = stripped.slice(2).trim().replace(/^["']|["']$/g, "").toLowerCase();
        langs.add(lang_val);
      } else if (stripped && !stripped.startsWith("#")) {
        break;
      }
    }
  }
  return langs;
}

/**
 * Keep rules whose Semgrep `languages:` intersect the project's language set.
 * `project_lang` may be one language or several (polyglot change set); the
 * accepted set comes from lang.ts so TS ⊇ JS and C++ ⊇ C stay in one place.
 */
export function filter_rules_by_language(
  extracted_rules: Record<string, any>[],
  project_lang: string | readonly string[] | null | undefined,
): [Record<string, any>[], number] {
  const langs = (Array.isArray(project_lang) ? project_lang : [project_lang]).filter(Boolean) as string[];
  if (!langs.length) return [extracted_rules, 0];
  const accepted = semgrep_rule_languages_for(langs);
  const project_label = langs.join("+");

  const filtered: Record<string, any>[] = [];
  let skipped = 0;
  for (const rule of extracted_rules) {
    const rule_langs = _extract_rule_languages(rule.yaml_text);
    if (!rule_langs.size) {
      filtered.push(rule);
    } else if ([...rule_langs].some((l) => accepted.has(l))) {
      filtered.push(rule);
    } else {
      skipped += 1;
      const lang_repr = `{${[...rule_langs].map((x) => `'${x}'`).join(", ")}}`;
      console.error(
        `[run-ast-scan] 🔇 skip rule id=${rule.id} (language=${lang_repr}, project language=${project_label})`,
      );
    }
  }
  return [filtered, skipped];
}

// ---------------------------------------------------------------------------
// Rejected-rule memory: rules the installed Semgrep refused are remembered per
// Semgrep version so later scans skip the probe rounds (one process per round).
// ---------------------------------------------------------------------------

let _semgrep_version_cache: string | null | undefined;
export function semgrep_version(): string | null {
  if (_semgrep_version_cache !== undefined) return _semgrep_version_cache;
  try {
    const proc = _run(["semgrep", "--version"], 30);
    const m = (proc.stdout || "").match(/(\d+\.\d+\.\d+)/);
    _semgrep_version_cache = m ? m[1] : null;
  } catch {
    _semgrep_version_cache = null;
  }
  return _semgrep_version_cache;
}

function _rejected_rules_path(): string {
  const base = process.env.DETECTION_DATA_DIR || join(SKILL_ROOT, "data");
  return join(base, "semgrep-rejected-rules.json");
}

export function load_rejected_rules(version: string | null): Record<string, string> {
  if (!version) return {};
  try {
    const raw = JSON.parse(readFileSync(_rejected_rules_path(), "utf8"));
    return raw && raw.version === version && raw.rejected && typeof raw.rejected === "object" ? raw.rejected : {};
  } catch {
    return {};
  }
}

export function save_rejected_rules(version: string | null, rejected: Record<string, string>): void {
  if (!version) return;
  try {
    const path = _rejected_rules_path();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version, rejected, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch {
    /* cache only */
  }
}

/** Rule id (`- id: X`) whose block contains 1-based `line` of the merged pack. */
export function rule_id_at_yaml_line(yaml_text: string, line: number): string | null {
  const lines = yaml_text.split("\n");
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s*-\s*id\s*:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * Rules the installed Semgrep refused (schema / pattern / YAML errors), resolved from
 * error spans or `rule_id` fields to rule ids in `yaml_text`. Empty when the errors are
 * ordinary scan warnings (timeouts, parse errors in target files).
 */
export function invalid_rule_ids_from_semgrep_errors(
  errors: any[],
  yaml_text: string,
  yaml_path: string,
): { ruleId: string; reason: string }[] {
  const out = new Map<string, string>();
  for (const e of errors || []) {
    const type = String(e.type || "");
    const msg = String(e.long_msg || e.message || e.short_msg || "");
    const is_rule_error =
      /InvalidRuleSchema|InvalidPattern|PatternParse|Rule parse error|Invalid YAML|invalid rule|Rule.*invalid/i.test(`${type} ${msg}`) ||
      /Invalid YAML|mapping values are not allowed|could not find expected/i.test(msg);
    if (!is_rule_error) continue;
    const reason = `${type || "SemgrepError"}: ${msg.split("\n")[0].slice(0, 200)}`;
    let resolved = false;
    if (e.rule_id) {
      out.set(String(e.rule_id), reason);
      resolved = true;
    }
    for (const span of e.spans || []) {
      if (span.file && yaml_path && String(span.file) !== yaml_path && !String(span.file).endsWith(yaml_path)) continue;
      const line = span.start?.line;
      const id = typeof line === "number" ? rule_id_at_yaml_line(yaml_text, line) : null;
      if (id) {
        out.set(id, reason);
        resolved = true;
      }
    }
    if (!resolved) {
      const m = msg.match(/line (\d+)/);
      const id = m ? rule_id_at_yaml_line(yaml_text, Number(m[1])) : null;
      if (id) out.set(id, reason);
    }
  }
  return [...out].map(([ruleId, reason]) => ({ ruleId, reason }));
}

const _AUTO_GENERATED_MARKERS = [
  "Autogenerated by Thrift",
  "Autogenerated by Thrift Compiler",
  "Auto-generated by",
  "AUTO-GENERATED",
  "@generated",
  "DO NOT EDIT",
  "Generated by the protocol buffer compiler",
];

const _auto_gen_cache: Record<string, boolean> = {};

export function normalize_scan_path(file_path: string): string {
  return String(file_path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

/** True when a finding path is the same file as one of the PR/diff paths. */
export function path_in_diff(file_path: string, diff_files: Iterable<string> | null | undefined): boolean {
  const fp = normalize_scan_path(file_path);
  if (!fp || !diff_files) return false;
  for (const raw of diff_files) {
    const df = normalize_scan_path(String(raw || ""));
    if (!df) continue;
    if (fp === df) return true;
    if (fp.endsWith("/" + df) || df.endsWith("/" + fp)) return true;
  }
  return false;
}

function _hunks_for_path(
  file_path: string,
  hunks: Record<string, Array<[number, number]>>,
): Array<[number, number]> | null {
  if (hunks[file_path]) return hunks[file_path];
  const normalized = normalize_scan_path(file_path);
  if (hunks[normalized]) return hunks[normalized];
  for (const [hunk_path, ranges] of Object.entries(hunks)) {
    if (path_in_diff(normalized, [hunk_path])) return ranges;
  }
  return null;
}

export function annotate_findings_in_diff(
  findings: Record<string, any>[],
  diff_files: string[] | null | undefined,
  hunks?: Record<string, Array<[number, number]>> | null,
): Record<string, any>[] {
  const has_diff = Boolean(diff_files && diff_files.length);
  return (findings || []).map((f) => {
    const in_file = has_diff ? path_in_diff(f.filePath, diff_files) : null;
    if (in_file == null) return { ...f, inDiff: null };
    if (!in_file) return { ...f, inDiff: false, inDiffFile: false };
    const ranges = hunks && f.filePath ? _hunks_for_path(f.filePath, hunks) : null;
    if (!ranges || !ranges.length) {
      // File-level fallback when hunks were not persisted.
      return { ...f, inDiff: true, inDiffFile: true };
    }
    const line = Number(f.line) || 0;
    const in_hunk = line > 0 && ranges.some(([s, e]) => line >= s && line <= e);
    return { ...f, inDiff: in_hunk, inDiffFile: true, inHunk: in_hunk };
  });
}

export type AstScanScope = {
  scanFiles: string[] | null;
  annotateDiffFiles: string[];
  scanMode: "changed_files" | "full_repo";
  warning?: string;
};

/**
 * PR/diff tasks default to changed-file AST when a taskId is present.
 * Whole-repo remains available via fullRepo, or when no diff file list exists.
 */
export function resolve_ast_scan_scope(opts: {
  taskId?: number | null;
  targetFiles?: string[] | null;
  diffFiles?: string[] | null;
  changedOnly?: boolean;
  fullRepo?: boolean;
  taskDiffFiles?: string[] | null;
}): AstScanScope {
  const explicit = [
    ...(opts.targetFiles || []),
    ...(opts.diffFiles || []),
  ].map((f) => String(f || "").trim()).filter(Boolean);
  const unique_explicit = [...new Set(explicit)];
  const task_diff = (opts.taskDiffFiles || []).map((f) => String(f || "").trim()).filter(Boolean);
  const annotate_from = unique_explicit.length ? unique_explicit : task_diff;

  if (opts.fullRepo) {
    return {
      scanFiles: null,
      annotateDiffFiles: annotate_from,
      scanMode: "full_repo",
    };
  }

  const default_changed = Boolean(opts.taskId) && !unique_explicit.length;
  if (opts.changedOnly || default_changed || unique_explicit.length) {
    const files = unique_explicit.length ? unique_explicit : task_diff;
    if (files.length) {
      return {
        scanFiles: files,
        annotateDiffFiles: files,
        scanMode: "changed_files",
      };
    }
    return {
      scanFiles: null,
      annotateDiffFiles: [],
      scanMode: "full_repo",
      warning: "changed-file AST requested but no diff.files / --diff-files were available; falling back to full-repo",
    };
  }

  return {
    scanFiles: null,
    annotateDiffFiles: task_diff,
    scanMode: "full_repo",
    warning: "whole-repo AST scan. For a PR/diff task pass --task-id (loads diff.files) or --changed-only.",
  };
}

export function is_auto_generated_file(file_path: string, _cache: Record<string, boolean> = _auto_gen_cache): boolean {
  if (file_path in _cache) return _cache[file_path];

  let result = false;
  try {
    const raw = readFileSync(file_path, "utf8");
    const head = raw.split(/\r?\n/).slice(0, 8).join("\n");
    for (const marker of _AUTO_GENERATED_MARKERS) {
      if (head.includes(marker)) {
        result = true;
        break;
      }
    }
  } catch {
    /* ignore */
  }

  _cache[file_path] = result;
  return result;
}

const _SCAN_SKIP_DIRS = [
  ".git",
  "node_modules",
  "__pycache__",
  ".svn",
  ".hg",
  "target",
  "build",
  "dist",
  "out",
  ".idea",
  ".vscode",
  ".gradle",
];

function _collect_source_files(code_dir: string, project_language: string | null = null): string[] {
  const skip_dirs = new Set(_SCAN_SKIP_DIRS);
  const skip_exts = new Set([".class", ".jar", ".war", ".ear", ".pyc", ".o", ".so", ".dll", ".exe"]);

  // Known language → that language's extensions. Unknown language → every
  // extension we know is source code, so docs/config/binaries never enter the scan set.
  let target_exts: Set<string> | null = null;
  if (project_language && _LANG_TO_EXTENSIONS[project_language]) {
    const exts = _LANG_TO_EXTENSIONS[project_language];
    if (exts.size) target_exts = exts;
  } else {
    target_exts = new Set<string>();
    for (const exts of Object.values(_LANG_TO_EXTENSIONS)) for (const e of exts) target_exts.add(e);
  }

  const source_files: string[] = [];

  function visit(root: string): void {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skip_dirs.has(e.name)) dirs.push(e.name);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = _file_ext(e.name);
      if (skip_exts.has(ext)) continue;
      if (target_exts !== null && !target_exts.has(ext)) continue;
      const full_path = join(root, e.name);
      source_files.push(to_posix(relative(code_dir, full_path)));
    }
    for (const d of dirs) visit(join(root, d));
  }

  visit(code_dir);
  return source_files;
}

function _isfile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function run_ast_scan(
  rules_json: any[],
  code_dir: string,
  target_files: string[] | null = null,
  output_yaml_path: string | null = null,
  project_language: string | null = null,
  exclusion_index: Record<string, any> | null = null,
): Record<string, any> {
  // Semgrep runs with cwd=code_dir; a relative --code-dir would otherwise make the
  // generated config path (<code_dir>/.semgrep-ast-rules.yaml) resolve to
  // <code_dir>/<code_dir>/... and the whole pack looks "invalid".
  code_dir = resolve(code_dir);
  const scan_mode = !target_files || !target_files.length ? "full_repo" : "target_files";

  if (!target_files || !target_files.length) {
    target_files = _collect_source_files(code_dir, project_language);
    if (!target_files.length) {
      return {
        ruleCount: 0,
        totalRuleCount: 0,
        skippedRuleCount: 0,
        projectLanguage: project_language,
        scannedFiles: 0,
        totalFindings: 0,
        findings: [],
        errors: ["no source files in the repo to scan"],
        scanMode: scan_mode,
      };
    }
    console.error(`[run-ast-scan] 📂 full-repo scan mode: collected ${target_files.length} source files`);
  } else {
    console.error(`[run-ast-scan] 📄 specified-file scan mode: ${target_files.length} files`);
  }

  let extracted = extract_semgrep_yaml_from_rules(rules_json);
  if (!extracted.length) {
    return {
      ruleCount: 0,
      totalRuleCount: 0,
      skippedRuleCount: 0,
      projectLanguage: null,
      scannedFiles: 0,
      totalFindings: 0,
      findings: [],
      errors: ["no valid category=1 AST rules"],
      scanMode: scan_mode,
    };
  }

  const total_rule_count = extracted.length;

  // Rules are filtered against every language present in the scan targets (plus the
  // declared project language), so a polyglot change set keeps its Go and Python
  // packs instead of only the dominant language's.
  const scan_langs = new Set<string>(languages_in_files(target_files));
  if (project_language) scan_langs.add(project_language);
  let detected_lang: string | null = project_language || detect_project_language(target_files);
  if (!detected_lang && scan_langs.size) detected_lang = [...scan_langs].sort().join("+");
  let skipped_count = 0;
  if (scan_langs.size) {
    const filtered = filter_rules_by_language(extracted, [...scan_langs]);
    extracted = filtered[0];
    skipped_count = filtered[1];
    if (skipped_count > 0) {
      console.error(
        `[run-ast-scan] 🌐 project language=${detected_lang}, ` +
          `filtered out ${skipped_count} unmatched rules, ${extracted.length} remaining`,
      );
    }
    if (!extracted.length) {
      return {
        ruleCount: 0,
        totalRuleCount: total_rule_count,
        skippedRuleCount: skipped_count,
        projectLanguage: detected_lang,
        languages: [...scan_langs].sort(),
        scannedFiles: 0,
        totalFindings: 0,
        findings: [],
        errors: [`all rules are non-${detected_lang}; no usable rules after filtering`],
        scanMode: scan_mode,
        // Scan ran; there is simply no seed pack for this language. Do not treat as "0 hits".
        skipped: true,
        skipReason: `no Semgrep seed rules for ${detected_lang}; continue file-level analysis`,
        scanOk: true,
      };
    }
  } else {
    skipped_count = 0;
    detected_lang = null;
  }

  let merged_yaml = merge_rules_to_yaml(extracted);
  if (!merged_yaml) {
    return {
      ruleCount: 0,
      totalRuleCount: total_rule_count,
      skippedRuleCount: skipped_count,
      projectLanguage: detected_lang,
      scannedFiles: 0,
      totalFindings: 0,
      findings: [],
      errors: ["all rule YAML parse/merge failed"],
    };
  }

  const yaml_path = output_yaml_path || join(code_dir, ".semgrep-ast-rules.yaml");
  const _cleanup_pack = () => {
    if (!output_yaml_path) {
      try { unlinkSync(yaml_path); } catch { /* ignore */ }
    }
  };
  try {
    writeFileSync(yaml_path, merged_yaml, "utf8");
    console.error(`[run-ast-scan] ✅ rule YAML written: ${yaml_path} (${extracted.length} rules)`);
  } catch (e) {
    return {
      ruleCount: extracted.length,
      scannedFiles: 0,
      totalFindings: 0,
      findings: [],
      errors: [`failed to write YAML file: ${e}`],
      scanMode: scan_mode,
    };
  }

  const existing_files: string[] = [];
  for (const f of target_files) {
    const full_path = !isAbsolute(f) ? join(code_dir, f) : f;
    if (_isfile(full_path)) {
      existing_files.push(full_path);
    } else {
      console.error(`[run-ast-scan] ⚠️  file does not exist, skip: ${f}`);
    }
  }

  if (!existing_files.length) {
    _cleanup_pack();
    return {
      ruleCount: extracted.length,
      scannedFiles: 0,
      totalFindings: 0,
      findings: [],
      errors: ["none of the target files exist; nothing to scan"],
      scanMode: scan_mode,
    };
  }

  if (!astHooks.ensure_semgrep_installed()) {
    _cleanup_pack();
    return {
      ruleCount: extracted.length,
      scannedFiles: 0,
      totalFindings: 0,
      findings: [],
      errors: ["semgrep auto-install failed, please run manually: pip3 install semgrep"],
      scanMode: scan_mode,
      scanOk: false,
    };
  }

  let cmd: string[];
  const base_cmd = ["semgrep", "scan", "--config", yaml_path, "--json", "--no-git-ignore", "--timeout", "60"];
  // The file list is already restricted to known source extensions, so
  // --scan-unknown-extensions is safe here (older Semgrep skips .mjs/.cjs/.mts otherwise).
  // Very large full-repo sets fall back to a directory scan to stay under ARG_MAX; in that
  // mode the flag is NOT passed, otherwise Semgrep would parse every file under the repo.
  const MAX_EXPLICIT_FILES = 4000;
  if (scan_mode === "full_repo" && existing_files.length > MAX_EXPLICIT_FILES) {
    const excludes: string[] = [];
    for (const d of _SCAN_SKIP_DIRS) excludes.push("--exclude", d);
    cmd = [...base_cmd, ...excludes, code_dir];
    console.error(`[run-ast-scan] 🔍 running semgrep full-repo directory scan (${existing_files.length} source files > ${MAX_EXPLICIT_FILES})...`);
  } else {
    cmd = [...base_cmd, "--scan-unknown-extensions", ...existing_files];
    console.error(`[run-ast-scan] 🔍 running semgrep ${scan_mode === "full_repo" ? "full-repo" : ""} scan on ${existing_files.length} files...`);
  }

  const timeout_seconds = scan_mode === "full_repo" ? 600 : 300;

  // One rule the installed Semgrep cannot parse (newer syntax, schema drift, YAML slip)
  // must not turn the whole pack into "0 hits": locate the offending rule from the
  // error span, drop it, rewrite the pack and retry a few times.
  // The pack is validated against a single target first (cheap: an invalid config
  // fails before any file is parsed), rejected rules are removed and the check repeats.
  const dropped_rules: Record<string, any>[] = [];
  const sg_version = semgrep_version();
  const remembered = load_rejected_rules(sg_version);
  if (Object.keys(remembered).length) {
    const before = extracted.length;
    extracted = extracted.filter((r) => {
      const code = String(r.ruleCode || r.id);
      if (!(code in remembered)) return true;
      dropped_rules.push({ ruleId: code, id: r.id ?? null, reason: remembered[code], remembered: true });
      return false;
    });
    if (extracted.length !== before) {
      merged_yaml = merge_rules_to_yaml(extracted);
      writeFileSync(yaml_path, merged_yaml, "utf8");
      console.error(`[run-ast-scan] ℹ️  skipped ${before - extracted.length} rule(s) semgrep ${sg_version} rejected earlier`);
    }
  }
  const validate_cmd = [...base_cmd, "--scan-unknown-extensions", existing_files[0]];
  for (let attempt = 0; attempt < 25; attempt++) {
    const check = _run(validate_cmd, 120, code_dir);
    if (check.error) break;
    let check_output: any;
    try {
      check_output = check.stdout.trim() ? JSON.parse(check.stdout) : {};
    } catch {
      break;
    }
    const bad = invalid_rule_ids_from_semgrep_errors(check_output.errors || [], merged_yaml, yaml_path);
    if (!bad.length) break;
    for (const b of bad) {
      const hit = extracted.find((r) => String(r.ruleCode || r.id) === b.ruleId);
      dropped_rules.push({ ruleId: b.ruleId, id: hit?.id ?? null, reason: b.reason });
      console.error(`[run-ast-scan] ⚠️  dropping rule ${b.ruleId} (installed semgrep rejects it): ${b.reason}`);
    }
    const bad_ids = new Set(bad.map((b) => b.ruleId));
    extracted = extracted.filter((r) => !bad_ids.has(String(r.ruleCode || r.id)));
    if (!extracted.length) {
      _cleanup_pack();
      return {
        ruleCount: 0,
        totalRuleCount: total_rule_count,
        skippedRuleCount: skipped_count,
        droppedRules: dropped_rules,
        projectLanguage: detected_lang,
        scannedFiles: 0,
        totalFindings: 0,
        findings: [],
        errors: ["every rule was rejected by the installed semgrep; upgrade semgrep (pip3 install -U semgrep)"],
        scanMode: scan_mode,
        scanOk: false,
      };
    }
    merged_yaml = merge_rules_to_yaml(extracted);
    writeFileSync(yaml_path, merged_yaml, "utf8");
  }
  if (dropped_rules.length) {
    console.error(
      `[run-ast-scan] ⚠️  ${dropped_rules.length} rule(s) dropped for semgrep ${sg_version || "?"}; ${extracted.length} remain` +
        ` (upgrade semgrep to load the full pack: pip3 install -U semgrep)`,
    );
    const newly = dropped_rules.filter((d) => !d.remembered);
    if (newly.length) {
      const merged = { ...remembered };
      for (const d of newly) merged[String(d.ruleId)] = String(d.reason || "rejected");
      save_rejected_rules(sg_version, merged);
    }
  }

  let semgrep_output: any = {};
  const proc = _run(cmd, timeout_seconds, code_dir);
  if (proc.error) {
    if (proc.error.code === "ENOENT") {
      _cleanup_pack();
      return {
        ruleCount: extracted.length,
        scannedFiles: 0,
        totalFindings: 0,
        findings: [],
        errors: ["semgrep is not on PATH; confirm the install path and add it to PATH"],
        scanMode: scan_mode,
        scanOk: false,
      };
    }
    if (proc.error.code === "ETIMEDOUT") {
      _cleanup_pack();
      return {
        ruleCount: extracted.length,
        scannedFiles: 0,
        totalFindings: 0,
        findings: [],
        errors: [`semgrep timed out (>${timeout_seconds}s)`],
        scanMode: scan_mode,
        scanOk: false,
      };
    }
  }

  const errors_list: string[] = [];
  if (proc.returncode !== 0 && proc.returncode !== 1) {
    errors_list.push(`semgrep exitCode=${proc.returncode}, stderr=${(proc.stderr || "").slice(0, 500)}`);
  }

  let findings: Record<string, any>[] = [];
  try {
    semgrep_output = proc.stdout.trim() ? JSON.parse(proc.stdout) : {};
  } catch {
    errors_list.push(`semgrep output is not JSON: ${proc.stdout.slice(0, 300)}`);
    semgrep_output = {};
  }
  // A config that is still invalid after the retries means nothing was scanned.
  const config_still_invalid = (semgrep_output.errors || []).some((e: any) =>
    /invalid configuration|Invalid YAML|InvalidRuleSchema/i.test(`${e.type || ""} ${e.message || ""} ${e.long_msg || ""}`),
  );

  for (const result_item of semgrep_output.results || []) {
    const check_id = result_item.check_id || "";
    let rule_id_clean: string;
    if (check_id.includes(".")) {
      const parts = check_id.split(".");
      rule_id_clean = check_id;
      let found = false;
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part.startsWith("RULE-") || part.startsWith("rule_")) {
          rule_id_clean = part;
          found = true;
          break;
        }
      }
      if (!found) rule_id_clean = parts[parts.length - 1];
    } else {
      rule_id_clean = check_id;
    }

    // Semgrep reports paths as given (absolute when we passed absolute files).
    // Persist repo-relative, forward-slash paths regardless of host OS.
    let path = String(result_item.path || "");
    if (isAbsolute(path)) path = relative(code_dir, path);
    path = to_posix(path);
    const start_info = result_item.start || {};
    const end_info = result_item.end || {};
    const extra = result_item.extra || {};

    const abs_path = !isAbsolute(path) ? join(code_dir, path) : path;
    const auto_gen = is_auto_generated_file(abs_path);

    findings.push({
      ruleId: rule_id_clean,
      filePath: path,
      line: start_info.line || 0,
      endLine: end_info.line || 0,
      message: extra.message || "",
      snippet: extra.lines || "",
      autoGenerated: auto_gen,
    });
  }

  // Semgrep pattern-either can emit duplicate hits on the same line; keep one.
  {
    const seen = new Set<string>();
    findings = findings.filter((f) => {
      const key = `${f.ruleId}\0${f.filePath}\0${f.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  for (const err_item of semgrep_output.errors || []) {
    errors_list.push(`[${err_item.level || "?"}] ${err_item.message || err_item.long_msg || err_item.short_msg || ""}`);
  }
  if (config_still_invalid) {
    _cleanup_pack();
    return {
      ruleCount: extracted.length,
      totalRuleCount: total_rule_count,
      skippedRuleCount: skipped_count,
      droppedRules: dropped_rules,
      projectLanguage: detected_lang,
      scannedFiles: 0,
      totalFindings: 0,
      findings: [],
      errors: ["semgrep rejected the rule pack; no file was scanned", ...errors_list],
      scanMode: scan_mode,
      scanOk: false,
    };
  }

  const auto_gen_count = findings.filter((f) => f.autoGenerated).length;
  const manual_findings = findings.filter((f) => !f.autoGenerated);

  if (auto_gen_count > 0) {
    console.error(
      `[run-ast-scan] scan complete: ${findings.length} hits (${auto_gen_count} in auto-generated files, LLM verification can be skipped), ` +
        `${errors_list.length} warnings/errors`,
    );
  } else {
    console.error(`[run-ast-scan] scan complete: ${findings.length} hits, ${errors_list.length} warnings/errors`);
  }

  let findings_with_exclusion = 0;
  if (findings.length && exclusion_index) {
    findings = attach_exclusion_context(findings, exclusion_index, rules_json);
    findings_with_exclusion = findings.filter((f) => f.hasExclusionRules).length;
  }

  if (!output_yaml_path) {
    _cleanup_pack();
  }

  return {
    ruleCount: extracted.length,
    totalRuleCount: total_rule_count,
    skippedRuleCount: skipped_count,
    projectLanguage: detected_lang,
    languages: [...scan_langs].sort(),
    droppedRules: dropped_rules,
    scannedFiles: existing_files.length,
    totalFindings: findings.length,
    autoGeneratedFindings: auto_gen_count,
    manualFindings: manual_findings.length,
    findingsWithExclusion: findings_with_exclusion,
    findings,
    errors: errors_list.length ? errors_list : [],
    scanMode: scan_mode,
    scanOk: true,
  };
}
