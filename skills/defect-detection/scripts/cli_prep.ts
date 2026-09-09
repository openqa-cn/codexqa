/**
 * Phase 1 prep commands: get-plan-info / get-pending / get-rules / check-coverage /
 * phase1-fetch-all / clone-and-diff / register-repo-clone / check-phase2-readiness /
 * get-tag-list / phase1-init
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  check_detection_coverage,
  get_ast_and_custom_rules,
  get_confirmed_defect_history,
  get_pending_processes,
  get_tag_list,
  get_task_status,
  report_progress,
  submit_detection,
  get_exception_traces,
} from "./platform.ts";
import {
  _cli_error,
  _cli_result,
  _cli_success,
  _inject_strategy_codes,
  _require_save,
  log_branch_normalization,
  normalize_branch_ref,
} from "./cli_common.ts";
import {
  type ResolvedLanguage,
  canonicalize_language,
  gotchas_doc_for_language,
  is_client_language,
  resolve_language,
  try_gitnexus_for_language,
} from "./lang.ts";
import { ContentStore, content_base_dir, repo_clone_base_dir } from "./store.ts";
import { run } from "./sys.ts";
import { IsolationError, isolate_if_foreign, log_isolation } from "./task_isolation.ts";
import { enrich_test_case_fields } from "./testcase_desc_parser.ts";
import {
  get_local_progress,
  has_repo_been_cloned,
  register_repo_clone,
  register_pending_batch,
  register_pending_method,
} from "./state.ts";
import { get_issues, get_plan, get_testcases } from "./providers/registry.ts";
import { flatten_tag_ids } from "./providers/platform/seed_catalog.ts";
import { ingest_resolved_materials, resolve_plan_info } from "./ingest.ts";
import { ensure as ensure_gitnexus, run_cli as gitnexus_run_cli } from "./gitnexus.ts";
import { restamp_plan_relevance, run_prep_and_plan } from "./cli_auto.ts";

type Args = Record<string, any>;

function _is_dir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function stamp_service_clone_meta(
  task_id: number,
  git_url: string,
  local_dir: string,
  branch: string,
  commit_id: string,
  language?: ResolvedLanguage | null,
  batch_id?: number | null,
): void {
  try {
    const store = new ContentStore(task_id);
    let svc = store.get_service_by_git_url(git_url);
    if (!svc) {
      // submit-plan does not register services; create the record here so the
      // resolved language and clone metadata have somewhere to live.
      svc = { gitUrl: git_url, branch, batchIds: batch_id ? [batch_id] : [] };
    }
    if (commit_id) svc.commitId = commit_id;
    if (local_dir) svc.localDir = local_dir;
    if (branch) svc.branch = branch;
    if (language) {
      svc.language = language.language;
      svc.languageSource = language.source;
      svc.languageBreakdown = language.breakdown;
    }
    store.add_or_update_service(svc);
    store.save();
  } catch (exc: any) {
    console.error(`[clone] ⚠️  failed to stamp service commitId/localDir/language: ${exc?.message || exc}`);
  }
}

function _declared_service_language(task_id: number, git_url: string): { language: string | null; source: string | null } {
  try {
    const svc = new ContentStore(task_id).get_service_by_git_url(git_url);
    return { language: svc?.language || null, source: svc?.languageSource || null };
  } catch {
    return { language: null, source: null };
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

export function cmd_get_plan_info(args: Args): void {
  const resolved = resolve_plan_info(args.plan_id, args.plan_type, args);
  const data = resolved.data;
  if (args.task_id && resolved.hasUserMaterials) {
    const ingested = ingest_resolved_materials(args.task_id, resolved);
    data._ingested = ingested;
    console.error(
      `[get-plan-info] wrote user materials to content store: ` +
        `cases=${ingested.cases || 0} docs=${ingested.docs || 0}`,
    );
  }

  if (resolved.degraded) {
    console.error(
      `[get-plan-info] ⚠️  plan provider has no record (source=${resolved.source}), ` +
        `fell back to merging user/content store materials`,
    );
  }
  if (resolved.blocking) {
    console.error("[get-plan-info] ⛔ hard gate not met; send the following to the user verbatim and wait for a reply before clone:");
  } else if (resolved.recommended) {
    console.error("[get-plan-info] ask the user once for the following materials (reply \"skip\" to continue):");
  }
  for (const item of resolved.askUser || []) {
    console.error(`[get-plan-info] [${item.level}] ${item.label}: ${item.prompt}`);
  }

  const test_case_ids = data.testCaseIds || [];
  const issue_list = data.issueList || [];
  const services = data.services || [];

  let is_client_app = false;
  if (!services.length) {
    is_client_app = true;
  } else if (services.some((svc: any) => is_client_language(svc.language))) {
    is_client_app = true;
  }

  if (is_client_app && !test_case_ids.length && !issue_list.length) {
    console.error(
      "[get-plan-info] ⚠️  detected a client app and test-case info is empty, " +
        "recommend running the following command as a test-case fallback:",
    );
    console.error(`  node detect.ts fetch-test-cases --task-id <TASK_ID> --plan-id ${args.plan_id}`);
    console.error("[get-plan-info] this command auto-discovers test cases and requirement docs via plan / test-case / issue providers");
    data._needsCaseFallback = true;
    data._isClientApp = true;
  }

  console.log(JSON.stringify({
    code: 0,
    msg: !resolved.degraded ? "success" : "degraded",
    data,
    source: resolved.source,
    degraded: resolved.degraded,
    hasUserMaterials: resolved.hasUserMaterials,
    missing: resolved.missing,
    blocking: resolved.blocking || [],
    recommended: resolved.recommended || [],
    optionalMissing: resolved.optionalMissing || [],
    askUser: resolved.askUser || [],
    nextActions: resolved.nextActions,
  }, null, 2));
}

export function cmd_check_materials(args: Args): void {
  const resolved = resolve_plan_info(
    args.plan_id ?? null,
    args.plan_type || 2,
    args,
  );
  const blocking = resolved.blocking || [];
  if (blocking.length) {
    console.error("[check-materials] ⛔ hard-gate materials missing; ask the user first, do not start clone:");
  } else if (resolved.recommended) {
    console.error("[check-materials] ask the user to supply the following materials (if they say skip, continue):");
  }
  for (const item of resolved.askUser || []) {
    console.error(`[check-materials] [${item.level}] ${item.label}: ${item.prompt}`);
  }
  _cli_result(
    0,
    {
      blocking,
      recommended: resolved.recommended || [],
      optionalMissing: resolved.optionalMissing || [],
      askUser: resolved.askUser || [],
      source: resolved.source,
      canStart: !blocking.length,
    },
    blocking.length ? "materials incomplete" : "materials sufficient to start",
  );
}

export function cmd_extract_client_plan_info(args: Args): void {
  const resolved = resolve_plan_info(args.plan_id, args.plan_type || 2, args);
  const data = resolved.data || {};
  const services = [...(data.services || [])];
  const first = services.length && typeof services[0] === "object" ? services[0] : {};
  const git = args.git || first.git || first.gitUrl || "";
  const branch = args.branch || first.branch || first.developBranch || "";
  const auto = Boolean(git);
  if (args.task_id && git) {
    const payload = {
      gitUrl: git,
      git,
      branch,
      serviceKey: "client_plan",
      language: first.language || "javascript",
    };
    if (!data.services) data.services = [];
    if (!data.services.some((s: any) => s && typeof s === "object" && (s.git || s.gitUrl) === git)) {
      data.services.push(payload);
    }
    resolved.data = data;
    resolved.hasUserMaterials = true;
    ingest_resolved_materials(args.task_id, resolved);
  }
  const out = {
    gitUrl: git,
    branch,
    isClientPlan: !services.length || auto,
    autoExtracted: auto,
    source: resolved.source,
    degraded: resolved.degraded,
    missing: auto ? [] : ["services"],
  };
  if (auto) {
    _cli_success(out, "client plan git/branch ready");
  } else {
    _cli_result(0, out, "client plan incomplete: ask the user for git+branch");
  }
}

export function cmd_get_pending(args: Args): void {
  const result = get_pending_processes(args.batch_id);
  if ("_error" in result) {
    console.error(`[get-pending] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[get-pending] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  let data: any = result.data || [];

  if (data && typeof data === "object" && !Array.isArray(data)) {
    let found = false;
    for (const key of ["processes", "list", "records", "items"]) {
      if (Array.isArray(data[key])) {
        data = data[key];
        found = true;
        break;
      }
    }
    if (!found) data = [];
  } else if (!Array.isArray(data)) {
    data = [];
  }

  // Prefer the explicit --task-id: local pending items do not always carry taskId,
  // and a null taskId makes the pending_cache batch entry unusable for finalize-all.
  const task_id = args.task_id ?? (data.length ? data[0].taskId ?? null : null);
  const batch_id = args.batch_id;

  const first = data.length ? data[0] : {};
  const git_url = first.git || "";
  const branch = first.branch || "";
  const commit_id = first.commitId || "";
  try {
    register_pending_batch(task_id, batch_id, git_url, branch, commit_id);
    console.error(`[get-pending] 📝 pending_cache: wrote batchId=${batch_id} git=${git_url} branch=${branch}`);
  } catch (e: any) {
    console.error(`[get-pending] ⚠️  pending_cache write failed (does not affect the main flow): ${e}`);
  }

  let registered = 0;
  for (const item of data) {
    try {
      register_pending_method(
        task_id,
        batch_id,
        item.className || "",
        item.methodName || "",
        item.strategyCode,
        item.processId || null,
      );
      registered += 1;
    } catch (e: any) {
      console.error(`[get-pending] ⚠️  pending_cache method write failed ${item.className}: ${e}`);
    }
  }
  console.error(`[get-pending] 📝 pending_cache: wrote ${registered} method mappings`);

  if (args.skip_local_done) {
    const _skip_task_id = args.task_id ?? null;
    const progress = _skip_task_id ? get_local_progress(_skip_task_id) : {};
    const written = progress.writtenProcesses || {};
    const batch_key = String(args.batch_id);
    const done_keys = new Set(Object.keys(written[batch_key] || {}));
    if (done_keys.size) {
      const before = data.length;
      data = data.filter((item: any) =>
        !done_keys.has(`${item.className || ""}#${item.methodName || ""}#${item.strategyCode ?? ""}`),
      );
      console.error(`[get-pending] 🔄 local filter: ${before} → ${data.length} (skipped ${before - data.length} already done)`);
      result.data = data;
    }
  }

  if (args.group_by_class) {
    const class_map: Record<string, any> = {};
    for (const item of data) {
      const class_name = item.className || "_unknown_";
      if (!(class_name in class_map)) {
        class_map[class_name] = {
          className: class_name,
          methods: [],
          totalCount: 0,
          processId: item.processId,
          taskId: item.taskId,
          parentBatchId: item.parentBatchId,
          git: item.git,
          branch: item.branch,
          commitId: item.commitId,
        };
      }
      class_map[class_name].methods.push(item);
      class_map[class_name].totalCount += 1;
    }

    const grouped_data = Object.values(class_map);
    console.error(`[get-pending] 📋 classes to detect: ${grouped_data.length}, methods: ${data.length}`);
    console.log(JSON.stringify({
      code: 0,
      msg: "success",
      data: grouped_data,
      _meta: {
        mode: "grouped_by_class",
        classCount: grouped_data.length,
        methodCount: data.length,
      },
    }, null, 2));
  } else {
    console.error(`[get-pending] 📋 pending items: ${data.length}`);
    console.log(JSON.stringify(result, null, 2));
  }
}

export function cmd_get_rules(args: Args): void {
  const git_url = args.git ?? null;
  const user_id = args.user_id ?? null;
  if (!git_url && !user_id) {
    console.error("[astAndCustomRules] ❌ pass at least one of --git and --user-id");
    process.exit(1);
  }

  if (git_url && !user_id) {
    console.error(
      "[astAndCustomRules] ⚠️  only --git was passed (no --user-id). " +
        "The function will fill userId from the auth provider / DETECTION_USER; if unset, " +
        "customRules (custom rules) may be empty. Pass both --git and --user-id.",
    );
  } else if (user_id && !git_url) {
    console.error(
      "[astAndCustomRules] ⚠️  only --user-id was passed (no --git). " +
        "customRules (custom rules) may be empty. " +
        "Pass both --git and --user-id, for example: " +
        "  node detect.ts get-rules --git <ssh://git@...> --user-id <your_user_id>",
    );
  }

  const result = get_ast_and_custom_rules(git_url, user_id);

  if ("_error" in result) {
    console.error(`[astAndCustomRules] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[astAndCustomRules] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }

  const data = result.data || {};
  const custom_rules = data.customRules || [];

  if (args.task_id != null) {
    const store = new ContentStore(args.task_id);
    _persist_phase1_catalog(store, null, result);
    _require_save(store);
    console.error(`[get-rules] 🗂️ rules persisted into task ${args.task_id}`);
  }

  const cat_count: Record<string, number> = {};
  for (const r of custom_rules) {
    const cat = r.category;
    cat_count[String(cat)] = (cat_count[String(cat)] || 0) + 1;
  }
  const CAT_LABEL: Record<string, string> = {
    "1": "AST/Semgrep rules",
    "2": "custom AI rules",
    "3": "exclusion rules",
    "4": "system/generic rules",
  };
  console.error(`${custom_rules.length} rules in total:`);
  for (const cat of Object.keys(cat_count).sort((a, b) => Number(a) - Number(b))) {
    console.error(`  category=${cat} (${CAT_LABEL[cat] || "unknown"}): ${cat_count[cat]}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

export function cmd_check_coverage(args: Args): void {
  const result = check_detection_coverage(args.batch_id);
  if ("_error" in result) {
    console.error(`[check-coverage] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[check-coverage] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

function _tag_cache_path(): string {
  return join(content_base_dir(), "_tag_cache.json");
}

function _load_tag_cache(max_age_hours = 24): any[] | null {
  const cache_path = _tag_cache_path();
  if (!_is_file(cache_path)) return null;
  try {
    const cache = JSON.parse(readFileSync(cache_path, "utf8"));
    const cached_at = cache.cachedAt || 0;
    if (Date.now() / 1000 - cached_at > max_age_hours * 3600) return null;
    return cache.tags;
  } catch {
    return null;
  }
}

function _save_tag_cache(tags: any[]): void {
  const cache_path = _tag_cache_path();
  mkdirSync(dirname(cache_path), { recursive: true });
  const cache = {
    cachedAt: Date.now() / 1000,
    tagCount: tags.length,
    tags,
  };
  try {
    writeFileSync(cache_path, JSON.stringify(cache), "utf8");
  } catch (e: any) {
    console.error(`[tag-cache] ⚠️  cache write failed: ${e}`);
  }
}

function _persist_phase1_catalog(
  store: ContentStore,
  tags_data: any = null,
  rules_payload: any = null,
  history_payload: any = null,
): void {
  if (tags_data) {
    store.set_meta("tags", tags_data);
    store.set_meta("tagIds", flatten_tag_ids(tags_data));
  }
  if (rules_payload) {
    const data = (rules_payload && typeof rules_payload === "object")
      ? (rules_payload.data ?? rules_payload)
      : rules_payload;
    if (data) store.set_meta("rules", data);
  }
  if (history_payload) {
    const hist = (history_payload && typeof history_payload === "object")
      ? (history_payload.data ?? history_payload)
      : history_payload;
    if (hist) store.set_meta("historyDefects", hist);
  }
}

export function cmd_phase1_fetch_all(args: Args): void {
  const task_id = args.task_id;
  const git_url = args.git_url;
  const user_id = args.user_id || "";
  const plan_id = args.plan_id ?? null;

  const results: Record<string, any> = {};
  const errors: string[] = [];
  let tags_from_cache = false;

  function fetch_tags(): [string, any, boolean] | [string, any] {
    const cached = _load_tag_cache();
    if (cached != null) return ["tags", cached, true];
    const tags = get_tag_list();
    if (tags) _save_tag_cache(tags);
    return ["tags", tags, false];
  }

  function fetch_rules(): [string, any] {
    return ["rules", get_ast_and_custom_rules(git_url, user_id)];
  }

  function fetch_history(): [string, any] {
    return ["history", get_confirmed_defect_history(git_url)];
  }

  function fetch_traces(): [string, any] {
    if (!plan_id) return ["traces", { code: 0, data: [], msg: "plan_id not provided, skip" }];
    return ["traces", get_exception_traces(plan_id)];
  }

  for (const fn of [fetch_tags, fetch_rules, fetch_history, fetch_traces]) {
    try {
      const result_tuple: any = fn();
      if (result_tuple.length === 3) {
        const [key, value, fromCache] = result_tuple;
        tags_from_cache = fromCache;
        results[key] = value;
      } else {
        const [key, value] = result_tuple;
        results[key] = value;
      }
    } catch (e: any) {
      errors.push(`${fn.name}: ${String(e).slice(0, 200)}`);
    }
  }

  const output: Record<string, any> = { taskId: task_id, gitUrl: git_url };

  const tags_data = results.tags || [];
  if (tags_data && tags_data.length) {
    output.tagIds = flatten_tag_ids(tags_data);
    output.tagCount = output.tagIds.length;
    output.tagsLoaded = true;
    output.tagsFromCache = tags_from_cache;
  } else {
    output.tagsLoaded = false;
    errors.push("get-tag-list returned empty; check login state");
  }

  const rules_data = results.rules || {};
  if (rules_data.code === 0) {
    const data = rules_data.data || {};
    const custom_rules = data.customRules || [];
    output.rulesLoaded = true;
    output.totalRules = custom_rules.length;
    const cat_counts: Record<string, number> = {};
    for (const r of custom_rules) {
      const cat = r.category ?? -1;
      cat_counts[cat] = (cat_counts[cat] || 0) + 1;
    }
    output.rulesByCategory = cat_counts;
    output.rulesData = rules_data;
  } else {
    output.rulesLoaded = false;
    errors.push(`get-rules failed: ${rules_data._error || rules_data.msg}`);
  }

  const history_data = results.history || {};
  if (history_data.code === 0) {
    const hist_list = history_data.data || [];
    output.historyLoaded = true;
    output.historyCount = hist_list.length;
    output.historyData = history_data;
  } else if ("_error" in history_data) {
    output.historyLoaded = false;
    errors.push(`get-confirmed-defect-history failed: ${history_data._error}`);
  } else {
    output.historyLoaded = true;
    output.historyCount = 0;
    output.historyData = history_data;
  }

  const traces_data = results.traces || {};
  if (traces_data.code === 0) {
    const trace_list = traces_data.data || [];
    output.tracesLoaded = true;
    output.tracesCount = Array.isArray(trace_list) ? trace_list.length : 0;
    output.tracesData = traces_data;
  } else {
    output.tracesLoaded = plan_id == null;
    if (plan_id) {
      errors.push(`get-exception-traces failed: ${traces_data._error || traces_data.msg}`);
    }
  }

  output.errors = errors;

  try {
    const store = new ContentStore(task_id);
    _persist_phase1_catalog(
      store,
      tags_data && tags_data.length ? tags_data : null,
      output.rulesLoaded ? rules_data : null,
      output.historyLoaded ? history_data : null,
    );
    _require_save(store);
    output.persisted = true;
  } catch (exc: any) {
    output.persisted = false;
    errors.push(`persist catalog: ${exc}`);
    output.errors = errors;
  }

  const critical_ok = output.tagsLoaded && output.rulesLoaded;
  if (critical_ok) {
    _cli_success(
      output,
      `Phase 1 data fetch complete: tags=${output.tagCount || 0}, ` +
        `rules=${output.totalRules || 0}, ` +
        `history=${output.historyCount || 0}, ` +
        `traces=${output.tracesCount || 0}` +
        (errors.length ? `, warnings: ${errors.length}` : ""),
    );
  } else {
    _cli_result(1, output, `Phase 1 data fetch partially failed (critical items missing): ${errors.slice(0, 3).join("; ")}`);
  }
}

export function cmd_clone_and_diff(args: Args): void {
  let task_id = args.task_id;
  let batch_id = args.batch_id;
  const git_url = args.git_url;
  const branch = normalize_branch_ref(args.branch);
  if (!branch) {
    _cli_error(`--branch must name a branch (got ${JSON.stringify(args.branch ?? null)})`);
    return;
  }
  log_branch_normalization("clone-and-diff", "--branch", args.branch, branch);
  let iso: Record<string, any>;
  try {
    iso = isolate_if_foreign(task_id, { gitUrl: git_url, branch });
  } catch (exc: any) {
    if (exc instanceof IsolationError) {
      _cli_error(String(exc.message || exc));
    }
    throw exc;
  }
  log_isolation("clone-and-diff", iso);
  if (iso.remapped) {
    task_id = iso.taskId;
    if (iso.batchIds && iso.batchIds.length) {
      batch_id = iso.batchIds[0];
    }
  }

  let contrast_commit = (args.contrast_commit || "").trim() || null;
  let base_branch = normalize_branch_ref(args.base_branch);
  log_branch_normalization("clone-and-diff", "--base-branch", args.base_branch, base_branch);
  const diff_mode = args.diff_mode || "two-dot";
  // Before the diff exists we only know what the user or the plan said; the
  // final answer (incl. detection from changed files) is resolved after the diff.
  const explicit_language = canonicalize_language(args.language) || null;
  const declared = _declared_service_language(task_id, git_url);
  let language: string | null = explicit_language || declared.language;
  const is_client_repo = is_client_language(language);

  const repo_key = `${git_url.trim()}@${branch.trim()}`;
  const repo_hash = createHash("md5").update(repo_key, "utf8").digest("hex").slice(0, 12);
  const local_dir = join(repo_clone_base_dir(), repo_hash);

  function _git(...git_args: string[]): { returncode: number; stdout: string; stderr: string };
  function _git(git_args: string[], timeout?: number): { returncode: number; stdout: string; stderr: string };
  function _git(...all: any[]): { returncode: number; stdout: string; stderr: string } {
    let git_args: string[];
    let timeout = 60;
    if (all.length === 2 && Array.isArray(all[0])) {
      git_args = all[0];
      timeout = all[1] ?? 60;
    } else if (typeof all[all.length - 1] === "number" && all.length > 1 && typeof all[0] === "string") {
      // not used
      git_args = all.slice(0, -1);
      timeout = all[all.length - 1];
    } else {
      git_args = all;
    }
    return _spawn(["git", "-C", local_dir, ...git_args], timeout);
  }

  function _git_t(git_args: string[], timeout: number) {
    return _spawn(["git", "-C", local_dir, ...git_args], timeout);
  }

  function _remote_ref_exists(name: string): boolean {
    const r = _git_t(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`], 10);
    return r.returncode === 0 && !!r.stdout.trim();
  }

  /**
   * Resolve the repo's default branch, most authoritative source first, and
   * return null rather than guessing when every source fails — a wrong guess
   * surfaces later as an unresolvable base rev with no hint of what went wrong.
   * Candidate probing checks refs already in the clone before going to the
   * network, so a shallow or credential-limited clone still resolves.
   */
  function _detect_default_branch(): string | null {
    const attempts: string[] = [];

    // We clone with `--single-branch -b <branch>`, which points the local
    // origin/HEAD at that branch. Only trust it when it names something else,
    // otherwise the "default branch" would come back as the branch under test
    // and the diff against it would be empty.
    const r = _git_t(["symbolic-ref", "refs/remotes/origin/HEAD"], 15);
    if (r.returncode === 0 && r.stdout.trim()) {
      const name = normalize_branch_ref(r.stdout.trim());
      if (name && name !== branch) return name;
    }
    attempts.push("local origin/HEAD");

    const r2 = _spawn(["git", "ls-remote", "--symref", git_url, "HEAD"], 60);
    if (r2.returncode === 0) {
      for (const line of r2.stdout.split(/\n/)) {
        if (line.startsWith("ref:") && line.includes("\tHEAD")) {
          const name = normalize_branch_ref(line.split(/\s+/)[1]);
          if (name && name !== branch) return name;
        }
      }
    }
    attempts.push("ls-remote --symref HEAD");

    // Check refs already in the clone before the network, so a credential- or
    // depth-limited clone still resolves.
    const candidates = ["main", "master", "develop"].filter((c) => c !== branch);
    for (const cand of candidates) {
      if (_remote_ref_exists(cand)) return cand;
    }
    for (const cand of candidates) {
      const rr = _spawn(["git", "ls-remote", "--heads", git_url, cand], 60);
      if (rr.returncode === 0 && rr.stdout.trim()) return cand;
    }
    attempts.push(`candidates ${candidates.join("/") || "<none>"}`);

    console.error(`[clone-and-diff] ⚠️ default branch not resolvable (tried: ${attempts.join(", ")})`);
    return null;
  }

  if (_is_dir(join(local_dir, ".git"))) {
    const r = _git_t(["fetch", "origin", `${branch}:refs/remotes/origin/${branch}`], 120);
    if (r.returncode !== 0) {
      rmSync(local_dir, { recursive: true, force: true });
    } else {
      _git_t(["checkout", branch], 30);
      _git_t(["reset", "--hard", `origin/${branch}`], 30);
    }
  }

  if (!_is_dir(join(local_dir, ".git"))) {
    mkdirSync(dirname(local_dir), { recursive: true });
    let r = _spawn(["git", "clone", "--depth=200", "--single-branch", "-b", branch, git_url, local_dir], 300);
    if (r.returncode !== 0) {
      rmSync(local_dir, { recursive: true, force: true });
      r = _spawn(["git", "clone", "-b", branch, git_url, local_dir], 600);
      if (r.returncode !== 0) {
        _cli_error(`git clone failed: ${r.stderr.slice(0, 500)}`, { gitUrl: git_url, branch });
        return;
      }
    }
  }

  const rh = _git_t(["rev-parse", "HEAD"], 10);
  const commit_id = rh.returncode === 0 ? rh.stdout.trim() : "";

  let base_source: string | null = null;
  let base_rev: string | null = null;
  const fetch_errors: string[] = [];

  if (is_client_repo && !contrast_commit && !base_branch) {
    console.error(`[clone-and-diff] 📝 client repo (${language}) source-branch detection: computing merge-base`);
    const default_br = _detect_default_branch();
    const mb_result = default_br
      ? _git_t(["merge-base", `origin/${branch}`, `origin/${default_br}`], 15)
      : { returncode: 1, stdout: "", stderr: "" };
    if (mb_result.returncode === 0 && mb_result.stdout.trim()) {
      contrast_commit = mb_result.stdout.trim();
      console.error(`[clone-and-diff] ✓ computed merge-base as source: ${contrast_commit.slice(0, 8)}`);
    } else {
      base_branch = default_br;
      console.error(`[clone-and-diff] ⚠️ merge-base computation failed, falling back to default branch: ${default_br ?? "<unresolved>"}`);
    }
  } else if (is_client_repo && (contrast_commit || base_branch)) {
    console.error(`[clone-and-diff] ℹ️ client repo already has an explicit base (${contrast_commit || base_branch}), skip auto-detection`);
  }

  if (contrast_commit) {
    base_source = "contrast-commit";
    base_rev = contrast_commit;
    const fr = _git_t(["fetch", "origin", contrast_commit], 120);
    if (fr.returncode !== 0) {
      fetch_errors.push(`fetch contrast-commit: ${fr.stderr.trim().slice(0, 200)}`);
      _git_t(["fetch", "--unshallow"], 300);
    }
  } else {
    if (!base_branch) {
      base_branch = _detect_default_branch();
      if (!base_branch) {
        _cli_error(
          `could not determine a base branch to diff '${branch}' against: the remote HEAD is unreachable or points at ` +
            `'${branch}' itself, and none of main/master/develop exist. Pass --base-branch <branch> or --contrast-commit <sha>.`,
          {
            gitUrl: git_url, branch, localDir: local_dir, commitId: commit_id,
            baseSource: "default-branch(unresolved)",
          },
        );
        return;
      }
      base_source = `default-branch(${base_branch})`;
    } else {
      base_source = `base-branch(${base_branch})`;
    }
    const fr = _git_t(["fetch", "origin", `${base_branch}:refs/remotes/origin/${base_branch}`], 120);
    if (fr.returncode !== 0) {
      fetch_errors.push(`fetch base-branch '${base_branch}': ${fr.stderr.trim().slice(0, 200)}`);
    }
    base_rev = `origin/${base_branch}`;
  }

  const rv = _git_t(["rev-parse", "--verify", "--quiet", base_rev!], 15);
  if (rv.returncode !== 0 || !rv.stdout.trim()) {
    _cli_error(
      `base revision cannot be resolved: ${base_rev} (source: ${base_source}). ` +
        `Confirm contrast-commit/base-branch is correct, or that the repo default branch is reachable.`,
      {
        gitUrl: git_url, branch,
        baseSource: base_source, baseRev: base_rev,
        contrastCommit: contrast_commit, baseBranch: base_branch,
        localDir: local_dir, commitId: commit_id,
        fetchErrors: fetch_errors,
      },
    );
    return;
  }

  function _run_diff(...revs: string[]) {
    return _git_t(["diff", "--name-only", ...revs], 60);
  }

  const diff_errors: string[] = [];
  let primary: { returncode: number; stdout: string; stderr: string };
  let fallback: string[];
  if (diff_mode === "three-dot") {
    primary = _run_diff(`${base_rev}...HEAD`);
    fallback = [base_rev!, "HEAD"];
  } else {
    primary = _run_diff(base_rev!, "HEAD");
    fallback = [`${base_rev}...HEAD`];
  }

  let r = primary;
  if (r.returncode !== 0) {
    diff_errors.push(`${diff_mode}: ${r.stderr.trim().slice(0, 200)}`);
    r = _run_diff(...fallback);
  }
  if (r.returncode !== 0) {
    diff_errors.push(`fallback: ${r.stderr.trim().slice(0, 200)}`);
    const mb = _git_t(["merge-base", base_rev!, "HEAD"], 30);
    if (mb.returncode === 0 && mb.stdout.trim()) {
      r = _run_diff(mb.stdout.trim(), "HEAD");
    } else {
      diff_errors.push(`merge-base: ${mb.stderr.trim().slice(0, 200)}`);
    }
  }

  if (r.returncode !== 0) {
    _cli_error(
      "all git diff attempts failed; cannot get changed files. Confirm the base is correct and the repo has the base history.",
      {
        gitUrl: git_url, branch,
        baseSource: base_source, baseRev: base_rev,
        diffMode: diff_mode, localDir: local_dir,
        commitId: commit_id, diffErrors: diff_errors,
      },
    );
    return;
  }

  const diff_files = r.stdout.trim().split("\n").filter((f) => f.trim());

  const resolved_language = resolve_language({
    explicit: explicit_language,
    declared: declared.language,
    declaredSource: declared.source,
    files: diff_files,
  });
  language = resolved_language.language;
  if (resolved_language.note) {
    console.error(`[clone-and-diff] ℹ️ language: ${resolved_language.note}`);
  }
  console.error(
    `[clone-and-diff] language=${language} (source=${resolved_language.source}` +
      `${resolved_language.polyglot ? ", polyglot" : ""}; files by language: ${JSON.stringify(resolved_language.breakdown)})`,
  );

  try {
    const store = new ContentStore(task_id);
    store.set_diff_files(diff_files);
    store.set_meta("diffBase", {
      baseBranch: base_branch,
      contrastCommit: contrast_commit,
      baseSource: base_source,
      baseRev: base_rev,
      diffMode: diff_mode,
    });
    _require_save(store);
  } catch (exc: any) {
    console.error(`[clone-and-diff] ⚠️  failed to persist diff.files / diffBase: ${exc}`);
  }

  register_repo_clone(task_id, batch_id, git_url, local_dir, branch, commit_id);
  stamp_service_clone_meta(task_id, git_url, local_dir, branch, commit_id, resolved_language, batch_id);

  // Push the real baseline / commit to the platform task record (submit-git only had a
  // default for --contrast-branch); the report header and status read it from there.
  try {
    report_progress({
      taskId: task_id,
      currentPhase: "clone",
      contrastBranch: base_branch,
      contrastCommit: contrast_commit,
      commitId: commit_id,
      developBranch: branch,
    });
  } catch (exc: any) {
    console.error(`[clone-and-diff] ⚠️  could not refresh task baseline on the platform: ${exc?.message || exc}`);
  }

  const success_data: Record<string, any> = {
    taskId: task_id,
    batchId: batch_id,
    gitUrl: git_url,
    serviceKey: args.service_key ?? null,
    repoHash: repo_hash,
    localDir: local_dir,
    branch,
    baseBranch: base_branch,
    contrastCommit: contrast_commit,
    baseSource: base_source,
    baseRev: base_rev,
    diffMode: diff_mode,
    commitId: commit_id,
    diffFiles: diff_files,
    diffFileCount: diff_files.length,
    language,
    languageSource: resolved_language.source,
    languageBreakdown: resolved_language.breakdown,
    polyglot: resolved_language.polyglot,
    // STEP C notes for every language in the change set (the agent reads all of them).
    gotchasDocs: [...new Set(
      [language, ...Object.keys(resolved_language.breakdown || {})]
        .map((l) => gotchas_doc_for_language(l))
        .filter(Boolean) as string[],
    )],
    cloneRegistered: true,
  };
  if (iso.remapped) {
    success_data.remappedFrom = iso.remappedFrom;
    success_data.remapReason = iso.reason;
  }

  let msg: string;
  if (!diff_files.length) {
    success_data.warning = (
      `diff succeeded but no changed files were detected. ` +
      `This usually means branch '${branch}' matches the base (${base_source}=${base_rev}), ` +
      `or the base was chosen incorrectly. For frontend repos, confirm whether --contrast-commit (base commit) should be passed; ` +
      `for backend repos, confirm default-branch detection is correct (not necessarily master). ` +
      `If the platform shows pending changes, double-check the base setting.`
    );
    msg = (
      `clone + diff complete: 0 changed files ` +
      `(⚠️ no diff vs base ${base_source}=${String(base_rev).slice(0, 16)}; check the base setting), ` +
      `commitId=${commit_id.slice(0, 8)}, repoHash=${repo_hash}`
    );
  } else {
    msg = (
      `clone + diff complete: ${diff_files.length} changed files ` +
      `(base ${base_source}, ${diff_mode}), ` +
      `commitId=${commit_id.slice(0, 8)}, repoHash=${repo_hash}`
    );
  }

  if (try_gitnexus_for_language(language)) {
    const gn = ensure_gitnexus(false, local_dir, true);
    success_data.gitnexus = gn;
    if (gn.ready) {
      console.error("[clone-and-diff] GitNexus ready, analyze already ran");
    } else {
      console.error("[clone-and-diff] ⚠️  GitNexus unavailable; Phase 2 call-graph falls back to grep/find");
      if (gn.install && gn.install.error) {
        console.error(`[clone-and-diff] install result: ${gn.install.error}`);
      }
    }
    try {
      const store = new ContentStore(task_id);
      store.set_meta("gitnexus", {
        ready: Boolean(gn.ready),
        callGraph: gn.callGraph,
        fallback: gn.fallback,
        localDir: local_dir,
      });
      _require_save(store);
    } catch {
      // pass
    }
  }

  if (args.with_plan) {
    try {
      const planned = run_prep_and_plan({
        task_id,
        local_dir,
        batch_ids: batch_id ? String(batch_id) : undefined,
        submit_trivial: Boolean(args.submit_trivial),
      });
      success_data.prepAndPlan = planned;
      success_data.changedMethodCount = planned.changedMethodCount;
      success_data.detectionPlanTotal = planned.detectionPlanTotal;
      success_data.trivialCount = planned.trivialCount;
      success_data.deepAnalysisCount = planned.deepAnalysisCount;
      success_data.deepAnalysis = planned.deepAnalysis;
      if (planned.submit) success_data.trivialSubmit = planned.submit;
      msg += `; plan ${planned.detectionPlanTotal || 0} items (${planned.trivialCount || 0} trivial / ${planned.deepAnalysisCount || 0} deep)`;
    } catch (exc: any) {
      success_data.planError = String(exc && exc.message ? exc.message : exc);
      console.error(`[clone-and-diff] ⚠️  --with-plan failed: ${success_data.planError}`);
    }
  }

  _cli_success(success_data, msg);
}

