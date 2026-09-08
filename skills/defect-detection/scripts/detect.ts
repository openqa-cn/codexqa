#!/usr/bin/env node
/**
 * AI defect-detection Skill trigger script (TypeScript)
 */
import { readFileSync } from "node:fs";
import { ArgumentParser } from "./argparse.ts";
import { set_token } from "./auth.ts";
import { AuthenticationError } from "./providers/auth/base.ts";
import {
  cmd_get_changed_methods, cmd_build_detection_plan, cmd_prep_and_plan, cmd_verify_line_method_mapping, cmd_extract_rules_from_docs,
} from "./cli_auto.ts";
import {
  cmd_init_content, cmd_add_service_to_content, cmd_update_service_in_content, cmd_set_diff_files,
  cmd_set_changed_methods, cmd_set_meta_field, cmd_set_doc_summary, cmd_add_document, cmd_scan_repo_docs,
  cmd_add_test_case, cmd_add_detection_plan_item, cmd_add_cross_repo_class, cmd_record_process_writeback,
  cmd_update_plan_status, cmd_set_plan_ast_result, cmd_record_rank, cmd_content_summary, cmd_register_context_read,
  cmd_register_finding, cmd_get_findings,
} from "./cli_store.ts";
import {
  cmd_get_plan_info, cmd_check_materials, cmd_extract_client_plan_info, cmd_get_pending, cmd_get_rules, cmd_check_coverage,
  cmd_phase1_fetch_all, cmd_clone_and_diff, cmd_ensure_gitnexus,
  cmd_gitnexus_impact, cmd_gitnexus_context, cmd_gitnexus_query,
  cmd_register_repo_clone, cmd_check_phase2_readiness, cmd_get_tag_list, cmd_phase1_init,
  cmd_fetch_test_cases_fallback, cmd_run_frontend_rules, cmd_testcase_pipeline,
} from "./cli_prep.ts";
import {
  cmd_process_sample, cmd_resolve_writeback_context, cmd_update_process, cmd_finalize_rank, cmd_check_rank_integrity,
  cmd_gen_writeback_template, cmd_batch_no_bug, cmd_batch_update_process, cmd_batch_dismiss_by_strategy,
  cmd_dismiss_class, cmd_register_code_read, cmd_read_method_code, cmd_code_read_stats, cmd_trivial_method_filter,
  cmd_run_ast_scan, cmd_mark_bug, cmd_invalid_record, cmd_skip_service_batch, cmd_update_rank_content,
} from "./cli_run.ts";
import {
  cmd_validate_summary, cmd_update_summary, cmd_cross_view_check, cmd_check_req_coverage, cmd_check_analysis_quality,
  cmd_show_local_progress, cmd_cleanup_stale_data, cmd_finalize_all,
} from "./cli_quality.ts";
import {
  cmd_get_report, cmd_reconcile_report, cmd_get_detection_flow, cmd_get_detection_flow_by_rank,
  cmd_get_exception_traces, cmd_get_detection_records, cmd_get_confirmed_defect_history,
  cmd_get_defect_history_by_commit, cmd_get_delivery_defects, cmd_create_issue,
} from "./cli_report.ts";
import {
  cmd_submit_plan, cmd_submit_git, cmd_submit_skill_direct, cmd_status, cmd_list_my_tasks, cmd_retry,
  cmd_force_abort_task, cmd_complete_task, cmd_report_progress,
} from "./cli_task.ts";
import { cmd_run_optional_overlays } from "./overlays.ts";

