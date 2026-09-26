#!/usr/bin/env python3
"""Language-generic deterministic patterns for codexqa-code-reviewer.

New patterns must follow references/rule-construction.md. Implement a family
subset (F1–F5) as roles, not as the sample API that motivated the change.
A scanner row is incomplete evidence: the LLM pass still walks shapes this
module does not emit. One hit does not close the family.

These shapes are filed directly from the scan. They are not semantic judgments.
Patterns cover Java/Kotlin/Scala, C#, Go, JavaScript/TypeScript, Python,
PHP, Ruby, and Rust where the same shape exists. Comment lines are skipped
by callers that pass code lines, and also stripped here when a raw file is scanned.
"""
from __future__ import annotations

import re

from _line_scan import is_heuristic_meta_line, iter_code_lines

# --- exception message rethrown without the original cause (ERR-001) ---

_JAVA_UNWRAP = re.compile(
    r"new\s+\w*(?:Exception|Error|Throwable)\s*\(\s*[\w.]+\.getMessage\s*\(\s*\)\s*\)"
)
_CSHARP_UNWRAP = re.compile(
    r"new\s+\w*(?:Exception|Error)\s*\(\s*(?:e|ex|err|exc|exception|cause)\.Message\s*\)"
)
_JS_UNWRAP = re.compile(
    r"new\s+\w*Error\s*\(\s*(?:e|ex|err|error|exc|exception|cause)\.message\s*\)"
)
_PY_UNWRAP = re.compile(
    r"\braise\s+\w+\(\s*str\s*\(\s*(?:e|ex|err|exc|exception|cause)\s*\)\s*\)"
)
_GO_ERRORS_NEW = re.compile(r"errors\.New\(\s*\w+\.Error\s*\(\s*\)\s*\)")
_GO_ERRORF = re.compile(r'fmt\.Errorf\(\s*"([^"]*)"')
_PHP_UNWRAP = re.compile(
    r"new\s+\\?\w*Exception\s*\(\s*\$\w+->getMessage\s*\(\s*\)\s*\)"
)
_RB_UNWRAP = re.compile(
    r"\braise\s+(?:\w+\s*,\s*)?(?:e|ex|err|error|exception)\.message\b"
)
_CAUSE_KEPT = re.compile(
    r"(?i)(\binitCause\s*\(|\baddSuppressed\s*\(|\bcause\s*:|%\s*w\b|\braise\b.+\bfrom\b)"
)

# --- owned worker pools with no shutdown in the same file (RES-001) ---

_POOL_CREATE = re.compile(
    r"(?i)("
    r"Executors\.new(?:Fixed|Cached|Single|Scheduled|WorkStealing)\w*\s*\(|"
    r"new\s+ThreadPoolExecutor\s*\(|"
    r"new\s+ScheduledThreadPoolExecutor\s*\(|"
    r"new\s+ForkJoinPool\s*\(|"
    r"(?:concurrent\.futures\.)?ThreadPoolExecutor\s*\(|"
    r"(?:concurrent\.futures\.)?ProcessPoolExecutor\s*\(|"
    r"multiprocessing\.Pool\s*\(|"
    r"new\s+Worker\s*\(|"
    r"cluster\.fork\s*\(|"
    r"rayon::ThreadPoolBuilder|"
    r"ThreadPoolBuilder::new\s*\(|"
    r"tokio::runtime::Builder::new"
    r")"
)
_POOL_RELEASE = re.compile(
    r"(?i)("
    r"\.shutdownNow\s*\(|\.shutdown\s*\(|\.terminate\s*\(|\.dispose\s*\(|"
    r"\.Join\s*\(|\.join\s*\(|"
    r"\bdefer\s+[^\n]*\.(?:Shutdown|Close|shutdown|close)\b|"
    r"\bwith\s+(?:concurrent\.futures\.)?(?:Thread|Process)PoolExecutor\b|"
    r"\bwith\s+multiprocessing\.Pool\b|"
    r"\busing\s*\([^)\n]*(?:Pool|Executor|Worker)"
    r")"
)
_POOL_CONTEXT = re.compile(
    r"(?i)(?:^\s*with\s+(?:concurrent\.futures\.)?(?:Thread|Process)PoolExecutor\b|"
    r"^\s*with\s+multiprocessing\.Pool\b|"
    r"\busing\s*\()"
)

# --- hardcoded production / internal service URL, no env read (rollout) ---

_ENV_URL = re.compile(
    r"(?i)(?:"
    r"jdbc:[a-z0-9]+://\S*(?:prod(?:uction)?|\.internal)\S*|"
    r"(?:https?|wss?|postgres(?:ql)?|mysql|oracle|mongodb(?:\+srv)?|"
    r"redis|rediss|amqp|amqps|grpc|grpcs)://\S*(?:prod(?:uction)?|\.internal)\S*"
    r")"
)
_CONFIG_READ = re.compile(
    r"(?i)("
    r"System\.getenv|System\.getProperty|os\.environ|os\.getenv|"
    r"process\.env|@Value\b|@ConfigurationProperties|"
    r"\bviper\.|os\.LookupEnv|os\.Getenv|"
    r"Environment\.GetEnvironmentVariable|\bIOptions\b|\bIConfiguration\b|"
    r"std::env::var|\benv::var\s*\(|"
    r"\bENV\s*\[|\bENV\.fetch\b|\bgetenv\s*\(|"
    r"ConfigService|\bnacos\b|\bapollo\b|"
    r"django\.conf|pydantic_settings|BaseSettings"
    r")"
)

# --- logger method whose body is only stdout/stderr (observability) ---

