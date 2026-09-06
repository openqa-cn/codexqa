/** File-backed detection platform. */

import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, ok } from "../http_util.ts";
import { JsonStore } from "../json_store.ts";
import { BasePlatformProvider } from "./base.ts";
import { write_report_html } from "./report_html.ts";
import {
  DEFAULT_RULES,
  DEFAULT_TAGS,
  is_legacy_rule_catalog,
  is_legacy_tag_catalog,
} from "./seed_catalog.ts";

const TERMINAL_BATCH = new Set(["completed", "failed", "skipped", "aborted"]);
const TERMINAL_TASK = new Set(["completed", "failed", "aborted"]);
const _CONTENT_MARKERS = [
  "meta.json", "content.json", "plan.json", "writebacks.json",
  "findings.json", "static.json", "local_state.json",
];

function _now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

function _service_key(item: Record<string, any>): string {
  return item.serviceKey || "";
}

function _as_record(data: any): Record<string, any> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!Object.keys(data).length) return null;
  return data;
}

function _is_relative_to(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function _is_file(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export class LocalPlatformProvider extends BasePlatformProvider {
  store: JsonStore;
  report_base_url: string;

  constructor(store_dir: string, opts?: { report_base_url?: string }) {
    super();
    this.store = new JsonStore(store_dir);
    this.report_base_url = (opts?.report_base_url || "").replace(/\/+$/, "");
    this._ensure_seed();
  }

  _ensure_seed(): void {
    if (!existsSync(this.store.path("meta.json"))) {
      this.store.write("meta.json", {
        data: {
          nextTaskId: 1,
          nextBatchId: 1,
          nextProcessId: 1,
          nextRankId: 1,
        },
      });
    }
    const tags_path = this.store.path("tags.json");
    if (!existsSync(tags_path) || is_legacy_tag_catalog(this.store.read("tags.json", { default: [] }))) {
      this.store.write("tags.json", { data: DEFAULT_TAGS });
    }
    const rules_path = this.store.path("rules.json");
    if (!existsSync(rules_path) || is_legacy_rule_catalog(this.store.read("rules.json", { default: {} }))) {
      this.store.write("rules.json", { data: DEFAULT_RULES });
    }
    if (!existsSync(this.store.path("history.json"))) {
      this.store.write("history.json", { data: [] });
    }
  }

  _occupied_content_ids(): Set<number> {
    const base = process.env.CONTENT_JSON_BASE || process.env.DETECTION_DATA_DIR;
    if (!base) return new Set();
    const base_path = resolve(base);
    if (!_is_relative_to(resolve(this.store.root), base_path)) return new Set();
    try {
      if (!statSync(base_path).isDirectory()) return new Set();
    } catch {
      return new Set();
    }
    const occupied = new Set<number>();
    for (const ent of readdirSync(base_path, { withFileTypes: true })) {
      if (!ent.isDirectory() || !/^\d+$/.test(ent.name)) continue;
      const tid = parseInt(ent.name, 10);
      if (tid <= 0) continue;
      const child = join(base_path, ent.name);
      if (_CONTENT_MARKERS.some((marker) => _is_file(join(child, marker)))) {
        occupied.add(tid);
      }
    }
    return occupied;
  }

  _next_id(field: string): number {
    return this.store.update("meta.json", {
      default: {},
      mutate: (meta: Record<string, any>) => {
        let value = parseInt(String(meta[field] || 1), 10);
        if (field === "nextTaskId") {
          const reserved = this._occupied_content_ids();
          while (reserved.has(value) || this._task(value)) {
            value += 1;
          }
          if (reserved.size) {
            value = Math.max(value, Math.max(...reserved) + 1);
          }
        }
        meta[field] = value + 1;
        return value;
      },
    });
  }

  _task(task_id: number): Record<string, any> | null {
    return _as_record(this.store.read("tasks", `${task_id}.json`));
  }

  _save_task(task: Record<string, any>): void {
    this.store.write("tasks", `${task.taskId}.json`, { data: task });
  }

  _batch(batch_id: number): Record<string, any> | null {
    return _as_record(this.store.read("batches", `${batch_id}.json`));
  }

  _save_batch(batch: Record<string, any>): void {
    this.store.write("batches", `${batch.batchId}.json`, { data: batch });
  }

  _process(process_id: number): Record<string, any> | null {
    return _as_record(this.store.read("processes", `${process_id}.json`));
  }

  _save_process(process: Record<string, any>): void {
    this.store.write("processes", `${process.processId}.json`, { data: process });
  }

  _rank(rank_id: number): Record<string, any> | null {
    return _as_record(this.store.read("ranks", `${rank_id}.json`));
  }

  _save_rank(rank: Record<string, any>): void {
    this.store.write("ranks", `${rank.rankId}.json`, { data: rank });
  }

  _processes_for_batch(batch_id: number): Record<string, any>[] {
    return this.store.list_json("processes").filter((p) => p.parentBatchId === batch_id);
  }

  _ranks_for_batch(batch_id: number): Record<string, any>[] {
    return this.store.list_json("ranks").filter((r) => r.parentBatchId === batch_id && !r.invalid);
  }

  _batches_for_task(task_id: number): Record<string, any>[] {
    return this.store.list_json("batches").filter((b) => b.taskId === task_id);
  }

  report_html_path(task_id: number): string {
    return this.store.path("reports", `${task_id}.html`);
  }

  write_html_report(task_id: number): string {
    const task = this._task(task_id) || { taskId: task_id };
    const ranks = this.store.list_json("ranks").filter((r) =>
      r.taskId === task_id || (task.batchIds || []).includes(r.parentBatchId),
    );
    const defects = ranks.filter((r) => (r.bugStatus === 6 || r.bugStatus === 7) && !r.invalid);
    return write_report_html(this.report_html_path(task_id), task, defects);
  }

  override report_url(task_id: number): string {
    if (this.report_base_url) {
      const sep = this.report_base_url.includes("?") ? "&" : "?";
      if (this.report_base_url.includes("taskId=")) {
        return this.report_base_url;
      }
      return `${this.report_base_url}${sep}taskId=${task_id}`;
    }
    return pathToFileURL(resolve(this.write_html_report(task_id))).href;
  }

  override submit_detection(request_body: Record<string, any>): Record<string, any> {
    const task_id = this._next_id("nextTaskId");
    let services = [...(request_body.services || [])];
    const job_infos = [...(request_body.jobInfos || [])];
    if (!services.length && request_body.git) {
      services = [{
        git: request_body.git,
        branch: request_body.developBranch || request_body.branch,
        serviceKey: _service_key(request_body),
        language: request_body.language || "java",
      }];
    }
    if (!services.length && job_infos.length) {
      services = job_infos.map((j) => ({
        git: j.git,
        branch: j.developBranch || j.branch,
        serviceKey: _service_key(j),
        language: j.language || "java",
      }));
    }
    if (!services.length) {
      services = [{ git: "", branch: "", serviceKey: "default", language: "java" }];
    }

    const detect_type = request_body.detectType || "GIT_BRANCH";

    const batch_ids: number[] = [];
    for (const svc of services) {
      const batch_id = this._next_id("nextBatchId");
      batch_ids.push(batch_id);
      this._save_batch({
        batchId: batch_id,
        parentBatchId: batch_id,
        taskId: task_id,
        git: svc.git || request_body.git || "",
        branch: svc.branch || svc.developBranch || "",
        serviceKey: _service_key(svc),
        status: "in_progress",
        processIds: [],
        createdAt: _now(),
      });
    }

    const task: Record<string, any> = {
      taskId: task_id,
      status: "in_progress",
      detectType: detect_type,
      planId: request_body.planId,
      planType: request_body.planType,
      planName: request_body.planName || "",
      submitUser: request_body.submitUser || "local-user",
      git: request_body.git || (services.length ? services[0].git : ""),
      developBranch: request_body.developBranch || (services.length ? services[0].branch : ""),
      contrastBranch: request_body.contrastBranch || "main",
      serviceKey: _service_key(request_body) || _service_key(services[0]),
      services,
      batchIds: batch_ids,
      testCaseIds: request_body.testCaseIds || [],
      issueList: request_body.issueList || [],
      requirementDocs: request_body.requirementDocs || [],
      technicalDocs: request_body.technicalDocs || [],
      strategyCodes: request_body.strategyCodes || [8, 11],
      summary: "",
      createdAt: _now(),
      updatedAt: _now(),
    };
    const ext = request_body.extInfo || {};
    if (ext.requirementDocs) task.requirementDocs = ext.requirementDocs;
    if (ext.technicalDocs) task.technicalDocs = ext.technicalDocs;
    if (ext.testCaseIds) task.testCaseIds = ext.testCaseIds;
    this._save_task(task);
    return ok({
      taskId: task_id,
      batchIds: batch_ids,
      reportUrl: this.report_url(task_id),
    });
  }

  override get_task_status(task_id: number): Record<string, any> {
    const task = this._task(task_id);
    if (!task) return fail(`task ${task_id} not found`);
    const batches = this._batches_for_task(task_id);
    const payload = structuredClone(task);
    payload.batches = batches;
    payload.reportUrl = this.report_url(task_id);
    return ok(payload);
  }

  override list_my_tasks(submit_user: string, limit = 20): Record<string, any> {
    let tasks = this.store.list_json("tasks");
    if (submit_user) {
      tasks = tasks.filter((t) => t.submitUser === submit_user);
    }
    tasks.sort((a, b) => (b.taskId || 0) - (a.taskId || 0));
    return ok(tasks.slice(0, limit));
  }

  override get_pending_processes(batch_id: number): Record<string, any> {
    const batch = this._batch(batch_id);
    if (!batch) return fail(`batch ${batch_id} not found`);
    const items: Record<string, any>[] = [];
    for (const process of this._processes_for_batch(batch_id)) {
      if (process.bugStatus === undefined || process.bugStatus === null || process.bugStatus === 0) {
        items.push(process);
      }
    }
    return ok(items);
  }

  override check_detection_coverage(batch_id: number): Record<string, any> {
    const processes = this._processes_for_batch(batch_id);
    const missed = processes.filter((p) => p.bugStatus === undefined || p.bugStatus === null || p.bugStatus === 0);
    return ok({
      allCompleted: missed.length === 0,
      total: processes.length,
      completed: processes.length - missed.length,
      missedItems: missed.map((p) => ({
        processId: p.processId,
        className: p.className,
        methodName: p.methodName,
      })),
    });
  }

  override update_process(request_body: Record<string, any>): Record<string, any> {
    const process_id = request_body.processId;
    const existing = process_id ? this._process(parseInt(String(process_id), 10)) : null;
    if (existing) {
      Object.assign(existing, request_body);
      existing.updatedAt = _now();
      this._save_process(existing);
      return ok(existing);
    }

    const batch_id = request_body.parentBatchId;
    const class_name = request_body.className;
    const method_name = request_body.methodName || "";
    const strategy = request_body.strategyCode;
    if (batch_id && class_name) {
      for (const process of this._processes_for_batch(parseInt(String(batch_id), 10))) {
        if (
          process.className === class_name
          && (process.methodName || "") === method_name
          && process.strategyCode === strategy
        ) {
          Object.assign(process, request_body);
          process.updatedAt = _now();
          this._save_process(process);
          return ok(process);
        }
      }
    }

    const new_id = this._next_id("nextProcessId");
    const record = structuredClone(request_body);
    record.processId = new_id;
    record.createdAt = _now();
    record.updatedAt = _now();
    this._save_process(record);
    if (batch_id) {
      const batch = this._batch(parseInt(String(batch_id), 10));
      if (batch) {
        const ids = [...(batch.processIds || [])];
        if (!ids.includes(new_id)) {
          ids.push(new_id);
          batch.processIds = ids;
          this._save_batch(batch);
        }
      }
    }
    return ok(record);
  }

  override batch_dismiss_by_strategy(parent_batch_id: number, strategy_code = 8): Record<string, any> {
    let affected = 0;
    for (const process of this._processes_for_batch(parent_batch_id)) {
      if (
        process.strategyCode === strategy_code
        && (process.bugStatus === undefined || process.bugStatus === null || process.bugStatus === 0)
      ) {
        process.bugStatus = 2;
        process.updatedAt = _now();
        this._save_process(process);
        affected += 1;
      }
    }
    return ok({ affected });
  }

  override batch_dismiss_by_class_names(task_id: number, class_names: string[]): Record<string, any> {
    const names = new Set(class_names || []);
    let affected = 0;
    for (const process of this.store.list_json("processes")) {
      if (process.taskId !== task_id) continue;
      if (!names.has(process.className)) continue;
      if (process.bugStatus === undefined || process.bugStatus === null || process.bugStatus === 0) {
        process.bugStatus = 2;
        process.updatedAt = _now();
        this._save_process(process);
        affected += 1;
      }
    }
    return ok({ affected });
  }

  override check_rank_integrity(batch_id: number): Record<string, any> {
    const processes = this._processes_for_batch(batch_id).filter((p) =>
      p.bugStatus !== undefined && p.bugStatus !== null && p.bugStatus !== 0,
    );
    const ranks = this._ranks_for_batch(batch_id);
    const process_keys = new Set(
      processes.filter((p) => p.bugStatus === 6 || p.bugStatus === 7).map((p) =>
        JSON.stringify([p.className, p.methodName || ""]),
      ),
    );
    const rank_keys = new Set(ranks.map((r) => JSON.stringify([r.className, r.methodName || ""])));
    const missing_rank = [...process_keys].filter((k) => !rank_keys.has(k)).sort().map((k) => {
      const [c, m] = JSON.parse(k);
      return { className: c, methodName: m };
    });
    const missing_process = [...rank_keys].filter((k) => !process_keys.has(k)).sort().map((k) => {
      const [c, m] = JSON.parse(k);
      return { className: c, methodName: m };
    });
    return ok({
      allConsistent: !missing_rank.length && !missing_process.length,
      missingRankItems: missing_rank,
      missingProcessItems: missing_process,
    });
  }

  override finalize_rank(body: Record<string, any>): Record<string, any> {
    const batch_id = body.parentBatchId;
    const class_name = body.className;
    const method_name = body.methodName || "";
    let existing: Record<string, any> | null = null;
    for (const rank of this._ranks_for_batch(parseInt(String(batch_id || 0), 10))) {
      if (rank.className === class_name && (rank.methodName || "") === method_name) {
        existing = rank;
        break;
      }
    }
    if (existing) {
      Object.assign(existing, body);
      existing.invalid = false;
      existing.updatedAt = _now();
      this._save_rank(existing);
      return ok(existing);
    }
    const rank_id = this._next_id("nextRankId");
    const record = structuredClone(body);
    record.rankId = rank_id;
    record.invalid = false;
    record.createdAt = _now();
    record.updatedAt = _now();
    this._save_rank(record);
    return ok(record);
  }

  override update_rank_content(rank_id: number, content: string): Record<string, any> {
    const rank = this._rank(rank_id);
    if (!rank) return fail(`rank ${rank_id} not found`);
    rank.content = content;
    rank.updatedAt = _now();
    this._save_rank(rank);
    return ok(rank);
  }

  override update_detection_summary(task_id: number, summary: string): Record<string, any> {
    const task = this._task(task_id);
    if (!task) return fail(`task ${task_id} not found`);
    task.summary = summary;
    task.updatedAt = _now();
    this._save_task(task);
    return ok({ taskId: task_id, summaryLength: (summary || "").length });
  }

  override complete_task(task_id: number, failed = false, fail_msg: string | null = null): Record<string, any> {
    const task = this._task(task_id);
    if (!task) return fail(`task ${task_id} not found`);
    task.status = failed ? "failed" : "completed";
    if (fail_msg) task.failMsg = fail_msg;
    task.updatedAt = _now();
    for (const batch of this._batches_for_task(task_id)) {
      if (!TERMINAL_BATCH.has(batch.status)) {
        batch.status = failed ? "failed" : "completed";
        this._save_batch(batch);
      }
    }
    this._save_task(task);
    return ok({ taskId: task_id, status: task.status, reportUrl: this.report_url(task_id) });
  }

  override skip_service_batch(parent_batch_id: number, failed = false, reason: string | null = null): Record<string, any> {
    const batch = this._batch(parent_batch_id);
    if (!batch) return fail(`batch ${parent_batch_id} not found`);
    batch.status = failed ? "failed" : "skipped";
    batch.reason = reason || (failed ? "detection failed" : "skipped");
    this._save_batch(batch);
    const task = this._task(batch.taskId);
    if (task) {
      const siblings = this._batches_for_task(task.taskId);
      if (siblings.every((b) => TERMINAL_BATCH.has(b.status))) {
        task.status = siblings.some((b) => b.status === "failed") ? "failed" : "completed";
        this._save_task(task);
      }
    }
    return ok(batch);
  }

  override force_abort_task(task_id: number, reason: string | null = null): Record<string, any> {
    const task = this._task(task_id);
    if (!task) return fail(`task ${task_id} not found`);
    task.status = "aborted";
    task.failMsg = reason || "aborted by user";
    task.updatedAt = _now();
    for (const batch of this._batches_for_task(task_id)) {
      if (!TERMINAL_BATCH.has(batch.status)) {
        batch.status = "aborted";
        this._save_batch(batch);
      }
    }
    this._save_task(task);
    return ok(task);
  }

  override retry_detection(task_id: number, submit_user: string | null = null): Record<string, any> {
    const task = this._task(task_id);
    if (!task) return fail(`task ${task_id} not found`);
    const body = structuredClone(task);
    body.submitUser = submit_user || task.submitUser;
    delete body.taskId;
    delete body.batchIds;
    delete body.summary;
    delete body.status;
    return this.submit_detection(body);
  }

  override get_rules(_git: string | null = null, _user_id: string | null = null): Record<string, any> {
    const rules = this.store.read("rules.json", { default: DEFAULT_RULES });
    return ok(rules);
  }

  override get_report(task_id: number): Record<string, any> {
    const task = this._task(task_id);
    if (!task) return fail(`task ${task_id} not found`);
    const processes = this.store.list_json("processes").filter((p) => p.taskId === task_id);
    const ranks = this.store.list_json("ranks").filter((r) =>
      r.taskId === task_id || (task.batchIds || []).includes(r.parentBatchId),
    );
    const defect_ranks = ranks.filter((r) => (r.bugStatus === 6 || r.bugStatus === 7) && !r.invalid);
    const batch_ids = task.batchIds || [];
    const job_vos: Record<string, any>[] = [];
    for (const bid of batch_ids) {
      const job_ranks = defect_ranks
        .filter((r) => r.parentBatchId === bid || r.parentBatchId === String(bid) || r.parentBatchId == null)
        .map((r) => ({
          ...r,
          valid: 1,
          batchId: r.parentBatchId || bid,
        }));
      job_vos.push({
        batchId: bid,
        jobId: bid,
        defectRankResults: job_ranks,
      });
    }
    return ok({
      taskId: task_id,
      status: task.status,
      summary: task.summary || "",
      reportUrl: this.report_url(task_id),
      batchIds: batch_ids.map((b: any) => String(b)).join(","),
      processCount: processes.length,
      rankCount: ranks.length,
      defects: defect_ranks,
      jobDetectionVos: job_vos,
      processes,
      ranks,
    });
  }

  override get_confirmed_defect_history(params: Record<string, any>): Record<string, any> {
    const history = this.store.read("history.json", { default: [] });
    const git = params.git;
    let items = (history as any[]).filter((h) => !git || h.git === git);
    if (params.className) items = items.filter((h) => h.className === params.className);
    if (params.methodName) items = items.filter((h) => h.methodName === params.methodName);
    if (params.gitFilePath) items = items.filter((h) => h.gitFilePath === params.gitFilePath);
    return ok(items);
  }

  override get_defect_history_by_commit(params: Record<string, any>): Record<string, any> {
    const history = this.store.read("history.json", { default: [] });
    const items = (history as any[]).filter((h) => h.git === params.git && h.devCommit === params.devCommit);
    return ok(items);
  }

  override get_tag_list(): Record<string, any> {
    const tags = this.store.read("tags.json", { default: DEFAULT_TAGS });
    return ok(tags);
  }

  override report_progress(body: Record<string, any>): Record<string, any> {
    const task_id = body.taskId;
    if (!task_id) return fail("taskId is required");
    const record = { ...body, updatedAt: _now() };
    this.store.write("progress", `${task_id}.json`, { data: record });
    return ok(record);
  }

  override get_detection_flow_by_process(process_id: number): Record<string, any> {
    const process = this._process(process_id);
    if (!process) return fail(`process ${process_id} not found`);
    return ok(process);
  }

  override get_detection_flow_by_rank(rank_id: number): Record<string, any> {
    const rank = this._rank(rank_id);
    if (!rank) return fail(`rank ${rank_id} not found`);
    let related: Record<string, any>[] = [];
    if (rank.processIds) {
      const raw = rank.processIds;
      const ids = String(raw).split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map((x) => parseInt(x, 10));
      related = ids.map((i) => this._process(i)).filter((p): p is Record<string, any> => Boolean(p));
    }
    return ok({ rank, processes: related });
  }

  override query_detection_records(params: Record<string, any>): Record<string, any> {
    let tasks = this.store.list_json("tasks");
    const plan_id = params.planId;
    if (params.git) tasks = tasks.filter((t) => t.git === params.git);
    if (plan_id) tasks = tasks.filter((t) => t.planId === plan_id);
    if (params.developBranch) tasks = tasks.filter((t) => t.developBranch === params.developBranch);
    return ok(tasks);
  }

  override mark_bug(body: Record<string, any>): Record<string, any> {
    const rank_id = body.rankId;
    const rank = rank_id ? this._rank(parseInt(String(rank_id), 10)) : null;
    if (!rank) return fail("rank not found");
    rank.bugStatus = ("bugStatus" in body) ? body.bugStatus : rank.bugStatus;
    if (body.extra) rank.userFeedback = body.extra;
    rank.operator = body.userId || "";
    rank.updatedAt = _now();
    this._save_rank(rank);
    if (rank.bugStatus === 3) {
      const history = this.store.read("history.json", { default: [] });
      history.push({
        git: rank.git,
        className: rank.className,
        methodName: rank.methodName,
        content: rank.content,
        bugStatus: 3,
        feedbackConclusion: "USER_CONFIRMED_VALID",
        confirmedAt: _now(),
      });
      this.store.write("history.json", { data: history });
    }
    if (rank.bugStatus === 4) {
      const history = this.store.read("history.json", { default: [] });
      history.push({
        git: rank.git,
        className: rank.className,
        methodName: rank.methodName,
        content: rank.content,
        bugStatus: 4,
        feedbackConclusion: "USER_REJECTED",
        userFeedback: body.extra || "",
        confirmedAt: _now(),
      });
      this.store.write("history.json", { data: history });
    }
    return ok(rank);
  }

  override invalid_record(rank_id: number): Record<string, any> {
    const rank = this._rank(rank_id);
    if (!rank) return fail(`rank ${rank_id} not found`);
    rank.invalid = true;
    rank.updatedAt = _now();
    this._save_rank(rank);
    return ok(rank);
  }
}