function build_parser(): ArgumentParser {
  const parser = new ArgumentParser({
    description: "AI defect-detection Skill trigger (modular)",
    epilog: "Examples:\n  node detect.ts submit-plan --plan-id 74873 --plan-type 2 --submit-user demo-user\n  node detect.ts status --task-id 42",
  });
  parser.add_argument("--token", { help: "Access token or API key for remote providers" });
  const sub = parser.add_subparsers({ dest: "cmd", required: true });

  const p1 = sub.add_parser("submit-plan", { help: "Trigger Skill detection from a test-plan ID" });
  p1.add_argument("--plan-id", { type: "int", required: true });
  p1.add_argument("--plan-type", { type: "int", default: 2, choices: [2, 4] });
  p1.add_argument("--submit-user", { required: true });
  p1.add_argument("--plan-name");
  p1.add_argument("--services-json");
  p1.add_argument("--requirement-docs");
  p1.add_argument("--technical-docs");
  p1.add_argument("--test-case-ids");
  p1.add_argument("--strategy-codes");
  p1.add_argument("--rule-ids");

  const p2 = sub.add_parser("submit-git", { help: "Trigger Skill detection from a Git repo + branch" });
  p2.add_argument("--git", { required: true });
  p2.add_argument("--branch", { required: true });
  p2.add_argument("--service-key", { dest: "service_key" });
  p2.add_argument("--contrast-branch", { default: "master" });
  p2.add_argument("--submit-user", { required: true });
  p2.add_argument("--strategy-codes");
  p2.add_argument("--rule-ids");
  p2.add_argument("--language", { help: "Declare the repo language; omit to let clone-and-diff detect it from changed files" });

  const p_sd = sub.add_parser("submit-skill-direct", { help: "Direct trigger: AST scan (8) + business detection (11) only" });
  p_sd.add_argument("--git");
  p_sd.add_argument("--branch");
  p_sd.add_argument("--service-key", { dest: "service_key" });
  p_sd.add_argument("--contrast-branch", { default: "master" });
  p_sd.add_argument("--services-json");
  p_sd.add_argument("--submit-user", { required: true });
  p_sd.add_argument("--requirement-docs");
  p_sd.add_argument("--technical-docs");
  p_sd.add_argument("--test-case-ids");
  p_sd.add_argument("--strategy-codes");

  const p3 = sub.add_parser("status", { help: "Query Skill detection task status" });
  p3.add_argument("--task-id", { type: "int", required: true });

  const p_fpi = sub.add_parser("get-plan-info", { help: "Get test-plan details" });
  p_fpi.add_argument("--plan-id", { type: "int", required: true });
  p_fpi.add_argument("--plan-type", { type: "int", default: 2, choices: [2, 4] });
  p_fpi.add_argument("--task-id", { type: "int" });
  p_fpi.add_argument("--plan-name");
  p_fpi.add_argument("--git");
  p_fpi.add_argument("--branch");
  p_fpi.add_argument("--service-key", { dest: "service_key" });
  p_fpi.add_argument("--services-json");
  p_fpi.add_argument("--requirement-docs");
  p_fpi.add_argument("--technical-docs");
  p_fpi.add_argument("--test-case-ids");
  p_fpi.add_argument("--issue-list");
  p_fpi.add_argument("--user-materials-json");

  const p_cm = sub.add_parser("check-materials", { help: "Inventory materials" });
  p_cm.add_argument("--plan-id", { type: "int" });
  p_cm.add_argument("--plan-type", { type: "int", default: 2, choices: [2, 4] });
  p_cm.add_argument("--task-id", { type: "int" });
  p_cm.add_argument("--git");
  p_cm.add_argument("--branch");
  p_cm.add_argument("--user-materials-json");

  const p_ecp = sub.add_parser("extract-client-plan-info", { help: "Extract git+branch from plan/user materials" });
  p_ecp.add_argument("--plan-id", { type: "int", required: true });
  p_ecp.add_argument("--plan-type", { type: "int", default: 2, choices: [2, 4] });
  p_ecp.add_argument("--task-id", { type: "int" });
  p_ecp.add_argument("--git");
  p_ecp.add_argument("--branch");
  p_ecp.add_argument("--user-materials-json");

  const p4 = sub.add_parser("get-pending", { help: "Claim the pending checklist" });
  p4.add_argument("--batch-id", { type: "int", required: true });
  p4.add_argument("--task-id", { type: "int" });
  p4.add_argument("--skip-local-done", { storeTrue: true });
  p4.add_argument("--group-by-class", { storeTrue: true });

  const p5 = sub.add_parser("check-coverage", { help: "Check detection coverage" });
  p5.add_argument("--batch-id", { type: "int", required: true });

  const p7 = sub.add_parser("get-rules", { help: "Get detection rules" });
  p7.add_argument("--git");
  p7.add_argument("--user-id");
  p7.add_argument("--task-id", { type: "int" }); // optional: persist rules into the task (like phase1-fetch-all)

  const p8 = sub.add_parser("list-my-tasks", { help: "List recent tasks for a user" });
  p8.add_argument("--submit-user", { required: true });
  p8.add_argument("--limit", { type: "int", default: 20 });

  const p9 = sub.add_parser("retry", { help: "Re-run detection from an existing task" });
  p9.add_argument("--task-id", { type: "int", required: true });
  p9.add_argument("--submit-user");

  const p10 = sub.add_parser("get-report", { help: "Get the detection task report" });
  p10.add_argument("--task-id", { type: "int", required: true });

  const p10b = sub.add_parser("reconcile-report", { help: "Reconcile report" });
  p10b.add_argument("--task-id", { type: "int", required: true });

  const p11 = sub.add_parser("check-rank-integrity", { help: "Check rank consistency" });
  p11.add_argument("--batch-id", { type: "int", required: true });

  const p14 = sub.add_parser("complete-task", { help: "Finalize the task" });
  p14.add_argument("--task-id", { type: "int", required: true });
  p14.add_argument("--batch-ids");
  p14.add_argument("--force", { storeTrue: true });
  p14.add_argument("--preview", { storeTrue: true });
  p14.add_argument("--failed", { storeTrue: true });
  p14.add_argument("--fail-msg");
  p14.add_argument("--summary");
  p14.add_argument("--summary-file", { dest: "summary_file", help: "Read --summary text from a file (avoids shell quoting of emoji/newlines)" });

  const p_vs = sub.add_parser("validate-summary", { help: "Validate summary offline" });
  p_vs.add_argument("--summary");
  p_vs.add_argument("--summary-file", { dest: "summary_file" });

  const p_us = sub.add_parser("update-summary", { help: "Upload the detection summary" });
  p_us.add_argument("--task-id", { type: "int", required: true });
  p_us.add_argument("--summary");
  p_us.add_argument("--summary-file", { dest: "summary_file" });

  const p_fat = sub.add_parser("force-abort-task", { help: "Force-abort a task" });
  p_fat.add_argument("--task-id", { type: "int", required: true });
  p_fat.add_argument("--reason");

  const p_ssb = sub.add_parser("skip-service-batch", { help: "Skip or fail a single service" });
  p_ssb.add_argument("--parent-batch-id", { type: "int", required: true });
  p_ssb.add_argument("--failed", { storeTrue: true });
  p_ssb.add_argument("--reason");

  const p13 = sub.add_parser("finalize-rank", { help: "Write a rank" });
  p13.add_argument("--batch-id", { type: "int", default: 0 });
  p13.add_argument("--task-id", { type: "int" });
  p13.add_argument("--class-name", { required: true });
  p13.add_argument("--method-name", { default: "" });
  p13.add_argument("--bug-status", { type: "int", required: true, choices: [6, 7] });
  const p13c = p13.add_mutually_exclusive_group({ required: true });
  p13c.add_argument("--content");
  p13c.add_argument("--content-file");
  p13.add_argument("--process-ids", { default: "" });

  const p15 = sub.add_parser("get-detection-flow", { help: "Query by processId" });
  p15.add_argument("--process-id", { type: "int", required: true });

  const p16 = sub.add_parser("get-detection-flow-by-rank", { help: "Query by rankId" });
  p16.add_argument("--rank-id", { type: "int", required: true });

  const p17 = sub.add_parser("mark-bug", { help: "User-confirm a defect" });
  p17.add_argument("--rank-id", { type: "int", required: true });
  p17.add_argument("--bug-status", { type: "int", required: true, choices: [3, 4, 5, 8] });
  p17.add_argument("--op-type", { type: "int", default: 3, choices: [3, 4, 6] });
  p17.add_argument("--user-id");
  p17.add_argument("--extra");
  p17.add_argument("--task-id", { type: "int" });
  p17.add_argument("--query-id", { type: "int" });
  p17.add_argument("--no-create-bug", { storeTrue: true });

  const p18 = sub.add_parser("get-exception-traces", { help: "Query exception traces" });
  p18.add_argument("--plan-id", { type: "int", required: true });
  p18.add_argument("--plan-type", { type: "int", default: 2, choices: [2, 4] });
  p18.add_argument("--service-key", { dest: "service_key" });
  p18.add_argument("--task-id", { type: "int" });

  const p20 = sub.add_parser("get-detection-records", { help: "Query detection records" });
  p20.add_argument("--git");
  p20.add_argument("--plan-id", { type: "int" });
  p20.add_argument("--plan-type", { type: "int", choices: [2, 4] });
  p20.add_argument("--develop-branch");
  p20.add_argument("--commit");
  p20.add_argument("--git-file-path");
  p20.add_argument("--start-time");
  p20.add_argument("--end-time");

  const p21 = sub.add_parser("create-issue", { help: "Create a defect ticket" });
  p21.add_argument("--plan-id", { dest: "test_apply_id", type: "int", required: true });
  p21.add_argument("--title", { required: true });
  p21.add_argument("--description", { required: true });
  p21.add_argument("--discovery-tool", { default: "AI defect detection" });
  p21.add_argument("--assigned-to");
  p21.add_argument("--cc-list");
  p21.add_argument("--severity", { type: "int", choices: [0, 1, 2, 3, 4] });
  p21.add_argument("--develop-branch");
  p21.add_argument("--deploy-branch");
  p21.add_argument("--commit-id");
  p21.add_argument("--service-key", { dest: "service_key" });
  p21.add_argument("--operator");
  p21.add_argument("--record-url");
  p21.add_argument("--bug-id", { type: "int" });

  const p23 = sub.add_parser("run-ast-scan", { help: "Batch AST rule scan" });
  p23.add_argument("--code-dir", { required: true });
  p23.add_argument("--rules-json", { required: true });
  p23.add_argument("--target-files");
  p23.add_argument("--diff-files", { dest: "diff_files" });
  p23.add_argument("--task-id", { dest: "task_id", type: "int" });
  p23.add_argument("--changed-only", { dest: "changed_only", storeTrue: true, exclusiveGroup: "ast-scope" });
  p23.add_argument("--full-repo", { dest: "full_repo", storeTrue: true, exclusiveGroup: "ast-scope" });
  p23.add_argument("--output-yaml");
  p23.add_argument("--project-language", { dest: "project_language" });
  p23.add_argument("--is-client-repo", { storeTrue: true });

  const p_ov = sub.add_parser("run-optional-overlays", {
    help: "Optional secret / SCA / native-analyzer overlays (gitleaks, trivy|grype, bandit, gosec, go vet, staticcheck, cppcheck, eslint, detekt); missing binaries are skipped",
  });
  p_ov.add_argument("--code-dir", { dest: "code_dir", required: true });
  p_ov.add_argument("--task-id", { dest: "task_id", type: "int" });
  p_ov.add_argument("--diff-files", { dest: "diff_files", help: "comma list or a file with one path per line; defaults to the task diff" });
  p_ov.add_argument("--scan-purpose", { dest: "scan_purpose", default: "pr", help: "pr (default) | trunk" });
  p_ov.add_argument("--full-repo", { dest: "full_repo", storeTrue: true });
  p_ov.add_argument("--languages", { help: "comma list; defaults to the languages of the diff files" });
  p_ov.add_argument("--kinds", { help: "comma list of secret,sca,native (default all)" });
  p_ov.add_argument("--tools", { help: "comma list of tool ids to restrict to" });

  const p_bds = sub.add_parser("batch-dismiss-by-strategy", { help: "Batch-dismiss AST strategy as no-defect" });
  p_bds.add_argument("--parent-batch-id", { type: "int", required: true });
  p_bds.add_argument("--strategy-code", { type: "int", default: 8 });
  p_bds.add_argument("--ast-findings-count", { type: "int", required: true });
  p_bds.add_argument("--verified-count", { type: "int" });
  p_bds.add_argument("--dismissible-count", { dest: "dismissible_count", type: "int" });

  const p_dc = sub.add_parser("dismiss-class", { help: "Dismiss by class as no-defect" });
  p_dc.add_argument("--task-id", { type: "int", required: true });
  p_dc.add_argument("--batch-id", { type: "int", required: true });
  p_dc.add_argument("--git-url", { required: true });
  p_dc.add_argument("--class-names", { required: true });
  p_dc.add_argument("--class-type", { required: true, choices: ["thrift_enum", "interface_def", "frontend_type", "dto_vo", "constant"] });
  p_dc.add_argument("--coverage-threshold", { type: "float", default: 1.0 });

  const p24 = sub.add_parser("update-rank-content", { help: "Update rank description" });
  p24.add_argument("--rank-id", { type: "int", required: true });
  const p24c = p24.add_mutually_exclusive_group({ required: true });
  p24c.add_argument("--content");
  p24c.add_argument("--content-file");

  const p22 = sub.add_parser("get-confirmed-defect-history", { help: "Query confirmed defect history" });
  p22.add_argument("--git", { required: true });
  p22.add_argument("--class-name");
  p22.add_argument("--git-file-path");
  p22.add_argument("--method-name");
  p22.add_argument("--start-time", { type: "int" });
  p22.add_argument("--end-time", { type: "int" });
  p22.add_argument("--fix-status");

  const p_dhbc = sub.add_parser("get-defect-history-by-commit", { help: "Query defect history by commit" });
  p_dhbc.add_argument("--git", { required: true });
  p_dhbc.add_argument("--dev-commit", { required: true });
  p_dhbc.add_argument("--class-name");
  p_dhbc.add_argument("--method-name");
  p_dhbc.add_argument("--start-time", { type: "int" });
  p_dhbc.add_argument("--end-time", { type: "int" });

  const p_sample = sub.add_parser("process-sample", { help: "Print a write-back sample" });
  p_sample.add_argument("--strategy", { type: "int", default: 11 });
  p_sample.add_argument("--bug-status", { type: "int", default: 2, choices: [2, 6, 7] });

  const p_rwc = sub.add_parser("resolve-writeback-context", { help: "Resolve write-back context" });
  p_rwc.add_argument("--task-id", { type: "int", required: true });
  p_rwc.add_argument("--class-name", { required: true });
  p_rwc.add_argument("--method-name");
  p_rwc.add_argument("--strategy-code", { type: "int" });

  const p6 = sub.add_parser("update-process", { help: "Write back a single conclusion" });
  p6.add_argument("--task-id", { type: "int" });
  p6.add_argument("--batch-id", { type: "int", required: true });
  p6.add_argument("--process-id", { type: "int" });
  p6.add_argument("--class-name", { required: true });
  p6.add_argument("--method-name");
  p6.add_argument("--bug-status", { type: "int", required: true, choices: [2, 6, 7] });
  p6.add_argument("--thinking", { required: true });
  p6.add_argument("--content");
  p6.add_argument("--confidence-score", { type: "float" });
  p6.add_argument("--evidence-summary");
  p6.add_argument("--rule-id");
  p6.add_argument("--strategy-code", { type: "int" });
  p6.add_argument("--tag-id");
  p6.add_argument("--git-file-path");
  p6.add_argument("--file-codes", { required: true });
  p6.add_argument("--process-steps", { required: true });
  p6.add_argument("--hit-rule-ids");
  p6.add_argument("--exclude-rule-ids");
  p6.add_argument("--ast-rule-count", { type: "int" });

  const p_batch = sub.add_parser("batch-update-process", { help: "Batch write-back" });
  p_batch.add_argument("--task-id", { type: "int" });
  p_batch.add_argument("--items-json", { required: true });

  const p_gwt = sub.add_parser("gen-writeback-template", { help: "Generate a write-back skeleton" });
  p_gwt.add_argument("--strategy-code", { type: "int", required: true });
  p_gwt.add_argument("--bug-status", { type: "int", required: true });
  p_gwt.add_argument("--task-id", { type: "int" });
  p_gwt.add_argument("--class-name");
  p_gwt.add_argument("--method-name");
  p_gwt.add_argument("--language", { help: "Code-fence / path language; defaults to the service language or the plan filePath" });

  const p_bnb = sub.add_parser("batch-no-bug", { help: "Batch no-defect write-back" });
  p_bnb.add_argument("--task-id", { type: "int", required: true });
  p_bnb.add_argument("--items-json", { required: true });
  p_bnb.add_argument("--strategy", { type: "int", default: 11 });
  p_bnb.add_argument("--batch-id", { type: "int", default: 0 });
  p_bnb.add_argument("--git");
  p_bnb.add_argument("--branch");
  p_bnb.add_argument("--commit");
  p_bnb.add_argument("--max-batch-size", { type: "int", default: 19 });
  p_bnb.add_argument("--ref-source-type", { default: "tech_doc" });
  p_bnb.add_argument("--ref-source-id");
  p_bnb.add_argument("--ref-source-name");
  p_bnb.add_argument("--exclude-patterns");
  p_bnb.add_argument("--output-dir");
  p_bnb.add_argument("--skip-code-read-check", { storeTrue: true });
  p_bnb.add_argument("--submit", { storeTrue: true });

  const p_rp = sub.add_parser("report-progress", { help: "Report progress" });
  p_rp.add_argument("--task-id", { type: "int", required: true });
  p_rp.add_argument("--percent", { type: "int", required: true });
  p_rp.add_argument("--phase");
  p_rp.add_argument("--step");
  p_rp.add_argument("--analyzed-count", { type: "int" });
  p_rp.add_argument("--total-count", { type: "int" });
  p_rp.add_argument("--defect-count", { type: "int" });
  p_rp.add_argument("--activity");
  p_rp.add_argument("--min-interval", { type: "int", default: 60 });
  p_rp.add_argument("--min-delta", { type: "int", default: 10 });
  p_rp.add_argument("--force", { storeTrue: true });

  const p_fa = sub.add_parser("finalize-all", { help: "One-shot Phase 3 finalize" });
  p_fa.add_argument("--task-id", { type: "int", required: true });
  p_fa.add_argument("--batch-ids");
  p_fa.add_argument("--summary");
  p_fa.add_argument("--summary-file", { dest: "summary_file" });

  const p25 = sub.add_parser("get-delivery-defects", { help: "Query submitted defects" });
  p25.add_argument("--plan-id", { type: "int", required: true });
  p25.add_argument("--plan-type", { type: "int", required: true, choices: [2, 4] });
  p25.add_argument("--page-no", { type: "int", default: 1 });
  p25.add_argument("--page-size", { type: "int", default: 100 });
  p25.add_argument("--task-id", { type: "int" });

  const p_tags = sub.add_parser("get-tag-list", { help: "Get tag list" });
  p_tags.add_argument("--task-id", { type: "int" }); // optional: persist tagIds into the task (like phase1-fetch-all)

  const p_p1fa = sub.add_parser("phase1-fetch-all", { help: "Phase 1 parallel data fetch" });
  p_p1fa.add_argument("--task-id", { type: "int", required: true });
  p_p1fa.add_argument("--git-url", { required: true });
  p_p1fa.add_argument("--user-id");
  p_p1fa.add_argument("--plan-id", { type: "int" });
  p_p1fa.add_argument("--batch-id", { type: "int" });

  const p_cad = sub.add_parser("clone-and-diff", { help: "clone + diff + register" });
  p_cad.add_argument("--task-id", { type: "int", required: true });
  p_cad.add_argument("--batch-id", { type: "int", required: true });
  p_cad.add_argument("--git-url", { required: true });
  p_cad.add_argument("--branch", { required: true });
  p_cad.add_argument("--service-key", { dest: "service_key" });
  p_cad.add_argument("--base-branch");
  p_cad.add_argument("--contrast-commit");
  p_cad.add_argument("--diff-mode", { choices: ["two-dot", "three-dot"], default: "two-dot" });
  p_cad.add_argument("--language");
  p_cad.add_argument("--with-plan", { storeTrue: true });
  p_cad.add_argument("--submit-trivial", { storeTrue: true });

  const p_gn = sub.add_parser("ensure-gitnexus", { help: "Detect/install GitNexus" });
  p_gn.add_argument("--task-id", { type: "int" });
  p_gn.add_argument("--local-dir");
  p_gn.add_argument("--no-analyze", { storeTrue: true });
  p_gn.add_argument("--force-install", { storeTrue: true });

  const p_gni = sub.add_parser("gitnexus-impact", { help: "GitNexus impact" });
  p_gni.add_argument("--task-id", { type: "int" });
  p_gni.add_argument("--local-dir");
  p_gni.add_argument("--target", { required: true });
  p_gni.add_argument("--direction", { choices: ["upstream", "downstream"], default: "upstream" });
  p_gni.add_argument("--depth", { type: "int", default: 3 });

  const p_gnc = sub.add_parser("gitnexus-context", { help: "GitNexus context" });
  p_gnc.add_argument("--task-id", { type: "int" });
  p_gnc.add_argument("--local-dir");
  p_gnc.add_argument("--name");
  p_gnc.add_argument("--file");
  p_gnc.add_argument("--content", { storeTrue: true });

  const p_gnq = sub.add_parser("gitnexus-query", { help: "GitNexus query" });
  p_gnq.add_argument("--task-id", { type: "int" });
  p_gnq.add_argument("--local-dir");
  p_gnq.add_argument("--query", { required: true });
  p_gnq.add_argument("--limit", { type: "int", default: 5 });

  const p_rrc = sub.add_parser("register-repo-clone", { help: "Register a repo clone" });
  p_rrc.add_argument("--task-id", { type: "int", required: true });
  p_rrc.add_argument("--batch-id", { type: "int", required: true });
  p_rrc.add_argument("--git-url", { required: true });
  p_rrc.add_argument("--local-dir", { required: true });
  p_rrc.add_argument("--branch", { required: true });
  p_rrc.add_argument("--commit-id", { default: "" });
  p_rrc.add_argument("--language");

  const p_ready = sub.add_parser("check-phase2-readiness", { help: "Phase 2 readiness check" });
  p_ready.add_argument("--task-id", { type: "int", required: true });

  const p_rcr = sub.add_parser("register-code-read", { help: "Register a code read" });
  p_rcr.add_argument("--task-id", { type: "int", required: true });
  p_rcr.add_argument("--batch-id", { type: "int", required: true });
  p_rcr.add_argument("--class-name", { required: true });
  p_rcr.add_argument("--file-path");
  p_rcr.add_argument("--code-snippet", { default: "" });

  const p_rmc = sub.add_parser("read-method-code", { help: "Read method code" });
  p_rmc.add_argument("--task-id", { type: "int", required: true });
  p_rmc.add_argument("--batch-id", { type: "int", required: true });
  p_rmc.add_argument("--class-name", { required: true });
  p_rmc.add_argument("--method-name", { default: "" });
  p_rmc.add_argument("--local-dir", { required: true });

  const p_crs = sub.add_parser("code-read-stats", { help: "Code-read statistics" });
  p_crs.add_argument("--task-id", { type: "int", required: true });
  p_crs.add_argument("--batch-id", { type: "int", required: true });

  const p_tmf = sub.add_parser("trivial-method-filter", { help: "Pre-filter trivial methods" });
  p_tmf.add_argument("--task-id", { type: "int" });
  p_tmf.add_argument("--methods");
  p_tmf.add_argument("--methods-file");
  p_tmf.add_argument("--submit", { storeTrue: true });

  const p_inv = sub.add_parser("invalid-record", { help: "Invalidate a rank" });
  p_inv.add_argument("--rank-ids", { required: true });

  const p26 = sub.add_parser("show-local-progress", { help: "Local progress" });
  p26.add_argument("--task-id", { type: "int", required: true });

  const p_cleanup = sub.add_parser("cleanup-stale-data", { help: "Clean up stale data" });
  p_cleanup.add_argument("--max-age-hours", { type: "int", default: 48 });
  p_cleanup.add_argument("--dry-run", { storeTrue: true });
  p_cleanup.add_argument("--scrub-only", { storeTrue: true });

  const p_c0 = sub.add_parser("init-content", { help: "Initialize content" });
  p_c0.add_argument("--task-id", { type: "int", required: true });
  p_c0.add_argument("--test-plan-id", { type: "int" });
  p_c0.add_argument("--plan-name");
  p_c0.add_argument("--user-id");
  p_c0.add_argument("--git-url", { dest: "git_url" });
  p_c0.add_argument("--branch");

  const p_c1 = sub.add_parser("add-service-to-content", { help: "Add a service" });
  p_c1.add_argument("--task-id", { type: "int", required: true });
  p_c1.add_argument("--git-url", { required: true });
  p_c1.add_argument("--branch", { required: true });
  p_c1.add_argument("--service-key", { dest: "service_key" });
  p_c1.add_argument("--batch-ids");
  p_c1.add_argument("--module-prefix");
  p_c1.add_argument("--language", { help: "java|kotlin|scala|javascript|typescript|python|go|c|cpp|csharp; omit to detect from changed files" });

  const p_c2 = sub.add_parser("update-service-in-content", { help: "Update a service" });
  p_c2.add_argument("--task-id", { type: "int", required: true });
  p_c2.add_argument("--git-url", { required: true });
  p_c2.add_argument("--commit-id");
  p_c2.add_argument("--local-dir");
  p_c2.add_argument("--append-batch-id", { type: "int" });
  p_c2.add_argument("--verified", { storeTrue: true });
  p_c2.add_argument("--module-prefix");

  const p_c3 = sub.add_parser("set-diff-files", { help: "Set diff.files" });
  p_c3.add_argument("--task-id", { type: "int", required: true });
  p_c3.add_argument("--files-json", { required: true });

  const p_c4 = sub.add_parser("set-changed-methods", { help: "Set changed methods" });
  p_c4.add_argument("--task-id", { type: "int", required: true });
  p_c4.add_argument("--class-name", { required: true });
  p_c4.add_argument("--methods-json", { required: true });

  const p_c5 = sub.add_parser("set-meta-field", { help: "Set a meta field" });
  p_c5.add_argument("--task-id", { type: "int", required: true });
  p_c5.add_argument("--key", { required: true });
  p_c5.add_argument("--value", { required: true });

  const p_c6 = sub.add_parser("set-doc-summary", { help: "Set the doc-summary path" });
  p_c6.add_argument("--task-id", { type: "int", required: true });
  p_c6.add_argument("--path", { required: true });

  const p_c7 = sub.add_parser("add-document", { help: "Add a document" });
  p_c7.add_argument("--task-id", { type: "int", required: true });
  p_c7.add_argument("--doc-type", { required: true, choices: ["techDocs", "prdDocs", "requirementDocs", "technicalDocs"] });
  p_c7.add_argument("--doc-json", { required: true });

  const p_scan = sub.add_parser("scan-repo-docs", { help: "Scan repo documents" });
  p_scan.add_argument("--task-id", { type: "int", required: true });

  const p_c8 = sub.add_parser("add-test-case", { help: "Add a test case" });
  p_c8.add_argument("--task-id", { type: "int", required: true });
  p_c8.add_argument("--case-json", { required: true });

  const p_c9 = sub.add_parser("add-detection-plan-item", { help: "Add a detection-plan item" });
  p_c9.add_argument("--task-id", { type: "int", required: true });
  p_c9.add_argument("--item-json", { required: true });

  const p_c10 = sub.add_parser("add-cross-repo-class", { help: "Record a cross-repo class" });
  p_c10.add_argument("--task-id", { type: "int", required: true });
  p_c10.add_argument("--class-name", { required: true });
  p_c10.add_argument("--info-json", { required: true });

  const p_c11 = sub.add_parser("record-process-writeback", { help: "Record a process write-back" });
  p_c11.add_argument("--task-id", { type: "int", required: true });
  p_c11.add_argument("--record-json", { required: true });

  const p_c12 = sub.add_parser("update-plan-status", { help: "Update plan status" });
  p_c12.add_argument("--task-id", { type: "int", required: true });
  p_c12.add_argument("--class-name", { required: true });
  p_c12.add_argument("--method-name", { required: true });
  p_c12.add_argument("--strategy-code", { type: "int", required: true });
  p_c12.add_argument("--status", { required: true, choices: ["pending", "analyzed", "written"] });

  const p_c13 = sub.add_parser("set-plan-ast-result", { help: "Cache an AST result" });
  p_c13.add_argument("--task-id", { type: "int", required: true });
  p_c13.add_argument("--class-name", { required: true });
  p_c13.add_argument("--method-name", { required: true });
  p_c13.add_argument("--result-json", { required: true });

  const p_c14 = sub.add_parser("record-rank", { help: "Record a rank" });
  p_c14.add_argument("--task-id", { type: "int", required: true });
  p_c14.add_argument("--rank-json", { required: true });

  const p_c15 = sub.add_parser("content-summary", { help: "Content summary" });
  p_c15.add_argument("--task-id", { type: "int", required: true });

  const p_ctx = sub.add_parser("register-context-read", { help: "Register a context read" });
  p_ctx.add_argument("--task-id", { type: "int", required: true });
  p_ctx.add_argument("--batch-id", { type: "int", required: true });
  p_ctx.add_argument("--class-name", { required: true });
  p_ctx.add_argument("--file-path", { required: true });
  p_ctx.add_argument("--purpose", { default: "dependency", choices: ["caller", "dependency", "config", "upstream", "downstream"] });
  p_ctx.add_argument("--lines-read", { type: "int" });

  const p_rf = sub.add_parser("register-finding", { help: "Record a finding" });
  p_rf.add_argument("--task-id", { type: "int", required: true });
  p_rf.add_argument("--phase", { required: true, choices: ["prep", "analysis"] });
  p_rf.add_argument("--category", { required: true, choices: ["gap", "risk", "change", "insight", "cross-view"] });
  p_rf.add_argument("--text", { required: true });
  p_rf.add_argument("--source");

  const p_gf = sub.add_parser("get-findings", { help: "Get findings" });
  p_gf.add_argument("--task-id", { type: "int", required: true });
  p_gf.add_argument("--phase", { choices: ["prep", "analysis"] });
  p_gf.add_argument("--category", { choices: ["gap", "risk", "change", "insight", "cross-view"] });

  const p_crc = sub.add_parser("check-req-coverage", { help: "Requirement coverage check" });
  p_crc.add_argument("--task-id", { type: "int", required: true });

  const p_cvc = sub.add_parser("cross-view-check", { help: "Cross-view check" });
  p_cvc.add_argument("--task-id", { type: "int", required: true });

  const p_caq = sub.add_parser("check-analysis-quality", { help: "Analysis quality gate" });
  p_caq.add_argument("--task-id", { type: "int", required: true });

  const p_gcm = sub.add_parser("get-changed-methods", { help: "Extract changed methods" });
  p_gcm.add_argument("--task-id", { type: "int", required: true });
  p_gcm.add_argument("--local-dir", { required: true });
  p_gcm.add_argument("--diff-files");
  p_gcm.add_argument("--base-rev");
  p_gcm.add_argument("--diff-mode", { choices: ["two-dot", "three-dot"] });

  const p_bdp = sub.add_parser("build-detection-plan", { help: "Build the detection plan" });
  p_bdp.add_argument("--task-id", { type: "int", required: true });
  p_bdp.add_argument("--batch-ids");

  const p_pap = sub.add_parser("prep-and-plan", { help: "changed methods + plan + trivial filter" });
  p_pap.add_argument("--task-id", { type: "int", required: true });
  p_pap.add_argument("--local-dir");
  p_pap.add_argument("--batch-ids");
  p_pap.add_argument("--diff-files");
  p_pap.add_argument("--base-rev");
  p_pap.add_argument("--diff-mode", { choices: ["two-dot", "three-dot"] });
  p_pap.add_argument("--submit-trivial", { storeTrue: true });

  const p_vlmm = sub.add_parser("verify-line-method-mapping", { help: "Verify line-to-method mapping" });
  p_vlmm.add_argument("--task-id", { type: "int", required: true });
  p_vlmm.add_argument("--class-name", { required: true });
  p_vlmm.add_argument("--method-name", { required: true });
  p_vlmm.add_argument("--content", { required: true });
  p_vlmm.add_argument("--local-dir");

  const p_erfd = sub.add_parser("extract-rules-from-docs", { help: "Extract rules from documents" });
  p_erfd.add_argument("--task-id", { type: "int", required: true });
  p_erfd.add_argument("--doc-summary-path");

  const p_p1i = sub.add_parser("phase1-init", { help: "Phase 1 one-shot init" });
  p_p1i.add_argument("--plan-id", { type: "int", required: true });
  p_p1i.add_argument("--plan-type", { type: "int", default: 2, choices: [2, 4] });
  p_p1i.add_argument("--submit-user", { required: true });
  p_p1i.add_argument("--plan-name");
  p_p1i.add_argument("--services-json");
  p_p1i.add_argument("--git");
  p_p1i.add_argument("--branch");
  p_p1i.add_argument("--user-materials-json");
  p_p1i.add_argument("--strategy-codes");

  const p_tcfb = sub.add_parser("fetch-test-cases", { help: "Fallback test-case fetch" });
  p_tcfb.add_argument("--task-id", { type: "int", required: true });
  p_tcfb.add_argument("--plan-id", { type: "int", required: true });

  const p_tcp = sub.add_parser("testcase-pipeline", { help: "Test-case DAG" });
  p_tcp.add_argument("--task-id", { type: "int", required: true });
  p_tcp.add_argument("--plan-id", { type: "int", required: true });

  const p_fer = sub.add_parser("run-frontend-rules", { help: "Frontend-specific rules" });
  p_fer.add_argument("--diff-files");

  // Historically some commands took --git and others --git-url. Accept both everywhere
  // (same dest, so handlers are untouched) — agents and humans kept tripping on this.
  for (const sub of parser.subparsers) {
    for (const a of sub.args) {
      if (a.flags.includes("--git") && !a.flags.includes("--git-url")) a.flags.push("--git-url");
      else if (a.flags.includes("--git-url") && !a.flags.includes("--git")) a.flags.push("--git");
    }
  }
  return parser;
}

