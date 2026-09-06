/**
 * Integrated automation commands: get-changed-methods / build-detection-plan /
 * verify-line-method-mapping / extract-rules-from-docs
 *
 * Covers changed-method extraction, detection-plan building, line-number mapping checks, and document rule extraction.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

import { get_pending_processes } from "./open_platform.ts";
import { _cli_error, _cli_result, _cli_success, _require_save } from "./open_cli_common.ts";
import { ContentStore } from "./open_store.ts";
import { classify_trivial_method, stamp_trivial_on_plan, submit_trivial_writebacks } from "./open_cli_run.ts";

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
  const r = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeout_s * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    returncode: r.status ?? (r.error ? -1 : 1),
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

function _extract_java_methods_from_file(file_path: string): any[] {
  let lines: string[];
  try {
    lines = readFileSync(file_path, "utf8").split(/\n/);
    // keep trailing newline semantics similar to readlines
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines = lines.map((l) => l + "\n");
  } catch {
    return [];
  }

  if (!lines.length) return [];

  const method_sig = new RegExp(
    "^\\s*" +
      "(?:public|private|protected|static|final|synchronized|native|abstract|default|@\\w+(?:\\([^)]*\\))?)\\s*" +
      ".*?" +
      "(?:<[\\w\\s,?\\[\\]extends\\s\\w]+>\\s+)?" +
      "([\\w\\[\\]<>?,\\s]+?)\\s+" +
      "(\\w+)\\s*" +
      "\\(([^)]*)\\)",
  );

  const constructor_sig = new RegExp(
    "^\\s*" +
      "(?:public|private|protected)\\s+" +
      "(\\w+)\\s*" +
      "\\(([^)]*)\\)\\s*" +
      "(?:throws\\s+[\\w,\\s]+\\s*)?" +
      "\\{",
  );

  const methods: any[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let matched: RegExpMatchArray | null = null;
    let is_constructor = false;

    const m = line.match(method_sig);
    if (m) {
      const method_name = m[2];
      if (!["if", "while", "for", "switch", "catch", "return", "throw", "new", "assert"].includes(method_name)) {
        matched = m;
        is_constructor = false;
      }
    }

    if (!matched) {
      const cm = line.match(constructor_sig);
      if (cm) {
        const class_simple_name = extname(basename(file_path))
          ? basename(file_path).slice(0, -extname(basename(file_path)).length)
          : basename(file_path);
        if (cm[1] === class_simple_name) {
          matched = cm;
          is_constructor = true;
        }
      }
    }

    if (matched && !is_constructor) {
      const method_name = matched[2];
      const return_type = matched[1].trim();
      const raw_params = matched[3].trim();

      const param_list: string[] = [];
      if (raw_params) {
        for (let p of raw_params.split(",")) {
          p = p.trim();
          if (!p) continue;
          const parts = p.split(/\s+/);
          if (parts.length >= 2) {
            let param_type = parts.slice(0, -1).join(" ").trim();
            param_type = param_type.replace(/<.*?>/g, "").replace("final ", "").trim();
            param_list.push(param_type);
          } else if (parts.length) {
            param_list.push(parts[0].trim());
          }
        }
      }

      const params_str = param_list.join(",");

      const start_line = i + 1;
      let brace_count = 0;
      let found_open = false;
      let method_end = i;
      let j = i;
      while (j < lines.length && j < i + 5) {
        brace_count += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
        if (lines[j].includes("{")) found_open = true;
        if (found_open && brace_count <= 0) {
          method_end = j;
          break;
        }
        j += 1;
      }

      if (!found_open) {
        i += 1;
        continue;
      }

      if (method_end === i && found_open && brace_count > 0) {
        j = i + 1;
        let found_close = false;
        while (j < lines.length) {
          brace_count += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
          if (brace_count <= 0) {
            method_end = j;
            found_close = true;
            break;
          }
          j += 1;
        }
        if (!found_close) {
          method_end = lines.length - 1;
        }
      }

      const end_line = method_end + 1;
      let body_line_count = end_line - start_line - 1;
      if (body_line_count < 0) body_line_count = 0;

      const signature = `${return_type} ${method_name}(${params_str})`;

      methods.push({
        methodName: method_name,
        returnType: return_type,
        params: params_str,
        startLine: start_line,
        endLine: end_line,
        bodyLineCount: body_line_count,
        signature,
      });
    }

    i += 1;
  }

  return methods;
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
    for (const f of diff_files) {
      if (!f.endsWith(".java") && !f.endsWith(".kt") && !f.endsWith(".scala")) continue;
      const full_path = join(local_dir, f);
      if (!_is_file(full_path)) continue;
      let class_name = f;
      for (const prefix of ["src/main/java/", "src/test/java/", "src/main/kotlin/"]) {
        if (class_name.includes(prefix)) {
          class_name = class_name.split(prefix)[1];
          break;
        }
      }
      class_name = class_name.replace(/\.[^.]+$/, "");
      if (!class_name) continue;
      const methods = _extract_java_methods_from_file(full_path);
      if (methods.length) {
        for (const meth of methods) meth.changeType = "modified";
        result[class_name] = methods;
      }
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
  if (diff_files) {
    for (const f of diff_files) {
      if (f.endsWith(".java") || f.endsWith(".kt") || f.endsWith(".scala")) files_to_scan.add(f);
    }
  }

  const result: Record<string, any[]> = {};

  for (const file_path of files_to_scan) {
    if (!file_path.endsWith(".java") && !file_path.endsWith(".kt") && !file_path.endsWith(".scala")) continue;

    const full_path = join(local_dir, file_path);
    if (!_is_file(full_path)) continue;

    let class_name = file_path;
    for (const prefix of ["src/main/java/", "src/test/java/", "src/main/kotlin/"]) {
      if (class_name.includes(prefix)) {
        class_name = class_name.split(prefix)[1];
        break;
      }
    }
    class_name = class_name.replace(/\.[^.]+$/, "");
    if (!class_name) continue;

    const all_methods = _extract_java_methods_from_file(full_path);
    const line_ranges = changed_lines_by_file[file_path] || [];
    const is_new = new_files.has(file_path) || (!line_ranges.length && Boolean(diff_files) && diff_files!.includes(file_path));
    const changed_methods: any[] = [];
    for (const method of all_methods) {
      const m_start = method.startLine;
      const m_end = method.endLine;
      let is_changed = is_new;
      if (!is_changed) {
        for (const [rng_start, rng_end] of line_ranges) {
          if (rng_start <= m_end && rng_end >= m_start) {
            is_changed = true;
            break;
          }
        }
      }
      if (is_changed) {
        const method_copy = { ...method };
        method_copy.changeType = is_new ? "added" : "modified";
        changed_methods.push(method_copy);
      }
    }

    if (changed_methods.length) {
      result[class_name] = changed_methods;
    }
  }

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
      for (const base of ["origin/master", "origin/main", "HEAD~1"]) {
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

  const _total_change_lines = _count_total_change_lines(local_dir, base_rev, diff_mode);

  const store = new ContentStore(task_id);

  const existing_diff = (store.load_meta_only().diff || {}).files || [];
  if (!existing_diff.length) {
    store.set_diff_files(diff_files);
  }

  store.set_total_change_lines(_total_change_lines);

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
      let file_path = class_name.replace(/\./g, "/") + ".java";
      for (const df of diff_files) {
        if (df.includes(class_name.replace(/\./g, "/")) || df.includes(class_name.split("/").pop()!)) {
          file_path = df;
          break;
        }
      }
      m_copy.filePath = file_path;
      all_methods.push(m_copy);
    }
  }

  const java_diff_files = diff_files.filter((f) => f.endsWith(".java") || f.endsWith(".kt") || f.endsWith(".scala"));
  const non_java_diff_files = diff_files.filter((f) => !f.endsWith(".java") && !f.endsWith(".kt") && !f.endsWith(".scala"));

  const success_data: Record<string, any> = {
    taskId: task_id,
    localDir: local_dir,
    diffFiles: diff_files,
    diffFileCount: diff_files.length,
    javaDiffFileCount: java_diff_files.length,
    nonJavaDiffFiles: non_java_diff_files,
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

  const extracted_rules = static_shard.extractedRules || [];
  const case_list = test_cases.testCases || [];

  const case_related_methods = new Set<string>();
  const case_direct_methods = new Set<string>();
  for (const caseObj of case_list) {
    for (const rm of caseObj.relatedMethods || []) {
      if (String(rm).includes("#")) {
        const idx = String(rm).lastIndexOf("#");
        const cn = String(rm).slice(0, idx);
        const mn = String(rm).slice(idx + 1);
        case_related_methods.add(`${cn}\0${mn}`);
        if (caseObj.fetchStatus !== "failed") {
          case_direct_methods.add(`${cn}\0${mn}`);
        }
      }
    }
  }

  const doc_related_methods = new Set<string>();
  const doc_direct_methods = new Set<string>();
  for (const rule of extracted_rules) {
    const source = (rule && typeof rule === "object") ? (rule.source || "") : "";
    const text = (rule && typeof rule === "object") ? (rule.text || "") : String(rule);
    for (const cn of Object.keys(changed_methods_raw)) {
      const simple_cn = cn.includes("/") ? cn.split("/").pop()! : cn;
      if (simple_cn && text.includes(simple_cn)) {
        doc_related_methods.add(cn);
        if (source && source !== "unknown") {
          doc_direct_methods.add(cn);
        }
      }
    }
  }

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

    let doc_rel = "none";
    let case_rel = "none";
    if (case_direct_methods.has(`${cn}\0${mn}`)) case_rel = "direct";
    else if (case_related_methods.has(`${cn}\0${mn}`)) case_rel = "indirect";
    if (doc_direct_methods.has(cn)) doc_rel = "direct";
    else if (doc_related_methods.has(cn)) doc_rel = "indirect";

    const min_detect_level = _calc_min_detect_level(case_rel, doc_rel);
    const detect_tier = _calc_detect_tier(case_rel, doc_rel, "pending", sc);
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
      source: "pending",
      status: "pending",
      minDetectLevel: min_detect_level,
      detectTier: detect_tier,
      chainGroupId: null,
      mode: _mode,
    };
    if (detail?.bodyLineCount != null) pending_item.bodyLineCount = detail.bodyLineCount;
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

      let doc_rel = "none";
      let case_rel = "none";
      if (case_direct_methods.has(`${cn}\0${mn}`)) case_rel = "direct";
      else if (case_related_methods.has(`${cn}\0${mn}`)) case_rel = "indirect";
      if (doc_direct_methods.has(cn)) doc_rel = "direct";
      else if (doc_related_methods.has(cn)) doc_rel = "indirect";

      const min_detect_level = _calc_min_detect_level(case_rel, doc_rel);
      const detect_tier = _calc_detect_tier(case_rel, doc_rel, "diff", sc);

      let file_path: string | null = null;
      for (const df of diff_files) {
        const cn_path = cn.replace(/\./g, "/");
        const last = cn.split("/").pop()!.split(".").pop()!;
        if (df.includes(cn_path) || df.includes(last)) {
          file_path = df;
          break;
        }
      }
      if (!file_path) file_path = cn.replace(/\./g, "/") + ".java";

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
      detection_plan.push(item);
    }
  }

  for (const item of detection_plan) {
    const cls = classify_trivial_method({
      className: item.className,
      methodName: item.methodName,
      bodyLineCount: item.bodyLineCount,
      params: item.params || "",
    });
    item.trivial = Boolean(cls.trivial);
    item.trivialReason = cls.trivialReason;
    item.suggestedTier = cls.suggestedTier;
    if (cls.trivial) item.detectTier = "T3";
  }

  if (detection_plan.length) {
    store.add_detection_plan_items(detection_plan, false);
    _require_save(store);
  }

  const pending_count = detection_plan.filter((i) => i.source === "pending").length;
  const diff_count = detection_plan.filter((i) => i.source === "diff").length;
  const trivial_count = detection_plan.filter((i) => i.trivial).length;
  const deep_count = detection_plan.length - trivial_count;

  const success_data: Record<string, any> = {
    taskId: task_id,
    detectionPlanTotal: detection_plan.length,
    fromPending: pending_count,
    fromDiff: diff_count,
    trivialCount: trivial_count,
    deepAnalysisCount: deep_count,
    mode: _mode,
    totalChangeLines: total_change_lines,
    detectionPlan: detection_plan,
    deepAnalysis: detection_plan.filter((i) => !i.trivial),
    batchIds: batch_ids,
    persisted: true,
  };

  success_data.msg = (
    `detection plan built: ${detection_plan.length} items (pending=${pending_count}, diff=${diff_count}), ` +
      `${trivial_count} trivial / ${deep_count} deep, ` +
      `mode=${_mode} (total ${total_change_lines} changed lines)`
  );
  return success_data;
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
      params: item.params || "",
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

function _glob_star(root: string, relPattern: string): string[] {
  const results: string[] = [];
  const segs = relPattern.split("/");
  function walk(dir: string, idx: number): void {
    if (idx >= segs.length) return;
    const part = segs[idx];
    const last = idx === segs.length - 1;
    if (part === "**") {
      walk(dir, idx + 1);
      let ents: string[] = [];
      try { ents = readdirSync(dir); } catch { return; }
      for (const e of ents) {
        const p = join(dir, e);
        try { if (statSync(p).isDirectory()) walk(p, idx); } catch { /* skip */ }
      }
      return;
    }
    let s = "";
    for (const ch of part) {
      if (ch === "*") s += ".*";
      else if (ch === "?") s += ".";
      else if ("+^${}()|[]\\.".includes(ch)) s += "\\" + ch;
      else s += ch;
    }
    const re = new RegExp("^" + s + "$");
    let ents: string[] = [];
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      if (!re.test(e)) continue;
      const p = join(dir, e);
      if (last) {
        try { if (statSync(p).isFile()) results.push(p); } catch { /* skip */ }
      } else {
        try { if (statSync(p).isDirectory()) walk(p, idx + 1); } catch { /* skip */ }
      }
    }
  }
  walk(root, 0);
  return results;
}

