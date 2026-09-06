/**
 * ContentStore commands: init-content / add-service-to-content /
 * update-service-in-content / set-diff-files / set-changed-methods /
 * set-meta-field / set-doc-summary / add-document / scan-repo-docs /
 * add-test-case / add-detection-plan-item / add-cross-repo-class /
 * record-process-writeback / update-plan-status / set-plan-ast-result /
 * record-rank / content-summary / register-context-read /
 * register-finding / get-findings
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { _cli_error, _cli_success, _parse_json_arg, _require_save } from "./open_cli_common.ts";
import { ContentStore, changed_method_name } from "./open_store.ts";
import { IsolationError, isolate_if_foreign, log_isolation } from "./open_task_isolation.ts";

type Args = Record<string, any>;

function _is_file(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function _is_dir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function _glob_part_to_re(part: string): RegExp {
  let s = "";
  for (const ch of part) {
    if (ch === "*") s += ".*";
    else if (ch === "?") s += ".";
    else if ("+^${}()|[]\\.".includes(ch)) s += "\\" + ch;
    else s += ch;
  }
  return new RegExp("^" + s + "$");
}

function _glob_files(root: string, pattern: string): string[] {
  const results: string[] = [];
  const segs = pattern.split("/");

  function walk(dir: string, idx: number): void {
    if (idx >= segs.length) return;
    const part = segs[idx];
    const last = idx === segs.length - 1;
    if (part === "**") {
      walk(dir, idx + 1);
      let ents: string[] = [];
      try {
        ents = readdirSync(dir);
      } catch {
        return;
      }
      for (const e of ents) {
        const p = join(dir, e);
        try {
          if (statSync(p).isDirectory()) walk(p, idx);
        } catch {
          // skip
        }
      }
      return;
    }
    const re = _glob_part_to_re(part);
    let ents: string[] = [];
    try {
      ents = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of ents) {
      if (!re.test(e)) continue;
      const p = join(dir, e);
      if (last) {
        if (_is_file(p)) results.push(p);
      } else {
        try {
          if (statSync(p).isDirectory()) walk(p, idx + 1);
        } catch {
          // skip
        }
      }
    }
  }

  walk(root, 0);
  return results;
}

export function cmd_init_content(args: Args): void {
  const incoming = {
    testPlanId: args.test_plan_id ?? null,
    planName: args.plan_name ?? null,
    userId: args.user_id ?? null,
    gitUrl: args.git_url ?? null,
    branch: args.branch ?? null,
  };
  let iso: Record<string, any>;
  try {
    iso = isolate_if_foreign(args.task_id, incoming);
  } catch (exc: any) {
    if (exc instanceof IsolationError) {
      _cli_error(String(exc.message || exc));
    }
    throw exc;
  }
  log_isolation("init-content", iso);
  const task_id = iso.taskId;

  const store = new ContentStore(task_id);
  if (incoming.testPlanId) {
    store.set_meta("testPlanId", incoming.testPlanId);
  }
  if (incoming.planName) {
    store.set_meta("planName", incoming.planName);
  }
  if (incoming.userId) {
    store.set_meta("userId", incoming.userId);
  }
  _require_save(store);
  const summary = store.get_summary();
  if (iso.remapped) {
    summary.remappedFrom = iso.remappedFrom;
    summary.remapReason = iso.reason;
    summary.batchIds = iso.batchIds || [];
  }
  _cli_success(summary, "content.json initialized");
}

export function cmd_add_service_to_content(args: Args): void {
  const store = new ContentStore(args.task_id);
  let batch_ids: number[] = [];
  if (args.batch_ids) {
    batch_ids = args.batch_ids.split(",").map((x: string) => x.trim()).filter(Boolean).map((x: string) => parseInt(x, 10));
  }
  const service = {
    gitUrl: args.git_url,
    branch: args.branch,
    serviceKey: args.service_key ?? null,
    batchIds: batch_ids,
    modulePrefix: args.module_prefix || null,
    language: args.language || "java",
    commitId: null,
    localDir: null,
    verified: false,
  };
  try {
    store.add_or_update_service(service);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, `service added: ${args.git_url}`);
}

export function cmd_update_service_in_content(args: Args): void {
  const store = new ContentStore(args.task_id);
  const svc = store.get_service_by_git_url(args.git_url);
  if (!svc) {
    _cli_error(`service not found: ${args.git_url}`);
  }
  if (args.commit_id) {
    svc.commitId = args.commit_id;
  }
  if (args.local_dir) {
    svc.localDir = args.local_dir;
  }
  if (args.append_batch_id != null) {
    const existing = new Set(svc.batchIds || []);
    existing.add(args.append_batch_id);
    svc.batchIds = [...existing];
  }
  if (args.verified) {
    svc.verified = true;
  }
  if (args.module_prefix) {
    svc.modulePrefix = args.module_prefix;
  }
  store.add_or_update_service(svc);
  _require_save(store);
  _cli_success(undefined, `service updated: ${args.git_url}`);
}

export function cmd_set_diff_files(args: Args): void {
  const store = new ContentStore(args.task_id);
  const files = _parse_json_arg(args.files_json, "--files-json");
  store.set_diff_files(files);
  _require_save(store);
  _cli_success(undefined, `diff.files set, ${files.length} files`);
}

export function cmd_set_changed_methods(args: Args): void {
  const store = new ContentStore(args.task_id);
  const methods = _parse_json_arg(args.methods_json, "--methods-json");
  store.add_changed_methods(args.class_name, methods);
  _require_save(store);
  _cli_success(undefined, `changedMethods[${args.class_name}] set, ${methods.length} methods`);
}

export function cmd_set_meta_field(args: Args): void {
  const store = new ContentStore(args.task_id);
  let value: any;
  try {
    value = JSON.parse(args.value);
  } catch {
    value = args.value;
  }
  store.set_meta(args.key, value);
  _require_save(store);
  _cli_success(undefined, `meta.${args.key} set`);
}

export function cmd_set_doc_summary(args: Args): void {
  const store = new ContentStore(args.task_id);
  store.set_document_summary_path(args.path);
  _require_save(store);
  _cli_success(undefined, `docSummaryPath set: ${args.path}`);
}

export function cmd_add_document(args: Args): void {
  const store = new ContentStore(args.task_id);
  const doc = _parse_json_arg(args.doc_json, "--doc-json");
  try {
    store.add_document(args.doc_type, doc);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, `${args.doc_type} document added`);
}

export function cmd_scan_repo_docs(args: Args): void {
  const store = new ContentStore(args.task_id);
  const meta = store.load_meta_only();
  const services = meta.services || [];
  const diff_files = (meta.diff || {}).files || [];
  const changed_methods = (meta.diff || {}).changedMethods || {};

  const related_names = new Set<string>();
  for (const [class_name, methods] of Object.entries(changed_methods) as [string, any][]) {
    const simple_class = class_name.split("/").pop()!.split(".").pop()!;
    related_names.add(simple_class);
    for (const m of methods as any[]) {
      const name = changed_method_name(m);
      if (name) related_names.add(name);
    }
  }

  const diff_dirs = new Set<string>();
  for (const f of diff_files) {
    const idx = f.lastIndexOf("/");
    if (idx > 0) {
      diff_dirs.add(f.slice(0, idx));
    }
  }

  const DOC_PATTERNS = [
    "docs/**/*.md", "doc/**/*.md",
    "README.md", "README_*.md",
    "CHANGELOG.md", "CHANGES.md",
    "**/package-info.java",
  ];
  const GLOBAL_DOCS = new Set(["README.md", "CHANGELOG.md", "CHANGES.md"]);

  const MAX_CONTENT_LEN = 8000;
  let total_added = 0;
  let skipped_services = 0;

  for (const svc of services) {
    const local_dir = svc.localDir;
    if (!local_dir || !_is_dir(local_dir)) {
      skipped_services += 1;
      continue;
    }

    const candidates = new Set<string>();
    for (const pattern of DOC_PATTERNS) {
      for (const match of _glob_files(local_dir, pattern)) {
        if (_is_file(match)) candidates.add(match);
      }
    }

    for (const abs_path of [...candidates].sort()) {
      const rel_path = relative(local_dir, abs_path);
      const base = basename(rel_path);

      const is_global = GLOBAL_DOCS.has(base);

      if (!is_global) {
        const in_same_module = diff_dirs.size
          ? [...diff_dirs].some((d) =>
              rel_path.startsWith(d + "/") || d.startsWith(dirname(rel_path) + "/"),
            )
          : false;

        if (!in_same_module) {
          let content_preview = "";
          try {
            content_preview = readFileSync(abs_path, "utf8").slice(0, MAX_CONTENT_LEN);
          } catch {
            continue;
          }
          const content_relevant = related_names.size
            ? [...related_names].some((name) => content_preview.includes(name))
            : false;
          if (!content_relevant) continue;
        }
      }

      let content = "";
      try {
        content = readFileSync(abs_path, "utf8").slice(0, MAX_CONTENT_LEN);
      } catch {
        continue;
      }

      const doc = {
        title: rel_path,
        filePath: rel_path,
        repoSource: "local_repo",
        fetchMethod: "local_repo",
        fetchStatus: "success",
        businessRules: content,
      };
      try {
        store.add_document("techDocs", doc);
        total_added += 1;
      } catch {
        continue;
      }
    }
  }

  if (total_added > 0) {
    _require_save(store);
  }

  _cli_success(
    undefined,
    `in-repo document scan complete: added ${total_added} documents`,
    {
      added: total_added,
      skippedServices: skipped_services,
      totalServices: services.length,
    },
  );
}

