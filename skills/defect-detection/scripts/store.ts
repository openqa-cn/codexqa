/**
 * content_store — detection context persistence (multi-file shards)
 *
 * Storage location: <skill_dir>/data/<taskId>/
 *   - meta.json       — task metadata + service/repo info + diff info
 *   - static.json     — large read-only data derived from rules/tags/extracted doc rules
 *   - context.json    — document summary + inter-service dependencies
 *   - test_cases.json — parsed test-case info
 *   - plan.json       — detectionPlan
 *   - writebacks.json — write-back records + ranks + contextReads
 *   - findings.json   — summaryFindings
 *
 * Backward compatible: if a legacy content.json is found, it is auto-migrated into the new format.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_ROOT } from "./providers/config.ts";
import {
  ALL_PROFILES,
  LANG_TO_EXTENSIONS,
  code_fence_for_language,
  guess_file_path_for_class,
  has_path_class_name,
  is_client_path,
  language_from_path,
} from "./lang.ts";
import { class_names_match, normalize_class_name_key } from "./state.ts";

function _truthy(value: any): boolean {
  if (value == null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function _validate_task_id(task_id: any): number {
  if (typeof task_id !== "number" || !Number.isInteger(task_id)) {
    throw new Error(`task_id must be a positive integer, got: ${JSON.stringify(task_id)} (type=${typeof task_id})`);
  }
  if (task_id <= 0) {
    throw new Error(`task_id must be a positive integer (>0), got: ${task_id}`);
  }
  return task_id;
}

const _CONTENT_MARKERS = [
  "meta.json",
  "content.json",
  "plan.json",
  "writebacks.json",
  "findings.json",
  "static.json",
  "local_state.json",
];

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

export function content_base_dir(): string {
  return process.env.CONTENT_JSON_BASE || process.env.DETECTION_DATA_DIR || join(SKILL_ROOT, "data");
}

/**
 * Where clone-and-diff keeps git checkouts: `<data dir>/repos/<repoHash>`.
 * Override with DETECTION_CLONE_DIR (e.g. a fast scratch disk). Kept next to the
 * task data so cleanup-stale-data can age it out and multi-user /tmp is not shared.
 */
export function repo_clone_base_dir(): string {
  return process.env.DETECTION_CLONE_DIR || join(content_base_dir(), "repos");
}

function _data_dir(task_id: number): string {
  _validate_task_id(task_id);
  return join(content_base_dir(), String(task_id));
}

function _norm_git_url(url: string | null | undefined): string {
  const s = (url || "").trim().toLowerCase();
  return s.endsWith(".git") ? s.slice(0, -4) : s;
}

export function content_store_occupied(task_id: number): boolean {
  let path: string;
  try {
    path = _data_dir(task_id);
  } catch {
    return false;
  }
  if (!_is_dir(path)) return false;
  return _CONTENT_MARKERS.some((name) => _is_file(join(path, name)));
}

export function list_occupied_task_ids(): number[] {
  const base = content_base_dir();
  if (!_is_dir(base)) return [];
  const occupied: number[] = [];
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const tid = Number.parseInt(name, 10);
    if (tid > 0 && content_store_occupied(tid)) occupied.push(tid);
  }
  return occupied.sort((a, b) => a - b);
}

export function next_free_task_id(preferred: number | null = null): number {
  const occupied = list_occupied_task_ids();
  const start = typeof preferred === "number" && Number.isInteger(preferred) && preferred > 0 ? preferred : 1;
  if (!occupied.length) return start;
  return Math.max(start, Math.max(...occupied) + 1);
}

export function content_store_identity(task_id: number): Record<string, any> {
  if (!content_store_occupied(task_id)) return {};
  const store = new ContentStore(task_id);
  const meta = store.load_meta_only();
  const inner = meta.meta || {};
  const services = meta.services || [];
  const diff = meta.diff || {};
  const gits = services.filter((svc: any) => svc.gitUrl).map((svc: any) => _norm_git_url(svc.gitUrl));
  const branches = services.filter((svc: any) => svc.branch).map((svc: any) => (svc.branch || "").trim());
  const plan_data = store.load_plan_only();
  const writebacks = store.load_writebacks_only();
  const findings = store.load_findings_only();
  return {
    taskId: task_id,
    testPlanId: inner.testPlanId,
    planName: (inner.planName || "").trim() || null,
    gits: gits.filter((g: string) => g),
    branches: branches.filter((b: string) => b),
    startedAt: inner.startedAt,
    hasServices: _truthy(services),
    hasDiff: _truthy(diff.files),
    hasPlan: _truthy(plan_data.detectionPlan),
    hasWritebacks: _truthy(writebacks.processWritebacks) || _truthy(writebacks.ranks),
    hasFindings: _truthy((findings || {}).summaryFindings),
  };
}

export function content_has_work(identity: Record<string, any>): boolean {
  if (!_truthy(identity)) return false;
  return Boolean(
    identity.hasServices ||
      identity.hasDiff ||
      identity.hasPlan ||
      identity.hasWritebacks ||
      identity.hasFindings ||
      identity.testPlanId,
  );
}

export function identities_conflict(existing: Record<string, any>, incoming: Record<string, any> | null): boolean {
  if (!_truthy(existing) || !_truthy(incoming)) return false;
  const inc_plan = incoming.testPlanId;
  if (inc_plan && existing.testPlanId && String(inc_plan) !== String(existing.testPlanId)) return true;
  const inc_git = _norm_git_url(incoming.gitUrl || incoming.git);
  const existing_gits = existing.gits || [];
  if (inc_git && existing_gits.length && !existing_gits.includes(inc_git)) return true;
  const inc_branch = (incoming.branch || incoming.developBranch || "").trim();
  const existing_branches = existing.branches || [];
  if (inc_git && inc_branch && existing_gits.length && existing_gits.includes(inc_git) && existing_branches.length) {
    if (!existing_branches.includes(inc_branch)) return true;
  }
  const inc_name = (incoming.planName || "").trim();
  if (inc_name && existing.planName && inc_name !== existing.planName) return true;
  return false;
}