const CMD_MAP: Record<string, (args: Record<string, any>) => void> = {
  "submit-plan": cmd_submit_plan,
  "submit-git": cmd_submit_git,
  "submit-skill-direct": cmd_submit_skill_direct,
  "status": cmd_status,
  "get-plan-info": cmd_get_plan_info,
  "check-materials": cmd_check_materials,
  "extract-client-plan-info": cmd_extract_client_plan_info,
  "get-pending": cmd_get_pending,
  "check-coverage": cmd_check_coverage,
  "get-rules": cmd_get_rules,
  "process-sample": cmd_process_sample,
  "resolve-writeback-context": cmd_resolve_writeback_context,
  "update-process": cmd_update_process,
  "list-my-tasks": cmd_list_my_tasks,
  "retry": cmd_retry,
  "get-report": cmd_get_report,
  "reconcile-report": cmd_reconcile_report,
  "check-rank-integrity": cmd_check_rank_integrity,
  "finalize-rank": cmd_finalize_rank,
  "complete-task": cmd_complete_task,
  "validate-summary": cmd_validate_summary,
  "update-summary": cmd_update_summary,
  "force-abort-task": cmd_force_abort_task,
  "skip-service-batch": cmd_skip_service_batch,
  "get-detection-flow": cmd_get_detection_flow,
  "get-detection-flow-by-rank": cmd_get_detection_flow_by_rank,
  "mark-bug": cmd_mark_bug,
  "get-exception-traces": cmd_get_exception_traces,
  "get-detection-records": cmd_get_detection_records,
  "create-issue": cmd_create_issue,
  "get-confirmed-defect-history": cmd_get_confirmed_defect_history,
  "get-defect-history-by-commit": cmd_get_defect_history_by_commit,
  "run-ast-scan": cmd_run_ast_scan,
  "run-optional-overlays": cmd_run_optional_overlays,
  "batch-dismiss-by-strategy": cmd_batch_dismiss_by_strategy,
  "dismiss-class": cmd_dismiss_class,
  "update-rank-content": cmd_update_rank_content,
  "get-delivery-defects": cmd_get_delivery_defects,
  "batch-update-process": cmd_batch_update_process,
  "gen-writeback-template": cmd_gen_writeback_template,
  "batch-no-bug": cmd_batch_no_bug,
  "report-progress": cmd_report_progress,
  "finalize-all": cmd_finalize_all,
  "show-local-progress": cmd_show_local_progress,
  "cleanup-stale-data": cmd_cleanup_stale_data,
  "clone-and-diff": cmd_clone_and_diff,
  "ensure-gitnexus": cmd_ensure_gitnexus,
  "gitnexus-impact": cmd_gitnexus_impact,
  "gitnexus-context": cmd_gitnexus_context,
  "gitnexus-query": cmd_gitnexus_query,
  "register-repo-clone": cmd_register_repo_clone,
  "check-phase2-readiness": cmd_check_phase2_readiness,
  "register-code-read": cmd_register_code_read,
  "code-read-stats": cmd_code_read_stats,
  "trivial-method-filter": cmd_trivial_method_filter,
  "get-tag-list": cmd_get_tag_list,
  "phase1-fetch-all": cmd_phase1_fetch_all,
  "read-method-code": cmd_read_method_code,
  "invalid-record": cmd_invalid_record,
  "init-content": cmd_init_content,
  "add-service-to-content": cmd_add_service_to_content,
  "update-service-in-content": cmd_update_service_in_content,
  "set-diff-files": cmd_set_diff_files,
  "set-changed-methods": cmd_set_changed_methods,
  "set-meta-field": cmd_set_meta_field,
  "set-doc-summary": cmd_set_doc_summary,
  "add-document": cmd_add_document,
  "scan-repo-docs": cmd_scan_repo_docs,
  "add-test-case": cmd_add_test_case,
  "add-detection-plan-item": cmd_add_detection_plan_item,
  "add-cross-repo-class": cmd_add_cross_repo_class,
  "record-process-writeback": cmd_record_process_writeback,
  "update-plan-status": cmd_update_plan_status,
  "set-plan-ast-result": cmd_set_plan_ast_result,
  "record-rank": cmd_record_rank,
  "content-summary": cmd_content_summary,
  "register-context-read": cmd_register_context_read,
  "register-finding": cmd_register_finding,
  "get-findings": cmd_get_findings,
  "check-req-coverage": cmd_check_req_coverage,
  "cross-view-check": cmd_cross_view_check,
  "check-analysis-quality": cmd_check_analysis_quality,
  "get-changed-methods": cmd_get_changed_methods,
  "build-detection-plan": cmd_build_detection_plan,
  "prep-and-plan": cmd_prep_and_plan,
  "verify-line-method-mapping": cmd_verify_line_method_mapping,
  "extract-rules-from-docs": cmd_extract_rules_from_docs,
  "phase1-init": cmd_phase1_init,
  "fetch-test-cases": cmd_fetch_test_cases_fallback,
  "run-frontend-rules": cmd_run_frontend_rules,
  "testcase-pipeline": cmd_testcase_pipeline,
};

function main(): void {
  const parser = build_parser();
  const args = parser.parse_args();
  if (args.token) set_token(args.token);
  // --summary-file is sugar for --summary: summaries contain emoji and line breaks
  // that are painful to pass through a shell, so allow reading them from a file.
  if (args.summary_file && !args.summary) {
    try {
      args.summary = readFileSync(args.summary_file, "utf8").trim();
    } catch (e: any) {
      console.error(`[${args.cmd}] ❌ cannot read --summary-file ${args.summary_file}: ${e.message}`);
      process.exit(1);
    }
  }
  if (["validate-summary", "update-summary"].includes(args.cmd) && !args.summary) {
    console.error(`[${args.cmd}] ❌ one of --summary / --summary-file is required`);
    process.exit(1);
  }
  const handler = CMD_MAP[args.cmd];
  if (handler) handler(args);
  else {
    parser.print_help();
    process.exit(1);
  }
}

try {
  main();
} catch (e: any) {
  if (e instanceof AuthenticationError) {
    console.log(JSON.stringify({ _error: String(e.message), code: -1, type: "auth_failed" }));
    process.exit(1);
  }
  throw e;
}
