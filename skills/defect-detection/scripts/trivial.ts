/**
 * Trivial-method pre-filter.
 *
 * Accessors, builders and generated boilerplate carry no business logic, so
 * spending an agent turn on them is waste. This module decides whether a plan
 * unit is boilerplate, stamps that verdict onto the detection plan, and can
 * submit the resulting no-defect write-backs in one batch.
 *
 * Kept out of the CLI modules because both `cli_run` (the `trivial-method-filter`
 * command) and `cli_auto` (the automated prep-and-plan flow) drive it.
 */

import { createHash } from "node:crypto";

import { NO_DEFECT_CONTENT, _require_save } from "./cli_common.ts";
import { language_from_path, trivial_conventions } from "./lang.ts";
import { batch_update_process } from "./platform.ts";
import { get_repo_clone_info, has_code_been_read, register_code_read } from "./state.ts";
import { ContentStore, matching_plan_units } from "./store.ts";


/**
 * Decide whether a plan unit is boilerplate (accessor / builder / toString …) and
 * suggest a tier from its body size. Naming conventions come from the language
 * profile (`lang.ts`), so `get_name` in Python, `GetName` in Go / C# and
 * `getName` in Java are all recognised; `method.language` (or its filePath) picks
 * the profile, defaulting to the JVM conventions for legacy callers.
 */
export function classify_trivial_method(method: Record<string, any>): Record<string, any> {
  const method_name = (method.methodName || "").trim();
  const class_name = method.className || "";
  const params = method.params || "";
  const language = method.language || (method.filePath ? language_from_path(String(method.filePath)) : null);
  const conv = trivial_conventions(language);
  let body_lines = method.bodyLineCount;
  if (typeof body_lines === "string" && /^\d+$/.test(body_lines.trim())) {
    body_lines = parseInt(body_lines.trim(), 10);
  } else if (typeof body_lines !== "number") {
    body_lines = null;
  }

  const result: Record<string, any> = {
    className: class_name,
    methodName: method_name,
    bodyLineCount: body_lines,
    params,
    trivial: false,
    trivialReason: null,
    suggestedTier: "T2",
  };
  if (language) result.language = language;

  if (!method_name) return result;

  function _mark(reason: string, tier: string): Record<string, any> {
    result.trivial = true;
    result.trivialReason = reason;
    result.suggestedTier = tier;
    return result;
  }

  // A whole-file unit is never trivial: we do not know what is inside.
  if (method.fileLevel) {
    if (body_lines != null) result.suggestedTier = body_lines <= 20 ? "T2" : "T3";
    return result;
  }

  if (body_lines != null && body_lines === 0 && !method.expressionBody) return _mark("EMPTY_METHOD", "T0");

  // Prefix must end at a camelCase / PascalCase / snake_case boundary so
  // `issueRefund` / `hashPassword` / Go `Issue` are not mistaken for getters.
  const starts_with_any = (prefixes: string[]) =>
    prefixes.some((p) => {
      if (!method_name.startsWith(p) || method_name.length <= p.length) return false;
      if (p.endsWith("_")) return true;
      const next = method_name[p.length];
      return /[A-Z0-9_$]/.test(next);
    });
  const param_count = params ? params.split(",").filter((p: string) => p.trim() && !/^(self|this|cls)$/.test(p.trim().split(/[\s:]/)[0])).length : 0;

  if (starts_with_any(conv.accessorPrefixes.filter((p) => !/^(set|Set|set_)$/.test(p)))
      && param_count <= 1
      && body_lines != null && body_lines <= conv.maxAccessorBody) {
    return _mark("GETTER", "T0");
  }

  if (starts_with_any(conv.builderPrefixes.filter((p) => /^set/i.test(p)))
      && body_lines != null && body_lines <= conv.maxAccessorBody) {
    return _mark("SETTER", "T0");
  }

  if (conv.boilerplateNames.includes(method_name)) {
    if (method_name === "equals" && params && params !== "Object") {
      // A typed equals overload is real logic, not Object#equals.
    } else if (body_lines == null || body_lines <= 8) {
      return _mark(method_name === "equals" || method_name === "__eq__" || method_name === "Equals" ? "EQUALS" : "TO_STRING", "T0");
    }
  }

  if (starts_with_any(conv.builderPrefixes.filter((p) => !/^set/i.test(p)))
      || conv.builderPrefixes.includes(method_name)) {
    if (body_lines != null && body_lines <= conv.maxAccessorBody) return _mark("BUILDER_METHOD", "T0");
  }

  if (body_lines != null && body_lines <= 2) {
    const lower = method_name.toLowerCase();
    if (["delegate", "forward", "proxy", "wrap"].some((k) => lower.includes(k))) {
      return _mark("DELEGATE", "T0");
    }
  }

  if (body_lines != null) {
    if (body_lines <= 5) result.suggestedTier = "T1";
    else if (body_lines <= 20) result.suggestedTier = "T2";
    else result.suggestedTier = "T3";
  }

  return result;
}

