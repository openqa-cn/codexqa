/**
 * Language-aware unit extraction for the detection plan.
 *
 * Phase 1 turns a diff into a list of units the agent must analyse one by one.
 * Every profiled language in `lang.ts` has an extractor here:
 *
 *   java / kotlin / scala / csharp / c / cpp / go / js / ts  → brace matching
 *   python                                                  → indentation
 *   anything else that still looks like source              → one file-level unit
 *
 * All extractors work on `strip_source` output, where string / comment contents
 * are blanked but line structure and code braces are preserved, so a `}` inside
 * a string literal never closes a method.
 *
 * When Semgrep is on PATH, `semgrep_function_ranges` runs one batch scan with
 * per-language function-definition patterns and `merge_semgrep_units` uses the
 * AST-accurate ranges to correct the regex ranges and add units the regexes
 * missed. Regex output is the baseline and is never removed by the refinement.
 *
 * A unit is identified by `className` + `methodName`. JVM files keep the
 * package-style className (`com/acme/OrderService`); every other language uses the
 * repo-relative path without its extension (`src/reservation`), so the plan's
 * `filePath` is the real file and write-back validation can find it on disk.
 * Never synthesise a `src/main/java/...` path for non-Java languages.
 */

import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  LANG_TO_EXTENSIONS,
  is_supported_source_path,
  language_from_path,
  language_profile,
  strip_source_prefixes,
} from "./lang.ts";
import { run, scratch_dir, to_posix, which } from "./sys.ts";

export interface MethodUnit {
  methodName: string;
  params: string;
  startLine: number;
  endLine: number;
  bodyLineCount: number;
  signature: string;
  returnType?: string;
  /** Language id of the file the unit came from. */
  language?: string;
  /** True when we could not parse functions and fell back to "the whole file is one unit". */
  fileLevel?: boolean;
  /** Set when Semgrep corrected the range or discovered the unit. */
  rangeSource?: "regex" | "semgrep";
  /** True for expression-bodied arrows / `= expr` units (not an empty brace body). */
  expressionBody?: boolean;
}

export type ExtractFamily = "java" | "kotlin" | "scala" | "js" | "python" | "go" | "c" | "csharp";

/** Extra extensions we plan units for even without an extractor (Vue/Svelte SFCs, Obj-C). */
const _EXTRA_SOURCE_EXTS = new Set([".m", ".mm", ".vue", ".svelte"]);

const _JVM_LANGS = new Set(["java", "kotlin", "scala"]);