_LOGGER_TYPE = re.compile(
    r"(?i)\b(?:class|struct|type|object|interface)\s+(\w*(?:Logger|AuditLog)\w*)\b"
)
_LOGGER_METHOD = re.compile(
    r"(?i)^(?!.*\.)\s*"
    r"(?:(?:public|private|protected|internal|static|final|open|override|async|export|"
    r"virtual|fun|func|def|function|fn|void|int|string|bool|boolean)\s+)*"
    r"(?:\(\s*\w+\s+\*?\w+\s*\)\s*)?"
    r"(info|warn|warning|error|debug|trace|fatal|audit|log)\s*\("
)
_GO_RECEIVER_METHOD = re.compile(
    r"(?i)func\s*\(\s*\w+\s+\*?(\w*(?:Logger|AuditLog)\w*)\s*\)\s*"
    r"(Info|Warn|Warning|Error|Debug|Trace|Fatal|Audit|Log)\s*\("
)
_PRINT_SINK = re.compile(
    r"(?i)("
    r"System\.(?:out|err)\.print|"
    r"Console\.(?:Write(?:Line)?|Error\.Write)|"
    r"console\.(?:log|info|warn|error|debug|trace)\s*\(|"
    r"fmt\.(?:Print|Println|Printf)\s*\(|"
    r"println!\s*\(|"
    r"\bprint(?:ln)?\s*\(|"
    r"\bputs\s+|\becho\s+|"
    r"NSLog\s*\(|"
    r"os\.Stdout\.Write|fmt\.Fprintf\s*\(\s*os\.(?:Stdout|Stderr)"
    r")"
)
_FRAMEWORK_LOG = re.compile(
    r"(?i)(slf4j|log4j|LoggerFactory|\bzap\.|\blogrus\.|\bzerolog\b|"
    r"\bwinston\b|\bpino\b|\bbunyan\b|logging\.getLogger|"
    r"\bILogger\b|\bSerilog\b|\bNLog\b|\bslog\.)"
)

# --- timing assertion that never touches IO (test gap) ---

_ELAPSED = re.compile(
    r"(?i)(?:\b(elapsed|duration|latency)\b[^;\n]{0,48}(?:<|<=)\s*(\d{4,})\b|"
    r"\b(?:toBeLessThan|toBeBelow|lessThan)\s*\(\s*(\d{4,})\b)"
)
_TEST_MARK = re.compile(
    r"(?i)(@Test\b|@pytest|\[Test\]|\[Fact\]|\[TestMethod\]|"
    r"\bdef\s+test_\w+\s*\(|\bfunc\s+Test\w+\s*\(|"
    r"\bfun\s+test\w*\s*\(|\bit\s*\(|\btest\s*\(\s*['\"])"
)
_IO_HOT = re.compile(
    r"(?i)("
    r"DriverManager|getConnection\s*\(|\bjdbc:|DataSource|"
    r"\bfetch\s*\(|axios\.|requests\.(?:get|post|put|delete|head|patch|request)\b|http\.(?:Get|Post|Client)|"
    r"RestTemplate|WebClient|HttpClient|grpc\.|sql\.Open|"
    r"createStatement|prepareStatement|executeQuery|"
    r"os\.ReadFile|ioutil\.Read|fs\.readFile|"
    r"FileInputStream|Files\.read|open\s*\("
    r")"
)
_METHOD_START = re.compile(
    r"(?i)("
    r"\bdef\s+\w+\s*\(|"
    r"\bfunc\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s*)?\w+\s*\(|"
    r"\bfun\s+\w+\s*\(|"
    r"\bfunction\s+\w+\s*\(|"
    r"\b(?:public|private|protected|internal).{0,80}\b\w+\s*\([^;]*\)\s*\{?\s*$"
    r")"
)


def _hit(rel: str, line: int, kind: str, snippet: str, rule_id: str, category: str) -> dict:
    return {
        "path": rel,
        "line": line,
        "kind": kind,
        "rule_id": rule_id,
        "category": category,
        "snippet": snippet.strip()[:160],
    }


def _brace_delta(line: str) -> int:
    stripped = re.sub(r'"(?:\\.|[^"\\])*"', '""', line)
    stripped = re.sub(r"'(?:\\.|[^'\\])*'", "''", stripped)
    return stripped.count("{") - stripped.count("}")


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _exception_unwrap_line(line: str) -> bool:
    if _CAUSE_KEPT.search(line):
        return False
    if _JAVA_UNWRAP.search(line) or _CSHARP_UNWRAP.search(line) or _JS_UNWRAP.search(line):
        return True
    if _PHP_UNWRAP.search(line) or _RB_UNWRAP.search(line):
        return True
    if _PY_UNWRAP.search(line) and not re.search(r"\bfrom\b", line):
        return True
    if _GO_ERRORS_NEW.search(line):
        return True
    fmt = _GO_ERRORF.search(line)
    if fmt and "%w" not in fmt.group(1) and re.search(r"%[svq]", fmt.group(1)):
        return True
    return False


def scan_exception_unwraps(rel: str, lines: list[str]) -> list[dict]:
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if _exception_unwrap_line(line):
            out.append(_hit(rel, i + 1, "exception_unwrap", line, "ERR-001", "resilience"))
    return out[:20]


# --- additive locus scans (do not change the matchers above) ---

