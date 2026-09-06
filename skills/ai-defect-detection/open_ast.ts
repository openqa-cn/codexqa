/**
 * AST rule batch-scan module (strategyCode=8 acceleration).
 *
 * Core functions:
 *   1. Extract semgrep YAML from category=1 rules
 *   2. Merge into a single rules file
 *   3. Run semgrep against the whole repo (or specified files)
 *   4. Return structured findings
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, extname, isAbsolute, join, relative } from "node:path";

import { attach_exclusion_context } from "./open_rules.ts";

function _which(cmd: string): string | null {
  if (!cmd) return null;
  if (cmd.includes("/") || cmd.includes("\\")) {
    return existsSync(cmd) ? cmd : null;
  }
  const pathEnv = process.env.PATH || "";
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT || ".EXE").split(";") : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

function _run(
  cmd: string[],
  timeout_s: number,
  cwd?: string,
): { returncode: number; stdout: string; stderr: string; error?: NodeJS.ErrnoException } {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    timeout: timeout_s * 1000,
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    returncode: result.status ?? (result.error ? -1 : 1),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error as NodeJS.ErrnoException | undefined,
  };
}

export function ensure_semgrep_installed(): boolean {
  if (_which("semgrep")) return true;

  console.error("[run-ast-scan] ⚠️  semgrep is not installed, installing automatically...");

  const py = _which("python3") || _which("python");
  if (py) {
    const pip_cmd = [py, "-m", "pip", "install", "semgrep", "--quiet", "--disable-pip-version-check"];
    try {
      const proc = _run(pip_cmd, 300);
      if (proc.error && proc.error.code === "ETIMEDOUT") {
        console.error("[run-ast-scan] ⚠️  pip install semgrep failed: Command timed out");
      } else if (proc.returncode === 0 && _which("semgrep")) {
        console.error("[run-ast-scan] ✅ semgrep installed via pip");
        return true;
      } else {
        const user_bin = join(homedir(), ".local", "bin");
        if (existsSync(join(user_bin, "semgrep"))) {
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

  if (_which("brew")) {
    try {
      const proc = _run(["brew", "install", "semgrep"], 300);
      if (proc.error && proc.error.code === "ETIMEDOUT") {
        console.error("[run-ast-scan] ⚠️  brew install semgrep failed: Command timed out");
      } else if (proc.returncode === 0 && _which("semgrep")) {
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

export const _LANG_TO_EXTENSIONS: Record<string, Set<string>> = {
  java: new Set([".java"]),
  javascript: new Set([".js", ".jsx", ".mjs", ".cjs"]),
  typescript: new Set([".ts", ".tsx", ".mts", ".cts"]),
  python: new Set([".py", ".pyi"]),
  go: new Set([".go"]),
  ruby: new Set([".rb"]),
  kotlin: new Set([".kt", ".kts"]),
  scala: new Set([".scala"]),
  swift: new Set([".swift"]),
  rust: new Set([".rs"]),
  c: new Set([".c", ".h"]),
  cpp: new Set([".cpp", ".cc", ".cxx", ".hpp", ".hxx"]),
  csharp: new Set([".cs"]),
  php: new Set([".php"]),
  generic: new Set(),
};

function _file_ext(f: string): string {
  const base = f.split(/[/\\]/).pop() || "";
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i).toLowerCase();
}

export function detect_project_language(target_files: string[]): string | null {
  const lang_counts: Record<string, number> = {};
  for (const f of target_files) {
    const ext = _file_ext(f) || extname(f).toLowerCase();
    for (const [lang, exts] of Object.entries(_LANG_TO_EXTENSIONS)) {
      if (lang === "generic") continue;
      if (exts.has(ext)) {
        lang_counts[lang] = (lang_counts[lang] || 0) + 1;
        break;
      }
    }
  }

  const keys = Object.keys(lang_counts);
  if (!keys.length) return null;

  let primary_lang = keys[0];
  let primary_count = lang_counts[primary_lang];
  for (const lang of keys) {
    if (lang_counts[lang] > primary_count) {
      primary_lang = lang;
      primary_count = lang_counts[lang];
    }
  }
  const total = Object.values(lang_counts).reduce((a, b) => a + b, 0);
  if (lang_counts[primary_lang] / total >= 0.7) return primary_lang;
  return null;
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

export function filter_rules_by_language(
  extracted_rules: Record<string, any>[],
  project_lang: string,
): [Record<string, any>[], number] {
  if (!project_lang) return [extracted_rules, 0];

  const filtered: Record<string, any>[] = [];
  let skipped = 0;
  for (const rule of extracted_rules) {
    const rule_langs = _extract_rule_languages(rule.yaml_text);
    if (!rule_langs.size) {
      filtered.push(rule);
    } else if (rule_langs.has("generic") || rule_langs.has(project_lang)) {
      filtered.push(rule);
    } else {
      skipped += 1;
      const lang_repr = `{${[...rule_langs].map((x) => `'${x}'`).join(", ")}}`;
      console.error(
        `[run-ast-scan] 🔇 skip rule id=${rule.id} (language=${lang_repr}, project language=${project_lang})`,
      );
    }
  }
  return [filtered, skipped];
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

export function annotate_findings_in_diff(
  findings: Record<string, any>[],
  diff_files: string[] | null | undefined,
): Record<string, any>[] {
  const has_diff = Boolean(diff_files && diff_files.length);
  return (findings || []).map((f) => ({
    ...f,
    inDiff: has_diff ? path_in_diff(f.filePath, diff_files) : null,
  }));
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

function _collect_source_files(code_dir: string, project_language: string | null = null): string[] {
  const skip_dirs = new Set([
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
  ]);
  const skip_exts = new Set([".class", ".jar", ".war", ".ear", ".pyc", ".o", ".so", ".dll", ".exe"]);

  let target_exts: Set<string> | null = null;
  if (project_language && _LANG_TO_EXTENSIONS[project_language]) {
    const exts = _LANG_TO_EXTENSIONS[project_language];
    if (exts.size) target_exts = exts;
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
      source_files.push(relative(code_dir, full_path));
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

  let detected_lang: string | null = project_language || detect_project_language(target_files);
  let skipped_count = 0;
  if (detected_lang) {
    const filtered = filter_rules_by_language(extracted, detected_lang);
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
        scannedFiles: 0,
        totalFindings: 0,
        findings: [],
        errors: [`all rules are non-${detected_lang}; no usable rules after filtering`],
        scanMode: scan_mode,
      };
    }
  } else {
    skipped_count = 0;
    detected_lang = null;
  }

  const merged_yaml = merge_rules_to_yaml(extracted);
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
  if (scan_mode === "full_repo") {
    cmd = ["semgrep", "scan", "--config", yaml_path, "--json", "--no-git-ignore", "--timeout", "60", code_dir];
    console.error("[run-ast-scan] 🔍 running semgrep full-repo scan...");
  } else {
    cmd = ["semgrep", "scan", "--config", yaml_path, "--json", "--no-git-ignore", "--timeout", "60", ...existing_files];
    console.error(`[run-ast-scan] 🔍 running semgrep scan on ${existing_files.length} files...`);
  }

  const timeout_seconds = scan_mode === "full_repo" ? 600 : 300;
  const proc = _run(cmd, timeout_seconds, code_dir);
  if (proc.error) {
    if (proc.error.code === "ENOENT") {
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
  let semgrep_output: any = {};
  try {
    semgrep_output = proc.stdout.trim() ? JSON.parse(proc.stdout) : {};
  } catch {
    errors_list.push(`semgrep output is not JSON: ${proc.stdout.slice(0, 300)}`);
    semgrep_output = {};
  }

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

    let path = result_item.path || "";
    if (path.startsWith(code_dir)) {
      path = relative(code_dir, path);
    }
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

  for (const err_item of semgrep_output.errors || []) {
    errors_list.push(`[${err_item.level || "?"}] ${err_item.message || ""}`);
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
    try {
      unlinkSync(yaml_path);
    } catch {
      /* ignore */
    }
  }

  return {
    ruleCount: extracted.length,
    totalRuleCount: total_rule_count,
    skippedRuleCount: skipped_count,
    projectLanguage: detected_lang,
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
