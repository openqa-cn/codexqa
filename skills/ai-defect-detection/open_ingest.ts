/**
 * Assemble plan / case / doc inputs when enterprise files are missing.
 *
 * Priority: plan provider (enterprise/HTTP) → content store → CLI / conversation
 * JSON. Missing provider data is not fatal if the user already supplied materials.
 */

import {
  ContentStore,
  _DOC_ALLOWED_KEYS,
  _SERVICE_ALLOWED_KEYS,
  _TEST_CASE_ALLOWED_KEYS,
} from "./open_store.ts";
import { get_plan, get_traces } from "./providers/registry.ts";

function get_plan_info(plan_id: number, plan_type: number): Record<string, any> {
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
  return result.data || {};
}

function get_delivery_defects(
  plan_id: number,
  plan_type: number,
  page_no = 1,
  page_size = 100,
): Record<string, any> {
  return get_plan().list_submitted_defects(plan_id, plan_type, page_no, page_size);
}

function get_exception_traces(
  plan_id: number | null = null,
  plan_type = 2,
  service_key: string | null = null,
): Record<string, any> {
  return get_traces().list_traces(plan_id || 0, plan_type, service_key);
}

function _py_bool(v: any): boolean {
  if (v == null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set || v instanceof Map) return v.size > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function _py_or(...vals: any[]): any {
  for (const v of vals) {
    if (_py_bool(v)) return v;
  }
  return vals.length ? vals[vals.length - 1] : undefined;
}

export function parse_json_list(raw: string | null | undefined): any[] {
  if (raw === undefined || raw === null || raw === "") return [];
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value;
    return [value];
  } catch {
    return [raw];
  }
}

export function parse_json_obj(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function empty_plan(plan_id: number | null, plan_type = 2): Record<string, any> {
  return {
    planId: plan_id,
    planType: plan_type,
    planName: "",
    services: [],
    testCaseIds: [],
    issueList: [],
    requirementDocs: [],
    technicalDocs: [],
  };
}

function _has_items(...groups: any[]): boolean {
  return groups.some((g) => _py_bool(g));
}

function _normalize_service(item: any): Record<string, any> | null {
  if (typeof item === "string" && item.trim()) {
    return { git: item.trim(), gitUrl: item.trim(), branch: "", language: "java" };
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const git = item.git || item.gitUrl || "";
  const branch = item.branch || item.developBranch || "";
  if (!git && !branch && !item.serviceKey) return null;
  const out = { ...item };
  if (git) {
    if (out.git === undefined) out.git = git;
    if (out.gitUrl === undefined) out.gitUrl = git;
  }
  if (branch) {
    if (out.branch === undefined) out.branch = branch;
    if (out.developBranch === undefined) out.developBranch = branch;
  }
  if (out.language === undefined) out.language = item.language || "java";
  return out;
}

function _doc_ref(item: any): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    return String(item.contentId || item.title || item.url || item.filePath || "");
  }
  return "";
}

function _store_bundle(task_id: any): Record<string, any> {
  if (!_py_bool(task_id)) return {};
  const store = new ContentStore(Number(task_id));
  const meta_shard = store.load_meta_only();
  const meta = meta_shard.meta || {};
  const cases = store.get_test_cases();
  const prd = store.get_documents("prdDocs") || [];
  const tech = store.get_documents("techDocs") || [];
  const static_ = store.load_static_only();
  const static_meta = static_.staticMeta || {};
  const history = _py_or(static_meta.historyDefects, meta.historyDefects, []);
  const traces = _py_or(meta.traces, static_meta.traces, []);
  return {
    planName: meta.planName || "",
    planId: meta.testPlanId,
    services: [...(meta_shard.services || [])],
    testCaseIds: [
      ...(_py_or(
        meta.testCaseIds,
        cases.filter((c: any) => c.id).map((c: any) => c.id),
      ) || []),
    ],
    issueList: [...(meta.issueList || [])],
    requirementDocs: prd,
    technicalDocs: tech,
    testCases: cases,
    historyDefects: Array.isArray(history) ? history : [],
    traces: Array.isArray(traces) ? traces : [],
  };
}