_GETBYTES_BARE = re.compile(r"\.getBytes\s*\(\s*\)")
_STREAM_NEW = re.compile(
    r"new\s+(?:[\w.]+\.)?(?:File(?:Input|Output)Stream|File(?:Reader|Writer)|"
    r"Buffered(?:Reader|Writer)|PrintWriter)\s*\("
)
_TRY_WITH = re.compile(r"\btry\s*\(")
_FINALLY_CLOSES = re.compile(r"finally[\s\S]{0,500}\.close\s*\(", re.I)
_LIST_DECL = re.compile(
    r"\b(?:List|Set|Collection|ArrayList|LinkedList|HashSet|ArrayDeque)"
    r"\s*(?:<[^>\n]+>)?\s+(\w+)\s*=\s*new\s+"
)
_LOAD_ASSIGN = re.compile(
    r"\b(\w+)\s*=\s*(?:[\w.]+\.)?((?:load|find|query|fetch)[A-Z]\w*)\s*\("
)
_LOAD_SKIP = {"loadClass", "loadLibrary", "findResource", "findClass"}
_ADMIN_CONTAINS = re.compile(r"""\.contains\s*\(\s*["']ADMIN["']\s*\)""")
_DRIVER_CONNECT = re.compile(r"\bDriverManager\.getConnection\s*\(")
_METHOD_BOUNDARY = re.compile(
    r"^\s{0,8}(?:public|private|protected)\s+(?:static\s+)?(?:[\w.<>,\[\]]+\s+)+\w+\s*\("
)


def _forward_until_method(lines: list[str], start: int, limit: int = 50) -> int:
    end = min(len(lines), start + limit)
    for j in range(start + 1, end):
        if _METHOD_BOUNDARY.search(lines[j]):
            return j
    return end


def scan_charset_gaps(rel: str, lines: list[str]) -> list[dict]:
    """String.getBytes() with no charset. Existing getBytes(charset) stays quiet."""
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if _GETBYTES_BARE.search(line):
            out.append(_hit(rel, i + 1, "charset_omission", line, "", "correctness"))
    return out[:20]


def scan_close_on_success(rel: str, lines: list[str]) -> list[dict]:
    """Stream constructed outside try-with-resources, close not in finally.

    A finally that closes, or try-with-resources, is not a hit. Rows use
    kind close_not_in_finally and join the existing resource_leaks array.
    """
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line) or not _STREAM_NEW.search(line):
            continue
        back = "\n".join(lines[max(0, i - 4) : i + 1])
        if _TRY_WITH.search(back):
            continue
        forward = "\n".join(lines[i : min(len(lines), i + 35)])
        if _FINALLY_CLOSES.search(forward):
            continue
        out.append(_hit(rel, i + 1, "close_not_in_finally", line, "RES-001", "correctness"))
    return out[:20]


def scan_unused_accumulators(rel: str, lines: list[str]) -> list[dict]:
    """Local collection that is only add/put and never read in the same method."""
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        match = _LIST_DECL.search(line)
        if not match:
            continue
        name = match.group(1)
        end = _forward_until_method(lines, i)
        writes = 0
        reads = 0
        for raw in lines[i + 1 : end]:
            if is_heuristic_meta_line(raw) or not re.search(r"\b" + re.escape(name) + r"\b", raw):
                continue
            if re.search(r"\.(?:add|addAll|put|offer|push)\s*\(", raw):
                writes += 1
            else:
                reads += 1
        if writes > 0 and reads == 0:
            out.append(_hit(rel, i + 1, "unused_accumulator", line, "", "maintainability"))
    return out[:20]


def scan_null_deref_gaps(rel: str, lines: list[str]) -> list[dict]:
    """load/find/query/fetch assigned then used with no null check before the use."""
    out = []
    code = [(i, line) for i, line, _s in iter_code_lines(lines) if not is_heuristic_meta_line(line)]
    for pos, (i, line) in enumerate(code):
        match = _LOAD_ASSIGN.search(line)
        if not match:
            continue
        var, callee = match.group(1), match.group(2)
        if callee in _LOAD_SKIP:
            continue
        if re.search(r"\b" + re.escape(var) + r"\b\s*(?:==|!=)\s*null", line):
            continue
        if "requireNonNull" in line:
            continue
        used = False
        for _j, nxt in code[pos + 1 : pos + 7]:
            if re.search(
                r"\b" + re.escape(var) + r"\b\s*(?:==|!=)\s*null|requireNonNull\s*\(\s*" + re.escape(var),
                nxt,
            ):
                break
            if re.search(r"\b" + re.escape(var) + r"\s*\.", nxt):
                used = True
                break
        if used:
            out.append(_hit(rel, i + 1, "null_deref_after_load", line, "NULL-001", "correctness"))
    return out[:20]


def scan_admin_grant_without_audit(rel: str, lines: list[str]) -> list[dict]:
    """Role contains ADMIN and returns true with no audit call in that window.

    Does not replace AUTH-002. Same line may still carry a different rule_id.
    """
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line) or not _ADMIN_CONTAINS.search(line):
            continue
        if not re.search(r"(?i)role", line):
            continue
        window = lines[i : min(len(lines), i + 8)]
        blob = "\n".join(window)
        if not re.search(r"\breturn\s+true\s*;", blob):
            continue
        if re.search(r"(?i)(\baudit\b|\blogger\b|\.info\s*\(|\.warn\s*\(|\.error\s*\()", blob):
            continue
        out.append(_hit(rel, i + 1, "admin_grant_without_audit", line, "TEN-006", "security"))
    return out[:20]


