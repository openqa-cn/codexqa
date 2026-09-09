/**
 * Integrated automation commands: get-changed-methods / build-detection-plan /
 * verify-line-method-mapping / extract-rules-from-docs
 *
 * Covers changed-method extraction, detection-plan building, line-number mapping checks, and document rule extraction.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { get_pending_processes, seed_pending_processes } from "./platform.ts";
import { _cli_error, _cli_result, _cli_success, _require_save } from "./cli_common.ts";
import { gotchas_doc_for_language, language_breakdown, language_from_path } from "./lang.ts";
import {
  type SemgrepUnitRange,
  class_name_for_file,
  extract_units_for_file,
  filter_units_by_line_ranges,
  is_jvm_file,
  is_source_file,
  locate_source_file,
  merge_semgrep_units,
  semgrep_function_ranges,
} from "./lang_methods.ts";
import { ContentStore } from "./store.ts";
import { run } from "./sys.ts";
import { classify_trivial_method, stamp_trivial_on_plan, submit_trivial_writebacks } from "./trivial.ts";

type Args = Record<string, any>;

function _is_dir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function _is_file(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function _spawn(argv: string[], timeout_s = 60): { returncode: number; stdout: string; stderr: string } {
  return run(argv, { timeout_s });
}

/**
 * Method units for one file, any supported language (see lang_methods.ts).
 * JVM files never fall back to a file-level unit (interfaces / constant holders
 * are not plan items); every other source file always yields at least one unit.
 */
function _extract_methods_from_file(file_path: string, rel_path?: string, sg?: SemgrepUnitRange[] | null): any[] {
  const rel = rel_path || file_path;
  const units = extract_units_for_file(file_path, rel, { fileLevelFallback: !is_jvm_file(rel) });
  return sg?.length ? merge_semgrep_units(units, sg, language_from_path(rel)) : units;
}

/**
 * Real repo-relative path for a unit's className.
 *
 * Units extracted from a diff already carry the file they came from (`known_path`);
 * use it verbatim. Otherwise match against the diff files, and only fall back to the
 * `a/b/C.java` convention for a JVM-looking className. Guessing a `.java` path for a
 * JS or Python unit yields a file that does not exist, and both the write-back
 * reconciler and validation rule 24 then reject the finding.
 */
function _resolve_class_file_path(class_name: string, diff_files: string[], known_path?: string | null): string {
  if (known_path) return known_path;
  // Path-style names keep dots in the file stem (`tests/lang.test`); only FQCNs rewrite dots.
  const as_path = class_name.includes("/")
    ? class_name.replace(/\\/g, "/")
    : class_name.replace(/\./g, "/");
  const simple = as_path.split("/").pop()!;
  for (const df of diff_files) {
    if (df.replace(/\.[^./]+$/, "") === as_path) return df;
  }
  for (const df of diff_files) {
    const stem = df.replace(/\.[^./]+$/, "");
    if (stem === as_path || stem.endsWith("/" + simple)) return df;
  }
  // No diff evidence: never invent a .java path for an already path-style name.
  if (class_name.includes("/")) return class_name;
  return as_path + ".java";
}