export function cmd_add_test_case(args: Args): void {
  const store = new ContentStore(args.task_id);
  const caseObj = _parse_json_arg(args.case_json, "--case-json");
  try {
    store.add_test_case(caseObj);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, "test case added");
}

export function cmd_add_detection_plan_item(args: Args): void {
  const store = new ContentStore(args.task_id);
  const item = _parse_json_arg(args.item_json, "--item-json");
  try {
    store.add_detection_plan_item(item);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, `detection plan item added: ${item.className}#${item.methodName}`);
}

export function cmd_add_cross_repo_class(args: Args): void {
  const store = new ContentStore(args.task_id);
  const info = _parse_json_arg(args.info_json, "--info-json");
  try {
    store.add_cross_repo_class(args.class_name, info);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, `cross-repo class recorded: ${args.class_name}`);
}

export function cmd_record_process_writeback(args: Args): void {
  const store = new ContentStore(args.task_id);
  const record = _parse_json_arg(args.record_json, "--record-json");
  try {
    store.record_process_writeback(record);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, "write-back record saved");
}

export function cmd_update_plan_status(args: Args): void {
  const store = new ContentStore(args.task_id);
  store.update_plan_status(args.class_name, args.method_name, args.strategy_code, args.status);
  _require_save(store);
  _cli_success(undefined, `plan status updated to ${args.status}`);
}