# Tenant scope is a field on the type. The methods that drop it often never
# spell "tenant", so the file, not the method name, is the source role.
_TENANT_FIELD = re.compile(
    r"(?i)\b(?:tenant|org|organization|organisation)(?:Id|_id)\b"
)
_TENANT_WORD = re.compile(
    r"(?i)\b(?:tenant(?:_?id)?|org(?:_?id)?|organization(?:_?id)?|organisation(?:_?id)?)\b"
)
_SQL_START = re.compile(r"(?i)\b(?:select|update|delete)\b")
_SQL_WHERE = re.compile(r"(?i)\bwhere\b")
_ID_EQ = re.compile(
    r"(?i)\b\w*(?:id|no|key|code)\b\s*=\s*(?:\?|%s|:\w+|\$\d+|['\"])"
)
_ASYNC_HANDOFF = re.compile(
    r"(?i)(?:\.execute\s*\(\s*new\s+\w*(?:Runnable|Callable)"
    r"|\.submit\s*\(\s*(?:lambda|new\s+\w*(?:Runnable|Callable))"
    r"|\bgo\s+func\s*\("
    r"|\.publish\s*\(|\.enqueue\s*\()"
)
_ANY_ID = re.compile(r"(?i)\b([A-Za-z_]\w*(?:Id|_id))\b")
_SCOPE_ID = re.compile(
    r"(?i)^(tenant|org|organization|organisation|actor|trace|span|correlation|request)"
)
_ACTOR = re.compile(
    r"(?i)\b(?:actor(?:Id|_id)?|principal|operatorId|userId|user_id)\b"
)
_TRACE = re.compile(
    r"(?i)\b(?:trace(?:Id)?|span(?:Id)?|correlation(?:Id)?|requestId|request_id)\b"
)
_REVERSAL_DEF = re.compile(
    r"(?i)\b(?:reverse|refund|chargeback)\w*\s*\([^)\n]*\)"
)
_ID_ARG_CALL = re.compile(
    r"(?i)\b(?:find|get|load|fetch)\w*\s*\(\s*[A-Za-z_]\w*(?:Id|id|_id)\b"
)


def _file_has_tenant_scope(lines: list[str]) -> bool:
    for _i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if _TENANT_FIELD.search(line):
            return True
    return False


def _with_severity(row: dict, severity: str) -> dict:
    row["severity"] = severity
    return row


def scan_tenant_predicate_gaps(rel: str, lines: list[str]) -> list[dict]:
    """Id lookup or update whose statement has no tenant predicate.

    The file must declare a tenant or org id. A statement that already ANDs
    that scope is not a hit. One statement does not close the next.
    """
    if not _file_has_tenant_scope(lines):
        return []
    code = [
        (i, line)
        for i, line, _stripped in iter_code_lines(lines)
        if not is_heuristic_meta_line(line)
    ]
    out = []
    seen = set()
    for pos, (i, line) in enumerate(code):
        if not _SQL_START.search(line):
            continue
        window = code[pos : pos + 8]
        blob = "\n".join(text for _n, text in window)
        if not _SQL_WHERE.search(blob) or not _ID_EQ.search(blob):
            continue
        if _TENANT_WORD.search(blob):
            continue
        where = next((n for n, text in window if _SQL_WHERE.search(text)), i)
        if where in seen:
            continue
        seen.add(where)
        snippet = next(text for n, text in window if n == where)
        out.append(_with_severity(
            _hit(rel, where + 1, "tenant_predicate_missing", snippet, "TEN-002", "security"),
            "p0",
        ))
    return out[:20]


def scan_tenant_context_drops(rel: str, lines: list[str]) -> list[dict]:
    """Work handed to another thread carries a business id and drops scope.

    Tenant, actor, and trace are one bundle. The worker does not have to load
    a row. A payload that already carries all three is not a hit.
    """
    if not _file_has_tenant_scope(lines):
        return []
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line) or not _ASYNC_HANDOFF.search(line):
            continue
        body = _brace_body(lines, i) or _indent_body(lines, i)
        blob = line + "\n" + "\n".join(text for _n, text in body)
        business = [
            name
            for name in _ANY_ID.findall(blob)
            if not _SCOPE_ID.search(name)
        ]
        if not business:
            continue
        if _TENANT_WORD.search(blob) and _ACTOR.search(blob) and _TRACE.search(blob):
            continue
        out.append(_with_severity(
            _hit(rel, i + 1, "tenant_context_dropped", line, "TEN-004", "security"),
            "p1",
        ))
    return out[:20]


def scan_cross_tenant_id_actions(rel: str, lines: list[str]) -> list[dict]:
    """Reverse, refund, or chargeback loads a row by object id alone.

    A lookup that also takes the server tenant is not a hit. Each call is
    its own row.
    """
    if not _file_has_tenant_scope(lines):
        return []
    out = []
    seen = set()
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line) or not _REVERSAL_DEF.search(line):
            continue
        body = _brace_body(lines, i) or _indent_body(lines, i)
        blob = line + "\n" + "\n".join(text for _n, text in body)
        if _TENANT_WORD.search(blob):
            continue
        for n, text in body:
            if n in seen or not _ID_ARG_CALL.search(text):
                continue
            seen.add(n)
            out.append(_with_severity(
                _hit(rel, n + 1, "tenant_id_only_lookup", text, "TEN-005", "security"),
                "p0",
            ))
    return out[:20]


def scan_unpooled_connections(rel: str, lines: list[str]) -> list[dict]:
    """DriverManager.getConnection opens a connection with no pool.

    This is not an N+1 row. Loop-hosted calls stay on the existing n_plus_one scan.
    """
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if _DRIVER_CONNECT.search(line):
            out.append(_hit(rel, i + 1, "unpooled_connection", line, "", "performance"))
    return out[:20]


def scan_executor_leaks(rel: str, lines: list[str]) -> list[dict]:
    code = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        code.append((i, line))
    if any(_POOL_RELEASE.search(line) for _i, line in code):
        return []
    out = []
    for i, line in code:
        if not _POOL_CREATE.search(line):
            continue
        if _POOL_CONTEXT.search(line):
            continue
        out.append(_hit(rel, i + 1, "executor_not_shutdown", line, "RES-001", "correctness"))
    return out[:20]


def scan_env_config_gaps(rel: str, lines: list[str]) -> list[dict]:
    code = [(i, line) for i, line, _s in iter_code_lines(lines) if not is_heuristic_meta_line(line)]
    if any(_CONFIG_READ.search(line) for _i, line in code):
        return []
    out = []
    for i, line in code:
        if _ENV_URL.search(line):
            out.append(_hit(rel, i + 1, "env_config_gap", line, "", "rollout"))
    return out[:20]