/** Match a method name in haystack without throwing on regex metacharacters (Scala `+++`, `?`). */
function _method_name_in_hay(mn: string, hay: string): boolean {
  if (!mn) return false;
  if (!/^\w+$/.test(mn)) return hay.includes(mn);
  try {
    return new RegExp(`\\b${mn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay);
  } catch {
    return hay.includes(mn);
  }
}

/**
 * className + analysis units for one changed file.
 *
 * JVM files keep the package-style className (`com/acme/OrderService`); every
 * other source file becomes `path/without/extension` + language units (or a
 * single file-level unit). Non-source files (pom.xml, markdown, JSON) are not units.
 * `sg` carries Semgrep-derived ranges for the file when refinement ran.
 */
function _units_for_changed_file(local_dir: string, rel_path: string, sg?: SemgrepUnitRange[] | null): [string, any[]] | null {
  const full_path = join(local_dir, rel_path);
  if (!_is_file(full_path)) return null;
  if (!is_source_file(rel_path)) return null;

  const class_name = class_name_for_file(rel_path);
  if (!class_name) return null;
  const language = language_from_path(rel_path);
  const units = _extract_methods_from_file(full_path, rel_path, sg).map((u) => ({
    ...u,
    filePath: rel_path,
    language: u.language || language || undefined,
  }));
  return units.length ? [class_name, units] : null;
}

export function _extract_changed_methods_from_diff(
  local_dir: string,
  diff_files: string[] | null = null,
  base_rev: string | null = null,
  diff_mode = "three-dot",
): Record<string, any[]> {
  if (!_is_dir(local_dir)) return {};

  function _git_diff(...rev_args: string[]) {
    return _spawn(["git", "-C", local_dir, "diff", "--unified=0", ...rev_args], 120);
  }

  let diff_output = "";
  try {
    if (base_rev) {
      const specs = diff_mode === "three-dot" ? [`${base_rev}...HEAD`] : [base_rev, "HEAD"];
      let r = _git_diff(...specs);
      if (r.returncode !== 0 || !r.stdout.trim()) {
        const fallback = diff_mode === "three-dot" ? [base_rev, "HEAD"] : [`${base_rev}...HEAD`];
        r = _git_diff(...fallback);
      }
      if (r.returncode === 0) {
        diff_output = r.stdout || "";
      }
    }
    if (!diff_output.trim()) {
      let r = _git_diff("HEAD");
      if (r.returncode !== 0 || !r.stdout.trim()) {
        r = _git_diff("--cached");
      }
      if (r.returncode !== 0 || !r.stdout.trim()) {
        r = _git_diff("HEAD~1", "HEAD");
      }
      if (r.returncode === 0) {
        diff_output = r.stdout || "";
      }
    }
  } catch (e: any) {
    console.error(`[get-changed-methods] git diff failed: ${e}`);
    return {};
  }

  if (!diff_output.trim()) {
    if (!diff_files) return {};
    const result: Record<string, any[]> = {};
    const sg_all = semgrep_function_ranges(local_dir, diff_files.filter((f) => is_source_file(f)));
    for (const f of diff_files) {
      const pair = _units_for_changed_file(local_dir, f, sg_all[f]);
      if (!pair) continue;
      const [class_name, methods] = pair;
      for (const meth of methods) meth.changeType = "modified";
      result[class_name] = methods;
    }
    return result;
  }

  let current_file: string | null = null;
  let pending_new = false;
  const new_files = new Set<string>();
  const changed_lines_by_file: Record<string, Array<[number, number]>> = {};

  for (const line of diff_output.split(/\n/)) {
    if (line.startsWith("--- /dev/null")) {
      pending_new = true;
      continue;
    }
    if (line.startsWith("--- a/")) {
      pending_new = false;
    }
    const fm = line.match(/^\+\+\+ b\/(.+)$/);
    if (fm) {
      current_file = fm[1];
      if (pending_new && current_file) new_files.add(current_file);
      pending_new = false;
      continue;
    }
    if (line.startsWith("+++ /dev/null")) {
      current_file = null;
      pending_new = false;
      continue;
    }

    const hm = line.match(/^@@@? -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@@?/);
    if (hm && current_file) {
      const new_start = parseInt(hm[1], 10);
      const new_count = parseInt(hm[2] || "1", 10);
      if (!(current_file in changed_lines_by_file)) changed_lines_by_file[current_file] = [];
      changed_lines_by_file[current_file].push([new_start, new_start + new_count - 1]);
      continue;
    }
  }

  const files_to_scan = new Set([...Object.keys(changed_lines_by_file), ...new_files]);
  // Do NOT union every name-only diff file: renames / mode changes / binaries have no
  // hunks and would otherwise be planned as fully "added". Added files are already in
  // `new_files` via the `--- /dev/null` header.
  if (diff_files) {
    for (const f of diff_files) {
      if (is_source_file(f) && new_files.has(f)) files_to_scan.add(f);
    }
  }

  const result: Record<string, any[]> = {};

  // One Semgrep batch for every changed source file (no-op when Semgrep is absent).
  const sg_ranges = semgrep_function_ranges(
    local_dir,
    [...files_to_scan].filter((f) => is_source_file(f) && _is_file(join(local_dir, f))),
  );

  for (const file_path of files_to_scan) {
    const pair = _units_for_changed_file(local_dir, file_path, sg_ranges[file_path]);
    if (!pair) continue;
    const [class_name, all_methods] = pair;

    const line_ranges = changed_lines_by_file[file_path] || [];
    const is_new = new_files.has(file_path);
    if (!is_new && !line_ranges.length) continue; // rename / mode-change / binary — no changed lines
    const changed_methods = filter_units_by_line_ranges(all_methods, line_ranges, is_new)
      .map((method) => ({ ...method, changeType: is_new ? "added" : "modified" }));

    if (changed_methods.length) {
      result[class_name] = changed_methods;
    }
  }

  // Expose hunk ranges to the orchestrator without making this metadata look
  // like a class entry to direct callers iterating Object.keys/Object.entries.
  Object.defineProperty(result, "__hunks", {
    value: changed_lines_by_file,
    enumerable: false,
    configurable: true,
  });
  return result;
}

function _git_diff_rev_specs(base_rev: string | null, diff_mode: string): string[][] {
  if (!base_rev) return [["HEAD~1", "HEAD"]];
  if (diff_mode === "three-dot") return [[`${base_rev}...HEAD`], [base_rev, "HEAD"]];
  return [[base_rev, "HEAD"], [`${base_rev}...HEAD`]];
}

export function _parse_git_numstat(stdout: string): number {
  let total = 0;
  for (const line of (stdout || "").split(/\n/)) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const added = parts[0].trim();
    const deleted = parts[1].trim();
    if (added === "-" || deleted === "-") continue;
    const a = parseInt(added, 10);
    const d = parseInt(deleted, 10);
    if (Number.isNaN(a) || Number.isNaN(d)) continue;
    total += a + d;
  }
  return total;
}

export function _count_total_change_lines(local_dir: string, base_rev: string | null, diff_mode = "three-dot"): number {
  for (const specs of _git_diff_rev_specs(base_rev, diff_mode)) {
    let r;
    try {
      r = _spawn(["git", "-C", local_dir, "diff", "--numstat", "--no-color", ...specs], 60);
    } catch {
      continue;
    }
    if (r.returncode !== 0) continue;
    return _parse_git_numstat(r.stdout);
  }
  return 0;
}

export function run_get_changed_methods(args: Args): Record<string, any> {
  const task_id = args.task_id;
  const local_dir = args.local_dir;

  if (!_is_dir(local_dir)) {
    _cli_error(`local code directory does not exist: ${local_dir}`);
    return;
  }

  if (!_is_dir(join(local_dir, ".git"))) {
    _cli_error(`not a Git repository: ${local_dir}`);
    return;
  }

  let diff_files: string[] | null = null;
  if (args.diff_files) {
    diff_files = args.diff_files.split(",").map((f: string) => f.trim()).filter(Boolean);
  } else {
    try {
      const store = new ContentStore(task_id);
      const meta = store.load_meta_only();
      diff_files = (meta.diff || {}).files || [];
    } catch {
      diff_files = null;
    }
  }

  const _found_base: Array<string | null> = [null];
  if (!diff_files || !diff_files.length) {
    try {
      // origin/HEAD first: it names the repo's actual default branch, so we do
      // not diff a `main` repo against a stale `master` that happens to exist.
      for (const base of ["origin/HEAD", "origin/main", "origin/master", "origin/develop", "HEAD~1"]) {
        const r = _spawn(["git", "-C", local_dir, "diff", "--name-only", base, "HEAD"], 60);
        if (r.returncode === 0 && r.stdout.trim()) {
          diff_files = r.stdout.trim().split("\n").map((f) => f.trim()).filter(Boolean);
          _found_base[0] = base;
          break;
        }
      }
    } catch {
      // pass
    }
  }

  if (!diff_files || !diff_files.length) {
    _cli_error(
      "Unable to get the changed-file list. Pass --diff-files, " +
        "or ensure content store already has diff.files, or that git diff can run.",
    );
    return;
  }

  let base_rev = args.base_rev || null;
  let diff_mode = args.diff_mode || "three-dot";
  if (!base_rev) {
    try {
      const store = new ContentStore(task_id);
      const diff_base = store.get_meta_field("diffBase") || {};
      base_rev = diff_base.baseRev || null;
      diff_mode = diff_base.diffMode || diff_mode;
    } catch {
      // pass
    }
  }
  if (!base_rev) base_rev = _found_base[0];
  const changed_methods_map = _extract_changed_methods_from_diff(
    local_dir, diff_files, base_rev, diff_mode,
  );
  const diff_hunks: Record<string, Array<[number, number]>> =
    (changed_methods_map as any).__hunks || {};
  delete (changed_methods_map as any).__hunks;

  const _total_change_lines = _count_total_change_lines(local_dir, base_rev, diff_mode);

  const store = new ContentStore(task_id);

  const existing_diff = (store.load_meta_only().diff || {}).files || [];
  if (!existing_diff.length) {
    store.set_diff_files(diff_files);
  }

  store.set_total_change_lines(_total_change_lines);
  if (Object.keys(diff_hunks).length) store.set_diff_hunks(diff_hunks);

  let total_methods = 0;
  for (const [class_name, methods] of Object.entries(changed_methods_map)) {
    store.add_changed_methods(class_name, methods);
    total_methods += methods.length;
  }

  _require_save(store);

  const all_methods: any[] = [];
  for (const class_name of Object.keys(changed_methods_map).sort()) {
    const methods = changed_methods_map[class_name];
    for (const m of methods) {
      const m_copy = { ...m };
      m_copy.className = class_name;
      m_copy.filePath = _resolve_class_file_path(class_name, diff_files, m.filePath);
      all_methods.push(m_copy);
    }
  }

  const java_diff_files = diff_files.filter((f) => is_jvm_file(f));
  const non_java_diff_files = diff_files.filter((f) => !is_jvm_file(f));
  const source_diff_files = diff_files.filter((f) => is_source_file(f));
  const semgrep_refined = all_methods.filter((m) => m.rangeSource === "semgrep").length;

  const success_data: Record<string, any> = {
    taskId: task_id,
    localDir: local_dir,
    diffFiles: diff_files,
    diffFileCount: diff_files.length,
    // Kept for callers that read the historical keys; prefer the language-neutral ones below.
    javaDiffFileCount: java_diff_files.length,
    nonJavaDiffFiles: non_java_diff_files,
    sourceDiffFileCount: source_diff_files.length,
    nonSourceDiffFiles: diff_files.filter((f) => !is_source_file(f)),
    diffFilesByLanguage: language_breakdown(diff_files),
    semgrepRefinedUnits: semgrep_refined,
    changedClassCount: Object.keys(changed_methods_map).length,
    changedMethodCount: total_methods,
    changedMethods: all_methods,
    totalChangeLines: _total_change_lines,
    persisted: true,
  };

  success_data.msg = (
    `changed-method extraction complete: ${diff_files.length} files, ` +
      `${Object.keys(changed_methods_map).length} classes, ${total_methods} methods`
  );
  return success_data;
}

export function cmd_get_changed_methods(args: Args): void {
  const data = run_get_changed_methods(args);
  const msg = data.msg;
  delete data.msg;
  _cli_success(data, msg);
}

function _calc_min_detect_level(case_relevance: string, doc_relevance: string): string {
  if (case_relevance === "direct") return "L2+TC";
  if (case_relevance === "indirect" || doc_relevance === "direct") return "L2";
  if (doc_relevance === "indirect") return "L1+doc";
  return "L1";
}

function _calc_detect_tier(case_relevance: string, doc_relevance: string, source = "diff", strategy_code = 11): string {
  if (case_relevance === "direct" || _calc_min_detect_level(case_relevance, doc_relevance) === "L2+TC") {
    return "T1";
  }
  if (doc_relevance === "direct" || (source === "pending" && strategy_code === 11)) {
    return "T2";
  }
  if (_calc_min_detect_level(case_relevance, doc_relevance) === "L2") {
    return "T2";
  }
  return "T3";
}

type Relevance = { doc_rel: string; case_rel: string };

/**
 * Doc / case relevance for a changed method.
 *
 * - caseRelevance: a test case lists `Class#method` in `relatedMethods`
 *   (direct unless the case fetch failed → indirect).
 * - docRelevance: an extractedRule mentions the class (simple name), `Class#method`,
 *   or the bare method name — in its `text` or its `related` column. A rule with a
 *   known `source` makes it direct, otherwise indirect.
 */
export function build_relevance_resolver(
  store: ContentStore,
  changed_methods_raw: Record<string, any>,
): (cn: string, mn: string) => Relevance {
  const static_shard = store.load_static_only();
  const test_cases = store.load_test_cases_only();
  const extracted_rules: any[] = static_shard.extractedRules || store.get_meta_field("extractedRules", []) || [];
  const case_list: any[] = test_cases.testCases || [];

  const case_related = new Set<string>();
  const case_direct = new Set<string>();
  for (const caseObj of case_list) {
    for (const rm of caseObj.relatedMethods || []) {
      const ref = String(rm);
      if (!ref.includes("#")) continue;
      const idx = ref.lastIndexOf("#");
      const cn = ref.slice(0, idx);
      const mn = ref.slice(idx + 1);
      const simple = cn.split(/[/.]/).pop()!;
      for (const key of [`${cn}\0${mn}`, `${simple}\0${mn}`]) {
        case_related.add(key);
        if (caseObj.fetchStatus !== "failed") case_direct.add(key);
      }
    }
  }

  const doc_related_cls = new Set<string>();
  const doc_direct_cls = new Set<string>();
  const doc_related_m = new Set<string>();
  const doc_direct_m = new Set<string>();
  const method_names_of = (cn: string): string[] => {
    const raw = changed_methods_raw[cn];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((m: any) => String(m?.methodName || m?.name || m || "")).filter(Boolean);
  };
  for (const rule of extracted_rules) {
    const source = rule && typeof rule === "object" ? String(rule.source || "") : "";
    const text = rule && typeof rule === "object" ? String(rule.text || "") : String(rule);
    const related = rule && typeof rule === "object" ? String(rule.related || "") : "";
    const hay = `${text} ${related}`;
    if (!hay.trim()) continue;
    const direct = Boolean(source) && source !== "unknown";
    for (const cn of Object.keys(changed_methods_raw)) {
      const simple_cn = cn.split(/[/.]/).pop()!;
      const hit_cls = Boolean(simple_cn) && hay.includes(simple_cn);
      let hit_any_m = false;
      for (const mn of method_names_of(cn)) {
        // `Simple#method`, or a bare method name long enough not to be a common word.
        // Escape metacharacters: Scala symbolic methods (`+++`, `?`) must not crash RegExp.
        const hit_m = hay.includes(`${simple_cn}#${mn}`) || (mn.length >= 5 && _method_name_in_hay(mn, hay));
        if (hit_m) {
          hit_any_m = true;
          doc_related_m.add(`${cn}\0${mn}`);
          if (direct) doc_direct_m.add(`${cn}\0${mn}`);
        }
      }
      // A rule that names specific methods is direct for those methods only; its siblings in
      // the same class are merely related (L1+doc). A rule that names the class without a
      // method applies to every changed method of that class.
      if (hit_cls || hit_any_m) doc_related_cls.add(cn);
      if (hit_cls && !hit_any_m && direct) doc_direct_cls.add(cn);
    }
  }

  return (cn: string, mn: string): Relevance => {
    const simple = cn.split(/[/.]/).pop()!;
    let case_rel = "none";
    if (case_direct.has(`${cn}\0${mn}`) || case_direct.has(`${simple}\0${mn}`)) case_rel = "direct";
    else if (case_related.has(`${cn}\0${mn}`) || case_related.has(`${simple}\0${mn}`)) case_rel = "indirect";
    let doc_rel = "none";
    if (doc_direct_m.has(`${cn}\0${mn}`) || doc_direct_cls.has(cn)) doc_rel = "direct";
    else if (doc_related_m.has(`${cn}\0${mn}`) || doc_related_cls.has(cn)) doc_rel = "indirect";
    return { doc_rel, case_rel };
  };
}

/**
 * Re-stamp docRelevance / caseRelevance / minDetectLevel / detectTier on pending,
 * non-trivial plan items. Needed because `clone-and-diff --with-plan` builds the plan
 * (Step 1.5) before docs and cases are registered (Step 1.7); without this every item
 * stays T3 and the context-read gate is silently exempt. Tiers only move up.
 */
export function restamp_plan_relevance(store: ContentStore): { updated: number; upgraded: string[] } {
  const meta = store.load_meta_only();
  const changed_methods_raw = (meta.diff || {}).changedMethods || {};
  const plan = store.load_plan_only();
  const items: any[] = plan.detectionPlan || [];
  if (!items.length) return { updated: 0, upgraded: [] };
  const relevance = build_relevance_resolver(store, changed_methods_raw);
  const rank: Record<string, number> = { T1: 3, T2: 2, T3: 1 };
  const updated: any[] = [];
  const upgraded: string[] = [];
  for (const item of items) {
    if (item.trivial || item.status !== "pending") continue;
    const { doc_rel, case_rel } = relevance(item.className, item.methodName);
    const min_detect_level = _calc_min_detect_level(case_rel, doc_rel);
    const new_tier = _calc_detect_tier(case_rel, doc_rel, item.source || "diff", item.strategyCode ?? 11);
    const keep_tier = (rank[new_tier] || 0) >= (rank[item.detectTier] || 0) ? new_tier : item.detectTier;
    if (doc_rel === item.docRelevance && case_rel === item.caseRelevance && keep_tier === item.detectTier
        && min_detect_level === item.minDetectLevel) continue;
    if (keep_tier !== item.detectTier) upgraded.push(`${item.className}#${item.methodName}: ${item.detectTier}→${keep_tier}`);
    updated.push({
      className: item.className,
      methodName: item.methodName,
      strategyCode: item.strategyCode ?? 11,
      docRelevance: doc_rel,
      caseRelevance: case_rel,
      minDetectLevel: min_detect_level,
      detectTier: keep_tier,
    });
  }
  if (updated.length) store.add_detection_plan_items(updated, true);
  return { updated: updated.length, upgraded };
}

export function run_build_detection_plan(args: Args): Record<string, any> {
  const task_id = args.task_id;
  const store = new ContentStore(task_id);
  const meta = store.load_meta_only();
  const static_shard = store.load_static_only();
  const test_cases = store.load_test_cases_only();

  const changed_methods_raw = (meta.diff || {}).changedMethods || {};
  const diff_files = (meta.diff || {}).files || [];

  const total_change_lines = store.get_total_change_lines();
  const _mode = (total_change_lines > 0 && total_change_lines < 200) ? "light" : "strict";
  console.error(`[build-detection-plan] 📊 totalChangeLines=${total_change_lines} → mode=${_mode}`);

  if (!Object.keys(changed_methods_raw).length && !args.skip_diff_empty) {
    console.error("[build-detection-plan] ⚠️  changedMethods is empty; run get-changed-methods first");
  }

  let batch_ids: number[] = [];
  if (args.batch_ids) {
    batch_ids = args.batch_ids.split(",").map((x: string) => x.trim()).filter(Boolean).map((x: string) => parseInt(x, 10));
  } else {
    for (const svc of meta.services || []) {
      for (const bid of svc.batchIds || []) {
        if (!batch_ids.includes(bid)) batch_ids.push(bid);
      }
    }
  }

  const pending_map: Record<string, any> = {};
  if (batch_ids.length) {
    for (const bid of batch_ids) {
      try {
        const pending_result = get_pending_processes(bid);
        const pending = (pending_result && typeof pending_result === "object")
          ? (pending_result.data ?? pending_result)
          : pending_result;
        if (pending) {
          for (const p of pending) {
            const cn = p.className || "";
            const mn = p.methodName || "";
            const sc = p.strategyCode ?? 11;
            pending_map[`${cn}::${mn}::${sc}`] = p;
          }
        }
      } catch (e: any) {
        console.error(`[build-detection-plan] get-pending batchId=${bid} failed: ${e}`);
      }
    }
  }

  const relevance = build_relevance_resolver(store, changed_methods_raw);

  const detection_plan: any[] = [];
  const seen_keys = new Set<string>();
  const changed_lookup = store.get_changed_method_lookup();

  function _lookup_changed(cn: string, mn: string) {
    const simple = cn.includes("/") ? cn.split("/").pop()! : cn.split(".").pop()!;
    return changed_lookup.get(`${cn}#${mn}`) || changed_lookup.get(`${simple}#${mn}`) || null;
  }

  for (const p of Object.values(pending_map)) {
    const cn = p.className || "";
    const mn = p.methodName || "";
    const sc = p.strategyCode ?? 11;
    const plan_key = `${cn}\0${mn}\0${sc}`;
    if (seen_keys.has(plan_key)) continue;
    seen_keys.add(plan_key);

    // Processes this skill seeded from its own diff plan (local provider) are still
    // diff-derived: keep their tier rules identical to the first build instead of
    // treating them like platform-originated pending work.
    const source = p.seededFrom === "detection-plan" ? "diff" : "pending";
    const { doc_rel, case_rel } = relevance(cn, mn);
    const min_detect_level = _calc_min_detect_level(case_rel, doc_rel);
    const detect_tier = _calc_detect_tier(case_rel, doc_rel, source, sc);
    const detail = _lookup_changed(cn, mn);

    const pending_item: Record<string, any> = {
      className: cn,
      methodName: mn,
      strategyCode: sc,
      parentBatchId: p.parentBatchId,
      processId: p.processId,
      batchId: p.batchId,
      filePath: p.filePath,
      docRelevance: doc_rel,
      caseRelevance: case_rel,
      source,
      status: "pending",
      minDetectLevel: min_detect_level,
      detectTier: detect_tier,
      chainGroupId: null,
      mode: _mode,
    };
    if (detail?.bodyLineCount != null) pending_item.bodyLineCount = detail.bodyLineCount;
    if (detail?.expressionBody === true) pending_item.expressionBody = true;
    if (detail?.params != null && detail.params !== "") pending_item.params = detail.params;
    detection_plan.push(pending_item);
  }

  for (const [cn, raw_names] of Object.entries(changed_methods_raw)) {
    let method_names: any = raw_names;
    if (typeof method_names === "string") method_names = [method_names];
    for (const raw of method_names as any[]) {
      const detail = raw && typeof raw === "object" ? raw : { methodName: raw };
      const mn = String(detail.methodName || detail.name || raw || "").trim();
      if (!mn) continue;
      const sc = 11;
      const plan_key = `${cn}\0${mn}\0${sc}`;
      if (seen_keys.has(plan_key)) continue;
      seen_keys.add(plan_key);

      const { doc_rel, case_rel } = relevance(cn, mn);
      const min_detect_level = _calc_min_detect_level(case_rel, doc_rel);
      const detect_tier = _calc_detect_tier(case_rel, doc_rel, "diff", sc);

      const file_path = _resolve_class_file_path(cn, diff_files, detail.filePath);

      const item: Record<string, any> = {
        className: cn,
        methodName: mn,
        strategyCode: sc,
        parentBatchId: null,
        processId: null,
        batchId: null,
        filePath: file_path,
        docRelevance: doc_rel,
        caseRelevance: case_rel,
        source: "diff",
        status: "pending",
        minDetectLevel: min_detect_level,
        detectTier: detect_tier,
        chainGroupId: null,
        mode: _mode,
      };
      if (detail.bodyLineCount != null) item.bodyLineCount = detail.bodyLineCount;
      if (detail.params != null) item.params = detail.params;
      if (detail.startLine != null) item.startLine = detail.startLine;
      if (detail.endLine != null) item.endLine = detail.endLine;
      if (detail.rangeSource) item.rangeSource = detail.rangeSource;
      if (detail.expressionBody === true) item.expressionBody = true;
      item.language = detail.language || language_from_path(file_path || "") || null;
      if (detail.fileLevel) item.fileLevel = true;
      detection_plan.push(item);
    }
  }

  for (const item of detection_plan) {
    if (!item.language) item.language = language_from_path(item.filePath || "") || null;
    const cls = classify_trivial_method({
      className: item.className,
      methodName: item.methodName,
      bodyLineCount: item.bodyLineCount,
      expressionBody: item.expressionBody,
      params: item.params || "",
      language: item.language,
      filePath: item.filePath,
      fileLevel: item.fileLevel,
    });
    item.trivial = Boolean(cls.trivial);
    item.trivialReason = cls.trivialReason;
    item.suggestedTier = cls.suggestedTier;
    if (cls.trivial) item.detectTier = "T3";
  }

  // Diff-derived items have no platform process yet. Providers that let the
  // skill own the pending list (local) seed one per item so that `get-pending`
  // and `check-coverage` reflect the plan instead of an empty batch; remote
  // providers answer `supported: false` and the items keep processId=null.
  const seeded_summary = _seed_plan_processes(detection_plan, meta.services || [], batch_ids);

  if (detection_plan.length) {
    store.add_detection_plan_items(detection_plan, false);
    _require_save(store);
  }

  const pending_count = detection_plan.filter((i) => i.source === "pending").length;
  const diff_count = detection_plan.filter((i) => i.source === "diff").length;
  const trivial_count = detection_plan.filter((i) => i.trivial).length;
  const deep_count = detection_plan.length - trivial_count;

  // Languages actually present in the plan drive which STEP C notes the agent must read.
  const plan_languages = [...new Set(
    detection_plan
      .map((i) => i.language || (i.filePath ? language_from_path(String(i.filePath)) : null))
      .filter(Boolean) as string[],
  )].sort();
  const gotchas_docs = [...new Set(plan_languages.map((l) => gotchas_doc_for_language(l)).filter(Boolean) as string[])];

  const success_data: Record<string, any> = {
    taskId: task_id,
    detectionPlanTotal: detection_plan.length,
    fromPending: pending_count,
    fromDiff: diff_count,
    trivialCount: trivial_count,
    deepAnalysisCount: deep_count,
    mode: _mode,
    totalChangeLines: total_change_lines,
    languages: plan_languages,
    gotchasDocs: gotchas_docs,
    detectionPlan: detection_plan,
    deepAnalysis: detection_plan.filter((i) => !i.trivial),
    batchIds: batch_ids,
    seededProcesses: seeded_summary,
    persisted: true,
  };

  success_data.msg = (
    `detection plan built: ${detection_plan.length} items (pending=${pending_count}, diff=${diff_count}), ` +
      `${trivial_count} trivial / ${deep_count} deep, ` +
      `mode=${_mode} (total ${total_change_lines} changed lines)`
  );
  return success_data;
}

/** Pick the parentBatchId a diff item belongs to; null when it cannot be decided (multi-service without modulePrefix). */
function _batch_for_plan_item(item: Record<string, any>, services: any[], batch_ids: number[]): number | null {
  if (item.parentBatchId) return parseInt(String(item.parentBatchId), 10);
  if (batch_ids.length === 1) return batch_ids[0];
  const file_path = String(item.filePath || "");
  for (const svc of services) {
    const prefix = String(svc.modulePrefix || "").replace(/^\/+|\/+$/g, "");
    const bid = (svc.batchIds || [])[0];
    if (prefix && bid && (file_path === prefix || file_path.startsWith(prefix + "/"))) return bid;
  }
  return null;
}

function _seed_plan_processes(detection_plan: any[], services: any[], batch_ids: number[]): Record<string, any> {
  const summary: Record<string, any> = { supported: null, seeded: 0, reused: 0, unassigned: 0, batches: {} };
  const by_batch = new Map<number, any[]>();
  for (const item of detection_plan) {
    if (item.processId) continue;
    const bid = _batch_for_plan_item(item, services, batch_ids);
    if (!bid) {
      summary.unassigned += 1;
      continue;
    }
    if (!by_batch.has(bid)) by_batch.set(bid, []);
    by_batch.get(bid)!.push(item);
  }
  for (const [bid, items] of by_batch) {
    let res: Record<string, any>;
    try {
      res = seed_pending_processes(bid, items.map((i) => ({
        className: i.className,
        methodName: i.methodName,
        strategyCode: i.strategyCode ?? 11,
        filePath: i.filePath,
        detectTier: i.detectTier,
      })));
    } catch (e: any) {
      console.error(`[build-detection-plan] ⚠️  seed pending processes for batch ${bid} failed: ${e.message || e}`);
      continue;
    }
    const data = (res && typeof res === "object" && "data" in res) ? res.data : res;
    if (!data || data.supported === false || (res && res.code && res.code !== 0)) {
      summary.supported = false;
      continue;
    }
    summary.supported = true;
    const lookup = new Map<string, number>();
    for (const p of [...(data.seeded || []), ...(data.reused || [])]) {
      lookup.set(`${p.className}\0${p.methodName || ""}\0${p.strategyCode ?? 11}`, p.processId);
    }
    for (const item of items) {
      const pid = lookup.get(`${item.className}\0${item.methodName || ""}\0${item.strategyCode ?? 11}`);
      if (pid == null) continue;
      item.processId = pid;
      item.parentBatchId = bid;
      item.batchId = bid;
    }
    summary.seeded += data.seededCount || 0;
    summary.reused += data.reusedCount || 0;
    summary.batches[String(bid)] = { seeded: data.seededCount || 0, reused: data.reusedCount || 0 };
  }
  if (summary.supported) {
    console.error(
      `[build-detection-plan] 🪪 pending processes on platform: ${summary.seeded} seeded, ${summary.reused} reused` +
        (summary.unassigned ? `, ${summary.unassigned} item(s) left without a batch (multi-service, no modulePrefix match)` : ""),
    );
  }
  return summary;
}

export function cmd_build_detection_plan(args: Args): void {
  const data = run_build_detection_plan(args);
  const msg = data.msg;
  delete data.msg;
  _cli_success(data, msg);
}

export function run_prep_and_plan(args: Args): Record<string, any> {
  const task_id = args.task_id;
  let local_dir = args.local_dir || null;
  if (!local_dir) {
    try {
      const store = new ContentStore(task_id);
      for (const svc of store.load_meta_only().services || []) {
        if (svc.localDir) {
          local_dir = svc.localDir;
          break;
        }
      }
    } catch {
      // pass
    }
  }
  if (!local_dir) {
    _cli_error("prep-and-plan needs --local-dir, or a registered service localDir from clone-and-diff");
  }

  const methods = run_get_changed_methods({
    task_id,
    local_dir,
    diff_files: args.diff_files,
    base_rev: args.base_rev,
    diff_mode: args.diff_mode,
  });
  const plan = run_build_detection_plan({
    task_id,
    batch_ids: args.batch_ids,
  });
  const filter_results = (plan.detectionPlan || []).map((item: any) =>
    classify_trivial_method({
      className: item.className,
      methodName: item.methodName,
      bodyLineCount: item.bodyLineCount,
      expressionBody: item.expressionBody,
      params: item.params || "",
      language: item.language,
      filePath: item.filePath,
      fileLevel: item.fileLevel,
    }),
  );
  const stamped = stamp_trivial_on_plan(task_id, filter_results);
  let submit: Record<string, any> | null = null;
  if (args.submit_trivial) {
    submit = submit_trivial_writebacks(task_id, filter_results);
  }

  return {
    taskId: task_id,
    localDir: local_dir,
    changedMethodCount: methods.changedMethodCount,
    changedClassCount: methods.changedClassCount,
    totalChangeLines: methods.totalChangeLines || plan.totalChangeLines,
    mode: plan.mode,
    detectionPlanTotal: plan.detectionPlanTotal,
    fromPending: plan.fromPending,
    fromDiff: plan.fromDiff,
    trivialCount: plan.trivialCount,
    deepAnalysisCount: plan.deepAnalysisCount,
    stampedOnPlan: stamped,
    deepAnalysis: plan.deepAnalysis,
    submit,
    persisted: true,
  };
}

export function cmd_prep_and_plan(args: Args): void {
  const data = run_prep_and_plan(args);
  const submit_note = data.submit
    ? `; submitted ${data.submit.success || 0} trivial write-back(s)`
    : "";
  _cli_success(
    data,
    `prep-and-plan complete: ${data.changedMethodCount || 0} methods, ` +
      `${data.detectionPlanTotal || 0} plan items ` +
      `(${data.trivialCount || 0} trivial / ${data.deepAnalysisCount || 0} deep)` +
      submit_note,
  );
}

export function cmd_verify_line_method_mapping(args: Args): void {
  const task_id = args.task_id;
  const class_name = args.class_name;
  const method_name = args.method_name;
  const content = args.content;
  let local_dir = args.local_dir;
  let file_hint: string | null = null;

  try {
    const store = new ContentStore(task_id);
    const meta = store.load_meta_only();
    if (!local_dir) {
      for (const svc of meta.services || []) {
        if (svc.localDir) {
          local_dir = svc.localDir;
          break;
        }
      }
    }
    // The plan / changed-method record knows the real file for any language.
    file_hint = store.get_changed_method_file_path(class_name, method_name)
      || (store.load_plan_only()?.detectionPlan || []).find((i: any) => i.className === class_name && i.methodName === method_name && i.filePath)?.filePath
      || null;
  } catch {
    // pass
  }

  if (!local_dir || !_is_dir(local_dir)) {
    _cli_error(`local code directory does not exist: ${local_dir}`, {
      hint: "pass --local-dir or ensure the service localDir is registered in the content store",
    });
    return;
  }

  const line_numbers: Array<[number, number]> = [];
  const rangeRe = /(?:Lines?:|lines?\s+|L)(\d+)\s*[-–—~to]\s*(\d+)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRe.exec(content)) !== null) {
    line_numbers.push([parseInt(rm[1], 10), parseInt(rm[2], 10)]);
  }
  if (!line_numbers.length) {
    const singleRe = /(?:line|L)(\d+)/gi;
    let sm: RegExpExecArray | null;
    while ((sm = singleRe.exec(content)) !== null) {
      const n = parseInt(sm[1], 10);
      line_numbers.push([n, n]);
    }
  }

  if (!line_numbers.length) {
    _cli_result(1, {
      verified: false,
      reason: "no line-number info found in content (expected format: Lines: X-Y or lines X-Y)",
      className: class_name,
      methodName: method_name,
    }, "unable to extract line numbers; check the content format");
    return;
  }

  const target_file = locate_source_file(local_dir, class_name, file_hint);
  if (!target_file) {
    _cli_error(`source file not found: ${class_name}`, { searchedDir: local_dir, className: class_name });
    return;
  }

  const target_rel = relative(local_dir, target_file);
  const sg = semgrep_function_ranges(local_dir, [target_rel]);
  const all_methods = _extract_methods_from_file(target_file, target_rel, sg[target_rel]);

  let target_method: any = null;
  for (const m of all_methods) {
    if (m.methodName === method_name) {
      target_method = m;
      break;
    }
  }

  if (!target_method) {
    _cli_result(1, {
      verified: false,
      reason: `method ${method_name} not found in the file`,
      className: class_name,
      methodName: method_name,
      file: relative(local_dir, target_file),
      allMethods: all_methods.map((m) => m.methodName),
    }, `method ${method_name} not found; the method name may be misspelled`);
    return;
  }

  const m_start = target_method.startLine;
  const m_end = target_method.endLine;

  const mismatches: any[] = [];
  for (const [start_line, end_line] of line_numbers) {
    if (start_line < m_start || start_line > m_end) {
      let actual_method: any = null;
      for (const m of all_methods) {
        if (m.startLine <= start_line && start_line <= m.endLine) {
          actual_method = m;
          break;
        }
      }
      mismatches.push({
        claimedLine: `${start_line}-${end_line}`,
        claimedMethod: method_name,
        actualMethod: actual_method ? actual_method.methodName : "unknown",
        actualMethodRange: actual_method ? `L${actual_method.startLine}-L${actual_method.endLine}` : null,
        targetMethodRange: `L${m_start}-L${m_end}`,
      });
    }
  }

  if (mismatches.length) {
    _cli_result(1, {
      verified: false,
      className: class_name,
      methodName: method_name,
      methodRange: `L${m_start}-L${m_end}`,
      file: relative(local_dir, target_file),
      mismatches,
      fix: "correct --method-name to the method that actually owns the lines, or fix the line numbers in content",
    }, `line-number ownership check failed: ${mismatches.length} mismatch(es)`);
  } else {
    _cli_success({
      verified: true,
      className: class_name,
      methodName: method_name,
      methodRange: `L${m_start}-L${m_end}`,
      file: relative(local_dir, target_file),
      checkedLines: line_numbers.map(([s, e]) => `${s}-${e}`),
    }, `line-number ownership check passed: ${method_name} L${m_start}-L${m_end}`);
  }
}

const _RULE_PARAGRAPH_CAP_PER_DOC = 60;
const _RULE_TEXT_MAX_CHARS = 500;
// Shell / package-manager invocations and `VAR=value cmd` lines copied from READMEs.
const _COMMAND_LINE_RE = /^(?:\$\s|[A-Z_][A-Z0-9_]*=\S|(?:node|npm|npx|yarn|pnpm|git|cd|curl|wget|docker|make|python3?|pip3?|go|cargo|mvn|gradle|java|bash|sh)\b)/;
// "Owner: …", "Status: …", "Environment: …" style front-matter lines.
const _METADATA_LINE_RE = /^(?:owner|status|author|date|version|generated at|taskid|url|source|environment|last reviewed|reviewer|scope)\s*[:：·]/i;

/**
 * Turn a raw markdown/plain-text document body into candidate business-rule
 * sentences. Hard-wrapped lines are folded into one paragraph so a rule that
 * spans three lines yields one entry instead of three fragments.
 */
export function _rule_paragraphs_from_doc(body: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let in_fence = false;

  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(" ").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    buf = [];
    if (text.length < 12) return;
    if (!/\s/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) return;
    if (_COMMAND_LINE_RE.test(text) || _METADATA_LINE_RE.test(text)) return;
    if (/^\[[^\]]*\]\([^)]*\)\.?$/.test(text)) return; // bare markdown link
    if (/[:：]$/.test(text)) return; // "Seed used by every case:" — introduces a list, not a rule
    out.push(text.length > _RULE_TEXT_MAX_CHARS ? text.slice(0, _RULE_TEXT_MAX_CHARS - 1) + "…" : text);
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      in_fence = !in_fence;
      flush();
      continue;
    }
    if (in_fence) continue;
    if (!line) {
      flush();
      continue;
    }
    // Headings, tables (incl. wrapped table cells ending in "|"), html, images, rules, quotes.
    if (/^(#|\||<|!\[|---|===|>)/.test(line) || /\|\s*$/.test(line)) {
      flush();
      continue;
    }
    const list_match = line.match(/^(?:\d+[.、)]|[-*+•])\s+(.*)$/);
    if (list_match) {
      flush();
      buf.push(list_match[1]);
      continue;
    }
    if (_COMMAND_LINE_RE.test(line)) {
      flush();
      continue;
    }
    buf.push(line);
    if (out.length >= _RULE_PARAGRAPH_CAP_PER_DOC) break;
  }
  flush();
  return out.slice(0, _RULE_PARAGRAPH_CAP_PER_DOC);
}