export function parse_iso_timestamp(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  try {
    const d = new Date(value.replace("Z", "+00:00"));
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

function _content_json_path(task_id: number): string {
  return join(_data_dir(task_id), "content.json");
}

const _SHARD_FILES: Record<string, string> = {
  meta: "meta.json",
  static: "static.json",
  context: "context.json",
  test_cases: "test_cases.json",
  plan: "plan.json",
  writebacks: "writebacks.json",
  findings: "findings.json",
};

const _STATIC_META_KEYS = new Set(["rules", "tagIds", "extractedRules", "historyDefects"]);

function _shard_path(task_id: number, shard: string): string {
  return join(_data_dir(task_id), _SHARD_FILES[shard]);
}

function _now(): string {
  return new Date().toISOString();
}

export const _SERVICE_ALLOWED_KEYS = new Set([
  "serviceKey",
  "gitUrl",
  "branch",
  "commitId",
  "localDir",
  "batchIds",
  "modulePrefix",
  "language",
  "languageSource",
  "languageBreakdown",
  "verified",
]);
export const _DOC_ALLOWED_KEYS = new Set([
  "contentId",
  "title",
  "url",
  "fetchMethod",
  "coreInterfaces",
  "businessRules",
  "degradeStrategies",
  "dataFlows",
  "boundaryConditions",
  "configDependencies",
  "fetchStatus",
  "fetchError",
  "filePath",
  "repoSource",
  "content",
  "description",
]);
export const _TEST_CASE_ALLOWED_KEYS = new Set([
  "id",
  "title",
  "preCondition",
  "steps",
  "expectedResult",
  "fetchStatus",
  "relatedMethods",
  "relatedClassNames",
  "rawPreCondition",
  "rawSteps",
  "rawExpectedResult",
  "semanticContract",
  "verificationObligations",
  "ambiguities",
  "semanticReviewStatus",
  "semanticReviewSkill",
  "pipelineStatus",
  "pipelineRetried",
  "descParseStatus",
]);
const _PLAN_ITEM_ALLOWED_KEYS = new Set([
  "className",
  "methodName",
  "strategyCode",
  "parentBatchId",
  "processId",
  "batchId",
  "filePath",
  "docRelevance",
  "caseRelevance",
  "astScanResult",
  "status",
  "analyzeStartedAt",
  "analyzeFinishedAt",
  "source",
  "minDetectLevel",
  "detectTier",
  "chainGroupId",
  "mode",
  "bodyLineCount",
  "expressionBody",
  "params",
  "trivial",
  "trivialReason",
  "suggestedTier",
  "language",
  "fileLevel",
  "startLine",
  "endLine",
  "rangeSource",
]);

export function changed_method_name(entry: any): string {
  if (entry == null) return "";
  if (typeof entry === "string") return entry.trim();
  if (typeof entry === "object") return String(entry.methodName || entry.name || "").trim();
  return String(entry).trim();
}

/** Every extension the language registry knows, non-JVM first (path-style classNames hit directly). */
const _ALL_SOURCE_EXTS: string[] = (() => {
  const jvm: string[] = [];
  const other: string[] = [];
  for (const p of ALL_PROFILES) (p.family === "jvm" ? jvm : other).push(...p.extensions);
  for (const [lang, exts] of Object.entries(LANG_TO_EXTENSIONS)) {
    if (!ALL_PROFILES.some((p) => p.id === lang)) other.push(...exts);
  }
  return [...new Set([...other, ".vue", ".svelte", ...jvm])];
})();

export function normalize_changed_method(entry: any): Record<string, any> {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const raw = entry.bodyLineCount;
    let bodyLineCount: number | null = null;
    if (typeof raw === "number" && Number.isFinite(raw)) bodyLineCount = raw;
    else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) bodyLineCount = parseInt(raw.trim(), 10);
    return {
      methodName: changed_method_name(entry),
      params: entry.params ?? "",
      bodyLineCount,
      startLine: entry.startLine ?? null,
      endLine: entry.endLine ?? null,
      signature: entry.signature ?? null,
      returnType: entry.returnType ?? null,
      expressionBody: entry.expressionBody === true,
      // Kept so write-back resolution can use the real path instead of guessing
      // a `src/main/java/...` one for JS / Python / Go units.
      filePath: entry.filePath ?? null,
      fileLevel: entry.fileLevel ?? null,
      language: entry.language ?? null,
      rangeSource: entry.rangeSource ?? null,
    };
  }
  return {
    methodName: changed_method_name(entry),
    params: "",
    bodyLineCount: null,
    startLine: null,
    endLine: null,
    signature: null,
    returnType: null,
    expressionBody: false,
    filePath: null,
    fileLevel: null,
    language: null,
    rangeSource: null,
  };
}
const _WRITEBACK_ALLOWED_KEYS = new Set([
  "parentBatchId",
  "className",
  "methodName",
  "strategyCode",
  "bugStatus",
  "hasExclusion",
  "writtenAt",
  "writeMethod",
  "errorInfo",
]);
const _RANK_ALLOWED_KEYS = new Set([
  "className",
  "methodName",
  "bugStatus",
  "rankId",
  "parentBatchId",
  "writtenAt",
  "writeMethod",
  "hasExclusion",
  "errorInfo",
  "userFeedback",
  "operator",
]);
const _XREPO_ALLOWED_KEYS = new Set(["source", "sourceRepo", "strategy", "referencingClass", "detectedAt"]);
const _CONTEXT_READ_ALLOWED_KEYS = new Set([
  "className",
  "filePath",
  "purpose",
  "linesRead",
  "readAt",
  "parentBatchId",
]);
const _FINDING_ALLOWED_KEYS = new Set([
  "phase",
  "category",
  "text",
  "source",
  "recordedAt",
  "status",
  "actionRequired",
  "direction",
]);
const _FINDING_PHASES = new Set(["prep", "analysis"]);
const _FINDING_CATEGORIES = new Set(["gap", "risk", "change", "insight", "cross-view"]);
const _PLAN_ITEM_STATUS = new Set(["pending", "analyzed", "written"]);
const _BUGSTATUS_ALLOWED = new Set([2, 6, 7]);
const _RANK_USER_VERDICTS = new Set([3, 4, 5, 8]);

function _validate_keys(obj: Record<string, any>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.has(k)).sort();
  if (unknown.length) {
    throw new Error(`${label} contains illegal fields: ${unknown.join(", ")}`);
  }
}

function _validate_plan_item(item: Record<string, any>): void {
  _validate_keys(item, _PLAN_ITEM_ALLOWED_KEYS, "detectionPlan item");
  if (!item.className) throw new Error("detectionPlan item missing required field className");
  if (!item.methodName) throw new Error("detectionPlan item missing required field methodName");
  const sc = item.strategyCode;
  if (typeof sc !== "number" || !Number.isInteger(sc)) {
    throw new Error(`detectionPlan item strategyCode must be int, got: ${typeof sc}`);
  }
  if (item.status != null && !_PLAN_ITEM_STATUS.has(item.status)) {
    throw new Error(
      `detectionPlan item status illegal: ${item.status}, allowed: ${[..._PLAN_ITEM_STATUS].sort().join(", ")}`,
    );
  }
}

const _DEFECT_BUGSTATUS = new Set([6, 7]);

export function is_defect_bug_status(bug_status: any): boolean {
  return _DEFECT_BUGSTATUS.has(bug_status);
}

/** Same class+method+strategy, treating short vs FQCN className as one key. */
export function writeback_identity_match(a: Record<string, any>, b: Record<string, any>): boolean {
  return (
    class_names_match(String(a?.className || ""), String(b?.className || "")) &&
    String(a?.methodName || "") === String(b?.methodName || "") &&
    Number(a?.strategyCode) === Number(b?.strategyCode)
  );
}

/** A later bugStatus=2 must not clobber an earlier confirmed defect (6/7). */
export function writeback_should_protect(existing: Record<string, any>, incoming: Record<string, any>): boolean {
  return is_defect_bug_status(existing?.bugStatus) && incoming?.bugStatus === 2;
}

export function find_matching_writeback(
  records: Record<string, any>[] | null | undefined,
  incoming: Record<string, any>,
): Record<string, any> | undefined {
  if (!records?.length) return undefined;
  return records.find((r) => writeback_identity_match(r, incoming));
}

/**
 * Which of `candidates` a class+method+strategy record refers to.
 *
 * The full className decides: a bare simple name resolves only when exactly one
 * candidate path carries it, so `http#constructor` never closes both
 * `providers/docs/http` and `providers/traces/http`. Among candidates on the
 * same class the exact analysis view wins, which keeps a business write-back
 * (11) from closing a pending AST item (8) on the same method. The
 * cross-strategy fallback survives only for methods with a single view.
 */
