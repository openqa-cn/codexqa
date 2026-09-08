/**
 * Core API functions.
 *
 * Wraps platform provider calls; no CLI command handlers.
 */

import { extract_user_id } from "./auth.ts";
import {
  auto_fill_ids,
  get_batch_git,
  is_already_written,
  lookup_pending_ids,
  mark_method_done,
  mark_written,
} from "./state.ts";
import { py_bool } from "./py_compat.ts";
import { ContentStore } from "./store.ts";
import {
  get_valid_tag_ids,
  pre_validate_and_fix,
  set_valid_tag_ids,
  set_valid_tag_map,
  validate_batch_hollow_check,
  validate_report_content,
  validate_update_process,
} from "./validate.ts";
import { get_issues, get_plan, get_platform, get_traces } from "./providers/registry.ts";

function _in(val: any, ...vals: any[]): boolean {
  return vals.some((v) => v === val);
}

function _py_or(...vals: any[]): any {
  for (const v of vals) {
    if (py_bool(v)) return v;
  }
  return vals.length ? vals[vals.length - 1] : undefined;
}

function _py_get(obj: any, key: string, defaultVal: any = null): any {
  if (obj == null || typeof obj !== "object") return defaultVal;
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : defaultVal;
}

function _is_dict(v: any): boolean {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function _sleep_s(sec: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(sec * 1000));
  } catch {
    const end = Date.now() + sec * 1000;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function _finditer(pattern: string, text: string): RegExpExecArray[] {
  const re = new RegExp(pattern, "gi");
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m[0] === "") re.lastIndex += 1;
  }
  return out;
}

function _json_dumps_py(obj: any): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") return Number.isFinite(obj) ? String(obj) : "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(_json_dumps_py).join(", ")}]`;
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}: ${_json_dumps_py(obj[k])}`);
    return `{${parts.join(", ")}}`;
  }
  return JSON.stringify(obj);
}

function _norm_key_str(k: [string, string]): string {
  return `${k[0]}\0${k[1]}`;
}

function _sorted_keys(keys: Iterable<string>): string[] {
  return [...keys].sort();
}

// ──────────────────── Task submit and status ────────────────────

export function get_plan_info(plan_id: number, plan_type: number): Record<string, any> {
  const result = get_plan().get_plan(plan_id, plan_type);
  if ("_error" in result) {
    console.error(`[planInfo] ⚠️  ${result._error} (will try user materials / content store)`);
    return {};
  }
  if (result.code !== 0) {
    console.error(
      `[planInfo] ⚠️  provider has no plan: code=${result.code}, msg=${result.msg}` +
        ` (will try user materials / content store)`,
    );
    return {};
  }
  return _py_or(result.data, {});
}

export function submit_detection(request_body: Record<string, any>): Record<string, any> {
  return get_platform().submit_detection(request_body);
}

export function get_task_status(task_id: number): Record<string, any> {
  return get_platform().get_task_status(task_id);
}

export function get_pending_processes(batch_id: number): Record<string, any> {
  return get_platform().get_pending_processes(batch_id);
}

export function seed_pending_processes(batch_id: number, items: Record<string, any>[]): Record<string, any> {
  return get_platform().seed_pending_processes(batch_id, items);
}

export function check_detection_coverage(batch_id: number): Record<string, any> {
  return get_platform().check_detection_coverage(batch_id);
}

// ──────────────────── Write-back and updates ────────────────────

/**
 * Copy the depth fields that only exist on the plan into the request body.
 * Hard rules 21 (minDetectLevel) and 22 (contextReads) read `_minDetectLevel`,
 * `_mode` and `_contextReadsCount` off the request, so without this they stay
 * inert unless the agent volunteers them. An explicit value always wins.
 */
export function inject_plan_depth_fields(request_body: Record<string, any>): Record<string, any> {
  const task_id = _py_or(request_body.taskId, 0);
  const class_name = _py_or(request_body.className, "");
  const method_name = _py_or(request_body.methodName, "");
  const strategy_code = request_body.strategyCode;
  if (!py_bool(task_id) || !py_bool(class_name) || !py_bool(method_name) || !py_bool(strategy_code)) {
    return request_body;
  }

  let store: ContentStore;
  let plan_item: Record<string, any> | null;
  try {
    store = new ContentStore(task_id);
    plan_item = store.get_plan_item(class_name, method_name, strategy_code);
  } catch {
    return request_body;
  }
  if (!plan_item) return request_body;

  const body = { ...request_body };
  if (!py_bool(body.detectTier) && py_bool(plan_item.detectTier)) body.detectTier = plan_item.detectTier;
  if (body._minDetectLevel === undefined && py_bool(plan_item.minDetectLevel)) {
    body._minDetectLevel = plan_item.minDetectLevel;
  }
  if (body._mode === undefined && py_bool(plan_item.mode)) body._mode = plan_item.mode;
  if (body._contextReadsCount === undefined) {
    body._contextReadsCount = store.get_context_reads_count_for_class(class_name);
  }
  return body;
}

