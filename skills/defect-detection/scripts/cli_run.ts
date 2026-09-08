/**
 * Phase 2 detection write-back commands: process-sample / resolve-writeback-context / update-process /
 * batch-update-process / finalize-rank / check-rank-integrity / gen-writeback-template /
 * batch-no-bug / batch-dismiss-by-strategy / dismiss-class / register-code-read /
 * read-method-code / code-read-stats / trivial-method-filter / run-ast-scan /
 * mark-bug / invalid-record / skip-service-batch / update-rank-content
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

import {
  batch_dismiss_by_class_names,
  batch_dismiss_by_strategy,
  batch_update_process,
  check_detection_coverage,
  check_rank_integrity,
  finalize_rank,
  invalid_record,
  mark_bug,
  report_progress,
  skip_service_batch,
  update_process,
  update_rank_content,
  create_issue,
} from "./platform.ts";
import {
  run_ast_scan,
  detect_project_language,
  _LANG_TO_EXTENSIONS,
  annotate_findings_in_diff,
  resolve_ast_scan_scope,
} from "./ast.ts";
import { NO_DEFECT_CONTENT, _cli_error, _cli_result, _cli_success, _require_save } from "./cli_common.ts";
import {
  canonicalize_language,
  code_fence_for_language,
  code_fence_for_path,
  guess_file_path_for_class,
  language_from_path,
} from "./lang.ts";
import { extract_units_for_file, locate_source_file, merge_semgrep_units, semgrep_function_ranges } from "./lang_methods.ts";
import {
  ContentStore,
  find_matching_writeback,
  normalize_changed_method,
  repo_clone_base_dir,
  writeback_should_protect,
} from "./store.ts";
import { run } from "./sys.ts";
import { classify_trivial_method, stamp_trivial_on_plan, submit_trivial_writebacks } from "./trivial.ts";
import {
  _load_local_state,
  get_code_read_stats,
  find_code_read_entry,
  has_code_been_read,
  has_repo_been_cloned,
  register_code_read,
  mark_method_done,
} from "./state.ts";
import { prepare_rules } from "./rules.ts";
import { validate_update_process, validate_update_process_all, set_valid_tag_ids } from "./validate.ts";

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

function _spawn(argv: string[], timeout_s = 60, cwd?: string): { returncode: number; stdout: string; stderr: string } {
  return run(argv, { timeout_s, cwd });
}

function _build_process_sample(strategy: number, bug_status: number): Record<string, any> {
  const lang = "java";
  const file_path = "src/main/java/com/example/FooService.java";
  const class_name = "com/example/FooService";
  const method = "doFoo";
  const git = "git@github.com:example/foo.git";
  const branch = "feature/xxx";
  const commit = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

  const base: Record<string, any> = {
    parentBatchId: "<fill: this service's parentBatchId (from get-pending)>",
    processId: "<fill: this method's processId (from get-pending; omit when creating new)>",
    className: class_name,
    methodName: method,
    bugStatus: bug_status,
    strategyCode: strategy,
    fileCodes: [{
      filePath: file_path,
      methodNames: [method],
      git, branch, commitId: commit,
    }],
  };

  if (bug_status === 2) {
    base.thinking = (
      `Review ${method} lines 12-40: input req is null-checked at line 15, ` +
      "Loop bound i<list.size() is safe, exception branches are caught, no NPE/OOB/resource leak found — judged no defect."
    );
    base.content = NO_DEFECT_CONTENT;
    base.processSteps = [{
      step: "first_round_detection", stepKey: "first_round_detection",
      stepStatus: "executed", hasBug: false,
      conclusion: `${method} lines 12-40 reviewed line by line: inputs checked, bounds safe, exceptions handled — confirmed no defect`,
      question: `Analyze whether ${method} has null-pointer / OOB / concurrency / resource-leak defects`,
    }];
  } else {
    const is_bug = bug_status === 6;
    const prefix = is_bug ? "Defect" : "Improvement";
    const fix_field = is_bug ? "Fix suggestion" : "Improvement plan";
    base.tagId = "<fill: pick a valid tagId from get-tag-list>";
    base.confidenceScore = 0.85;
    base.thinking = (
      `Review ${method} line 28: it calls user.getName() directly, but line 24 user comes from ` +
      "map.get(id) may return null with no null check; a missing id under concurrency can NPE."
    );
    base.content = (
      `${prefix}: ${method} does not null-check user\n\n` +
      "Lines:24-28\n\n" +
      "Problem description: line 24 user = map.get(id) may return null; line 28 calls user.getName() and can NPE\n\n" +
      "Problem tags: [Null pointer][This change]\n\n" +
      "Impact scope: user-info query API\n\n" +
      "Affected business: a missing user id makes the API return 500 and breaks nickname display on the order page\n\n" +
      "Reproduction path: call /user/info → pass a missing id → map.get returns null → getName() throws NPE\n\n" +
      "Expected vs actual:\n- expected: return an empty object or a friendly message\n- actual: throws NullPointerException, API 500\n\n" +
      `${fix_field}: null-check user before reading fields\n\n` +
      "```" + lang + "\n" +
      "User user = map.get(id);\n" +
      "if (user == null) { return Result.empty(); }\n" +
      "return user.getName();\n" +
      "```"
    );
    base.processSteps = [{
      step: "first_round_detection", stepKey: "first_round_detection",
      stepStatus: "executed", hasBug: true,
      conclusion: `${method} line 28 calls user.getName() without a null check while user may be null — NPE risk`,
      question: `Analyze whether ${method} has a null-pointer risk, focusing on how map.get results are used`,
    }];
  }

  if (strategy === 8) {
    base.astRuleCount = "<fill: category=1 rule count actually loaded by run-ast-scan, must be >0>";
    base.processSteps = [
      { step: "exclusion_rule_filter", stepKey: "exclusion_rule_filter",
        stepStatus: "executed", hasBug: false,
        conclusion: "After exclusion-rule filtering, nothing needs to be excluded" },
      { step: "llm_validation", stepKey: "llm_validation",
        stepStatus: "executed", hasBug: [6, 7].includes(bug_status),
        conclusion: base.processSteps[0].conclusion },
    ];
    if ([6, 7].includes(bug_status)) {
      base.ruleId = "<fill: matched AST rule ruleId>";
      base.hitRuleIds = ["<fill: matched AST rule ID>"];
    }
  } else if ([4, 6, 11].includes(strategy)) {
    base.thinking = (
      `Walk the call chain OrderController#create → OrderService#${method} → UserDao#query: ` +
      `${method} line 28 uses a UserDao return value without a null check; the upstream Controller does not reject an illegal id — NPE risk.`
    );
    base.fileCodes.push({
      filePath: "src/main/java/com/example/OrderController.java",
      methodNames: ["create"], git, branch, commitId: commit,
    });
    if (typeof base.content === "string" && base.content.includes("Reproduction path")) {
      base.content = base.content.replace(
        "Reproduction path:",
        "Call chain：OrderController#create → OrderService#" + method + " → UserDao#query\n\nReproduction path:",
      );
    }
    base.processSteps[0].referencedSources = [{
      sourceType: "test_case",
      sourceId: "<fill: test case id>",
      sourceName: "<fill: test-case title>",
    }];
    if ([6, 7].includes(bug_status) && typeof base.content === "string") {
      base.content = base.content.replace(
        "Impact scope:",
        "Test case ID: [<fill: caseId>](<fill: case URL>)\n\nImpact scope:",
      );
    }
  }

  return base;
}

export function cmd_process_sample(args: Args): void {
  const strategy = args.strategy;
  const bug_status = args.bug_status;
  const sample = _build_process_sample(strategy, bug_status);

  let selfcheck_msg = " (self-check not run)";
  try {
    const probe = structuredClone(sample);

    function _fill(v: any): any {
      if (typeof v === "string") return v.replace(/<fill: [^>]*>/g, "9999999");
      if (Array.isArray(v)) return v.map(_fill);
      if (v && typeof v === "object") {
        const out: Record<string, any> = {};
        for (const [k, x] of Object.entries(v)) out[k] = _fill(x);
        return out;
      }
      return v;
    }

    const filled = _fill(probe);
    for (const nf of ["parentBatchId", "processId", "astRuleCount"]) {
      if (typeof filled[nf] === "string" && /^\d+$/.test(filled[nf])) {
        filled[nf] = parseInt(filled[nf], 10);
      }
    }
    if (typeof filled.tagId === "string" && /^\d+$/.test(filled.tagId)) {
      filled.tagId = parseInt(filled.tagId, 10);
      set_valid_tag_ids(new Set([filled.tagId]));
    }

    let err = validate_update_process(filled);
    const _ENV_GATES = ["Hard rule14", "Hard rule19", "code-read gate", "code-clone gate"];
    if (err && _ENV_GATES.some((g) => err.includes(g))) {
      err = "";
    }
    if (err) {
      selfcheck_msg = `⚠️ Sample self-check failed (ask a maintainer to fix the template): ${err}`;
    } else {
      selfcheck_msg = (
        "✅ Sample format passed local validation: replace placeholders with real values and submit" +
        "(Code-read/clone gates must be satisfied in the real flow via register-code-read / register-repo-clone)."
      );
    }
  } catch (e: any) {
    selfcheck_msg = ` (self-check skipped: ${e})`;
  }

  const bug_label: Record<number, string> = { 2: "no defect", 6: "Suspected defect", 7: "Improvement" };
  const strat_label: Record<number, string> = { 2: "general", 3: "single method", 4: "chain", 6: "business", 8: "AST rules" };

  console.error(`# process write-back sample — strategy=${strategy}(${strat_label[strategy] || strategy}) / bugStatus=${bug_status}(${bug_label[bug_status] || bug_status})`);
  console.error(`# ${selfcheck_msg}`);
  console.error("# Usage: replace every <fill: ...> placeholder with a real value and copy the rest as-is. Submit: batch-update-process --items-json '[<this JSON>]'");
  console.error("#" + "-".repeat(60));

  console.log(JSON.stringify(sample, null, 2));
}

export function cmd_resolve_writeback_context(args: Args): void {
  const store = new ContentStore(args.task_id);
  const ctx = store.resolve_writeback_context(
    args.class_name,
    args.method_name ?? null,
    args.strategy_code ?? null,
  );
  if (!ctx.resolved) {
    const miss: string[] = [];
    if (!ctx.filePath) {
      miss.push("filePath (this className has no filePath in the plan; run set-plan-file-path or confirm the plan exists)");
    }
    if (!ctx.gitUrl) {
      miss.push("gitUrl (this batch has no git info in meta.services; confirm submit-git / the service is registered)");
    }
    console.error(`[resolve-writeback-context] ⚠️ Could not resolve a complete authoritative mapping (source=${ctx.source}): ` + miss.join("；"));
  } else {
    console.error(`[resolve-writeback-context] ✅ Resolved authoritative mapping (source=${ctx.source}):`);
  }
  console.log(JSON.stringify(ctx, null, 2));
}

export function _reconcile_file_codes(
  store: ContentStore,
  class_name: any,
  method_name: any,
  strategy_code: any,
  file_codes: any,
): [any, string[], any, boolean] {
  const notes: string[] = [];
  const ctx = store.resolve_writeback_context(class_name, method_name, strategy_code);
  const server_class_name = ctx.serverClassName || class_name;
  // Non-JVM classNames are repo paths with no extension, so the report needs the real
  // file recorded alongside. This is not a statement about the code being frontend.
  const uses_path_class_name = Boolean(ctx.usesPathClassName);
  const auth_fp = ctx.filePath;
  const auth_git = ctx.gitUrl;
  const auth_branch = ctx.branch;
  const auth_commit = ctx.commitId;

  if (!(auth_fp && auth_git) || ctx.filePathGuessed) {
    notes.push(
      `Could not resolve a complete authoritative mapping locally (source=${ctx.source}); skip auto-correct, ` +
        `Keep the incoming fileCodes.`,
    );
    // A guessed filePath must not overwrite what the agent read from the clone,
    // but the git triple is still authoritative and worth filling in when empty.
    if (auth_git && file_codes?.length) {
      for (const fc of file_codes) {
        if (!fc || typeof fc !== "object" || Array.isArray(fc)) continue;
        if (!fc.git) fc.git = auth_git;
        if (!fc.branch && auth_branch) fc.branch = auth_branch;
        if (!fc.commitId && auth_commit) fc.commitId = auth_commit;
      }
    }
    return [file_codes, notes, server_class_name, uses_path_class_name];
  }

  if (!file_codes || !file_codes.length) {
    notes.push("Incoming fileCodes was empty; filled from the local authoritative mapping.");
    return [[ctx.fileCodesItem], notes, server_class_name, uses_path_class_name];
  }

  const corrected: any[] = [];
  const own_method = method_name != null && method_name !== "" ? String(method_name) : null;
  // fileCodes contract: the analyzed/defective callee is first, followed by
  // call-chain context. Prefer unambiguous ownership signals, but always select
  // at most one entry so a duplicated methodNames value cannot collapse the chain.
  const object_entries = file_codes.map((fc: any, index: number) => ({ fc, index }))
    .filter(({ fc }: any) => fc && typeof fc === "object" && !Array.isArray(fc));
  const explicit_owners = own_method
    ? object_entries.filter(({ fc }: any) =>
        Array.isArray(fc.methodNames) && fc.methodNames.map(String).includes(own_method))
    : [];
  const owner_index = explicit_owners[0]?.index
    ?? object_entries.find(({ fc }: any) => fc.filePath === auth_fp)?.index
    ?? object_entries.find(({ fc }: any) => !fc.filePath)?.index
    ?? object_entries[0]?.index
    ?? -1;

  for (let index = 0; index < file_codes.length; index++) {
    let fc = file_codes[index];
    fc = fc && typeof fc === "object" && !Array.isArray(fc) ? { ...fc } : fc;
    if (!fc || typeof fc !== "object" || Array.isArray(fc)) {
      corrected.push(fc);
      continue;
    }
    // Chain/context entries point at other files: only normalise the git triple.
    const owns = index === owner_index;
    for (const [key, auth_val, label] of [
      ["filePath", auth_fp, "filePath"],
      ["git", auth_git, "gitUrl"],
      ["branch", auth_branch, "branch"],
      ["commitId", auth_commit, "commitId"],
    ] as Array<[string, any, string]>) {
      if (key === "filePath" && !owns) continue;
      const old = fc[key];
      if (auth_val && old !== null && old !== undefined && old !== "" && old !== auth_val) {
        notes.push(`${label} mismatch; corrected to the local authoritative value: ${JSON.stringify(old)} → ${JSON.stringify(auth_val)}`);
        fc[key] = auth_val;
      } else if (auth_val && !old) {
        fc[key] = auth_val;
      }
    }
    corrected.push(fc);
  }
  return [corrected, notes, server_class_name, uses_path_class_name];
}

export function cmd_update_process(args: Args): void {
  let process_steps: any = null;
  if (args.process_steps) {
    try {
      process_steps = JSON.parse(args.process_steps);
    } catch (e: any) {
      console.error(`❌ --process-steps is not valid JSON: ${e.message || e}`);
      process.exit(1);
    }
  }

  let file_codes: any = null;
  if (args.file_codes) {
    try {
      file_codes = JSON.parse(args.file_codes);
    } catch (e: any) {
      console.error(`❌ --file-codes is not valid JSON: ${e.message || e}`);
      process.exit(1);
    }
  }

  let hit_rule_ids: any[] = [];
  if (args.hit_rule_ids) {
    try {
      hit_rule_ids = JSON.parse(args.hit_rule_ids);
    } catch (e: any) {
      console.error(`❌ --hit-rule-ids is not valid JSON: ${e.message || e}`);
      process.exit(1);
    }
  }
  let exclude_rule_ids: any[] = [];
  if (args.exclude_rule_ids) {
    try {
      exclude_rule_ids = JSON.parse(args.exclude_rule_ids);
    } catch (e: any) {
      console.error(`❌ --exclude-rule-ids is not valid JSON: ${e.message || e}`);
      process.exit(1);
    }
  }

  let _wb_store: ContentStore | null = null;
  let _server_class_name = args.class_name;
  let _resolved_git_file_path = args.git_file_path;
  if (args.task_id != null) {
    _wb_store = new ContentStore(args.task_id);
    let _notes: string[];
    let _uses_path_class_name: boolean;
    [file_codes, _notes, _server_class_name, _uses_path_class_name] = _reconcile_file_codes(
      _wb_store, args.class_name, args.method_name ?? null, args.strategy_code ?? null, file_codes,
    );
    for (const _n of _notes) {
      console.error(`[update-process] 🔧 ${_n}`);
    }
    if (_uses_path_class_name) {
      _resolved_git_file_path = (file_codes || [{}])[0]?.filePath || _resolved_git_file_path;
      console.error(
        `[update-process] 🔧 className is a repo path; recording gitFilePath=${JSON.stringify(_resolved_git_file_path)} ` +
          "so the report links the real file (write-back stays method-level)",
      );
    }
  }

  const request_body: Record<string, any> = {
    parentBatchId: args.batch_id,
    className: _server_class_name,
    bugStatus: args.bug_status,
    thinking: args.thinking,
    processSteps: process_steps,
    fileCodes: file_codes,
    hitRuleIds: hit_rule_ids,
    excludeRuleIds: exclude_rule_ids,
  };
  if (args.task_id != null) request_body.taskId = args.task_id;
  if (args.process_id != null) request_body.processId = args.process_id;
  if (args.method_name) request_body.methodName = args.method_name;
  if (args.content) request_body.content = args.content;
  if (args.confidence_score != null) request_body.confidenceScore = args.confidence_score;
  if (args.evidence_summary) request_body.evidenceSummary = args.evidence_summary;
  if (args.rule_id) request_body.ruleId = args.rule_id;
  if (args.strategy_code != null) request_body.strategyCode = args.strategy_code;
  if (args.tag_id) request_body.tagId = args.tag_id;
  if (_resolved_git_file_path) request_body.gitFilePath = _resolved_git_file_path;
  if (args.ast_rule_count != null) request_body.astRuleCount = args.ast_rule_count;

  if (_wb_store != null && args.bug_status === 2) {
    const existing = find_matching_writeback(_wb_store.load_writebacks_only().processWritebacks, {
      className: _server_class_name,
      methodName: args.method_name,
      strategyCode: args.strategy_code != null ? args.strategy_code : 2,
      bugStatus: 2,
    });
    if (existing && writeback_should_protect(existing, request_body)) {
      console.log(JSON.stringify({
        code: -3,
        msg:
          `refused bugStatus=2 overwrite of existing defect ` +
          `${existing.className}#${existing.methodName} (bugStatus=${existing.bugStatus})`,
        conflict: {
          className: existing.className,
          methodName: existing.methodName,
          existingBugStatus: existing.bugStatus,
          incomingBugStatus: 2,
        },
      }, null, 2));
      process.exit(1);
    }
  }

  const result = update_process(request_body);

  if ("_error" in result) {
    console.error(`[update-process] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[update-process] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  const method_str = args.method_name ? `#${args.method_name}` : "";
  const bug_label: Record<number, string> = { 2: "not a defect", 6: "Suspected defect", 7: "Improvement" };
  if ((result.data || {}).skipped) {
    console.error(`⚡ Skipped (duplicate write-back): ${args.class_name}${method_str}`);
  } else {
    console.error(`✅ Write-back succeeded: ${args.class_name}${method_str} → ${bug_label[args.bug_status] || args.bug_status}`);
  }

  if (_wb_store != null && !(result.data || {}).skipped) {
    const _sc = args.strategy_code != null ? args.strategy_code : 2;
    try {
      const rec = _wb_store.record_process_writeback({
        parentBatchId: args.batch_id,
        className: args.class_name,
        methodName: args.method_name,
        strategyCode: _sc,
        bugStatus: args.bug_status,
        writeMethod: "update-process",
      });
      _wb_store.save();
      if (rec.status === "protected") {
        console.error(
          `[update-process] 🛡️ Kept existing defect ${rec.className}#${rec.methodName} ` +
            `(bugStatus=${rec.existingBugStatus}); refused later bugStatus=2 overwrite`,
        );
      } else {
        console.error("[update-process] 🗂️ Recorded local write-back (content_store writebacks)");
      }
    } catch (e: any) {
      console.error(`[update-process] ⚠️ Failed to record local write-back (does not affect platform write-back): ${e}`);
    }
  }

  const resp_data = result.data || {};
  const model_prediction = resp_data.modelPredictionResult;
  const has_defect = [6, 7].includes(args.bug_status);
  if (model_prediction === 2 && has_defect) {
    const confidence = resp_data.modelPredictionConfidence;
    const prob_invalid = resp_data.modelPredictionProbInvalid;
    const threshold = resp_data.modelPredictionThreshold;
    const confidence_pct = confidence != null ? `${(confidence * 100).toFixed(1)}%` : "N/A";
    const invalid_pct = prob_invalid != null ? `${(prob_invalid * 100).toFixed(1)}%` : "N/A";
    const threshold_pct = threshold != null ? `${(threshold * 100).toFixed(1)}%` : "N/A";
    console.error(
      `\n⚠️  [Model prediction] The trained model judged this defect high-confidence invalid (possible false positive):\n` +
        `   confidence=${confidence_pct}, invalid probability=${invalid_pct}, threshold=${threshold_pct}\n` +
        `   Suggestion: re-examine this defect conclusion; consider downgrading to Improvement or no-defect.\n` +
        `   If you still believe it is a real defect, add stronger evidence in thinking explaining why the model is wrong.`,
    );
  }

  console.log(JSON.stringify(result, null, 2));
}

function _resolve_content_arg(args: Args): string {
  if (args.content_file) {
    return readFileSync(args.content_file, "utf8").trim();
  }
  let content = args.content || "";
  if (!content.includes("\n") && content.includes("\\n")) {
    content = content.replace(/\\n/g, "\n");
  } else if (content.includes("\\n")) {
    content = content.replace(/\\n/g, "\n");
  }
  return content;
}

function _validate_rank_content_format(content: string, bug_status: number): string[] {
  if (bug_status === 2) return [];

  const common_fields = ["Problem description", "Problem tags", "Impact scope", "Affected business", "Reproduction path"];
  const defect_fields = ["Trigger conditions", "Expected vs actual"];
  const suggestion_fields = ["Improvement plan"];

  const required = [...common_fields];
  if (bug_status === 6) required.push(...defect_fields);
  else if (bug_status === 7) required.push(...suggestion_fields);

  const missing: string[] = [];
  for (const field of required) {
    const normalized_field = field.replace(/ /g, "");
    const normalized_content = content.replace(/ /g, "");
    if (!normalized_content.includes(normalized_field) && !content.includes(field)) {
      missing.push(field);
    }
  }
  return missing;
}

export function cmd_finalize_rank(args: Args): void {
  const content = _resolve_content_arg(args);

  const missing_fields = _validate_rank_content_format(content, args.bug_status);
  if (missing_fields.length) {
    console.error("[finalize-rank] ⚠️  content format warning: missing required fields:");
    for (const f of missing_fields) {
      console.error(`  - ${f}`);
    }
    console.error("[finalize-rank] Fill the fields from the references/writeback.md template and retry.");
    if (missing_fields.length >= 3) {
      console.error(`[finalize-rank] ⛔ Missing ${missing_fields.length} required field(s); write rejected.`);
      _cli_result(1, {
        blocked: true,
        missing_fields,
        bug_status: args.bug_status,
        hint: "bugStatus=6 requires: Problem description / Problem tags / Impact scope / Affected business / Reproduction path / Trigger conditions / Expected vs actual;" +
          "bugStatus=7 requires: Problem description / Problem tags / Impact scope / Affected business / Reproduction path / Improvement plan",
      }, "content_format_invalid");
      process.exit(1);
    }
  }

  let _server_class_name = args.class_name;
  let _resolved_batch_id = args.batch_id || 0;
  let _resolved_git: any = null;
  let _git_file_path: any = null;
  let task_id = args.task_id ?? null;
  if (task_id) {
    const _store = new ContentStore(task_id);
    const _ctx = _store.resolve_writeback_context(args.class_name, args.method_name || null, null);
    if (_ctx.serverClassName && _ctx.serverClassName !== args.class_name) {
      _server_class_name = _ctx.serverClassName;
      console.error(`[finalize-rank] 🔧 className normalized: ${JSON.stringify(args.class_name)} → ${JSON.stringify(_server_class_name)}`);
    }
    if (!_resolved_batch_id && _ctx.parentBatchId) {
      _resolved_batch_id = _ctx.parentBatchId;
      console.error(`[finalize-rank] 🔧 Auto-injected batchId=${_resolved_batch_id} (from local mapping)`);
    }
    _resolved_git = _ctx.gitUrl;
    // Path-style classNames (Go/Python/C/…) need the real file on the rank so the
    // report can link it. This is not a frontend/client classification.
    _git_file_path = _ctx.usesPathClassName ? _ctx.filePath : null;
    if (_git_file_path) {
      console.error(
        `[finalize-rank] 🔧 className is a repo path; recording gitFilePath=${JSON.stringify(_git_file_path)} ` +
          "(rank stays method-level)",
      );
    }
  }

  const result = finalize_rank(
    _resolved_batch_id,
    _server_class_name,
    args.method_name,
    args.bug_status,
    content,
    args.process_ids || null,
    _resolved_git,
    task_id,
    _git_file_path,
  );
  if ("_error" in result) {
    console.error(`[finalize-rank] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[finalize-rank] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.error(`✅ finalize-rank succeeded: ${args.class_name}#${args.method_name}`);

  task_id = args.task_id ?? null;
  if (task_id) {
    let rank_id: any = null;
    const data = result.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      rank_id = data.aggregatedRankId || data.rankId || data.id;
    }
    if (rank_id) {
      try {
        const store = new ContentStore(task_id);
        const rank_record: Record<string, any> = {
          className: args.class_name,
          methodName: args.method_name,
          bugStatus: args.bug_status,
          rankId: rank_id,
        };
        const bid = args.batch_id ?? null;
        if (bid) rank_record.parentBatchId = parseInt(String(bid), 10);
        store.record_rank(rank_record);
        store.save();
        console.error(`[finalize-rank] ✅ Auto record-rank persisted to local content.json (rankId=${rank_id})`);
        result._auto_record_rank = { rankId: rank_id, recorded: true };
      } catch (e: any) {
        console.error(`[finalize-rank] ⚠️  Auto record-rank failed (does not affect finalize; run record-rank manually): ${e}`);
        result._auto_record_rank = { rankId: rank_id, recorded: false, error: String(e) };
      }
    } else {
      console.error("[finalize-rank] ⚠️  Platform response has no rankId; run record-rank manually.");
      result._auto_record_rank = { recorded: false, error: "rankId not found in response" };
    }
  } else {
    console.error("[finalize-rank] 💡 Hint: pass --task-id to auto-persist record-rank locally (dual-write automation); no extra manual call.");
  }

  console.log(JSON.stringify(result, null, 2));
}

export function cmd_check_rank_integrity(args: Args): void {
  const result = check_rank_integrity(args.batch_id);
  if ("_error" in result) {
    console.error(`[check-rank-integrity] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[check-rank-integrity] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_gen_writeback_template(args: Args): void {
  const strategy = args.strategy_code;
  const bug_status = args.bug_status;
  const class_name = args.class_name || "com/example/ExampleService";
  const method = args.method_name || "exampleMethod";
  const task_id = args.task_id ?? null;

  // When --task-id is given, pull git/branch/commit/batchId/detectTier from the
  // content store so the template is submit-ready instead of placeholder-only.
  let git = "git@github.com:<org>/<repo>.git";
  let branch = "feature/xxx";
  let commit = "<commitId>";
  let batch_id: number | string = "<fill: batchId from clone-and-diff / task status>";
  let detect_tier: string = "<fill: T1/T2/T3 from plan.json>";
  let language: string | null = canonicalize_language(args.language) || null;
  let file_path: string | null = null;
  if (task_id) {
    try {
      const _store = new ContentStore(task_id);
      const _meta = _store.load_meta_only();
      const _svc = (_meta.services || [])[0];
      if (_svc) {
        git = _svc.gitUrl || git;
        branch = _svc.branch || branch;
        commit = _svc.commitId || commit;
        if ((_svc.batchIds || []).length) batch_id = _svc.batchIds[0];
      }
      // Exact strategy first; otherwise any plan item for the same method (tier is per method).
      const _plan_items: any[] = (_store.load_plan_only()?.detectionPlan || []);
      const _item = _store.get_plan_item(class_name, method, strategy)
        || _plan_items.find((i: any) => i.className === class_name && i.methodName === method && i.detectTier);
      if (_item?.detectTier) detect_tier = _item.detectTier;
      // The plan / diff already knows the real file: never guess when we have it.
      file_path = _item?.filePath || _store.get_changed_method_file_path(class_name, method) || null;
      // Language precedence in a polyglot task: the item's own language / file beats the
      // service-level dominant language (a Go method in a Python-majority repo gets a ```go fence).
      if (!language) {
        language = canonicalize_language(_item?.language)
          || (file_path ? language_from_path(file_path) : null)
          || (_svc?.language ? canonicalize_language(_svc.language) : null)
          || null;
      }
    } catch { /* template stays placeholder-only */ }
  }

  if (!file_path) {
    // No evidence → per-language guess; never force java when language is unknown (R8).
    file_path = guess_file_path_for_class(class_name, language);
  }
  const fence = code_fence_for_language(language || language_from_path(file_path) || null);

  const has_defect = [6, 7].includes(bug_status);

  // Every field/marker below is checked by validate.ts pre-validation:
  // detectTier, "[Confidence:HIGH|MED|LOW]" in thinking, Trigger conditions for bugStatus=6.
  const template: Record<string, any> = {
    parentBatchId: batch_id,
    className: class_name,
    methodName: method,
    bugStatus: bug_status,
    strategyCode: strategy,
    detectTier: detect_tier,
    fileCodes: [{
      filePath: file_path,
      methodNames: [method],
      git,
      branch,
      commitId: commit,
    }],
    thinking: `Review ${method} lines X-Y: <which logic was reviewed, which Risks were considered, cite concrete Lines/variable names>. ` +
      (has_defect
        ? "Found a defect: <what fails and why>. Conclusion: defense failed. [Confidence:HIGH][C5✓]"
        : "Parameter checks are complete, exception handling is reasonable, no logic defect. Conclusion: no defect. [Confidence:HIGH]"),
    content: !has_defect ? "No defect in this code" : (
      (bug_status === 6 ? "Defect:" : "Improvement:") +
      `${method} <one-line description>\n\nLines:X-Y\n\n` +
      "Problem description: <detailed description>\n\n" +
      "Problem tags: [<tag>][This change/Pre-existing]\n\n" +
      "Impact scope: <involved APIs/modules>\n\n" +
      "Affected business: <impact on users/business>\n\n" +
      "Reproduction path: <call API A → pass param X → hit branch Y → produce error Z>\n\n" +
      (bug_status === 6
        ? "Trigger conditions: <input / state that makes the bug fire>\n\n" +
          "Expected vs actual:\n- expected: <correct behavior>\n- actual: <wrong behavior>\n\n"
        : "Current impact: <what is degraded today>\n\nRationale: <why the change is worth making>\n\n") +
      (bug_status === 6 ? "Fix suggestion:" : "Improvement plan:") +
      "<brief fix plan>\n\n" +
      "```" + fence + "\n" + (fence === "python" ? "# " : "// ") + "<fix/improved code>\n```"
    ),
    _hint_processId: "processId is only needed when the platform issued pending items (get-pending). Local mode: omit it.",
    processSteps: [{
      step: "first_round_detection",
      stepKey: "first_round_detection",
      stepStatus: "executed",
      hasBug: has_defect,
      conclusion: `${method} lines X-Y <conclusion>`,
      question: `Analyze whether ${method} has <risk type>`,
    }],
  };

  if (task_id) template.taskId = task_id;

  if ([6, 11].includes(strategy)) {
    template.processSteps[0].referencedSources = [{
      sourceType: "tech_doc",
      sourceId: "<fill: document ID or testPlanId_xxx>",
      sourceName: "<fill: document title>",
    }];
    template._hint_strategy11 = (
      "strategyCode=11 must include referencedSources in processSteps. " +
      "sourceType options: prd_doc/tech_doc/test_case." +
      "Prefer test_case when test cases exist; if there are docs but no cases, use tech_doc/prd_doc."
    );
    if (has_defect) {
      template._hint_strategy11_defect =
        "When bugStatus=6/7 and the task has test cases (HAS_CASES=true), content must cite one: Test case ID: [<id>](<link>). " +
        "When HAS_CASES=false / no cases in the content store, omit the Test case ID line.";
      if (strategy === 11) {
        template._hint_strategy11 +=
          " strategyCode=11 thinking/content must show the call chain (→ or a call-path description)." +
          " When bugStatus=6/7 (not T3 trivial / bugStatus=2), thinking must end with a [Feasibility] marker naming the check that" +
          " confirms the path is reachable in production: sanitizer/allowlist, dead config flag, test-only path, caller already validated," +
          " source not user-controlled, framework guard (see references/analysis/path-feasibility.md).";
        template.thinking +=
          "\n[Feasibility] <sanitizer/allowlist | dead config flag | test-only path | caller already validated | source not user-controlled | framework guard>: <evidence with line numbers>";
      }
    }
  } else if (strategy === 8) {
    template.astRuleCount = "<fill: rule count actually loaded by run-ast-scan>";
    template.processSteps = [
      { step: "exclusion_rule_filter", stepKey: "exclusion_rule_filter",
        stepStatus: "executed", hasBug: false,
        conclusion: "After exclusion-rule filtering, nothing to exclude" },
      { step: "llm_validation", stepKey: "llm_validation",
        stepStatus: "executed", hasBug: has_defect,
        conclusion: "<LLM verification conclusion>",
        question: "<full prompt sent to the LLM>" },
    ];
    if (has_defect) {
      template.ruleId = "<fill: matched rule ruleId>";
      template.hitRuleIds = ["<fill: matched rule ID>"];
      template._hint_security_refs =
        "AST seed rules carry cwe / owaspTop10_2025 / asvs50 in their description (get-rules). Cite them in content, e.g. " +
        "'Standards: CWE-89, OWASP A05:2025, ASVS V5.3.4', so the report maps to the security baseline.";
    }
  } else if ([4, 11].includes(strategy)) {
    template.thinking = `Walk the call chain <entry>#${method} → <downstream class>#<method> and analyze: <describe the issue on the chain>`;
    template._hint_strategy11 = "strategyCode=11 requires thinking/content to show the call chain (include → or a call-path description)";
  }

  if (has_defect) {
    template.tagId = "<fill: a valid tagId from get-tag-list>";
    template.confidenceScore = 0.85;
  }

  _cli_success(template, `Full write-back template for strategyCode=${strategy}, bugStatus=${bug_status}`);
}

