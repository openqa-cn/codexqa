import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  compact_node,
  map_limit,
  QUERY_CONCURRENCY,
  index_repo,
  nodes_from_parsed,
  run_query,
  run_query_async,
} from "./ensure_codexqa.ts";
import type { ParsedException, StackFrame } from "./parse_exception.ts";
import { analysis_dir, analysis_path, brief_path, read_json, write_json } from "./store.ts";

export const MAX_APP_FRAMES = 12;
const MAX_SOURCE_CHARS = 4000;
const MAX_GRAPH_NODES = 12;
const MAX_GRAPH_PERSIST = 4;
const MAX_GREP_CHARS = 400;
const REACH_DEPTH = 2;

function node_kind(node: any): string {
  return String(node?.kind || compact_node(node).kind || "").toLowerCase();
}

function is_method_node(node: any): boolean {
  const kind = node_kind(node);
  return !kind || kind === "method";
}

/** True when the CodexQA node is in the stack frame's class/file. */
export function symbol_belongs_to_frame(node: any, frame: StackFrame): boolean {
  const compact = compact_node(node);
  const file = String(compact.file || "").replace(/\\/g, "/");
  const fileHint = (frame.file || "").replace(/\\/g, "/");
  const className = (frame.className || "").split(/[./]/).pop() || "";
  if (!fileHint && !className) return true;
  if (fileHint && (file === fileHint || file.endsWith(`/${fileHint}`))) return true;
  if (className) {
    if (file.includes(`/${className}.`) || file.endsWith(`/${className}`) || file.endsWith(`${className}.java`)) {
      return true;
    }
    const nodeName = String(compact.name || "");
    if (nodeName === className || nodeName.endsWith(className)) return true;
    const qn = String(compact.qualifiedName || "");
    if (qn.includes(`${className}::`) || qn.includes(`.${className}.`) || qn.includes(`.${className}::`)) {
      return true;
    }
    if (frame.className && qn.includes(frame.className)) return true;
  }
  return false;
}

