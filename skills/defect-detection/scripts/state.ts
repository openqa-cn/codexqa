import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { content_base_dir } from "./store.ts";
import { with_file_lock } from "./providers/json_store.ts";

function _validate_task_id(task_id: any): number {
  if (typeof task_id !== "number" || !Number.isInteger(task_id)) {
    throw new Error(`task_id must be a positive integer, got: ${JSON.stringify(task_id)} (type=${typeof task_id})`);
  }
  if (task_id <= 0) {
    throw new Error(`task_id must be a positive integer (>0), got: ${task_id}`);
  }
  return task_id;
}

function _is_dir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function _tuple_key(...parts: any[]): string {
  return JSON.stringify(parts);
}

function _now(): string {
  return new Date().toISOString();
}

export function _get_local_state_path(task_id: number): string {
  _validate_task_id(task_id);
  const dir_path = join(content_base_dir(), String(task_id));
  mkdirSync(dir_path, { recursive: true });
  return join(dir_path, "local_state.json");
}

export function _load_local_state(task_id: number): Record<string, any> {
  const path = _get_local_state_path(task_id);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e: any) {
    if (e?.code === "ENOENT" || e instanceof SyntaxError) return {};
    throw e;
  }
}

function _save_local_state(task_id: number, state: Record<string, any>): void {
  const path = _get_local_state_path(task_id);
  const tmp_path = path + ".tmp";
  try {
    writeFileSync(tmp_path, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp_path, path);
  } catch (e: any) {
    console.error(`[local-state] ⚠️  failed to write local progress file: ${e}`);
  }
}

function _locked_state_update(task_id: number, mutate_fn: (state: Record<string, any>) => void): void {
  const path = _get_local_state_path(task_id);
  const lock_path = path + ".lock";
  with_file_lock(lock_path, () => {
    const state = _load_local_state(task_id);
    mutate_fn(state);
    _save_local_state(task_id, state);
  });
}

export function mark_method_done(
  task_id: number,
  batch_id: number,
  class_name: string,
  method_name: string,
  strategy_code: number,
  bug_status: number,
): void {
  const now_str = _now();
  const process_key = `${class_name}#${method_name || ""}#${strategy_code}`;

  function _mutate(state: Record<string, any>): void {
    if (!("taskId" in state)) state.taskId = task_id;
    if (!("writtenProcesses" in state)) state.writtenProcesses = {};
    const batch_key = String(batch_id);
    if (!(batch_key in state.writtenProcesses)) state.writtenProcesses[batch_key] = {};
    state.writtenProcesses[batch_key][process_key] = {
      bugStatus: bug_status,
      doneAt: now_str,
    };
  }

  _locked_state_update(task_id, _mutate);
}

export function get_local_progress(task_id: number): Record<string, any> {
  const state = _load_local_state(task_id);
  if (!state || Object.keys(state).length === 0) {
    return { _error: "Local progress file is missing or empty; detection may not have started or the file was cleaned up." };
  }

  const written = state.writtenProcesses || {};
  const summary: Record<string, any> = {};
  for (const [batch_key, methods] of Object.entries(written)) {
    const total = Object.keys(methods as any).length;
    const has_bug = Object.values(methods as any).filter((v: any) => [6, 7].includes(v?.bugStatus)).length;
    const no_bug = total - has_bug;
    summary[batch_key] = { total, noBug: no_bug, hasBug: has_bug };
  }
  state.summary = summary;
  return state;
}

const _code_read_registry = new Map<string, any>();
const _CLASS_FILE_EXT = /\.(java|kt|groovy|scala|xml|ts|tsx|js|jsx|vue|json|properties)$/i;

/** Slash/dot-normalized class key. File extensions are kept so `Order.tsx` is not treated as a Java FQCN. */
export function normalize_class_name_key(class_name: string): string {
  let s = String(class_name || "").trim().replace(/\\/g, "/");
  if (!s) return "";
  if (!_CLASS_FILE_EXT.test(s)) s = s.replace(/\./g, "/");
  return s.replace(/\/+/g, "/");
}

export function simple_class_name(class_name: string): string {
  const norm = normalize_class_name_key(class_name);
  if (!norm) return "";
  return norm.includes("/") ? norm.split("/").pop()! : norm;
}

/**
 * Match write-back className against a register-code-read key.
 * Accepts slash↔dot FQCN and short name ↔ full path (`OrderService` ↔ `com/.../OrderService`).
 * Two different full paths that only share a simple name do not match.
 */
