/**
 * Optional analyzer overlays — a registry of external tools that complement the
 * Semgrep seed pack:
 *
 *   secret  gitleaks                          (any language)
 *   sca     trivy | grype                     (lockfiles / manifests, any language)
 *   native  bandit, gosec, govet, cppcheck,   (per-language linters / analyzers,
 *           eslint, staticcheck, detekt        run only when the language is present)
 *
 * Every tool is optional: a missing binary is reported in `skipped` with a warning
 * and the command still exits 0. Findings share the AST finding shape
 * (`filePath`, `line`, `ruleId`, `message`, `severity`, `inDiff`) so the agent
 * merges them with `run-ast-scan` output. `filePath` always comes from the tool —
 * it is never rewritten to a Java path.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { annotate_findings_in_diff, resolve_ast_scan_scope } from "./ast.ts";
import { canonicalize_language, languages_in_files, language_profile } from "./lang.ts";
import { ContentStore } from "./store.ts";
import { type RunResult, run, to_posix, which } from "./sys.ts";

const SCA_CAP = 50;
const SECRET_CAP = 50;
const NATIVE_CAP = 200;
const SCA_SEVERITIES = new Set(["HIGH", "CRITICAL"]);

export type OverlayKind = "secret" | "sca" | "native";

export type OverlayFinding = {
  filePath: string;
  line: number;
  endLine?: number;
  ruleId: string;
  message: string;
  severity: string;
  tool: string;
  kind: OverlayKind;
  language?: string | null;
  inDiff?: boolean | null;
};

export type OverlayTool = {
  id: string;
  kind: OverlayKind;
  bin: string;
  /** Canonical language ids the tool applies to; null → language independent. */
  languages: string[] | null;
  /** Tools that replace each other (trivy vs grype): only the first available runs. */
  group?: string;
  /** Build the command; `files` are repo-relative paths of the tool's languages. */
  args: (code_dir: string, files: string[]) => string[];
  /** Exit codes that still carry a usable report (linters exit 1 on findings). */
  okExitCodes?: number[];
  parse: (stdout: string, code_dir: string) => OverlayFinding[];
  timeoutSec?: number;
  /** A missing binary is normal for these; keep the warning short. */
  note?: string;
};

/** Test seam: swap tool lookup / execution without binaries on PATH. */
export const overlayHooks = {
  which: (cmd: string): string | null => which(cmd),
  run: (cmd: string[], cwd: string, timeoutSec = 180): RunResult => run(cmd, { cwd, timeout_s: timeoutSec }),
};

function _severity_ok(raw: string): boolean {
  return SCA_SEVERITIES.has(String(raw || "").trim().toUpperCase());
}

function _rel(code_dir: string, file: string): string {
  let p = String(file || "").replace(/\\/g, "/");
  if (isAbsolute(p)) p = relative(code_dir, p);
  return to_posix(p).replace(/^\.\//, "");
}

function _json(raw: string | any): any {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some tools print banners before the JSON document.
    const start = text.indexOf("{");
    const arr = text.indexOf("[");
    const idx = start < 0 ? arr : arr < 0 ? start : Math.min(start, arr);
    if (idx < 0) return null;
    try {
      return JSON.parse(text.slice(idx));
    } catch {
      return null;
    }
  }
}

function _finding(
  tool: string,
  kind: OverlayKind,
  ruleId: string,
  filePath: string,
  line: number,
  message: string,
  severity: string,
  extra: Partial<OverlayFinding> = {},
): OverlayFinding {
  return {
    filePath: String(filePath || "").replace(/\\/g, "/"),
    line: Number(line) || 0,
    ruleId,
    message: String(message || "").trim(),
    severity: String(severity || "MEDIUM").toUpperCase(),
    tool,
    kind,
    ...extra,
  };
}

function _safe_id(s: any): string {
  return String(s ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "-");
}

// ---------------------------------------------------------------------------
// Parsers (exported for tests; each tolerates an empty / non-JSON payload)
// ---------------------------------------------------------------------------

export function parse_gitleaks_json(raw: string | any): OverlayFinding[] {
  const data = _json(raw);
  const rows = Array.isArray(data) ? data : Array.isArray(data?.leaks) ? data.leaks : [];
  const out: OverlayFinding[] = [];
  for (const row of rows) {
    const file = row.File || row.file || row.Path || row.path || "";
    if (!file) continue;
    out.push(_finding(
      "gitleaks", "secret",
      `SECRET-GLEAKS-${_safe_id(row.RuleID || row.ruleId || row.Rule)}`,
      file,
      row.StartLine || row.startLine || row.Line || 0,
      row.Description || row.description || "gitleaks secret",
      "HIGH",
      { endLine: Number(row.EndLine || row.endLine || 0) || undefined },
    ));
    if (out.length >= SECRET_CAP) break;
  }
  return out;
}

