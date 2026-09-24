#!/usr/bin/env python3
"""Deterministic SAST pass for codexqa-code-reviewer.

Invokes Semgrep, Bandit, gosec, gitleaks, osv-scanner, ruff, and eslint when
they are on PATH. Also scans changed sources for pattern classes those tools
own (SSRF, path traversal, pickle, weak hash, float money, and close siblings).

CodexQA stays the primary review engine. This pass does not replace it.
Zero extra CodexQA calls. Missing binaries are recorded and skipped.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import iter_code_lines  # noqa: E402

CODE_EXT = {
    ".py", ".go", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".kts",
    ".php", ".rb", ".cs", ".rs", ".c", ".cc", ".cpp", ".h",
}
MANIFESTS = {
    "pom.xml", "build.gradle", "build.gradle.kts", "package.json",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "go.mod", "go.sum",
    "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock",
    "Cargo.toml", "Cargo.lock",
}

# Pattern classes the deterministic layer owns. LLM candidates that match
# these phrases are dropped in merge-llm-findings.py.
OWNED_CLASSES = (
    "ssrf",
    "path_traversal",
    "pickle",
    "weak_hash",
    "float_money",
    "sqli",
    "command_injection",
    "xss",
    "hardcoded_secret",
    "insecure_tls",
    "bigdecimal_equals",
)

LOCAL_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    ("ssrf", "P1", re.compile(
        r"requests\.(get|post|put|patch|delete|request)\(\s*(request\.|user_|params|url|target|href)",
        re.I)),
    ("ssrf", "P1", re.compile(r"urlopen\(\s*(request|user_|url|target|href)", re.I)),
    ("ssrf", "P1", re.compile(r"new\s+URL\(\s*(?!\"|')")),
    ("ssrf", "P1", re.compile(r"http\.Get\(\s*(?!\"|')")),
    ("path_traversal", "P1", re.compile(r"\.\./")),
    ("path_traversal", "P1", re.compile(r"os\.path\.join\([^)]*request", re.I)),
    ("path_traversal", "P1", re.compile(r"new\s+File\(\s*(?!\"|')")),
    # Java / Kotlin / C# file APIs, plus the same shape in Python, Go, JS, PHP, Ruby.
    ("path_traversal", "P1", re.compile(
        r"(?i)\b(FileOutputStream|FileWriter|Paths\.get|os\.(Open|Create|OpenFile)|"
        r"filepath\.Join|fs\.(readFile|writeFile|readFileSync|writeFileSync)|"
        r"file_get_contents|fopen|File\.(Open|ReadAllText|WriteAllText)|File\.open)\s*\("
        r"[^;\n]*(\+|\.)")),
    ("path_traversal", "P1", re.compile(
        r"(?i)\bopen\s*\(\s*(f[\"']|[^)\n]*(\+|%))")),
    ("pickle", "P1", re.compile(r"pickle\.loads?\(")),
    ("pickle", "P1", re.compile(r"dill\.loads?\(")),
    ("pickle", "P1", re.compile(r"ObjectInputStream")),
    ("weak_hash", "P2", re.compile(r"hashlib\.(md5|sha1)\(")),
    ("weak_hash", "P2", re.compile(
        r"MessageDigest\.getInstance\(\s*[\"'](MD5|SHA-?1)[\"']", re.I)),
    ("weak_hash", "P2", re.compile(r"\bmd5\.New\(\)|\bsha1\.New\(\)")),
    ("float_money", "P2", re.compile(
        r"\b(float|double|Float|Double)\b.{0,48}\b(amount|price|money|fee|balance)\b",
        re.I)),
    ("float_money", "P2", re.compile(
        r"\b(amount|price|money|fee|balance)\b.{0,48}\b(float|double|Float|Double)\b",
        re.I)),
    ("float_money", "P2", re.compile(
        r"parseFloat\([^)]*(amount|price|money|fee|balance)", re.I)),
    ("sqli", "P1", re.compile(
        r"(execute|raw)\(\s*[fF]?[\"'].*SELECT.*\{|execute\(\s*[\"'].*SELECT.*%\s*[s%]?",
        re.I)),
    ("sqli", "P1", re.compile(
        r'(?i)\b(execute(Query|Update)|Exec|QueryRow|Query)\s*\([^)]*(\+|%|f["\'])')),
    ("sqli", "P1", re.compile(
        r"(?i)\b(select|insert|update|delete)\b.{0,180}\+|\b(from|where)\s+[A-Za-z_][\w.]*\b.{0,100}\+")),
    ("sqli", "P1", re.compile(
        r'(?i)(fmt\.Sprintf|mysqli_query|->query|pdo->query)\s*\([^)\n]*["\'`][^"\'`]*\b(select|insert|update|delete)\b')),
    ("command_injection", "P1", re.compile(r"shell\s*=\s*True")),
    ("command_injection", "P1", re.compile(r"os\.system\(\s*(?!\"|')")),
    ("xss", "P1", re.compile(r"dangerouslySetInnerHTML|innerHTML\s*=")),
    ("xss", "P1", re.compile(r"(?i)(\|safe\b|Markup\s*\(|template\.HTML\s*\()")),
    ("xss", "P1", re.compile(
        r'''(?i)(["'`])[^"'`]{0,80}<[^"'`]{0,40}\1\s*(\+|%)''')),
    ("xss", "P1", re.compile(
        r'''(?i)f["'][^"']*<|fmt\.Sprintf\s*\(\s*["'][^"']*<''')),
    ("hardcoded_secret", "P0", re.compile(
        r"""(?i)[A-Za-z0-9_]*(?:password|passwd|secret|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*\s*:?=\s*["'][^"']{8,}["']""")),
    ("hardcoded_secret", "P0", re.compile(
        r"""(?i)["'][^"']*(?:password|passwd|secret|api[_-]?key)[^"']*["']\s*=>\s*["'][^"']{8,}["']""")),
    ("insecure_tls", "P0", re.compile(r"(?i)useSSL\s*=\s*false")),
    ("insecure_tls", "P0", re.compile(
        r"(?i)(rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|"
        r"_create_unverified_context|CERT_NONE|verify\s*=\s*False|"
        r"NODE_TLS_REJECT_UNAUTHORIZED)")),
    ("insecure_tls", "P0", re.compile(
        r"(?i)check(?:Server|Client)Trusted\s*\([^)]*\)\s*\{\s*\}")),
    ("bigdecimal_equals", "P1", re.compile(
        r"(?i)\b[A-Za-z0-9_]*(?:amount|price|money|fee|balance|limit|amt|total|qty|quantity|quota|fare)[A-Za-z0-9_]*\.equals\s*\(\s*(?![\"'])")),
]