function _ext_of(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

export function is_jvm_file(rel_path: string): boolean {
  return _JVM_LANGS.has(language_from_path(rel_path) || "");
}

export function is_source_file(rel_path: string): boolean {
  return is_supported_source_path(rel_path) || _EXTRA_SOURCE_EXTS.has(_ext_of(rel_path));
}

/** Extraction family for a path (or an explicit language), or null when we have no parser. */
export function family_of_file(rel_path: string, language?: string | null): ExtractFamily | null {
  const lang = (language && language_profile(language)?.id) || language_from_path(rel_path);
  switch (lang) {
    case "java": return "java";
    case "kotlin": return "kotlin";
    case "scala": return "scala";
    case "javascript":
    case "typescript": return "js";
    case "python": return "python";
    case "go": return "go";
    case "c":
    case "cpp": return "c";
    case "csharp": return "csharp";
    default: return null;
  }
}

/**
 * Unit className for a file.
 * JVM: source-root-relative, slash-separated (`com/acme/OrderService`).
 * Others: repo-relative path minus the extension (`src/order/reservation`).
 */
export function class_name_for_file(rel_path: string): string {
  const posix = rel_path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (is_jvm_file(posix)) return strip_source_prefixes(posix, language_from_path(posix));
  const ext = _ext_of(posix);
  return ext ? posix.slice(0, -ext.length) : posix;
}

/** Fallback unit name when a file has no parseable functions: the bare file name. */
export function file_level_method_name(rel_path: string): string {
  const base = (rel_path.replace(/\\/g, "/").split("/").pop() || rel_path);
  const ext = _ext_of(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Blank out the *contents* of strings, template literals, regex literals and
 * comments while preserving line structure and every brace that belongs to code.
 * Returned lines are safe to brace-count and to match signatures against.
 */
export function strip_source(source: string, family: ExtractFamily): string[] {
  // Work with one newline representation so escaped CRLF continuations preserve
  // exactly the same physical-line structure as LF input.
  source = source.replace(/\r\n?/g, "\n");
  const out: string[] = [];
  let line = "";
  let i = 0;
  let state: "code" | "line_comment" | "block_comment" | "sq" | "dq" | "tpl" | "regex" = "code";
  // Tracks the last significant code char, used to tell `/` division from a regex literal.
  let prev_sig = "";
  const n = source.length;

  const hash_comments = family === "python";
  const slash_comments = family !== "python";
  const triple_quotes = family === "python" || family === "kotlin" || family === "scala";
  const template_literals = family === "js";
  const regex_literals = family === "js";
  // Kotlin/Scala/C#/Go/C treat `'` as a char literal; JS/Python as a string. Either way the contents are blanked.

  const push_char = (c: string) => { line += c; };
  const end_line = () => { out.push(line); line = ""; };

  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1] || "";

    if (c === "\n") {
      if (state === "line_comment") state = "code";
      // Unterminated single-line constructs cannot span lines.
      if (state === "sq" || state === "dq" || state === "regex") state = "code";
      end_line();
      i += 1;
      continue;
    }

    switch (state) {
      case "code": {
        if (slash_comments && c === "/" && c2 === "/") { state = "line_comment"; push_char(" "); push_char(" "); i += 2; continue; }
        if (slash_comments && c === "/" && c2 === "*") { state = "block_comment"; push_char(" "); push_char(" "); i += 2; continue; }
        if (hash_comments && c === "#") { state = "line_comment"; push_char(" "); i += 1; continue; }
        if (c === '"') {
          // Triple-quoted strings behave like block comments for our purposes.
          if (triple_quotes && c2 === '"' && source[i + 2] === '"') {
            const close = source.indexOf('"""', i + 3);
            const stop = close === -1 ? n : close + 3;
            for (let k = i; k < stop; k++) { if (source[k] === "\n") end_line(); else push_char(" "); }
            i = stop;
            continue;
          }
          state = "dq"; push_char(c); i += 1; continue;
        }
        if (c === "'") {
          if (family === "python" && c2 === "'" && source[i + 2] === "'") {
            const close = source.indexOf("'''", i + 3);
            const stop = close === -1 ? n : close + 3;
            for (let k = i; k < stop; k++) { if (source[k] === "\n") end_line(); else push_char(" "); }
            i = stop;
            continue;
          }
          state = "sq"; push_char(c); i += 1; continue;
        }
        if (c === "`" && template_literals) { state = "tpl"; push_char(c); i += 1; continue; }
        if (c === "/" && regex_literals && _regex_can_start(prev_sig)) { state = "regex"; push_char(c); i += 1; continue; }
        push_char(c);
        if (c.trim()) prev_sig = c;
        i += 1;
        continue;
      }
      case "line_comment": { push_char(" "); i += 1; continue; }
      case "block_comment": {
        if (c === "*" && c2 === "/") { state = "code"; push_char(" "); push_char(" "); i += 2; continue; }
        push_char(" "); i += 1; continue;
      }
      case "sq": case "dq": case "regex": {
        if (c === "\\") {
          push_char(" ");
          if (c2 === "\n") {
            // Escaped newline continues the literal but is still a physical line break —
            // do not swallow it as a blanked char (that shifts later line numbers).
            end_line();
            i += 2;
            continue;
          }
          push_char(" ");
          i += 2;
          continue;
        }
        const closer = state === "sq" ? "'" : state === "dq" ? '"' : "/";
        if (c === closer) { state = "code"; push_char(c); prev_sig = c === "/" ? "x" : c; i += 1; continue; }
        push_char(" "); i += 1; continue;
      }
      case "tpl": {
        if (c === "\\") {
          push_char(" ");
          if (c2 === "\n") { end_line(); i += 2; continue; }
          push_char(" ");
          i += 2;
          continue;
        }
        if (c === "`") { state = "code"; push_char(c); prev_sig = c; i += 1; continue; }
        // `${ ... }` holds real code, but blanking it keeps brace counting balanced.
        push_char(" "); i += 1; continue;
      }
    }
  }
  end_line();
  return out;
}

/** A `/` starts a regex literal (not division) when the previous code char cannot end an expression. */
function _regex_can_start(prev: string): boolean {
  if (!prev) return true;
  return "=(,:[!&|?{};+-*%<>~^".includes(prev);
}

/**
 * Join a signature that wraps across lines (`function foo(\n  a,\n  b\n) {`) so a
 * single-line regex can still match it. Returns the joined text and how many extra
 * lines it consumed.
 */
function _logical_line(lines: string[], idx: number, max_extra = 8): [string, number] {
  let text = lines[idx];
  if (_balanced_parens(text) || !text.includes("(")) return [text, 0];
  for (let k = 1; k <= max_extra && idx + k < lines.length; k++) {
    text += " " + lines[idx + k].trim();
    if (_balanced_parens(text)) return [text, k];
  }
  return [lines[idx], 0];
}

function _balanced_parens(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === "(") depth += 1;
    else if (c === ")") { depth -= 1; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** Walk braces from `start_idx` to the line that closes the body. */
function _brace_body_end(stripped: string[], start_idx: number, max_open_scan = 6): number | null {
  let depth = 0;
  let opened = false;
  for (let j = start_idx; j < stripped.length; j++) {
    if (!opened && j >= start_idx + max_open_scan) return null;
    for (const c of stripped[j]) {
      if (c === "{") { depth += 1; opened = true; }
      else if (c === "}") depth -= 1;
    }
    if (opened && depth <= 0) return j;
  }
  return opened ? stripped.length - 1 : null;
}

/** True when a `;` appears before any `{` in the scan window — i.e. a declaration, not a definition. */
function _declaration_before_brace(stripped: string[], start_idx: number, window = 6): boolean {
  for (let j = start_idx; j < Math.min(stripped.length, start_idx + window); j++) {
    const text = stripped[j];
    const semi = text.indexOf(";");
    const brace = text.indexOf("{");
    if (semi >= 0 && (brace < 0 || semi < brace)) return true;
    if (brace >= 0) return false;
  }
  return false;
}

/** Keep parameter names/types compact and comparable; drop defaults and whitespace noise. */
function _normalise_params(raw: string): string {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let angle = 0;
  for (const c of raw) {
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === "<") angle += 1;
    else if (c === ">") angle = Math.max(0, angle - 1);
    if (c === "," && depth === 0 && angle === 0) {
      const piece = buf.split("=")[0].trim().replace(/\s+/g, " ");
      if (piece) parts.push(piece);
      buf = "";
      continue;
    }
    buf += c;
  }
  const last = buf.split("=")[0].trim().replace(/\s+/g, " ");
  if (last) parts.push(last);
  return parts.join(",");
}

/** Extract the inside of a balanced `(...)` starting at `open_idx`. */
function _paren_inside(text: string, open_idx: number): string | null {
  if (open_idx < 0 || text[open_idx] !== "(") return null;
  let depth = 0;
  for (let i = open_idx; i < text.length; i++) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open_idx + 1, i);
    }
  }
  return null;
}