export function cmd_set_plan_ast_result(args: Args): void {
  const store = new ContentStore(args.task_id);
  const result = _parse_json_arg(args.result_json, "--result-json");
  store.set_plan_ast_result(args.class_name, args.method_name, result);
  _require_save(store);
  _cli_success(undefined, "AST scan result cached");
}

export function cmd_record_rank(args: Args): void {
  const store = new ContentStore(args.task_id);
  const rank = _parse_json_arg(args.rank_json, "--rank-json");
  try {
    store.record_rank(rank);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(undefined, "rank record saved");
}

export function cmd_content_summary(args: Args): void {
  const store = new ContentStore(args.task_id);
  const summary = store.get_summary();
  _cli_success(summary, "content.json summary");
}

export function cmd_register_context_read(args: Args): void {
  const store = new ContentStore(args.task_id);
  const record: Record<string, any> = {
    className: args.class_name,
    filePath: args.file_path,
    purpose: args.purpose || "dependency",
    parentBatchId: args.batch_id,
  };
  if (args.lines_read) {
    record.linesRead = args.lines_read;
  }
  try {
    store.add_context_read(record);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(record, `context read registered: className=${args.class_name}, filePath=${args.file_path}`);
}

export function cmd_register_finding(args: Args): void {
  const store = new ContentStore(args.task_id);
  const record: Record<string, any> = {
    phase: args.phase,
    category: args.category,
    text: args.text,
  };
  if (args.source) {
    record.source = args.source;
  }
  try {
    store.add_finding(record);
  } catch (e: any) {
    _cli_error(`data validation failed: ${e.message || e}`);
  }
  _require_save(store);
  _cli_success(record, `finding recorded: [${args.phase}/${args.category}] ${String(args.text).slice(0, 50)}...`);
}

export function cmd_get_findings(args: Args): void {
  const store = new ContentStore(args.task_id);
  const findings = store.get_findings(args.phase, args.category);
  const summary_text = store.get_findings_summary_text();
  _cli_success(
    {
      findings,
      count: findings.length,
      summaryText: summary_text,
    },
    `${findings.length} finding records`,
  );
}