export function matching_plan_units<T extends Record<string, any>>(candidates: T[], record: Record<string, any>): T[] {
  const method = String(record?.methodName || "");
  const class_name = String(record?.className || "");
  const same_method = candidates.filter((c) => String(c?.methodName || "") === method);
  if (!same_method.length) return [];

  let hits = same_method.filter(
    (c) => normalize_class_name_key(String(c?.className || "")) === normalize_class_name_key(class_name),
  );
  if (!hits.length) {
    const loose = same_method.filter((c) => class_names_match(String(c?.className || ""), class_name));
    const paths = new Set(loose.map((c) => normalize_class_name_key(String(c?.className || ""))));
    if (paths.size !== 1) return [];
    hits = loose;
  }
  if (hits.length < 2) return hits;

  const strategy = Number(record.strategyCode ?? 11);
  const exact = hits.filter((c) => Number(c.strategyCode ?? 11) === strategy);
  return exact.length ? exact : [];
}

export type WritebackRecordResult = {
  status: "inserted" | "updated" | "protected";
  className: string;
  methodName: string;
  existingBugStatus?: number;
  incomingBugStatus?: number;
};

function _validate_writeback(record: Record<string, any>): void {
  _validate_keys(record, _WRITEBACK_ALLOWED_KEYS, "processWriteback record");
  if (!record.className) throw new Error("processWriteback missing required field className");
  if (!record.methodName) throw new Error("processWriteback missing required field methodName");
  const sc = record.strategyCode;
  if (typeof sc !== "number" || !Number.isInteger(sc)) {
    throw new Error(`processWriteback strategyCode must be int, got: ${typeof sc}`);
  }
  const bs = record.bugStatus;
  if (bs != null && !_BUGSTATUS_ALLOWED.has(bs)) {
    throw new Error(`processWriteback bugStatus illegal: ${bs}, allowed: 2, 6, 7`);
  }
}

function _validate_rank(rank: Record<string, any>): void {
  _validate_keys(rank, _RANK_ALLOWED_KEYS, "rank record");
  if (!rank.className) throw new Error("rank missing required field className");
  if (!rank.methodName) throw new Error("rank missing required field methodName");
  // AI writes 2/6/7; ranks additionally carry the user verdicts 3/4/5/8 from mark-bug.
  const bs = rank.bugStatus;
  if (bs != null && !_BUGSTATUS_ALLOWED.has(bs) && !_RANK_USER_VERDICTS.has(bs)) {
    throw new Error(`rank bugStatus illegal: ${bs}, allowed: 2, 6, 7 (AI) or 3, 4, 5, 8 (user verdict)`);
  }
}

function _validate_service(service: Record<string, any>): void {
  _validate_keys(service, _SERVICE_ALLOWED_KEYS, "service");
}

function _validate_document(doc: Record<string, any>): void {
  _validate_keys(doc, _DOC_ALLOWED_KEYS, "document");
}

function _validate_test_case(caseObj: Record<string, any>): void {
  _validate_keys(caseObj, _TEST_CASE_ALLOWED_KEYS, "test case");
}

function _validate_cross_repo(info: Record<string, any>): void {
  _validate_keys(info, _XREPO_ALLOWED_KEYS, "cross repo class info");
}

function _validate_context_read(record: Record<string, any>): void {
  _validate_keys(record, _CONTEXT_READ_ALLOWED_KEYS, "contextRead record");
  if (!record.className) throw new Error("contextRead missing required field className");
  if (!record.filePath) throw new Error("contextRead missing required field filePath");
}

function _validate_finding(record: Record<string, any>): void {
  _validate_keys(record, _FINDING_ALLOWED_KEYS, "summaryFinding record");
  const phase = record.phase;
  if (!phase) throw new Error("summaryFinding missing required field phase");
  if (!_FINDING_PHASES.has(phase)) {
    throw new Error(`summaryFinding phase illegal: ${phase}, allowed: ${[..._FINDING_PHASES].sort().join(", ")}`);
  }
  const category = record.category;
  if (!category) throw new Error("summaryFinding missing required field category");
  if (!_FINDING_CATEGORIES.has(category)) {
    throw new Error(
      `summaryFinding category illegal: ${category}, allowed: ${[..._FINDING_CATEGORIES].sort().join(", ")}`,
    );
  }
  const text = (record.text || "").trim();
  if (!text || text.length < 5) {
    throw new Error("summaryFinding text cannot be empty and must be at least 5 characters (must be a concrete fact, not fluff)");
  }
}

function _load_json(path: string, defaultValue: any = null): any {
  if (!_is_file(path)) {
    const tmp_path = path + ".tmp";
    if (_is_file(tmp_path)) {
      try {
        const data = JSON.parse(readFileSync(tmp_path, "utf8"));
        renameSync(tmp_path, path);
        console.error(`[content-store] ℹ️ recovered from .tmp: ${path}`);
        return data;
      } catch {
        try {
          rmSync(tmp_path);
        } catch {
          /* ignore */
        }
      }
    }
    return defaultValue;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e: any) {
    console.error(`[content-store] ⚠️ load failed ${path}: ${e}`);
    return defaultValue;
  }
}

function _save_json(path: string, data: any): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (e: any) {
    console.error(`[content-store] ⚠️ directory create failed: ${e}`);
    return false;
  }
  const tmp = path + ".tmp";
  try {
    const text = JSON.stringify(data, null, 2);
    if (text === undefined) throw new TypeError("data is not serializable");
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
    return true;
  } catch (e: any) {
    console.error(`[content-store] ⚠️ write failed ${path}: ${e}`);
    try {
      if (_is_file(tmp)) rmSync(tmp);
    } catch {
      /* ignore */
    }
    return false;
  }
}