/**
 * Lines of real body code in [start_idx, end_idx].
 * Brace bodies: lines strictly between the signature line and the closing line,
 * except a one-liner `{ return x; }` counts as 1 when something sits between the braces.
 * Indentation / expression bodies (Python, Kotlin/Scala `= expr`): every line after
 * the signature, and a same-line expression counts as 1.
 */
function _body_line_count(stripped: string[], start_idx: number, end_idx: number, kind: "brace" | "indent" | "expr"): number {
  if (kind === "brace") {
    if (end_idx > start_idx) return Math.max(0, end_idx - start_idx - 1);
    const line = stripped[start_idx] || "";
    const open = line.indexOf("{");
    const close = line.lastIndexOf("}");
    return open >= 0 && close > open && line.slice(open + 1, close).trim() ? 1 : 0;
  }
  if (end_idx > start_idx) return end_idx - start_idx;
  // Same-line body: `def f(): return 1` / `fun f() = x` / `def f = x`
  const line = stripped[start_idx] || "";
  const tail = kind === "indent" ? line.slice(line.lastIndexOf(":") + 1) : line.slice(line.lastIndexOf("=") + 1);
  return tail.trim() ? 1 : 0;
}

function _unit(
  name: string,
  params: string,
  start_idx: number,
  end_idx: number,
  extra: Partial<MethodUnit> = {},
  body_lines?: number,
): MethodUnit {
  const start_line = start_idx + 1;
  const end_line = end_idx + 1;
  const norm = _normalise_params(params);
  return {
    methodName: name,
    params: norm,
    startLine: start_line,
    endLine: end_line,
    bodyLineCount: body_lines ?? Math.max(0, end_line - start_line - 1),
    signature: extra.returnType ? `${extra.returnType} ${name}(${norm})` : `${name}(${norm})`,
    rangeSource: "regex",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

const _JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "do", "else", "try", "finally", "return", "typeof",
  "new", "delete", "void", "with", "function", "await", "yield", "in", "of", "case", "default",
  "throw", "class", "extends", "import", "export", "from", "as", "instanceof",
]);