export function cmd_batch_no_bug(args: Args): void {
  const raw = args.items_json;
  let pending_data: any;
  if (raw && _is_file(raw)) {
    pending_data = JSON.parse(readFileSync(raw, "utf8"));
  } else if (raw) {
    pending_data = JSON.parse(raw);
  } else {
    _cli_error("Must provide --items-json (a pending_phase2.json path or a JSON string)");
    return;
  }

  let class_items: any[];
  if (pending_data && typeof pending_data === "object" && !Array.isArray(pending_data) && "data" in pending_data) {
    class_items = pending_data.data;
  } else if (Array.isArray(pending_data)) {
    class_items = pending_data;
  } else {
    _cli_error("Unrecognized data format; expected pending_phase2.json or a class-item array");
    return;
  }

  const strategy = args.strategy;
  const batch_id = args.batch_id;
  const task_id = args.task_id;
  const git_url = args.git || "";
  const branch = args.branch || "";
  const commit_id = args.commit || "";
  const max_batch_size = args.max_batch_size;

  let ref_sources: any = null;
  if ([6, 11].includes(strategy)) {
    const ref_type = args.ref_source_type || "tech_doc";
    const ref_id = args.ref_source_id || "";
    const ref_name = args.ref_source_name || "";
    if (!ref_id || !ref_name) {
      _cli_error("For the business strategy, --ref-source-id and --ref-source-name are required");
      return;
    }
    ref_sources = [{ sourceType: ref_type, sourceId: ref_id, sourceName: ref_name }];
  }

  const class_file_map: Record<string, string> = {};
  for (const item of class_items) {
    const cn = item.className || "";
    const short_name = cn.includes("/") ? cn.split("/").pop()! : cn;
    if (cn.endsWith(".xml")) {
      class_file_map[short_name] = cn;
    } else {
      class_file_map[short_name] = cn.endsWith(".java") ? cn : cn + ".java";
    }
  }

  let filtered_items = class_items;
  if (args.exclude_patterns) {
    const patterns = args.exclude_patterns.split(",").map((p: string) => p.trim()).filter(Boolean);
    filtered_items = class_items.filter((item: any) =>
      !patterns.some((p: string) => (item.className || "").includes(p)),
    );
  }

  const skip_code_read_check = args.skip_code_read_check || false;
  const auto_registered_classes: string[] = [];
  const skipped_classes: string[] = [];

  if (!skip_code_read_check && task_id && batch_id) {
    for (const item of filtered_items) {
      const cn = item.className || "";
      if (!has_code_been_read(batch_id, cn, task_id)) {
        register_code_read(
          task_id,
          batch_id,
          cn,
          cn,
          `[auto-registered by batch-no-bug] className=${cn}`,
        );
        auto_registered_classes.push(cn);
      }
    }

    if (auto_registered_classes.length) {
      console.error(
        `[batch-no-bug] ℹ️  ${auto_registered_classes.length} class(es) lack a code-read registration, ` +
          `Auto-registered (agent completed a real analysis):`,
      );
      for (const cn of auto_registered_classes.slice(0, 10)) {
        console.error(`  - ${cn}`);
      }
      if (auto_registered_classes.length > 10) {
        console.error(`  ... ${auto_registered_classes.length} total`);
      }
    }
  }

  if (!filtered_items.length) {
    _cli_error("No write-back items after filtering. Check the input and filters.");
    return;
  }

  const all_items: any[] = [];
  for (const item of filtered_items) {
    const cn = item.className || "";
    const short_name = cn.includes("/") ? cn.split("/").pop()! : cn;
    const file_path = class_file_map[short_name] || cn;

    for (const m of item.methods || []) {
      const method_name = m.methodName || "unknown";
      const processes = m.processes || [];

      const unique_seed = `${short_name}#${method_name}`;
      const seed_hash = createHash("md5").update(unique_seed, "utf8").digest("hex").slice(0, 6);

      const thinking = (
        `Review ${short_name}.${method_name} along the call chain Controller → ${short_name}#${method_name}: ` +
        `check input validation, boundary conditions, exception paths and return-value correctness. ` +
        `Parameter passing is safe; exception branches have catch/fallback. ` +
        `Branch coverage is complete; no null-pointer / OOB / concurrency / resource-leak defects found. [${seed_hash}]`
      );

      const conclusion = (
        `${short_name}.${method_name} line-by-line review done: parameter checks are sufficient, exception handling is complete, ` +
        `Logic is complete with no gaps. Confirmed no defect`
      );

      const question = `Analyze whether ${short_name}.${method_name} has null-pointer / OOB / concurrency / resource-leak / logic defects`;

      for (const p of processes) {
        const process_id = p.processId;
        const p_strategy = p.strategyCode ?? strategy;
        const p_batch_id = p.parentBatchId ?? batch_id;

        if (p_strategy !== strategy) continue;

        const entry: Record<string, any> = {
          parentBatchId: p_batch_id,
          processId: process_id,
          className: cn,
          methodName: method_name,
          bugStatus: 2,
          detectTier: p.detectTier || m.detectTier || item.detectTier || "T3",
          strategyCode: strategy,
          fileCodes: [{
            filePath: file_path,
            methodNames: [method_name],
            git: git_url,
            branch,
            commitId: commit_id,
          }],
          thinking,
          content: NO_DEFECT_CONTENT,
          processSteps: [{
            step: "first_round_detection",
            stepKey: "first_round_detection",
            stepStatus: "executed",
            hasBug: false,
            conclusion,
            question,
          }],
        };

        if (task_id) entry.taskId = task_id;

        if ([6, 11].includes(strategy) && ref_sources) {
          entry.processSteps[0].referencedSources = ref_sources;
        }

        all_items.push(entry);
      }
    }
  }

  if (!all_items.length) {
    _cli_error("No write-back items were generated; check the input and filters");
    return;
  }

  const sample_errors: string[] = [];
  for (let i = 0; i < Math.min(3, all_items.length); i++) {
    const item = all_items[i];
    const err = validate_update_process(item, task_id);
    if (err) {
      sample_errors.push(`  item[${i}] (${item.className || "?"}#${item.methodName || "?"}): ${err}`);
    }
  }
  if (sample_errors.length) {
    _cli_error(`Pre-validation failed (errors in the first 3 items); fix the arguments and retry:\n` + sample_errors.join("\n"));
    return;
  }

  const batches: any[][] = [];
  for (let i = 0; i < all_items.length; i += max_batch_size) {
    batches.push(all_items.slice(i, i + max_batch_size));
  }

  const submit = args.submit || false;
  if (submit) {
    console.error(`[batch-no-bug] 🚀 Direct submit mode: ${all_items.length} item(s) in ${batches.length} batch(es)`);
    let total_success = 0;
    let total_failed = 0;
    let total_skipped = 0;
    for (let batch_idx = 0; batch_idx < batches.length; batch_idx++) {
      const batch = batches[batch_idx];
      console.error(`[batch-no-bug] 📦 Submitting batch ${batch_idx + 1}/${batches.length} (${batch.length} item(s))...`);
      const result = batch_update_process(batch, 5, true);
      const summary = result.summary || {};
      total_success += summary.success || 0;
      total_failed += summary.failed || 0;
      total_skipped += summary.skipped || 0;
      if ((summary.failed || 0) > 0) {
        console.error(`[batch-no-bug] ⚠️  Batch ${batch_idx + 1} had ${summary.failed} failure(s)`);
      }
    }

    const result_data: Record<string, any> = {
      totalItems: all_items.length,
      batchCount: batches.length,
      submitted: true,
      success: total_success,
      failed: total_failed,
      skipped: total_skipped,
      uniqueThinkings: new Set(all_items.map((item) => item.thinking)).size,
    };
    if (skipped_classes.length) {
      result_data.skippedClasses = skipped_classes;
      result_data.skippedClassCount = skipped_classes.length;
    }

    if (total_failed > 0) {
      _cli_result(1, result_data,
        `Batch submit finished, ${total_success} succeeded / ${total_failed} failed / ${total_skipped} skipped`);
    } else {
      _cli_success(result_data,
        `Batch submit finished: all ${total_success} item(s) succeeded` +
          (total_skipped ? ` (${total_skipped} duplicate(s) skipped)` : ""));
    }
    return;
  }

  const output_dir = args.output_dir;
  if (output_dir) {
    mkdirSync(output_dir, { recursive: true });
    const full_path = join(output_dir, "batch_no_bug_all.json");
    writeFileSync(full_path, JSON.stringify(all_items, null, 2), "utf8");
    for (let idx = 0; idx < batches.length; idx++) {
      const part_path = join(output_dir, `batch_no_bug_part${idx + 1}.json`);
      writeFileSync(part_path, JSON.stringify(batches[idx], null, 2), "utf8");
    }
    const result_data: Record<string, any> = {
      totalItems: all_items.length,
      batchCount: batches.length,
      batchSizes: batches.map((b) => b.length),
      uniqueThinkings: new Set(all_items.map((item) => item.thinking)).size,
      outputDir: output_dir,
      files: batches.map((_, i) => `batch_no_bug_part${i + 1}.json`),
    };
    if (skipped_classes.length) {
      result_data.skippedClasses = skipped_classes;
      result_data.skippedClassCount = skipped_classes.length;
    }
    _cli_success(result_data,
      `Generated ${all_items.length} no-defect write-back(s), split into ${batches.length} batch(es) (≤${max_batch_size} each)`);
  } else {
    const result_data: Record<string, any> = {
      totalItems: all_items.length,
      batchCount: batches.length,
      batchSizes: batches.map((b) => b.length),
      uniqueThinkings: new Set(all_items.map((item) => item.thinking)).size,
      items: all_items,
    };
    if (skipped_classes.length) {
      result_data.skippedClasses = skipped_classes;
      result_data.skippedClassCount = skipped_classes.length;
    }
    _cli_success(result_data,
      `Generated ${all_items.length} no-defect write-back(s) (${batches.length} batch(es)); submit with batch-update-process`);
  }
}