export function pick_symbol(nodes: any[], frame: StackFrame): any | null {
  if (!nodes.length) return null;
  const fileHint = (frame.file || "").replace(/\\/g, "/");
  const method = (frame.methodName || "").toLowerCase();
  const className = (frame.className || "").split(/[./]/).pop() || "";
  const wantMethod = !!method;
  const classOrFile = !!(className || fileHint);
  const scoped = classOrFile ? nodes.filter((n) => symbol_belongs_to_frame(n, frame)) : nodes;
  if (!scoped.length) return null;
  const pool = wantMethod
    ? scoped.filter((n) => {
        const kind = node_kind(n);
        return !kind || kind === "method";
      })
    : scoped;
  if (wantMethod && !pool.length) return null;
  const scored = pool.map((n) => {
    const compact = compact_node(n);
    const file = String(compact.file || "").replace(/\\/g, "/");
    const kind = String(compact.kind || n.kind || "").toLowerCase();
    let score = 0;
    if (fileHint && file.endsWith(fileHint)) score += 5;
    if (fileHint && file.includes(fileHint)) score += 3;
    if (method && String(compact.name || "").toLowerCase() === method) score += 8;
    if (method && String(compact.name || "").toLowerCase().includes(method)) score += 2;
    if (className && String(compact.qualifiedName || compact.file || "").includes(className)) score += 2;
    if (wantMethod && kind === "method") score += 6;
    if (wantMethod && kind === "class") score -= 8;
    if (frame.line && compact.startLine && compact.endLine) {
      if (frame.line >= compact.startLine && frame.line <= compact.endLine) score += 6;
      const span = Number(compact.endLine) - Number(compact.startLine);
      if (span > 40) score -= 2;
    }
    return { n, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.n || null;
}

function method_keys(frame: StackFrame, node: any): string[] {
  const compact = compact_node(node);
  const keys = new Set<string>();
  if (frame.key) keys.add(frame.key);
  const name = compact.name || frame.methodName;
  const classShort = (frame.className || compact.qualifiedName || "").split(/[./:]/).pop();
  if (classShort && name) keys.add(`${classShort}#${name}`);
  return [...keys].filter(Boolean);
}

/** Prefer Class#method, then the bare method so CodexQA still hits when `#` names are empty. */
export function query_names(frame: StackFrame): string[] {
  const names: string[] = [];
  const short = frame.className ? frame.className.split(/[./]/).pop() || frame.className : "";
  if (short && frame.methodName) names.push(`${short}#${frame.methodName}`);
  if (frame.methodName) names.push(frame.methodName);
  if (short) names.push(short);
  const base = frame.file ? basename_no_ext(frame.file) : "";
  if (base && base !== short) names.push(base);
  return [...new Set(names.filter(Boolean))];
}

function basename_no_ext(file: string): string {
  const base = String(file).replace(/\\/g, "/").split("/").pop() || file;
  return base.replace(/\.[^.]+$/, "");
}

function regex_escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hint_stems(hint: string): string[] {
  const h = String(hint || "").trim();
  if (!h) return [];
  const out = [h];
  const stripped = h
    .replace(/(SearchService|Service|Searcher|Controller|Handler|Facade|Impl)$/i, "");
  if (stripped && stripped !== h) out.push(stripped);
  return out;
}

function score_name_against_hints(name: string, hints: string[]): number {
  const n = name.toLowerCase();
  let score = 0;
  for (const hint of hints) {
    for (const stem of hint_stems(hint)) {
      const s = stem.toLowerCase();
      if (s.length >= 6 && n.includes(s)) score += s.length;
    }
  }
  return score;
}

/** Class-only abbreviated frame `Foo` → hinted types whose names end with `Foo`. */
export function expand_class_suffix_names(
  local_dir: string,
  frame: StackFrame,
  hints: string[] = [],
): string[] {
  if (frame.methodName) return [];
  const short = (frame.className || "").split(/[./]/).pop() || "";
  if (!short || short.length < 10) return [];
  const pattern = `class\\s+(\\w*${regex_escape(short)})\\b`;
  const rg = spawnSync(
    "rg",
    ["-N", "--no-heading", "--max-count", "12", "-g", "!**/src/test/**", "-g", "**/*.java", pattern, local_dir],
    { encoding: "utf8", timeout: 3_000, maxBuffer: 256 * 1024 },
  );
  if (rg.error || (rg.status !== 0 && rg.status !== 1)) return [];
  const names = new Set<string>();
  const capture = new RegExp(`class\\s+(\\w*${regex_escape(short)})\\b`);
  for (const line of String(rg.stdout || "").split(/\n/)) {
    const m = line.match(capture);
    if (m?.[1] && m[1] !== short) names.add(m[1]);
  }
  return [...names]
    .sort((a, b) => score_name_against_hints(b, hints) - score_name_against_hints(a, hints) || a.localeCompare(b))
    .slice(0, 4);
}

function rank_grep_stdout(stdout: string, hints: string[]): string {
  const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return lines.join("\n");
  const hintLc = hints.map((h) => String(h || "").toLowerCase()).filter(Boolean);
  const scored = lines.map((line, idx) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const hint of hintLc) {
      if (lower.includes(hint)) score += hint.length;
    }
    return { line, score, idx };
  });
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.map((s) => s.line).join("\n");
}

function grep_fallback(local_dir: string, frame: StackFrame, hints: string[] = []): Record<string, any> {
  const classShort = frame.className ? frame.className.split(/[./]/).pop() || "" : "";
  const fileHint = frame.file
    ? String(frame.file).replace(/\\/g, "/").split("/").pop() || ""
    : classShort
      ? `${classShort}.java`
      : "";
  const needle = classShort || frame.methodName || fileHint;
  if (!needle) return { ok: false, error: "no search needle" };
  const rgArgs = ["-n", "--max-count", "8", "-g", "!**/src/test/**", "-g", "!**/*Test.java", "-g", "!**/*Tests.java"];
  if (fileHint) rgArgs.push("-g", `**/*${fileHint}`);
  if (frame.methodName) rgArgs.push("-w", frame.methodName);
  else rgArgs.push(String(needle));
  rgArgs.push(local_dir);
  const rg = spawnSync("rg", rgArgs, {
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 256 * 1024,
  });
  if (rg.error || (rg.status !== 0 && rg.status !== 1)) {
    const grep = spawnSync("grep", ["-R", "-n", "-m", "8", needle, local_dir], {
      encoding: "utf8",
      timeout: 8_000,
      maxBuffer: 256 * 1024,
    });
    return {
      ok: grep.status === 0 || grep.status === 1,
      weak: true,
      tool: "grep",
      stdout: rank_grep_stdout((grep.stdout || "").slice(0, MAX_GREP_CHARS), hints),
    };
  }
  return {
    ok: true,
    weak: true,
    tool: "rg",
    stdout: rank_grep_stdout((rg.stdout || "").slice(0, MAX_GREP_CHARS), hints),
  };
}

function clip_source(sourceParsed: any, node: Record<string, any>): Record<string, any> | null {
  if (sourceParsed?.kind !== "Source") return null;
  const text = String(sourceParsed.text || "");
  const truncated = text.length > MAX_SOURCE_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_SOURCE_CHARS) : text,
    startLine: sourceParsed.start_line ?? sourceParsed.startLine ?? node.startLine,
    endLine: sourceParsed.end_line ?? sourceParsed.endLine ?? node.endLine,
    truncated,
  };
}