def _brace_body(lines: list[str], start: int) -> list[tuple[int, str]]:
    depth = 0
    seen = False
    body = []
    for i in range(start, min(len(lines), start + 80)):
        line = lines[i]
        delta = _brace_delta(line)
        if not seen:
            depth += delta
            if depth > 0 or "{" in line:
                seen = True
            continue
        if depth + delta <= 0 and "}" in line:
            break
        depth += delta
        body.append((i, line))
    return body


def _end_body(lines: list[str], start: int) -> list[tuple[int, str]]:
    """Ruby / Elixir style: body runs until the matching ``end``."""
    depth = 1
    body = []
    opener = re.compile(r"(?i)\b(?:def|class|module|do|if|unless|begin|case|while|until)\b")
    closer = re.compile(r"(?i)\bend\b")
    for i in range(start + 1, min(len(lines), start + 80)):
        line = lines[i]
        opens = len(opener.findall(line))
        closes = len(closer.findall(line))
        if closes and depth - closes + opens <= 0 and opens == 0:
            break
        body.append((i, line))
        depth += opens - closes
        if depth <= 0:
            break
    return body


def _indent_body(lines: list[str], start: int) -> list[tuple[int, str]]:
    base = _indent(lines[start])
    body = []
    for i in range(start + 1, min(len(lines), start + 80)):
        raw = lines[i]
        if raw.strip() == "":
            continue
        if _indent(raw) <= base:
            break
        body.append((i, raw))
    return body


def _body_is_print_only(body: list[tuple[int, str]]) -> tuple[int, str] | None:
    sink = None
    for i, line in body:
        stripped = line.strip()
        if stripped in ("", "{", "}", "end", "pass"):
            continue
        if is_heuristic_meta_line(line):
            continue
        if _FRAMEWORK_LOG.search(line):
            return None
        if _PRINT_SINK.search(line):
            sink = (i, line)
            continue
        if "(" in stripped:
            return None
    return sink


def _logger_type_nearby(lines: list[str], start: int) -> bool:
    begin = max(0, start - 50)
    for j in range(begin, start + 1):
        if _LOGGER_TYPE.search(lines[j]):
            return True
    return False


def scan_uncontrolled_log_sinks(rel: str, lines: list[str]) -> list[dict]:
    out = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if is_heuristic_meta_line(line) or stripped.startswith(("//", "#", "*", "/*")):
            continue
        is_go = bool(_GO_RECEIVER_METHOD.search(line))
        is_method = bool(_LOGGER_METHOD.search(stripped)) or is_go
        if not is_method:
            continue
        if not is_go and not _logger_type_nearby(lines, i):
            continue
        if stripped.endswith(":") and re.search(r"(?i)\bdef\s+", stripped):
            body = _indent_body(lines, i)
        elif "{" not in line and re.search(r"(?i)\bdef\s+", stripped):
            body = _end_body(lines, i)
        else:
            body = _brace_body(lines, i)
        sink = _body_is_print_only(body)
        if sink is None:
            continue
        si, sline = sink
        out.append(_hit(rel, si + 1, "uncontrolled_log_sink", sline, "", "observability"))
    return out[:20]


def _method_span(lines: list[str], idx: int) -> tuple[int, int]:
    start = idx
    for j in range(idx, max(-1, idx - 40), -1):
        if _METHOD_START.search(lines[j]) or _TEST_MARK.search(lines[j]):
            start = j
            break
    if lines[start].rstrip().endswith(":"):
        base = _indent(lines[start])
        end = start + 1
        while end < len(lines):
            raw = lines[end]
            if raw.strip() and _indent(raw) <= base:
                break
            end += 1
        return start, end
    depth = 0
    seen = False
    end = start
    while end < len(lines) and end < start + 120:
        depth += _brace_delta(lines[end])
        if "{" in lines[end] or depth > 0:
            seen = True
        end += 1
        if seen and depth <= 0:
            break
    return start, end


def _is_test_method(lines: list[str], start: int, end: int) -> bool:
    window = "\n".join(lines[max(0, start - 4) : end])
    return bool(_TEST_MARK.search(window))


# Semantic candidates. The scan only marks rows. The model decides hit vs skip.
# These arrays must not flip signals_thin and are not hard gates.

_FACTORY_DEF = re.compile(
    r"(?i)(?<!\.)(?:"
    r"\b(?:def|func|function|fun)\s+(reject|fail)\s*\(([^)]*)\)|"
    r"\b(?:public|private|protected|internal|static|final|export|async|open)\s+"
    r"(?:[\w.<>,\[\]?]+\s+)*(reject|fail)\s*\(([^)]*)\)"
    r")"
)
_RICH_ERROR = re.compile(
    r"(?i)\b(message|detail|cause|trace(?:[_-]?id)?|correlation[_-]?id|span[_-]?id|reason[_-]?text)\b"
)
_STATUS_LIT = re.compile(
    r"(?i)"
    r"""["']([A-Za-z0-9])["']\s*\.equals\s*\([^)\n]{0,80}\b(?:status|state|flag)\w*[^)\n]{0,40}\)"""
    r"|"
    r"""\b(?:status|state|flag)\w*\s*(?:===|!==|==|!=)\s*["']([A-Za-z0-9])["']"""
    r"|"
    r"""\b(?:status|state|flag)\w*\s*(?:==|!=)\s*'([A-Za-z0-9])'"""
)


def _semantic_hit(rel: str, line: int, kind: str, snippet: str, category: str, hint: str) -> dict:
    row = _hit(rel, line, kind, snippet, "", category)
    row["decision"] = "llm"
    row["hint"] = hint
    return row


