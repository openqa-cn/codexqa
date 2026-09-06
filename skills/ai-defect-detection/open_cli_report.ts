/**
 * Report and query commands: get-report / reconcile-report / get-detection-flow /
 * get-detection-flow-by-rank / get-exception-traces / get-detection-records /
 * get-confirmed-defect-history / get-defect-history-by-commit /
 * get-delivery-defects / create-issue
 */

import {
  create_issue,
  get_confirmed_defect_history,
  get_defect_history_by_commit,
  get_detection_flow_by_process,
  get_detection_flow_by_rank,
  get_report_by_task_id,
  query_detection_records,
  reconcile_report,
} from "./open_platform.ts";
import { resolve_traces, resolve_delivery_defects } from "./open_ingest.ts";

type Args = Record<string, any>;

export function cmd_get_report(args: Args): void {
  const result = get_report_by_task_id(args.task_id);
  if ("_error" in result) {
    console.error(`[get-report] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[get-report] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_reconcile_report(args: Args): void {
  const res = reconcile_report(args.task_id);
  if (res.ok) {
    console.error(
      `[reconcile-report] ✅ Report matches actual analysis results: ` +
        `process defects ${res.processDefectCount ?? "?"}, ` +
        `rank defects ${res.rankDefectCount ?? "?"}, ` +
        `report defects ${res.reportDefectCount}; all aligned, no drift.`,
    );
    console.log(JSON.stringify({ code: 0, msg: "reconcile_passed", data: res }, null, 2));
    return;
  }
  console.error("[reconcile-report] ⛔ Report does not match actual analysis results; do not output \"detection complete\":");
  for (const b of res.blockers) {
    console.error(`  - ${b}`);
  }
  console.error(
    "[reconcile-report] Fix the write-back using the diffs above (batch-update-process / finalize-rank / " +
      "update-rank-content), then compare again.",
  );
  console.log(JSON.stringify({ code: 1, msg: "reconcile_failed", data: res }, null, 2));
  process.exit(1);
}

export function cmd_get_detection_flow(args: Args): void {
  const result = get_detection_flow_by_process(args.process_id);
  if ("_error" in result) {
    console.error(`[get-detection-flow] ❌ ${result._error}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_get_detection_flow_by_rank(args: Args): void {
  const result = get_detection_flow_by_rank(args.rank_id);
  if ("_error" in result) {
    console.error(`[get-detection-flow-by-rank] ❌ ${result._error}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_get_exception_traces(args: Args): void {
  const result = resolve_traces(
    args.plan_id,
    args.plan_type,
    args.service_key ?? null,
    args.task_id ?? null,
  );
  if (result.degraded) {
    console.error(`[get-exception-traces] ⚠️  source=${result.source} (optional, continue detection)`);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_get_detection_records(args: Args): void {
  const params: Record<string, any> = {};
  if (args.git) params.git = args.git;
  const plan_id = args.plan_id;
  if (plan_id) params.planId = plan_id;
  if (args.plan_type) params.planType = args.plan_type;
  if (args.develop_branch) params.developBranch = args.develop_branch;
  if (args.commit) params.commit = args.commit;
  if (args.git_file_path) params.gitFilePath = args.git_file_path;
  if (args.start_time) params.startTime = args.start_time;
  if (args.end_time) params.endTime = args.end_time;

  const result = query_detection_records(params);
  if ("_error" in result) {
    console.error(`[get-detection-records] ❌ ${result._error}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_get_confirmed_defect_history(args: Args): void {
  const git = args.git;
  if (!git) {
    console.error("[confirmedDefectHistory] ❌ --git is required");
    process.exit(1);
  }

  const result = get_confirmed_defect_history(
    git,
    args.class_name || null,
    args.git_file_path || null,
    args.method_name || null,
    args.start_time,
    args.end_time,
    args.fix_status || null,
  );
  if ("_error" in result) {
    console.error(`[confirmedDefectHistory] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[confirmedDefectHistory] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  const data = result.data || [];
  const fix_status_filter = args.fix_status;
  console.error(
    `[confirmedDefectHistory] returned ${data.length} confirmed defects` +
      (fix_status_filter ? ` (fixStatus=${fix_status_filter})` : ""),
  );
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_get_defect_history_by_commit(args: Args): void {
  const git = args.git;
  const dev_commit = args.dev_commit;
  if (!git) {
    console.error("[defectHistoryByCommit] ❌ --git is required");
    process.exit(1);
  }
  if (!dev_commit) {
    console.error("[defectHistoryByCommit] ❌ --dev-commit is required");
    process.exit(1);
  }

  const result = get_defect_history_by_commit(
    git,
    dev_commit,
    args.class_name || null,
    args.method_name || null,
    args.start_time,
    args.end_time,
  );
  if ("_error" in result) {
    console.error(`[defectHistoryByCommit] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[defectHistoryByCommit] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  const data = result.data || [];
  console.error(`[defectHistoryByCommit] returned ${data.length} defect history records (git=${git}, devCommit=${dev_commit})`);
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_get_delivery_defects(args: Args): void {
  const result = resolve_delivery_defects(
    args.plan_id,
    args.plan_type,
    args.task_id ?? null,
  );
  const data = result.data || {};
  const total = data.total || 0;
  if (result.degraded) {
    console.error(`[get-delivery-defects] ⚠️  source=${result.source}, ${total} records (can continue)`);
  } else {
    console.log(`[get-delivery-defects] ✅ ${total} submitted defects`);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_create_issue(args: Args): void {
  let cc_list: string[] | null = null;
  if (args.cc_list) {
    cc_list = args.cc_list.split(",").map((s: string) => s.trim()).filter(Boolean);
  }

  const result = create_issue(
    args.test_apply_id,
    args.title,
    args.description,
    args.discovery_tool || "AI defect detection",
    args.assigned_to || null,
    cc_list,
    args.severity,
    args.develop_branch || null,
    args.deploy_branch || null,
    args.commit_id || null,
    args.service_key || null,
    args.operator || null,
    args.record_url || null,
    args.bug_id,
  );
  if ("_error" in result) {
    console.error(`[create-issue] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[create-issue] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  const data = result.data || {};
  const defect_id = data.issueId;
  const defect_url = data.defectUrl || "";
  const assignee = data.assignedTo || "";
  console.error("✅ Defect issue created!");
  console.error(`   Defect ID: ${defect_id}`);
  console.error(`   Assignee: ${assignee}`);
  if (defect_url) {
    console.error(`   Link: ${defect_url}`);
  }
  console.log(JSON.stringify(result, null, 2));
}