export function parse_trivy_json(raw: string | any): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const result of data?.Results || []) {
    const target = result.Target || result.target || "";
    if (!target) continue;
    for (const vuln of result.Vulnerabilities || []) {
      const sev = String(vuln.Severity || vuln.severity || "");
      if (!_severity_ok(sev)) continue;
      const cve = String(vuln.VulnerabilityID || vuln.ID || "unknown");
      out.push(_finding(
        "trivy", "sca", `SCA-TRIVY-${_safe_id(cve)}`, target, 0,
        `${vuln.PkgName || vuln.PkgID || "pkg"} ${vuln.InstalledVersion || ""} ${cve} ${vuln.Title || ""}` +
          (vuln.FixedVersion ? ` (fixed in ${vuln.FixedVersion})` : ""),
        sev,
      ));
      if (out.length >= SCA_CAP) return out;
    }
  }
  return out;
}

export function parse_grype_json(raw: string | any): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const match of data?.matches || []) {
    const sev = String(match?.vulnerability?.severity || "");
    if (!_severity_ok(sev)) continue;
    const locs = match?.artifact?.locations || [];
    let file = String(locs[0]?.path || match?.artifact?.metadata?.virtualPath || match?.artifact?.name || "");
    // Grype often prefixes a leading slash (`/package-lock.json`); normalise for diff matching.
    file = to_posix(file).replace(/^\//, "");
    if (!file) continue;
    const cve = String(match?.vulnerability?.id || "unknown");
    out.push(_finding(
      "grype", "sca", `SCA-GRYPE-${_safe_id(cve)}`, file, 0,
      `${match?.artifact?.name || "pkg"} ${match?.artifact?.version || ""} ${cve}`.trim(),
      sev,
    ));
    if (out.length >= SCA_CAP) break;
  }
  return out;
}

/** bandit -f json */
export function parse_bandit_json(raw: string | any, code_dir = ""): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const r of data?.results || []) {
    if (!r.filename) continue;
    out.push(_finding(
      "bandit", "native", `NATIVE-BANDIT-${_safe_id(r.test_id)}`,
      code_dir ? _rel(code_dir, r.filename) : r.filename,
      r.line_number || 0,
      `${r.test_name || r.test_id}: ${r.issue_text || ""}` + (r.issue_cwe?.id ? ` (CWE-${r.issue_cwe.id})` : ""),
      r.issue_severity || "MEDIUM",
      { language: "python", endLine: Array.isArray(r.line_range) && r.line_range.length ? r.line_range[r.line_range.length - 1] : undefined },
    ));
    if (out.length >= NATIVE_CAP) break;
  }
  return out;
}

/**
 * ruff check --output-format json.
 *
 * ruff also carries hundreds of formatting rules; those are noise in a defect
 * review, so only the correctness / security families are kept (pyflakes `F`,
 * bugbear `B`, bandit-equivalent `S`, syntax `E9`, and the async `ASYNC` set).
 */
const _RUFF_KEEP = /^(?:F|B|S|ASYNC|E9|PLE|RUF0)/;

export function parse_ruff_json(raw: string | any, code_dir = ""): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const r of Array.isArray(data) ? data : []) {
    if (!r.filename) continue;
    const code = String(r.code || "").trim();
    // A null code means a syntax error, which is always worth reporting.
    if (code && !_RUFF_KEEP.test(code)) continue;
    out.push(_finding(
      "ruff", "native", `NATIVE-RUFF-${_safe_id(code || "syntax-error")}`,
      code_dir ? _rel(code_dir, r.filename) : r.filename,
      r.location?.row || 0,
      r.message || code,
      !code || /^(?:F8|S|E9|PLE)/.test(code) ? "HIGH" : "MEDIUM",
      { language: "python", endLine: r.end_location?.row || undefined },
    ));
    if (out.length >= NATIVE_CAP) break;
  }
  return out;
}