export function cmd_ensure_gitnexus(args: Args): void {
  const result = ensure_gitnexus(
    Boolean(args.force_install),
    args.local_dir ?? null,
    !Boolean(args.no_analyze),
  );
  const task_id = args.task_id ?? null;
  if (task_id) {
    try {
      const store = new ContentStore(task_id);
      store.set_meta("gitnexus", {
        ready: Boolean(result.ready),
        callGraph: result.callGraph,
        fallback: result.fallback,
        localDir: args.local_dir || "",
      });
      _require_save(store);
    } catch {
      // pass
    }
  }
  if (result.ready) {
    _cli_success(result, "GitNexus ready");
  } else {
    _cli_result(0, result, "GitNexus unavailable; use grep/find for call-graph");
  }
}

function _gitnexus_local_dir(args: Args): string | null {
  let local_dir = args.local_dir || null;
  if (local_dir) return local_dir;
  const task_id = args.task_id ?? null;
  if (!task_id) return null;
  try {
    const store = new ContentStore(task_id);
    const gn = store.get_meta_field("gitnexus") || {};
    if (gn.localDir) return gn.localDir;
    const services = store.load_meta_only().services || [];
    for (const svc of services) {
      if (svc.localDir) return svc.localDir;
    }
  } catch {
    return null;
  }
  return null;
}