export function cmd_verify_line_method_mapping(args: Args): void {
  const task_id = args.task_id;
  const class_name = args.class_name;
  const method_name = args.method_name;
  const content = args.content;
  let local_dir = args.local_dir;

  if (!local_dir) {
    try {
      const store = new ContentStore(task_id);
      const meta = store.load_meta_only();
      for (const svc of meta.services || []) {
        if (svc.localDir) {
          local_dir = svc.localDir;
          break;
        }
      }
    } catch {
      // pass
    }
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

  let class_path = class_name.replace(/\./g, "/");
  if (class_path.includes("$")) class_path = class_path.split("$")[0];

  let source_files = _glob_star(local_dir, `**/${class_path}.java`);
  if (!source_files.length) {
    const simple_name = class_path.split("/").pop()!;
    source_files = _glob_star(local_dir, `**/${simple_name}.java`);
  }

  if (!source_files.length) {
    _cli_error(`source file not found: ${class_name}`, { searchedDir: local_dir, className: class_name });
    return;
  }

  let target_file = source_files[0];
  for (const f of source_files) {
    if (f.includes("src/main") || f.includes("src/")) {
      target_file = f;
      break;
    }
  }

  const all_methods = _extract_java_methods_from_file(target_file);

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
      if (idm) {
        rule_id = parseInt(idm[1], 10);
        text = cells.length > 1 ? cells[1] : "";
        source = cells.length > 2 ? cells[2] : "";
      } else {
        rule_id += 1;
        text = cells.length > 1 ? cells[1] : first_cell;
        source = cells.length > 2 ? cells[2] : "";
      }
      if (text) {
        extracted_rules.push({
          id: `R${rule_id}`,
          text,
          source: source || "DOC_SUMMARY",
        });
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
      if (biz_rules && biz_rules.length > 5) {
        for (let rule_text of biz_rules.split(/[;\n]/)) {
          rule_text = rule_text.trim();
          if (rule_text.length < 5) continue;
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