function _deep_merge(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key in result && result[key] && typeof result[key] === "object" && !Array.isArray(result[key]) && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = _deep_merge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function _default_meta(task_id: number): Record<string, any> {
  return {
    meta: {
      taskId: task_id,
      testPlanId: null,
      planName: null,
      startedAt: _now(),
      lastUpdatedAt: _now(),
      status: "in_progress",
      userId: null,
      errorLog: [],
    },
    services: [],
    diff: {
      files: [],
      changedMethods: {},
      diffSummary: "",
      totalChangeLines: 0,
    },
  };
}

function _default_static(): Record<string, any> {
  return {
    staticMeta: {},
    extractedRules: [],
    documents: {
      techDocs: [],
      prdDocs: [],
    },
  };
}

function _default_test_cases(): Record<string, any> {
  return { testCases: [] };
}

function _default_context(): Record<string, any> {
  return {
    documents: {
      summaryPath: null,
    },
    serviceDependencies: {
      jarDependencies: [],
      thriftDependencies: [],
      crossRepoClasses: {},
      notes: "",
    },
  };
}

function _default_plan(): Record<string, any> {
  return { detectionPlan: [] };
}

function _default_writebacks(): Record<string, any> {
  return {
    processWritebacks: [],
    ranks: [],
    contextReads: [],
  };
}

function _default_findings(): Record<string, any> {
  return { summaryFindings: [] };
}

function _migrate_from_legacy(task_id: number): boolean {
  const legacy_path = _content_json_path(task_id);
  if (!_is_file(legacy_path)) return false;

  const meta_path = _shard_path(task_id, "meta");
  if (_is_file(meta_path)) return false;

  const legacy_data = _load_json(legacy_path);
  if (!legacy_data || typeof legacy_data !== "object" || Array.isArray(legacy_data)) return false;

  console.error("[content-store] 🔄 detected legacy content.json, migrating to multi-file format...");

  const legacy_meta = { ...(legacy_data.meta || {}) };
  const static_meta: Record<string, any> = {};
  for (const k of Object.keys(legacy_meta)) {
    if (_STATIC_META_KEYS.has(k)) {
      static_meta[k] = legacy_meta[k];
      delete legacy_meta[k];
    }
  }

  const meta_data = {
    meta: legacy_meta,
    services: legacy_data.services || [],
    diff: legacy_data.diff || { files: [], changedMethods: {}, diffSummary: "", totalChangeLines: 0 },
  };

  const legacy_docs = legacy_data.documents || {};
  let extracted_rules = legacy_docs.extractedRules;
  if (!_truthy(extracted_rules)) {
    extracted_rules = static_meta.extractedRules;
    delete static_meta.extractedRules;
    if (!_truthy(extracted_rules)) extracted_rules = [];
  } else {
    delete static_meta.extractedRules;
  }
  const static_data = {
    staticMeta: static_meta,
    extractedRules: extracted_rules,
    documents: {
      techDocs: legacy_docs.techDocs || [],
      prdDocs: legacy_docs.prdDocs || [],
    },
  };

  const test_cases_data = {
    testCases: legacy_data.testCases || [],
  };

  const context_data = {
    documents: {
      summaryPath: legacy_docs.summaryPath,
    },
    serviceDependencies: legacy_data.serviceDependencies || {
      jarDependencies: [],
      thriftDependencies: [],
      crossRepoClasses: {},
      notes: "",
    },
  };

  const plan_data = {
    detectionPlan: legacy_data.detectionPlan || [],
  };

  const writebacks_data = {
    processWritebacks: legacy_data.processWritebacks || [],
    ranks: legacy_data.ranks || [],
    contextReads: legacy_data.contextReads || [],
  };

  const findings_data = {
    summaryFindings: legacy_data.summaryFindings || [],
  };

  _save_json(_shard_path(task_id, "meta"), meta_data);
  _save_json(_shard_path(task_id, "static"), static_data);
  _save_json(_shard_path(task_id, "context"), context_data);
  _save_json(_shard_path(task_id, "test_cases"), test_cases_data);
  _save_json(_shard_path(task_id, "plan"), plan_data);
  _save_json(_shard_path(task_id, "writebacks"), writebacks_data);
  _save_json(_shard_path(task_id, "findings"), findings_data);

  const backup_path = legacy_path + ".legacy";
  try {
    renameSync(legacy_path, backup_path);
    console.error(`[content-store] ✅ migration complete, legacy file backed up as ${backup_path}`);
  } catch {
    console.error("[content-store] ⚠️ migration complete but renaming the legacy file failed");
  }

  return true;
}

function _migrate_meta_to_static(task_id: number): boolean {
  const meta_path = _shard_path(task_id, "meta");
  if (!_is_file(meta_path)) return false;

  let did_migrate = false;
  const static_data = _load_json(_shard_path(task_id, "static")) || _default_static();
  if (!static_data.staticMeta) static_data.staticMeta = {};
  if (!static_data.documents) static_data.documents = { techDocs: [], prdDocs: [] };

  const meta_data = _load_json(meta_path);
  if (meta_data && typeof meta_data === "object" && !Array.isArray(meta_data)) {
    const meta_inner = meta_data.meta || {};
    if (meta_inner && typeof meta_inner === "object" && !Array.isArray(meta_inner)) {
      const movable: Record<string, any> = {};
      for (const k of Object.keys(meta_inner)) {
        if (_STATIC_META_KEYS.has(k)) movable[k] = meta_inner[k];
      }
      if (Object.keys(movable).length) {
        for (const [k, v] of Object.entries(movable)) {
          if (k === "extractedRules") {
            if (!_truthy(static_data.extractedRules)) static_data.extractedRules = v;
          } else if (!(k in static_data.staticMeta)) {
            static_data.staticMeta[k] = v;
          }
          delete meta_inner[k];
        }
        _save_json(meta_path, meta_data);
        console.error(`[content-store] 🔄 migrated ${Object.keys(movable).sort()} from meta to static.json`);
        did_migrate = true;
      }
    }
  }

  const ctx_path = _shard_path(task_id, "context");
  if (_is_file(ctx_path)) {
    const ctx_data = _load_json(ctx_path);
    if (ctx_data && typeof ctx_data === "object" && !Array.isArray(ctx_data)) {
      const docs = ctx_data.documents || {};
      if (docs && typeof docs === "object" && !Array.isArray(docs)) {
        const cleaned: string[] = [];
        for (const dt of ["techDocs", "prdDocs"]) {
          if (!(dt in docs)) continue;
          const legacy_list = docs[dt];
          delete docs[dt];
          cleaned.push(dt);
          if (_truthy(legacy_list) && !_truthy(static_data.documents[dt])) {
            static_data.documents[dt] = legacy_list;
          }
        }
        if ("extractedRules" in docs) {
          const legacy_er = docs.extractedRules;
          delete docs.extractedRules;
          cleaned.push("extractedRules");
          if (_truthy(legacy_er) && !_truthy(static_data.extractedRules)) {
            static_data.extractedRules = legacy_er;
          }
        }
        if (cleaned.length) {
          _save_json(ctx_path, ctx_data);
          console.error(
            `[content-store] 🔄 cleaned ${[...new Set(cleaned)].sort()} from context.documents (moved to static.json)`,
          );
          did_migrate = true;
        }
      }
    }
  }

  if (did_migrate) {
    _save_json(_shard_path(task_id, "static"), static_data);
  }
  return did_migrate;
}

export class ContentStore {
  task_id: number;
  _dir: string;
  _shards: Record<string, any>;
  _dirty: Set<string>;
  _data_cache: Record<string, any> | null;

  constructor(task_id: number) {
    this.task_id = task_id;
    this._dir = _data_dir(task_id);

    _migrate_from_legacy(task_id);
    _migrate_meta_to_static(task_id);

    this._shards = {};
    this._dirty = new Set();
    this._data_cache = null;
  }

  get path(): string {
    return join(this._dir, "meta.json");
  }

  get data(): Record<string, any> {
    if (this._data_cache === null) {
      this._data_cache = {};
      Object.assign(this._data_cache, this._load_shard("meta"));
      Object.assign(this._data_cache, this._load_shard("static"));
      Object.assign(this._data_cache, this._load_shard("context"));
      Object.assign(this._data_cache, this._load_shard("test_cases"));
      Object.assign(this._data_cache, this._load_shard("plan"));
      Object.assign(this._data_cache, this._load_shard("writebacks"));
      Object.assign(this._data_cache, this._load_shard("findings"));
      const static_shard = this._load_shard("static");
      for (const [k, v] of Object.entries(static_shard.staticMeta || {})) {
        if (!(k in this._data_cache)) this._data_cache[k] = v;
      }
      if (!("extractedRules" in this._data_cache)) {
        this._data_cache.extractedRules = static_shard.extractedRules || [];
      }
      const merged_docs = { ...(this._data_cache.documents || {}) };
      const static_docs = static_shard.documents || {};
      if (!("techDocs" in merged_docs)) merged_docs.techDocs = static_docs.techDocs || [];
      if (!("prdDocs" in merged_docs)) merged_docs.prdDocs = static_docs.prdDocs || [];
      this._data_cache.documents = merged_docs;
    }
    return this._data_cache;
  }

  _load_shard(shard: string): Record<string, any> {
    if (!(shard in this._shards)) {
      const path = _shard_path(this.task_id, shard);
      const defaults: Record<string, () => Record<string, any>> = {
        meta: () => _default_meta(this.task_id),
        static: _default_static,
        context: _default_context,
        test_cases: _default_test_cases,
        plan: _default_plan,
        writebacks: _default_writebacks,
        findings: _default_findings,
      };
      const loaded = _load_json(path);
      if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
        this._shards[shard] = _deep_merge(defaults[shard](), loaded);
      } else {
        this._shards[shard] = defaults[shard]();
      }
    }
    return this._shards[shard];
  }

  _mark_dirty(shard: string): void {
    this._dirty.add(shard);
    this._data_cache = null;
  }

  save(): boolean {
    if (!this._dirty.size) return true;

    if (this._dirty.has("meta")) {
      const meta = this._load_shard("meta");
      meta.meta.lastUpdatedAt = _now();
    }

    let all_ok = true;
    for (const shard of [...this._dirty]) {
      const path = _shard_path(this.task_id, shard);
      if (_save_json(path, this._shards[shard])) {
        this._dirty.delete(shard);
      } else {
        all_ok = false;
      }
    }
    return all_ok;
  }

  save_shard(shard: string): boolean {
    if (!(shard in this._shards)) return true;
    const path = _shard_path(this.task_id, shard);
    if (shard === "meta") {
      this._shards[shard].meta.lastUpdatedAt = _now();
    }
    const ok = _save_json(path, this._shards[shard]);
    if (ok) this._dirty.delete(shard);
    return ok;
  }

  set_meta(key: string, value: any): void {
    if (_STATIC_META_KEYS.has(key)) {
      const staticShard = this._load_shard("static");
      if (key === "extractedRules") {
        staticShard.extractedRules = value;
      } else {
        if (!staticShard.staticMeta) staticShard.staticMeta = {};
        staticShard.staticMeta[key] = value;
      }
      this._mark_dirty("static");
      return;
    }
    const meta = this._load_shard("meta");
    meta.meta[key] = value;
    this._mark_dirty("meta");
  }

  get_meta_field(key: string, defaultValue: any = null): any {
    if (_STATIC_META_KEYS.has(key)) {
      const staticShard = this._load_shard("static");
      if (key === "extractedRules") {
        const val = staticShard.extractedRules;
        if (_truthy(val)) return val;
      } else {
        const sm = staticShard.staticMeta || {};
        if (key in sm) return sm[key];
      }
      return this._load_shard("meta").meta[key] !== undefined ? this._load_shard("meta").meta[key] : defaultValue;
    }
    const v = this._load_shard("meta").meta[key];
    return v !== undefined ? v : defaultValue;
  }

  append_error(error: string): void {
    const meta = this._load_shard("meta");
    meta.meta.errorLog.push({ time: _now(), msg: error });
    this._mark_dirty("meta");
  }

  add_or_update_service(service: Record<string, any>): void {
    const git_url = service.gitUrl;
    if (!git_url) {
      console.error("[content-store] ⚠️ add_or_update_service missing gitUrl, ignored");
      return;
    }
    _validate_service(service);
    const meta = this._load_shard("meta");
    for (const existing of meta.services) {
      if (existing.gitUrl === git_url) {
        for (const [key, value] of Object.entries(service)) {
          if (value != null) existing[key] = value;
        }
        this._mark_dirty("meta");
        return;
      }
    }
    const defaults: Record<string, any> = {
      serviceKey: null,
      branch: null,
      commitId: null,
      localDir: null,
      batchIds: [],
      modulePrefix: null,
      // No language default: clone-and-diff resolves and stamps it
      // (explicit flag > plan declaration > changed-file detection).
      language: null,
      languageSource: null,
      verified: false,
    };
    Object.assign(defaults, service);
    meta.services.push(defaults);
    this._mark_dirty("meta");
  }

  get_service_by_batch_id(batch_id: number): Record<string, any> | null {
    const meta = this._load_shard("meta");
    for (const svc of meta.services) {
      if ((svc.batchIds || []).includes(batch_id)) return svc;
    }
    return null;
  }

  get_service_by_git_url(git_url: string): Record<string, any> | null {
    const meta = this._load_shard("meta");
    for (const svc of meta.services) {
      if (svc.gitUrl === git_url) return svc;
    }
    return null;
  }

  set_diff_files(files: string[]): void {
    const meta = this._load_shard("meta");
    meta.diff.files = files;
    this._mark_dirty("meta");
  }

  /** Per-file changed line ranges from `git diff --unified=0` (for line-level inDiff). */
  set_diff_hunks(hunks: Record<string, Array<[number, number]>>): void {
    const meta = this._load_shard("meta");
    if (!meta.diff) meta.diff = { files: [], changedMethods: {}, diffSummary: "", totalChangeLines: 0 };
    meta.diff.hunks = hunks;
    this._mark_dirty("meta");
  }

  get_diff_hunks(): Record<string, Array<[number, number]>> {
    const meta = this._load_shard("meta");
    return (meta.diff || {}).hunks || {};
  }

  add_changed_methods(class_name: string, methods: any[]): void {
    const meta = this._load_shard("meta");
    const list = Array.isArray(methods) ? methods : [];
    meta.diff.changedMethods[class_name] = list.map((m) => {
      const norm = normalize_changed_method(m);
      return norm.bodyLineCount == null && !norm.params && !norm.signature && !norm.expressionBody && !norm.filePath
        ? norm.methodName
        : norm;
    });
    this._mark_dirty("meta");
  }

  get_changed_method_lookup(): Map<string, Record<string, any>> {
    const meta = this._load_shard("meta");
    const lookup = new Map<string, Record<string, any>>();
    for (const [class_name, raw] of Object.entries(meta.diff?.changedMethods || {}) as [string, any][]) {
      const methods = Array.isArray(raw) ? raw : [raw];
      for (const entry of methods) {
        const norm = normalize_changed_method(entry);
        if (!norm.methodName) continue;
        const simple = class_name.includes("/") ? class_name.split("/").pop()! : class_name.split(".").pop()!;
        lookup.set(`${class_name}#${norm.methodName}`, norm);
        if (simple) lookup.set(`${simple}#${norm.methodName}`, norm);
      }
    }
    return lookup;
  }

  set_total_change_lines(total_lines: number): void {
    const meta = this._load_shard("meta");
    meta.diff.totalChangeLines = total_lines;
    this._mark_dirty("meta");
  }

  get_total_change_lines(): number {
    const meta = this._load_shard("meta");
    return (meta.diff || {}).totalChangeLines || 0;
  }

  add_document(doc_type: string, doc: Record<string, any>): void {
    if (doc_type !== "techDocs" && doc_type !== "prdDocs") return;
    _validate_document(doc);
    const staticShard = this._load_shard("static");
    if (!staticShard.documents[doc_type]) staticShard.documents[doc_type] = [];
    staticShard.documents[doc_type].push(doc);
    this._mark_dirty("static");
  }

  get_documents(doc_type: string | null = null): any[] {
    const staticShard = this._load_shard("static");
    const docs = staticShard.documents || {};
    if (doc_type) return docs[doc_type] || [];
    return (docs.techDocs || []).concat(docs.prdDocs || []);
  }

  set_document_summary_path(path: string): void {
    const ctx = this._load_shard("context");
    ctx.documents.summaryPath = path;
    this._mark_dirty("context");
  }

  set_extracted_rules(rules: any[]): void {
    const staticShard = this._load_shard("static");
    staticShard.extractedRules = rules;
    this._mark_dirty("static");
  }

  get_extracted_rules(): any[] {
    const staticShard = this._load_shard("static");
    return staticShard.extractedRules || [];
  }

  add_test_case(caseObj: Record<string, any>): void {
    _validate_test_case(caseObj);
    const shard = this._load_shard("test_cases");
    shard.testCases.push(caseObj);
    this._mark_dirty("test_cases");
  }

  upsert_test_case(caseObj: Record<string, any>): void {
    _validate_test_case(caseObj);
    const shard = this._load_shard("test_cases");
    const case_id = caseObj.id;
    if (case_id != null) {
      for (let i = 0; i < shard.testCases.length; i++) {
        if (shard.testCases[i].id === case_id) {
          shard.testCases[i] = _deep_merge(shard.testCases[i], caseObj);
          this._mark_dirty("test_cases");
          return;
        }
      }
    }
    shard.testCases.push(caseObj);
    this._mark_dirty("test_cases");
  }

  set_test_case_related_methods(case_id: number, methods: string[]): void {
    const shard = this._load_shard("test_cases");
    for (const c of shard.testCases) {
      if (c.id === case_id) {
        c.relatedMethods = methods;
        c.relatedClassNames = [...new Set(methods.filter((m) => m.includes("#")).map((m) => m.split("#")[0]))];
        this._mark_dirty("test_cases");
        return;
      }
    }
  }

  get_test_cases(): any[] {
    const shard = this._load_shard("test_cases");
    return shard.testCases || [];
  }

  add_context_read(record: Record<string, any>): void {
    _validate_context_read(record);
    if (!("readAt" in record)) record.readAt = _now();
    const wb = this._load_shard("writebacks");
    const key = `${record.className}\0${record.filePath}`;
    for (const existing of wb.contextReads) {
      if (`${existing.className}\0${existing.filePath}` === key) return;
    }
    wb.contextReads.push(record);
    this._mark_dirty("writebacks");
  }

  get_context_reads_for_class(class_name: string): any[] {
    const wb = this._load_shard("writebacks");
    return wb.contextReads.filter((r: any) => r.className === class_name);
  }

  get_context_reads_count_for_class(class_name: string): number {
    const wb = this._load_shard("writebacks");
    const file_paths = new Set(
      wb.contextReads.filter((r: any) => r.className === class_name).map((r: any) => r.filePath),
    );
    return file_paths.size;
  }

  add_finding(record: Record<string, any>): void {
    _validate_finding(record);
    if (!("recordedAt" in record)) record.recordedAt = _now();
    const findings = this._load_shard("findings");
    findings.summaryFindings.push(record);
    this._mark_dirty("findings");
  }

  get_findings(phase: string | null = null, category: string | null = null): any[] {
    const findings = this._load_shard("findings");
    let results = findings.summaryFindings || [];
    if (phase) results = results.filter((r: any) => r.phase === phase);
    if (category) results = results.filter((r: any) => r.category === category);
    return results;
  }

  get_findings_summary_text(): string {
    const findings = this._load_shard("findings");
    const items = findings.summaryFindings || [];
    if (!items.length) return "(no recorded findings)";
    const lines: string[] = [];
    for (const [cat, label] of [
      ["change", "Requirement change points"],
      ["risk", "Identified risks"],
      ["gap", "Missing prerequisite info"],
      ["insight", "Other observations"],
      ["cross-view", "Cross-view checks"],
    ] as [string, string][]) {
      const cat_items = items.filter((f: any) => f.category === cat);
      if (cat_items.length) {
        lines.push(`[${label}]`);
        for (const item of cat_items) {
          const src = item.source ? ` (source: ${item.source})` : "";
          lines.push(`  · ${item.text}${src}`);
        }
      }
    }
    return lines.join("\n");
  }

  add_jar_dependency(dep: Record<string, any>): void {
    const ctx = this._load_shard("context");
    ctx.serviceDependencies.jarDependencies.push(dep);
    this._mark_dirty("context");
  }

  add_thrift_dependency(dep: Record<string, any>): void {
    const ctx = this._load_shard("context");
    ctx.serviceDependencies.thriftDependencies.push(dep);
    this._mark_dirty("context");
  }

  add_cross_repo_class(class_name: string, info: Record<string, any>): void {
    _validate_cross_repo(info);
    const ctx = this._load_shard("context");
    ctx.serviceDependencies.crossRepoClasses[class_name] = info;
    this._mark_dirty("context");
  }

  set_service_dependencies_notes(notes: string): void {
    const ctx = this._load_shard("context");
    ctx.serviceDependencies.notes = notes;
    this._mark_dirty("context");
  }

  add_detection_plan_item(item: Record<string, any>): void {
    _validate_plan_item(item);
    const plan = this._load_shard("plan");
    const key = `${item.className}\0${item.methodName}\0${item.strategyCode}`;
    for (const existing of plan.detectionPlan) {
      if (`${existing.className}\0${existing.methodName}\0${existing.strategyCode}` === key) {
        Object.assign(existing, item);
        this._mark_dirty("plan");
        return;
      }
    }
    const defaults: Record<string, any> = {
      processId: null,
      batchId: null,
      filePath: null,
      docRelevance: "none",
      caseRelevance: "none",
      source: "pending",
      astScanResult: { hasFinding: false, findings: [], hitRuleIds: [], exclusionRuleIds: [] },
      status: "pending",
      analyzeStartedAt: null,
      analyzeFinishedAt: null,
    };
    Object.assign(defaults, item);
    plan.detectionPlan.push(defaults);
    this._mark_dirty("plan");
  }

  add_detection_plan_items(items: Record<string, any>[], _save = true): void {
    for (const item of items) this.add_detection_plan_item(item);
    if (_save) this.save_shard("plan");
  }

  update_plan_status(class_name: string, method_name: string, strategy_code: number, status: string): void {
    const plan = this._load_shard("plan");
    for (const item of plan.detectionPlan) {
      if (item.className === class_name && item.methodName === method_name && item.strategyCode === strategy_code) {
        item.status = status;
        if (status === "analyzed") {
          item.analyzeStartedAt = item.analyzeStartedAt || _now();
          item.analyzeFinishedAt = _now();
        }
        this._mark_dirty("plan");
        return;
      }
    }
  }

  get_plan_item(class_name: string, method_name: string, strategy_code: number): Record<string, any> | null {
    const plan = this._load_shard("plan");
    for (const item of plan.detectionPlan) {
      if (item.className === class_name && item.methodName === method_name && item.strategyCode === strategy_code) {
        return item;
      }
    }
    return null;
  }

  set_plan_ast_result(class_name: string, method_name: string, result: Record<string, any>): void {
    this.update_plan_status(class_name, method_name, 8, "analyzed");
    const plan = this._load_shard("plan");
    for (const item of plan.detectionPlan) {
      if (item.className === class_name && item.methodName === method_name && item.strategyCode === 8) {
        item.astScanResult = result;
        this._mark_dirty("plan");
        return;
      }
    }
  }

  set_plan_file_path(class_name: string, method_name: string, strategy_code: number, file_path: string): void {
    const plan = this._load_shard("plan");
    for (const item of plan.detectionPlan) {
      if (item.className === class_name && item.methodName === method_name && item.strategyCode === strategy_code) {
        item.filePath = file_path;
        this._mark_dirty("plan");
        return;
      }
    }
  }

  resolve_writeback_context(
    class_name: string,
    method_name: string | null = null,
    strategy_code: number | null = null,
  ): Record<string, any> {
    const plan = this._load_shard("plan").detectionPlan;

    let item: any = null;
    let source = "plan-not-found";
    if (method_name != null && strategy_code != null) {
      for (const it of plan) {
        if (it.className === class_name && it.methodName === method_name && it.strategyCode === strategy_code) {
          item = it;
          source = "exact(className+method+strategy)";
          break;
        }
      }
    }

    if (item == null) {
      const same_class = plan.filter((it: any) => it.className === class_name);
      const with_fp = same_class.filter((it: any) => it.filePath);
      if (with_fp.length) {
        item = with_fp[0];
        source = "fallback(same-className-filePath)";
      } else if (same_class.length) {
        item = same_class[0];
        source = "fallback(same-className-noFilePath)";
      }
    }

    const exact = source.startsWith("exact");
    const process_id = exact && item ? item.processId : null;
    let batch_id = item ? item.batchId : null;
    const resolved_method = exact && item ? item.methodName : method_name;
    const resolved_strategy = exact && item ? item.strategyCode : strategy_code;
    const plan_file_path = item ? item.filePath : null;

    // Diff-sourced plan items carry batchId=null (only platform pending items have one), so
    // resolve the service via parentBatchId, then the only registered service, then the
    // service whose clone actually contains the plan file (multi-service tasks).
    let svc = batch_id != null ? this.get_service_by_batch_id(batch_id) : null;
    if (!svc && item?.parentBatchId != null) svc = this.get_service_by_batch_id(item.parentBatchId);
    if (!svc) {
      const services: any[] = this._load_shard("meta").services || [];
      if (services.length === 1) svc = services[0];
      else if (plan_file_path) {
        svc = services.find((s) => s.localDir && existsSync(join(s.localDir, plan_file_path))) || null;
      }
    }
    if (svc && batch_id == null) batch_id = (svc.batchIds || [])[0] ?? null;
    const git_url = svc ? svc.gitUrl : null;
    const branch = svc ? svc.branch : null;
    const commit_id = svc ? svc.commitId : null;
    const local_dir = svc ? svc.localDir : null;

    // filePath authority, most trustworthy first. A guessed path must never look
    // authoritative: the write-back reconciler overwrites whatever the agent sent
    // with this value, and validation rule 24 then looks for that file on disk.
    let file_path = "";
    let file_path_guessed = false;

    if (plan_file_path) {
      file_path = String(plan_file_path);
      source = source + "→plan-filePath";
    } else {
      const from_changed = this.get_changed_method_file_path(class_name, resolved_method);
      if (from_changed) {
        file_path = from_changed;
        source = source + "→changed-method-filePath";
      } else if (local_dir) {
        const on_disk = this._find_file_for_class(local_dir, class_name);
        if (on_disk) {
          file_path = on_disk;
          source = source + "→clone-lookup";
        }
      }
    }

    if (!file_path) {
      // Per-language guess; unknown language stays path-style with no forced .java (R2/R8).
      const svc_lang = svc?.language || item?.language || null;
      file_path = guess_file_path_for_class(class_name, svc_lang);
      file_path_guessed = true;
      source = source + "→className-as-filePath(guessed)";
    }

    const language = item?.language
      || (!file_path_guessed ? language_from_path(file_path) : null)
      || svc?.language
      || null;
    // Two separate questions that used to share one flag. `isClient` is about browser /
    // client code (frontend gotchas); `usesPathClassName` is about className carrying no
    // package, which is why the real file path is worth recording. Go, Python and C are
    // path-style but are not client code.
    const is_client = is_client_path(file_path, language);
    const uses_path_class_name = has_path_class_name(file_path, language);

    let file_codes_item: Record<string, any> | null = null;
    if (file_path && git_url) {
      file_codes_item = {
        filePath: file_path,
        methodNames: resolved_method ? [resolved_method] : [],
        git: git_url,
        branch,
        commitId: commit_id,
        _filePathSource: source,
      };
    }

    return {
      className: class_name,
      methodName: resolved_method,
      strategyCode: resolved_strategy,
      parentBatchId: batch_id,
      processId: process_id,
      filePath: file_path,
      gitUrl: git_url,
      branch,
      commitId: commit_id,
      localDir: local_dir,
      fileCodesItem: file_codes_item,
      // A guessed path is not an authority: callers must keep whatever the agent
      // sent rather than "correcting" a real path into an invented one.
      resolved: Boolean(file_path && git_url && !file_path_guessed),
      filePathGuessed: file_path_guessed,
      isClient: is_client,
      usesPathClassName: uses_path_class_name,
      language,
      codeFence: code_fence_for_language(language),
      source,
    };
  }

  /** Repo-relative path recorded for a changed method during Phase 1, if any. */
  get_changed_method_file_path(class_name: string, method_name: string | null): string | null {
    const changed = (this._load_shard("meta").diff || {}).changedMethods || {};
    const simple = class_name.includes("/") ? class_name.split("/").pop()! : class_name.split(".").pop()!;
    for (const key of [class_name, simple]) {
      const raw = changed[key];
      if (!raw) continue;
      const methods = (Array.isArray(raw) ? raw : [raw]).map(normalize_changed_method);
      const hit = (method_name && methods.find((m) => m.methodName === method_name)) || methods[0];
      if (hit?.filePath) return String(hit.filePath);
    }
    return null;
  }

  /** Locate the source file a className refers to inside a clone (any language). */
  private _find_file_for_class(local_dir: string, class_name: string): string | null {
    // Path-style names keep dots; only FQCNs rewrite dots→slashes.
    const as_path = class_name.includes("/")
      ? class_name.replace(/\\/g, "/")
      : class_name.replace(/\./g, "/");
    const candidates = [
      ..._ALL_SOURCE_EXTS.map((ext) => `${as_path}${ext}`),
      // JVM class paths are relative to a source root; try the conventional roots.
      ...ALL_PROFILES.filter((p) => p.family === "jvm").flatMap((p) =>
        p.pathPrefixes.flatMap((root) => p.extensions.map((ext) => `${root}${as_path}${ext}`)),
      ),
    ];
    for (const rel of candidates) {
      try {
        if (existsSync(join(local_dir, rel))) return rel;
      } catch {
        // unreadable clone; fall through
      }
    }
    return null;
  }

  record_process_writeback(record: Record<string, any>): WritebackRecordResult {
    _validate_writeback(record);
    const wb = this._load_shard("writebacks");
    for (let i = 0; i < wb.processWritebacks.length; i++) {
      const existing = wb.processWritebacks[i];
      if (!writeback_identity_match(existing, record)) continue;
      if (writeback_should_protect(existing, record)) {
        existing.errorInfo =
          `protected: refused bugStatus=2 overwrite of existing defect bugStatus=${existing.bugStatus}`;
        this._mark_dirty("writebacks");
        return {
          status: "protected",
          className: String(existing.className || record.className),
          methodName: String(existing.methodName || record.methodName),
          existingBugStatus: existing.bugStatus,
          incomingBugStatus: 2,
        };
      }
      wb.processWritebacks[i] = record;
      this._mark_dirty("writebacks");
      this._mark_plan_written(record);
      return {
        status: "updated",
        className: String(record.className),
        methodName: String(record.methodName),
      };
    }
    wb.processWritebacks.push(record);
    this._mark_dirty("writebacks");
    this._mark_plan_written(record);
    return {
      status: "inserted",
      className: String(record.className),
      methodName: String(record.methodName),
    };
  }

  /** A recorded write-back closes the plan item(s) it unambiguously matches. */
  _mark_plan_written(record: Record<string, any>): void {
    const plan = this._load_shard("plan");
    let touched = false;
    for (const item of matching_plan_units(plan.detectionPlan || [], record)) {
      if (item.status === "written") continue;
      item.status = "written";
      item.analyzeFinishedAt = item.analyzeFinishedAt || _now();
      touched = true;
    }
    if (touched) this._mark_dirty("plan");
  }

  /**
   * Plan items that still have no write-back (local ground truth for git-branch tasks,
   * whose plan never reaches the platform). Trivial items count too: `--submit-trivial`
   * or `trivial-method-filter --submit` writes them as bugStatus=2.
   */
  get_plan_gaps(): Array<{ className: string; methodName: string; strategyCode: number; detectTier: string; trivial: boolean }> {
    const plan = this._load_shard("plan").detectionPlan || [];
    const wb = this._load_shard("writebacks").processWritebacks || [];
    const closed = new Set<any>();
    for (const r of wb) {
      for (const item of matching_plan_units(plan, r)) closed.add(item);
    }
    const gaps: Array<{ className: string; methodName: string; strategyCode: number; detectTier: string; trivial: boolean }> = [];
    for (const item of plan) {
      if (item.status === "written" || closed.has(item)) continue;
      gaps.push({
        className: String(item.className || ""),
        methodName: String(item.methodName || ""),
        strategyCode: Number(item.strategyCode ?? 11),
        detectTier: String(item.detectTier || "T3"),
        trivial: Boolean(item.trivial),
      });
    }
    return gaps;
  }

  set_process_writeback_error(class_name: string, method_name: string, strategy_code: number, error: string): void {
    const wb = this._load_shard("writebacks");
    for (const r of wb.processWritebacks) {
      if (r.className === class_name && r.methodName === method_name && r.strategyCode === strategy_code) {
        r.errorInfo = error;
        this._mark_dirty("writebacks");
        return;
      }
    }
  }

  /** Apply a user verdict (3/4/5/8) from mark-bug to the local rank of the same method. */
  apply_rank_verdict(platform_rank: Record<string, any>, bug_status: number, extra?: { userFeedback?: string; operator?: string }): boolean {
    const cn = String(platform_rank?.className || "");
    const mn = String(platform_rank?.methodName || "");
    if (!cn || !mn) return false;
    const wb = this._load_shard("writebacks");
    const simple = cn.split(/[/.]/).pop();
    let target = (wb.ranks || []).find((r: any) => r.className === cn && r.methodName === mn)
      || (wb.ranks || []).find((r: any) => String(r.className || "").split(/[/.]/).pop() === simple && r.methodName === mn);
    if (!target) {
      target = { className: cn, methodName: mn, writeMethod: "mark-bug" };
      wb.ranks.push(target);
    }
    target.bugStatus = bug_status;
    if (platform_rank.rankId != null || platform_rank.id != null) target.rankId = platform_rank.rankId ?? platform_rank.id;
    if (platform_rank.parentBatchId != null) target.parentBatchId = platform_rank.parentBatchId;
    if (extra?.userFeedback) target.userFeedback = extra.userFeedback;
    if (extra?.operator) target.operator = extra.operator;
    target.writtenAt = _now();
    _validate_rank(target);
    this._mark_dirty("writebacks");
    return true;
  }

  record_rank(rank: Record<string, any>): void {
    _validate_rank(rank);
    const wb = this._load_shard("writebacks");
    const key_fields = ["className", "methodName"];
    const key = key_fields.map((k) => rank[k]).join("\0");
    for (let i = 0; i < wb.ranks.length; i++) {
      if (key_fields.map((k) => wb.ranks[i][k]).join("\0") === key) {
        wb.ranks[i] = rank;
        this._mark_dirty("writebacks");
        return;
      }
    }
    wb.ranks.push(rank);
    this._mark_dirty("writebacks");
  }

  get_summary(): Record<string, any> {
    const meta = this._load_shard("meta");
    const plan = this._load_shard("plan");
    const wb = this._load_shard("writebacks");
    const staticShard = this._load_shard("static");
    const shard = this._load_shard("test_cases");

    const svc_count = meta.services.length;
    const plan_total = plan.detectionPlan.length;
    const written = wb.processWritebacks.length;
    const has_bug = wb.processWritebacks.filter((p: any) => [6, 7].includes(p.bugStatus)).length;
    return {
      taskId: this.task_id,
      services: svc_count,
      detectionPlanTotal: plan_total,
      processWritten: written,
      processHasBug: has_bug,
      rankCount: wb.ranks.length,
      docCount: (staticShard.documents.techDocs || []).length + (staticShard.documents.prdDocs || []).length,
      caseCount: shard.testCases.length,
      dataDir: this._dir,
    };
  }

  load_meta_only(): Record<string, any> {
    return this._load_shard("meta");
  }

  load_context_only(): Record<string, any> {
    return this._load_shard("context");
  }

  load_plan_only(): Record<string, any> {
    return this._load_shard("plan");
  }

  load_writebacks_only(): Record<string, any> {
    return this._load_shard("writebacks");
  }

  load_findings_only(): Record<string, any> {
    return this._load_shard("findings");
  }

  load_static_only(): Record<string, any> {
    return this._load_shard("static");
  }

  load_test_cases_only(): Record<string, any> {
    return this._load_shard("test_cases");
  }
}