function _cmd_gitnexus_tool(args: Args, subcommand: string, extra: string[]): void {
  const local_dir = _gitnexus_local_dir(args);
  if (!local_dir) {
    _cli_error("missing --local-dir, and content store has no gitnexus.localDir / services.localDir");
    return;
  }
  if (!extra.includes("--repo")) {
    extra = ["--repo", basename(local_dir), ...extra];
  }
  const result = gitnexus_run_cli(subcommand, extra, local_dir);
  result.localDir = local_dir;
  if (result.ok) {
    _cli_success(result, `gitnexus ${subcommand} complete`);
  } else {
    _cli_result(1, result, result.error || `gitnexus ${subcommand} failed`);
  }
}

export function cmd_gitnexus_impact(args: Args): void {
  let target = args.target;
  if (String(target).includes("#")) {
    target = String(target).split("#").pop();
  }
  const extra = ["--direction", args.direction, "--depth", String(args.depth), target];
  _cmd_gitnexus_tool(args, "impact", extra);
}

export function cmd_gitnexus_context(args: Args): void {
  const extra: string[] = [];
  if (args.name) extra.push(args.name);
  if (args.file) extra.push("--file", args.file);
  if (args.content) extra.push("--content");
  _cmd_gitnexus_tool(args, "context", extra);
}