export function stamp_trivial_on_plan(task_id: any, results: any[]): number {
  const store = new ContentStore(task_id);
  const plan = store.load_plan_only().detectionPlan || [];
  if (!plan.length) return 0;
  let stamped = 0;
  for (const item of plan) {
    const hit = matching_plan_units(results, item)[0];
    if (!hit) continue;
    store.add_detection_plan_item({
      className: item.className,
      methodName: item.methodName,
      strategyCode: item.strategyCode,
      trivial: Boolean(hit.trivial),
      trivialReason: hit.trivialReason,
      suggestedTier: hit.suggestedTier,
      detectTier: hit.trivial ? "T3" : item.detectTier,
    });
    stamped += 1;
  }
  _require_save(store);
  return stamped;
}

export function submit_trivial_writebacks(task_id: any, results: any[]): Record<string, any> {
  const store = new ContentStore(task_id);
  const meta = store.load_meta_only();
  const plan = store.load_plan_only().detectionPlan || [];
  const svc = (meta.services || []).find((s: any) => s.gitUrl || s.git) || (meta.services || [])[0] || {};
  const default_batch = (svc.batchIds || [])[0] || 0;
  const clone = get_repo_clone_info(default_batch, svc.gitUrl || svc.git || null, task_id);
  const git = svc.gitUrl || svc.git || clone?.gitUrl || "";
  const branch = svc.branch || clone?.branch || "";
  const commit_id = svc.commitId || clone?.commitId || "";
  if (svc && (commit_id || clone?.localDir) && (!svc.commitId || !svc.localDir)) {
    try {
      if (commit_id) svc.commitId = commit_id;
      if (clone?.localDir) svc.localDir = clone.localDir;
      if (branch) svc.branch = branch;
      store.add_or_update_service(svc);
      store.save();
    } catch {
      // pass
    }
  }

  const trivial = results.filter((r: any) => r.trivial);
  const items: any[] = [];
  const skipped: any[] = [];
  const auto_registered: string[] = [];

  for (const r of trivial) {
    const cn = r.className || "";
    const mn = r.methodName || "";
    const simple = cn.includes("/") ? cn.split("/").pop()! : String(cn).split(".").pop()!;
    const plan_item = matching_plan_units(plan, r)[0];
    const process_id = plan_item?.processId ?? null;
    const batch_id = plan_item?.parentBatchId || plan_item?.batchId || default_batch;
    const file_path = plan_item?.filePath || (cn.replace(/\./g, "/") + ".java");
    const reason = r.trivialReason || "TRIVIAL";
    const seed = createHash("md5").update(`${cn}#${mn}#${reason}`, "utf8").digest("hex").slice(0, 6);

    if (batch_id && cn && !has_code_been_read(batch_id, cn, task_id)) {
      register_code_read(task_id, batch_id, cn, file_path, `[auto-registered by trivial-method-filter] ${reason}`);
      auto_registered.push(cn);
    }

    const thinking = (
      `Local pre-filter: ${simple}#${mn} is ${reason}` +
      (r.bodyLineCount != null ? ` (bodyLineCount=${r.bodyLineCount})` : "") +
      `. Accessor/generated method; no business logic. Confirmed no defect. [${seed}] ` +
      `Call chain: ${simple}#${mn}`
    );

    items.push({
      parentBatchId: batch_id,
      processId: process_id,
      className: cn,
      methodName: mn,
      bugStatus: 2,
      detectTier: "T3",
      strategyCode: plan_item?.strategyCode ?? 11,
      taskId: task_id,
      _trivialFilter: true,
      trivialReason: reason,
      fileCodes: [{
        filePath: file_path,
        methodNames: [mn],
        git,
        branch,
        commitId: commit_id,
      }],
      thinking,
      content: NO_DEFECT_CONTENT + ` Call chain: ${simple}#${mn}`,
      processSteps: [{
        step: "trivial-filter",
        stepKey: "trivial-filter",
        stepStatus: "executed",
        hasBug: false,
        conclusion: `${simple}#${mn} is ${reason}; skip deep analysis`,
        question: `Is ${simple}#${mn} a trivial accessor (${reason})?`,
        referencedSources: [{
          sourceType: "tech_doc",
          sourceId: "trivial-method-filter",
          sourceName: "Local pre-filter (getter/setter/delegate)",
        }],
      }],
    });
  }

  if (!items.length) {
    return { submitted: false, success: 0, failed: 0, skipped: skipped.length, totalItems: 0 };
  }

  const result = batch_update_process(items, 5, true);
  const summary = result.summary || {};
  const per_item = result.results || [];
  const succeeded = items.filter((_, i) => per_item[i]?.code === 0 && !per_item[i]?.data?.skipped);
  for (const it of succeeded) {
    try {
      store.record_process_writeback({
        parentBatchId: it.parentBatchId,
        className: it.className,
        methodName: it.methodName,
        strategyCode: it.strategyCode,
        bugStatus: 2,
        writeMethod: "trivial-method-filter",
      });
      store.update_plan_status(it.className, it.methodName, it.strategyCode, "written");
    } catch {
      // pass
    }
  }
  if (succeeded.length) store.save();

  const failures = per_item
    .filter((r: any) => r && r.code !== 0)
    .map((r: any) => r.msg)
    .filter(Boolean)
    .slice(0, 3);

  return {
    submitted: (summary.success || 0) > 0,
    success: summary.success || 0,
    failed: summary.failed || 0,
    skipped: summary.skipped || 0,
    totalItems: items.length,
    autoRegisteredClasses: auto_registered,
    code: result.code,
    msg: result.msg || (failures[0] || ""),
    failures,
  };
}
