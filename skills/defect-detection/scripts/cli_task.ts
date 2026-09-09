/**
 * Task lifecycle commands: submit-plan / submit-git / status / list-my-tasks / retry /
 * force-abort-task / complete-task / report-progress
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  complete_task,
  force_abort_task,
  get_task_status,
  list_my_tasks,
  local_plan_gaps,
  preflight_complete_check,
  reconcile_report,
  retry_detection,
  submit_detection,
  report_progress,
  normalize_summary_for_plaintext,
  check_summary_forbidden,
} from "./platform.ts";
import {
  _cli_result,
  _cli_error,
  _inject_strategy_codes,
  _require_save,
  log_branch_normalization,
  normalize_branch_ref,
} from "./cli_common.ts";
import { canonicalize_language } from "./lang.ts";
import { ContentStore } from "./store.ts";
import { _get_local_state_path } from "./state.ts";
import { IsolationError, isolate_if_foreign, log_isolation } from "./task_isolation.ts";

type Args = Record<string, any>;

/**
 * The host agent is the worker: submitting only registers the task, and its
 * status stays `in_progress` until the agent drives the pipeline and calls
 * `complete-task`. Say that explicitly, because a bare "submitted" reads as
 * "a scan is now running" and nothing would ever move the task off
 * `in_progress`.
 */
function _log_task_registered(tag: string, task_id: any, extra = ""): void {
  console.error(`✅ [${tag}] detection task registered: taskId=${task_id}, status=in_progress${extra}`);
  console.error("   Nothing is scanning yet — this command only registers the task. Next: clone-and-diff --with-plan → per-method analysis + batch-update-process → complete-task (or finalize-all). Give up on a task with force-abort-task so it does not sit in_progress forever.");
}