export function cmd_gitnexus_query(args: Args): void {
  const extra = [args.query];
  if (args.limit != null) extra.push("--limit", String(args.limit));
  _cmd_gitnexus_tool(args, "query", extra);
}

export function cmd_register_repo_clone(args: Args): void {
  const task_id = args.task_id;
  const batch_id = args.batch_id;
  const git_url = args.git_url;
  const local_dir = args.local_dir;
  const branch = args.branch;
  const commit_id = args.commit_id || "";

  register_repo_clone(task_id, batch_id, git_url, local_dir, branch, commit_id);
  // Manual registration path: resolve the language from whatever diff.files the
  // store already has, so the service record is never left language-less.
  let resolved: ResolvedLanguage | null = null;
  try {
    const declared = _declared_service_language(task_id, git_url);
    const files = new ContentStore(task_id).load_meta_only()?.diff?.files || [];
    resolved = resolve_language({ explicit: args.language, declared: declared.language, declaredSource: declared.source, files });
  } catch {
    resolved = null;
  }
  stamp_service_clone_meta(task_id, git_url, local_dir, branch, commit_id, resolved, batch_id);
  _cli_success(
    {
      taskId: task_id, batchId: batch_id, gitUrl: git_url, localDir: local_dir, branch, commitId: commit_id,
      language: resolved?.language ?? null, languageSource: resolved?.source ?? null,
    },
    `repo clone registered: batchId=${batch_id}, git=${git_url}`,
  );
}