const _JS_PATTERNS: Array<[RegExp, "decl" | "assign" | "member"]> = [
  // export default async function* name(args)
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/, "decl"],
  // const name = async (args) => { | const name = function (args) {
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>/, "assign"],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)/, "assign"],
  // const name = arg => {
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/, "assign"],
  // name: (args) => { | name: async function (args) {
  [/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\s*\*?\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>/, "member"],
  [/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\*?\s*\(([^)]*)\)/, "member"],
  // Class field holding a function — the usual React handler / TS service style:
  // `handleClick = (e) => {`, `fetchUser = async (id: string): Promise<U> => {`,
  // `total = () => x`, `legacy = function (a) {`. No const/let/var to key off.
  [/^\s*(?:(?:public|private|protected|static|readonly|override|abstract|declare)\s+)*([A-Za-z_$][\w$]*)\s*[!?]?\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]*)?=>/, "member"],
  [/^\s*(?:(?:public|private|protected|static|readonly|override|abstract|declare)\s+)*([A-Za-z_$][\w$]*)\s*[!?]?\s*=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/, "member"],
  [/^\s*(?:(?:public|private|protected|static|readonly|override|abstract|declare)\s+)*([A-Za-z_$][\w$]*)\s*[!?]?\s*=\s*(?:async\s+)?function\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)/, "member"],
  // class / object method: [static] [async] [get|set] [*] name(args) { — also TS access modifiers
  [/^\s*(?:(?:public|private|protected|static|readonly|override|abstract)\s+)*(?:async\s+)?(?:(?:get|set)\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*[^{;]+)?\{/, "member"],
];

function _extract_js(stripped: string[]): MethodUnit[] {
  const units: MethodUnit[] = [];
  let claimed_until = -1;

  for (let i = 0; i < stripped.length; i++) {
    const [logical, extra] = _logical_line(stripped, i);
    let name = "";
    let params = "";
    let matched_kind: "decl" | "assign" | "member" | "" = "";

    for (const [re, kind] of _JS_PATTERNS) {
      const m = logical.match(re);
      if (m) { name = m[1]; params = (m[2] || "").trim(); matched_kind = kind; break; }
    }
    if (!name || _JS_KEYWORDS.has(name)) continue;
    // A nested function inside an already-claimed body is not its own plan unit.
    if (i <= claimed_until) continue;

    // Expression-bodied arrows (`const f = (x) => x + 1`) have no `{` body — do not
    // scan forward for an unrelated brace (that swallows subsequent real functions).
    const arrow = logical.indexOf("=>");
    const is_expr_arrow = arrow >= 0 && (() => {
      const after = logical.slice(arrow + 2);
      const brace = after.indexOf("{");
      const semi = after.indexOf(";");
      return brace < 0 || (semi >= 0 && semi < brace);
    })();

    let end_idx: number | null;
    let body_lines: number;
    let expression_body = false;
    if (is_expr_arrow) {
      end_idx = i + extra;
      body_lines = _body_line_count(stripped, i, end_idx, "expr");
      expression_body = true;
    } else {
      end_idx = _brace_body_end(stripped, i + extra);
      if (end_idx == null) continue;
      body_lines = _body_line_count(stripped, i, end_idx, "brace");
    }

    units.push(_unit(name, params, i, end_idx, { expressionBody: expression_body || undefined }, body_lines));
    claimed_until = end_idx;
    void matched_kind;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function _extract_go(stripped: string[]): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const [logical, extra] = _logical_line(stripped, i);
    const m = logical.match(/^\s*func\s*(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)/);
    if (!m) continue;
    const end_idx = _brace_body_end(stripped, i + extra);
    if (end_idx == null) continue;
    units.push(_unit(m[1], m[2] || "", i, end_idx, {}, _body_line_count(stripped, i, end_idx, "brace")));
    i = end_idx;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function _indent_block_end(stripped: string[], sig_end: number, indent: number): number {
  let end_idx = sig_end;
  for (let j = sig_end + 1; j < stripped.length; j++) {
    const raw = stripped[j];
    if (!raw.trim()) continue;
    const cur_indent = raw.length - raw.trimStart().length;
    if (cur_indent <= indent) break;
    end_idx = j;
  }
  return end_idx;
}

function _extract_python(stripped: string[]): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const [logical, extra] = _logical_line(stripped, i);
    const m = logical.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (!m) continue;
    const open = logical.indexOf("(", m[0].length - 1);
    const params_raw = _paren_inside(logical, open);
    if (params_raw == null) continue;
    const indent = m[1].length;
    const sig_end = i + extra;
    const end_idx = _indent_block_end(stripped, sig_end, indent);
    units.push(_unit(m[2], params_raw, i, end_idx, {}, _body_line_count(stripped, i, end_idx, "indent")));
    // Nested defs stay inside their parent unit.
    i = end_idx;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

const _JAVA_METHOD_SIG = new RegExp(
  "^\\s*" +
    "(?:public|private|protected|static|final|synchronized|native|abstract|default|@\\w+(?:\\([^)]*\\))?)\\s*" +
    ".*?" +
    "(?:<[\\w\\s,?\\[\\]extends\\s\\w]+>\\s+)?" +
    "([\\w\\[\\]<>?,\\s.]+?)\\s+" +
    "(\\w+)\\s*" +
    "\\(([^)]*)\\)",
);

const _JAVA_CTOR_SIG = new RegExp(
  "^\\s*" +
    "(?:public|private|protected)\\s+" +
    "(\\w+)\\s*" +
    "\\(([^)]*)\\)\\s*" +
    "(?:throws\\s+[\\w,\\s.]+\\s*)?" +
    "\\{",
);

const _JAVA_KEYWORDS = new Set(["if", "while", "for", "switch", "catch", "return", "throw", "new", "assert", "else", "do", "try", "synchronized"]);

function _java_params(raw: string): string {
  const out: string[] = [];
  for (let p of raw.split(",")) {
    p = p.trim();
    if (!p) continue;
    const parts = p.split(/\s+/);
    if (parts.length >= 2) {
      let param_type = parts.slice(0, -1).join(" ").trim();
      param_type = param_type.replace(/<.*?>/g, "").replace(/\bfinal\s+/g, "").replace(/@\w+\s*/g, "").trim();
      out.push(param_type);
    } else if (parts.length) {
      out.push(parts[0].trim());
    }
  }
  return out.join(",");
}

function _extract_java(stripped: string[], file_simple_name: string): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const [logical, extra] = _logical_line(stripped, i);
    const m = logical.match(_JAVA_METHOD_SIG);
    if (m && !_JAVA_KEYWORDS.has(m[2]) && !_JAVA_KEYWORDS.has(m[1].trim())) {
      // The opening brace must appear within a few lines (abstract / interface methods have none).
      const end_idx = _brace_body_end(stripped, i + extra, 5);
      if (end_idx == null) continue;
      units.push(_unit(m[2], _java_params(m[3].trim()), i, end_idx, { returnType: m[1].trim() }, _body_line_count(stripped, i, end_idx, "brace")));
      i = end_idx;
      continue;
    }
    const cm = logical.match(_JAVA_CTOR_SIG);
    if (cm && cm[1] === file_simple_name) {
      // Constructors are skipped as plan units (historical behaviour) but their body is claimed
      // so nested anonymous-class methods are not reported as top-level units.
      const end_idx = _brace_body_end(stripped, i + extra, 5);
      if (end_idx != null) i = end_idx;
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

// fun name(params)[: T] {  |  fun name(params)[: T] = expr  |  fun name(params)  (abstract / brace on next line)
const _KT_FUN = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|open|override|abstract|final|inline|suspend|operator|infix|tailrec|external|actual|expect|const)\s+)*fun\s+(?:<[^>]+>\s+)?(?:[\w.<>?*, ]+\.)?(`[^`]+`|\w+)\s*\(([^)]*)\)\s*(?::\s*[^={]+?)?\s*(?:(\{)|(=)\s*(.*))?\s*$/;

function _expression_body_end(stripped: string[], sig_end: number, indent: number): number {
  // `= expr` bodies: the expression may continue on more-indented lines, or open a brace block.
  const brace_end = stripped[sig_end].includes("{") ? _brace_body_end(stripped, sig_end, 1) : null;
  if (brace_end != null) return brace_end;
  if (/=\s*$/.test(stripped[sig_end]) && sig_end + 1 < stripped.length && stripped[sig_end + 1].includes("{")) {
    const e = _brace_body_end(stripped, sig_end + 1, 1);
    if (e != null) return e;
  }
  return _indent_block_end(stripped, sig_end, indent);
}

function _extract_kotlin(stripped: string[]): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const [logical, extra] = _logical_line(stripped, i);
    const m = logical.match(_KT_FUN);
    if (!m) continue;
    const name = m[1].replace(/`/g, "");
    const sig_end = i + extra;
    const indent = stripped[i].length - stripped[i].trimStart().length;
    let end_idx: number | null;
    let kind: "brace" | "expr" = "brace";
    if (m[3] === "{") {
      end_idx = _brace_body_end(stripped, sig_end, 1);
    } else if (m[4] === "=") {
      const rest = (m[5] || "").trim();
      kind = "expr";
      end_idx = rest.includes("{")
        ? _brace_body_end(stripped, sig_end, 1)
        : rest
          ? _indent_block_end(stripped, sig_end, indent)
          : _expression_body_end(stripped, sig_end, indent);
    } else {
      end_idx = _brace_body_end(stripped, sig_end, 2);
      if (end_idx == null) continue; // abstract / interface fun
    }
    if (end_idx == null) end_idx = sig_end;
    units.push(_unit(name, m[2] || "", i, end_idx, {}, _body_line_count(stripped, i, end_idx, kind)));
    i = end_idx;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Scala
// ---------------------------------------------------------------------------

// def name[T](params)(more)[: T] = expr | = { | { | (abstract)
const _SCALA_DEF = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|protected|override|final|implicit|lazy|inline|transparent)(?:\[[^\]]*\])?\s+)*def\s+([^\s(:=\[]+)\s*(?:\[[^\]]*\])?\s*((?:\([^)]*\)\s*)*)(?::\s*[^={]+?)?\s*(?:(\{.*)|(=)\s*(.*))?$/;

function _extract_scala(stripped: string[]): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const [logical, extra] = _logical_line(stripped, i);
    const m = logical.match(_SCALA_DEF);
    if (!m) continue;
    const sig_end = i + extra;
    const indent = stripped[i].length - stripped[i].trimStart().length;
    let end_idx: number | null;
    let kind: "brace" | "expr" = "brace";
    if (m[3]) {
      end_idx = _brace_body_end(stripped, sig_end, 1);
    } else if (m[4] === "=") {
      const rest = (m[5] || "").trim();
      kind = "expr";
      end_idx = rest.includes("{")
        ? _brace_body_end(stripped, sig_end, 1)
        : rest
          ? _indent_block_end(stripped, sig_end, indent)
          : _expression_body_end(stripped, sig_end, indent);
    } else {
      continue; // abstract def
    }
    if (end_idx == null) end_idx = sig_end;
    const params = (m[2] || "").replace(/^\(|\)$/g, "").replace(/\)\s*\(/g, ",");
    units.push(_unit(m[1], params, i, end_idx, {}, _body_line_count(stripped, i, end_idx, kind)));
    i = end_idx;
  }
  return units;
}