export function cmd_submit_plan(args: Args): void {
  const plan_id = args.plan_id;
  const plan_type = args.plan_type;
  const submit_user = args.submit_user;

  const request_body: Record<string, any> = {
    detectType: "TEST_PLAN",
    planId: plan_id,
    planType: plan_type,
    submitUser: submit_user,
  };

  if (args.services_json) {
    try {
      const services = JSON.parse(args.services_json);
      request_body.services = services;
    } catch (e: any) {
      console.error(`❌ --services-json is not valid JSON: ${e.message || e}`);
      process.exit(1);
    }
  }

  if (args.plan_name) {
    request_body.planName = args.plan_name;
  }
  if (args.requirement_docs) {
    try {
      request_body.requirementDocs = JSON.parse(args.requirement_docs);
    } catch {
      request_body.requirementDocs = [args.requirement_docs];
    }
  }
  if (args.technical_docs) {
    try {
      request_body.technicalDocs = JSON.parse(args.technical_docs);
    } catch {
      request_body.technicalDocs = [args.technical_docs];
    }
  }
  if (args.test_case_ids) {
    try {
      request_body.testCaseIds = JSON.parse(args.test_case_ids);
    } catch {
      // pass
    }
  }
  _inject_strategy_codes(
    request_body,
    args.strategy_codes ?? null,
    request_body.services || [],
    null,
    "TEST_PLAN",
  );
  if (request_body.strategyCodes && request_body.strategyCodes.includes(10)) {
    console.error("[submit-plan] 🔍 Injected frontend-only detection strategy (strategyCode=10)");
  }
  if (args.rule_ids) {
    request_body.ruleIds = args.rule_ids.split(",").map((x: string) => x.trim()).filter(Boolean);
  }

  const result = submit_detection(request_body);
  if ("_error" in result) {
    console.error(`[submit-plan] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[submit-plan] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  const data = result.data;
  let task_id: any;
  if (typeof data === "number" && Number.isInteger(data)) {
    task_id = data;
  } else {
    task_id = (data || {}).taskId;
  }
  if (!task_id || typeof task_id !== "number" || !Number.isInteger(task_id) || task_id <= 0) {
    console.error(`[submit-plan] ⚠️  API did not return a valid taskId (got ${JSON.stringify(task_id)}); check the response`);
  }
  _log_task_registered("submit-plan", task_id);
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_submit_git(args: Args): void {
  // Store the plain branch name: clone-and-diff normalises the same way, and a
  // mismatch here would make task isolation treat the same repo as foreign.
  const branch = normalize_branch_ref(args.branch);
  if (!branch) {
    console.error(`❌ submit-git requires --branch (got ${JSON.stringify(args.branch ?? null)})`);
    process.exit(1);
  }
  log_branch_normalization("submit-git", "--branch", args.branch, branch);
  const contrast_branch = normalize_branch_ref(args.contrast_branch);
  log_branch_normalization("submit-git", "--contrast-branch", args.contrast_branch, contrast_branch);

  const request_body: Record<string, any> = {
    detectType: "GIT_BRANCH",
    git: args.git,
    developBranch: branch,
    contrastBranch: contrast_branch,
    submitUser: args.submit_user,
  };
  const service_key = args.service_key;
  if (service_key) {
    request_body.serviceKey = service_key;
  }
  _inject_strategy_codes(
    request_body,
    args.strategy_codes ?? null,
    null,
    args.git,
    "GIT_BRANCH",
  );
  if (request_body.strategyCodes && request_body.strategyCodes.includes(10)) {
    console.error("[submit-git] 🔍 Injected frontend-only detection strategy (strategyCode=10)");
  }
  if (args.rule_ids) {
    request_body.ruleIds = args.rule_ids.split(",").map((x: string) => x.trim()).filter(Boolean);
  }

  const result = submit_detection(request_body);
  if ("_error" in result) {
    console.error(`[submit-git] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[submit-git] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  let data = result.data || {};
  let task_id = data.taskId;
  if (!task_id || typeof task_id !== "number" || !Number.isInteger(task_id) || task_id <= 0) {
    console.error(`[submit-git] ⚠️  API did not return a valid taskId (got ${JSON.stringify(task_id)}); check the response`);
  } else {
    // Align with phase1-init: content store + service registration so
    // check-phase2-readiness does not fail with "services is empty".
    const incoming: Record<string, any> = {
      userId: args.submit_user,
      gitUrl: args.git,
      branch,
    };
    let iso: Record<string, any>;
    try {
      iso = isolate_if_foreign(task_id, incoming);
    } catch (exc: any) {
      if (exc instanceof IsolationError) {
        _cli_error(String(exc.message || exc));
      }
      throw exc;
    }
    log_isolation("submit-git", iso);
    if (iso.remapped) {
      task_id = iso.taskId;
      data = { ...data, taskId: task_id };
      if (iso.batchIds) data = { ...data, batchIds: iso.batchIds };
      result.data = data;
    }

    const store = new ContentStore(task_id);
    store.set_meta("userId", args.submit_user);
    store.set_meta("detectType", "GIT_BRANCH");
    const batch_ids: number[] = Array.isArray(data.batchIds)
      ? data.batchIds.map((b: any) => parseInt(String(b), 10)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    try {
      store.add_or_update_service({
        gitUrl: args.git,
        branch,
        serviceKey: args.service_key ?? null,
        batchIds: batch_ids,
        language: canonicalize_language(args.language) || null,
        languageSource: args.language ? "explicit" : null,
        commitId: null,
        localDir: null,
        verified: false,
      });
    } catch (e: any) {
      console.error(`[submit-git] ⚠️  service registration failed: ${e.message || e}`);
    }
    _require_save(store);
    console.error(`[submit-git] ✅ content initialized + service registered (services=${store.get_summary().services})`);
  }
  _log_task_registered("submit-git", task_id);
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_submit_skill_direct(args: Args): void {
  let job_infos: any[] = [];
  if (args.services_json) {
    try {
      job_infos = JSON.parse(args.services_json);
    } catch (e: any) {
      console.error(`❌ --services-json is not valid JSON: ${e.message || e}`);
      process.exit(1);
    }
  } else if (args.git) {
    const branch = normalize_branch_ref(args.branch);
    log_branch_normalization("submit-skill-direct", "--branch", args.branch, branch);
    const job_info: Record<string, any> = { git: args.git, developBranch: branch };
    if (args.contrast_branch) {
      const contrast_branch = normalize_branch_ref(args.contrast_branch);
      log_branch_normalization("submit-skill-direct", "--contrast-branch", args.contrast_branch, contrast_branch);
      job_info.deployBranch = contrast_branch;
    }
    const service_key = args.service_key;
    if (service_key) {
      job_info.serviceKey = service_key;
    }
    job_infos = [job_info];
  } else {
    console.error("❌ submit-skill-direct requires --git + --branch or --services-json");
    process.exit(1);
  }

  for (const job of job_infos) {
    if (!job || typeof job !== "object") continue;
    for (const key of ["branch", "developBranch", "deployBranch", "contrastBranch"]) {
      if (!job[key]) continue;
      const normalized = normalize_branch_ref(job[key]);
      log_branch_normalization("submit-skill-direct", key, job[key], normalized);
      job[key] = normalized;
    }
  }

  const request_body: Record<string, any> = {
    detectType: "SKILL_DIRECT",
    jobInfos: job_infos,
    submitUser: args.submit_user,
  };

  _inject_strategy_codes(
    request_body,
    args.strategy_codes ?? null,
    job_infos,
    job_infos.length ? job_infos[0].git : null,
    "SKILL_DIRECT",
  );
  if (request_body.strategyCodes && request_body.strategyCodes.includes(10)) {
    console.error("[submit-skill-direct] 🔍 Injected frontend-only detection strategy (strategyCode=10)");
  }

  const ext_info: Record<string, any> = {};
  if (args.requirement_docs) {
    try {
      ext_info.requirementDocs = JSON.parse(args.requirement_docs);
    } catch {
      ext_info.requirementDocs = [args.requirement_docs];
    }
  }
  if (args.technical_docs) {
    try {
      ext_info.technicalDocs = JSON.parse(args.technical_docs);
    } catch {
      ext_info.technicalDocs = [args.technical_docs];
    }
  }
  if (args.test_case_ids) {
    try {
      ext_info.testCaseIds = JSON.parse(args.test_case_ids);
    } catch {
      // pass
    }
  }
  if (Object.keys(ext_info).length) {
    request_body.extInfo = ext_info;
  }

  const result = submit_detection(request_body);
  if ("_error" in result) {
    console.error(`[submit-skill-direct] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[submit-skill-direct] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  const data = result.data;
  let task_id: any;
  if (typeof data === "number" && Number.isInteger(data)) {
    task_id = data;
  } else {
    task_id = (data || {}).taskId;
  }
  if (!task_id || typeof task_id !== "number" || !Number.isInteger(task_id) || task_id <= 0) {
    console.error(`[submit-skill-direct] ⚠️  API did not return a valid taskId (got ${JSON.stringify(task_id)}); check the response`);
  }
  _log_task_registered("submit-skill-direct", task_id, " (strategy: AST scan + business detection)");
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_status(args: Args): void {
  const result = get_task_status(args.task_id);
  if ("_error" in result) {
    console.error(`[status] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[status] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_list_my_tasks(args: Args): void {
  const result = list_my_tasks(args.submit_user, args.limit);
  if ("_error" in result) {
    console.error(`[list-my-tasks] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[list-my-tasks] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_retry(args: Args): void {
  const result = retry_detection(args.task_id, args.submit_user ?? null);
  if ("_error" in result) {
    console.error(`[retry] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[retry] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_force_abort_task(args: Args): void {
  const task_id = args.task_id;
  const reason = args.reason || null;

  const result = force_abort_task(task_id, reason);
  if ("_error" in result) {
    console.error(`[force-abort-task] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[force-abort-task] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.error(`✅ force-abort-task succeeded: taskId=${task_id}, task force-aborted`);
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_complete_task(args: Args): void {
  let batch_ids: number[] = [];
  if (args.batch_ids) {
    batch_ids = args.batch_ids.split(",").map((x: string) => x.trim()).filter(Boolean).map((x: string) => parseInt(x, 10));
  }

  const force = args.force || false;
  const preview = args.preview || false;

  if (preview) {
    const detection_summary = args.summary;
    if (!detection_summary) {
      console.error("[complete-task --preview] ❌ --preview mode requires --summary");
      process.exit(1);
    }
    const normalized = normalize_summary_for_plaintext(detection_summary);
    const issues: string[] = [];
    const forbidden = check_summary_forbidden(normalized);
    if (forbidden) {
      for (const it of forbidden) {
        issues.push(`Forbidden term: "${it.matched}" — ${it.reason}; suggestion: ${it.suggestion}`);
      }
    }
    const _REQUIRED_SECTIONS: Array<[string, string]> = [
      ["📋[Requirement changes]", "Requirement changes"],
      ["🔍[Analysis scope]", "Analysis scope"],
      ["⚠️[Risks]", "Risks"],
      ["📌[Notes]", "Notes"],
      ["✅[Conclusion]", "Conclusion"],
    ];
    const missing = _REQUIRED_SECTIONS.filter(([marker]) => !normalized.includes(marker)).map(([, name]) => name);
    if (missing.length) {
      issues.push(`Missing section markers: ${missing.join(", ")}`);
    }
    if (issues.length) {
      console.error("[complete-task --preview] ❌ summary format check failed:");
      for (const iss of issues) {
        console.error(`  - ${iss}`);
      }
      _cli_result(1, { issues, charCount: normalized.length }, "summary_validation_failed");
    } else {
      console.error(`[complete-task --preview] ✅ summary format OK (${normalized.length} chars, 5 sections present, no forbidden terms)`);
      _cli_result(0, { charCount: normalized.length, sections: _REQUIRED_SECTIONS.map(([, name]) => name) }, "summary_validation_passed");
    }
    return;
  }

  if (!force) {
    if (!batch_ids.length) {
      console.error(
        "[complete-task] ❌ --batch-ids was not passed; cannot verify write-back completeness before finalize." +
          "Pass every parentBatchId for this task (comma-separated); " +
          "To skip, pass --force explicitly.",
      );
      process.exit(2);
    }
    const preflight = preflight_complete_check(batch_ids);
    if (!preflight.ok) {
      console.error("[complete-task] ⛔ Consistency gate failed; finalize rejected (to keep the report aligned with conclusions):");
      for (const b of preflight.blockers) {
        console.error(`  - ${b}`);
      }
      console.error(
        "[complete-task] Fill the gaps (re-run batch-update-process / finalize-rank) and retry; " +
          "Add --force only if you must finalize anyway.",
      );
      console.log(JSON.stringify({
        code: 1,
        msg: "consistency_preflight_failed",
        data: { blocked: true, blockers: preflight.blockers, preflight },
      }, null, 2));
      process.exit(1);
    }
    for (const w of preflight.warnings || []) {
      console.error(`[complete-task] ⚠️  ${w}`);
    }
    console.error("[complete-task] ✅ Consistency gate passed: all processes written back and all ranks recorded.");

    try {
      const store = new ContentStore(args.task_id);
      const context_data = store.load_context_only();
      const findings_data = store.load_findings_only();
      const cases_all = typeof store.get_test_cases === "function" ? store.get_test_cases() : (context_data.testCases || []);
      const extracted_rules_all = typeof store.get_extracted_rules === "function"
        ? store.get_extracted_rules()
        : ((context_data.documents || {}).extractedRules || []);

      const local_warnings: string[] = [];
      const local_blockers: string[] = [];

      // Every planned method needs a write-back (plan.json is the ground truth for git tasks).
      local_blockers.push(...local_plan_gaps(args.task_id).blockers);

      const has_cases = Boolean(cases_all && cases_all.length);
      const has_doc = Boolean(extracted_rules_all && extracted_rules_all.length);
      const findings_list = findings_data.summaryFindings || findings_data.findings || [];
      const cross_view_findings = findings_list.filter((f: any) => f.category === "cross-view");

      if ((has_cases || has_doc) && !cross_view_findings.length) {
        local_warnings.push(
          "Cross-view first pass was not run (docs or cases exist, no cross-view record). " +
            "Run Step 2.7c as a keyword screen, then semantically verify before the summary. " +
            "This does not block finalize.",
        );
      }

      const delivery_defects = context_data.deliveryDefects || [];
      if (delivery_defects.length) {
        const writebacks = store.load_writebacks_only().processWritebacks || [];
        const has_l21_evidence = writebacks.some((wb: any) => {
          const thinking = wb.thinking || "";
          return thinking.includes("submitted defects")
            || thinking.includes("Compared submitted defects")
            || thinking.includes("same-class recurrence")
            || thinking.includes("fix regression");
        });
        if (!has_l21_evidence) {
          local_warnings.push(
            "Submitted-defect cross-check may not have run: submitted-defect data exists but write-back thinking " +
              "No evidence of L2.1 related-issue review. Confirm submitted defects were compared for the changed classes.",
          );
        }
      }

      const extracted_rules = extracted_rules_all;
      if (extracted_rules && extracted_rules.length >= 2) {
        const writebacks = store.load_writebacks_only().processWritebacks || [];
        const doc_ref_count = writebacks.filter((wb: any) => {
          const thinking = wb.thinking || "";
          return ["DOC_SUMMARY", "business rule", "document", "requirement doc", "technical doc"].some((kw) => thinking.includes(kw));
        }).length;
        if (writebacks.length && doc_ref_count === 0) {
          local_warnings.push(
            `Documents were unused: extracted ${extracted_rules.length} business rule(s) but ` +
              "None of the write-back thinking cites document content. The docs may have been unused.",
          );
        }
      }

      if (local_blockers.length) {
        console.error("[complete-task] ⛔ Local quality gate failed:");
        for (const lb of local_blockers) {
          console.error(`  - ${lb}`);
        }
        console.log(JSON.stringify({
          code: 1,
          msg: "local_quality_gate_failed",
          data: { blocked: true, blockers: local_blockers, warnings: local_warnings },
        }, null, 2));
        process.exit(1);
      }
      for (const lw of local_warnings) {
        console.error(`[complete-task] ⚠️  ${lw}`);
      }
    } catch (e: any) {
      console.error(`[complete-task] ⚠️  Failed to read the local quality gate (not blocking): ${e}`);
    }
  } else {
    console.error("[complete-task] ⚠️  --force skipped the consistency gate (only process/rank completeness; summary format is still checked). The report may not match the actual write-back.");
  }

  const detection_summary = args.summary;

  if (!detection_summary && !force) {
    console.error("[complete-task] ⛔ --summary was not provided; finalize rejected.");
    console.error("[complete-task] The detection summary is required in the report and must be passed before finalize.");
    console.error(
      "[complete-task] Validate the format with validate-summary --preview first, then pass --summary to finalize; " +
        "Add --force only if you must skip.",
    );
    _cli_result(1, {
      blocked: true,
      reason: "Detection summary (--summary) was not provided; the task cannot finalize without a summary.",
    }, "summary_required");
    process.exit(1);
  }

  const result = complete_task(args.task_id, args.failed, args.fail_msg, detection_summary);
  if ("_error" in result) {
    console.error(`[complete-task] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[complete-task] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  if (detection_summary) {
    console.error(`[complete-task] ✅ Detection summary uploaded (length: ${detection_summary.length} chars)`);
  }
  console.error(`✅ complete-task succeeded: taskId=${args.task_id}`);

  if (!force) {
    try {
      const rec = reconcile_report(args.task_id);
      if (rec.ok) {
        console.error(
          `[complete-task] ✅ Report↔actual reconcile passed:` +
            `${rec.localDefectCount} defect(s) are all present in the report.`,
        );
        result._reconcile_status = "CONSISTENT";
      } else {
        console.error("[complete-task] ⛔ Report↔actual reconcile failed (task finalized, but the report does not match the analysis):");
        for (const b of rec.blockers) {
          console.error(`  - ${b}`);
        }
        console.error(
          "[complete-task] ⚠️  Do not tell the user detection is complete. Fix write-back from the diffs" +
            " (batch-update-process / finalize-rank / update-rank-content), then " +
            "Re-run `reconcile-report --task-id` until it passes.",
        );
        result._reconcile_status = "DRIFT";
        result._reconcile_detail = rec;
      }
    } catch (e: any) {
      console.error(`[complete-task] ⚠️  Reconcile report failed (does not block finalize): ${e}`);
      result._reconcile_status = "SKIPPED";
    }
  } else {
    result._reconcile_status = "SKIPPED_FORCE";
  }

  console.log(JSON.stringify(result, null, 2));
}

export function cmd_report_progress(args: Args): void {
  const task_id = args.task_id;
  const percent = args.percent;

  const state_path = _get_local_state_path(task_id);
  let state: Record<string, any> = {};
  try {
    state = JSON.parse(readFileSync(state_path, "utf8"));
  } catch {
    state = {};
  }

  const last = state.progressReport || {};
  const last_ts = last.lastReportTs || 0;
  const last_percent = last.lastPercent ?? -1;
  const now = Date.now() / 1000;

  const elapsed = now - last_ts;
  const delta = last_percent >= 0 ? Math.abs(percent - last_percent) : 999;

  if (!args.force) {
    if (elapsed < args.min_interval && delta < args.min_delta) {
      console.error(
        `⏭️  report-progress skipped (throttled): ${elapsed.toFixed(0)}s since last < ${args.min_interval}s ` +
          `and progress delta ${delta} < ${args.min_delta}. Add --force to report anyway.`,
      );
      console.log(JSON.stringify({
        skipped: true,
        reason: "throttled",
        elapsedSec: Math.round(elapsed * 10) / 10,
        delta,
      }));
      return;
    }
  }

  const body: Record<string, any> = { taskId: task_id, overallPercent: percent };
  if (args.phase) body.currentPhase = args.phase;
  if (args.step) body.currentStep = args.step;
  if (args.analyzed_count != null) body.analyzedMethodCount = args.analyzed_count;
  if (args.total_count != null) body.totalMethodCount = args.total_count;
  if (args.defect_count != null) body.defectFoundCount = args.defect_count;
  if (args.activity) {
    body.activityMessages = args.activity.split("|").filter((m: string) => m.trim());
  }

  const result = report_progress(body);
  if ("_error" in result) {
    console.error(`[report-progress] ⚠️  Report failed (ignored; detection continues): ${result._error}`);
    console.log(JSON.stringify({ skipped: false, reported: false, error: result._error }));
    return;
  }

  state.progressReport = { lastReportTs: now, lastPercent: percent };
  try {
    mkdirSync(dirname(state_path), { recursive: true });
    writeFileSync(state_path, JSON.stringify(state, null, 2), "utf8");
  } catch (e: any) {
    console.error(`[report-progress] ⚠️  Failed to write throttle timestamp (report still sent): ${e}`);
  }

  console.error(
    `✅ report-progress succeeded: taskId=${task_id}, percent=${percent}%` +
      (args.phase ? `, phase=${args.phase}` : ""),
  );
  console.log(JSON.stringify({ skipped: false, reported: true, percent }));
}