export function cmd_check_phase2_readiness(args: Args): void {
  const task_id = args.task_id;
  const store = new ContentStore(task_id);
  const meta = store.load_meta_only();
  if (!meta.services) {
    _cli_error("content data does not exist or is not initialized; run Phase 1 init-content first");
    return;
  }

  const issues: string[] = [];
  const services = meta.services || [];
  if (!services.length) {
    issues.push("❌ services is empty: Phase 1 recorded no service info");
  }

  const global_diff_files = (meta.diff || {}).files || [];
  for (const svc of services) {
    const service_key = svc.serviceKey || "unknown";
    const git_url = svc.gitUrl || svc.git || "";
    let batch_id = svc.batchId;
    if (batch_id == null) {
      const batch_ids = svc.batchIds || [];
      batch_id = batch_ids.length ? batch_ids[0] : null;
    }

    if (batch_id && git_url) {
      if (!has_repo_been_cloned(batch_id, git_url, task_id)) {
        issues.push(
          `❌ code-clone gate not met: service ${service_key} (batch=${batch_id}) has no registered git clone. ` +
            `Run git clone first and register it with register-repo-clone. ` +
            `  git: ${git_url}`,
        );
      }
    } else if (!git_url) {
      issues.push(`⚠️ service ${service_key} is missing a git URL`);
    }

    if (!global_diff_files || !global_diff_files.length) {
      issues.push(`⚠️ service ${service_key} has no diff files recorded; confirm clone-and-diff has been run`);
    }
  }

  const meta_info = meta.meta || {};
  if (!store.get_meta_field("tagIds")) {
    issues.push("❌ tagIds is empty: run phase1-fetch-all --task-id <id> --git-url <url> (or get-tag-list --task-id <id>) first");
  }
  if (!store.get_meta_field("rules")) {
    issues.push("⚠️ rules not recorded in the task (non-blocking): phase1-fetch-all or get-rules --task-id <id> persists them");
  }

  const context_data = store.load_context_only();
  const documents = context_data.documents || {};
  const has_issues = Boolean(meta_info.issueCount || meta_info.issueList);
  const doc_summary_path = documents.summaryPath || "";
  const extracted_rules =
    store.get_meta_field("extractedRules", [])
    || documents.extractedRules
    || meta_info.extractedRules
    || [];

  if (has_issues || doc_summary_path) {
    if (!extracted_rules.length) {
      issues.push(
        "❌ docs were fetched but extractedRules is empty: Step 1.7 must parse business rules from the docs " +
          "and write them to content.json via set-meta-field --key extractedRules. " +
          "Empty rules disable later minDetectLevel / requirement-coverage checks / cross-validation.",
      );
    } else if (extracted_rules.length < 2) {
      issues.push(
        `⚠️ extractedRules has only ${extracted_rules.length} items; confirm document parsing is sufficient` +
          " (an iteration usually has 3+ business rules)",
      );
    }
  }

  const delivery_defects = context_data.deliveryDefects || [];
  if (!delivery_defects.length) {
    issues.push(
      "⚠️ submitted defects were not fetched: run get-delivery-defects --plan-id <id>" +
        " to pull defects already filed on the plan for Phase 2 cross-validation. Fetch failure can be ignored (non-blocking).",
    );
  }

  const test_cases = store.get_test_cases();
  const test_case_ids = meta_info.testCaseIds || [];
  if (test_case_ids.length && !test_cases.length) {
    issues.push(
      "❌ test-case IDs are recorded but case bodies were not fetched: run testcase-pipeline " +
        "--task-id <id> --plan-id <id> to fetch case bodies into the content store. " +
        "Missing bodies block strategy=11 business-knowledge comparison and triangle cross-checks.",
    );
  }

  if (test_cases.length) {
    const empty_body_cases = test_cases
      .filter((c: any) => !(c.preCondition || c.steps || c.expectedResult))
      .map((c: any) => c.id);
    if (empty_body_cases.length) {
      issues.push(
        `❌ test-case bodies are empty: ${empty_body_cases}. ` +
          "Run testcase-pipeline to trigger Node2 forced refill (empty-content forced refill); " +
          "if the test-case provider only returns desc rich text, testcase_desc_parser will parse and fill it. " +
          "Do not enter Phase 2 while bodies are empty.",
      );
    }
  }

  const client_languages_gate = services.some((svc: any) =>
    svc.serviceKey === "client_plan" || is_client_language(svc.language),
  );
  if (client_languages_gate && test_cases.length) {
    const failed_semantic_cases: any[] = [];
    const empty_obligation_cases: any[] = [];
    for (const caseObj of test_cases) {
      const status = caseObj.semanticReviewStatus;
      const case_id = caseObj.id;
      if (status === "no_assertion") continue;
      if (status !== "success" || caseObj.semanticReviewSkill !== "test-case-semantic-defect-review") {
        failed_semantic_cases.push(case_id);
      } else if (!caseObj.semanticContract || !caseObj.verificationObligations) {
        empty_obligation_cases.push(case_id);
      }
    }
    if (failed_semantic_cases.length) {
      issues.push(
        "❌ client test cases have not finished business-semantic compilation: " +
          `${failed_semantic_cases}. Call test-case-semantic-defect-review and upsert the result via ` +
          "add-test-case into test_cases.json; do not send the raw expectedResult for detection.",
      );
    }
    if (empty_obligation_cases.length) {
      issues.push(
        "❌ client case semantic results are missing semanticContract or verificationObligations: " +
          `${empty_obligation_cases}. Re-run test-case-semantic-defect-review.`,
      );
    }
  }

  // The plan is usually built by `clone-and-diff --with-plan` before docs / cases exist.
  // Now that Step 1.7 is done, re-stamp relevance + detectTier so T1/T2 gates apply.
  let plan_restamp: { updated: number; upgraded: string[] } = { updated: 0, upgraded: [] };
  try {
    plan_restamp = restamp_plan_relevance(store);
    if (plan_restamp.updated) {
      console.error(
        `[check-phase2-readiness] 🔁 re-stamped ${plan_restamp.updated} plan item(s) with doc/case relevance` +
          (plan_restamp.upgraded.length ? `; tier upgraded: ${plan_restamp.upgraded.join(", ")}` : ""),
      );
    }
  } catch (e: any) {
    issues.push(`⚠️ plan relevance re-stamp failed: ${e?.message || e}`);
  }

  const blocking = issues.filter((i) => i.startsWith("❌"));
  const warnings = issues.filter((i) => i.startsWith("⚠️"));

  if (blocking.length) {
    _cli_result(1, { issues, blocking, warnings, ready: false, planRestamped: plan_restamp.updated },
      `Phase 2 readiness check failed: ${blocking.length} blocking + ${warnings.length} warnings to handle`);
  } else if (warnings.length) {
    _cli_success({ ready: true, warnings, serviceCount: services.length, planRestamped: plan_restamp.updated, tierUpgraded: plan_restamp.upgraded },
      `Phase 2 readiness check passed (${warnings.length} suggestions, non-blocking)`);
  } else {
    _cli_success({ ready: true, serviceCount: services.length, planRestamped: plan_restamp.updated, tierUpgraded: plan_restamp.upgraded },
      "Phase 2 readiness check passed; all services are ready, detection can start");
  }
}

export function cmd_get_tag_list(args: Args): void {
  const tags = get_tag_list();
  if (!tags || !tags.length) {
    console.error("[get-tag-list] ❌ failed to fetch tag list or it is empty");
    process.exit(1);
  }
  if (args.task_id != null) {
    const store = new ContentStore(args.task_id);
    _persist_phase1_catalog(store, tags);
    _require_save(store);
    console.error(`[get-tag-list] 🗂️ tagIds persisted into task ${args.task_id}`);
  }
  console.log(JSON.stringify({ code: 0, data: tags, msg: `tag list loaded, ${tags.length} tags` }, null, 2));
}