export function update_process(request_body: Record<string, any>): Record<string, any> {
  const raw_method = request_body.methodName;
  if (py_bool(raw_method) && String(raw_method).includes("(")) {
    request_body = { ...request_body };
    request_body.methodName = raw_method.slice(0, String(raw_method).indexOf("("));
  }

  if (!py_bool(request_body.parentBatchId)) {
    const task_id = _py_or(request_body.taskId, 0);
    const class_name = _py_or(request_body.className, "");
    const method_name = _py_or(request_body.methodName, "");
    const strategy_code = request_body.strategyCode;

    if (py_bool(class_name)) {
      request_body = auto_fill_ids(task_id, class_name, method_name, strategy_code, request_body);
      const filled = request_body.parentBatchId;
      if (py_bool(filled)) {
        console.error(`[update-process] 🔧 Auto-injected parentBatchId=${filled} (from pending_cache)`);
      }
    }
  }

  if (get_valid_tag_ids() === null) {
    console.error("[update-process] ℹ️  tagId cache not loaded; calling get_tag_list() automatically...");
    get_tag_list();
  }

  const fix_result = pre_validate_and_fix(request_body);
  if (py_bool(fix_result.fixed)) {
    request_body = fix_result.request_body;
    for (const _fix of fix_result.fixes || []) {
      console.error(`[update-process] 🔧 Auto pre-fix: ${_fix}`);
    }
  }

  request_body = inject_plan_depth_fields(request_body);

  const validation_error = validate_update_process(request_body, request_body.taskId);
  if (py_bool(validation_error)) {
    console.error(`[update-process] ❌ Validation failed (pre-fix cannot handle this; re-analyze): ${validation_error}`);
    return { code: -1, msg: `validation_failed: ${validation_error}`, data: null };
  }

  const dedup_key = [
    request_body.parentBatchId,
    request_body.className,
    _py_or(request_body.methodName, ""),
    request_body.strategyCode,
  ];
  if (is_already_written(dedup_key)) {
    console.error(`[update-process] ⚡ Skipped duplicate write-back: ${dedup_key}`);
    return { code: 0, msg: "skipped(duplicate)", data: { skipped: true } };
  }

  const result = get_platform().update_process(request_body);
  if (result.code === 0) {
    mark_written(dedup_key);
    try {
      mark_method_done(
        _py_or(request_body.taskId, 0),
        _py_or(request_body.parentBatchId, 0),
        _py_or(request_body.className, ""),
        _py_or(request_body.methodName, ""),
        _py_or(request_body.strategyCode, 0),
        _py_or(request_body.bugStatus, 0),
      );
    } catch (_e) {
      console.error(`[update-process] ⚠️  Failed to write local progress (does not affect write-back): ${_e}`);
    }
  }
  return result;
}

export function batch_dismiss_by_strategy(parent_batch_id: number, strategy_code = 8): Record<string, any> {
  const result = get_platform().batch_dismiss_by_strategy(parent_batch_id, strategy_code);
  if (result.code === 0) {
    const affected = _py_get(_py_get(result, "data", {}), "affected", 0);
    console.error(`[batch-dismiss] ✅ Batch dismiss as no-defect done, affected=${affected}`);
  } else {
    console.error(`[batch-dismiss] ❌ Failed: ${_py_or(result.msg, "")}`);
  }
  return result;
}

export function batch_dismiss_by_class_names(task_id: number, class_names: string[]): Record<string, any> {
  const result = get_platform().batch_dismiss_by_class_names(task_id, class_names);
  if (result.code === 0) {
    const affected = _py_get(_py_get(result, "data", {}), "affected", 0);
    console.error(`[batch-dismiss-class] ✅ Batch dismiss as no-defect done, taskId=${task_id}, affected=${affected}`);
  } else {
    console.error(`[batch-dismiss-class] ❌ Failed: ${_py_or(result.msg, "")}`);
  }
  return result;
}

export function batch_update_process(
  items: Record<string, any>[],
  max_workers = 5,
  code_read_verified = false,
): Record<string, any> {
  const all_ast_only = items.every((item) => item.strategyCode === 8);
  const hollow_check = validate_batch_hollow_check(items, all_ast_only || code_read_verified);
  if (py_bool(hollow_check.blocked)) {
    const warnings = hollow_check.warnings || [];
    console.error(`[batch-update] 🚫 Batch hollow-check blocked; refused to submit ${items.length} item(s)`);
    for (const w of warnings) {
      console.error(`[batch-update] ⚠️  ${w}`);
    }
    return {
      code: -2,
      msg:
        "batch_hollow_check_blocked: batch submit was blocked by the hollow check." +
        "Detected templated thinking or an abnormally high no-defect ratio, " +
        "The agent must read each method and analyze it independently before write-back.",
      hollowCheck: hollow_check,
      summary: {
        total: items.length,
        success: 0,
        failed: items.length,
        skipped: 0,
        blockedReason: "hollow_check",
      },
    };
  }

  if (py_bool(hollow_check.warnings)) {
    for (const w of hollow_check.warnings) {
      console.error(`[batch-update] ⚠️  ${w}`);
    }
  }

  const results: Array<Record<string, any> | null> = new Array(items.length).fill(null);
  const failed_indices: number[] = [];

  function _submit_one(idx: number, item: Record<string, any>): [number, Record<string, any>] {
    return [idx, update_process(item)];
  }

  const _effective_workers = Math.min(max_workers, items.length || 1);
  for (let idx = 0; idx < items.length; idx++) {
    const [, res] = _submit_one(idx, items[idx]);
    results[idx] = { index: idx, ...res };
    if (res.code !== 0 && !py_bool((_py_or(res.data, {}) as any).skipped)) {
      const error_msg = _py_or(res.msg, "");
      if (!String(error_msg).includes("validation_failed") && !String(error_msg).includes("hollow_check")) {
        failed_indices.push(idx);
      }
    }
  }

  if (py_bool(failed_indices)) {
    _sleep_s(0.5);
    console.error(`[batch-update] 🔄 Retrying ${failed_indices.length} failed item(s)...`);
    for (const idx of failed_indices) {
      const [, res] = _submit_one(idx, items[idx]);
      results[idx] = { index: idx, ...res };
    }
  }

  let success_count = 0;
  let fail_count = 0;
  let skip_count = 0;
  for (const entry of results) {
    if (entry == null) {
      fail_count += 1;
      continue;
    }
    if (entry.code === 0) {
      if (py_bool(_py_get(_py_get(entry, "data", {}), "skipped"))) {
        skip_count += 1;
      } else {
        success_count += 1;
      }
    } else {
      fail_count += 1;
    }
  }

  return {
    code: 0,
    results,
    summary: {
      total: items.length,
      success: success_count,
      failed: fail_count,
      skipped: skip_count,
    },
  };
}

// ──────────────────── Rank management ────────────────────

export function check_rank_integrity(batch_id: number): Record<string, any> {
  return get_platform().check_rank_integrity(batch_id);
}