export function get_content_summary(task_id: number): Record<string, any> {
  const store = new ContentStore(task_id);
  return store.get_summary();
}

export function get_detection_plan(task_id: number): any[] {
  const store = new ContentStore(task_id);
  const plan = store.load_plan_only();
  return plan.detectionPlan || [];
}

export function get_pending_plan_items(task_id: number): any[] {
  const store = new ContentStore(task_id);
  const plan = store.load_plan_only();
  return (plan.detectionPlan || []).filter((item: any) => item.status !== "written");
}

export function get_writeback_errors(task_id: number): any[] {
  const store = new ContentStore(task_id);
  const wb = store.load_writebacks_only();
  return (wb.processWritebacks || []).filter((r: any) => r.errorInfo);
}

const _this_file = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === _this_file) {
  function _usage(): never {
    console.log(
      "Usage: node store.ts <task_id> [summary|plan|pending|errors|meta|context|writebacks|findings]",
    );
    process.exit(1);
  }

  if (process.argv.length < 3) _usage();

  let tid: number;
  try {
    tid = Number.parseInt(process.argv[2], 10);
    if (!Number.isInteger(tid)) _usage();
  } catch {
    _usage();
  }

  const action = process.argv[3] || "summary";

  if (action === "summary") {
    console.log(JSON.stringify(get_content_summary(tid!), null, 2));
  } else if (action === "plan") {
    console.log(JSON.stringify(get_detection_plan(tid!), null, 2));
  } else if (action === "pending") {
    console.log(JSON.stringify(get_pending_plan_items(tid!), null, 2));
  } else if (action === "errors") {
    console.log(JSON.stringify(get_writeback_errors(tid!), null, 2));
  } else if (action === "meta") {
    const store = new ContentStore(tid!);
    console.log(JSON.stringify(store.load_meta_only(), null, 2));
  } else if (action === "context") {
    const store = new ContentStore(tid!);
    console.log(JSON.stringify(store.load_context_only(), null, 2));
  } else if (action === "writebacks") {
    const store = new ContentStore(tid!);
    console.log(JSON.stringify(store.load_writebacks_only(), null, 2));
  } else if (action === "findings") {
    const store = new ContentStore(tid!);
    console.log(JSON.stringify(store.load_findings_only(), null, 2));
  } else {
    _usage();
  }
}