export function cmd_extract_rules_from_docs(args: Args): void {
  const task_id = args.task_id;
  const store = new ContentStore(task_id);

  let doc_summary_path = args.doc_summary_path || null;
  if (!doc_summary_path) {
    const context = store.load_context_only();
    doc_summary_path = context.docSummaryPath || "";
  }

  if (!doc_summary_path || !_is_file(doc_summary_path)) {
    const default_path = join(store._dir, "DOC_SUMMARY.md");
    if (_is_file(default_path)) {
      doc_summary_path = default_path;
    } else {
      _cli_error("DOC_SUMMARY.md not found", {
        searched: doc_summary_path ? [doc_summary_path, default_path] : [default_path],
      });
      return;
    }
  }

  let doc_content: string;
  try {
    doc_content = readFileSync(doc_summary_path, "utf8");
  } catch (e: any) {
    _cli_error(`failed to read DOC_SUMMARY.md: ${e}`);
    return;
  }

  if (!doc_content.trim()) {
    _cli_error("DOC_SUMMARY.md is empty");
    return;
  }

  const extracted_rules: any[] = [];
  let rule_id = 0;

  let in_table = false;
  let table_headers: string[] = [];
  for (const line of doc_content.split(/\n/)) {
    const stripped = line.trim();
    if (stripped.startsWith("|") && /rule/i.test(stripped)) {
      in_table = true;
      table_headers = stripped.split("|").map((h) => h.trim().replace(/^\|+|\|+$/g, "").trim()).filter(Boolean);
      continue;
    }
    if (in_table && stripped.startsWith("|") && stripped.includes("---")) continue;
    if (in_table && stripped.startsWith("|")) {
      const cells = stripped.split("|").map((c) => c.trim().replace(/^\|+|\|+$/g, "").trim()).filter(Boolean);
      if (!cells.length || !cells[0]) continue;
      const first_cell = cells[0];
      const idm = first_cell.match(/^R(\d+)$/i);
      let text: string;
      let source: string;
      let related = "";
      if (idm) {
        rule_id = parseInt(idm[1], 10);
        text = cells.length > 1 ? cells[1] : "";
        source = cells.length > 2 ? cells[2] : "";
        related = cells.length > 3 ? cells[3] : "";
      } else {
        rule_id += 1;
        text = cells.length > 1 ? cells[1] : first_cell;
        source = cells.length > 2 ? cells[2] : "";
        related = cells.length > 3 ? cells[3] : "";
      }
      if (text) {
        const rule: Record<string, any> = { id: `R${rule_id}`, text, source: source || "DOC_SUMMARY" };
        if (related) rule.related = related; // "Related code file/method" column → docRelevance
        extracted_rules.push(rule);
      }
      continue;
    }
    if (in_table && !stripped.startsWith("|")) {
      in_table = false;
    }
  }

  if (extracted_rules.length < 2) {
    const current_source = "DOC_SUMMARY";
    for (const line of doc_content.split(/\n/)) {
      const stripped = line.trim();
      const lm = stripped.match(/^(?:\d+[.、]|[-*])\s+(.+)/);
      if (lm) {
        const text = lm[1].trim();
        if (text.length < 5 || text.startsWith("#") || text.startsWith("[")) continue;
        if (extracted_rules.some((r) => r.text === text)) continue;
        rule_id += 1;
        extracted_rules.push({
          id: `R${rule_id}`,
          text,
          source: current_source,
        });
      }
    }
  }

  const static_shard = store.load_static_only();
  const docs = static_shard.documents || {};
  for (const doc_type of ["techDocs", "prdDocs"]) {
    for (const doc of docs[doc_type] || []) {
      const biz_rules = doc.businessRules || "";
      // `businessRules` is often the raw document body (scan-repo-docs / local_repo):
      // fold hard-wrapped lines back into paragraphs, drop code fences, tables,
      // headings, shell commands and metadata, then keep one rule per paragraph.
      if (biz_rules && biz_rules.length > 5) {
        for (const rule_text of _rule_paragraphs_from_doc(biz_rules)) {
          if (extracted_rules.some((r) => r.text === rule_text)) continue;
          rule_id += 1;
          const source = doc.title || doc_type;
          extracted_rules.push({
            id: `R${rule_id}`,
            text: rule_text,
            source,
          });
        }
      }
    }
  }

  if (!extracted_rules.length) {
    _cli_error(
      "Failed to extract business rules from the documents. " +
        "Check that DOC_SUMMARY.md contains a rule table or rule list, " +
        "or write them manually via set-meta-field --key extractedRules.",
    );
    return;
  }

  store.set_meta("extractedRules", extracted_rules);
  _require_save(store);

  _cli_success(
    {
      taskId: task_id,
      extractedRulesCount: extracted_rules.length,
      extractedRules: extracted_rules,
      source: doc_summary_path,
      persisted: true,
    },
    `business-rule extraction complete: ${extracted_rules.length} rules written to extractedRules`,
  );
}