function _cli_bundle(args: any): Record<string, any> {
  const materials = parse_json_obj(args?.user_materials_json);
  const services: Record<string, any>[] = [];
  for (const item of [
    ...parse_json_list(args?.services_json),
    ...(materials.services || []),
  ]) {
    const norm = _normalize_service(item);
    if (norm) services.push(norm);
  }
  const git = args?.git;
  const branch = args?.branch;
  if (git) {
    services.push(
      _normalize_service({
        git,
        branch: branch || "",
        serviceKey: args?.service_key || "",
      })!,
    );
  }

  const req = [...parse_json_list(args?.requirement_docs), ...(materials.requirementDocs || [])];
  const tech = [...parse_json_list(args?.technical_docs), ...(materials.technicalDocs || [])];
  let case_ids = [...parse_json_list(args?.test_case_ids), ...(materials.testCaseIds || [])];
  const cases = [...(materials.testCases || [])];
  if (cases.length && !case_ids.length) {
    case_ids = cases.filter((c) => c && typeof c === "object" && c.id).map((c) => c.id);
  }
  const issues = [...parse_json_list(args?.issue_list), ...(materials.issueList || [])];
  const plan_name = args?.plan_name || materials.planName || "";
  return {
    planName: plan_name,
    services: services.filter((s) => s),
    testCaseIds: case_ids,
    issueList: issues,
    requirementDocs: req,
    technicalDocs: tech,
    testCases: cases,
    historyDefects: [...(materials.historyDefects || [])],
    traces: [...(materials.traces || [])],
  };
}

function _merge_plan(base: Record<string, any>, extra: Record<string, any>): Record<string, any> {
  const out = { ...base };
  if (extra.planName && !out.planName) out.planName = extra.planName;
  if (extra.planId && !out.planId) out.planId = extra.planId;
  for (const key of ["services", "testCaseIds", "issueList", "requirementDocs", "technicalDocs"]) {
    const current = [...(out[key] || [])];
    const incoming = [...(extra[key] || [])];
    if (key === "services") {
      const seen = new Set(
        current
          .filter((s) => s && typeof s === "object")
          .map((s) => `${s.git || s.gitUrl}\0${s.branch || s.developBranch}`),
      );
      for (const item of incoming) {
        const norm = _normalize_service(item);
        if (!norm) continue;
        const pair = `${norm.git || norm.gitUrl}\0${norm.branch || norm.developBranch}`;
        if (!seen.has(pair)) {
          current.push(norm);
          seen.add(pair);
        }
      }
      out[key] = current;
    } else if (key === "requirementDocs" || key === "technicalDocs") {
      const seen = new Set(current.map((x) => _doc_ref(x)));
      for (const item of incoming) {
        const ref = _doc_ref(item);
        if (ref && !seen.has(ref)) {
          current.push(item);
          seen.add(ref);
        } else if (!ref && item) {
          current.push(item);
        }
      }
      out[key] = current;
    } else {
      const seen = new Set(current.map((x) => String(x)));
      for (const item of incoming) {
        if (item !== undefined && item !== null && !seen.has(String(item))) {
          current.push(item);
          seen.add(String(item));
        }
      }
      out[key] = current;
    }
  }
  return out;
}

export function resolve_plan_info(
  plan_id: number | null,
  plan_type = 2,
  args: any = null,
): Record<string, any> {
  const sources: string[] = [];
  let data = empty_plan(plan_id, plan_type);
  let provider: Record<string, any> = {};
  if (plan_id) {
    try {
      provider = get_plan_info(Number(plan_id), Number(plan_type)) || {};
    } catch {
      provider = {};
    }
  }
  if (
    _py_bool(provider) &&
    (provider.planName ||
      _has_items(provider.services, provider.testCaseIds, provider.requirementDocs, provider.technicalDocs))
  ) {
    data = _merge_plan(data, provider);
    sources.push("provider");
  }

  const store = _store_bundle(args ? args.task_id : null);
  if (
    _has_items(
      store.services,
      store.testCaseIds,
      store.requirementDocs,
      store.technicalDocs,
      store.testCases,
    )
  ) {
    data = _merge_plan(data, store);
    sources.push("content_store");
  }

  const cli = args ? _cli_bundle(args) : {};
  if (
    _has_items(
      cli.services,
      cli.testCaseIds,
      cli.requirementDocs,
      cli.technicalDocs,
      cli.testCases,
      cli.planName,
    )
  ) {
    data = _merge_plan(data, cli);
    sources.push("user_input");
  }

  if (!data.planName) {
    data.planName = plan_id ? `ad-hoc plan ${plan_id}` : "ad-hoc plan";
  }

  const inventory = classify_materials(data, store, cli, sources.includes("provider"));
  const next_actions = inventory.askUser.map((item: any) => item.agentHint);
  if (!inventory.blocking.length && !inventory.recommended.length) {
    next_actions.push("Continue Phase 1: submit-plan or submit-git, then clone-and-diff.");
  }

  return {
    data,
    source: sources.length ? sources.join("+") : "empty",
    degraded: !sources.includes("provider"),
    hasUserMaterials: sources.includes("content_store") || sources.includes("user_input"),
    missing: [...inventory.blocking, ...inventory.recommended],
    blocking: inventory.blocking,
    recommended: inventory.recommended,
    optionalMissing: inventory.optionalMissing,
    askUser: inventory.askUser,
    nextActions: next_actions,
    testCases: [...(store.testCases || []), ...(cli.testCases || [])],
    historyDefects: [...(store.historyDefects || []), ...(cli.historyDefects || [])],
    traces: [...(store.traces || []), ...(cli.traces || [])],
  };
}