/** gosec -fmt json */
export function parse_gosec_json(raw: string | any, code_dir = ""): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const r of data?.Issues || []) {
    if (!r.file) continue;
    const line = parseInt(String(r.line || "0").split("-")[0], 10) || 0;
    out.push(_finding(
      "gosec", "native", `NATIVE-GOSEC-${_safe_id(r.rule_id)}`,
      code_dir ? _rel(code_dir, r.file) : r.file,
      line,
      `${r.details || r.rule_id}` + (r.cwe?.id ? ` (CWE-${r.cwe.id})` : ""),
      r.severity || "MEDIUM",
      { language: "go" },
    ));
    if (out.length >= NATIVE_CAP) break;
  }
  return out;
}

/** go vet -json: `{"pkg": {"analyzer": [{posn, message}]}}` */
export function parse_govet_json(raw: string | any, code_dir = ""): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  if (!data || typeof data !== "object") return out;
  for (const analyzers of Object.values(data as Record<string, any>)) {
    if (!analyzers || typeof analyzers !== "object") continue;
    for (const [analyzer, diags] of Object.entries(analyzers as Record<string, any>)) {
      for (const d of Array.isArray(diags) ? diags : []) {
        const posn = String(d.posn || "");
        const m = posn.match(/^(.*?):(\d+)(?::\d+)?$/);
        if (!m) continue;
        out.push(_finding(
          "govet", "native", `NATIVE-GOVET-${_safe_id(analyzer)}`,
          code_dir ? _rel(code_dir, m[1]) : m[1],
          Number(m[2]) || 0,
          d.message || analyzer,
          "MEDIUM",
          { language: "go" },
        ));
        if (out.length >= NATIVE_CAP) return out;
      }
    }
  }
  return out;
}

/** staticcheck -f json: one JSON object per line */
export function parse_staticcheck_json(raw: string | any, code_dir = ""): OverlayFinding[] {
  const out: OverlayFinding[] = [];
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  for (const line of text.split("\n")) {
    const d = _json(line);
    if (!d || !d.location?.file) continue;
    out.push(_finding(
      "staticcheck", "native", `NATIVE-STATICCHECK-${_safe_id(d.code)}`,
      code_dir ? _rel(code_dir, d.location.file) : d.location.file,
      d.location.line || 0,
      d.message || d.code,
      String(d.severity || "warning").toLowerCase() === "error" ? "HIGH" : "MEDIUM",
      { language: "go", endLine: d.end?.line || undefined },
    ));
    if (out.length >= NATIVE_CAP) break;
  }
  return out;
}

/** cppcheck --template='{file}\t{line}\t{severity}\t{id}\t{message}' (stderr) */
export function parse_cppcheck_template(raw: string, code_dir = ""): OverlayFinding[] {
  const out: OverlayFinding[] = [];
  for (const line of String(raw || "").split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const [file, ln, severity, id, ...msg] = parts;
    if (!file || id === "missingIncludeSystem" || id === "missingInclude") continue;
    const sev = ({ error: "HIGH", warning: "MEDIUM", performance: "LOW", portability: "LOW", style: "LOW", information: "LOW" } as Record<string, string>)[severity] || "MEDIUM";
    out.push(_finding(
      "cppcheck", "native", `NATIVE-CPPCHECK-${_safe_id(id)}`,
      code_dir ? _rel(code_dir, file) : file,
      Number(ln) || 0,
      msg.join("\t"),
      sev,
      { language: /\.(c|h)$/i.test(file) ? "c" : "cpp" },
    ));
    if (out.length >= NATIVE_CAP) break;
  }
  return out;
}

/** eslint -f json */
export function parse_eslint_json(raw: string | any, code_dir = ""): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const file of Array.isArray(data) ? data : []) {
    for (const m of file.messages || []) {
      if (!m.ruleId && !m.fatal) continue;
      const path = code_dir ? _rel(code_dir, file.filePath) : file.filePath;
      out.push(_finding(
        "eslint", "native", `NATIVE-ESLINT-${_safe_id(m.ruleId || "parse-error")}`,
        path,
        m.line || 0,
        m.message || m.ruleId,
        m.severity === 2 || m.fatal ? "HIGH" : "MEDIUM",
        { language: /\.(ts|tsx|mts|cts)$/i.test(path) ? "typescript" : "javascript", endLine: m.endLine || undefined },
      ));
      if (out.length >= NATIVE_CAP) return out;
    }
  }
  return out;
}