CLASS_HINTS: list[tuple[str, re.Pattern[str]]] = [
    ("ssrf", re.compile(r"\bssrf\b|server-side request", re.I)),
    ("path_traversal", re.compile(r"path traversal|path-traversal|路径穿越|目录穿越", re.I)),
    ("pickle", re.compile(r"\bpickle\b|unsafe deserial|ObjectInputStream|不安全反序列化", re.I)),
    ("weak_hash", re.compile(r"weak hash|弱哈希|弱散列|\bmd5\b|\bsha-?1\b", re.I)),
    ("float_money", re.compile(r"float money|浮点金额|浮点数.{0,8}金额|金额.{0,12}浮点", re.I)),
    ("sqli", re.compile(r"\bsqli\b|sql injection|sql注入|sql 注入", re.I)),
    ("command_injection", re.compile(r"command injection|命令注入", re.I)),
    ("xss", re.compile(r"\bxss\b|cross-site scripting|跨站脚本", re.I)),
    ("hardcoded_secret", re.compile(
        r"hardcoded (password|secret|api key)|硬编码.{0,8}(密码|密钥|秘钥)|DB_PASSWORD|SIGN_SECRET", re.I)),
    ("insecure_tls", re.compile(
        r"useSSL\s*=\s*false|insecure.trust.manager|HostnameVerifier|信任所有证书|证书校验", re.I)),
    ("bigdecimal_equals", re.compile(
        r"BigDecimal\.equals|(?:amount|limit).{0,24}\.equals\s*\(|限额.{0,12}equals", re.I)),
]


def classify_text(text: str) -> str:
    blob = text or ""
    for name, rx in CLASS_HINTS:
        if rx.search(blob):
            return name
    return ""


def _dynamic_bins() -> list[str]:
    """Install dirs reported by Python and Go. No absolute toolchain prefix."""
    bins: list[str] = []
    try:
        import site
        import sysconfig

        scripts = sysconfig.get_path("scripts") or ""
        if scripts:
            bins.append(scripts)
        if os.name == "nt":
            user_scheme = "nt_user"
            base_name = "Scripts"
        else:
            user_scheme = "posix_user"
            base_name = "bin"
        user_scripts = sysconfig.get_path("scripts", scheme=user_scheme) or ""
        if user_scripts:
            bins.append(user_scripts)
        user_base = site.getuserbase() or ""
        if user_base:
            bins.append(os.path.join(user_base, base_name))
    except Exception:
        pass
    go = shutil.which("go")
    if go:
        try:
            env = subprocess.check_output(
                [go, "env", "GOBIN", "GOPATH", "GOROOT"],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=8,
            ).splitlines()
            gobin, gopath, goroot = (env + ["", "", ""])[:3]
            if gobin.strip():
                bins.append(gobin.strip())
            for entry in gopath.split(os.pathsep):
                if entry.strip():
                    bins.append(os.path.join(entry.strip(), "bin"))
            if goroot.strip():
                bins.append(os.path.join(goroot.strip(), "bin"))
        except (OSError, subprocess.SubprocessError):
            pass
    return bins


# which() may prepend a discovered bin dir onto PATH. That update stays on the
# main thread; scanner workers only read PATH after prime_tool_path().
_WHICH_LOCK = threading.Lock()