def scan_error_payload_candidates(rel: str, lines: list[str]) -> list[dict]:
    """Factory named reject/fail with a single code and no message/trace in the body.

    Not a finding by itself. A code catalog, an internal helper, or a body that
    already sets message/trace/cause is for the model to skip.
    """
    out = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if is_heuristic_meta_line(line) or stripped.startswith(("//", "#", "*", "/*")):
            continue
        if stripped.endswith(";") and "{" not in stripped:
            continue
        match = _FACTORY_DEF.search(line)
        if not match:
            continue
        params = match.group(2) if match.group(2) is not None else match.group(4)
        params = params or ""
        if "," in params:
            continue
        if _RICH_ERROR.search(params):
            continue
        if stripped.endswith(":") and re.search(r"(?i)\bdef\s+", stripped):
            body = _indent_body(lines, i)
        else:
            body = _brace_body(lines, i)
        blob = line + "\n" + "\n".join(text for _n, text in body)
        if _RICH_ERROR.search(blob):
            continue
        if not body and "{" not in line and not stripped.endswith(":"):
            continue
        out.append(
            _semantic_hit(
                rel,
                i + 1,
                "error_payload_candidate",
                line,
                "contract",
                "single-code reject/fail factory; judge whether callers can see a cause or trace id",
            )
        )
    return out[:20]


def scan_opaque_status_candidates(rel: str, lines: list[str]) -> list[dict]:
    """Status/state/flag compared to a one-character literal.

    Not a finding by itself. Y/N/0/1 flags and literals explained by a named
    constant, enum, or adjacent comment are for the model to skip.
    """
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if not _STATUS_LIT.search(line):
            continue
        window_lines = lines[max(0, i - 2) : min(len(lines), i + 3)]
        window = "\n".join(window_lines)
        comment = any(
            ln.strip().startswith(("//", "#", "*", "/*")) for ln in window_lines
        )
        explained = comment or bool(re.search(r"(?i)\b(?:status_\w+|enum\s+\w+)\b", window))
        hint = (
            "nearby name or comment may already define this literal"
            if explained
            else "no named constant or comment next to the literal; judge if it is a business protocol"
        )
        out.append(
            _semantic_hit(rel, i + 1, "opaque_status_candidate", line, "rollout", hint)
        )
    return out[:20]


# --- pipeline closure shapes (F3 value, F4 retry side effect, F1 parse, F5 tests) ---
# Illustrations are not the pattern. Each scanner quotes the family and mode.

_CONST_INIT = re.compile(
    r"(?m)^[^\n]*\b([A-Z][A-Z0-9_]{2,})\s*=\s*(-?\d+|true|false)\b"
)
_DEADLINE_CALL = re.compile(
    r"(?i)(\bset\w*(?:Timeout|Deadline)\s*\(|\bWithTimeout\s*\(|\bwith_timeout\s*\(|"
    r"\bcontext\.WithTimeout\s*\()"
)
_DISABLE_NUM = re.compile(r"(?i)\b(0|-1|Integer\.MAX_VALUE|Long\.MAX_VALUE)\b")
_CONFIG_SOURCE = re.compile(
    r"(?i)(getenv|getProperty|System\.getenv|os\.Getenv|os\.environ|process\.env|"
    r"@Value\b|viper\.|config\.Get)"
)
_LOOP_OPEN = re.compile(r"(?i)\b(for|while)\b")
_SIDE_EFFECT_CALL = re.compile(
    r"(?i)(?:\w+\.)*\w*(notify|publish|dispatch|charge|debit|credit|capture|refund|send|persist|submit)\w*\s*\("
)
_IDEMP_KEY = re.compile(
    r"(?i)\b(idempoten\w*|dedup\w*|nonce|eventId|event_id|requestId|request_id|businessId|business_id)\b"
)
_PARSE_CALL = re.compile(
    r"(?i)(?:"
    r"new\s+(?:java\.math\.)?(?:BigDecimal|BigInteger)\s*\(\s*([^)]+)\)|"
    r"new\s+(?:Integer|Long|Double|Float|Date|URI|URL)\s*\(\s*([^)]+)\)|"
    r"(?:Integer|Long|Double|Float)\.parse(?:Int|Long|Double|Float)\s*\(\s*([^)]+)\)|"
    r"strconv\.(?:Atoi|ParseInt|ParseFloat|ParseBool)\s*\(\s*([^)]+)\)|"
    r"(?:parseInt|parseFloat|Number)\s*\(\s*([^)]+)\)|"
    r"new\s+Decimal\s*\(\s*([^)]+)\)"
    r")"
)
_ABSENCE_GUARD = re.compile(r"(?i)(==\s*null|!=\s*null|isBlank|isEmpty|requireNonNull|len\s*\([^)]*\)\s*==\s*0)")
_STATIC_MUTABLE = re.compile(
    r"(?i)\bstatic\b[^\n;]{0,160}\bnew\s+"
    r"(?:java\.text\.)?(?:SimpleDateFormat|DateFormat|DecimalFormat|Calendar|"
    r"java\.util\.Random|Random|HashMap|ArrayList|HashSet|LinkedList)\b"
)
_FIELD_PLAIN_MAP = re.compile(
    r"(?i)^[^\n]*\b(?:private|protected|public)\b[^\n;]*\bHashMap\b[^\n;]*=\s*new\s+HashMap\b"
)
_PROCESS_DEFAULT = re.compile(
    r"(?i)("
    r"setDefaultSSLSocketFactory\s*\(|setDefaultHostnameVerifier\s*\(|"
    r"SSLContext\.setDefault\s*\(|HttpsURLConnection\.setDefault\w*\s*\(|"
    r"Security\.(?:addProvider|insertProviderAt)\s*\(|"
    r"TimeZone\.setDefault\s*\(|Locale\.setDefault\s*\(|"
    r"HttpURLConnection\.setFollowRedirects\s*\("
    r")"
)
_DECISION_LITERAL = re.compile(
    r"(?i)(?:"
    r"(?:<=|>=|<|>|==|!=)\s*-?\d+(?:\.\d+)?\b|"
    r"\b-?\d+(?:\.\d+)?\s*(?:<=|>=|<|>)|"
    r"\bset\w*(?:Timeout|Deadline)\s*\(\s*-?\d+\b|"
    r"\b0\.\d+\b"
    r")"
)
_PORT_LITERAL = re.compile(r"(?i):\d{2,5}\b|\bport\b")
_INDEX_NULL = re.compile(r"(?i)\b\w+\s*\[\s*\w+\s*\]\s*==\s*null\b")
_ARRAY_INIT = re.compile(r"=\s*\{([^{}]*)\}")
_TAUTOLOGY = re.compile(
    r"(?i)(?:(?:\.size\s*\(\s*\)|\.length\s*\(\s*\)|\blen\s*\()\s*>=\s*1\b|"
    r"\bassert(?:True|Equals)?\s*\(\s*true\s*[,)])"
)
_THREAD_START = re.compile(r"(?i)(\.start\s*\(\s*\)|\bgo\s+func\b|\bThread\s*\()")
_THREAD_JOIN = re.compile(r"(?i)(\.join\s*\(|\.Wait\s*\(|sync\.WaitGroup)")
_TEST_FILE = re.compile(
    r"(?i)(^|/)(test|tests|__tests__|spec)(/|$)|Test\.java$|_test\.go$|^test_.*\.py$|\.spec\.[jt]sx?$"
)