function is_test_node(n: any): boolean {
  const file = String(n?.file || n?.file_path || "").replace(/\\/g, "/");
  if (/\/src\/test\//.test(file) || /\/__tests__\//.test(file)) return true;
  if (/(^|\/)tests?\//.test(file)) return true;
  return false;
}

function prefer_app_nodes(nodes: any[]): any[] {
  const app = nodes.filter((n) => !is_test_node(n));
  return app.slice(0, MAX_GRAPH_NODES);
}

function without_self(nodes: any[], rootId: string): any[] {
  if (!rootId) return nodes;
  return nodes.filter((n) => String(n?.id || "") !== rootId);
}

function stack_hints(frames: StackFrame[], except?: StackFrame): string[] {
  const skip = new Set(
    [except?.className?.split(/[./]/).pop(), except?.methodName, except?.file ? basename_no_ext(except.file) : ""]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase()),
  );
  const out: string[] = [];
  for (const frame of frames) {
    for (const raw of [
      frame.className?.split(/[./]/).pop(),
      frame.methodName,
      frame.file ? basename_no_ext(frame.file) : "",
    ]) {
      const value = String(raw || "");
      if (!value || skip.has(value.toLowerCase())) continue;
      if (!out.some((item) => item.toLowerCase() === value.toLowerCase())) out.push(value);
    }
  }
  return out;
}

function slim_hop(n: any): Record<string, any> {
  const file = String(n?.file || "").replace(/\\/g, "/");
  return {
    name: n?.name || "",
    file: file.split("/").pop() || file,
    startLine: n?.startLine ?? null,
    kind: n?.kind || "",
  };
}

function persist_hops(nodes: any[] | undefined): any[] | undefined {
  if (!Array.isArray(nodes) || !nodes.length) return undefined;
  return nodes.slice(0, MAX_GRAPH_PERSIST).map(slim_hop);
}

function compact_slice(slice: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {
    frame: slice.frame,
    ready: !!slice.ready,
    weak: !!slice.weak,
  };
  if (slice.node) out.node = slice.node;
  const callers = persist_hops(slice.callers);
  const callees = persist_hops(slice.callees);
  if (callers) out.callers = callers;
  if (callees) out.callees = callees;
  if (slice.source) out.source = slice.source;
  if (slice.grep) out.grep = slice.grep;
  if (slice.hint) out.hint = slice.hint;
  if (slice.callPath) out.callPath = slice.callPath;
  if (slice.lineDrift) out.lineDrift = true;
  if (Array.isArray(slice.symbols) && slice.symbols.length) out.symbols = slice.symbols.slice(0, 6);
  return out;
}

async function query_name_nodes(
  local_dir: string,
  name: string,
  cache: Map<string, any[]>,
): Promise<any[]> {
  let hit = cache.get(name);
  if (!hit) {
    const symbols = await run_query_async(local_dir, "symbols", ["--name", name]);
    hit = nodes_from_parsed(symbols.parsed);
    cache.set(name, hit);
  }
  return hit;
}

async function resolve_symbol(
  local_dir: string,
  frame: StackFrame,
  cache: Map<string, any[]>,
  hints: string[] = [],
): Promise<any[]> {
  const names = query_names(frame);
  let nodes: any[] = [];
  for (const name of names) {
    nodes = await query_name_nodes(local_dir, name, cache);
    const pickedTry = pick_symbol(nodes, frame);
    if (pickedTry && is_method_node(pickedTry)) {
      return [pickedTry, ...nodes.filter((n) => n !== pickedTry)];
    }
    const belonged = nodes.filter((n) => symbol_belongs_to_frame(n, frame));
    if (belonged.length && !frame.methodName) return belonged;
  }
  let belonged = nodes.filter((n) => symbol_belongs_to_frame(n, frame));
  if (!belonged.length && !frame.methodName) {
    for (const extra of expand_class_suffix_names(local_dir, frame, hints)) {
      nodes = await query_name_nodes(local_dir, extra, cache);
      belonged = nodes.filter((n) => symbol_belongs_to_frame(n, frame));
      if (belonged.length) return belonged;
    }
  }
  return belonged;
}

async function slice_for_frame(
  local_dir: string,
  frame: StackFrame,
  ready: boolean,
  cache: Map<string, any[]>,
  hints: string[] = [],
): Promise<Record<string, any>> {
  if (!ready) {
    return compact_slice({
      frame,
      ready: false,
      weak: true,
      grep: grep_fallback(local_dir, frame, hints),
    });
  }

  const classOnly = !frame.methodName;
  const nodes = await resolve_symbol(local_dir, frame, cache, hints);
  const picked = pick_symbol(nodes, frame);
  if (!picked) {
    const classFallback = nodes.find((n) => node_kind(n) === "class") || (classOnly ? nodes[0] : null);
    if (classFallback) {
      return compact_slice({
        frame,
        ready: true,
        weak: true,
        hint: frame.methodName
          ? `method ${frame.methodName} not in index; class-only fallback`
          : "class-only frame; skipped full class source/reach",
        node: compact_node(classFallback),
        symbols: nodes.map(compact_node).slice(0, 6),
      });
    }
    return compact_slice({
      frame,
      ready: true,
      weak: true,
      grep: grep_fallback(local_dir, frame, hints),
      symbols: nodes.map(compact_node).slice(0, 6),
    });
  }

  const node = compact_node(picked);
  const id = String(node.id || "");
  if (!id || classOnly) {
    return compact_slice({
      frame,
      ready: true,
      weak: classOnly,
      hint: classOnly ? "class-only frame; skipped full class source/reach" : undefined,
      node,
      symbols: nodes.map(compact_node).slice(0, 6),
    });
  }

  const line = Number(frame.line);
  const start = Number(node.startLine);
  const end = Number(node.endLine);
  const lineDrift = !!(line && start && end && (line < start || line > end));

  const [sourceRes, reachInRes, reachOutRes] = await Promise.all([
    run_query_async(local_dir, "source", ["--id", id]),
    run_query_async(local_dir, "reach", ["--id", id, "--direction", "in", "--depth", String(REACH_DEPTH)]),
    run_query_async(local_dir, "reach", ["--id", id, "--direction", "out", "--depth", String(REACH_DEPTH)]),
  ]);

  const callers = prefer_app_nodes(
    without_self(nodes_from_parsed(reachInRes.parsed).map(compact_node), id),
  );
  const callees = prefer_app_nodes(
    without_self(nodes_from_parsed(reachOutRes.parsed).map(compact_node), id),
  );
  const raw: Record<string, any> = {
    frame,
    ready: true,
    weak: false,
    lineDrift,
    hint: lineDrift
      ? `stack line ${line} is outside ${start}-${end} on the indexed revision`
      : undefined,
    node,
    callers,
    callees,
    source: clip_source(sourceRes.parsed, node),
  };
  raw.callPath = call_path_text(raw, hints);
  return compact_slice(raw);
}

export function persist_baseline(
  task_id: number,
  local_dir: string,
  extra: Record<string, any> = {},
): Record<string, any> {
  const ready = extra.ready !== false;
  const existing = read_json(analysis_path(task_id), {}) || {};
  let summaryParsed: any = extra.summary || existing.summary || {};
  let statsParsed: any = extra.stats || existing.stats || {};
  if (ready && extra.refreshSummary) {
    if (extra.summary) {
      summaryParsed = extra.summary;
    } else {
      const summary = run_query(local_dir, "summary");
      summaryParsed = summary.parsed || summaryParsed;
    }
  }
  const analysis = {
    ...existing,
    ready,
    repoId: extra.repoId || existing.repoId || local_dir,
    localDir: local_dir,
    stats: statsParsed,
    summary: summaryParsed,
    repo: {
      scope: "repo",
      files: [],
      filesTotal: summaryParsed.files_total ?? statsParsed.files_total ?? statsParsed.files ?? 0,
      nodesTotal: summaryParsed.nodes_total ?? statsParsed.nodes_total ?? null,
      edgesTotal: summaryParsed.edges_total ?? statsParsed.edges_total ?? null,
      langStats: summaryParsed.lang_stats || summaryParsed.langStats || statsParsed.per_lang || {},
    },
    methods: extra.methods || existing.methods || {},
    frames: extra.frames || existing.frames || [],
    indexedAt: extra.indexedAt || existing.indexedAt || new Date().toISOString(),
    error: extra.error || null,
  };
  delete (analysis as any).frameSlices;
  write_json(analysis_path(task_id), analysis);
  write_json(join(analysis_dir(task_id), "index.json"), {
    repo: local_dir,
    indexedAt: analysis.indexedAt,
  });
  return analysis;
}

export function ensure_index(
  task_id: number,
  local_dir: string,
  opts: { full?: boolean } = {},
): Record<string, any> {
  const indexed = index_repo(local_dir, !!opts.full);
  const ready = indexed.returncode === 0;
  const analysis = persist_baseline(task_id, local_dir, {
    ready,
    error: ready ? null : indexed.stderr || indexed.stdout || "index failed",
    indexedAt: new Date().toISOString(),
    refreshSummary: true,
    summary: undefined,
    stats: indexed.parsed && indexed.parsed.files_total ? indexed.parsed : undefined,
  });
  analysis.index = { returncode: indexed.returncode, parsed: indexed.parsed };
  return analysis;
}

function unique_frames(frames: StackFrame[]): StackFrame[] {
  const seen = new Set<string>();
  const out: StackFrame[] = [];
  for (const frame of frames) {
    const key = frame.key || `${frame.className || ""}#${frame.methodName || ""}@${frame.file || ""}:${frame.line || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(frame);
  }
  return out;
}

export async function analyze_frames(
  task_id: number,
  local_dir: string,
  parsed: ParsedException,
  ready: boolean,
): Promise<Record<string, any>> {
  const app = unique_frames(parsed.appFrames).slice(0, MAX_APP_FRAMES);
  const cache = new Map<string, any[]>();
  const started = Date.now();
  const slices = await map_limit(app, QUERY_CONCURRENCY, (frame) =>
    slice_for_frame(local_dir, frame, ready, cache, stack_hints(app, frame)),
  );
  const methods: Record<string, any> = {};
  for (const slice of slices) {
    const keys = method_keys(slice.frame, slice.node || {});
    const primary = keys[0] || slice.frame?.key;
    if (primary) methods[primary] = slice;
    for (const key of keys) {
      if (!methods[key]) methods[key] = slice;
    }
  }

  const existing = persist_baseline(task_id, local_dir, {
    ready,
    methods,
    frames: slices.map((s) => s.frame),
    refreshSummary: false,
  });
  existing.methods = methods;
  existing.queryStats = {
    frameCount: app.length,
    queryCacheSize: cache.size,
    elapsedMs: Date.now() - started,
  };
  delete existing.frameSlices;
  existing.brief = analysis_brief(existing);
  write_json(analysis_path(task_id), existing);
  write_json(brief_path(task_id), existing.brief);
  return existing;
}

export function analysis_brief(analysis: Record<string, any>): any[] {
  const methods = analysis.methods || {};
  const seen = new Set<string>();
  const out: any[] = [];
  for (const [key, slice] of Object.entries(methods) as [string, any][]) {
    const frameKey = slice?.frame?.key || key;
    if (seen.has(frameKey)) continue;
    seen.add(frameKey);
    const node = slice.node;
    out.push({
      key: frameKey,
      weak: !!slice.weak,
      lineDrift: slice.lineDrift || undefined,
      hint: slice.hint || undefined,
      callPath: slice.callPath || undefined,
      source: slice.source || undefined,
      node: node
        ? {
            kind: node.kind,
            name: node.name,
            file: node.file,
            startLine: node.startLine,
            endLine: node.endLine,
          }
        : undefined,
    });
  }
  return out;
}

function node_matches_hint(n: any, hint: string): boolean {
  const h = String(hint || "").toLowerCase();
  if (!h) return false;
  const name = String(n.name || "").toLowerCase();
  const qn = String(n.qualifiedName || "").toLowerCase();
  const fileBase =
    String(n.file || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "")
      .toLowerCase() || "";
  if (name === h) return true;
  if (fileBase === h) return true;
  if (qn.endsWith(`::${h}`) || qn.endsWith(`.${h}`)) return true;
  return false;
}

export function call_path_text(slice: Record<string, any>, stackHints: string[] = []): string {
  const node = slice.node || {};
  const nodeId = String(node.id || "");
  const format = (n: any): string => {
    const name = n.qualifiedName || n.name;
    if (!name) return "";
    return n.startLine != null ? `${name}(L${n.startLine})` : String(name);
  };
  const callers = (Array.isArray(slice.callers) ? slice.callers : []).filter(
    (n) => n && String(n.id || "") !== nodeId && (n.name || n.qualifiedName),
  );
  const methods = callers.filter((n) => {
    const kind = String(n.kind || "").toLowerCase();
    return !kind || kind === "method";
  });
  const pool = methods.length ? methods : callers;
  const hinted = stackHints.length
    ? pool.find((n) => stackHints.some((hint) => node_matches_hint(n, hint)))
    : undefined;
  const hop = hinted || pool[0];
  const nodeText = format(node);
  if (hop) {
    const hopText = format(hop);
    if (hopText && nodeText) return `${hopText}→${nodeText}`;
  }
  return nodeText;
}