export function finalize_rank(
  batch_id = 0,
  class_name = "",
  method_name = "",
  bug_status = 0,
  content = "",
  process_ids: string | null = null,
  git: string | null = null,
  task_id = 0,
  git_file_path: string | null = null,
): Record<string, any> {
  if (!py_bool(batch_id) && py_bool(_py_or(task_id, 0)) && py_bool(class_name)) {
    const ids = lookup_pending_ids(task_id, class_name, _py_or(method_name, null), null);
    if (ids != null) {
      batch_id = _py_or(ids.batchId, batch_id);
      if (py_bool(batch_id)) {
        console.error(`[finalize-rank] 🔧 Auto-injected batchId=${batch_id} (from pending_cache)`);
      }
    } else {
      console.error(
        `[finalize-rank] ⚠️  pending_cache miss for ${class_name}#${_py_or(method_name, "")}，` +
          `Pass --batch-id explicitly`,
      );
    }
  }

  if (!py_bool(batch_id)) {
    console.error("[finalize-rank] ⚠️  batchId is still empty (pending_cache miss); the request will be invalid");
  }

  const body: Record<string, any> = {
    parentBatchId: batch_id,
    git: _py_or(git, ""),
    className: class_name,
    methodName: _py_or(method_name, ""),
    bugStatus: bug_status,
    content,
  };
  if (py_bool(git_file_path)) body.gitFilePath = git_file_path;
  if (py_bool(process_ids)) body.processIds = process_ids;
  if (py_bool(task_id)) body.taskId = task_id;
  return get_platform().finalize_rank(body);
}

export function update_rank_content(rank_id: number, content: string): Record<string, any> {
  return get_platform().update_rank_content(rank_id, content);
}

// ──────────────────── Task complete and retry ────────────────────

const _SUMMARY_FORBIDDEN_RULES: Array<[string, string, string]> = [
  [
    "(?<![A-Za-z0-9])s(8|11)(?![A-Za-z0-9])",
    "internal strategy code",
    "Describe analysis dimensions in business language, e.g. 'method logic, call chain, business scenarios, rule scan'",
  ],
  ["strategyCode", "internal field name strategyCode", "Remove it and describe the analysis dimension in business terms"],
  ["bugStatus", "internal field name bugStatus", "Use business wording such as 'Suspected defect / Improvement / no defect'"],
  [
    "(?<![A-Za-z0-9])(parentBatchId|batchId|taskId|testPlanId|processId|rankId)(?![A-Za-z0-9])",
    "internal interaction ID field name",
    "Remove it; the summary must not expose IDs used with the backend",
  ],
  [
    "(?<![A-Za-z0-9])batch(?:es)?(?![A-Za-z0-9])",
    "internal batch term batch",
    "Use business wording such as 'service / module' and drop the internal batch number",
  ],
  ["(?<![A-Za-z0-9])ast(?![A-Za-z0-9])", "internal technical term AST (abstract syntax tree / static scan)", "Use business wording such as 'static rule scan / rule check'"],
  [
    "(?<![\\u4e00-\\u9fa5A-Za-z0-9])process(?![A-Za-z0-9])",
    "internal execution-unit term process",
    "Use business wording such as 'detection item / analysis item' or omit the count",
  ],
  ["(?<![\\u4e00-\\u9fa5A-Za-z0-9])rank(?![A-Za-z0-9])", "internal execution-unit term rank", "Use business wording such as 'defect conclusion' or omit it"],
  ["\\bdetection platform\\b", "underlying system name detection platform", "Use 'historically confirmed defect records' or omit the system name"],
  ["\\bSemgrep\\b", "underlying tool name Semgrep", "Use 'static rule scan'"],
  ["Coverage\\s*\\d+\\s*/\\s*\\d+", "internal metric 'Coverage x/x'", "Use a business conclusion such as 'all changed methods were covered' and do not expose internal counts"],
  ["zero hits", "internal metric 'zero hits'", "Use business wording such as 'no rule alerts found'"],
];

const _REPORT_LINK_PATTERN = /(?:local:\/\/[^\s)）]+|file:\/\/[^\s)）]+|https?:\/\/[^\s)）]+)/gi;