def _const_inits(lines: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for line in lines:
        if is_heuristic_meta_line(line):
            continue
        for name, value in _CONST_INIT.findall(line):
            found[name] = value
    return found


def scan_disabled_bounds(rel: str, lines: list[str]) -> list[dict]:
    """F3 constant: the value that reaches the decision disables the bound.

    Calling the setter, or reading the symbol, is not the sanitizer.
    """
    out = []
    inits = _const_inits(lines)
    config = any(_CONFIG_SOURCE.search(line) for line in lines if not is_heuristic_meta_line(line))
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if _DEADLINE_CALL.search(line):
            literal = _DISABLE_NUM.search(line)
            named = re.search(r"\(\s*([A-Z][A-Z0-9_]{2,})\b", line)
            forced = False
            if literal and literal.group(1) in {"0", "-1", "Integer.MAX_VALUE", "Long.MAX_VALUE"}:
                forced = True
            elif named and inits.get(named.group(1)) in {"0", "-1"}:
                forced = True
            if forced:
                out.append(_hit(rel, i + 1, "disabled_bound", line, "BND-001", "correctness"))
    if not config:
        for i, line, _stripped in iter_code_lines(lines):
            if is_heuristic_meta_line(line) or "static" not in line:
                continue
            match = re.search(r"\b([A-Z][A-Z0-9_]{2,})\s*=\s*(true|false)\b", line)
            if not match:
                continue
            name = match.group(1)
            used = any(
                re.search(r"\bif\b[^\n]*\b" + re.escape(name) + r"\b", row)
                or re.search(r"\b" + re.escape(name) + r"\s*\?", row)
                for row in lines
            )
            if used:
                out.append(_hit(rel, i + 1, "disabled_bound", line, "BND-001", "correctness"))
    return out[:20]


def scan_retry_side_effects(rel: str, lines: list[str]) -> list[dict]:
    """F4 guard: a loop retries a write or notify with no idempotency key.

    A max-attempt count is not the sanitizer. Backoff stays on unbounded_retry.
    """
    out = []
    code = [(i, line) for i, line, _s in iter_code_lines(lines) if not is_heuristic_meta_line(line)]
    for pos, (i, line) in enumerate(code):
        if not _LOOP_OPEN.search(line):
            continue
        depth = _brace_delta(line)
        window = []
        for j, row in code[pos + 1 : pos + 16]:
            window.append((j, row))
            depth += _brace_delta(row)
            if depth <= 0 and "{" in line:
                break
        blob = "\n".join(row for _j, row in window)
        if _IDEMP_KEY.search(blob):
            continue
        for j, row in window:
            if _SIDE_EFFECT_CALL.search(row):
                out.append(_hit(rel, j + 1, "retry_side_effect", row, "BIZ-001", "correctness"))
                break
    return out[:20]


def scan_unguarded_parses(rel: str, lines: list[str]) -> list[dict]:
    """F1 guard: caller text is converted to a number, time, or id with no absence check.

    This does not close a later load-then-deref on another line.
    """
    out = []
    code = [(i, line) for i, line, _s in iter_code_lines(lines) if not is_heuristic_meta_line(line)]
    for pos, (i, line) in enumerate(code):
        match = _PARSE_CALL.search(line)
        if not match:
            continue
        arg = next((g for g in match.groups() if g), "")
        if not re.search(r"(?i)(\.get\s*\(|\[|params|request|body|form|query|header)", arg):
            continue
        prior = "\n".join(row for _j, row in code[max(0, pos - 4) : pos])
        if _ABSENCE_GUARD.search(prior) or _ABSENCE_GUARD.search(line):
            continue
        out.append(_hit(rel, i + 1, "unguarded_parse", line, "NULL-001", "correctness"))
    return out[:20]


def scan_shared_mutables(rel: str, lines: list[str]) -> list[dict]:
    """F1 search: a long-lived mutable that is not thread-safe is stored for handlers.

    Collections are one shape. Formatters, calendars, and generators are another.
    A log sink on a later line does not close this row.
    """
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if re.search(r"(?i)(ThreadLocal|ConcurrentHashMap|concurrent\.|sync\.Map)", line):
            continue
        if _STATIC_MUTABLE.search(line) or _FIELD_PLAIN_MAP.search(line):
            out.append(_hit(rel, i + 1, "shared_mutable", line, "CONC-003", "concurrency"))
    return out[:20]


def scan_process_defaults(rel: str, lines: list[str]) -> list[dict]:
    """F1 search: a call replaces a process-scoped default used by later callers."""
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        if _PROCESS_DEFAULT.search(line):
            out.append(_hit(rel, i + 1, "process_default_write", line, "GLOB-001", "security"))
    return out[:20]


def scan_decision_literals(rel: str, lines: list[str]) -> list[dict]:
    """F3 constant: an inline literal decides a timeout, rate, limit, or comparison.

    A named constant that is read is not this row. Ports are not this row.
    """
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line) or _PORT_LITERAL.search(line):
            continue
        if re.search(r"(?i)\bstatic\b[^\n]*=\s*-?\d", line):
            continue
        start, end = _method_span(lines, i)
        if _is_test_method(lines, start, end):
            continue
        if _DECISION_LITERAL.search(line):
            row = _hit(rel, i + 1, "decision_literal", line, "", "maintainability")
            row["close"] = "per_line"
            out.append(row)
    return out[:30]