const _MATERIAL_PROMPTS: Record<string, Record<string, string>> = {
  services: {
    level: "blocking",
    label: "Git repo + branch",
    prompt:
      "Still missing the detection code entry: please provide a Git URL (SSH or HTTPS) and branch name. " +
      "Without a repo we cannot clone or diff, so detection cannot start. " +
      "For multiple repos, list git + branch for each.",
    agentHint: "Ask the user for git+branch (or --services-json). Do not start clone until this is present.",
  },
  requirementDocs: {
    level: "recommended",
    label: "Requirements / PRD",
    prompt:
      "No requirements or PRD yet. If you have them, paste the text, a Wiki/doc link, or the file name. " +
      "We can continue without them, but business rules will be inferred from code and cases only, increasing misses/false positives. " +
      "If you are sure there are none, reply \"no requirement docs, skip\".",
    agentHint: "Ask once for PRD/requirement text or URL; if user skips, continue with HAS_DOCS=false.",
  },
  technicalDocs: {
    level: "recommended",
    label: "Tech design / API docs",
    prompt:
      "No tech design or API docs yet. If you have them, paste the design notes, API docs, or in-repo docs path. " +
      "We can continue without them; after clone we will scan README/docs in the repo. " +
      "If you are sure there are none, reply \"no tech design, skip\".",
    agentHint: "Ask once for tech/API docs; after clone also run scan-repo-docs.",
  },
  testCases: {
    level: "recommended",
    label: "Test cases",
    prompt:
      "No test cases yet. If you have them, paste cases (precondition/steps/expected) or case IDs. " +
      "If none, mark HAS_CASES=false and continue; this is not blocking. " +
      "If you are sure there are none, reply \"no test cases, skip\".",
    agentHint: "If the user pasted cases, add-test-case; otherwise HAS_CASES=false and continue.",
  },
  historyDefects: {
    level: "optional",
    label: "Historical defects / filed issues",
    prompt:
      "No historically confirmed defects or issues already filed for this plan. If you have them, provide a defect list, links, or repo URL for lookup. " +
      "If none, skip cross-validation; this is not blocking.",
    agentHint: "Optional. get-confirmed-defect-history / get-delivery-defects; empty is fine.",
  },
  traces: {
    level: "optional",
    label: "Exception traces",
    prompt:
      "No exception-traffic traces. If you have them, provide a plan ID or trace file. If none, skip; this is not blocking.",
    agentHint: "Optional. get-exception-traces; empty is fine.",
  },
  testPlan: {
    level: "optional",
    label: "Test / delivery plan",
    prompt:
      "Detection can run from the Git repo alone without a test or delivery plan. " +
      "If you have a plan ID / link, provide it so we can pull services, cases, and filed issues.",
    agentHint: "Plan id is optional when git+branch is already known.",
  },
};

export function classify_materials(
  data: Record<string, any>,
  store: Record<string, any> | null = null,
  cli: Record<string, any> | null = null,
  has_provider_plan = false,
): Record<string, any> {
  store = store || {};
  cli = cli || {};
  const has_code = _py_bool(data.services);
  const has_req = _py_bool(data.requirementDocs);
  const has_tech = _py_bool(data.technicalDocs);
  const has_cases = _py_bool(_py_or(data.testCaseIds, store.testCases, cli.testCases));
  const has_history = _py_bool(_py_or(store.historyDefects, cli.historyDefects));
  const has_traces = _py_bool(_py_or(store.traces, cli.traces));
  const has_plan = Boolean(has_provider_plan);

  const present: Record<string, boolean> = {
    services: has_code,
    requirementDocs: has_req,
    technicalDocs: has_tech,
    testCases: has_cases,
    historyDefects: has_history,
    traces: has_traces,
    testPlan: has_plan,
  };
  const blocking: string[] = [];
  const recommended: string[] = [];
  const optional_missing: string[] = [];
  const ask_user: Record<string, any>[] = [];
  for (const [key, spec] of Object.entries(_MATERIAL_PROMPTS)) {
    if (present[key]) continue;
    if (spec.level === "blocking") {
      blocking.push(key);
    } else if (spec.level === "recommended") {
      recommended.push(key);
    } else {
      optional_missing.push(key);
      continue;
    }
    ask_user.push({
      item: key,
      level: spec.level,
      label: spec.label,
      prompt: spec.prompt,
      agentHint: spec.agentHint,
    });
  }
  return {
    blocking,
    recommended,
    optionalMissing: optional_missing,
    askUser: ask_user,
  };
}