/** detekt --report json:<file> is file-based; we accept the SARIF-ish JSON from `--report sarif` too. */
export function parse_detekt_sarif(raw: string | any, code_dir = ""): OverlayFinding[] {
  const data = _json(raw);
  const out: OverlayFinding[] = [];
  for (const run_ of data?.runs || []) {
    for (const r of run_.results || []) {
      const loc = r.locations?.[0]?.physicalLocation;
      const uri = loc?.artifactLocation?.uri;
      if (!uri) continue;
      const path = String(uri).replace(/^file:\/\//, "");
      out.push(_finding(
        "detekt", "native", `NATIVE-DETEKT-${_safe_id(r.ruleId)}`,
        code_dir ? _rel(code_dir, path) : path,
        loc?.region?.startLine || 0,
        r.message?.text || r.ruleId,
        r.level === "error" ? "HIGH" : "MEDIUM",
        { language: "kotlin" },
      ));
      if (out.length >= NATIVE_CAP) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const OVERLAY_TOOLS: OverlayTool[] = [
  {
    id: "gitleaks", kind: "secret", bin: "gitleaks", languages: null,
    args: (code_dir) => ["detect", "--source", code_dir, "--report-format", "json", "--report-path", "/dev/stdout", "--no-git", "--exit-code", "0"],
    okExitCodes: [0, 1],
    parse: (out) => parse_gitleaks_json(out),
  },
  {
    id: "trivy", kind: "sca", bin: "trivy", languages: null, group: "sca",
    args: (code_dir) => ["fs", "--format", "json", "--severity", "HIGH,CRITICAL", "--scanners", "vuln", "--quiet", code_dir],
    parse: (out) => parse_trivy_json(out),
    timeoutSec: 300,
  },
  {
    id: "grype", kind: "sca", bin: "grype", languages: null, group: "sca",
    args: (code_dir) => [`dir:${code_dir}`, "-o", "json", "-q"],
    parse: (out) => parse_grype_json(out),
    timeoutSec: 300,
  },
  {
    id: "bandit", kind: "native", bin: "bandit", languages: ["python"],
    args: (_dir, files) => {
      // Trunk / directory scans need `-r`; a bare `.` without it makes bandit error.
      if (files.length === 1 && (files[0] === "." || files[0].endsWith("/"))) {
        return ["-r", files[0], "-f", "json", "-q"];
      }
      return ["-f", "json", "-q", ...files];
    },
    okExitCodes: [0, 1],
    parse: (out, dir) => parse_bandit_json(out, dir),
  },
  {
    id: "ruff", kind: "native", bin: "ruff", languages: ["python"],
    args: (_dir, files) => ["check", "--output-format", "json", "--quiet", ...files],
    okExitCodes: [0, 1],
    parse: (out, dir) => parse_ruff_json(out, dir),
  },
  {
    id: "gosec", kind: "native", bin: "gosec", languages: ["go"],
    args: () => ["-fmt", "json", "-quiet", "./..."],
    okExitCodes: [0, 1],
    parse: (out, dir) => parse_gosec_json(out, dir),
  },
  {
    id: "govet", kind: "native", bin: "go", languages: ["go"],
    args: () => ["vet", "-json", "./..."],
    okExitCodes: [0, 1, 2],
    parse: (out, dir) => parse_govet_json(out, dir),
    note: "go toolchain",
  },
  {
    id: "staticcheck", kind: "native", bin: "staticcheck", languages: ["go"],
    args: () => ["-f", "json", "./..."],
    okExitCodes: [0, 1],
    parse: (out, dir) => parse_staticcheck_json(out, dir),
  },
  {
    id: "cppcheck", kind: "native", bin: "cppcheck", languages: ["c", "cpp"],
    args: (_dir, files) => ["--quiet", "--enable=warning,performance,portability", "--template={file}\t{line}\t{severity}\t{id}\t{message}", ...files],
    parse: (out, dir) => parse_cppcheck_template(out, dir),
  },
  {
    id: "eslint", kind: "native", bin: "eslint", languages: ["javascript", "typescript"],
    args: (_dir, files) => ["-f", "json", "--no-error-on-unmatched-pattern", ...files],
    okExitCodes: [0, 1],
    parse: (out, dir) => parse_eslint_json(out, dir),
    note: "needs a project eslint config",
  },
  {
    id: "detekt", kind: "native", bin: "detekt", languages: ["kotlin"],
    args: (_dir, files) => ["--input", files.join(","), "--report", "sarif:/dev/stdout"],
    okExitCodes: [0, 1, 2],
    parse: (out, dir) => parse_detekt_sarif(out, dir),
  },
];

export function overlay_tools_for(languages: Iterable<string | null | undefined>, kinds?: Set<OverlayKind>): OverlayTool[] {
  const langs = new Set([...languages].map((l) => canonicalize_language(l)).filter((l) => language_profile(l)));
  return OVERLAY_TOOLS.filter((t) => {
    if (kinds && !kinds.has(t.kind)) return false;
    if (t.languages == null) return true;
    return t.languages.some((l) => langs.has(l));
  });
}

const _OVERLAY_SKIP_DIRS = new Set([".git", "node_modules", "vendor", "dist", "build", "target", "__pycache__", ".venv", "venv"]);

/** Shallow-ish walk for language discovery on trunk scans (capped). */
function _sample_source_files(root: string, cap: number): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length && out.length < cap) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".semgrep-ast-rules.yaml") {
        if (_OVERLAY_SKIP_DIRS.has(name)) continue;
      }
      if (_OVERLAY_SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) out.push(to_posix(relative(root, full)));
      if (out.length >= cap) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type OverlayRunOptions = {
  codeDir: string;
  scanPurpose?: string;
  taskId?: number | null;
  diffFiles?: string[] | null;
  fullRepo?: boolean;
  /** Languages to consider for native tools; default = languages of the diff / repo files. */
  languages?: string[] | null;
  /** Restrict to some kinds (`secret`, `sca`, `native`). */
  kinds?: OverlayKind[] | null;
  /** Restrict to tool ids. */
  tools?: string[] | null;
};

export function run_optional_overlays(opts: OverlayRunOptions): Record<string, any> {
  const skipped: string[] = [];
  const scanned: string[] = [];
  const warnings: string[] = [];
  const tool_errors: Record<string, string> = {};
  let findings: OverlayFinding[] = [];

  let task_diff: string[] = [];
  let task_hunks: Record<string, Array<[number, number]>> = {};
  if (opts.taskId != null) {
    try {
      const diff = new ContentStore(opts.taskId).load_meta_only()?.diff || {};
      const files = diff.files;
      if (Array.isArray(files)) task_diff = files.map((f: any) => String(f || "").trim()).filter(Boolean);
      if (diff.hunks && typeof diff.hunks === "object" && !Array.isArray(diff.hunks)) {
        task_hunks = diff.hunks;
      }
    } catch (e: any) {
      warnings.push(`Could not load diff.files for task ${opts.taskId}: ${e}`);
    }
  }
  const full_repo = Boolean(opts.fullRepo) || String(opts.scanPurpose || "pr").toLowerCase() === "trunk";
  const scope = resolve_ast_scan_scope({
    taskId: opts.taskId ?? null,
    diffFiles: opts.diffFiles || [],
    fullRepo: full_repo,
    taskDiffFiles: task_diff,
  });

  const changed = [...new Set([...(opts.diffFiles || []), ...task_diff])];
  let languages = opts.languages && opts.languages.length ? opts.languages : languages_in_files(changed);
  // Trunk / full-repo with an empty change set: discover languages from the tree so
  // native tools are not silently skipped.
  if (!languages.length && full_repo) {
    const sample = _sample_source_files(opts.codeDir, 2000);
    languages = languages_in_files(sample);
    if (!languages.length) {
      warnings.push("trunk overlay scan: no source languages detected under code-dir; native analyzers skipped");
    }
  }
  const kinds = opts.kinds && opts.kinds.length ? new Set(opts.kinds as OverlayKind[]) : undefined;
  let tools = overlay_tools_for(languages, kinds);
  if (opts.tools && opts.tools.length) {
    const want = new Set(opts.tools);
    tools = tools.filter((t) => want.has(t.id));
  }

  const groups_done = new Set<string>();
  for (const tool of tools) {
    if (tool.group && groups_done.has(tool.group)) continue;
    const bin = overlayHooks.which(tool.bin);
    if (!bin) {
      skipped.push(tool.id);
      continue;
    }
    if (tool.group) groups_done.add(tool.group);

    // Native tools get the changed files of their language (or the whole repo on trunk scans).
    let files: string[] = [];
    if (tool.languages) {
      const exts = new Set(tool.languages.flatMap((l) => [...(language_profile(l)?.extensions || [])]));
      files = full_repo ? [] : changed.filter((f) => exts.has(f.slice(f.lastIndexOf(".")).toLowerCase()) && existsSync(`${opts.codeDir}/${f}`));
      if (!full_repo && !files.length) {
        skipped.push(tool.id);
        warnings.push(`${tool.id}: no changed ${tool.languages.join("/")} files on disk; skipped`);
        continue;
      }
      if (full_repo && tool.args(opts.codeDir, ["x"]).includes("x")) files = ["."];
    }

    scanned.push(tool.id);
    const proc = overlayHooks.run([bin, ...tool.args(opts.codeDir, files)], opts.codeDir, tool.timeoutSec ?? 180);
    const ok_codes = tool.okExitCodes || [0];
    if (proc.error && proc.notFound) {
      skipped.push(tool.id);
      scanned.pop();
      continue;
    }
    if (proc.timedOut) {
      tool_errors[tool.id] = `timed out after ${tool.timeoutSec ?? 180}s`;
      warnings.push(`${tool.id} ${tool_errors[tool.id]}`);
      continue;
    }
    // cppcheck reports on stderr; every other tool on stdout.
    const payload = tool.id === "cppcheck" ? proc.stderr : proc.stdout;
    const parsed = tool.parse(payload, opts.codeDir);
    if (!parsed.length && !ok_codes.includes(proc.returncode)) {
      tool_errors[tool.id] = `exit ${proc.returncode}: ${(proc.stderr || proc.stdout || "").trim().slice(0, 300)}`;
      warnings.push(`${tool.id} ${tool_errors[tool.id]}`);
      continue;
    }
    findings = findings.concat(parsed);
  }

  for (const t of skipped) {
    const spec = OVERLAY_TOOLS.find((x) => x.id === t);
    if (spec && !warnings.some((w) => w.startsWith(`${t}:`))) {
      warnings.push(`${t} not on PATH; skip ${spec.kind} overlay${spec.note ? ` (${spec.note})` : ""}`);
    }
  }

  const annotated = annotate_findings_in_diff(
    findings,
    scope.annotateDiffFiles,
    Object.keys(task_hunks).length ? task_hunks : null,
  ) as OverlayFinding[];
  // SCA hits point at manifests / lockfiles that are rarely in the diff: they stay
  // verify-required unless the scan is a PR scan and the manifest itself is untouched.
  const verify_required = annotated.filter((f) => f.inDiff !== false || f.kind === "sca").length;
  const by_kind: Record<string, number> = {};
  const by_tool: Record<string, number> = {};
  for (const f of annotated) {
    by_kind[f.kind] = (by_kind[f.kind] || 0) + 1;
    by_tool[f.tool] = (by_tool[f.tool] || 0) + 1;
  }

  return {
    languages,
    consideredTools: tools.map((t) => t.id),
    scannedTools: scanned,
    skipped,
    toolErrors: tool_errors,
    findings: annotated,
    totalFindings: annotated.length,
    findingsByKind: by_kind,
    findingsByTool: by_tool,
    verifyRequiredFindings: verify_required,
    dismissibleFindings: annotated.length - verify_required,
    scanMode: scope.scanMode,
    scanPurpose: String(opts.scanPurpose || "pr"),
    warnings,
  };
}

export function cmd_run_optional_overlays(args: Record<string, any>): void {
  const code_dir = args.code_dir;
  if (!code_dir || !existsSync(code_dir)) {
    console.error(`[run-optional-overlays] ⚠️  Code directory missing: ${code_dir || "(empty)"}`);
    console.log(JSON.stringify({ skipped: OVERLAY_TOOLS.map((t) => t.id), scannedTools: [], findings: [], totalFindings: 0 }, null, 2));
    return;
  }

  const parse_list = (raw: any): string[] => {
    if (!raw) return [];
    try {
      if (typeof raw === "string" && existsSync(raw) && !raw.includes(",")) {
        return readFileSync(raw, "utf8").split(/\n/).map((l) => l.trim()).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
    return String(raw).replace(/\n/g, ",").split(",").map((f) => f.trim()).filter(Boolean);
  };

  const result = run_optional_overlays({
    codeDir: code_dir,
    scanPurpose: args.scan_purpose || "pr",
    taskId: args.task_id ?? null,
    diffFiles: parse_list(args.diff_files),
    fullRepo: Boolean(args.full_repo),
    languages: parse_list(args.languages),
    kinds: parse_list(args.kinds) as OverlayKind[],
    tools: parse_list(args.tools),
  });

  for (const w of result.warnings || []) console.error(`[run-optional-overlays] ⚠️  ${w}`);
  console.error(
    `[run-optional-overlays] tools: ran ${result.scannedTools.join(", ") || "none"}; skipped ${result.skipped.join(", ") || "none"}; ` +
      `${result.totalFindings} finding(s)`,
  );
  console.log(JSON.stringify(result, null, 2));
}