export function cmd_phase1_init(args: Args): void {
  let task_id: any = null;
  const plan_id = args.plan_id;
  const plan_type = args.plan_type || 2;
  const submit_user = args.submit_user;
  let plan_name = args.plan_name || "";
  const resolved = resolve_plan_info(plan_id, plan_type, args);
  if (resolved.degraded) {
    console.error(
      `[phase1-init] ⚠️  plan provider has no record (source=${resolved.source}), ` +
        `continuing with user/content store materials`,
    );
  }

  console.error("[phase1-init] Step 1/4: submitting detection task...");
  const request_body: Record<string, any> = {
    detectType: "TEST_PLAN",
    planId: plan_id,
    planType: plan_type,
    submitUser: submit_user,
  };
  if (!plan_name) {
    plan_name = (resolved.data || {}).planName || "";
  }
  if (plan_name) request_body.planName = plan_name;

  let services_json = args.services_json || null;
  if (!services_json && (resolved.data || {}).services) {
    services_json = JSON.stringify(resolved.data.services);
  }
  if (services_json) {
    try {
      request_body.services = JSON.parse(services_json);
    } catch {
      // pass
    }
  }
  const strategy_codes = args.strategy_codes || null;
  const services_list = request_body.services || [];
  _inject_strategy_codes(request_body, strategy_codes, services_list, null, "TEST_PLAN");
  if (request_body.strategyCodes && request_body.strategyCodes.includes(10)) {
    console.error("[phase1-init] 🔍 injected frontend-only detection strategy (strategyCode=10)");
  }

  const result = submit_detection(request_body);
  if ("_error" in result) {
    _cli_error(`submit-plan failed: ${result._error}`, result);
    return;
  }

  let data = result.data || {};
  task_id = data.taskId;
  if (!task_id) {
    _cli_error("submit-plan succeeded but did not return taskId", result);
    return;
  }

  console.error(`[phase1-init] ✅ task submitted, taskId=${task_id}`);

  const incoming: Record<string, any> = {
    testPlanId: plan_id,
    planName: plan_name,
    userId: submit_user,
    planType: plan_type,
  };
  if (request_body.services) {
    const first = request_body.services[0] || {};
    incoming.gitUrl = first.gitUrl || first.git;
    incoming.branch = first.branch || first.developBranch;
  }
  let iso: Record<string, any>;
  try {
    iso = isolate_if_foreign(task_id, incoming);
  } catch (exc: any) {
    if (exc instanceof IsolationError) {
      _cli_error(String(exc.message || exc));
    }
    throw exc;
  }
  log_isolation("phase1-init", iso);
  if (iso.remapped) {
    task_id = iso.taskId;
    if (iso.batchIds) {
      data = { ...data, batchIds: iso.batchIds };
    }
  }

  console.error("[phase1-init] Step 2/4: initializing content.json...");
  const store = new ContentStore(task_id);
  store.set_meta("testPlanId", plan_id);
  store.set_meta("planName", plan_name);
  store.set_meta("userId", submit_user);
  if (resolved.hasUserMaterials || resolved.testCases) {
    const ingested = ingest_resolved_materials(task_id, resolved);
    console.error(
      `[phase1-init] wrote user materials: cases=${ingested.cases || 0} ` +
        `docs=${ingested.docs || 0}`,
    );
  }
  _require_save(store);

  if (services_json) {
    let services: any[] = [];
    try {
      services = JSON.parse(services_json);
    } catch {
      services = [];
    }
    console.error(`[phase1-init] Step 3/4: registering ${services.length} services...`);
    for (const svc of services) {
      try {
        store.add_or_update_service(svc);
      } catch (e: any) {
        console.error(`[phase1-init] ⚠️  service ${svc.gitUrl || "?"} registration failed: ${e}`);
      }
    }
    _require_save(store);
  } else {
    console.error("[phase1-init] Step 3/4: skip service registration (no --services-json)");
  }

  console.error("[phase1-init] Step 4/4: fetching prerequisite data in parallel...");
  let git_url = "";
  if (services_json) {
    let services: any[] = [];
    try {
      services = JSON.parse(services_json);
    } catch {
      services = [];
    }
    git_url = services.length ? (services[0].gitUrl || "") : "";
  }

  const user_id = submit_user;
  const fetch_errors: string[] = [];

  function fetch_tags(): [string, any, boolean] | [string, any] {
    const cached = _load_tag_cache();
    if (cached != null) return ["tags", cached, true];
    const tags = get_tag_list();
    if (tags) _save_tag_cache(tags);
    return ["tags", tags, false];
  }

  function fetch_rules(): [string, any] {
    try {
      return ["rules", get_ast_and_custom_rules(git_url, user_id)];
    } catch (e: any) {
      return ["rules_error", String(e)];
    }
  }

  function fetch_history(): [string, any] {
    try {
      return ["history", get_confirmed_defect_history(git_url)];
    } catch (e: any) {
      return ["history_error", String(e)];
    }
  }

  const fetch_results: Record<string, any> = {};
  let tags_from_cache = false;
  for (const fn of [fetch_tags, fetch_rules, fetch_history]) {
    try {
      const result_tuple: any = fn();
      if (result_tuple.length === 3) {
        const [key, value, fromCache] = result_tuple;
        tags_from_cache = fromCache;
        fetch_results[key] = value;
      } else {
        const [key, value] = result_tuple;
        fetch_results[key] = value;
      }
    } catch (e: any) {
      fetch_errors.push(String(e));
    }
  }

  const tags_data = fetch_results.tags || [];
  const rules_data = fetch_results.rules || {};
  const history_data = fetch_results.history || [];
  _persist_phase1_catalog(
    store,
    tags_data || null,
    rules_data || null,
    history_data || null,
  );

  if (fetch_errors.length) {
    console.error(`[phase1-init] ⚠️  some data fetches failed: ${fetch_errors}`);
  }

  _require_save(store);

  let batch_ids = data.batchIds || [];
  if (!batch_ids.length) {
    try {
      const status_result = get_task_status(task_id);
      batch_ids = status_result ? (status_result.batchIds || []) : [];
    } catch {
      batch_ids = [];
    }
  }

  const success_payload: Record<string, any> = {
    taskId: task_id,
    testPlanId: plan_id,
    planName: plan_name,
    batchIds: batch_ids,
    contentInitialized: true,
    servicesRegistered: Boolean(services_json),
    tagsLoaded: Boolean(tags_data && (Array.isArray(tags_data) ? tags_data.length : tags_data)),
    tagsFromCache: tags_from_cache,
    rulesLoaded: Boolean(rules_data && (typeof rules_data === "object" ? Object.keys(rules_data).length : rules_data)),
    historyLoaded: Boolean(history_data && (Array.isArray(history_data) ? history_data.length : history_data)),
    fetchErrors: fetch_errors,
    nextStep: "clone-and-diff → get-changed-methods → build-detection-plan",
  };
  if (iso.remapped) {
    success_payload.remappedFrom = iso.remappedFrom;
    success_payload.remapReason = iso.reason;
  }
  _cli_success(success_payload, `Phase 1 init complete: taskId=${task_id}, continue with clone-and-diff`);
}

function _run_subprocess(cmd: string[], timeout = 30): [number, string, string] {
  const r = run(cmd, { timeout_s: timeout });
  if (r.notFound) return [-2, "", `command not found: ${cmd[0]}`];
  if (r.timedOut) return [-1, "", `timeout after ${timeout}s`];
  if (r.error) return [-3, "", String(r.error.message || r.error)];
  return [r.returncode, r.stdout.trim(), r.stderr.trim()];
}

function _fetch_issue_ids_from_plan(plan_id: number): string[] {
  const result = get_plan().get_plan(plan_id, 2);
  const data = result.data || {};
  const issue_ids = [...(data.issueList || data.issueIds || [])];
  if (!issue_ids.length) return [];

  const seen = new Set<string>();
  const unique_ids: string[] = [];
  for (const oid of issue_ids) {
    const oid_str = String(oid).trim();
    if (oid_str && !seen.has(oid_str)) {
      seen.add(oid_str);
      unique_ids.push(oid_str);
    }
  }
  return unique_ids;
}

function _fetch_testcase_groups_by_issue(issue_id: string): any[] {
  return get_testcases().list_groups(String(issue_id));
}

function _fetch_cases_by_group(group_id: any): any[] {
  return get_testcases().list_case_ids(String(group_id)).map((cid: any) => ({ id: cid }));
}

function _fetch_cases_by_test_plan(plan_id: any): string[] {
  return get_testcases().list_case_ids(undefined, parseInt(String(plan_id), 10)).map((cid: any) => String(cid));
}

function _fetch_case_detail(case_id: any): Record<string, any> {
  const caseObj = get_testcases().get_case(String(case_id));
  return caseObj && typeof caseObj === "object" ? caseObj : {};
}

function _fetch_prd_from_issue(issue_id: string): Record<string, any> {
  const issue = get_issues().get_issue(String(issue_id));
  if (!issue) return {};
  return {
    title: issue.title || issue.name || "",
    description: issue.description || issue.content || "",
    issueId: issue_id,
    url: issue.url || "",
  };
}