def scan_test_oracles(rel: str, lines: list[str]) -> dict:
    """F5 search: one inventory row per test, plus mechanical false claims.

    Inventory rows are suspects. Mechanical rows are findings. One claim does
    not close the next test or the next shape.
    """
    inventory = []
    hits = []
    seen_methods = set()
    for i, line, _stripped in iter_code_lines(lines):
        if not _TEST_MARK.search(line):
            continue
        start, end = _method_span(lines, i)
        if start in seen_methods:
            continue
        seen_methods.add(start)
        row = _hit(rel, start + 1, "test_oracle", lines[start], "", "test_gaps")
        blob = "\n".join(lines[start:end])
        private_names = re.findall(r"\bprivate\s+(?:static\s+)?(?:final\s+)?[\w<>,.\[\]\s]+\s+(\w+)\s*[=;(]", "\n".join(lines))
        signals = []
        if any(re.search(r"\b" + re.escape(name) + r"\b", blob) for name in private_names):
            signals.append("locks_private")
        if re.search(r"(?i)\b(assert|expect)\b", blob) and re.search(r"(?<![\w.])\d{2,}\b", blob):
            signals.append("threshold_pass")
        if re.search(r"(?i)\bcatch\b|\bexcept\b", blob) and not re.search(
            r"(?i)\b(log|metric|trace|span)\b", blob
        ):
            signals.append("observability_unasserted")
        row["questions"] = [
            "locks_private",
            "locks_dependency",
            "threshold_pass",
            "observability_asserted",
        ]
        row["signals"] = signals
        inventory.append(row)
        if _THREAD_START.search(blob) and not _THREAD_JOIN.search(blob):
            hits.append(_hit(rel, start + 1, "test_no_join", lines[start], "", "test_gaps"))
        if _TAUTOLOGY.search(blob):
            hits.append(_hit(rel, start + 1, "test_tautology", lines[start], "", "test_gaps"))
        if _INDEX_NULL.search(blob):
            inits = _ARRAY_INIT.findall(blob)
            if any(('"' in body or "'" in body) and not re.search(r"\bnull\b", body) for body in inits):
                hits.append(_hit(rel, start + 1, "test_unreachable", lines[start], "", "test_gaps"))
    if inventory:
        inits = _const_inits(lines)
        test_blob = "\n".join(lines)
        for name, value in inits.items():
            if value not in {"true", "false"}:
                continue
            if not re.search(r"\b" + re.escape(name) + r"\b", test_blob):
                continue
            mentioned_in_test = False
            for row in inventory:
                start = int(row["line"]) - 1
                _s, end = _method_span(lines, start)
                if re.search(r"\b" + re.escape(name) + r"\b", "\n".join(lines[start:end])):
                    mentioned_in_test = True
                    break
            if not mentioned_in_test:
                decl = next((n for n, line in enumerate(lines) if re.search(r"\b" + re.escape(name) + r"\b", line)), 0)
                hits.append(_hit(rel, decl + 1, "test_flag_uncovered", lines[decl], "", "test_gaps"))
    return {"inventory": inventory[:40], "hits": hits[:40]}


def scan_prod_test_coupling(rel: str, lines: list[str]) -> list[dict]:
    """F5 search: a production type references a test framework or nests a test.

    A path under a test directory, or a file that is only a test, is the sanitizer.
    """
    if _TEST_FILE.search(rel.replace("\\", "/")):
        return []
    out = []
    for i, line, _stripped in iter_code_lines(lines):
        if _TEST_MARK.search(line) or re.search(
            r"(?i)^\s*import\s+(?:org\.junit|org\.testng|pytest|testing\b|jest|vitest)",
            line,
        ):
            out.append(_hit(rel, i + 1, "prod_test_coupling", line, "DES-001", "design"))
            break
    return out[:10]


def scan_weak_perf_tests(rel: str, lines: list[str]) -> list[dict]:
    out = []
    seen = set()
    for i, line, _stripped in iter_code_lines(lines):
        if is_heuristic_meta_line(line):
            continue
        match = _ELAPSED.search(line)
        if not match:
            continue
        number = next((g for g in match.groups() if g and g.isdigit()), "")
        if not number or int(number) < 1000:
            continue
        start, end = _method_span(lines, i)
        if not _is_test_method(lines, start, end):
            continue
        blob = "\n".join(lines[start:end])
        if _IO_HOT.search(blob):
            continue
        if i in seen:
            continue
        seen.add(i)
        out.append(_hit(rel, i + 1, "weak_perf_test", line, "", "test_gaps"))
    return out[:20]