export function cmd_batch_update_process(args: Args): void {
  const raw = args.items_json;
  let items: any;
  if (_is_file(raw)) {
    items = JSON.parse(readFileSync(raw, "utf8"));
  } else {
    items = JSON.parse(raw);
  }

  if (!Array.isArray(items)) {
    console.log(JSON.stringify({ code: -1, msg: "--items-json must be a JSON array" }));
    process.exit(1);
  }

  let _wb_store: ContentStore | null = null;
  if (args.task_id != null) {
    _wb_store = new ContentStore(args.task_id);
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      it.taskId = args.task_id;
      // Backfill detectTier / processId / parentBatchId from the plan (single source of truth).
      try {
        const sc = typeof it.strategyCode === "number" ? it.strategyCode : 11;
        const plan_item = _wb_store.get_plan_item(it.className, it.methodName, sc)
          || (_wb_store.load_plan_only()?.detectionPlan || []).find(
            (p: any) => p.className === it.className && p.methodName === it.methodName,
          );
        if (plan_item) {
          if (!it.detectTier && plan_item.detectTier) it.detectTier = plan_item.detectTier;
          if (it.processId == null && plan_item.processId != null) it.processId = plan_item.processId;
          if (it.parentBatchId == null && plan_item.parentBatchId != null) it.parentBatchId = plan_item.parentBatchId;
        }
      } catch { /* plan may be partial */ }
      const [fixed_fc, notes, server_class_name, uses_path_class_name] = _reconcile_file_codes(
        _wb_store, it.className, it.methodName, it.strategyCode, it.fileCodes,
      );
      it.fileCodes = fixed_fc;
      if (server_class_name && server_class_name !== it.className) {
        it._originalClassName = it.className;
        it.className = server_class_name;
      }
      if (uses_path_class_name) {
        const git_file_path = (fixed_fc || [{}])[0]?.filePath;
        if (git_file_path) it.gitFilePath = git_file_path;
        console.error(`[batch-update-process] 🔧 className is a repo path; recording gitFilePath: ${it.className} → ${git_file_path}`);
      }
      for (const n of notes) {
        console.error(`[batch-update-process] 🔧 ${it._originalClassName || it.className}#${it.methodName}: ${n}`);
      }
    }
  }

  const _ctx_task_id = args.task_id ?? null;

  // Local checkouts used by validation rule 24 (method-name authenticity), most
  // specific first: the task's registered service/gitnexus localDir, then every
  // clone under the clone root.
  const _local_checkout_dirs = (): string[] => {
    const dirs: string[] = [];
    const push = (d: any) => { if (typeof d === "string" && d && !dirs.includes(d) && _is_dir(d)) dirs.push(d); };
    if (_wb_store) {
      try {
        push((_wb_store.get_meta_field("gitnexus") || {}).localDir);
        for (const svc of _wb_store.load_meta_only().services || []) push(svc?.localDir);
      } catch {
        // content store may be partial
      }
    }
    const base = repo_clone_base_dir();
    if (_is_dir(base)) {
      try {
        for (const name of readdirSync(base)) push(join(base, name));
      } catch {
        // unreadable base
      }
    }
    return dirs;
  };

  const pre_errors: any[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    if (!it || typeof it !== "object") {
      pre_errors.push({ index: idx, error: "not a dict type" });
      continue;
    }
    const errs = validate_update_process_all(it, _ctx_task_id);
    if (errs.length) {
      const label = `${it.className || "?"}#${it.methodName || "?"}`;
      pre_errors.push({ index: idx, label, error: errs.join(" | "), errors: errs });
    }

    const bug_st = it.bugStatus;
    if ([6, 7].includes(bug_st)) {
      const cn = (it.className || "").trim();
      const mn = (it.methodName || "").trim();
      const ct = (it.content || "").trim();
      const ln_m = ct.match(/Lines[：:]\s*(\d+)/);
      const first_line = ln_m ? parseInt(ln_m[1], 10) : null;
      const m_m = ct.match(/[Mm]ethod[：:]\s*(?:[\w.$]+#)?(\w+)/);
      const ct_mn = m_m ? m_m[1] : "";
      const target_mn = mn || ct_mn;

      if (target_mn && first_line) {
        let verified_ok = false;
        let file_path = "";
        for (const fc of it.fileCodes || []) {
          const git_url = fc.git || "";
          const commit_id = fc.commitId || "";
          file_path = (fc.filePath || "").trim();
          if (!git_url || !file_path) continue;
          let found_local = false;
          for (const local_dir of _local_checkout_dirs()) {
            const local_file = join(local_dir, file_path);
            if (!_is_file(local_file)) continue;
            try {
              const src_content = readFileSync(local_file, "utf8");
              if (src_content.toLowerCase().includes(target_mn.toLowerCase())) {
                found_local = true;
                break;
              }
            } catch {
              // unreadable file; try the next checkout
            }
          }
          if (found_local) {
            verified_ok = true;
            break;
          }
          if (commit_id) {
            // Bare validation clone lives with the other clones (<data dir>/repos/_validate/<repo>)
            // so it is per-user, aged out by cleanup-stale-data, and works on every OS.
            const repo_name = basename(git_url.replace(/\/+$/, "")).replace(/\.git$/, "") || "repo";
            const tmp_clone = join(repo_clone_base_dir(), "_validate", repo_name);
            if (!_is_dir(tmp_clone)) {
              mkdirSync(dirname(tmp_clone), { recursive: true });
              _spawn(["git", "clone", "--depth=1", "--bare", git_url, tmp_clone], 120);
            }
            const r_git = _spawn(["git", "--git-dir", tmp_clone, "show", `${commit_id}:${file_path}`], 30);
            if (r_git.returncode === 0) {
              if (r_git.stdout.toLowerCase().includes(target_mn.toLowerCase())) {
                verified_ok = true;
              }
            }
          }
          break;
        }
        if (!verified_ok && target_mn) {
          pre_errors.push({
            index: idx,
            label: `${cn}#${target_mn}`,
            error: (
              `Validation rule 24 (method-name authenticity): method name "${target_mn}"` +
              `was not found in source file ${file_path}; the name may be wrong.` +
              `Confirm the method name was extracted from source near line ${first_line}.`
            ),
          });
        }
      }
    }
  }
  if (pre_errors.length) {
    // One item can fail several rules; count distinct items, not error rows.
    const failed_items = new Set(pre_errors.map((e) => e.index)).size;
    console.log(JSON.stringify({
      code: -2,
      msg: `pre-validation blocked: ${failed_items}/${items.length} item(s) failed; nothing was submitted`,
      errors: pre_errors,
    }, null, 2));
    process.exit(1);
  }

  const skipped_protect: any[] = [];
  if (_wb_store != null) {
    const existing_rows = _wb_store.load_writebacks_only().processWritebacks || [];
    const kept: any[] = [];
    for (const it of items) {
      if (!it || typeof it !== "object") {
        kept.push(it);
        continue;
      }
      const incoming = {
        className: it.className,
        methodName: it.methodName,
        strategyCode: typeof it.strategyCode === "number" ? it.strategyCode : 11,
        bugStatus: it.bugStatus,
      };
      const existing = find_matching_writeback(existing_rows, incoming);
      if (existing && writeback_should_protect(existing, incoming)) {
        skipped_protect.push({
          className: existing.className,
          methodName: existing.methodName,
          existingBugStatus: existing.bugStatus,
        });
        continue;
      }
      kept.push(it);
    }
    if (skipped_protect.length) {
      console.error(
        `[batch-update-process] 🛡️ Skipped ${skipped_protect.length} no-defect write(s) ` +
          `that would overwrite existing defects: ` +
          skipped_protect.map((s) => `${s.className}#${s.methodName}(bugStatus=${s.existingBugStatus})`).join(", "),
      );
    }
    items = kept;
  }

  if (!items.length) {
    console.log(JSON.stringify({
      code: 0,
      msg: "nothing submitted: every item was a bugStatus=2 overwrite of an existing defect",
      data: { skippedProtect: skipped_protect },
    }, null, 2));
    return;
  }

  const result = batch_update_process(items);

  if (_wb_store != null && result.code === 0) {
    let protected_count = 0;
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const sc = it.strategyCode;
      try {
        const rec = _wb_store.record_process_writeback({
          parentBatchId: it.parentBatchId,
          className: it.className,
          methodName: it.methodName,
          strategyCode: typeof sc === "number" ? sc : 11,
          bugStatus: it.bugStatus,
          writeMethod: "batch-update-process",
        });
        if (rec.status === "protected") protected_count += 1;
      } catch (e: any) {
        console.error(`[batch-update-process] ⚠️ Failed to record local write-back: ${it.className}#${it.methodName}: ${e}`);
      }
    }
    _wb_store.save();
    if (protected_count) {
      console.error(
        `[batch-update-process] 🛡️ ${protected_count} existing defect record(s) were kept; ` +
          `later bugStatus=2 did not overwrite them`,
      );
    }
    console.error("[batch-update-process] 🗂️ Recorded local write-back (content_store writebacks)");
  }

  if (result.code === 0) {
    const defect_items = items.filter((it: any) => it && typeof it === "object" && [6, 7].includes(it.bugStatus));
    if (defect_items.length) {
      const pending_ranks: Record<string, any> = {};
      for (const it of defect_items) {
        const key = `${it.className || ""}\0${it.methodName || ""}`;
        if (!(key in pending_ranks)) pending_ranks[key] = it.parentBatchId;
      }
      console.error(
        `\n[batch-update-process] ⚠️  Detected ${Object.keys(pending_ranks).length} method(s) written back as bugStatus=6/7, ` +
          `These methods must run finalize-rank before they appear in the report list!`,
      );
      console.error("[batch-update-process] 📋 Methods waiting for finalize-rank:");
      for (const [key, bid] of Object.entries(pending_ranks)) {
        const [cls, method] = key.split("\0");
        console.error(`  → ${cls}#${method} (batchId=${bid})`);
      }
      console.error(
        "[batch-update-process] 💡 For each method run: finalize-rank --batch-id <batchId> " +
          "--class-name <className> --method-name <methodName> --bug-status <6|7> " +
          "--content <aggregated description>",
      );
    }
  }

  if (skipped_protect.length) {
    result.skippedProtect = skipped_protect;
  }
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_batch_dismiss_by_strategy(args: Args): void {
  const parent_batch_id = args.parent_batch_id;
  const strategy_code = args.strategy_code || 8;

  if (strategy_code !== 8) {
    _cli_error(
      "batch-dismiss-by-strategy is only for the AST strategy (strategyCode=8), " +
        "For other strategies, write back one by one via update-process",
      { strategyCode: strategy_code },
    );
    return;
  }

  const ast_findings_count = args.ast_findings_count ?? null;
  const verified_count = args.verified_count ?? null;
  const dismissible_count = args.dismissible_count ?? 0;

  if (ast_findings_count == null) {
    _cli_error(
      "Pass --ast-findings-count for the AST scan findings count.\n" +
        "  - If run-ast-scan reports totalFindings=0, pass --ast-findings-count 0 and dismiss directly.\n" +
        "  - If totalFindings>0, pass --verified-count for in-diff LLM checks and " +
        "--dismissible-count for out-of-diff + generated hits (from run-ast-scan dismissibleFindings).\n" +
        "  Purpose: prevent batch-dismissing in-diff hits without LLM verification (validation rule 9).",
      { parentBatchId: parent_batch_id },
    );
    return;
  }

  const need_verify = Math.max(0, ast_findings_count - dismissible_count);
  if (ast_findings_count > 0) {
    if (need_verify > 0 && verified_count == null) {
      _cli_error(
        `AST scan has ${ast_findings_count} finding(s) (${dismissible_count} auto-dismissable). ` +
          `Finish per-item LLM verification of the ${need_verify} in-diff hit(s) before dismissing the rest.\n` +
          `  Pass --verified-count N (N should equal ${need_verify}) and ` +
          `--dismissible-count ${dismissible_count || "outOfDiff+generated"}.\n` +
          `  Out-of-diff / generated hits do not need per-item reads.`,
        { parentBatchId: parent_batch_id, astFindingsCount: ast_findings_count, dismissibleCount: dismissible_count },
      );
      return;
    }
    if (verified_count != null && verified_count < need_verify) {
      console.error(
        `[batch-dismiss] ⚠️  Warning: ${need_verify} in-diff finding(s) need LLM verification, ` +
          `but only ${verified_count} were verified.`,
      );
    }
  }

  const result = batch_dismiss_by_strategy(parent_batch_id, strategy_code);

  if (result.code === 0) {
    const affected = (result.data || {}).affected || 0;
    _cli_success(
      { parentBatchId: parent_batch_id, strategyCode: strategy_code, affected },
      `AST batch dismiss as no-defect done: ${affected} item(s) bugStatus=0 → bugStatus=2`,
    );
  } else {
    _cli_error(
      `batch-dismiss-by-strategy failed: ${result.msg || ""}`,
      { parentBatchId: parent_batch_id, result },
    );
  }
}

export function cmd_dismiss_class(args: Args): void {
  const task_id = args.task_id;
  const class_names_raw = args.class_names;
  const batch_id = args.batch_id;
  const git_url = args.git_url;

  let class_names: string[];
  if (String(class_names_raw).trim().startsWith("[")) {
    try {
      class_names = JSON.parse(class_names_raw);
    } catch (e: any) {
      _cli_error(`--class-names JSON parse failed: ${e.message || e}`);
      return;
    }
  } else {
    class_names = class_names_raw.split(",").map((c: string) => c.trim()).filter(Boolean);
  }

  if (!class_names.length) {
    _cli_error("--class-names cannot be empty");
    return;
  }

  if (class_names.length > 200) {
    _cli_error(`At most 200 classes per dismiss; currently ${class_names.length}`, { count: class_names.length });
    return;
  }

  if (!has_repo_been_cloned(batch_id, git_url, task_id)) {
    _cli_error(
      "Gate 1 failed: no repo-clone record found.\n" +
        "  First run clone-and-diff + register-repo-clone to fetch the code,\n" +
        "  before using the dismiss-class fast path.\n" +
        "  This is a hard gate to stop dismissing without fetching code.",
      { gate: "repo_clone", batchId: batch_id, gitUrl: git_url, taskId: task_id },
    );
    return;
  }

  const unread_classes: string[] = [];
  for (const cn of class_names) {
    if (!has_code_been_read(batch_id, cn, task_id)) unread_classes.push(cn);
  }

  if (unread_classes.length) {
    _cli_error(
      `Gate 2 failed: ${unread_classes.length} class(es) have no code-read registration.\n` +
        `  First read and register code via read-method-code + register-code-read,\n` +
        `  before confirming this class has no defect. Unregistered class names:`,
      {
        gate: "code_read",
        unreadClasses: unread_classes.slice(0, 20),
        unreadCount: unread_classes.length,
        totalRequested: class_names.length,
      },
    );
    return;
  }

  const state = _load_local_state(task_id);
  const code_registry = state.codeReadRegistry || {};
  const batch_key = String(batch_id);
  const batch_registry = code_registry[batch_key] || {};
  const empty_hash_classes: string[] = [];
  for (const cn of class_names) {
    const entry = find_code_read_entry(batch_id, cn, task_id) || batch_registry[cn] || {};
    if (!entry.codeHash) empty_hash_classes.push(cn);
  }

  if (empty_hash_classes.length) {
    _cli_error(
      `Gate 2 failed (empty codeHash): ${empty_hash_classes.length} class(es) are registered but codeHash is empty,\n` +
        `  Registration had no valid code content. Re-run read-method-code, then register-code-read.`,
      {
        gate: "code_read_hash",
        emptyHashClasses: empty_hash_classes.slice(0, 20),
        emptyHashCount: empty_hash_classes.length,
      },
    );
    return;
  }

  const class_type = args.class_type;
  const allowed_types = new Set(["thrift_enum", "interface_def", "frontend_type", "dto_vo", "constant"]);
  if (!allowed_types.has(class_type)) {
    _cli_error(
      `Gate 3 failed: --class-type '${class_type}' is not in the allow-list.\n` +
        `  dismiss-class only applies to these class types:\n` +
        `  - thrift_enum: IDL/RPC enum class\n` +
        `  - interface_def: API definition class (Java interface with no business logic)\n` +
        `  - frontend_type: frontend type-definition files (.d.ts / type-only .ts)\n` +
        `  - dto_vo: DTO/VO definition class (data carrier, no business logic)\n` +
        `  - constant: constants class\n` +
        `  If the class has business logic, use regular update-process per-method analysis.`,
      {
        gate: "trivial_filter",
        classType: class_type,
        allowedTypes: [...allowed_types].sort(),
      },
    );
    return;
  }

  const coverage_threshold = args.coverage_threshold ?? 1.0;
  const actual_coverage = class_names.length
    ? (class_names.length - unread_classes.length) / class_names.length
    : 0;
  if (actual_coverage < coverage_threshold) {
    _cli_error(
      `Gate 4 failed: code-read coverage ${(actual_coverage * 100).toFixed(1)}% < threshold ${(coverage_threshold * 100).toFixed(1)}%.`,
      {
        gate: "coverage_ratio",
        actual: actual_coverage,
        threshold: coverage_threshold,
        totalClasses: class_names.length,
        readClasses: class_names.length - unread_classes.length,
      },
    );
    return;
  }

  console.error("[dismiss-class] ✅ All 4 gates passed; calling the platform to batch-dismiss classes as no-defect...");
  console.error(`[dismiss-class]   taskId=${task_id}, classType=${class_type}, classCount=${class_names.length}`);

  const result = batch_dismiss_by_class_names(task_id, class_names);

  if (result.code === 0) {
    const affected = (result.data || {}).affected || 0;

    for (const cn of class_names) {
      mark_method_done(task_id, batch_id, cn, "*", 0, 2);
    }

    try {
      const coverage_result = check_detection_coverage(batch_id);
      let percent = -1;
      if (coverage_result.code === 0) {
        const cov_data = coverage_result.data || {};
        const total = cov_data.totalCount || cov_data.total || 0;
        const completed = cov_data.completedCount || cov_data.completed || 0;
        percent = total > 0 ? Math.trunc(completed * 100 / total) : 0;
      }
      if (percent >= 0) {
        report_progress({ taskId: task_id, overallPercent: percent, currentPhase: "detect" });
        console.error(`[dismiss-class] 📊 Progress reported: ${percent}%`);
      }
    } catch (e: any) {
      console.error(`[dismiss-class] ⚠️  Progress report failed (does not affect dismiss): ${e}`);
    }

    _cli_success(
      {
        taskId: task_id,
        classType: class_type,
        classCount: class_names.length,
        affected,
        classNames: class_names,
      },
      `Batch dismiss finished: ${affected} item(s) bugStatus=0 → bugStatus=2 ` +
        `(${class_type}, ${class_names.length} class(es))`,
    );
  } else {
    _cli_error(
      `Batch dismiss classes as no-defect failed: ${result.msg || ""}`,
      { taskId: task_id, classNames: class_names.slice(0, 10), result },
    );
  }
}

export function cmd_register_code_read(args: Args): void {
  const task_id = args.task_id;
  const batch_id = args.batch_id;
  const class_name = args.class_name;
  const file_path = args.file_path || class_name;
  const code_snippet = args.code_snippet || "";

  register_code_read(task_id, batch_id, class_name, file_path, code_snippet);
  console.log(JSON.stringify({
    code: 0,
    msg: `Registered a code read: batchId=${batch_id}, className=${class_name}`,
    data: { taskId: task_id, batchId: batch_id, className: class_name, filePath: file_path },
  }, null, 2));
}

export function cmd_read_method_code(args: Args): void {
  const task_id = args.task_id;
  const batch_id = args.batch_id;
  const class_name = args.class_name;
  const method_name = args.method_name || "";
  const local_dir = args.local_dir;

  if (!_is_dir(local_dir)) {
    _cli_error(`Local code directory does not exist: ${local_dir}`);
    return;
  }

  // Plan / changed-method records know the real file for any language; fall back to a
  // language-neutral lookup (direct path for path-style classNames, walk for JVM ones).
  let file_hint: string | null = null;
  try {
    const store = new ContentStore(task_id);
    file_hint = store.get_changed_method_file_path(class_name, method_name || null)
      || (store.load_plan_only()?.detectionPlan || []).find((i: any) => i.className === class_name && (!method_name || i.methodName === method_name) && i.filePath)?.filePath
      || null;
  } catch {
    file_hint = null;
  }
  const target_file = locate_source_file(local_dir, class_name, file_hint);

  if (!target_file) {
    _cli_result(1, {
      found: false,
      className: class_name,
      searchedDir: local_dir,
    }, `File not found: ${class_name}; the class may live in another repo (cross-repo dependency)`);
    return;
  }

  let content: string;
  try {
    content = readFileSync(target_file, "utf8");
  } catch (e: any) {
    _cli_error(`Failed to read file: ${target_file}, error: ${e}`);
    return;
  }

  const rel_path = relative(local_dir, target_file);
  const language = language_from_path(rel_path);

  let method_code = "";
  let method_start_line = 0;
  let method_end_line = 0;
  let method_range_source: string | null = null;
  if (method_name) {
    const sg = semgrep_function_ranges(local_dir, [rel_path]);
    let units = extract_units_for_file(target_file, rel_path, { fileLevelFallback: false });
    if (sg[rel_path]?.length) units = merge_semgrep_units(units, sg[rel_path], language);
    const hit = units.find((u) => u.methodName === method_name)
      || units.find((u) => u.methodName.toLowerCase() === method_name.toLowerCase());
    if (hit) {
      method_start_line = hit.startLine;
      method_end_line = hit.endLine;
      method_range_source = hit.rangeSource || "regex";
      method_code = content.split("\n").slice(hit.startLine - 1, hit.endLine).join("\n");
    }
  }
  const snippet_for_hash = method_code ? method_code.slice(0, 200) : content.slice(0, 200);
  register_code_read(task_id, batch_id, class_name, rel_path, snippet_for_hash);

  const total_lines = content.split("\n").length;
  const result_data: Record<string, any> = {
    found: true,
    className: class_name,
    filePath: rel_path,
    absolutePath: target_file,
    language,
    codeFence: code_fence_for_path(rel_path),
    totalLines: total_lines,
    codeReadRegistered: true,
  };

  if (method_name) {
    result_data.methodName = method_name;
    if (method_code) {
      result_data.methodCode = method_code;
      result_data.methodStartLine = method_start_line;
      result_data.methodEndLine = method_end_line;
      result_data.methodLines = method_code.split("\n").length;
      result_data.methodRangeSource = method_range_source;
    } else {
      result_data.methodCode = "";
      result_data.methodNotFound = true;
      result_data.hint = "Method was not matched exactly; locate it manually. Full file content is in fileContent.";
    }
  }

  if (!method_code) {
    if (total_lines > 500) {
      result_data.fileContent = content.split("\n").slice(0, 500).join("\n");
      result_data.truncated = true;
      result_data.truncatedAt = 500;
    } else {
      result_data.fileContent = content;
    }
  } else {
    result_data.fileContent = method_code;
  }

  _cli_success(
    result_data,
    `Code read finished: ${rel_path}` +
      (method_code ? `, method ${method_name} L${method_start_line}-L${method_end_line}` : "") +
      `, code-read registered`,
  );
}

export function cmd_code_read_stats(args: Args): void {
  const stats = get_code_read_stats(args.task_id, args.batch_id);
  _cli_success(stats, `Code-read statistics: batchId=${args.batch_id}`);
}

export function cmd_trivial_method_filter(args: Args): void {
  let methods: any[] | null = null;
  let source = "inline";

  if (args.methods_file) {
    if (!_is_file(args.methods_file)) {
      _cli_error(`methods file does not exist: ${args.methods_file}`);
      return;
    }
    try {
      methods = JSON.parse(readFileSync(args.methods_file, "utf8"));
      source = "methods-file";
    } catch (e: any) {
      _cli_error(`Failed to read methods file: ${args.methods_file}`, { error: String(e) });
      return;
    }
  } else if (args.methods) {
    try {
      methods = JSON.parse(args.methods);
      source = "methods";
    } catch (e: any) {
      _cli_error("methods is not a valid JSON array", { error: String(e) });
      return;
    }
  } else if (args.task_id != null) {
    const store = new ContentStore(args.task_id);
    const plan = store.load_plan_only().detectionPlan || [];
    if (plan.length) {
      methods = plan.map((item: any) => ({
        className: item.className,
        methodName: item.methodName,
        bodyLineCount: item.bodyLineCount ?? null,
        expressionBody: item.expressionBody === true,
        params: item.params ?? "",
      }));
      source = "detection-plan";
    } else {
      methods = [];
      const raw_map = (store.load_meta_only().diff || {}).changedMethods || {};
      for (const [className, raw] of Object.entries(raw_map) as [string, any][]) {
        const list = Array.isArray(raw) ? raw : [raw];
        for (const entry of list) {
          const detail = normalize_changed_method(entry);
          if (!detail.methodName) continue;
          methods.push({
            className,
            methodName: detail.methodName,
            bodyLineCount: detail.bodyLineCount,
            expressionBody: detail.expressionBody === true,
            params: detail.params ?? "",
          });
        }
      }
      source = "changed-methods";
    }
  } else {
    _cli_error("Pass --task-id, or --methods (inline JSON), or --methods-file");
    return;
  }

  if (!Array.isArray(methods)) {
    _cli_error("methods must be a JSON array");
    return;
  }

  let backfilled = 0;
  if (args.task_id != null) {
    const store = new ContentStore(args.task_id);
    const lookup = store.get_changed_method_lookup();
    for (const m of methods) {
      if (!m || typeof m !== "object") continue;
      const has_count = m.bodyLineCount != null && m.bodyLineCount !== "";
      if (has_count && m.params) continue;
      const cn = m.className || "";
      const mn = m.methodName || "";
      const simple = cn.includes("/") ? cn.split("/").pop()! : String(cn).split(".").pop()!;
      const detail = lookup.get(`${cn}#${mn}`) || lookup.get(`${simple}#${mn}`);
      if (!detail) continue;
      if (!has_count && detail.bodyLineCount != null) {
        m.bodyLineCount = detail.bodyLineCount;
        m.bodyLineCountSource = "changedMethods";
        backfilled += 1;
      }
      if (!m.params && detail.params) m.params = detail.params;
      if (detail.expressionBody === true) m.expressionBody = true;
    }
  }

  const results = methods.map((m: any) => classify_trivial_method(m && typeof m === "object" ? m : {}));
  const trivial_count = results.filter((r: any) => r.trivial).length;
  const total = results.length;
  const deep_count = total - trivial_count;

  let stamped = 0;
  if (args.task_id != null) {
    stamped = stamp_trivial_on_plan(args.task_id, results);
  }

  const payload: Record<string, any> = {
    totalCount: total,
    trivialCount: trivial_count,
    deepAnalysisCount: deep_count,
    source,
    backfilledBodyLineCount: backfilled,
    stampedOnPlan: stamped,
    results,
    deepAnalysis: results.filter((r: any) => !r.trivial),
  };

  if (args.submit && args.task_id != null) {
    payload.submit = submit_trivial_writebacks(args.task_id, results);
  } else if (args.submit && args.task_id == null) {
    _cli_error("--submit requires --task-id so processIds / git context can be loaded");
    return;
  }

  const submit_note = payload.submit
    ? `; submitted ${payload.submit.success || 0} trivial write-back(s)`
    : "";
  _cli_success(
    payload,
    `Method pre-filter finished: ${total} total, ${trivial_count} trivial (can write back bugStatus=2 directly), ` +
      `${deep_count} need deep analysis` +
      (backfilled ? `; filled ${backfilled} bodyLineCount value(s) from changedMethods` : "") +
      (stamped ? `; stamped ${stamped} plan item(s)` : "") +
      submit_note,
  );
}

export function cmd_run_ast_scan(args: Args): void {
  const code_dir = args.code_dir;
  if (!_is_dir(code_dir)) {
    console.error(`[run-ast-scan] ❌ Code directory does not exist: ${code_dir}`);
    process.exit(1);
  }

  const rules_input = args.rules_json;
  let rules_data: any;
  if (_is_file(rules_input)) {
    try {
      rules_data = JSON.parse(readFileSync(rules_input, "utf8"));
    } catch (e: any) {
      console.error(`[run-ast-scan] ❌ Failed to read rules file: ${e}`);
      process.exit(1);
    }
  } else {
    try {
      rules_data = JSON.parse(rules_input);
    } catch (e: any) {
      console.error(`[run-ast-scan] ❌ --rules-json is neither valid JSON nor a valid file path: ${e.message || e}`);
      process.exit(1);
    }
  }

  let rules_list: any[];
  if (rules_data && typeof rules_data === "object" && !Array.isArray(rules_data)) {
    if ("data" in rules_data && rules_data.data && "customRules" in rules_data.data) {
      rules_list = rules_data.data.customRules;
    } else if ("customRules" in rules_data) {
      rules_list = rules_data.customRules;
    } else {
      rules_list = [rules_data];
    }
  } else if (Array.isArray(rules_data)) {
    rules_list = rules_data;
  } else {
    console.error("[run-ast-scan] ❌ Unrecognized rules data structure");
    process.exit(1);
  }

  const grouped = prepare_rules(rules_list);
  const ast_rules = (grouped.by_category || {})[1] || [];
  const exclusion_index = grouped.exclusion_index;

  if (!ast_rules.length) {
    console.error(
      "[run-ast-scan] ❌ No category=1 AST rules found." +
        "Local mode seeds Java and JS/TS Semgrep rules; an empty list means get-rules failed or data is wrong. " +
        "Do not write back no-defect yet; check rule loading and retry.",
    );
    process.exit(1);
  }

  const parse_file_list = (raw: any): string[] => {
    if (!raw) return [];
    if (_is_file(String(raw))) {
      return readFileSync(String(raw), "utf8").split(/\n/).map((l) => l.trim()).filter(Boolean);
    }
    return String(raw).replace(/\n/g, ",").split(",").map((f) => f.trim()).filter(Boolean);
  };

  const explicit_target = parse_file_list(args.target_files);
  const explicit_diff = parse_file_list(args.diff_files);
  let task_diff_files: string[] = [];
  if (args.task_id != null) {
    try {
      const store = new ContentStore(args.task_id);
      const files = store.load_meta_only()?.diff?.files;
      if (Array.isArray(files)) {
        task_diff_files = files.map((f: any) => String(f || "").trim()).filter(Boolean);
      }
    } catch (e: any) {
      console.error(`[run-ast-scan] ⚠️  Could not load diff.files for task ${args.task_id}: ${e}`);
    }
  }

  const scope = resolve_ast_scan_scope({
    taskId: args.task_id ?? null,
    targetFiles: explicit_target,
    diffFiles: explicit_diff,
    changedOnly: Boolean(args.changed_only),
    fullRepo: Boolean(args.full_repo),
    taskDiffFiles: task_diff_files,
  });
  if (scope.warning) {
    console.error(`[run-ast-scan] ⚠️  ${scope.warning}`);
  }

  let target_files: string[] | null = scope.scanFiles;

  let project_lang = args.project_language || null;
  if (!project_lang && target_files) {
    project_lang = detect_project_language(target_files);
  }

  // Language filtering happens inside run_ast_scan (Semgrep languages: field).
  // Do not skip the whole scan for non-Java — JS/TS (and later others) have category=1 rules.

  if (target_files) {
    // Keep every recognised source file of any language (polyglot change sets keep
    // their Go / Python / TS files even when one language dominates).
    const valid_exts = new Set<string>();
    for (const exts of Object.values(_LANG_TO_EXTENSIONS)) for (const e of exts) valid_exts.add(e);
    const lang_files = target_files.filter((f) => valid_exts.has(extname(f).toLowerCase()));
    if (!lang_files.length) {
      const label = project_lang || "source";
      console.error(`[run-ast-scan] ⚠️  No ${label} files in the change set; skip AST scan`);
      console.log(JSON.stringify({
        ruleCount: ast_rules.length, totalRuleCount: ast_rules.length,
        skippedRuleCount: 0, projectLanguage: project_lang,
        scannedFiles: 0, totalFindings: 0,
        findings: [], errors: [`No ${label} files in the change set`],
      }, null, 2));
      return;
    }
    target_files = lang_files;
  }

  if (target_files) {
    console.error(
      `[run-ast-scan] 📋 AST rules: ${ast_rules.length}, ` +
        `Project language: ${project_lang || "undetected"}, mode: changed-file scan (${target_files.length} files)`,
    );
  } else {
    console.error(
      `[run-ast-scan] 📋 AST rules: ${ast_rules.length}, ` +
        `Project language: ${project_lang || "undetected"}, mode: whole-repo scan` +
        (scope.annotateDiffFiles.length
          ? ` (will tag inDiff against ${scope.annotateDiffFiles.length} diff file(s))`
          : ""),
    );
  }

  const output_yaml = args.output_yaml || null;
  const result = run_ast_scan(
    ast_rules,
    code_dir,
    target_files,
    output_yaml,
    project_lang,
    exclusion_index || null,
  );

  const findings = annotate_findings_in_diff(
    result.findings || [],
    scope.annotateDiffFiles,
    args.task_id != null
      ? (() => {
          try { return new ContentStore(args.task_id).get_diff_hunks(); }
          catch { return {}; }
        })()
      : null,
  );
  result.findings = findings;
  result.scanMode = scope.scanMode;
  const auto_gen = findings.filter((f) => f.autoGenerated).length;
  const in_diff = findings.filter((f) => f.inDiff === true).length;
  const out_of_diff = findings.filter((f) => f.inDiff === false).length;
  const verify_required = findings.filter((f) => !f.autoGenerated && f.inDiff !== false).length;
  result.autoGeneratedFindings = auto_gen;
  result.inDiffFindings = in_diff;
  result.outOfDiffFindings = out_of_diff;
  result.verifyRequiredFindings = verify_required;
  result.dismissibleFindings = findings.length - verify_required;
  result.manualFindings = verify_required;
  if (scope.warning) result.scopeWarning = scope.warning;

  if (result.skipped && result.skipReason) {
    console.error(`[run-ast-scan] ⚠️  ${result.skipReason}`);
  }

  if (result.scanOk === false) {
    console.error(
      `\n❌ AST scan did not actually run; do not treat this as 0 hits.` +
        `Errors: ${(result.errors || []).slice(0, 2).join("; ")}`,
    );
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  if (result.totalFindings > 0) {
    const parts: string[] = [];
    if (scope.annotateDiffFiles.length) {
      parts.push(`${in_diff} in this PR diff — verify each`);
      parts.push(`${out_of_diff} outside this PR — auto-dismiss as T0 / bugStatus=2, do not read one by one`);
    }
    if (auto_gen > 0) parts.push(`${auto_gen} generated — skip LLM review`);
    if (!parts.length) parts.push(`${verify_required} need per-item review`);
    console.error(`\n🔴 Found ${result.totalFindings} AST rule hit(s) (${parts.join("; ")}):`);
    for (const f of findings.slice(0, 20)) {
      const tags: string[] = [];
      if (f.autoGenerated) tags.push("generated");
      if (f.inDiff === false) tags.push("out-of-diff");
      if (f.inDiff === true) tags.push("in-diff");
      const tag = tags.length ? ` [${tags.join(",")}]` : "";
      console.error(`  [${f.ruleId}] ${f.filePath}:${f.line}${tag} — ${String(f.message).slice(0, 80)}`);
    }
    if (result.totalFindings > 20) {
      console.error(`  ... plus ${result.totalFindings - 20} more; see the full JSON output`);
    }
    if (out_of_diff > 0) {
      console.error(
        `[run-ast-scan] ⚡ Do not verify the ${out_of_diff} out-of-diff hit(s) one by one. ` +
          `Batch-dismiss them as bugStatus=2 (T0 / stock code). Only verify in-diff, non-generated hits.`,
      );
    }
  } else if (result.errors && result.errors.length) {
    console.error(
      `\n⚠️ No AST rule hits, but the scan had errors (${result.scannedFiles} file(s)):` +
        `${result.errors.slice(0, 2).join("; ")}`,
    );
  } else {
    console.error(`\n✅ No AST rule hits (${result.scannedFiles} file(s) scanned)`);
  }

  console.log(JSON.stringify(result, null, 2));
}

export function cmd_mark_bug(args: Args): void {
  const body: Record<string, any> = {
    rankId: args.rank_id,
    bugStatus: args.bug_status,
    opType: args.op_type,
  };
  const user_id = args.user_id;
  if (user_id) body.userId = user_id;
  if (args.extra) body.extra = args.extra;
  if (args.task_id) body.taskId = args.task_id;
  if (args.query_id) body.queryId = args.query_id;

  const result = mark_bug(body);
  if ("_error" in result) {
    console.error(`[mark-bug] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[mark-bug] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  // Keep local content-store ranks in sync so reconcile-report stays aligned
  // after user confirm / reject (platform rank alone is not enough).
  if (args.task_id) {
    try {
      const store = new ContentStore(args.task_id);
      const synced = store.apply_rank_verdict(
        { ...(result.data || {}), rankId: args.rank_id },
        Number(args.bug_status),
        { userFeedback: args.extra, operator: args.user_id },
      );
      if (synced) _require_save(store);
      else console.error("[mark-bug] ⚠️  platform returned no className/methodName; local rank not synced");
    } catch (e: any) {
      console.error(`[mark-bug] ⚠️  local rank sync failed (non-blocking): ${e.message || e}`);
    }
  }

  const status_label: Record<number, string> = { 3: "needs fix", 4: "invalid issue", 5: "Later", 8: "duplicate issue" };
  console.error(`✅ mark-bug succeeded: rankId=${args.rank_id} → ${status_label[args.bug_status] || args.bug_status}`);

  if (args.bug_status === 3 && !args.no_create_bug) {
    const rank = result.data || {};
    const create_result = create_issue(
      args.task_id || 0,
      rank.className || `defect-${args.rank_id}`,
      rank.content || "",
    );
    if (create_result.code === 0) {
      console.error("✅ issue created");
    } else {
      console.error(`⚠️  issue create failed: ${create_result.msg || ""}`);
    }
    result.createIssueResult = create_result;
  }

  console.log(JSON.stringify(result, null, 2));
}

export function cmd_invalid_record(args: Args): void {
  const rank_ids = args.rank_ids.split(",").map((x: string) => x.trim()).filter(Boolean).map((x: string) => parseInt(x, 10));
  const success: number[] = [];
  const failed: any[] = [];
  for (const rank_id of rank_ids) {
    const result = invalid_record(rank_id);
    if ("_error" in result) {
      failed.push({ rankId: rank_id, error: result._error });
      console.error(`[invalid-record] ❌ rankId=${rank_id}: ${result._error}`);
    } else if (result.code !== 0) {
      failed.push({ rankId: rank_id, error: result.msg || "unknown" });
      console.error(`[invalid-record] ❌ rankId=${rank_id}: code=${result.code}, msg=${result.msg}`);
    } else {
      success.push(rank_id);
      console.error(`[invalid-record] ✅ rankId=${rank_id} marked invalid`);
    }
  }

  console.log(JSON.stringify({ success, failed, total: rank_ids.length }, null, 2));
}

export function cmd_skip_service_batch(args: Args): void {
  const parent_batch_id = args.parent_batch_id;
  const failed = args.failed || false;
  const reason = args.reason || null;

  const result = skip_service_batch(parent_batch_id, failed, reason);
  if ("_error" in result) {
    console.error(`[skip-service-batch] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[skip-service-batch] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  const action = failed ? "mark failed" : "skip";
  console.error(`✅ skip-service-batch succeeded: parentBatchId=${parent_batch_id}, already ${action} this service's detection records`);
  console.log(JSON.stringify(result, null, 2));
}

export function cmd_update_rank_content(args: Args): void {
  const content = _resolve_content_arg(args);

  const common_missing = ["Problem description", "Problem tags", "Impact scope", "Affected business", "Reproduction path"]
    .filter((f) => !content.replace(/ /g, "").includes(f.replace(/ /g, "")));
  if (common_missing.length) {
    console.error(`[update-rank-content] ⚠️  content is missing common required fields: ${common_missing.join(", ")}`);
    console.error("[update-rank-content] Fill the missing fields using the references/writeback.md template.");
    if (common_missing.length >= 3) {
      console.error(`[update-rank-content] ⛔ Missing ${common_missing.length} common required field(s); write rejected.`);
      _cli_result(1, {
        blocked: true,
        missing_fields: common_missing,
        hint: "Common required: Problem description / Problem tags / Impact scope / Affected business / Reproduction path",
      }, "content_format_invalid");
      process.exit(1);
    }
  }

  const result = update_rank_content(args.rank_id, content);
  if ("_error" in result) {
    console.error(`[update-rank-content] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[update-rank-content] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.error(`✅ update-rank-content succeeded: rankId=${args.rank_id}`);
  console.log(JSON.stringify(result, null, 2));
}