def which(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    with _WHICH_LOCK:
        found = shutil.which(name)
        if found:
            return found
        names = [name]
        if os.name == "nt":
            names.extend([name + ".exe", name + ".cmd", name + ".bat"])
        for d in _dynamic_bins():
            for leaf in names:
                cand = os.path.join(d, leaf)
                if os.path.isfile(cand) and (os.access(cand, os.X_OK) or os.name == "nt"):
                    os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
                    return cand
    return None


def prime_tool_path() -> None:
    """Resolve every scanner on the calling thread before any worker starts."""
    for name in ("semgrep", "bandit", "gosec", "gitleaks", "osv-scanner", "ruff", "eslint"):
        which(name)


def load_paths(pack: Path, mode: str) -> list[str]:
    name = "03-files-sample.json" if mode == "full" else "04-changed-files.json"
    path = pack / name
    if not path.is_file():
        path = pack / "04-changed-files.json"
    if not path.is_file():
        return []
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    nodes = obj
    if isinstance(obj, dict):
        nodes = obj.get("nodes") or obj.get("files") or (obj.get("result") or {}).get("nodes") or []
    out: list[str] = []
    if not isinstance(nodes, list):
        return []
    for n in nodes:
        if isinstance(n, str):
            out.append(n.replace("\\", "/"))
        elif isinstance(n, dict):
            p = n.get("path") or n.get("file") or ""
            if p:
                out.append(str(p).replace("\\", "/"))
    # unique, cap
    seen: set[str] = set()
    uniq: list[str] = []
    for p in out:
        if p in seen:
            continue
        seen.add(p)
        uniq.append(p)
        if mode == "full" and len(uniq) >= 80:
            break
    return uniq


def file_batches(items: list[str], size: int = 40):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def rel_under(repo: Path, raw: str) -> str:
    raw = (raw or "").replace("\\", "/")
    try:
        if raw.startswith(str(repo)):
            return os.path.relpath(raw, repo).replace("\\", "/")
    except ValueError:
        pass
    return raw.lstrip("./")


def run_cmd(cmd: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def hit(
    *,
    file: str,
    line: int,
    title: str,
    severity: str,
    evidence: str,
    adapter: str,
    pattern_class: str = "",
    category: str = "security",
    engine_confidence: str = "",
    engine_flow: bool = False,
) -> dict:
    cls = pattern_class or classify_text(f"{title}\n{evidence}")
    row = {
        "file": file,
        "line": int(line or 1),
        "title": title[:180],
        "category": category,
        "severity": severity,
        "evidence": (evidence or "")[:400],
        "pattern_class": cls,
        "adapter": adapter,
        "source": "sast",
    }
    if engine_confidence:
        row["engine_confidence"] = str(engine_confidence).upper()
    if engine_flow:
        row["engine_flow"] = True
    return row


def local_patterns(repo: Path, files: list[str], hit_limit: int | None = 80) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple] = set()

    def add(rel: str, line: int, cls: str, sev: str, evidence: str) -> None:
        key = (rel, line, cls)
        if key in seen or (hit_limit is not None and len(out) >= hit_limit):
            return
        seen.add(key)
        out.append(hit(
            file=rel, line=line, title=cls, severity=sev,
            evidence=evidence[:240], adapter="pattern", pattern_class=cls,
        ))

    path_ctor = re.compile(
        r"(?i)\b(FileOutputStream|FileWriter|Paths\.get|os\.(Open|Create|OpenFile)|"
        r"filepath\.Join|fs\.(readFile|writeFile|readFileSync|writeFileSync)|"
        r"file_get_contents|fopen|File\.(Open|ReadAllText|WriteAllText)|File\.open|open)\s*\("
    )
    sql_exec_var = re.compile(
        r"(?i)\b(execute(Query|Update)|Exec|QueryRow|Query|execute)\s*\(\s*[A-Za-z_][\w]*\s*\)"
    )
    sql_plus = re.compile(
        r"(?i)\b(select|insert|update|delete)\b.{0,180}(\+|%)|\b(from|where)\s+[A-Za-z_][\w.]*\b.{0,100}\+"
    )
    host_verify = re.compile(
        r"(?i)HostnameVerifier|boolean\s+verify\s*\(|ServerCertificateValidationCallback|"
        r"InsecureSkipVerify|rejectUnauthorized"
    )

    for rel in files:
        if Path(rel).suffix.lower() not in CODE_EXT:
            continue
        full = repo / rel
        if not full.is_file():
            continue
        try:
            lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        code: list[tuple[int, str]] = []
        for idx, _raw, stripped in iter_code_lines(lines):
            if stripped:
                code.append((idx + 1, stripped))
        for i, (lineno, stripped) in enumerate(code):
            for cls, sev, rx in LOCAL_RULES:
                if rx.search(stripped):
                    add(rel, lineno, cls, sev, stripped)
            window_next = "\n".join(t for _, t in code[i:i + 3])
            window_prev = "\n".join(t for _, t in code[max(0, i - 6):i + 1])
            if path_ctor.search(stripped) and "+" in window_next:
                add(rel, lineno, "path_traversal", "P1", stripped)
            if re.search(r"(?i)\b(execute(Query|Update)|Exec|QueryRow)\s*\(", stripped) and re.search(r"\+|%", window_next):
                add(rel, lineno, "sqli", "P1", stripped)
            if sql_exec_var.search(stripped) and sql_plus.search(window_prev):
                add(rel, lineno, "sqli", "P1", stripped)
            if re.search(r"return\s+true\s*;", stripped) and host_verify.search(window_prev):
                add(rel, lineno, "insecure_tls", "P0", stripped)
            if hit_limit is not None and len(out) >= hit_limit:
                return out
    return out


# Fixed registries. Do not combine --metrics=off with --config auto:
# Semgrep refuses to build the auto ruleset when metrics are disabled and
# exits 2 with an empty stdout. p/* packs do not need metrics.
SEMGREP_CONFIGS = ("p/java", "p/security-audit", "p/secrets")


def semgrep_hits_from_results(data: dict, repo: Path | None = None) -> list[dict]:
    out = []
    for res in data.get("results") or []:
        if not isinstance(res, dict):
            continue
        extra = res.get("extra") or {}
        meta = extra.get("metadata") or {}
        sev = {"ERROR": "P1", "WARNING": "P2", "INFO": "P3"}.get(extra.get("severity") or "", "P2")
        path = res.get("path") or ""
        if repo is not None:
            path = rel_under(repo, path)
        out.append(hit(
            file=path,
            line=(res.get("start") or {}).get("line") or 1,
            title=res.get("check_id") or "semgrep",
            severity=sev,
            evidence=extra.get("message") or "",
            adapter="semgrep",
            engine_confidence=str(meta.get("confidence") or ""),
            engine_flow=bool(extra.get("dataflow_trace")),
        ))
    return out


def classify_semgrep_run(
    returncode: int | None,
    stdout: str,
    stderr: str,
    repo: Path | None = None,
) -> tuple[list[dict], dict]:
    """Map a Semgrep invocation to findings plus a tool record.

    status=ran only when the process exited 0 or 1, stdout is a JSON object
    that contains a results array, and errors is empty. That is a finished
    ruleset load. An empty results array is then a real no-hit scan.
    Any other outcome is status=error and keeps stderr. Parsed results are
    still returned when present so a partial payload is not discarded, but
    rules_loaded stays false and callers must not treat the scan as clean.
    """
    info: dict = {
        "returncode": returncode,
        "configs": list(SEMGREP_CONFIGS),
        "rules_loaded": False,
        "stderr": (stderr or "")[:1500],
        "status": "error",
    }
    if returncode is None:
        if not info["stderr"]:
            info["stderr"] = "semgrep timed out or failed to start"
        return [], info
    text = (stdout or "").strip()
    if not text:
        if not info["stderr"]:
            info["stderr"] = "semgrep produced no JSON on stdout"
        return [], info
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        if not info["stderr"]:
            info["stderr"] = "semgrep stdout was not JSON"
        return [], info
    if not isinstance(data, dict) or "results" not in data:
        if not info["stderr"]:
            info["stderr"] = "semgrep JSON has no results array"
        return [], info
    hits = semgrep_hits_from_results(data, repo)
    errors = data.get("errors") or []
    if errors and not info["stderr"]:
        info["stderr"] = json.dumps(errors, ensure_ascii=False)[:1500]
    scanned = (data.get("paths") or {}).get("scanned") if isinstance(data.get("paths"), dict) else None
    if errors or returncode not in (0, 1):
        return hits, info
    if isinstance(scanned, list) and len(scanned) == 0:
        if not info["stderr"]:
            info["stderr"] = "semgrep JSON listed no scanned paths"
        return hits, info
    info["status"] = "ran"
    info["rules_loaded"] = True
    return hits, info


def parse_semgrep(repo: Path, files: list[str]) -> tuple[list[dict], str, dict]:
    bin_path = which("semgrep")
    if not bin_path:
        return [], "missing", {}
    targets = [f for f in files if Path(f).suffix.lower() in CODE_EXT]
    if not targets:
        return [], "skipped_no_files", {}
    hits: list[dict] = []
    info: dict = {"status": "error", "rules_loaded": False, "stderr": "", "configs": list(SEMGREP_CONFIGS)}
    any_ran = False
    for chunk in file_batches(targets, 40):
        cmd = [
            bin_path, "scan", "--json", "--quiet", "--metrics=off",
            "--disable-version-check", "--timeout", "15",
        ]
        for cfg in SEMGREP_CONFIGS:
            cmd.extend(["--config", cfg])
        cmd.extend(chunk)
        proc = run_cmd(cmd, repo, 90)
        if proc is None:
            batch_hits, batch_info = classify_semgrep_run(None, "", "")
        else:
            batch_hits, batch_info = classify_semgrep_run(
                proc.returncode, proc.stdout or "", proc.stderr or "", repo)
        hits.extend(batch_hits)
        info = batch_info
        if batch_info.get("status") == "ran":
            any_ran = True
    if any_ran:
        info["status"] = "ran"
        info["rules_loaded"] = True
        return hits, "ran", info
    return hits, str(info.get("status") or "error"), info


def parse_bandit(repo: Path, files: list[str]) -> tuple[list[dict], str]:
    bin_path = which("bandit")
    if not bin_path:
        return [], "missing"
    py = [f for f in files if f.endswith(".py")]
    if not py:
        return [], "skipped_no_files"
    out = []
    any_ran = False
    for chunk in file_batches(py, 40):
        proc = run_cmd([bin_path, "-f", "json", "-q", *chunk], repo, 40)
        if proc is None:
            continue
        try:
            data = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError:
            continue
        any_ran = True
        for res in data.get("results") or []:
            sev = {"HIGH": "P1", "MEDIUM": "P2", "LOW": "P3"}.get(
                (res.get("issue_severity") or "MEDIUM").upper(), "P2")
            out.append(hit(
                file=rel_under(repo, res.get("filename") or ""),
                line=int(res.get("line_number") or 1),
                title=res.get("test_id") or "bandit",
                severity=sev,
                evidence=res.get("issue_text") or "",
                adapter="bandit",
                engine_confidence=str(res.get("issue_confidence") or ""),
            ))
    return out, "ran" if any_ran else "error"


def parse_gosec(repo: Path, files: list[str]) -> tuple[list[dict], str]:
    bin_path = which("gosec")
    if not bin_path:
        return [], "missing"
    go = [f for f in files if f.endswith(".go")]
    if not go:
        return [], "skipped_no_files"
    out = []
    any_ran = False
    for chunk in file_batches(go, 40):
        proc = run_cmd([bin_path, "-fmt=json", "-quiet", *chunk], repo, 40)
        if proc is None:
            continue
        raw = proc.stdout or ""
        start = raw.find("{")
        if start < 0:
            continue
        try:
            data = json.loads(raw[start:])
        except json.JSONDecodeError:
            continue
        any_ran = True
        for res in data.get("Issues") or data.get("issues") or []:
            sev = {"HIGH": "P1", "MEDIUM": "P2", "LOW": "P3"}.get(
                (res.get("severity") or "MEDIUM").upper(), "P2")
            out.append(hit(
                file=rel_under(repo, res.get("file") or ""),
                line=int(res.get("line") or 1),
                title=res.get("rule_id") or "gosec",
                severity=sev,
                evidence=res.get("details") or "",
                adapter="gosec",
                engine_confidence=str(res.get("confidence") or ""),
            ))
    return out, "ran" if any_ran else "error"


def parse_gitleaks(repo: Path, files: list[str]) -> tuple[list[dict], str]:
    bin_path = which("gitleaks")
    if not bin_path:
        return [], "missing"
    proc = run_cmd([
        bin_path, "detect", "--source", str(repo), "--no-git",
        "--report-format", "json", "--report-path", "-",
    ], repo, 40)
    if proc is None:
        return [], "error"
    text = (proc.stdout or "").strip() or "[]"
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return [], "error"
    if isinstance(data, dict):
        data = data.get("findings") or data.get("leaks") or []
    allow = set(files)
    out = []
    for leak in data or []:
        fpath = rel_under(repo, leak.get("File") or leak.get("file") or "")
        if allow and fpath and fpath not in allow and not any(fpath.endswith(p) or p.endswith(fpath) for p in allow):
            continue
        out.append(hit(
            file=fpath,
            line=int(leak.get("StartLine") or leak.get("line") or 1),
            title=leak.get("RuleID") or "gitleaks",
            severity="P0",
            evidence=leak.get("Description") or "secret detected",
            adapter="gitleaks",
            pattern_class="hardcoded_secret",
            category="security",
        ))
    return out[:40], "ran"


def parse_osv(repo: Path, files: list[str]) -> tuple[list[dict], str]:
    bin_path = which("osv-scanner")
    if not bin_path:
        return [], "missing"
    manifests = [f for f in files if Path(f).name in MANIFESTS]
    targets = [str(repo / m) for m in manifests if (repo / m).is_file()]
    if not targets:
        # still record that the tool exists; do not walk the whole repo
        return [], "skipped_no_files"
    proc = run_cmd([bin_path, "--format", "json", *targets[:20]], repo, 60)
    if proc is None:
        return [], "error"
    raw = (proc.stdout or "").strip()
    if not raw:
        return [], "ran"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [], "error"
    out = []
    for res in data.get("results") or []:
        src = (res.get("source") or {}).get("path") or "dependencies"
        path = rel_under(repo, src)
        for pkg in res.get("packages") or []:
            for vuln in pkg.get("vulnerabilities") or []:
                out.append(hit(
                    file=path, line=1,
                    title=vuln.get("id") or "OSV",
                    severity="P1",
                    evidence=(vuln.get("summary") or vuln.get("details") or "")[:400],
                    adapter="osv-scanner",
                    category="dependencies",
                ))
                if len(out) >= 40:
                    return out, "ran"
    return out, "ran"


def parse_ruff(repo: Path, files: list[str]) -> tuple[list[dict], list[dict], str]:
    bin_path = which("ruff")
    if not bin_path:
        return [], [], "missing"
    py = [f for f in files if f.endswith(".py")]
    if not py:
        return [], [], "skipped_no_files"
    findings, notes = [], []
    any_ran = False
    for chunk in file_batches(py, 40):
        proc = run_cmd([bin_path, "check", "--output-format", "json", *chunk], repo, 30)
        if proc is None:
            continue
        try:
            data = json.loads(proc.stdout or "[]")
        except json.JSONDecodeError:
            continue
        any_ran = True
        for it in data if isinstance(data, list) else []:
            code = str(it.get("code") or "ruff")
            item = hit(
                file=rel_under(repo, it.get("filename") or ""),
                line=(it.get("location") or {}).get("row") or 1,
                title=code,
                severity="P2",
                evidence=it.get("message") or "",
                adapter="ruff",
                category="security" if code.startswith("S") else "hygiene",
            )
            if code.startswith("S"):
                findings.append(item)
            else:
                notes.append(item)
    return findings, notes, "ran" if any_ran else "error"


def parse_eslint(repo: Path, files: list[str]) -> tuple[list[dict], list[dict], str]:
    bin_path = which("eslint")
    if not bin_path:
        return [], [], "missing"
    js = [f for f in files if Path(f).suffix.lower() in {".js", ".jsx", ".ts", ".tsx"}]
    if not js:
        return [], [], "skipped_no_files"
    proc = run_cmd([bin_path, "-f", "json", *js[:30]], repo, 40)
    if proc is None:
        return [], [], "error"
    try:
        data = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return [], [], "error"
    findings, notes = [], []
    sec = re.compile(r"security|xss|eval|injection|ssrf", re.I)
    for file_res in data if isinstance(data, list) else []:
        fpath = rel_under(repo, file_res.get("filePath") or "")
        for msg in file_res.get("messages") or []:
            rule = str(msg.get("ruleId") or "eslint")
            item = hit(
                file=fpath, line=msg.get("line") or 1, title=rule,
                severity="P2" if msg.get("severity") == 2 else "P3",
                evidence=msg.get("message") or "",
                adapter="eslint",
                category="security" if sec.search(rule + (msg.get("message") or "")) else "hygiene",
            )
            if item["category"] == "security":
                findings.append(item)
            else:
                notes.append(item)
            if len(findings) + len(notes) >= 40:
                return findings, notes, "ran"
    return findings, notes, "ran"


# Pattern classes each external scanner can cover when it actually runs
# on the files in this pack. skipped_no_files does not cover anything.
# The local pattern adapter is not listed: a regex miss must not look like
# a finished ruleset scan.
TOOL_PATTERN_CLASSES = {
    "semgrep": OWNED_CLASSES,
    "bandit": ("ssrf", "pickle", "weak_hash", "sqli", "command_injection", "hardcoded_secret"),
    "gosec": ("ssrf", "path_traversal", "weak_hash", "sqli", "command_injection", "hardcoded_secret"),
    "gitleaks": ("hardcoded_secret",),
    "ruff": ("weak_hash", "sqli", "hardcoded_secret"),
    "eslint": ("xss", "command_injection"),
    "osv": (),
}


# Paths that never reach the model or the report.
_EXCLUDED_PATH = re.compile(
    r"(^|/)(test|tests|__tests__|spec|generated|gen|vendor|node_modules|dist)(/|$)",
    re.I,
)
_EXCLUDED_FILE = re.compile(
    r"(^|/)(test_.*|.*_test\.go|.*\.generated\.[A-Za-z0-9]+|.*\.pb\.go)$",
    re.I,
)
_SINK = re.compile(
    r"execute|query|write|notify|update|insert|delete|open\s*\(|File\s*\(|"
    r"innerHTML|md5|sha-?1|password|secret|useSSL|equals\s*\(|shell\s*=|"
    r"pickle\.|urlopen|requests\.|TrustManager|HostnameVerifier|double|float",
    re.I,
)
_NAME_ONLY = re.compile(
    r"\b(getUserId|getUserID|View\.get\w*|Ext\.get\w*)\b",
)
_SANITIZER = {
    "sqli": re.compile(r"PreparedStatement|prepareStatement|bind_param|\?"),
    "xss": re.compile(r"html\.escape|encodeURI|textContent|htmlEscape|escapeHtml", re.I),
    "command_injection": re.compile(r"shell\s*=\s*False|shlex\.quote"),
    "path_traversal": re.compile(r"\bnormalize\b|startsWith|Path\.get\("),
    "hardcoded_secret": re.compile(r"changeme|placeholder|example\.com|TODO", re.I),
    "ssrf": re.compile(r"allowlist|allow_list|isAllowedHost", re.I),
}
SLICE_RADIUS = 40
SLICE_MAX = 4000

# Short policy for a suspect packet. One positive and one negative example.
# Identifiers are roles, not a sample project.
CLASS_POLICY = {
    "ssrf": {
        "look_for": "A caller-controlled URL reaches a server-side fetch.",
        "do_not_report": "The host is checked against an allowlist before the fetch.",
        "fix": "Allowlist the host before opening the connection.",
        "noncompliant": "fetch(request.getParameter(\"url\"))",
        "compliant": "if allowlist.contains(host): fetch(url)",
    },
    "path_traversal": {
        "look_for": "A caller-controlled path is opened or written.",
        "do_not_report": "The normalized path is forced to stay under a base directory.",
        "fix": "Normalize the path and reject values that escape the base directory.",
        "noncompliant": "new File(base, request.getParameter(\"name\"))",
        "compliant": "if normalized.startsWith(base): open(normalized)",
    },
    "pickle": {
        "look_for": "Untrusted bytes are deserialized with a pickle-like loader.",
        "do_not_report": "The bytes come from a trusted local cache, not a request.",
        "fix": "Refuse untrusted bytes or use a safe parser.",
        "noncompliant": "pickle.loads(request.body)",
        "compliant": "json.loads(request.body)",
    },
    "weak_hash": {
        "look_for": "MD5 or SHA-1 is used as a signature or password hash.",
        "do_not_report": "The digest is a non-security checksum of public data.",
        "fix": "Use HMAC-SHA256 for a signature.",
        "noncompliant": "MessageDigest.getInstance(\"MD5\").digest(secret + body)",
        "compliant": "Mac.getInstance(\"HmacSHA256\").doFinal(body)",
    },
    "float_money": {
        "look_for": "A money amount is computed with float or double.",
        "do_not_report": "The float is a display metric, not a posted amount.",
        "fix": "Compute money with an integer or decimal type and an explicit rounding mode.",
        "noncompliant": "fee = amount.doubleValue() * rate",
        "compliant": "fee = amount.multiply(rate).setScale(2, HALF_UP)",
    },
    "sqli": {
        "look_for": "A caller-controlled value is concatenated into SQL that is executed.",
        "do_not_report": "The value is bound on a prepared statement.",
        "fix": "Bind the value; do not concatenate it.",
        "noncompliant": "execute(\"SELECT * FROM t WHERE id = '\" + id + \"'\")",
        "compliant": "prepareStatement(\"SELECT * FROM t WHERE id = ?\").setString(1, id)",
    },
    "command_injection": {
        "look_for": "A caller-controlled string is passed to a shell.",
        "do_not_report": "Arguments are passed as a list with shell disabled.",
        "fix": "Pass an argument list and disable the shell.",
        "noncompliant": "os.system(request.args[\"cmd\"])",
        "compliant": "subprocess.run([\"cmd\", arg], shell=False)",
    },
    "xss": {
        "look_for": "Caller-controlled text is written into HTML or a DOM sink.",
        "do_not_report": "The text is escaped for the HTML context first.",
        "fix": "Escape text before inserting it into HTML.",
        "noncompliant": "html.append(\"<p>\" + request.getRemark() + \"</p>\")",
        "compliant": "html.append(\"<p>\" + escapeHtml(request.getRemark()) + \"</p>\")",
    },
    "hardcoded_secret": {
        "look_for": "A password, token, or API key is a source literal.",
        "do_not_report": "The literal is an empty placeholder or a documented example.",
        "fix": "Read the secret from a secret store or the environment.",
        "noncompliant": "password = \"production-secret-value\"",
        "compliant": "password = System.getenv(\"DB_PASSWORD\")",
    },
    "insecure_tls": {
        "look_for": "Certificate or hostname checks are disabled.",
        "do_not_report": "The disable is behind a test-only flag that cannot run in production.",
        "fix": "Use the platform trust store and check hostnames.",
        "noncompliant": "checkServerTrusted(...) { } and useSSL=false",
        "compliant": "SSLContext.getInstance(\"TLSv1.2\") with the default trust manager",
    },
    "bigdecimal_equals": {
        "look_for": "A money or limit comparison uses equals, so scale changes the result.",
        "do_not_report": "equals is combined with compareTo so equal numeric values are handled.",
        "fix": "Compare with compareTo after normalizing scale.",
        "noncompliant": "if (amount.equals(limit)) reject",
        "compliant": "if (amount.compareTo(limit) >= 0) reject",
    },
}


def excluded_path(path: str) -> bool:
    rel = (path or "").replace("\\", "/")
    return bool(_EXCLUDED_PATH.search(rel) or _EXCLUDED_FILE.search(rel))


def line_window(repo: Path, rel: str, line: int, radius: int = 2) -> str:
    path = repo / rel if repo else Path()
    if not path.is_file():
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return ""
    start = max(0, line - 1 - radius)
    end = min(len(lines), line + radius)
    return "\n".join(lines[start:end])


def read_slice(repo: Path, rel: str, line: int) -> tuple[int, int, str]:
    path = repo / rel if repo else Path()
    if not path.is_file():
        return line, line, ""
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return line, line, ""
    start = max(1, line - SLICE_RADIUS)
    end = min(len(lines), line + SLICE_RADIUS)
    chunk = [f"{n}|{lines[n - 1]}" for n in range(start, end + 1)]
    blob = "\n".join(chunk)
    if len(blob) > SLICE_MAX:
        blob = blob[:SLICE_MAX] + "\n…"
    return start, end, blob


def has_sanitizer(cls: str, text: str) -> bool:
    rx = _SANITIZER.get(cls)
    return bool(rx and rx.search(text or ""))


def is_name_only(text: str) -> bool:
    blob = text or ""
    if _NAME_ONLY.search(blob) and not _SINK.search(blob):
        return True
    stripped = blob.strip()
    if re.fullmatch(r"[\w.]+\s*\(\s*\)", stripped) and not _SINK.search(stripped):
        return True
    return False


# The finding is the sink. Do not send these to the model for lack of a keyword.
_STRUCTURAL = {
    "hardcoded_secret",
    "weak_hash",
    "insecure_tls",
    "pickle",
    "float_money",
    "bigdecimal_equals",
}
# Source-to-sink classes. A name-only hit stays suspect; a visible sink is report.
_FLOW = {"sqli", "xss", "command_injection", "path_traversal", "ssrf"}


def triage_finding(finding: dict, repo: Path) -> str:
    """report, drop, or suspect. Certain hits skip the model.

    Dependency alerts and secret-scanner hits are not code-flow suspects.
    A taint engine that already recorded a flow is report. Low engine
    confidence and name-only matches stay suspect.
    """
    rel = str(finding.get("file") or "")
    if excluded_path(rel):
        return "drop"
    adapter = str(finding.get("adapter") or "")
    category = str(finding.get("category") or "")
    if adapter == "osv-scanner" or category == "dependencies":
        return "report"
    cls = str(finding.get("pattern_class") or "")
    evidence = " ".join(
        str(finding.get(k) or "") for k in ("title", "evidence")
    )
    window = line_window(repo, rel, int(finding.get("line") or 1))
    if has_sanitizer(cls, evidence) or has_sanitizer(cls, window):
        return "drop"
    if adapter == "gitleaks":
        return "report"
    if finding.get("engine_flow"):
        return "report"
    conf = str(finding.get("engine_confidence") or "").upper()
    if conf == "LOW" or is_name_only(evidence):
        return "suspect"
    if adapter == "pattern" or cls in _STRUCTURAL:
        return "report"
    if cls in _FLOW and _SINK.search(evidence):
        return "report"
    if conf == "HIGH" and _SINK.search(evidence):
        return "report"
    if cls in _FLOW or not cls:
        return "suspect"
    return "report"


def apply_triage(findings: list[dict], repo: Path) -> tuple[list[dict], list[dict], dict]:
    suspects: list[dict] = []
    counts = {"report": 0, "drop": 0, "suspect": 0}
    for finding in findings:
        disposition = triage_finding(finding, repo)
        adapter = str(finding.get("adapter") or "")
        category = str(finding.get("category") or "")
        if adapter == "osv-scanner" or category == "dependencies":
            finding["triage_channel"] = "sca"
        else:
            finding["triage_channel"] = "sast"
        finding["disposition"] = disposition
        finding["skip_llm"] = disposition != "suspect"
        counts[disposition] = counts.get(disposition, 0) + 1
        if disposition != "suspect" or finding["triage_channel"] != "sast":
            continue
        rel = str(finding.get("file") or "")
        line = int(finding.get("line") or 1)
        cls = str(finding.get("pattern_class") or "")
        start, end, blob = read_slice(repo, rel, line)
        sid = f"{cls}:{rel}:{line}"
        finding["suspect_id"] = sid
        policy = dict(CLASS_POLICY.get(cls) or {
            "look_for": "The matched line is a real defect of this class.",
            "do_not_report": "A guard on this path already prevents the defect.",
            "fix": "Add the missing guard before the sink.",
            "noncompliant": "sink(untrusted)",
            "compliant": "if guarded: sink(value)",
        })
        suspects.append({
            "suspect_id": sid,
            "file": rel,
            "line": line,
            "pattern_class": cls,
            "slice_start": start,
            "slice_end": end,
            "slice": blob,
            "policy": policy,
        })
    return findings, suspects, counts


def build_llm_report_policy(tools: dict, findings: list) -> dict:
    """Per-class record kept for older readers. Not a license to rescan.

    allow — a responsible tool is missing or errored. Record the gap.
            Do not send the class to the model for a fresh search.
    suppress_obvious — scanners ran and reported zero hits. Do not re-file
            an obvious hit of this class.
    dedupe_loci — hits exist. Certain rows are reported directly. Only rows
            triaged as suspect are eligible for the model, and only via suspects[].
    """
    policy = {}
    for cls in OWNED_CLASSES:
        owners = [name for name, classes in TOOL_PATTERN_CLASSES.items() if cls in classes]
        applicable = []
        for name in owners:
            info = tools.get(name) or {}
            status = info.get("status")
            if status in (None, "", "skipped_no_files", "present_unscoped"):
                continue
            applicable.append(name)
        if not applicable:
            policy[cls] = {
                "action": "allow",
                "reason": "no scanner applied to these files for this class",
            }
            continue
        blocked = []
        for name in applicable:
            info = tools.get(name) or {}
            status = info.get("status")
            if status in ("error", "missing"):
                blocked.append(f"{name}:{status}")
            elif "rules_loaded" in info and not info.get("rules_loaded"):
                blocked.append(f"{name}:rules_not_loaded")
        if blocked:
            policy[cls] = {
                "action": "allow",
                "reason": "scanner did not finish: " + ", ".join(blocked),
            }
            continue
        hits = [f for f in findings if (f.get("pattern_class") or "") == cls]
        if hits:
            policy[cls] = {
                "action": "dedupe_loci",
                "reason": f"{len(hits)} hit(s) already filed; do not open a second card on the same file and line",
                "hit_count": len(hits),
            }
        else:
            policy[cls] = {
                "action": "suppress_obvious",
                "reason": "applicable scanners ran with rules loaded and reported 0 hits of this class",
                "hit_count": 0,
            }
    return policy


# External scanners do not write the evidence pack. Each returns hits in memory.
# The parent merges them in this order and writes 23-sast-signals.json once.
EXTERNAL_SCANNERS = (
    "semgrep",
    "bandit",
    "gosec",
    "gitleaks",
    "osv",
    "ruff",
    "eslint",
)


def scanner_fn(name: str):
    return {
        "semgrep": parse_semgrep,
        "bandit": parse_bandit,
        "gosec": parse_gosec,
        "gitleaks": parse_gitleaks,
        "osv": parse_osv,
        "ruff": parse_ruff,
        "eslint": parse_eslint,
    }[name]


def run_external_scanners(repo: Path, files: list[str]) -> list[tuple[str, object]]:
    """Run the seven scanners concurrently. Return results in EXTERNAL_SCANNERS order.

    Workers only read the repo and return Python objects. They do not open the
    evidence pack. A scanner exception is re-raised after every worker has
    finished, and the caller must not write the pack file in that case.
    """
    prime_tool_path()
    errors: list[BaseException] = []
    with ThreadPoolExecutor(max_workers=len(EXTERNAL_SCANNERS)) as pool:
        futures = [
            pool.submit(scanner_fn(name), repo, files) for name in EXTERNAL_SCANNERS
        ]
        results: list[tuple[str, object]] = []
        for name, future in zip(EXTERNAL_SCANNERS, futures):
            try:
                results.append((name, future.result()))
            except BaseException as exc:  # noqa: BLE001 — re-raised after the pool drains
                errors.append(exc)
    if errors:
        raise errors[0]
    return results


def consume_scanner_result(
    name: str,
    parsed: object,
    findings: list[dict],
    lint_notes: list[dict],
    tools: dict[str, dict],
) -> None:
    if name == "semgrep":
        hits, status, extra = parsed  # type: ignore[misc]
        tools[name] = {"status": status, "finding_count": len(hits), **extra}
        findings.extend(hits)
        return
    if name in ("ruff", "eslint"):
        hits, notes, status = parsed  # type: ignore[misc]
        findings.extend(hits)
        lint_notes.extend(notes)
        tools[name] = {
            "status": status,
            "finding_count": len(hits),
            "lint_note_count": len(notes),
        }
        return
    hits, status = parsed  # type: ignore[misc]
    tools[name] = {"status": status, "finding_count": len(hits)}
    findings.extend(hits)


def write_json_atomic(path: Path, doc: dict) -> None:
    """Write one JSON document by rename. A crash cannot leave a half file at path."""
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def dedupe(items: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    out = []
    for it in items:
        key = (it.get("file"), it.get("line"), it.get("pattern_class") or it.get("title"), it.get("adapter"))
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit("usage: _sast_body.py <pack> <repo> <mode>")
    pack = Path(sys.argv[1])
    repo = Path(sys.argv[2]) if sys.argv[2] else Path()
    mode = sys.argv[3] or "pr"
    from _identical_copies import expand_mirrored_hits, narrow_scan

    files = load_paths(pack, mode)
    findings: list[dict] = []
    lint_notes: list[dict] = []
    tools: dict[str, dict] = {}
    mirrors: dict[str, list[str]] = {}
    if repo.is_dir() and files:
        files, mirrors = narrow_scan(repo, files)
        findings.extend(local_patterns(repo, files, None if mode != "full" else 80))
        for name, parsed in run_external_scanners(repo, files):
            consume_scanner_result(name, parsed, findings, lint_notes, tools)
    else:
        for name in ("semgrep", "bandit", "gosec", "gitleaks", "osv", "ruff", "eslint"):
            present = which("osv-scanner" if name == "osv" else name)
            tools[name] = {
                "status": "present_unscoped" if present else "missing",
                "finding_count": 0,
            }

    findings = dedupe(findings)
    expand_mirrored_hits(lint_notes, mirrors)
    expand_mirrored_hits(findings, mirrors)
    if mode == "full":
        findings = findings[:80]
    findings, suspects, triage = apply_triage(findings, repo if repo.is_dir() else Path())
    policy = build_llm_report_policy(tools, findings)
    doc = {
        "kind": "SastSignals",
        "schema_version": 1,
        "generated_by": "derive-sast.sh",
        "mode": mode,
        "repo_resolved": bool(repo.is_dir()),
        "files_considered": len(files),
        "tools": tools,
        "pattern_classes_owned": list(OWNED_CLASSES),
        "llm_report_policy": policy,
        "llm_must_not_report": [
            cls for cls, row in policy.items() if row.get("action") == "suppress_obvious"
        ],
        "triage": triage,
        "findings": findings,
        "suspects": suspects,
        "lint_notes": lint_notes[:40],
        "notes": [
            "Each finding has disposition report, drop, or suspect. report skips the model. drop is tests, generated code, or a sanitizer. suspect is the only SAST input to the model, via suspects[].",
            "llm_report_policy is per class. allow = scanner missing or error, record the gap, do not rescan the class. suppress_obvious = scanners ran and reported zero. dedupe_loci = hits exist; only suspect rows may be reviewed, and only from suspects[].",
            "A skipped_no_files tool does not cover a class. CodexQA remains the primary engine.",
        ],
    }
    write_json_atomic(pack / "23-sast-signals.json", doc)


if __name__ == "__main__":
    main()