function _pick(src: Record<string, any>, allowed: Set<string> | Iterable<string>): Record<string, any> {
  const allow = allowed instanceof Set ? allowed : new Set(allowed);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(src)) {
    if (allow.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

export function ingest_resolved_materials(task_id: number, resolved: Record<string, any>): Record<string, any> {
  const store = new ContentStore(Number(task_id));
  const data = resolved.data || {};
  if (data.planName) store.set_meta("planName", data.planName);
  if (data.planId) store.set_meta("testPlanId", data.planId);
  if (data.testCaseIds) store.set_meta("testCaseIds", data.testCaseIds);
  if (data.issueList) store.set_meta("issueList", data.issueList);
  for (const svc of data.services || []) {
    if (!svc || typeof svc !== "object" || Array.isArray(svc)) continue;
    const payload = { ...svc };
    if (payload.git && !payload.gitUrl) payload.gitUrl = payload.git;
    if (payload.developBranch && !payload.branch) payload.branch = payload.developBranch;
    try {
      store.add_or_update_service(_pick(payload, _SERVICE_ALLOWED_KEYS));
    } catch {
      continue;
    }
  }
  let written_cases = 0;
  for (const case_ of resolved.testCases || []) {
    if (!case_ || typeof case_ !== "object" || Array.isArray(case_)) continue;
    try {
      store.upsert_test_case(_pick(case_, _TEST_CASE_ALLOWED_KEYS));
      written_cases += 1;
    } catch {
      continue;
    }
  }
  let written_docs = 0;
  for (const [doc_type, items] of [
    ["prdDocs", data.requirementDocs],
    ["techDocs", data.technicalDocs],
  ] as const) {
    for (const item of items || []) {
      const doc =
        item && typeof item === "object" && !Array.isArray(item)
          ? { ...item }
          : {
              contentId: String(item),
              title: String(item),
              url: String(item).startsWith("http") ? String(item) : "",
              fetchStatus: "success",
            };
      if (doc.fetchStatus === undefined) doc.fetchStatus = "success";
      if (doc.fetchMethod === undefined) doc.fetchMethod = "user_input";
      if ("content" in doc && !("businessRules" in doc) && typeof doc.content === "string") {
        doc.businessRules = doc.content.slice(0, 2000);
      }
      try {
        store.add_document(doc_type, _pick(doc, _DOC_ALLOWED_KEYS));
        written_docs += 1;
      } catch {
        continue;
      }
    }
  }
  if (resolved.historyDefects) store.set_meta("historyDefects", resolved.historyDefects);
  if (resolved.traces) store.set_meta("traces", resolved.traces);
  store.save();
  return { cases: written_cases, docs: written_docs };
}

export function resolve_delivery_defects(
  plan_id: number,
  plan_type: number,
  task_id: number | null = null,
): Record<string, any> {
  let items: any[] = [];
  let source = "empty";
  const result = get_delivery_defects(plan_id, plan_type, 1, 100) || {};
  if (result.code === 0) {
    const data = result.data || {};
    items = [...(data.list || [])];
    if (items.length) source = "provider";
  }
  if (!items.length && task_id) {
    const store = _store_bundle(task_id);
    items = [...(store.historyDefects || [])];
    if (items.length) source = "content_store";
  }
  return {
    code: 0,
    msg: items.length ? "success" : "no submitted defects (provider empty; no user materials)",
    data: { list: items, total: items.length, pageNo: 1, pageSize: 100 },
    source,
    degraded: source !== "provider",
  };
}

export function resolve_traces(
  plan_id: number,
  plan_type = 2,
  service_key: string | null = null,
  task_id: number | null = null,
): Record<string, any> {
  const result = get_exception_traces(plan_id, plan_type, service_key) || {};
  let items: any[] = [];
  let source = "empty";
  if (result.code === 0) {
    const raw = result.data;
    items = Array.isArray(raw) ? raw : [...((raw || {}).traces || [])];
    if (items.length) source = "provider";
  }
  if (!items.length && task_id) {
    const store = _store_bundle(task_id);
    items = [...(store.traces || [])];
    if (items.length) source = "content_store";
  }
  return {
    code: 0,
    msg: items.length ? "success" : "no traces (optional; continue without them)",
    data: items,
    source,
    degraded: source !== "provider",
  };
}