export function class_names_match(a: string, b: string): boolean {
  const na = normalize_class_name_key(a);
  const nb = normalize_class_name_key(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const a_simple_only = !na.includes("/");
  const b_simple_only = !nb.includes("/");
  if (a_simple_only || b_simple_only) return simple_class_name(na) === simple_class_name(nb);
  return false;
}

function _lookup_registry_entry(registry: Record<string, any> | null | undefined, class_name: string): any | undefined {
  if (!registry || typeof registry !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(registry, class_name)) return registry[class_name];
  for (const [key, value] of Object.entries(registry)) {
    if (class_names_match(key, class_name)) return value;
  }
  return undefined;
}

export function register_code_read(
  task_id: number,
  batch_id: number,
  class_name: string,
  file_path: string,
  code_snippet: string | null = null,
): void {
  const now_str = _now();

  let code_hash = "";
  let snippet_len = 0;
  if (code_snippet) {
    snippet_len = code_snippet.length;
    code_hash = createHash("sha256").update(code_snippet, "utf8").digest("hex").slice(0, 16);
  }

  function _mutate(state: Record<string, any>): void {
    if (!("codeReadRegistry" in state)) state.codeReadRegistry = {};
    const batch_key = String(batch_id);
    if (!(batch_key in state.codeReadRegistry)) state.codeReadRegistry[batch_key] = {};
    state.codeReadRegistry[batch_key][class_name] = {
      filePath: file_path,
      codeHash: code_hash,
      readAt: now_str,
      snippetLen: snippet_len,
    };
  }

  _locked_state_update(task_id, _mutate);

  _code_read_registry.set(_tuple_key(String(batch_id), class_name), {
    filePath: file_path,
    codeHash: code_hash,
    snippetLen: snippet_len,
  });
}

export function find_code_read_entry(
  batch_id: number,
  class_name: string,
  task_id: number | null = null,
): Record<string, any> | null {
  const batch_key = String(batch_id);
  const exact_key = _tuple_key(batch_key, class_name);
  if (_code_read_registry.has(exact_key)) return _code_read_registry.get(exact_key);

  for (const [key, value] of _code_read_registry.entries()) {
    try {
      const parsed = JSON.parse(key);
      if (String(parsed?.[0]) === batch_key && class_names_match(String(parsed?.[1] ?? ""), class_name)) {
        return value;
      }
    } catch {
      /* ignore malformed in-memory keys */
    }
  }

  if (task_id != null) {
    const state = _load_local_state(task_id);
    const registry = state.codeReadRegistry || {};
    const batch_key = String(batch_id);
    const entry = _lookup_registry_entry(registry[batch_key], class_name);
    if (entry) return entry;
  }

  return null;
}

export function has_code_been_read(
  batch_id: number,
  class_name: string,
  task_id: number | null = null,
): boolean {
  return find_code_read_entry(batch_id, class_name, task_id) != null;
}

export function get_code_read_stats(task_id: number, batch_id: number): Record<string, any> {
  const state = _load_local_state(task_id);
  const registry = state.codeReadRegistry || {};
  const batch_key = String(batch_id);
  const batch_registry = registry[batch_key] || {};

  const classes = Object.keys(batch_registry);
  const snippet_lens = Object.values(batch_registry).map((v: any) => v?.snippetLen || 0);
  const avg_len = snippet_lens.length ? snippet_lens.reduce((a: number, b: number) => a + b, 0) / snippet_lens.length : 0;

  return {
    totalRegistered: classes.length,
    registeredClasses: classes,
    avgSnippetLen: Math.trunc(avg_len),
  };
}

const _repo_clone_registry = new Map<string, any>();

export function register_repo_clone(
  task_id: number,
  batch_id: number,
  git_url: string,
  local_dir: string,
  branch: string,
  commit_id = "",
): void {
  const now_str = _now();

  const dir_exists = _is_dir(local_dir);
  const has_git = _is_dir(join(local_dir, ".git"));

  function _mutate(state: Record<string, any>): void {
    if (!("repoCloneRegistry" in state)) state.repoCloneRegistry = {};
    const batch_key = String(batch_id);
    if (!(batch_key in state.repoCloneRegistry)) state.repoCloneRegistry[batch_key] = {};
    state.repoCloneRegistry[batch_key][git_url] = {
      localDir: local_dir,
      branch,
      commitId: commit_id,
      clonedAt: now_str,
      verified: dir_exists && has_git,
    };
  }

  _locked_state_update(task_id, _mutate);

  _repo_clone_registry.set(_tuple_key(batch_id, git_url), {
    localDir: local_dir,
    branch,
    commitId: commit_id,
    verified: dir_exists && has_git,
  });
}

export function has_repo_been_cloned(
  batch_id: number,
  git_url: string,
  task_id: number | null = null,
): boolean {
  const cached = _repo_clone_registry.get(_tuple_key(batch_id, git_url));
  if (cached) {
    const local_dir = cached.localDir || "";
    if (_is_dir(local_dir)) return true;
  }

  for (const [key, entry] of [..._repo_clone_registry.entries()]) {
    const [, cached_git] = JSON.parse(key);
    if (cached_git === git_url) {
      const local_dir = entry.localDir || "";
      if (_is_dir(local_dir)) {
        _repo_clone_registry.set(_tuple_key(batch_id, git_url), entry);
        return true;
      }
    }
  }

  if (task_id != null) {
    const state = _load_local_state(task_id);
    const registry = state.repoCloneRegistry || {};

    const batch_key = String(batch_id);
    if (batch_key in registry && git_url in registry[batch_key]) {
      const entry = registry[batch_key][git_url];
      const local_dir = entry.localDir || "";
      if (_is_dir(local_dir)) {
        _repo_clone_registry.set(_tuple_key(batch_id, git_url), entry);
        return true;
      }
    }

    for (const repos of Object.values(registry) as Record<string, any>[]) {
      if (git_url in repos) {
        const entry = repos[git_url];
        const local_dir = entry.localDir || "";
        if (_is_dir(local_dir)) {
          _repo_clone_registry.set(_tuple_key(batch_id, git_url), entry);
          return true;
        }
      }
    }
  }

  return false;
}

export function get_batch_git(batch_id: number, task_id: number | null = null): string | null {
  for (const key of _repo_clone_registry.keys()) {
    const [b_id, git_url] = JSON.parse(key);
    if (b_id === batch_id && git_url) return git_url;
  }

  if (task_id != null) {
    const state = _load_local_state(task_id);
    const registry = state.repoCloneRegistry || {};
    const batch_key = String(batch_id);
    const repos = registry[batch_key] || {};
    for (const git_url of Object.keys(repos)) {
      if (git_url) return git_url;
    }
  }

  return null;
}

export function get_repo_clone_info(
  batch_id: number,
  git_url: string | null = null,
  task_id: number | null = null,
): { localDir: string; branch: string; commitId: string; gitUrl: string } | null {
  const pick = (entry: any, url: string) => ({
    localDir: entry?.localDir || "",
    branch: entry?.branch || "",
    commitId: entry?.commitId || "",
    gitUrl: url || "",
  });

  if (git_url) {
    const cached = _repo_clone_registry.get(_tuple_key(batch_id, git_url));
    if (cached) return pick(cached, git_url);
  }
  for (const [key, entry] of _repo_clone_registry.entries()) {
    const [b_id, url] = JSON.parse(key);
    if (batch_id && b_id === batch_id && (!git_url || url === git_url)) return pick(entry, url);
    if (git_url && url === git_url) return pick(entry, url);
  }

  if (task_id != null) {
    const state = _load_local_state(task_id);
    const registry = state.repoCloneRegistry || {};
    if (git_url) {
      const exact = registry[String(batch_id)]?.[git_url];
      if (exact) return pick(exact, git_url);
      for (const repos of Object.values(registry) as Record<string, any>[]) {
        if (repos && git_url in repos) return pick(repos[git_url], git_url);
      }
    }
    const batch_repos = registry[String(batch_id)] || {};
    const first_url = Object.keys(batch_repos)[0];
    if (first_url) return pick(batch_repos[first_url], first_url);
  }
  return null;
}

const _written_process_keys = new Set<string>();

function _dedup_key_str(dedup_key: any): string {
  return Array.isArray(dedup_key) ? JSON.stringify(dedup_key) : JSON.stringify([dedup_key]);
}

export function is_already_written(dedup_key: any): boolean {
  return _written_process_keys.has(_dedup_key_str(dedup_key));
}

export function mark_written(dedup_key: any): void {
  _written_process_keys.add(_dedup_key_str(dedup_key));
}

const _pending_cache: Record<string, any> = {};
const _git_context: Record<string, any> = {};

export function register_pending_batch(
  task_id: number,
  batch_id: number,
  git_url: string,
  branch: string,
  commit_id: string,
): void {
  function _mutate(state: Record<string, any>): void {
    if (!("pendingRegistry" in state)) state.pendingRegistry = {};
    if (!("gitContext" in state)) state.gitContext = {};
    if (!(String(batch_id) in state.pendingRegistry)) {
      state.pendingRegistry[String(batch_id)] = {
        git: git_url || "",
        branch: branch || "",
        commitId: commit_id || "",
        _methods: {},
      };
    } else {
      const entry = state.pendingRegistry[String(batch_id)];
      if (!("git" in entry)) entry.git = git_url || "";
      if (!("branch" in entry)) entry.branch = branch || "";
      if (!("commitId" in entry)) entry.commitId = commit_id || "";
    }
  }

  _locked_state_update(task_id, _mutate);

  _pending_cache[String(batch_id)] = {
    git: git_url || "",
    branch: branch || "",
    commitId: commit_id || "",
    _methods: {},
  };
}

function _method_key(class_name: string, method_name: string | null | undefined, strategy_code: number): string {
  const mn = method_name || "";
  return `${class_name}#${mn}#${strategy_code}`;
}

export function register_pending_method(
  task_id: number,
  batch_id: number,
  class_name: string,
  method_name: string,
  strategy_code: number,
  process_id: number | null = null,
  git_url: string | null = null,
  branch: string | null = null,
  commit_id: string | null = null,
): void {
  const existing_batch = _pending_cache[String(batch_id)] || {};
  git_url = git_url || existing_batch.git || "";
  branch = branch || existing_batch.branch || "";
  commit_id = commit_id || existing_batch.commitId || "";

  function _mutate(state: Record<string, any>): void {
    if (!("pendingRegistry" in state)) state.pendingRegistry = {};
    if (!("gitContext" in state)) state.gitContext = {};

    const batch_key = String(batch_id);
    if (!(batch_key in state.pendingRegistry)) {
      state.pendingRegistry[batch_key] = {
        git: git_url,
        branch,
        commitId: commit_id,
        _methods: {},
      };
    }

    const entry = state.pendingRegistry[batch_key];
    if (!("git" in entry)) entry.git = git_url;
    if (!("branch" in entry)) entry.branch = branch;
    if (!("commitId" in entry)) entry.commitId = commit_id;

    const method_key = _method_key(class_name, method_name, strategy_code);
    if (process_id != null) {
      entry._methods[method_key] = Number.parseInt(String(process_id), 10);
    } else if (!(method_key in entry._methods)) {
      if (!(method_key in entry._methods)) entry._methods[method_key] = null;
    }

    if (class_name && !(class_name in state.gitContext)) {
      state.gitContext[class_name] = {
        batchId: batch_id,
        git: git_url,
        branch,
        commitId: commit_id,
      };
    }
  }

  _locked_state_update(task_id, _mutate);

  if (!(String(batch_id) in _pending_cache)) {
    _pending_cache[String(batch_id)] = {
      git: git_url || "",
      branch: branch || "",
      commitId: commit_id || "",
      _methods: {},
    };
  }
  const method_key = _method_key(class_name, method_name, strategy_code);
  if (process_id != null) {
    _pending_cache[String(batch_id)]._methods[method_key] = Number.parseInt(String(process_id), 10);
  } else if (!(method_key in _pending_cache[String(batch_id)]._methods)) {
    _pending_cache[String(batch_id)]._methods[method_key] = null;
  }
  if (class_name && !(class_name in _git_context)) {
    _git_context[class_name] = {
      batchId: Number.parseInt(String(batch_id), 10),
      git: git_url || "",
      branch: branch || "",
      commitId: commit_id || "",
    };
  }
}

function _sync_pending_cache_from_entry(batch_key: string, entry: Record<string, any>): void {
  const methods_map = entry._methods || {};
  _pending_cache[batch_key] = {
    git: entry.git || "",
    branch: entry.branch || "",
    commitId: entry.commitId || "",
    _methods: { ...methods_map },
  };
}

export function lookup_pending_ids(
  task_id: number,
  class_name: string,
  method_name: string | null = null,
  strategy_code: number | null = null,
): Record<string, any> | null {
  for (const [batch_key, entry] of Object.entries(_pending_cache)) {
    const methods_map = entry._methods || {};
    if (strategy_code != null && method_name) {
      const mk = _method_key(class_name, method_name, strategy_code);
      if (mk in methods_map) {
        return {
          batchId: Number.parseInt(batch_key, 10),
          processId: methods_map[mk],
          git: entry.git || "",
          branch: entry.branch || "",
          commitId: entry.commitId || "",
        };
      }
    }
  }

  if (method_name == null && strategy_code != null) {
    for (const [batch_key, entry] of Object.entries(_pending_cache)) {
      const methods_map = entry._methods || {};
      for (const [mk, pid] of Object.entries(methods_map)) {
        if (mk.startsWith(`${class_name}#`) && mk.endsWith(`#${strategy_code}`)) {
          return {
            batchId: Number.parseInt(batch_key, 10),
            processId: pid,
            git: entry.git || "",
            branch: entry.branch || "",
            commitId: entry.commitId || "",
          };
        }
      }
    }
  }

  if (strategy_code == null && method_name) {
    for (const [batch_key, entry] of Object.entries(_pending_cache)) {
      const methods_map = entry._methods || {};
      for (const [mk, pid] of Object.entries(methods_map)) {
        if (mk.startsWith(`${class_name}#${method_name}#`)) {
          return {
            batchId: Number.parseInt(batch_key, 10),
            processId: pid,
            git: entry.git || "",
            branch: entry.branch || "",
            commitId: entry.commitId || "",
          };
        }
      }
    }
  }

  if (class_name in _git_context) {
    const ctx = _git_context[class_name];
    return {
      batchId: ctx.batchId,
      processId: null,
      git: ctx.git || "",
      branch: ctx.branch || "",
      commitId: ctx.commitId || "",
    };
  }

  const state = _load_local_state(task_id);
  const registry = state.pendingRegistry || {};
  const git_context = state.gitContext || {};

  for (const [batch_key, entry] of Object.entries(registry) as [string, any][]) {
    const methods_map = entry._methods || {};
    if (strategy_code != null && method_name) {
      const mk = _method_key(class_name, method_name, strategy_code);
      if (mk in methods_map) {
        _sync_pending_cache_from_entry(batch_key, entry);
        return {
          batchId: Number.parseInt(batch_key, 10),
          processId: methods_map[mk],
          git: entry.git || "",
          branch: entry.branch || "",
          commitId: entry.commitId || "",
        };
      }
    }
  }

  if (method_name == null && strategy_code != null) {
    for (const [batch_key, entry] of Object.entries(registry) as [string, any][]) {
      for (const [mk, pid] of Object.entries(entry._methods || {})) {
        if (mk.startsWith(`${class_name}#`) && mk.endsWith(`#${strategy_code}`)) {
          _sync_pending_cache_from_entry(batch_key, entry);
          return {
            batchId: Number.parseInt(batch_key, 10),
            processId: pid,
            git: entry.git || "",
            branch: entry.branch || "",
            commitId: entry.commitId || "",
          };
        }
      }
    }
  }

  if (strategy_code == null && method_name) {
    for (const [batch_key, entry] of Object.entries(registry) as [string, any][]) {
      for (const [mk, pid] of Object.entries(entry._methods || {})) {
        if (mk.startsWith(`${class_name}#${method_name}#`)) {
          _sync_pending_cache_from_entry(batch_key, entry);
          return {
            batchId: Number.parseInt(batch_key, 10),
            processId: pid,
            git: entry.git || "",
            branch: entry.branch || "",
            commitId: entry.commitId || "",
          };
        }
      }
    }
  }

  if (class_name in git_context) {
    const ctx = git_context[class_name];
    _git_context[class_name] = ctx;
    return {
      batchId: ctx.batchId,
      processId: null,
      git: ctx.git || "",
      branch: ctx.branch || "",
      commitId: ctx.commitId || "",
    };
  }

  return null;
}

export function get_all_batch_gits(task_id: number): Record<string, any>[] {
  const state = _load_local_state(task_id);
  const registry = state.pendingRegistry || {};
  const result: Record<string, any>[] = [];
  for (const [batch_key, entry] of Object.entries(registry) as [string, any][]) {
    result.push({
      batchId: Number.parseInt(batch_key, 10),
      git: entry.git || "",
      branch: entry.branch || "",
      commitId: entry.commitId || "",
      methodCount: Object.keys(entry._methods || {}).length,
    });
  }
  return result;
}

export function auto_fill_ids(
  task_id: number,
  class_name: string,
  method_name: string | null = null,
  strategy_code: number | null = null,
  target_dict: Record<string, any> | null = null,
): Record<string, any> {
  const result = target_dict ? { ...target_dict } : {};
  if (!("className" in result)) result.className = class_name;

  const existing_batch = result.parentBatchId || result.batchId;
  const existing_proc = result.processId;
  if (existing_batch && existing_proc != null) return result;

  const lookup = lookup_pending_ids(task_id, class_name, method_name, strategy_code);
  if (lookup == null) return result;

  if (!existing_batch) result.parentBatchId = lookup.batchId;
  if (existing_proc == null) result.processId = lookup.processId;

  return result;
}