export function cmd_fetch_test_cases_fallback(args: Args): void {
  const task_id = args.task_id;
  const plan_id = args.plan_id;
  const store = new ContentStore(task_id);

  const existing_cases0 = store.get_test_cases();
  const ready_cases = existing_cases0.filter((c: any) =>
    (c.steps || c.expectedResult || c.preCondition || c.title) && c.fetchStatus !== "failed",
  );
  if (ready_cases.length) {
    console.error(`[fetch-cases-fallback] ✅ content store already has ${ready_cases.length} user/written cases, skip provider`);
    _cli_success(
      {
        taskId: task_id,
        testPlanId: plan_id,
        testCaseIds: ready_cases.map((c: any) => c.id),
        casesAdded: 0,
        hasCases: true,
        source: "content_store",
        degraded: true,
        fallbackUsed: false,
        nextStep: "continue Phase 1 remaining steps (doc reading, detection-plan build)",
      },
      `using ${ready_cases.length} existing cases; did not request test-case provider again`,
    );
    return;
  }

  console.error(`[fetch-cases-fallback] Step 1: fetching requirement issue IDs for test plan ${plan_id}...`);

  const meta = store.load_meta_only();
  const meta_info = meta.meta || {};
  const existing_issues = meta_info.issueList || [];
  const existing_case_ids = meta_info.testCaseIds || [];
  let issue_ids: string[] = [];

  if (existing_issues.length) {
    console.error(`[fetch-cases-fallback] ✅ meta already has issueList: ${existing_issues}`);
    issue_ids = existing_issues.map((o: any) => String(o));
  } else {
    issue_ids = _fetch_issue_ids_from_plan(plan_id);
    if (issue_ids.length) {
      console.error(`[fetch-cases-fallback] ✅ got ${issue_ids.length} issue IDs from plan provider: ${issue_ids}`);
      store.set_meta("issueList", issue_ids);
      _require_save(store);
    } else {
      console.error("[fetch-cases-fallback] ⚠️  failed to get requirement issue IDs (plan provider returned no issueIds)");
    }
  }

  let test_case_ids: string[] = [];
  if (existing_case_ids.length) {
    console.error(`[fetch-cases-fallback] ✅ meta already has testCaseIds: ${existing_case_ids}`);
    test_case_ids = existing_case_ids.map((c: any) => String(c));
  } else {
    if (issue_ids.length) {
      console.error("[fetch-cases-fallback] Step 2: looking up test cases by issue ID via test-case provider...");
      const seen_case_ids = new Set<string>();
      for (const issue_id of issue_ids) {
        const groups = _fetch_testcase_groups_by_issue(issue_id);
        if (groups && groups.length) {
          console.error(`[fetch-cases-fallback]   issue ${issue_id}: found ${groups.length} case groups`);
          for (const grp of groups) {
            const group_id = grp.groupId || grp.id;
            if (group_id) {
              const cases = _fetch_cases_by_group(group_id);
              for (const caseObj of cases) {
                const case_id = caseObj.caseId || caseObj.id;
                if (case_id && !seen_case_ids.has(String(case_id))) {
                  seen_case_ids.add(String(case_id));
                  test_case_ids.push(String(case_id));
                }
              }
            }
          }
        } else {
          console.error(`[fetch-cases-fallback]   issue ${issue_id}: no case groups found`);
        }
      }

      if (test_case_ids.length) {
        console.error(`[fetch-cases-fallback] ✅ discovered ${test_case_ids.length} test-case IDs`);
        store.set_meta("testCaseIds", test_case_ids.map((c) => /^\d+$/.test(c) ? parseInt(c, 10) : c));
        _require_save(store);
      } else {
        console.error("[fetch-cases-fallback] ⚠️  no test cases found via issue ID; trying the test-plan ID directly...");
        const tp_case_ids = _fetch_cases_by_test_plan(plan_id);
        if (tp_case_ids.length) {
          const seen_set = new Set(test_case_ids);
          for (const cid of tp_case_ids) {
            if (!seen_set.has(cid)) {
              seen_set.add(cid);
              test_case_ids.push(cid);
            }
          }
          console.error(`[fetch-cases-fallback] ✅ discovered ${test_case_ids.length} test-case IDs via plan ID`);
          store.set_meta("testCaseIds", test_case_ids.map((c) => /^\d+$/.test(c) ? parseInt(c, 10) : c));
          _require_save(store);
        } else {
          console.error("[fetch-cases-fallback] ⚠️  failed to discover test cases via test-case provider");
        }
      }
    }
  }

  let cases_added = 0;
  let existing_cases = store.get_test_cases();
  if (test_case_ids.length) {
    console.error(`[fetch-cases-fallback] Step 3: fetching ${test_case_ids.length} test-case details...`);
    const existing_ids = new Set(existing_cases.map((c: any) => String(c.id || "")));

    for (const case_id of test_case_ids) {
      if (existing_ids.has(case_id)) {
        console.error(`[fetch-cases-fallback]   case ${case_id} already exists, skip`);
        continue;
      }

      const detail = _fetch_case_detail(case_id);
      if (!detail || !Object.keys(detail).length) {
        console.error(`[fetch-cases-fallback]   ⚠️  case ${case_id} detail fetch failed`);
        continue;
      }

      const test_case = enrich_test_case_fields(detail, case_id);
      if (test_case.fetchStatus === "empty") {
        console.error(`[fetch-cases-fallback]   ⚠️  case ${case_id} body is empty (pre/steps/expected and desc all empty)`);
      } else {
        const parse_status = test_case.descParseStatus;
        const suffix = parse_status ? ` (desc parse: ${parse_status})` : "";
        console.error(`[fetch-cases-fallback]   ✅ case ${case_id} body is ready${suffix}`);
      }
      try {
        store.upsert_test_case(test_case);
        cases_added += 1;
        console.error(`[fetch-cases-fallback]   ✅ case ${case_id} written to content store`);
      } catch (e: any) {
        console.error(`[fetch-cases-fallback]   ⚠️  case ${case_id} write failed: ${e}`);
      }
    }

    if (cases_added > 0) _require_save(store);
  }

  const prd_info_list: any[] = [];
  if (issue_ids.length) {
    console.error("[fetch-cases-fallback] Step 4: trying to fetch requirement docs...");
    for (const issue_id of issue_ids) {
      const prd = _fetch_prd_from_issue(issue_id);
      if (prd && Object.keys(prd).length) {
        prd_info_list.push(prd);
        try {
          store.add_document("prdDocs", {
            title: prd.title || `issue-${issue_id}`,
            url: prd.url || "",
            fetchMethod: "issue_api",
            fetchStatus: "success",
          });
        } catch {
          // pass
        }
      }
    }
    if (prd_info_list.length) {
      _require_save(store);
      console.error(`[fetch-cases-fallback] ✅ fetched ${prd_info_list.length} PRD records`);
    }
  }

  existing_cases = store.get_test_cases();
  const has_cases = cases_added > 0 || existing_cases.length > 0;
  const summary: Record<string, any> = {
    taskId: task_id,
    testPlanId: plan_id,
    issueIds: issue_ids,
    testCaseIds: test_case_ids,
    casesAdded: cases_added,
    prdInfoCount: prd_info_list.length,
    hasCases: has_cases,
    fallbackUsed: true,
    nextStep: has_cases
      ? "continue Phase 1 remaining steps (doc reading, detection-plan build)"
      : "test-case fetch failed; mark HAS_CASES=false and continue",
  };

  if (has_cases) {
    _cli_success(
      summary,
      `test-case fallback fetch complete: discovered ${test_case_ids.length} cases, ` +
        `wrote ${cases_added} new ones, ${prd_info_list.length} PRD records`,
    );
  } else {
    summary.source = "empty";
    summary.degraded = true;
    summary.nextActions = [
      "If the user pasted test cases in chat, run add-test-case --case-json and continue.",
      "Do not treat a missing enterprise/test-cases file as a hard failure.",
    ];
    _cli_result(0, summary, "test-case fallback fetch complete but no cases found; mark HAS_CASES=false and continue");
  }
}

function _case_node1_fallback(store: ContentStore, _task_id: number, plan_id: number): Record<string, any> {
  const meta = store.load_meta_only();
  const meta_info = meta.meta || {};
  let issue_ids = (meta_info.issueList || []).map((o: any) => String(o));
  if (!issue_ids.length) {
    issue_ids = _fetch_issue_ids_from_plan(plan_id);
    if (issue_ids.length) {
      store.set_meta("issueList", issue_ids);
      _require_save(store);
    }
  }

  let test_case_ids = (meta_info.testCaseIds || []).map((c: any) => String(c));
  if (!test_case_ids.length) {
    const seen = new Set<string>();
    for (const issue_id of issue_ids) {
      for (const grp of _fetch_testcase_groups_by_issue(issue_id)) {
        const gid = grp.groupId || grp.id;
        if (!gid) continue;
        for (const caseObj of _fetch_cases_by_group(gid)) {
          const cid = caseObj.caseId || caseObj.id;
          if (cid && !seen.has(String(cid))) {
            seen.add(String(cid));
            test_case_ids.push(String(cid));
          }
        }
      }
    }
    if (!test_case_ids.length) {
      for (const cid of _fetch_cases_by_test_plan(plan_id)) {
        if (!seen.has(String(cid))) {
          seen.add(String(cid));
          test_case_ids.push(String(cid));
        }
      }
    }
    if (test_case_ids.length) {
      store.set_meta("testCaseIds", test_case_ids.map((c: string) => /^\d+$/.test(c) ? parseInt(c, 10) : c));
      _require_save(store);
    }
  }

  const existing_ids = new Set(store.get_test_cases().map((c: any) => String(c.id)));
  let added = 0;
  for (const case_id of test_case_ids) {
    if (existing_ids.has(case_id)) continue;
    const detail = _fetch_case_detail(case_id);
    if (!detail || !Object.keys(detail).length) {
      console.error(`[testcase-pipeline]   ⚠️  case ${case_id} detail fetch failed`);
      continue;
    }
    const test_case = enrich_test_case_fields(detail, case_id);
    test_case.pipelineStatus = "fetched";
    try {
      store.upsert_test_case(test_case);
      added += 1;
      console.error(
        `[testcase-pipeline]   ✅ case ${test_case.id} written` +
          ` (${test_case.descParseStatus || "structured"})`,
      );
    } catch (e: any) {
      console.error(`[testcase-pipeline]   ⚠️  case ${case_id} write failed: ${e}`);
    }
  }
  if (added) _require_save(store);

  return {
    issueIds: issue_ids,
    testCaseIdsDiscovered: test_case_ids.length,
    casesWritten: added,
  };
}

function _case_node2_ensure(store: ContentStore): Record<string, any> {
  let repaired = 0;
  const still_empty: any[] = [];
  let checked = 0;
  let dirty = false;

  for (const caseObj of store.get_test_cases()) {
    checked += 1;
    if (caseObj.preCondition || caseObj.steps) continue;

    const case_id = caseObj.id;
    console.error(`[testcase-pipeline]   ↻ case ${case_id} body is empty; forced refill (empty-content forced refill)...`);
    const detail = _fetch_case_detail(case_id);
    const refreshed = detail && Object.keys(detail).length ? enrich_test_case_fields(detail, case_id) : {};

    if (refreshed && (refreshed.preCondition || refreshed.steps || refreshed.expectedResult)) {
      refreshed.pipelineStatus = "repaired";
      refreshed.pipelineRetried = true;
      try {
        // Merge into the existing (empty-body) record; a push here would leave
        // the stale empty copy next to the refilled one.
        store.upsert_test_case(refreshed);
        repaired += 1;
        dirty = true;
        console.error(`[testcase-pipeline]   ✅ case ${case_id} refill succeeded`);
        continue;
      } catch (e: any) {
        console.error(`[testcase-pipeline]   ⚠️  case ${case_id} refill write failed: ${e}`);
      }
    }

    still_empty.push(case_id);
    try {
      store.upsert_test_case({
        id: case_id,
        fetchStatus: "failed",
        fetchError: "case body still empty after Node2 forced refill",
        pipelineStatus: "empty",
        pipelineRetried: true,
      });
      dirty = true;
    } catch {
      // pass
    }
    console.error(`[testcase-pipeline]   ⚠️  case ${case_id} still empty after refill; marked failed (non-blocking)`);
  }

  if (dirty) _require_save(store);

  return { checked, repaired, stillEmpty: still_empty };
}