export function check_summary_forbidden(text: string): Record<string, any>[] {
  if (!py_bool(text)) return [];
  const scan_text = String(text).replace(new RegExp(_REPORT_LINK_PATTERN.source, "gi"), " ");
  const issues: Record<string, any>[] = [];
  const seen = new Set<string>();
  for (const [pattern, reason, suggestion] of _SUMMARY_FORBIDDEN_RULES) {
    for (const m of _finditer(pattern, scan_text)) {
      const token = m[0];
      const key = `${reason}\0${token.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ matched: token, reason, suggestion });
    }
  }
  return issues;
}

export function normalize_summary_for_plaintext(text: string): string {
  if (!py_bool(text)) return text;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = text.split("\n").filter((ln) => !/^\s*```/.test(ln));

  const stripped: string[] = [];
  for (const raw of lines) {
    let ln = raw.trim();
    ln = ln.replace(/^#{1,6}\s+/, "");
    ln = ln.replace(/^>\s?/, "");
    ln = ln.replace(/^(?:[-*+]|\d+\.)\s+/, "");
    stripped.push(ln);
  }

  text = stripped.join("\n");
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/__(.+?)__/g, "$1");
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  // Underscore italics only when the markers sit on word boundaries and the span
  // itself has no underscore; otherwise identifiers like `_check_token`,
  // `account_id` or `snake_case_name` lose their underscores.
  text = text.replace(/(?<![A-Za-z0-9_])_(?!_)([^_\n]+?)_(?![A-Za-z0-9_])/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");

  text = text.replace(/\n+/g, " ");
  text = text.replace(/[ \t]{2,}/g, " ");

  text = text.replace(/\s*((?:📋|🔍|⚠️|📌|✅)\[)/g, "    $1");
  text = text.replace(/\s*(▸\(\d+\))/g, "    $1");
  text = text.replace(/\s*(►)/g, "    $1");

  return text.trim();
}

export function update_detection_summary(task_id: number, detection_summary: string): Record<string, any> {
  detection_summary = normalize_summary_for_plaintext(detection_summary);
  const forbidden = check_summary_forbidden(detection_summary);
  if (py_bool(forbidden)) {
    const lines = [
      "Detection summary contains forbidden internal information; upload rejected. The summary should only include business information users/developers understand, ",
      "Do not include internal strategy codes, underlying system names, internal metrics, or IDs/field names used with the backend.",
      "Rewrite in business language and upload again. Violations:",
    ];
    for (const it of forbidden) {
      lines.push(`  - "${it.matched}" — ${it.reason}; suggestion: ${it.suggestion}`);
    }
    return { _error: lines.join("\n") };
  }

  const _REQUIRED_SECTIONS: Array<[string, string]> = [
    ["📋[Requirement changes]", "Requirement changes"],
    ["🔍[Analysis scope]", "Analysis scope"],
    ["⚠️[Risks]", "Risks"],
    ["📌[Notes]", "Notes"],
    ["✅[Conclusion]", "Conclusion"],
  ];
  const missing_sections = _REQUIRED_SECTIONS.filter(([marker]) => !detection_summary.includes(marker)).map(
    ([, name]) => name,
  );
  if (py_bool(missing_sections)) {
    const example =
      "📋[Requirement changes]<what changed, which classes/methods>    " +
      "🔍[Analysis scope]<covered N services/classes/methods, key chains>    " +
      "⚠️[Risks]<list each item: location + risk description + Impact scope + severity ❗⚡💡>    " +
      "📌[Notes]<test advice + release notes + compatibility + monitoring>    " +
      "✅[Conclusion]<release advice based on Risks>";
    return {
      _error:
        `Detection summary is missing required section markers; upload rejected. Missing: ${missing_sections.join(", ")}.\n` +
        `The detection summary must use a flat plain-text layout with emoji+[Title] section headings, separated by 4 spaces.\n` +
        `⚠️[Risks] and 📌[Notes] are the most important sections; write concrete content, no vague wording.\n` +
        `Correct format example:\n${example}\n` +
        `Rewrite --summary in this format and call complete-task or update-summary again.`,
    };
  }

  console.error(`[→ summary] taskId=${task_id} (summaryLength=${detection_summary.length})`);
  return get_platform().update_detection_summary(task_id, detection_summary);
}

export function complete_task(
  task_id: number,
  failed = false,
  fail_msg: string | null = null,
  detection_summary: string | null = null,
): Record<string, any> {
  let summary_error: string | null = null;
  if (py_bool(detection_summary)) {
    const summary_result = update_detection_summary(task_id, detection_summary as string);
    if ("_error" in summary_result) {
      summary_error = summary_result._error;
      console.error(
        `[complete_task] ⚠️ Detection summary upload failed (does not block finalize; fix with update-summary and retry): ` +
          `${summary_error}`,
      );
    } else {
      console.error(`[complete_task] ✅ Detection summary uploaded (${(detection_summary as string).length} chars)`);
    }
  }

  const result = get_platform().complete_task(task_id, failed, fail_msg);

  if (py_bool(summary_error)) {
    result._summary_status = "FAILED";
    result._summary_hint =
      `Detection summary upload failed: ${summary_error}.` +
      "Re-upload with `defect-detection update-summary --task-id <taskId> --summary <correctly formatted summary>`.";
  } else if (py_bool(detection_summary)) {
    result._summary_status = "OK";
  }
  return result;
}

export function skip_service_batch(
  parent_batch_id: number,
  failed = false,
  reason: string | null = null,
): Record<string, any> {
  return get_platform().skip_service_batch(parent_batch_id, failed, reason);
}

export function force_abort_task(task_id: number, reason: string | null = null): Record<string, any> {
  return get_platform().force_abort_task(task_id, reason);
}

export function retry_detection(task_id: number, submit_user: string | null = null): Record<string, any> {
  return get_platform().retry_detection(task_id, submit_user);
}

// ──────────────────── Rules and reports ────────────────────

export function get_ast_and_custom_rules(git: string | null = null, user_id: string | null = null): Record<string, any> {
  user_id = user_id;
  if (!py_bool(user_id)) {
    user_id = extract_user_id();
  }
  return get_platform().get_rules(git, user_id);
}

export function list_my_tasks(submit_user: string, limit = 20): Record<string, any> {
  return get_platform().list_my_tasks(submit_user, limit);
}

export function get_report_by_task_id(task_id: number): Record<string, any> {
  return get_platform().get_report(task_id);
}

// ──────────────────── Defect history and confirmation ────────────────────

export function get_confirmed_defect_history(
  git: string,
  class_name: string | null = null,
  git_file_path: string | null = null,
  method_name: string | null = null,
  start_time: number | null = null,
  end_time: number | null = null,
  fix_status: string | null = null,
): Record<string, any> {
  const params: Record<string, any> = { git };
  if (py_bool(class_name)) params.className = class_name;
  if (py_bool(git_file_path)) params.gitFilePath = git_file_path;
  if (py_bool(method_name)) params.methodName = method_name;
  if (start_time != null) params.startTime = start_time;
  if (end_time != null) params.endTime = end_time;
  if (fix_status != null) params.fixStatus = fix_status;
  return get_platform().get_confirmed_defect_history(params);
}

export function get_defect_history_by_commit(
  git: string,
  dev_commit: string,
  class_name: string | null = null,
  method_name: string | null = null,
  start_time: number | null = null,
  end_time: number | null = null,
): Record<string, any> {
  const params: Record<string, any> = { git, devCommit: dev_commit };
  if (py_bool(class_name)) params.className = class_name;
  if (py_bool(method_name)) params.methodName = method_name;
  if (start_time != null) params.startTime = start_time;
  if (end_time != null) params.endTime = end_time;
  return get_platform().get_defect_history_by_commit(params);
}

export function get_plan_defects(
  plan_id: number,
  plan_type: number,
  page_no = 1,
  page_size = 100,
): Record<string, any> {
  return get_plan().list_submitted_defects(plan_id, plan_type, page_no, page_size);
}

export function get_delivery_defects(
  plan_id: number,
  plan_type: number,
  page_no = 1,
  page_size = 100,
): Record<string, any> {
  return get_plan_defects(plan_id, plan_type, page_no, page_size);
}

export function create_issue(
  plan_id: number | null,
  title: string,
  description: string,
  discovery_tool = "AI defect detection",
  assigned_to: string | null = null,
  cc_list: any[] | null = null,
  severity: number | null = null,
  develop_branch: string | null = null,
  deploy_branch: string | null = null,
  commit_id: string | null = null,
  service_key: string | null = null,
  operator: string | null = null,
  record_url: string | null = null,
  bug_id: number | null = null,
  legacy: Record<string, any> = {},
): Record<string, any> {
  const body: Record<string, any> = {
    planId: _py_or(plan_id, legacy.test_apply_id),
    title,
    description,
    discoveryTool: discovery_tool,
    assignedTo: assigned_to,
    ccList: cc_list,
    severity,
    developBranch: develop_branch,
    deployBranch: deploy_branch,
    commitId: commit_id,
    serviceKey: _py_or(service_key, legacy.service_key),
    operator,
    recordUrl: record_url,
    bugId: bug_id,
  };
  return get_issues().create_issue(body);
}

export function get_exception_traces(
  plan_id: number | null = null,
  plan_type = 2,
  service_key: string | null = null,
  _kwargs: Record<string, any> = {},
): Record<string, any> {
  return get_traces().list_traces(
    _py_or(plan_id, _kwargs.plan_id, 0),
    plan_type,
    _py_or(service_key, _kwargs.service_key),
  );
}

// ──────────────────── finalize-all aggregation ────────────────────

export function preflight_complete_check(batch_ids: number[]): Record<string, any> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const details: Record<string, any> = {};

  for (const bid of batch_ids) {
    const cov = check_detection_coverage(bid);
    const cov_data = _is_dict(cov) ? ("data" in cov ? cov.data : cov) : {};
    const rank = check_rank_integrity(bid);
    const rank_data = _is_dict(rank) ? ("data" in rank ? rank.data : rank) : {};
    details[String(bid)] = { coverage: cov_data, rankIntegrity: rank_data };

    if ("_error" in cov || !_in(cov.code, 0, null, undefined)) {
      blockers.push(`batch ${bid}: completeness-check API failed; cannot confirm write-back is complete`);
      continue;
    }
    if ("_error" in rank || !_in(rank.code, 0, null, undefined)) {
      blockers.push(`batch ${bid}: consistency-check API failed; cannot confirm ranks are complete`);
      continue;
    }

    const missed = _py_or(cov_data.missedItems, []);
    if (cov_data.allCompleted === false || py_bool(missed)) {
      blockers.push(
        `batch ${bid}: still has ${missed.length || _py_get(cov_data, "totalCount", 0) - _py_get(cov_data, "completedCount", 0)} ` +
          ` method conclusion(s) not fully written back`,
      );
    }

    const missing_proc = _py_or(rank_data.missingProcessItems, []);
    if (py_bool(missing_proc)) {
      blockers.push(`batch ${bid}: ${missing_proc.length} detection process(es) not written back`);
    }

    const missing_rank = _py_or(rank_data.missingRankItems, []);
    if (py_bool(missing_rank)) {
      blockers.push(`batch ${bid}: ${missing_rank.length} defect conclusion(s) not written to the report`);
    }

    if (rank_data.allConsistent === false && !py_bool(missing_proc) && !py_bool(missing_rank)) {
      blockers.push(`batch ${bid}: the report is inconsistent with detection conclusions`);
    }

    // Local provider historically reported `total`; remote reports `totalCount`. Accept both.
    const cov_total = _py_get(cov_data, "totalCount", _py_get(cov_data, "total", 0));
    if (
      cov_total == 0 &&
      _py_get(rank_data, "totalClassCount", 0) == 0 &&
      _py_get(rank_data, "rankExistsCount", 0) == 0
    ) {
      warnings.push(
        `batch ${bid}: no detection/write-back data found (wrong batch-id or empty batch), ` +
          `Confirm whether a batch that should be finalized was omitted`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers, warnings, details };
}

function _norm_key(class_name: any, method_name: any): [string, string] {
  let c = String(class_name || "").trim();
  c = c.split("/").pop() as string;
  if (c.includes(".")) {
    const parts = c.split(".");
    const last = parts[parts.length - 1];
    const known = new Set([
      "xml",
      "json",
      "yaml",
      "yml",
      "properties",
      "kt",
      "java",
      "ts",
      "js",
      "tsx",
      "jsx",
      "vue",
      "py",
    ]);
    if (known.has(last.toLowerCase())) {
      c = parts.slice(0, -1).join(".");
    } else {
      c = last;
    }
  }
  const m = String(method_name || "").trim();
  return [c, m];
}

export function reconcile_report(task_id: number): Record<string, any> {
  const blockers: string[] = [];

  const report = get_report_by_task_id(task_id);
  if ("_error" in report || !_in(report.code, 0, null, undefined)) {
    return {
      ok: false,
      blockers: ["Cannot fetch the detection report; temporarily unable to reconcile report vs actual results"],
      localDefectCount: 0,
      reportDefectCount: 0,
      missingInReport: [],
      extraInReport: [],
      matched: 0,
    };
  }
  const rdata = _py_or(report.data, {});

  const own_batches = new Set<string>();
  for (let b of String(_py_or(rdata.batchIds, "")).split(",")) {
    b = b.trim();
    if (py_bool(b)) own_batches.add(b);
  }

  const report_defects: Record<string, any> = {};
  for (const job of rdata.jobDetectionVos || []) {
    const job_bid = String(_py_or(job.batchId, job.jobId, "")).trim();
    if (py_bool(own_batches) && !own_batches.has(job_bid)) continue;
    for (const r of job.defectRankResults || []) {
      if (_in(r.valid, 0, "0", false)) continue;
      if (!_in(rk_bs(r), 3, 6, 7, 8)) continue;
      const rk_bid = String(_py_or(r.batchId, "")).trim();
      const k = _norm_key_str(_norm_key(r.className, r.methodName));
      report_defects[k] = {
        className: r.className,
        methodName: r.methodName,
        rankBatchId: _py_or(rk_bid, job_bid),
      };
    }
  }

  const local_defects: Record<string, any> = {};
  let wb: Record<string, any> = {};
  try {
    const store = new ContentStore(task_id);
    wb = store.load_writebacks_only();
    // A rank carrying a user verdict is authoritative for its method: 4 (invalid) / 8
    // (duplicate) close the defect even though the process write-back still says 6/7.
    const closed_by_user = new Set<string>();
    for (const rk of wb.ranks || []) {
      const k = _norm_key_str(_norm_key(rk.className, rk.methodName));
      if (_in(rk_bs(rk), 4, 8)) closed_by_user.add(k);
      if (_in(rk_bs(rk), 3, 5, 6, 7)) {
        local_defects[k] = { className: rk.className, methodName: rk.methodName };
      }
    }
    for (const p of wb.processWritebacks || []) {
      if (_in(rk_bs(p), 3, 5, 6, 7)) {
        const k = _norm_key_str(_norm_key(p.className, p.methodName));
        if (!(k in local_defects) && !closed_by_user.has(k)) {
          local_defects[k] = { className: p.className, methodName: p.methodName };
        }
      }
    }
  } catch (e) {
    return {
      ok: false,
      blockers: [`Cannot read local analysis results; temporarily unable to reconcile (${e})`],
      localDefectCount: 0,
      reportDefectCount: Object.keys(report_defects).length,
      missingInReport: [],
      extraInReport: [],
      matched: 0,
    };
  }

  const process_defect_keys: Record<string, any> = {};
  const rank_defect_keys: Record<string, any> = {};
  for (const p of wb.processWritebacks || []) {
    if (_in(rk_bs(p), 6, 7)) {
      const k = _norm_key_str(_norm_key(p.className, p.methodName));
      process_defect_keys[k] = { className: p.className, methodName: p.methodName };
    }
  }
  for (const rk of wb.ranks || []) {
    // A rank exists for the method whether it still says 6/7 or carries a user verdict (3/4/5/8).
    if (_in(rk_bs(rk), 3, 4, 5, 6, 7, 8)) {
      const k = _norm_key_str(_norm_key(rk.className, rk.methodName));
      rank_defect_keys[k] = { className: rk.className, methodName: rk.methodName };
    }
  }

  const missing_ranks = _sorted_keys(
    Object.keys(process_defect_keys).filter((k) => !(k in rank_defect_keys)),
  );
  const missing_ranks_list: string[] = [];
  for (const k of missing_ranks) {
    const info = process_defect_keys[k] || {};
    const tuple = k.split("\0");
    missing_ranks_list.push(`${_py_or(info.className, tuple[0])}#${_py_or(info.methodName, tuple[1])}`);
  }
  if (py_bool(missing_ranks_list)) {
    blockers.push(
      `process was judged a defect but no rank was written (missing finalize-rank at ${missing_ranks_list.length} place(s)): ` +
        missing_ranks_list.join(", "),
    );
  }

  if (py_bool(report_defects) && !py_bool(rank_defect_keys)) {
    blockers.unshift(
      `⛔ Local store has no rank records but the report has ${Object.keys(report_defects).length} defect(s)` +
        " — suspected that the record-rank step was skipped entirely." +
        "For each already finalized-rank defect, also run record-rank --task-id <ID> --rank-json '...' to persist locally, " +
        "or pass --task-id to finalize-rank for automatic persistence.",
    );
  }

  const local_keys = new Set(Object.keys(local_defects));
  const report_keys = new Set(Object.keys(report_defects));

  const missing_in_report = _sorted_keys([...local_keys].filter((k) => !report_keys.has(k)));
  const extra_in_report = _sorted_keys([...report_keys].filter((k) => !local_keys.has(k)));
  const matched = [...local_keys].filter((k) => report_keys.has(k)).length;

  function _fmt(keyset: string[], src: Record<string, any>): string[] {
    const out: string[] = [];
    for (const k of keyset) {
      const info = src[k] || {};
      const tuple = k.split("\0");
      out.push(`${_py_or(info.className, tuple[0])}#${_py_or(info.methodName, tuple[1])}`);
    }
    return out;
  }

  const miss_list = _fmt(missing_in_report, local_defects);
  const extra_list = _fmt(extra_in_report, report_defects);

  if (py_bool(miss_list)) {
    blockers.push(`Local analysis judged a defect but the report does not show it (missed ${miss_list.length} place(s)): ` + miss_list.join(", "));
  }
  if (py_bool(extra_list)) {
    const drift_from_old_batch: Array<[string, any]> = [];
    const unknown_drift: Array<[string, any]> = [];
    for (const k of extra_in_report) {
      const info = report_defects[k] || {};
      const rk_bid = _py_get(info, "rankBatchId", "");
      if (py_bool(rk_bid) && !own_batches.has(rk_bid)) {
        drift_from_old_batch.push([k, info]);
      } else {
        unknown_drift.push([k, info]);
      }
    }

    if (py_bool(drift_from_old_batch)) {
      const drift_names = drift_from_old_batch
        .map(([k, info]) => {
          const tuple = k.split("\0");
          return `${_py_or(info.className, tuple[0])}#${_py_or(info.methodName, tuple[1])}`;
        })
        .join(", ");
      blockers.push(
        `The report contains defects from an older round (round batchId=${drift_from_old_batch[0][1].rankBatchId})` +
          ` nested under this round's job (${drift_from_old_batch.length} place(s)): ${drift_names}.` +
          "These ranks point at the same code line as a precise method name in this round; they are outer method names of the same bug." +
          "Fix: add these method-name records to writebacks.json ranks[]" +
          "(className, methodName, bugStatus=6, parentBatchId), then re-run reconcile-report." +
          "or run invalid-record to mark those old ranks invalid.",
      );
    }
    if (py_bool(unknown_drift)) {
      const unknown_names = unknown_drift
        .map(([k, info]) => {
          const tuple = k.split("\0");
          return `${_py_or(info.className, tuple[0])}#${_py_or(info.methodName, tuple[1])}`;
        })
        .join(", ");
      blockers.push(`The report has defects not backed by local analysis (suspected drift at ${unknown_drift.length} place(s)): ${unknown_names}`);
    }
  }
  if (local_keys.size !== report_keys.size) {
    blockers.push(
      `Defect counts do not match: local ${local_keys.size}, report ${report_keys.size}` +
        " (gaps from same-root-cause dedup must be explained in the summary Impact scope)",
    );
  }

  return {
    ok: blockers.length === 0,
    blockers,
    localDefectCount: local_keys.size,
    reportDefectCount: report_keys.size,
    processDefectCount: Object.keys(process_defect_keys).length,
    rankDefectCount: Object.keys(rank_defect_keys).length,
    missingRanks: missing_ranks_list,
    missingInReport: miss_list,
    extraInReport: extra_list,
    matched,
  };
}

export function rk_bs(rank: Record<string, any>): any {
  const bs = rank == null ? undefined : rank.bugStatus;
  if (typeof bs === "boolean") return bs ? 1 : 0;
  if (typeof bs === "number" && Number.isFinite(bs)) return Math.trunc(bs);
  if (bs == null) return bs;
  const s = String(bs).trim();
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  return bs;
}

function _humanize_inherited_feedback_result(result: string | null | undefined): string {
  return (
    {
      USER_REJECTED: "User rejected the issue",
      USER_CONFIRMED_VALID: "User confirmed the issue is valid",
      USER_CONFIRMED_LATER_FIX: "User confirmed Later",
      USER_CONFIRMED_DUPLICATE: "User confirmed the issue is a duplicate",
      RULE_DEVIATION: "User believes the rule judgment is off",
    }[result as string] || "User confirmed the historical conclusion"
  );
}

function _merge_rank_contents(defect_processes: Record<string, any>[]): string {
  const contents: string[] = [];
  const inherited_feedbacks: string[] = [];
  const seen_feedbacks = new Set<string>();

  for (const process of defect_processes) {
    const content = process.content;
    if (!py_bool(content)) continue;
    contents.push(content);
    let content_json: any;
    try {
      content_json = JSON.parse(content);
    } catch {
      continue;
    }

    const feedback = content_json.inheritedFeedback;
    if (!_is_dict(feedback)) continue;
    const feedback_key = String(_py_or(feedback.rankId, _json_dumps_py(feedback)));
    if (seen_feedbacks.has(feedback_key)) continue;
    seen_feedbacks.add(feedback_key);

    inherited_feedbacks.push(
      `Historical agent conclusion: ${_py_or(feedback.agentConclusion, "no historical conclusion")}\n` +
        `Historical human confirmation: ${_humanize_inherited_feedback_result(feedback.result)}; reason: ${_py_or(feedback.reason, "no note")}`,
    );
  }

  let merged_content = py_bool(contents) ? contents.join(" | ") : "See each strategy's detection conclusions for defect details";
  if (py_bool(inherited_feedbacks)) {
    merged_content += "\n\n[Historical conclusions and human feedback]\n" + inherited_feedbacks.join("\n");
  }
  return merged_content;
}

/**
 * Local plan coverage. The platform's check-coverage only knows processes that were
 * written back; for git-branch tasks the detection plan lives in data/{taskId}/plan.json,
 * so a task with zero write-backs would otherwise "complete" cleanly.
 */
export function local_plan_gaps(task_id: number): { total: number; gaps: Record<string, any>[]; blockers: string[] } {
  try {
    const store = new ContentStore(task_id);
    const total = (store.load_plan_only().detectionPlan || []).length;
    const gaps = store.get_plan_gaps();
    const blockers = gaps.length
      ? [
          `${gaps.length}/${total} detection-plan method(s) have no write-back: ` +
            gaps.slice(0, 12).map((g) => `${g.className.split("/").pop()}#${g.methodName}${g.trivial ? " (trivial)" : ""}`).join(", ") +
            (gaps.length > 12 ? ", …" : "") +
            ". Analyze and batch-update-process them (trivial ones: trivial-method-filter --submit).",
        ]
      : [];
    return { total, gaps, blockers };
  } catch {
    return { total: 0, gaps: [], blockers: [] };
  }
}

export function finalize_all(
  task_id: number,
  batch_ids: number[],
  detection_summary: string | null = null,
): Record<string, any> {
  const plan_cov = local_plan_gaps(task_id);
  if (plan_cov.blockers.length) {
    return {
      code: 1,
      msg: "plan_coverage_incomplete",
      data: {
        blocked: true,
        blockers: plan_cov.blockers,
        planTotal: plan_cov.total,
        planGaps: plan_cov.gaps,
        completeTask: null,
      },
    };
  }

  const all_coverage: Record<string, any>[] = [];
  const all_rank_issues: Record<string, any>[] = [];
  const finalize_results: Record<string, any>[] = [];

  for (const bid of batch_ids) {
    const cov = check_detection_coverage(bid);
    const cov_data = _py_get(cov, "data", cov);
    all_coverage.push({ batchId: bid, ...cov_data });

    const rank_check = check_rank_integrity(bid);
    const rank_data = _py_get(rank_check, "data", rank_check);
    all_rank_issues.push({ batchId: bid, ...rank_data });

    const batch_git = get_batch_git(bid, task_id);

    const missing = _py_get(rank_data, "missingRankItems", []);
    for (const item of missing || []) {
      const class_path = _py_or(_py_get(item, "classPath", ""), _py_get(item, "className", ""));
      const method_name = _py_get(item, "methodName", "");
      if (!py_bool(class_path)) {
        console.error(`[finalize-all] ⚠️  skip rank for ${method_name}: provider returned no classPath/className`);
        continue;
      }
      const agg_status = _py_get(item, "aggregatedBugStatus", 6);
      const defect_procs = _py_get(item, "defectProcesses", []);
      const merged_content = _merge_rank_contents(defect_procs);
      const proc_ids = (defect_procs || [])
        .filter((p: any) => py_bool(p.processId))
        .map((p: any) => String(_py_get(p, "processId", "")))
        .join(",");

      const fr_result = finalize_rank(bid, class_path, method_name, agg_status, merged_content, proc_ids, batch_git);

      if (fr_result.code === 0 && py_bool(task_id)) {
        try {
          let rank_id: any = null;
          const fr_data = fr_result.data;
          if (_is_dict(fr_data)) {
            rank_id = fr_data.aggregatedRankId || fr_data.rankId || fr_data.id;
          }
          const store = new ContentStore(task_id);
          const rank_record: Record<string, any> = {
            className: class_path,
            methodName: method_name,
            bugStatus: agg_status,
            parentBatchId: bid,
            writeMethod: "finalize-all",
          };
          if (py_bool(rank_id)) rank_record.rankId = rank_id;
          store.record_rank(rank_record);
          store.save();
          console.error(`[finalize-all] ✅ Auto record-rank persisted: ${class_path}#${method_name}`);
        } catch (e) {
          console.error(`[finalize-all] ⚠️  Auto record-rank failed (does not affect finalize): ${e}`);
        }
      }

      finalize_results.push({
        batchId: bid,
        className: class_path,
        methodName: method_name,
        result: fr_result,
      });
    }
  }

  const report_validation = _validate_report_content_for_task(task_id);

  const preflight = preflight_complete_check(batch_ids);

  if (!preflight.ok) {
    return {
      code: 1,
      msg: "consistency_preflight_failed",
      data: {
        blocked: true,
        blockers: preflight.blockers,
        coverage: all_coverage,
        rankIntegrity: all_rank_issues,
        finalizeResults: finalize_results,
        reportValidation: report_validation,
        preflight,
        completeTask: null,
        summary: {
          batchCount: batch_ids.length,
          totalFinalized: finalize_results.length,
          reportChecked: _py_get(report_validation, "checked", false),
          contentIssues: _py_get(report_validation, "issueCount", 0),
          taskCompleted: false,
          preflightPassed: false,
        },
      },
    };
  }

  const complete_result = complete_task(task_id, false, null, detection_summary);

  return {
    code: 0,
    data: {
      coverage: all_coverage,
      rankIntegrity: all_rank_issues,
      finalizeResults: finalize_results,
      reportValidation: report_validation,
      preflight,
      completeTask: complete_result,
      summary: {
        batchCount: batch_ids.length,
        totalFinalized: finalize_results.length,
        reportChecked: _py_get(report_validation, "checked", false),
        contentIssues: _py_get(report_validation, "issueCount", 0),
        taskCompleted: complete_result.code === 0,
        preflightPassed: true,
      },
    },
  };
}

function _validate_report_content_for_task(task_id: number): Record<string, any> {
  const result = get_report_by_task_id(task_id);
  if ("_error" in result || result.code !== 0) {
    return {
      checked: false,
      error: _py_or(result._error, result.msg, "Failed to get the report"),
      issueCount: 0,
      issues: [],
    };
  }

  const data = _py_or(result.data, {});
  const detection_results = _py_or(data.detectionResults, []);
  return validate_report_content(detection_results);
}

// ──────────────────── Tag management ────────────────────

export function get_tag_list(): any[] {
  const result = get_platform().get_tag_list();
  if ("_error" in result) {
    console.error(`[get_tag_list] ❌ ${result._error}`);
    return [];
  }
  if (result.code !== 0) {
    console.error(`[get_tag_list] ❌ API returned an error: code=${result.code}, msg=${result.msg}`);
    return [];
  }

  const tags = _py_or(result.data, []);
  if (!Array.isArray(tags)) {
    console.error("[get_tag_list] ⚠️ data is not a list; skip cache injection");
    return [];
  }

  function _collect_all_tags(tag_list: any[], ids: Set<any>, mapping: Record<string, any>): void {
    for (const t of tag_list) {
      const tid = _py_or(t.id, t.tagId);
      if (py_bool(tid)) {
        ids.add(tid);
        mapping[tid] = _py_or(t.name, t.tagName, "");
      }
      const children = t.children;
      if (py_bool(children) && Array.isArray(children)) {
        _collect_all_tags(children, ids, mapping);
      }
    }
  }

  const valid_ids = new Set<any>();
  const tag_map: Record<string, any> = {};
  _collect_all_tags(tags, valid_ids, tag_map);
  set_valid_tag_ids(valid_ids);
  set_valid_tag_map(tag_map);

  const top_level_count = tags.length;
  const total_count = valid_ids.size;
  console.error(
    `[get_tag_list] ✅ Got ${top_level_count} top-level tag(s)` +
      ` (including children: ${total_count} total), injected into the validation cache`,
  );
  return tags;
}

export function mark_bug(body: Record<string, any>): Record<string, any> {
  return get_platform().mark_bug(body);
}

export function invalid_record(rank_id: number): Record<string, any> {
  return get_platform().invalid_record(rank_id);
}

export function query_detection_records(params: Record<string, any>): Record<string, any> {
  return get_platform().query_detection_records(params);
}

export function get_detection_flow_by_process(process_id: number): Record<string, any> {
  return get_platform().get_detection_flow_by_process(process_id);
}

export function get_detection_flow_by_rank(rank_id: number): Record<string, any> {
  return get_platform().get_detection_flow_by_rank(rank_id);
}

export function report_progress(body: Record<string, any>): Record<string, any> {
  return get_platform().report_progress(body);
}