// ---------------------------------------------------------------------------
// C / C++
// ---------------------------------------------------------------------------

const _C_KEYWORDS = new Set([
  "if", "else", "for", "while", "switch", "return", "do", "case", "typedef", "struct", "enum", "union",
  "class", "namespace", "using", "sizeof", "throw", "catch", "new", "delete", "goto", "template", "static_assert",
  "alignas", "alignof", "decltype", "operator", "defined", "define", "include", "pragma", "extern",
]);

// return-type name(params) [const] [noexcept] [override] [-> T] {   |   Ctor::Ctor(params) [: init] {
const _C_FUNC = /^\s*(?!#)((?:[\w:<>,*&\s~]|::)+?)(?:\s+[*&]*|\s*[*&]+)\s*(~?[A-Za-z_][\w]*(?:::~?[A-Za-z_]\w*)*|operator\s*[^\s(]+)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:const\s*)?(?:volatile\s*)?(?:noexcept(?:\([^)]*\))?\s*)?(?:override\s*)?(?:final\s*)?(?:->\s*[\w:<>*&\s]+)?\s*(?::\s*[^{;]*)?(?:\{.*)?$/;
const _C_CTOR = /^\s*([A-Za-z_]\w*(?:::[A-Za-z_~]\w*)+|[A-Za-z_]\w*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::\s*[^{;]*)?(?:\{.*)?$/;

function _extract_c(stripped: string[], file_simple_name: string): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    if (!stripped[i].trim() || /^\s*#/.test(stripped[i])) continue;
    const [logical, extra] = _logical_line(stripped, i);
    let name = "";
    let params = "";
    let ret: string | undefined;
    const m = logical.match(_C_FUNC);
    if (m) {
      const ret_type = m[1].trim();
      const first_word = ret_type.split(/[\s*&<]+/)[0];
      if (!_C_KEYWORDS.has(first_word) && !_C_KEYWORDS.has(m[2]) && !/^(?:return|else|case)\b/.test(ret_type)) {
        name = m[2];
        params = m[3];
        ret = ret_type;
      }
    }
    if (!name) {
      const cm = logical.match(_C_CTOR);
      if (cm) {
        const qual = cm[1];
        const simple = qual.split("::").pop()!.replace(/^~/, "");
        if (qual.includes("::") || simple === file_simple_name) {
          if (!_C_KEYWORDS.has(simple)) { name = qual; params = cm[2]; }
        }
      }
    }
    if (!name) continue;
    if (_declaration_before_brace(stripped, i + extra)) continue; // prototype
    const end_idx = _brace_body_end(stripped, i + extra, 3);
    if (end_idx == null) continue;
    const method_name = name.includes("::") ? name.split("::").pop()! : name;
    units.push(_unit(method_name, params, i, end_idx, ret ? { returnType: ret, signature: `${ret} ${name}(${_normalise_params(params)})` } : { signature: `${name}(${_normalise_params(params)})` }, _body_line_count(stripped, i, end_idx, "brace")));
    i = end_idx;
  }
  return units;
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

const _CS_KEYWORDS = new Set([
  "if", "else", "for", "foreach", "while", "switch", "return", "do", "case", "using", "lock", "catch", "try",
  "throw", "new", "checked", "unchecked", "fixed", "unsafe", "namespace", "class", "struct", "interface", "enum",
  "record", "delegate", "event", "typeof", "nameof", "sizeof", "default", "base", "this", "get", "set", "add", "remove", "init", "yield", "await",
]);

const _CS_METHOD = /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|partial|new|readonly)\s+)*([\w<>\[\],.?()\s]+?)\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:where\s[^{=]*)?(\{|=>)?.*$/;
const _CS_CTOR = /^\s*(?:(?:public|private|protected|internal|static)\s+)+([A-Za-z_]\w*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?::\s*(?:base|this)\s*\([^)]*\)\s*)?(\{|=>)?.*$/;

function _extract_csharp(stripped: string[], file_simple_name: string): MethodUnit[] {
  const units: MethodUnit[] = [];
  for (let i = 0; i < stripped.length; i++) {
    if (!stripped[i].trim()) continue;
    const [logical, extra] = _logical_line(stripped, i);
    let name = "";
    let params = "";
    let ret: string | undefined;
    let opener = "";
    const m = logical.match(_CS_METHOD);
    if (m) {
      const ret_type = m[1].trim();
      const first_word = ret_type.split(/[\s<[(]+/)[0];
      if (!_CS_KEYWORDS.has(first_word) && !_CS_KEYWORDS.has(m[2])) {
        name = m[2]; params = m[3]; ret = ret_type; opener = m[4] || "";
      }
    }
    if (!name) {
      const cm = logical.match(_CS_CTOR);
      if (cm && (cm[1] === file_simple_name || !_CS_KEYWORDS.has(cm[1]))) {
        name = cm[1]; params = cm[2]; opener = cm[3] || "";
      }
    }
    if (!name) continue;

    const sig_end = i + extra;
    let end_idx: number | null;
    if (opener === "=>" || /=>\s*$/.test(logical) || (!opener && /=>/.test(stripped[sig_end + 1] || "") && !/\{/.test(stripped[sig_end + 1] || ""))) {
      // Expression-bodied member: ends at the first `;` at or after the arrow.
      end_idx = sig_end;
      for (let j = sig_end; j < Math.min(stripped.length, sig_end + 12); j++) {
        if (stripped[j].includes(";")) { end_idx = j; break; }
      }
    } else {
      if (_declaration_before_brace(stripped, sig_end, 3)) continue; // interface / abstract member
      end_idx = _brace_body_end(stripped, sig_end, 3);
      if (end_idx == null) continue;
    }
    const cs_kind = (opener === "=>" || /=>/.test(stripped[sig_end] || "")) ? "expr" : "brace";
    units.push(_unit(name, params, i, end_idx, ret ? { returnType: ret } : {}, _body_line_count(stripped, i, end_idx, cs_kind)));
    i = end_idx;
  }
  return units;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Run the regex extractor for `family` over already-stripped lines. */
export function extract_units_from_source(source: string, rel_path: string, family: ExtractFamily): MethodUnit[] {
  const stripped = strip_source(source, family);
  const simple = file_level_method_name(rel_path);
  const lang = language_from_path(rel_path) || undefined;
  let units: MethodUnit[];
  switch (family) {
    case "python": units = _extract_python(stripped); break;
    case "go": units = _extract_go(stripped); break;
    case "java": units = _extract_java(stripped, simple); break;
    case "kotlin": units = _extract_kotlin(stripped); break;
    case "scala": units = _extract_scala(stripped); break;
    case "c": units = _extract_c(stripped, simple); break;
    case "csharp": units = _extract_csharp(stripped, simple); break;
    default: units = _extract_js(stripped);
  }
  for (const u of units) if (lang) u.language = lang;
  return units;
}

export type ExtractOptions = {
  /** Explicit language id (overrides the extension lookup). */
  language?: string | null;
  /** When false, a file with no parseable functions yields [] instead of one file-level unit. */
  fileLevelFallback?: boolean;
};

/**
 * Extract analysis units from one source file.
 *
 * By default a source file always yields at least one unit: when nothing parses
 * (or the language has no parser) the whole file becomes a single file-level
 * unit, so the detection plan and the coverage gate never silently end up empty.
 */
export function extract_units_for_file(abs_path: string, rel_path: string, opts: ExtractOptions = {}): MethodUnit[] {
  let source: string;
  try {
    source = readFileSync(abs_path, "utf8");
  } catch {
    return [];
  }
  const total_lines = source.length ? source.split(/\n/).length : 0;
  const family = family_of_file(rel_path, opts.language);

  let units: MethodUnit[] = [];
  if (family) units = extract_units_from_source(source, rel_path, family);
  if (units.length) return units;
  if (opts.fileLevelFallback === false) return [];

  return [{
    methodName: file_level_method_name(rel_path),
    params: "",
    startLine: 1,
    endLine: Math.max(1, total_lines),
    bodyLineCount: Math.max(0, total_lines - 1),
    signature: `${file_level_method_name(rel_path)}(<file>)`,
    language: language_from_path(rel_path) || undefined,
    fileLevel: true,
    rangeSource: "regex",
  }];
}

/** Units overlapping any changed line range; a file-level unit always counts as changed. */
export function filter_units_by_line_ranges(
  units: MethodUnit[],
  ranges: Array<[number, number]>,
  whole_file = false,
): MethodUnit[] {
  if (whole_file || !ranges.length) return units;
  return units.filter((u) =>
    u.fileLevel || ranges.some(([s, e]) => s <= u.endLine && e >= u.startLine),
  );
}

// ---------------------------------------------------------------------------
// Semgrep-assisted refinement
// ---------------------------------------------------------------------------

/** Semgrep language id for each extractable language (only these are refined). */
const _SEMGREP_LANG: Record<string, string> = {
  java: "java", kotlin: "kotlin", scala: "scala", python: "python", go: "go",
  c: "c", cpp: "cpp", csharp: "csharp", javascript: "javascript", typescript: "typescript",
};

/** Function-definition patterns; `$F` binds the name. One rule per language. */
const _EXTRACT_RULES: Record<string, string[]> = {
  java: ["$RET $F(...) { ... }"],
  kotlin: ["fun $F(...) { ... }", "fun $F(...) = $E", "fun $F(...): $T { ... }", "fun $F(...): $T = $E"],
  scala: ["def $F(...) = $E", "def $F(...): $T = $E", "def $F(...) { ... }"],
  python: ["def $F(...): ...", "async def $F(...): ..."],
  go: ["func $F(...) { ... }", "func ($R) $F(...) { ... }", "func $F(...) $T { ... }", "func ($R) $F(...) $T { ... }"],
  c: ["$RET $F(...) { ... }"],
  cpp: ["$RET $F(...) { ... }", "$RET $C::$F(...) { ... }"],
  csharp: ["$RET $F(...) { ... }", "$RET $F(...) => $E;"],
  javascript: ["function $F(...) { ... }", "$F(...) { ... }", "$F = (...) => { ... }", "const $F = (...) => { ... }", "let $F = (...) => { ... }", "var $F = (...) => { ... }", "$F: (...) => { ... }"],
  typescript: ["function $F(...) { ... }", "$F(...) { ... }", "$F = (...) => { ... }", "const $F = (...) => { ... }", "let $F = (...) => { ... }", "var $F = (...) => { ... }", "$F: (...) => { ... }"],
};

export function semgrep_extract_rules_yaml(languages: Iterable<string>): string {
  const blocks: string[] = [];
  for (const lang of new Set(languages)) {
    const sg = _SEMGREP_LANG[lang];
    const pats = _EXTRACT_RULES[lang];
    if (!sg || !pats) continue;
    blocks.push(
      `  - id: EXTRACT-${lang.toUpperCase()}\n` +
        `    languages: [${sg}]\n` +
        `    severity: INFO\n` +
        `    message: function definition\n` +
        `    pattern-either:\n` +
        pats.map((p) => `      - pattern: ${JSON.stringify(p)}`).join("\n") + "\n",
    );
  }
  return blocks.length ? "rules:\n" + blocks.join("") : "";
}

export type SemgrepUnitRange = { file: string; methodName: string; startLine: number; endLine: number };

/** Parse `semgrep --json` output into per-file function ranges (keeps the outermost span per name+start). */
export function parse_semgrep_extract_output(json_text: string, local_dir: string): Record<string, SemgrepUnitRange[]> {
  const out: Record<string, SemgrepUnitRange[]> = {};
  let data: any;
  try {
    data = JSON.parse(json_text);
  } catch {
    return out;
  }
  const root = to_posix(local_dir).replace(/\/+$/, "") + "/";
  for (const r of data?.results || []) {
    let file = to_posix(String(r.path || ""));
    if (file.startsWith(root)) file = file.slice(root.length);
    const mv = r.extra?.metavars || {};
    const name = String(mv["$F"]?.abstract_content || "").trim();
    const start = Number(r.start?.line || 0);
    const end = Number(r.end?.line || 0);
    if (!file || !name || !start || !end) continue;
    if (!out[file]) out[file] = [];
    // The same definition can match several patterns; keep one entry per (name,start).
    const dup = out[file].find((u) => u.methodName === name && u.startLine === start);
    if (dup) { dup.endLine = Math.max(dup.endLine, end); continue; }
    out[file].push({ file, methodName: name, startLine: start, endLine: end });
  }
  return out;
}

/**
 * Merge Semgrep ranges into regex units for one file:
 *   - same name and overlapping range → adopt the Semgrep range (AST-accurate);
 *   - Semgrep-only definition → add as a new unit;
 *   - regex-only unit → keep untouched.
 * A file-level fallback unit is replaced when Semgrep found real functions.
 */
export function merge_semgrep_units(regex_units: MethodUnit[], sg: SemgrepUnitRange[], language?: string | null): MethodUnit[] {
  if (!sg.length) return regex_units;
  const merged: MethodUnit[] = regex_units.filter((u) => !u.fileLevel).map((u) => ({ ...u }));
  const used = new Set<number>();
  for (const u of merged) {
    const idx = sg.findIndex((s, k) => !used.has(k) && s.methodName === u.methodName && s.startLine <= u.endLine && s.endLine >= u.startLine);
    if (idx < 0) continue;
    used.add(idx);
    const s = sg[idx];
    if (s.startLine !== u.startLine || s.endLine !== u.endLine) {
      u.startLine = s.startLine;
      u.endLine = s.endLine;
      // One-liners (start===end) must count as ≥1 body line so trivial filter
      // does not auto-dismiss them as EMPTY_METHOD.
      u.bodyLineCount = s.endLine <= s.startLine ? 1 : Math.max(0, s.endLine - s.startLine - 1);
      u.rangeSource = "semgrep";
    }
  }
  sg.forEach((s, k) => {
    if (used.has(k)) return;
    // Skip definitions nested inside an already-known unit (inner functions / lambdas).
    if (merged.some((u) => u.startLine <= s.startLine && u.endLine >= s.endLine && u.methodName !== s.methodName)) return;
    merged.push({
      methodName: s.methodName,
      params: "",
      startLine: s.startLine,
      endLine: s.endLine,
      bodyLineCount: s.endLine <= s.startLine ? 1 : Math.max(0, s.endLine - s.startLine - 1),
      signature: `${s.methodName}(...)`,
      language: language || undefined,
      rangeSource: "semgrep",
    });
  });
  merged.sort((a, b) => a.startLine - b.startLine);
  return merged.length ? merged : regex_units;
}

export function semgrep_extraction_enabled(): boolean {
  const flag = String(process.env.DETECTION_EXTRACT_SEMGREP || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(which("semgrep"));
}

/**
 * Run one Semgrep batch over `files` (repo-relative) and return per-file function
 * ranges. Returns {} (and never throws) when Semgrep is missing, disabled, or fails.
 */
export function semgrep_function_ranges(local_dir: string, files: string[], timeout_s = 120): Record<string, SemgrepUnitRange[]> {
  if (!files.length || !semgrep_extraction_enabled()) return {};
  const langs = new Set<string>();
  const targets: string[] = [];
  for (const f of files) {
    const lang = language_from_path(f);
    if (lang && _SEMGREP_LANG[lang]) { langs.add(lang); targets.push(f); }
  }
  if (!targets.length) return {};

  const rules_path = join(scratch_dir("extract"), `extract-${process.pid}-${Date.now()}.yaml`);
  try {
    // A pattern that fails to parse for one language aborts the whole scan, so on a
    // rule error drop the offending languages and retry once.
    for (let attempt = 0; attempt < 2 && langs.size; attempt++) {
      const yaml = semgrep_extract_rules_yaml(langs);
      if (!yaml) return {};
      writeFileSync(rules_path, yaml, "utf8");
      const r = run(
        ["semgrep", "scan", "--config", rules_path, "--json", "--metrics=off", "--quiet", "--no-git-ignore", "--disable-version-check", ...targets],
        { timeout_s, cwd: local_dir },
      );
      if (!r.stdout.trim()) {
        if (r.stderr.trim()) console.error(`[extract] semgrep refinement unavailable: ${r.stderr.trim().slice(0, 200)}`);
        return {};
      }
      const parsed = parse_semgrep_extract_output(r.stdout, local_dir);
      const bad_rules = _failed_rule_ids(r.stdout);
      if (!bad_rules.length || Object.keys(parsed).length) return parsed;
      for (const id of bad_rules) langs.delete(id.replace(/^EXTRACT-/, "").toLowerCase());
      console.error(`[extract] semgrep rejected ${bad_rules.join(", ")}; retrying without them`);
    }
    return {};
  } catch (exc: any) {
    console.error(`[extract] semgrep refinement failed: ${exc?.message || exc}`);
    return {};
  } finally {
    try { unlinkSync(rules_path); } catch { /* ignore */ }
  }
}

function _failed_rule_ids(json_text: string): string[] {
  try {
    const data = JSON.parse(json_text);
    return [...new Set<string>((data?.errors || []).map((e: any) => String(e?.rule_id || "")).filter(Boolean))];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Locating the file behind a className
// ---------------------------------------------------------------------------

function _walk_for_basenames(root: string, wanted: Set<string>, max_depth = 12): string[] {
  const hits: string[] = [];
  const skip = new Set([".git", "node_modules", "target", "build", "dist", "out", ".gradle", ".idea", "vendor", "__pycache__", ".venv", "venv", "bin", "obj"]);
  const walk = (dir: string, depth: number) => {
    if (depth > max_depth) return;
    let ents: import("node:fs").Dirent[];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(join(dir, e.name), depth + 1);
      } else if (wanted.has(e.name)) {
        hits.push(join(dir, e.name));
      }
    }
  };
  walk(root, 0);
  return hits;
}

/**
 * Find the source file a className refers to inside a clone, for any language.
 *
 *   1. `hint` (plan / changed-method filePath) when it exists on disk;
 *   2. `<local_dir>/<className>.<ext>` for every known source extension
 *      (non-JVM classNames are full repo paths, so this is usually a direct hit);
 *   3. a walk for `<SimpleName>.<ext>`, preferring paths that contain the class
 *      path, then `src/main`, then `src/`, then JVM-style roots.
 *
 * Returns the absolute path or null.
 */
export function locate_source_file(local_dir: string, class_name: string, hint?: string | null): string | null {
  if (hint) {
    const abs = join(local_dir, hint);
    if (_is_file(abs)) return abs;
  }
  let class_path = String(class_name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (class_path.includes("$")) class_path = class_path.split("$")[0];
  if (!class_path) return null;

  // Try the name as-is first (path-style stems like `tests/lang.test`), then the
  // FQCN form with dots→slashes (`com.acme.Foo` → `com/acme/Foo`).
  const bases = [class_path];
  if (class_path.includes(".") && !class_path.includes("/")) {
    bases.push(class_path.replace(/\./g, "/"));
  }

  const exts = [...EXTRACTOR_EXTENSIONS, ...Object.values(LANG_TO_EXTENSIONS).flatMap((s) => [...s]), ..._EXTRA_SOURCE_EXTS];
  const seen = new Set<string>();
  for (const base of bases) {
    for (const ext of exts) {
      if (seen.has(base + ext)) continue;
      seen.add(base + ext);
      const abs = join(local_dir, base + ext);
      if (_is_file(abs)) return abs;
    }
  }
  // Dotted FQCN whose last segment is the class but whose file name differs in case? Skip; walk by simple name.
  const simple = class_path.split("/").pop()!.split(".").pop()!;
  const wanted = new Set([...EXTRACTOR_EXTENSIONS, ..._EXTRA_SOURCE_EXTS].map((ext) => simple + ext));
  for (const ext of Object.values(LANG_TO_EXTENSIONS).flatMap((s) => [...s])) wanted.add(simple + ext);
  const hits = _walk_for_basenames(local_dir, wanted).filter((p) => is_source_file(p));
  if (!hits.length) return null;
  const posix = (p: string) => p.replace(/\\/g, "/");
  const score = (p: string): number => {
    const rel = posix(p);
    let s = 0;
    for (const base of bases) {
      if (rel.includes("/" + base + ".") || rel.endsWith(base + _ext_of(rel))) s += 100;
    }
    if (rel.includes("/src/main/")) s += 20;
    else if (rel.includes("/src/")) s += 10;
    if (/\/(test|tests|__tests__|spec)\//.test(rel)) s -= 30;
    if (EXTRACTOR_EXTENSIONS.has(_ext_of(rel))) s += 5;
    return s;
  };
  hits.sort((a, b) => score(b) - score(a) || a.length - b.length);
  return hits[0];
}

function _is_file(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** All extensions that have an extractor (used by callers that filter diff files). */
export const EXTRACTOR_EXTENSIONS: ReadonlySet<string> = new Set(
  ["java", "kotlin", "scala", "javascript", "typescript", "python", "go", "c", "cpp", "csharp"]
    .flatMap((l) => [...(LANG_TO_EXTENSIONS[l] || [])]),
);

export function file_simple_name(rel_path: string): string {
  return file_level_method_name(basename(rel_path));
}