export function cmd_testcase_pipeline(args: Args): void {
  const task_id = args.task_id;
  const plan_id = args.plan_id;
  const store = new ContentStore(task_id);

  console.error("[testcase-pipeline] ═══ Node 1 (fallback): discover and fetch test cases ═══");
  const node1_summary = _case_node1_fallback(store, task_id, plan_id);

  console.error("[testcase-pipeline] ═══ Node 2 (ensure): validate body completeness and forced refill ═══");
  const node2_summary = _case_node2_ensure(store);

  const node3_inputs: any[] = [];
  let reviewed = 0;
  for (const caseObj of store.get_test_cases()) {
    if (caseObj.fetchStatus === "failed") continue;
    if (!(caseObj.preCondition || caseObj.steps || caseObj.expectedResult)) continue;
    if (caseObj.semanticReviewStatus === "success") {
      reviewed += 1;
      continue;
    }
    node3_inputs.push({
      caseId: caseObj.id,
      title: caseObj.title || "",
      preCondition: caseObj.preCondition || "",
      steps: caseObj.steps || "",
      expectedResult: caseObj.expectedResult || "",
      structuredSteps: caseObj.structuredSteps || [],
    });
  }

  const all_cases = store.get_test_cases();
  const has_cases = Boolean(all_cases.length);

  let next_step: string;
  if (node3_inputs.length) {
    next_step = (
      `[Must run] For each of the ${node3_inputs.length} cases in node3Inputs, call Skill ` +
      "test-case-semantic-defect-review to finish semantic compilation, then write-back via add-test-case " +
      "semanticContract / verificationObligations / semanticReviewStatus=success. " +
      "Do not skip or postpone (no deferred refill)."
    );
  } else if (has_cases && reviewed) {
    next_step = `all ${reviewed} cases have finished semantic compilation; continue Phase 1 remaining steps`;
  } else if (has_cases) {
    next_step = "all case bodies are empty; cannot compile semantics; confirm cases are filled on the test-case platform";
  } else {
    next_step = "no test cases found; mark HAS_CASES=false and continue";
  }

  _cli_success(
    {
      taskId: task_id,
      testPlanId: plan_id,
      dag: {
        node1_fallback: node1_summary,
        node2_ensure: node2_summary,
        node3_ready: {
          pendingSemanticReview: node3_inputs.length,
          alreadyReviewed: reviewed,
        },
      },
      hasCases: has_cases,
      caseTotal: all_cases.length,
      node3Inputs: node3_inputs,
      nextStep: next_step,
    },
    `case DAG complete: ${all_cases.length} cases, ` +
      `${node3_inputs.length} pending semantic compilation, ${reviewed} already compiled`,
  );
}

export function cmd_run_frontend_rules(args: Args): void {
  const frontend_rules = [
    {
      ruleId: "FE-001",
      category: "hook_rules",
      title: "React Hook rule violations",
      description: "useEffect missing dependencies, conditional Hook calls, missing cleanup",
      checkPoints: [
        "Whether the useEffect dependency array includes every externally referenced variable",
        "Whether Hooks are called inside conditionals/loops",
        "When useEffect binds event listeners/timers, whether cleanup unbinds/clears them",
        "Whether the useEffect cleanup function is returned correctly",
      ],
    },
    {
      ruleId: "FE-002",
      category: "type_safety",
      title: "Type safety: assertion abuse and non-null assertions",
      description: "as any bypasses checks; non-null assertions (!) can crash at runtime",
      checkPoints: [
        "Whether as any is used to bypass type checks (confirm if it is a temporary bypass for missing third-party types)",
        "Non-null assertions (!) used on values that may be null/undefined",
        "Whether type assertions hide a real data-structure mismatch",
      ],
    },
    {
      ruleId: "FE-003",
      category: "event_management",
      title: "Event listeners not unbound / global event leaks",
      description: "addEventListener without removeEventListener on unmount",
      checkPoints: [
        "Whether addEventListener in componentDidMount / useEffect has a matching removeEventListener in componentWillUnmount / cleanup",
        "Whether global events (e.g. window/document) are cleaned up on unmount",
        "Whether event callbacks reference state/props of an unmounted component (stale-closure trap)",
      ],
    },
    {
      ruleId: "FE-004",
      category: "async_race",
      title: "Async handling: race conditions and uncaught exceptions",
      description: "Unhandled Promise chains, swallowed errors in async functions, race conditions",
      checkPoints: [
        "Whether async/await calls have try-catch or .catch() handling",
        "Whether rapidly repeated async operations have race protection (e.g. AbortController, cancel flags)",
        "Whether setState is still called after unmount (needs isMounted check or AbortController)",
        "Whether a reject in Promise.all affects other parallel requests",
      ],
    },
    {
      ruleId: "FE-005",
      category: "state_management",
      title: "State management: closures capturing stale state",
      description: "Closures referencing stale state, misuse of batched updates, unchecked global state",
      checkPoints: [
        "Whether state referenced in setTimeout/setInterval callbacks is a stale closure value (use ref or functional updates)",
        "Whether multiple setState calls in a React batch update cause inconsistent rendering",
        "Whether writes to global state (Context/Redux/Zustand) are validated",
      ],
    },
    {
      ruleId: "FE-006",
      category: "dom_operation",
      title: "DOM operations: bypassing the framework",
      description: "Direct DOM ops such as document.getElementById bypass React/Vue management",
      checkPoints: [
        "Whether ref is used instead of document.getElementById",
        "Whether direct DOM ops are outside the framework-managed area (e.g. third-party SDK integration, which may be valid)",
        "Whether dynamic innerHTML has XSS risk",
      ],
    },
    {
      ruleId: "FE-007",
      category: "expose_dedup",
      title: "Impression/tracking: missing dedup",
      description: "Impression callbacks are not deduped, causing duplicate tracking events",
      checkPoints: [
        "Whether impression callbacks such as onItemAppear / componentDidMount use Set/Map dedup",
        "Whether the same item can fire impression again while the list scrolls",
        "Whether impression conditions are sufficient (e.g. skip when a guide tag is disabled)",
      ],
    },
    {
      ruleId: "FE-008",
      category: "storage_asymmetry",
      title: "Storage read/write namespace mismatch",
      description: "getStorage and setStorage use different storage APIs or namespaces",
      checkPoints: [
        "Whether read and write use the same API (e.g. localStorage / sessionStorage)",
        "Whether storage key namespaces are consistent for read and write",
        "Whether async storage operations have race protection",
      ],
    },
    {
      ruleId: "FE-009",
      category: "frequency_control",
      title: "Frequency control: display logic skips frequency limits",
      description: "Tag/component display logic sets shouldShow=true without a frequency-control check",
      checkPoints: [
        "Whether every place that sets shouldShow/visible goes through frequency-control logic",
        "Whether the frequency-control count <= limit check applies at every display entry",
        "Whether frequency control is consistent across entries (search/list/detail)",
      ],
    },
    {
      ruleId: "FE-010",
      category: "context_strip",
      title: "Context passing: key fields stripped",
      description: "Key fields (e.g. limit/switch) are stripped while passing context/props, so downstream cannot use them",
      checkPoints: [
        "Whether fields are actively removed from the context object during pass/store (delete / destructure omit)",
        "Whether stripped fields affect downstream logic (e.g. a frequency-control switch stripped so downstream cannot decide)",
        "Whether fields are lost during serialize/deserialize",
      ],
    },
    {
      ruleId: "FE-011",
      category: "component_lifecycle",
      title: "Component lifecycle: side effects at the wrong time",
      description: "Unconditional callbacks in componentDidMount; side effects in render",
      checkPoints: [
        "Whether componentDidMount unconditionally fires impression/tracking callbacks (should be gated)",
        "Whether render performs side effects (e.g. setState, network requests)",
        "Whether getDerivedStateFromProps causes an infinite render loop",
      ],
    },
    {
      ruleId: "FE-012",
      category: "nullable_access",
      title: "Nullable access: missing optional chaining / nullish coalescing",
      description: "Values that may be null/undefined do not use optional chaining (?.) or nullish coalescing (??)",
      checkPoints: [
        "Whether optional chaining is used when reading from API responses/props/context",
        "Whether array access [0] checks that the array is non-empty",
        "Whether JSON.parse results are type-checked",
      ],
    },
  ];

  let diff_files: string[] = [];
  if (args.diff_files) {
    diff_files = args.diff_files.split(",").map((f: string) => f.trim()).filter(Boolean);
  }

  const cat_counts: Record<string, number> = {};
  for (const r of frontend_rules) {
    cat_counts[r.category] = (cat_counts[r.category] || 0) + 1;
  }

  const output = {
    strategyCode: 10,
    strategyName: "frontend-pattern-rules",
    totalRules: frontend_rules.length,
    rulesByCategory: cat_counts,
    rules: frontend_rules,
    diffFiles: diff_files,
    usage: (
      "When the Agent analyzes each changed method in STEP C, it should compare these rules one by one. " +
      "For a hit, cite the ruleId and concrete code line numbers in thinking, " +
      "and describe the specific defect in content. " +
      "bugStatus=6 confirms a defect; bugStatus=7 is an improvement."
    ),
  };

  console.error(
    `[run-frontend-rules] 📋 emitting ${frontend_rules.length} frontend-only rules, ` +
      `covering ${Object.keys(cat_counts).length} categories`,
  );
  console.log(JSON.stringify(output, null, 2));
}

