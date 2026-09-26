#!/usr/bin/env python3
"""Fill mechanical conclusion fields before HTML render.

Report rows, span hashes, untested names, rule shapes, and default oracle
skips are ledger work. The model only supplies judgment.json: business
defects the scanners missed, confirmed suspect ids, and oracle answers for
test_oracle_hits. Branch-drift report lines are line_skips, not a defect card.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

# A confirmed magic number stays a convention. A decision literal becomes a
# defect only when the snippet is a fee, timeout, or account limit.
_BUSINESS_LITERAL = re.compile(
    r"(?i)\b(fee|amount|price|timeout|deadline|retry|limit|quota|ttl|expiry|expir|balance|refund)\b"
)
_CONVENTION_KINDS = {"magic_number", "long_file", "eol_import", "rate_literal"}


def load_validate():
    path = Path(__file__).resolve().parent / "validate-conclusion.py"
    spec = importlib.util.spec_from_file_location("validate_conclusion_seal", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("validate-conclusion.py is not importable")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def gap_names(conclusion: dict) -> set[str]:
    names: set[str] = set()
    for row in conclusion.get("test_gaps") or []:
        if not isinstance(row, dict):
            continue
        if row.get("symbol"):
            names.add(str(row["symbol"]))
        for key in ("symbols", "waived_symbols"):
            raw = row.get(key)
            if isinstance(raw, list):
                names.update(str(item) for item in raw)
    return names


def report_rows(pack: Path, validate) -> list[dict]:
    rows: list[dict] = []
    for pattern in validate.SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            doc = load_json(path)
            if doc is not None:
                validate.walk_report_rows(doc, rows)
    return rows


def row_path(row: dict) -> str:
    return str(row.get("path") or row.get("file") or "")


def severity_key(row: dict) -> str:
    raw = str(row.get("severity") or "p1").lower()
    if raw.startswith("p0"):
        return "p0"
    if raw.startswith("p2"):
        return "p2"
    return "p1"


# Card voice follows SAST reports (SARIF shortDescription + message + recommendation).
# Title is the rule name. Risk is "Detected <code> at line N. <impact>."
# Fix is "Replace <code> at line N with: <safe control>."
# Judgment findings follow prompts/llm-judgment-pass.md with the same three fields.
_PROSE = {
    "path_traversal": (
        "传入的路径直接打开文件，能读到目录外面",
        "A caller path is opened directly and can read outside the directory",
        "未限制在基目录内的路径会读到目录外的文件。",
        "A path that is not kept under the base directory reads files outside it.",
        "打开前对路径做 normalize，拒绝不以基目录开头的结果。",
        "Normalize the path before open and reject a result that does not start with the base directory.",
    ),
    "silent_swallow": (
        "异常被吃掉，调用方以为这一步成功了",
        "An exception is swallowed and the caller treats the step as success",
        "失败没有返回，调用方按成功继续。",
        "The failure is not returned, so the caller continues as if it succeeded.",
        "在这一行记录异常并向上返回失败。",
        "Log the exception on this line and return the failure to the caller.",
    ),
    "retry_side_effect": (
        "循环里重试了一次写入或通知，而且这次调用没有幂等键",
        "A loop retried a write or notify, and that call has no idempotency key",
        "同一次写入或通知会再执行一遍。",
        "The same write or notify runs again.",
        "给这次写入或通知加上幂等键，重复调用只保留第一次。",
        "Add an idempotency key to this write or notify so a repeat keeps only the first call.",
    ),
    "n_plus_one": (
        "循环里每条记录各查一次，条数上来后变慢",
        "Each loop item issues its own query, so more items make this slower",
        "查询次数随条数增长，这一步变慢。",
        "Query count grows with the item count, so this step slows down.",
        "把循环里的查询改成循环外的一次批量读取，再按标识填回每一条。",
        "Replace the query inside the loop with one batch read outside it, then fill each item by id.",
    ),
    "string_concat_in_loop": (
        "循环里用 += 累加，数据一多就变慢",
        "A loop accumulates with +=, so more data makes this slower",
        "循环里的 += 会把已有结果反复计算，数据一多就变慢。",
        "+= inside the loop recomputes the value so far, so more data makes this slower.",
        "循环里改为写入预分配的缓冲区，循环结束后再合并一次。",
        "Write into a pre-sized buffer inside the loop and merge once after the loop.",
    ),
    "collection_grow_in_loop": (
        "循环里逐条追加列表，条数上来后反复扩容",
        "A loop appends one item at a time, so the list reallocates as the count grows",
        "列表在循环里逐条扩容，条数上来后变慢。",
        "The list reallocates on each append, so a larger count makes this slower.",
        "按已知条数创建列表，循环里用下标写入。",
        "Allocate the list at the known size and write by index inside the loop.",
    ),
    "xss": (
        "外部文本原样写进页面，会被当成脚本",
        "Untrusted text is written into the page and can run as script",
        "外部文本进入页面后会被浏览器当成脚本执行。",
        "Untrusted text written into the page is executed as script by the browser.",
        "把 innerHTML 写入改成 textContent，或先转义再写入。",
        "Change the innerHTML write to textContent, or escape the text before writing it.",
    ),
}


def _relation_key(row: dict) -> str:
    return str(row.get("pattern_class") or row.get("kind") or row.get("rule_id") or "")


def _is_comment_or_import(snippet: str) -> bool:
    text = snippet.strip()
    if not text:
        return False
    if text.startswith(("import ", "from ", "#", "//", "*", "/*", "Persistence")):
        return True
    return "(" not in text and "=" not in text and not text.startswith(("for ", "while ", "except", "catch"))


def _quote(snippet: str) -> str:
    return " ".join(snippet.split())[:120]


def _surface_card(key: str, snippet: str, line_no: int) -> tuple[str, str, str, str, str, str] | None:
    """A comment or import still names the failure, the one-line harm, and the edit."""
    if not _is_comment_or_import(snippet):
        return None
    text = _quote(snippet)
    where = f"第 {line_no} 行" if line_no else "这一行"
    where_en = f"line {line_no}" if line_no else "this line"
    if key == "retry_side_effect":
        return (
            "循环里重试了一次 persist 写入或通知，而且这次调用没有幂等键",
            "A loop retried a persist write or notify, and that call has no idempotency key",
            f"`{text}` 会把同一次写入再执行一遍。",
            f"`{text}` runs the same write again.",
            f"把{where} `{text}` 里的括号去掉。",
            f"Remove the parenthesis from {where_en} `{text}`.",
        )
    if key == "path_traversal":
        return (
            "import 里的 `../` 直接参与打开文件，能读到目录外面",
            "A `../` in an import is opened as a path and can read outside the directory",
            f"{where}的 `../` 会读到目录外的文件。",
            f"The `../` on {where_en} reads a file outside the directory.",
            f"把{where} `{text}` 改成不含 `../` 的导入。",
            f"Change {where_en} `{text}` to an import without `../`.",
        )
    return None


# SAST report voice (SARIF 2.1 / Semgrep / SonarQube):
# title = rule shortDescription, risk = message ("Detected … This could lead to …"),
# fix = recommendation ("Replace the sink with …").
_SAST: dict[str, tuple[str, str, str, str, str, str]] = {
    "sqli": (
        "SQL 注入", "SQL Injection",
        "查询由字符串拼接而成，调用方输入可以改写 SQL，从而读写结算数据。",
        "The query is built by string concatenation, so caller input can rewrite the SQL and read or change settlement data.",
        "使用 PreparedStatement 占位符绑定参数。",
        "Bind parameters with a PreparedStatement placeholder.",
    ),
    "xss": (
        "跨站脚本", "Cross-Site Scripting",
        "外部文本被原样写入 HTML，浏览器会把它当成脚本执行。",
        "Untrusted text is written into HTML and the browser can execute it as script.",
        "先做 HTML 转义，或改为文本节点写入。",
        "HTML-escape the text, or write it as a text node.",
    ),
    "insecure_tls": (
        "证书校验被关闭", "Certificate Validation Disabled",
        "TLS 对端证书或主机名校验被跳过，流量可以被中间人解密或篡改。",
        "Peer certificate or hostname checks are skipped, so a network intermediary can read or alter the traffic.",
        "使用平台信任库，并校验服务端主机名。",
        "Use the platform trust store and verify the server hostname.",
    ),
    "hardcoded_secret": (
        "硬编码凭证", "Hard-coded Credential",
        "口令或签名密钥写在源码里，拿到代码的人就能连接生产库或伪造商户签名。",
        "A password or signing secret is in source, so anyone with the code can open the production database or forge a merchant signature.",
        "从密钥管理或环境变量读取该凭证，并轮换已经入库的值。",
        "Read the secret from a secret manager or the environment, and rotate the value already in source.",
    ),
    "float_money": (
        "金额使用浮点", "Floating-Point Money",
        "金额经过 double 运算后会产生二进制误差，入账金额和实际金额不一致。",
        "Money computed with double picks up binary rounding error, so the posted amount differs from the real amount.",
        "全程使用 BigDecimal，并显式指定舍入模式。",
        "Keep the amount in BigDecimal and set an explicit rounding mode.",
    ),
    "weak_hash": (
        "弱哈希签名", "Weak Hash Signature",
        "MD5 可以快速碰撞，商户通知签名可以被伪造。",
        "MD5 collides cheaply, so a merchant notification signature can be forged.",
        "改用 HMAC-SHA256，密钥放在服务端配置中。",
        "Use HMAC-SHA256 and keep the key in server configuration.",
    ),
    "bigdecimal_equals": (
        "金额相等比较标度敏感", "Scale-Sensitive Money Equality",
        "BigDecimal.equals 把标度也算进去，500000.00 和 500000.0 会被当成不同限额。",
        "BigDecimal.equals includes scale, so 500000.00 and 500000.0 are treated as different limits.",
        "改用 compareTo 比较金额。",
        "Compare the amount with compareTo.",
    ),
    "path_traversal": (
        "路径穿越", "Path Traversal",
        "账户号直接拼进文件路径，构造后的路径可以写到对账单目录之外。",
        "The account number is concatenated into a file path, so a crafted value can write outside the statement directory.",
        "规范化路径并确认结果仍在对账单基目录内，再打开文件。",
        "Normalize the path and open the file only when the result stays under the statement directory.",
    ),
    "silent_swallow": (
        "异常被吞掉", "Swallowed Exception",
        "catch 后没有记录也没有把失败返回给调用方，调用方会把失败当成成功继续。",
        "The catch neither logs nor returns the failure, so the caller continues as if the step succeeded.",
        "记录异常，并向调用方返回明确的失败结果。",
        "Log the exception and return a distinct failure to the caller.",
    ),
    "missing_protection": (
        "外部调用缺少保护", "Unprotected Remote Call",
        "数据库或远程调用没有超时、熔断或失败隔离，下游卡住时会拖住转账线程。",
        "The database or remote call has no timeout, breaker, or failure isolation, so a stuck dependency holds the transfer thread.",
        "为该调用设置有限超时，并在失败时返回可识别的错误。",
        "Set a finite timeout on the call and return a distinct error on failure.",
    ),
    "null_deref_after_load": (
        "加载结果未判空", "Unchecked Load Result",
        "查询或查找的返回值直接解引用，对象不存在时会抛出空指针，转账被记成系统错误。",
        "A query or lookup result is used directly, so a missing object throws and the transfer is reported as a system error.",
        "使用前判断结果是否为空，为空则返回明确的未找到错误。",
        "Check for a missing result before use and return a distinct not-found error.",
    ),
    "unguarded_parse": (
        "外部输入未校验即解析", "Unvalidated Parse",
        "请求字段直接交给数值解析，缺字段或非数字会抛异常，回调被记成系统错误。",
        "A request field is parsed directly, so a missing or non-numeric value throws and the callback is reported as a system error.",
        "解析前检查字段存在且为合法数字，不合法则拒绝该请求。",
        "Check that the field exists and is a valid number before parsing, and reject the request otherwise.",
    ),
    "disabled_bound": (
        "安全边界被关闭", "Disabled Safety Bound",
        "超时、证书校验或费率开关被编译期常量关掉，运行时配置改不了这个决定。",
        "A timeout, certificate check, or fee switch is forced off by a compile-time constant, so runtime configuration cannot change the decision.",
        "从环境或配置读取该开关，并拒绝 0、负数和固定 false。",
        "Load the switch from the environment or configuration, and reject 0, a negative value, and a fixed false.",
    ),
    "charset_omission": (
        "字节转换未指定字符集", "Unspecified Charset",
        "getBytes 使用平台默认字符集，同一签名或报文在不同主机上会得到不同字节。",
        "getBytes uses the platform default charset, so the same signature or payload differs across hosts.",
        "改为 getBytes(StandardCharsets.UTF_8)。",
        "Use getBytes(StandardCharsets.UTF_8).",
    ),
    "retry_side_effect": (
        "重试缺少幂等键", "Retry Without Idempotency Key",
        "循环会再次发起写入或通知，同一次转账会被执行多遍。",
        "The loop issues the write or notify again, so the same transfer runs more than once.",
        "为该次调用带上幂等键，重复请求只保留第一次结果。",
        "Send an idempotency key with the call so a repeat keeps only the first result.",
    ),
    "retry_without_backoff": (
        "重试没有退避", "Retry Without Backoff",
        "失败后立刻重试，下游故障时会把通知请求连续打满。",
        "Failures retry immediately, so a downstream outage is hit with a burst of notifications.",
        "在重试之间加入退避，并限制总等待时间。",
        "Wait with backoff between attempts and cap the total wait.",
    ),
    "process_default_write": (
        "修改进程级 TLS 默认值", "Process-Wide TLS Default",
        "setDefaultSSLSocketFactory 或主机名校验会作用于本进程之后的全部 HTTPS 调用。",
        "setDefaultSSLSocketFactory or the hostname verifier applies to every later HTTPS call in this process.",
        "只在当前连接上设置套接字工厂和主机名校验。",
        "Set the socket factory and hostname verifier on the current connection only.",
    ),
    "exception_unwrap": (
        "异常被拆成纯文本", "Exception Unwrapped to Text",
        "只抛出 getMessage()，堆栈和异常类型丢失，排障时看不到原始失败点。",
        "Only getMessage() is thrown, so the stack and exception type are lost and the original failure point is gone.",
        "改为 throw new RuntimeException(e)，保留原因异常。",
        "Throw new RuntimeException(e) and keep the cause.",
    ),
    "executor_not_shutdown": (
        "线程池未关闭", "Executor Not Shut Down",
        "单线程池随服务一直存活，进程退出时审计任务会被截断。",
        "The single-thread pool lives with the service, so audit tasks are cut off when the process exits.",
        "在服务关闭时调用 shutdown，并等待队列中的任务结束。",
        "Call shutdown when the service stops and wait for queued tasks to finish.",
    ),
    "close_not_in_finally": (
        "资源未在 finally 中关闭", "Resource Not Closed in finally",
        "流在异常路径上不会关闭，文件句柄会一直占用。",
        "The stream stays open on the exception path, so the file handle remains held.",
        "用 try-with-resources 打开该流。",
        "Open the stream with try-with-resources.",
    ),
    "admin_grant_without_audit": (
        "管理员放行没有审计", "Admin Grant Without an Audit",
        "管理员分支直接返回成功，没有记下操作者、租户和被访问的对象。",
        "The admin branch returns success and does not record the actor, tenant, and objects.",
        "在访问数据之前写入审计，记下操作者、租户和对象。",
        "Write an audit of the actor, tenant, and objects before the admin path touches data.",
    ),
    "tenant_predicate_missing": (
        "按标识读写时没有租户条件", "Id Access Without a Tenant Predicate",
        "类型上有租户字段，按标识查询或更新时没有带上租户条件，别的租户的同号记录会被读写。",
        "The type has a tenant field, and an id query or update omits it, so another tenant's row with the same id can be read or written.",
        "在每条按标识的查询和更新上与服务端租户做与。",
        "AND the server tenant into every id query and update.",
    ),
    "tenant_context_dropped": (
        "异步任务丢掉了租户上下文", "Async Task Drops Tenant Context",
        "交给另一个线程的任务带了业务标识，没有带上租户、操作者和追踪号。",
        "Work handed to another thread carries a business id and does not carry tenant, actor, and trace.",
        "入队前把租户、操作者和追踪号放进任务，工作线程再绑定它们。",
        "Put tenant, actor, and trace on the task before it is queued, and rebind them in the worker.",
    ),
    "tenant_id_only_lookup": (
        "冲正只按业务号取记录", "Reversal Looks Up by Id Alone",
        "冲正或退款只按业务号取记录，没有同时核对租户，知道单号就能动到别的租户。",
        "A reversal or refund loads the row by object id alone, so knowing the id is enough to act on another tenant.",
        "用服务端租户和业务号一起查询，对不上就当作未找到。",
        "Look up by the server tenant and the id together, and treat a mismatch as not found.",
    ),
    "shared_mutable": (
        "共享的非线程安全对象", "Shared Non-Thread-Safe Object",
        "静态 SimpleDateFormat 会被多个转账线程同时 format，结果错乱或抛出异常。",
        "A static SimpleDateFormat is formatted by concurrent transfer threads, so the output is corrupt or the call throws.",
        "改为 DateTimeFormatter，或把格式化器放到线程本地。",
        "Use a DateTimeFormatter, or keep the formatter in thread-local storage.",
    ),
    "collection_grow_in_loop": (
        "循环中列表扩容", "List Growth Inside a Loop",
        "列表在循环里逐条 append，条数变大时会反复拷贝底层数组。",
        "The list appends one item per iteration, so a larger count repeatedly copies the backing array.",
        "按已知条数预分配容量，再写入元素。",
        "Pre-size the list to the known count, then add the elements.",
    ),
    "unpooled_connection": (
        "未使用连接池", "Unpooled JDBC Connection",
        "每次查账都新建一条 JDBC 连接，并发转账会打满数据库连接数。",
        "Each account read opens a new JDBC connection, so concurrent transfers exhaust the database.",
        "改为从连接池获取连接，并在用完后归还。",
        "Take the connection from a pool and return it when finished.",
    ),
    "env_config_gap": (
        "主机地址硬编码", "Hard-coded Host",
        "数据库或网关地址写死在源码里，换环境必须改代码并重新发布。",
        "The database or gateway host is fixed in source, so each environment requires a code change and a new release.",
        "从环境变量或配置服务读取该地址。",
        "Read the host from the environment or a configuration service.",
    ),
    "unused_accumulator": (
        "结果被累积后未使用", "Unused Accumulator",
        "循环把标识写入列表后没有任何读取，调用方看不到哪些记录已经处理。",
        "The loop stores ids in a list that is never read, so the caller cannot see which records were processed.",
        "返回该列表，或删掉这次累积。",
        "Return the list, or remove the accumulation.",
    ),
    "test_flag_uncovered": (
        "开关的另一取值未被测试", "Flag Value Untested",
        "生产开关固定为 false，测试没有覆盖打开后的分支。",
        "The production flag is fixed to false, and tests never run the enabled branch.",
        "为该开关的 true 和 false 各写一条断言。",
        "Add an assertion for both true and false.",
    ),
    "error_payload_candidate": (
        "拒绝结果缺少说明", "Rejection Without a Message",
        "reject 只带回错误码，调用方和日志看不到失败原因。",
        "reject carries only a code, so callers and logs cannot see why it failed.",
        "在拒绝结果中带上错误码和可读说明。",
        "Include both the error code and a readable message on the rejection.",
    ),
    "destructive_ddl": (
        "破坏性删除", "Destructive Delete",
        "DELETE 按调用方传入的天数拼接执行，错误天数会删掉仍需保留的转账。",
        "DELETE concatenates a caller-supplied day count, so a wrong value removes transfers that must be kept.",
        "使用参数化删除，并限制允许的保留天数。",
        "Parameterize the delete and restrict the allowed retention.",
    ),
    "opaque_status_candidate": (
        "状态码含义被压成布尔", "Opaque Status Collapsed to Boolean",
        "账户状态只区分是否为 R，其他状态全部当成未受限。",
        "Account status is only compared with R, so every other status is treated as unrestricted.",
        "按完整状态枚举映射受限、冻结和关闭。",
        "Map the full status enum to restricted, frozen, and closed.",
    ),
    "uncontrolled_log_sink": (
        "日志写入标准输出", "Log Written to stdout",
        "审计日志走 System.out，卡号和账号会进入进程标准输出。",
        "Audit logs go to System.out, so card and account numbers land on the process stdout.",
        "改为带脱敏的审计日志组件。",
        "Write through an audit logger that redacts identifiers.",
    ),
    "eol_import": (
        "过期导入", "End-of-Life Import",
        "使用了已停止维护的导入，后续运行时可能没有对应实现。",
        "The import is no longer maintained, so a later runtime may not provide it.",
        "改为当前维护中的同功能导入。",
        "Switch to the maintained import that provides the same behavior.",
    ),
    "n_plus_one": (
        "循环内逐条查询", "Query per Loop Item",
        "批次里每一笔都单独查一次账户，清算笔数上来后数据库往返成倍增加。",
        "Each batch item loads its account separately, so database round trips grow with the batch size.",
        "循环外按账户号批量查询，再按账号填回每一笔。",
        "Load the accounts once outside the loop, then fill each item by account number.",
    ),
    "string_concat_in_loop": (
        "循环内字符串拼接", "String Concatenation in a Loop",
        "循环里用 += 拼接轨迹，轨迹变长后会反复复制已有字符串。",
        "+= inside the loop recopies the trail as it grows.",
        "改用 StringBuilder，循环结束后一次取出结果。",
        "Use a StringBuilder and take the result once after the loop.",
    ),
    "cache_unbounded": (
        "缓存无上限", "Unbounded Cache",
        "汇率按币种对写入 HashMap，条目只增不删，长时间运行后堆内存持续增长。",
        "Each currency pair is stored in a HashMap that never evicts, so heap use grows for the life of the process.",
        "为缓存设置最大条目数和过期时间。",
        "Cap the cache size and set an expiry.",
    ),
    "weak_perf_test": (
        "性能测试阈值过宽", "Weak Performance Assertion",
        "断言只要求耗时小于 5 秒，退化为秒级时测试仍然通过。",
        "The assertion only requires less than 5 seconds, so a regression into seconds still passes.",
        "改为与基线比较的上界，并固定输入规模。",
        "Assert an upper bound against a baseline and fix the input size.",
    ),
    "test_unreachable": (
        "测试分支不可达", "Unreachable Test Branch",
        "channels[c] == null 在给定数组上永远不成立，这条失败路径没有被执行。",
        "channels[c] == null never holds for the given array, so that failure path never runs.",
        "传入一个真正为空的渠道，并断言该分支的结果。",
        "Pass a channel that is actually null and assert that branch.",
    ),
    "test_no_join": (
        "并发测试未等待线程", "Concurrent Test Without join",
        "线程 start 之后没有 join 就断言缓存大小，写入尚未完成时断言也会通过。",
        "The test asserts cache size after start and without join, so the assertion passes before the writes finish.",
        "在断言前 join 两个线程。",
        "Join both threads before the assertion.",
    ),
    "test_tautology": (
        "断言恒成立", "Tautological Assertion",
        "size >= 1 在只要有一次写入时就成立，数据竞争不会让这条断言失败。",
        "size >= 1 holds after a single write, so a data race does not fail the assertion.",
        "断言两个线程写入的键都在缓存中，并且没有丢失更新。",
        "Assert that keys from both threads are present and that no update was lost.",
    ),
    "prod_test_coupling": (
        "生产类型嵌套测试", "Test Nested in Production Type",
        "测试类写在生产类型里面，测试可以直接改私有余额和缓存。",
        "The test class is nested in the production type, so tests can change private balances and caches.",
        "把测试移到独立的测试源码目录。",
        "Move the test into a separate test source set.",
    ),
    "mixed_responsibility": (
        "生产代码依赖测试框架", "Production Code Depends on a Test Framework",
        "生产类型导入了 JUnit，结算类和测试生命周期绑在一起。",
        "The production type imports JUnit, so the settlement class is tied to the test lifecycle.",
        "去掉生产类型上的测试导入，把测试放到独立类。",
        "Remove the test import from the production type and keep tests in a separate class.",
    ),
    "log_exposure": (
        "日志泄露个人标识", "Personal Identifier in Logs",
        "审计日志写入了卡号或账号，日志采集端可以读到完整标识。",
        "The audit log includes a card or account number, so a log collector can read the full identifier.",
        "日志里只保留标识的后四位或令牌。",
        "Log only the last four digits or a token.",
    ),
    "retention_or_dsar_gap": (
        "个人数据缺少留存期限", "Personal Data Without Retention",
        "卡号、姓名或账号被写入日志、邮件或对账单文件，没有删除期限。",
        "Card number, name, or account number is stored in a log, email, or statement file with no deletion deadline.",
        "为该数据设定保留天数，到期后删除或脱敏。",
        "Set a retention period and delete or redact the data when it expires.",
    ),
    "missing_timeout": (
        "调用没有截止时间", "Call Without a Deadline",
        "数据库或远程调用没有正的超时，对端不返回时线程会一直等待。",
        "The database or remote call has no positive timeout, so a peer that never answers holds the thread.",
        "设置大于 0 的连接超时和读取超时。",
        "Set a connect timeout and a read timeout greater than zero.",
    ),
    "decision_literal": (
        "费率或限额使用字面量", "Fee or Limit Literal",
        "手续费下限、上限或费率写死在判断里，调整收费必须改代码。",
        "A fee floor, cap, or rate is hard-coded in the decision, so a pricing change requires a code edit.",
        "从配置读取该费率或限额，再用于比较。",
        "Load the fee or limit from configuration and compare against that value.",
    ),
    "breaking_announcement_gap": (
        "废弃接口缺少下线说明", "Deprecated API Without a Sunset",
        "公开的余额访问器标了 @Deprecated，但没有替代方法和移除版本。",
        "The public balance accessor is @Deprecated and names neither a replacement nor a removal version.",
        "写成 @Deprecated(since = \"2\", forRemoval = true)，并注明当前余额访问器。",
        "Use @Deprecated(since = \"2\", forRemoval = true) and name the current balance accessor.",
    ),
    "DES-001": (
        "生产类型嵌套测试", "Test Nested in Production Type",
        "测试类写在生产类型里面，测试可以直接改私有余额和缓存。",
        "The test class is nested in the production type, so tests can change private balances and caches.",
        "把测试移到独立的测试源码目录。",
        "Move the test into a separate test source set.",
    ),
}


def _sast_message(spec: tuple[str, str, str, str, str, str], snippet: str, line_no: int) -> tuple[str, str, str, str, str, str]:
    name, name_en, impact, impact_en, remedy, remedy_en = spec
    text = _quote(snippet) if snippet else name
    where = f"第 {line_no} 行" if line_no else "这一处"
    where_en = f"line {line_no}" if line_no else "this location"
    title = name
    title_en = name_en
    risk = f"在{where}检测到 `{text}`。{impact}"
    risk_en = f"Detected `{text}` at {where_en}. {impact_en}"
    fix = f"将{where} `{text}` 改为：{remedy}"
    fix_en = f"Replace `{text}` at {where_en} with: {remedy_en}"
    return title[:180], title_en[:180], risk, risk_en, fix, fix_en


def fixed_sentence(row: dict, snippet: str = "", line_no: int = 0) -> tuple[str, str, str, str, str, str]:
    key = _relation_key(row)
    spec = _SAST.get(key)
    if spec:
        return _sast_message(spec, snippet, line_no)
    surface = _surface_card(key, snippet, line_no)
    if surface:
        return surface
    prose = _PROSE.get(key)
    if prose:
        return prose
    label = key or "静态分析发现"
    return _sast_message(
        (
            label,
            label,
            "该模式会把未校验的数据或控制流送入后续逻辑。",
            "This pattern sends unchecked data or control flow into the following logic.",
            "改为带校验的安全写法。",
            "Use the checked, safe form.",
        ),
        snippet,
        line_no,
    )


def stamp_relation(card: dict, row: dict) -> None:
    if row.get("rule_id"):
        card["rule_id"] = row["rule_id"]
    elif row.get("pattern_class"):
        card["pattern_class"] = row["pattern_class"]
    elif row.get("kind"):
        card["kind"] = row["kind"]
    # Keep the shape beside the rule so two RES-001 kinds stay distinct cards.
    if row.get("kind") and (row.get("rule_id") or row.get("pattern_class")):
        card["kind"] = row["kind"]


def source_line(pack: Path | None, path: str, line: int) -> str:
    """The cited line of this file only. A sibling path must not supply the snippet."""
    if pack is None or not path or line < 1:
        return ""
    ledger = load_json(pack / "24-coverage-ledger.json")
    root = str(ledger.get("source_root") or "") if isinstance(ledger, dict) else ""
    if not root:
        return ""
    full = Path(root) / path
    if not full.is_file():
        return ""
    try:
        lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return ""
    if line > len(lines):
        return ""
    return lines[line - 1].strip()[:220]


def card_for(rows: list[dict], pack: Path | None = None) -> dict:
    """One relation in one file. Lines from other files stay on their own card."""
    first = rows[0]
    path = row_path(first)
    lines: list[int] = []
    for row in rows:
        if row_path(row) != path:
            continue
        number = int(row["line"])
        if number not in lines:
            lines.append(number)
    snippet = source_line(pack, path, lines[0])
    title, title_en, risk, risk_en, fix, fix_en = fixed_sentence(first, snippet, lines[0])
    card = {
        "title": title,
        "title_en": title_en,
        "line": lines[0],
        "risk": risk,
        "risk_en": risk_en,
        "fix": fix,
        "fix_en": fix_en,
        "category": str(first.get("category") or "correctness"),
    }
    if path:
        card["file"] = path
        card["location"] = f"{path}:{lines[0]}"
    else:
        card["location"] = "同一关系的报告行"
    if snippet:
        card["existing_code"] = snippet
    if len(lines) > 1:
        card["same_fix"] = True
        card["also_lines"] = lines[1:]
    stamp_relation(card, first)
    return card


def ensure_lists(conclusion: dict) -> None:
    for key in ("p0", "p1", "p2"):
        if not isinstance(conclusion.get(key), list):
            conclusion[key] = []


def finding_fingerprint(finding: dict) -> str:
    """Identity ignores fields the seal itself mirrors on a later pass."""
    core = {
        "title": finding.get("title"),
        "line": finding.get("line"),
        "file": finding.get("file") or finding.get("path"),
        "kind": finding.get("kind"),
        "pattern_class": finding.get("pattern_class"),
        "rule_id": finding.get("rule_id"),
    }
    return json.dumps(core, ensure_ascii=False, sort_keys=True)


def add_finding(conclusion: dict, card: dict, severity: str) -> None:
    ensure_lists(conclusion)
    fingerprint = finding_fingerprint(card)
    if any(finding_fingerprint(item) == fingerprint for item in conclusion[severity] if isinstance(item, dict)):
        conclusion[f"{severity}_count"] = len(conclusion[severity])
        return
    conclusion[severity].append(card)
    conclusion[f"{severity}_count"] = len(conclusion[severity])


def highest_severity(rows: list[dict]) -> str:
    rank = {"p0": 0, "p1": 1, "p2": 2}
    return min((severity_key(row) for row in rows), key=lambda key: rank[key])


def row_labels(row: dict) -> set[str]:
    return {str(row.get(key) or "") for key in ("kind", "pattern_class", "rule_id")} - {""}


def drift_match(row: dict, skips: list[dict], bare_lines: set[int], paths_at_line: dict[int, set[str]]) -> bool:
    """A drift skip closes only the same path and the same kind, rule, or pattern."""
    line = int(row["line"])
    path = row_path(row)
    labels = row_labels(row)
    for skip in skips:
        if not isinstance(skip, dict) or not isinstance(skip.get("line"), int) or int(skip["line"]) != line:
            continue
        skip_path = str(skip.get("path") or skip.get("file") or "")
        if skip_path and path and skip_path != path:
            continue
        kind = str(skip.get("kind") or "")
        if kind == "branch_drift":
            return True
        if kind and kind in labels:
            return True
    if line in bare_lines and len(paths_at_line.get(line) or ()) <= 1:
        return True
    return False


def row_closed(row: dict, conclusion: dict, validate) -> bool:
    return any(validate.finding_closes(finding, row) for finding in validate.findings_of(conclusion))


def pr_file_status(pack: Path) -> dict[str, str] | None:
    """Three-dot paths only. A file that merely differs from the base tip is not this PR."""
    detail = load_json(pack / "26-review-digest-detail.json")
    if not isinstance(detail, dict):
        return None
    three = detail.get("three_dot")
    if not isinstance(three, dict):
        return None
    status: dict[str, str] = {}
    for path in three.get("content_differs") or []:
        status[str(path)] = "change"
    for path in three.get("only_on_head") or []:
        status[str(path)] = "add"
    return status


def stamp_change_status(conclusion: dict, scope: dict[str, str] | None) -> None:
    if not scope:
        return
    for finding in findings_of_local(conclusion):
        path = str(finding.get("file") or finding.get("path") or "")
        if path in scope:
            finding["change_status"] = scope[path]


def fill_report_cards(
    conclusion: dict,
    pack: Path,
    validate,
    drift_lines: set[int] | None = None,
    drift_skips: list[dict] | None = None,
) -> None:
    groups: dict[str, list[dict]] = {}
    conventions = list(conclusion.get("conventions") or [])
    known = validate.convention_lines(conclusion)
    rows = [row for row in report_rows(pack, validate) if isinstance(row.get("line"), int)]
    paths_at_line: dict[int, set[str]] = {}
    for row in rows:
        paths_at_line.setdefault(int(row["line"]), set()).add(row_path(row))
    bare = drift_lines or set()
    skips = drift_skips or []
    scope = pr_file_status(pack)
    drifted: list[dict] = []
    for row in rows:
        if validate.is_convention_row(row):
            if row["line"] not in known:
                conventions.append({
                    "kind": row.get("kind"),
                    "title": str(row.get("kind") or "convention"),
                    "path": row_path(row),
                    "line": row["line"],
                    "lines": [row["line"]],
                })
                known.add(row["line"])
            continue
        if scope is not None and row_path(row) not in scope:
            drifted.append(row)
            continue
        if drift_match(row, skips, bare, paths_at_line):
            drifted.append(row)
            continue
        if row_closed(row, conclusion, validate):
            continue
        # Same rule_id with a different kind is a different defect. RES-001
        # covers both an unclosed stream and an executor that is never shut down.
        kind = str(row.get("kind") or "")
        groups.setdefault(
            validate.row_relation(row) + "\n" + kind + "\n" + row_path(row), []
        ).append(row)
    if conventions:
        conclusion["conventions"] = conventions
    for grouped in groups.values():
        if not grouped:
            continue
        card = card_for(grouped, pack)
        path = str(card.get("file") or "")
        if scope is not None and path in scope:
            card["change_status"] = scope[path]
        add_finding(conclusion, card, highest_severity(grouped))
    if drifted:
        note = (
            "这些行在三方 diff 之外，是分支落后主干带来的扫描命中，不是本次提交新写的逻辑。"
            "变基后再看三方 diff。不要按这些行去改主干上已经更新的文件。"
        )
        have = {
            (str(item.get("path") or item.get("file") or ""), str(item.get("kind") or ""), int(item["line"]))
            for item in (conclusion.get("line_skips") or [])
            if isinstance(item, dict) and isinstance(item.get("line"), int)
        }
        written = list(conclusion.get("line_skips") or [])
        for row in drifted:
            path = row_path(row)
            key = (path, "branch_drift", int(row["line"]))
            if key in have:
                continue
            have.add(key)
            written.append({"kind": "branch_drift", "path": path, "line": int(row["line"]), "note": note})
        conclusion["line_skips"] = written


def load_judgments(pack: Path, judgment: dict) -> dict:
    """One judgment.json plus concurrent group fragments."""
    merged = {
        "findings": list(judgment.get("findings") or []),
        "suspect_hits": [str(item) for item in (judgment.get("suspect_hits") or [])],
        "suspect_skips": _skip_map(judgment.get("suspect_skips")),
        "test_oracle": list(judgment.get("test_oracle") or []),
    }
    seen = set(merged["suspect_hits"])
    seed = load_json(pack / "judgment-seed.json")
    if isinstance(seed, dict):
        for item in seed.get("suspect_hits") or []:
            text = str(item)
            if text and text not in seen:
                seen.add(text)
                merged["suspect_hits"].append(text)
        for sid, note in _skip_map(seed.get("suspect_skips")).items():
            merged["suspect_skips"].setdefault(sid, note)
        for finding in seed.get("findings") or []:
            if isinstance(finding, dict):
                merged["findings"].append(finding)
    lines = {
        row.get("line")
        for row in merged["test_oracle"]
        if isinstance(row, dict)
    }
    if isinstance(seed, dict):
        for row in seed.get("test_oracle") or []:
            if isinstance(row, dict) and row.get("line") not in lines:
                lines.add(row.get("line"))
                merged["test_oracle"].append(row)
    folder = pack / "judgment-groups"
    if not folder.is_dir():
        return merged
    for path in sorted(folder.glob("*.json")):
        doc = load_json(path)
        if not isinstance(doc, dict):
            continue
        for finding in doc.get("findings") or []:
            if isinstance(finding, dict):
                merged["findings"].append(finding)
        for item in doc.get("suspect_hits") or []:
            text = str(item)
            if text not in seen:
                seen.add(text)
                merged["suspect_hits"].append(text)
        for sid, note in _skip_map(doc.get("suspect_skips")).items():
            merged["suspect_skips"].setdefault(sid, note)
        for row in doc.get("test_oracle") or []:
            if isinstance(row, dict) and row.get("line") not in lines:
                lines.add(row.get("line"))
                merged["test_oracle"].append(row)
    return merged


def _skip_map(raw) -> dict[str, str]:
    found: dict[str, str] = {}
    for item in raw or []:
        if isinstance(item, str) and item:
            found.setdefault(item, "模型判定跳过。")
        elif isinstance(item, dict):
            sid = str(item.get("id") or item.get("derive_suspect_id") or item.get("suspect_id") or "")
            if sid:
                found.setdefault(sid, str(item.get("note") or "模型判定跳过。"))
    return found


def required_suspect_ids(pack: Path) -> list[str]:
    work = pack / "judgment-work"
    if not work.is_dir():
        return []
    found: list[str] = []
    for path in sorted(work.glob("group-*.json")):
        doc = load_json(path)
        if not isinstance(doc, dict):
            continue
        for item in doc.get("required_suspect_ids") or []:
            text = str(item)
            if text and text not in found:
                found.append(text)
    return found


def _symbol_nodes(pack: Path) -> list[dict]:
    doc = load_json(pack / "05-changed-symbols.json")
    if not isinstance(doc, dict):
        return []
    nodes = doc.get("nodes") or doc.get("result", {}).get("nodes") or []
    return [node for node in nodes if isinstance(node, dict)]


def _method_owning(nodes: list[dict], path: str, line: int) -> dict | None:
    best = None
    best_span = None
    for node in nodes:
        if node.get("kind") not in {"method", "function"}:
            continue
        start = node.get("start_line")
        end = node.get("end_line")
        if not isinstance(start, int):
            continue
        if not isinstance(end, int) or end < start:
            end = start
        file_path = str(node.get("file_path") or node.get("path") or "")
        if path and file_path and not (path.endswith(file_path) or file_path.endswith(path)):
            continue
        if not start <= line <= end:
            continue
        span = end - start
        if best is None or best_span is None or span < best_span:
            best = node
            best_span = span
    return best


def _caller_names(pack: Path, nodes: list[dict]) -> dict[str, list[str]]:
    """Callee method name to the methods that call it. File paths are not callers."""
    by_id = {}
    for node in nodes:
        sid = str(node.get("id") or node.get("symbol_id") or "")
        name = str(node.get("name") or "")
        if sid and name:
            by_id[sid] = name
    callers: dict[str, list[str]] = {}
    impact = pack / "impact"
    if not impact.is_dir():
        return callers
    for edges_path in sorted(impact.glob("*/edges-in.json")):
        doc = load_json(edges_path)
        if not isinstance(doc, dict):
            continue
        for edge in doc.get("edges") or []:
            if not isinstance(edge, dict) or str(edge.get("kind") or "") != "calls":
                continue
            src = by_id.get(str(edge.get("from_id") or ""))
            dst = by_id.get(str(edge.get("to_id") or ""))
            if not src or not dst or src == dst:
                continue
            bucket = callers.setdefault(dst, [])
            if src not in bucket:
                bucket.append(src)
    return callers


def _bean_accessor(name: str) -> bool:
    """getX / setX / isX. settleBatch is not a setter."""
    for prefix in ("get", "set", "is"):
        if (
            name.startswith(prefix)
            and len(name) > len(prefix)
            and name[len(prefix)].isupper()
        ):
            return True
    return False


def _test_name(name: str) -> bool:
    return name.startswith("test") or "Should" in name or name in {"setUp", "tearDown", "static"}


def _plain_sentence(text: str, limit: int = 140) -> str:
    sentence = " ".join(str(text or "").split())
    for mark in ("。", ". "):
        cut = sentence.find(mark)
        if 0 <= cut <= limit:
            return sentence[: cut + (1 if mark == "。" else 0)]
    return sentence[:limit]


def fill_regression_tests(conclusion: dict, pack: Path) -> None:
    """Must-test rows are executable paths, not method names alone.

    A conclusion that already names scenarios is left as written. Otherwise
    each changed method that owns a P0 or P1 finding becomes one row, callers
    first. The page header shows the first three.
    """
    existing = [
        row for row in (conclusion.get("regression_tests") or [])
        if isinstance(row, dict) and str(row.get("target") or "").strip()
    ]
    if existing:
        conclusion["regression_tests"] = existing
        return
    nodes = _symbol_nodes(pack)
    callers = _caller_names(pack, nodes)
    grouped: dict[str, dict] = {}
    for severity, finding in (
        (rank, item)
        for rank, key in ((0, "p0"), (1, "p1"))
        for item in (conclusion.get(key) or [])
        if isinstance(item, dict)
    ):
        line = finding.get("line")
        if not isinstance(line, int):
            continue
        path = str(finding.get("file") or finding.get("path") or "")
        method = _method_owning(nodes, path, line)
        if method is None:
            continue
        name = str(method.get("name") or "")
        if not name or _bean_accessor(name) or _test_name(name):
            continue
        got = grouped.get(name)
        if got is None or severity < got["severity"]:
            grouped[name] = {"severity": severity, "finding": finding, "method": method}

    def _production_callers(name: str) -> list[str]:
        return [caller for caller in (callers.get(name) or []) if not _test_name(caller)]

    ranked = sorted(
        grouped.values(),
        key=lambda item: (
            0 if _production_callers(str(item["method"].get("name") or "")) else 1,
            item["severity"],
            int(item["method"].get("start_line") or 0),
        ),
    )
    rows = []
    for item in ranked[:6]:
        method = item["method"]
        finding = item["finding"]
        name = str(method.get("name") or "")
        title = str(finding.get("title") or "这条失败")
        caller_list = [caller for caller in (callers.get(name) or []) if not _test_name(caller)]
        file_path = str(method.get("file_path") or method.get("path") or finding.get("file") or "")
        line = finding.get("line")
        risk = _plain_sentence(str(finding.get("risk") or title))
        if caller_list:
            target = (
                f"从 {'、'.join(caller_list[:3])} 进入 {name}，"
                f"构造会触发「{title}」的输入。期望该入口不再出现这个结果。"
            )
        else:
            target = f"直接调用 {name}，构造会触发「{title}」的输入。期望该入口不再出现这个结果。"
        rows.append({
            "target": target,
            "why": risk or title,
            "evidence": (
                f"{file_path} 的 {name} 在第 {line} 行。"
                + ("调用方：" + "、".join(caller_list) + "。" if caller_list else "图上没有记录其它方法调用它。")
            ),
        })
    if rows:
        conclusion["regression_tests"] = rows


def fill_english(conclusion: dict) -> None:
    """The model writes each sentence once. The English field mirrors it when empty."""
    for row in conclusion.get("regression_tests") or []:
        if not isinstance(row, dict):
            continue
        for src, dst in (("target", "target_en"), ("why", "why_en"), ("evidence", "evidence_en")):
            if row.get(src) and not row.get(dst):
                row[dst] = row[src]
    for finding in findings_of_local(conclusion):
        for src, dst in (
            ("title", "title_en"),
            ("risk", "risk_en"),
            ("fix", "fix_en"),
            ("evidence", "evidence_en"),
            ("outcome", "outcome_en"),
            ("actor", "actor_en"),
            ("input", "input_en"),
        ):
            if finding.get(src) and not finding.get(dst):
                finding[dst] = finding[src]


def findings_of_local(conclusion: dict) -> list[dict]:
    rows = []
    for key in ("p0", "p1", "p2"):
        for item in conclusion.get(key) or []:
            if isinstance(item, dict):
                rows.append(item)
    return rows


def fill_callers(conclusion: dict, pack: Path) -> None:
    """Call chains come from neighbor groups already in the packet. Do not invent edges."""
    packet = load_json(pack / "29-judgment-packet.json")
    if not isinstance(packet, dict):
        return
    by_file: dict[str, list[str]] = {}
    for group in packet.get("neighbor_groups") or []:
        if not isinstance(group, dict):
            continue
        paths = [str(item) for item in (group.get("paths") or []) if item]
        own = str(group.get("file") or "")
        if own and paths:
            by_file.setdefault(own, [])
            for path in paths:
                if path not in by_file[own]:
                    by_file[own].append(path)
    for finding in findings_of_local(conclusion):
        if finding.get("call_chain") or finding.get("callers"):
            continue
        path = str(finding.get("file") or finding.get("path") or "")
        callers = list(by_file.get(path) or [])
        impact = pack / "impact"
        if impact.is_dir():
            for edges_path in sorted(impact.glob("*/edges-in.json")):
                doc = load_json(edges_path)
                if not isinstance(doc, dict):
                    continue
                for edge in doc.get("edges") or []:
                    if not isinstance(edge, dict):
                        continue
                    if str(edge.get("to_file") or "") != path:
                        continue
                    caller = str(edge.get("from_file") or "")
                    if caller and caller not in callers:
                        callers.append(caller)
        if callers:
            finding["callers"] = callers
            finding["call_chain"] = {
                "title": "谁会走到这一行",
                "title_en": "Who reaches this line",
                "paths": [[caller, path] for caller in callers],
                "focus": [path],
            }


def merge_judgment(conclusion: dict, judgment: dict) -> None:
    for finding in judgment.get("findings") or []:
        if not isinstance(finding, dict):
            continue
        add_finding(conclusion, finding, severity_key(finding))


def fill_hashes(conclusion: dict, pack: Path, validate) -> None:
    ledger = load_json(pack / "24-coverage-ledger.json")
    if not isinstance(ledger, dict):
        return
    by_id = {}
    for row in conclusion.get("coverage_closure") or []:
        if isinstance(row, dict) and row.get("symbol_id"):
            by_id[str(row["symbol_id"])] = dict(row)
    finding_ids = {
        str(finding.get("symbol_id"))
        for finding in validate.findings_of(conclusion)
        if finding.get("symbol_id")
    }
    changed = False
    for row in ledger.get("symbols") or []:
        if not isinstance(row, dict) or row.get("status") != "pending" or not row.get("symbol_id"):
            continue
        changed = True
        sid = str(row["symbol_id"])
        got = by_id.get(sid) or {"symbol_id": sid, "open_result": "none"}
        by_id[sid] = got
        if got.get("status") not in {"reviewed", "failed"}:
            got["status"] = "reviewed"
        if sid in finding_ids:
            got["open_result"] = "hit"
        elif got.get("open_result") not in {"hit", "none"}:
            got["open_result"] = "none"
        src = validate.source_file(ledger, row)
        ranges = validate.symbol_ranges(row)
        if src is None or not ranges:
            got["span_check"] = "unverified"
            got.pop("span_hash", None)
            continue
        try:
            lines = src.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            got["span_check"] = "unverified"
            got.pop("span_hash", None)
            continue
        got["span_hash"] = validate.span_hash(lines, ranges)
        got.pop("span_check", None)
    if changed or by_id:
        conclusion["coverage_closure"] = list(by_id.values())


_GAP_BUCKETS = {"untested-production-symbols", "untested-behavior"}


def _node_index(nodes: list[dict]) -> dict:
    indexed = {}
    for index, node in enumerate(nodes):
        indexed[node.get("node_idx", index)] = node
    return indexed


def _is_constructor(node: dict, indexed: dict) -> bool:
    name = str(node.get("name") or "")
    parent_idx = node.get("parent_idx")
    parent = indexed.get(parent_idx) if isinstance(parent_idx, int) else None
    return bool(parent and parent.get("kind") == "class" and parent.get("name") == name)


def _is_private(node: dict) -> bool:
    modifiers = node.get("modifiers")
    if isinstance(modifiers, int):
        return bool(modifiers & 2)
    if isinstance(modifiers, str):
        return "private" in modifiers.lower()
    if isinstance(modifiers, list):
        return any("private" == str(item).lower() for item in modifiers)
    return False


def _gap_table_name(node: dict, indexed: dict) -> bool:
    """A name listed in test_gaps.symbols. Initializers, types, accessors, and private helpers are waived. The HTML report does not render this list."""
    if node.get("kind") not in {"method", "function"}:
        return False
    name = str(node.get("name") or "")
    if not name or name in {"static", "<clinit>", "<init>"}:
        return False
    if _is_constructor(node, indexed) or _bean_accessor(name) or _is_private(node):
        return False
    return True


def fill_test_gaps(conclusion: dict, pack: Path, validate) -> None:
    doc = load_json(pack / "05-changed-symbols.json")
    if not isinstance(doc, dict):
        return
    nodes = doc.get("nodes") or doc.get("result", {}).get("nodes") or []
    indexed = _node_index([node for node in nodes if isinstance(node, dict)])
    shown: list[str] = []
    waived: list[str] = []
    seen: set[str] = set()
    for node in validate.production_methods(doc):
        name = str(node.get("name") or "")
        if not name or name in seen:
            continue
        seen.add(name)
        if _gap_table_name(node, indexed):
            shown.append(name)
        else:
            waived.append(name)
    hand = []
    for row in conclusion.get("test_gaps") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("symbol") or "") in _GAP_BUCKETS or row.get("symbols") or row.get("waived_symbols"):
            continue
        hand.append(row)
    if not shown and not waived and not hand:
        return
    bucket = {
        "symbol": "untested-behavior",
        "symbol_en": "untested-behavior",
        "symbols": shown,
        "waived_symbols": waived,
        "tested_count": "0",
        "tests_reach": "empty",
        "tests_reach_en": "No accepted test edge",
        "note": "这些方法在调用图上没有测试边。初始化块、构造器、访问器和 private 辅助方法不单列。",
        "note_en": "These methods have no accepted test edge. Initializers, constructors, accessors, and private helpers are not separate rows.",
    }
    conclusion["test_gaps"] = hand + ([bucket] if shown or waived else [])


def fill_shapes(conclusion: dict, pack: Path, validate) -> None:
    counts = validate.load_shape_counts(Path(__file__).resolve().parents[2])
    by_rule: dict[str, list[dict]] = {}
    for row in report_rows(pack, validate):
        rule_id = str(row.get("rule_id") or "")
        if rule_id and isinstance(row.get("line"), int):
            by_rule.setdefault(rule_id, []).append(row)
    needed = set(by_rule)
    for finding in validate.findings_of(conclusion):
        rule_id = str(finding.get("rule_id") or "")
        if rule_id and not rule_id.startswith("sast:"):
            needed.add(rule_id)
    coverage = [row for row in (conclusion.get("rule_coverage") or []) if isinstance(row, dict)]
    by_id = {str(row.get("rule_id")): row for row in coverage}
    scope = pr_file_status(pack)
    for rule_id in sorted(needed):
        count = counts.get(rule_id, 1)
        existing = by_id.get(rule_id)
        if existing and count <= 1:
            continue
        kinds: dict[str, list[int]] = {}
        drifted_kinds: dict[str, list[int]] = {}
        for row in by_rule.get(rule_id, []):
            kind = str(row.get("kind") or "report")
            line = int(row["line"])
            outside = scope is not None and row_path(row) not in scope
            if outside:
                drifted_kinds.setdefault(kind, []).append(line)
            else:
                kinds.setdefault(kind, []).append(line)
        built = []
        for kind, lines in kinds.items():
            built.append({"result": "hit", "lines": lines, "note": kind})
        for kind, lines in drifted_kinds.items():
            if kind in kinds:
                continue
            built.append({
                "result": "skip",
                "lines": lines,
                "note": f"{kind} 只出现在本次三方 diff 之外的文件，不作为本次发现",
            })
        while len(built) < count:
            built.append({"result": "skip", "lines": [], "note": "没有该种报告行"})
        entry = {
            "rule_id": rule_id,
            "result": "hit" if any(shape["result"] == "hit" for shape in built) else "skip",
            "note": "脚本按报告行的 kind 分形",
            "shapes": built,
        }
        if existing is None:
            coverage.append(entry)
            by_id[rule_id] = entry
        else:
            existing.clear()
            existing.update(entry)
    if coverage:
        conclusion["rule_coverage"] = coverage


def oracle_payload(provided) -> dict | None:
    """Flags live under oracle. A row that still carries them at the top level is accepted."""
    if not isinstance(provided, dict):
        return None
    nested = provided.get("oracle")
    if isinstance(nested, dict):
        return nested
    if any(key in provided for key in (
        "unsafe_pass", "boundary_missed", "branch_uncovered",
        "locks_private", "locks_dependency", "threshold_pass", "observability_asserted",
    )):
        return provided
    return None


def oracle_flags(row: dict, provided: dict | None) -> dict:
    flags = {}
    for key in ("unsafe_pass", "boundary_missed", "branch_uncovered"):
        value = provided.get(key) if isinstance(provided, dict) else None
        flags[key] = value if isinstance(value, bool) else False
    for key in row.get("questions") or []:
        value = provided.get(key) if isinstance(provided, dict) else None
        flags[str(key)] = value if isinstance(value, bool) else False
    return flags


def fill_oracle(conclusion: dict, pack: Path, judgment: dict) -> None:
    doc = load_json(pack / "18-maintainability-signals.json")
    if not isinstance(doc, dict):
        return
    inventory = [row for row in (doc.get("test_oracle_inventory") or []) if isinstance(row, dict)]
    if not inventory:
        return
    answers = {}
    for row in judgment.get("test_oracle") or []:
        if isinstance(row, dict) and isinstance(row.get("line"), int):
            answers[row["line"]] = row
    coverage = [row for row in (conclusion.get("test_oracle_coverage") or []) if isinstance(row, dict)]
    by_line = {row["line"]: row for row in coverage if isinstance(row.get("line"), int)}
    for row in inventory:
        line = row.get("line")
        if not isinstance(line, int):
            continue
        provided = answers.get(line)
        incoming = oracle_payload(provided)
        existing = by_line.get(line)
        if existing is None:
            oracle = oracle_flags(row, incoming)
            result = "hit" if any(oracle.values()) else "skip"
            note = str(provided.get("note") or "") if isinstance(provided, dict) else ""
            if result == "skip" and not note:
                note = "脚本默认跳过：模型未把这条测试标成 oracle hit。"
            item = {"path": row_path(row), "line": line, "result": result, "oracle": oracle, "note": note}
            coverage.append(item)
            by_line[line] = item
            continue
        oracle = existing.get("oracle") if isinstance(existing.get("oracle"), dict) else {}
        for key, value in oracle_flags(row, incoming).items():
            if value is True:
                oracle[key] = True
            elif not isinstance(oracle.get(key), bool):
                oracle[key] = value
        existing["oracle"] = oracle
        result = "hit" if any(value is True for value in oracle.values()) else "skip"
        existing["result"] = result
        if result == "hit" and str(existing.get("note") or "").startswith("脚本默认跳过"):
            existing["note"] = str(provided.get("note") or "") if isinstance(provided, dict) else ""
        elif result == "skip" and not str(existing.get("note") or "").strip():
            existing["note"] = "脚本默认跳过：模型未把这条测试标成 oracle hit。"
    conclusion["test_oracle_coverage"] = coverage


def suspect_id(row: dict) -> str:
    explicit = str(row.get("derive_suspect_id") or row.get("suspect_id") or "")
    if explicit:
        return explicit
    return f"{row.get('kind') or ''}:{row_path(row)}:{row.get('line')}"


def per_line_rows(pack: Path, validate) -> list[dict]:
    """Suspects live under derive_suspects, which the family walk skips."""
    rows: list[dict] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            if node.get("close") == "per_line" and isinstance(node.get("line"), int):
                rows.append(node)
            for key, child in node.items():
                if key in validate.SKIP_KEYS and key != "derive_suspects":
                    continue
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    for pattern in validate.SIGNAL_GLOBS:
        for path in sorted(pack.glob(pattern)):
            doc = load_json(path)
            if doc is not None:
                walk(doc)
    return rows


def confirmed_stays_convention(row: dict) -> bool:
    """Display constants and bare literals are not P1 cards."""
    kind = str(row.get("kind") or "")
    if kind in _CONVENTION_KINDS:
        return True
    if kind != "decision_literal":
        return False
    snippet = str(row.get("snippet") or row.get("evidence") or row.get("slice") or "")
    return _BUSINESS_LITERAL.search(snippet) is None


def add_convention(conclusion: dict, row: dict, validate) -> None:
    line = int(row["line"])
    known = validate.convention_lines(conclusion)
    if line in known:
        return
    conventions = list(conclusion.get("conventions") or [])
    conventions.append({
        "kind": str(row.get("kind") or "magic_number"),
        "title": str(row.get("kind") or "convention"),
        "path": row_path(row),
        "line": line,
        "lines": [line],
    })
    conclusion["conventions"] = conventions


def fill_suspects(conclusion: dict, pack: Path, judgment: dict, validate) -> None:
    confirmed = {str(item) for item in (judgment.get("suspect_hits") or [])}
    skipped = judgment.get("suspect_skips") if isinstance(judgment.get("suspect_skips"), dict) else {}
    required = set(required_suspect_ids(pack))
    skips = [row for row in (conclusion.get("line_skips") or []) if isinstance(row, dict)]
    have = {
        (str(row.get("kind") or ""), int(row["line"]))
        for row in skips
        if isinstance(row.get("line"), int)
    }
    note = "未确认的嫌疑。模型没有把这个 id 标成真阳性。"
    unanswered = []
    for row in per_line_rows(pack, validate):
        if row.get("close") != "per_line" or not isinstance(row.get("line"), int):
            continue
        kind = str(row.get("kind") or "")
        key = (kind, int(row["line"]))
        sid = suspect_id(row)
        if sid in confirmed:
            if confirmed_stays_convention(row):
                add_convention(conclusion, row, validate)
            elif not row_closed(row, conclusion, validate):
                add_finding(conclusion, card_for([row], pack), severity_key(row))
            continue
        if sid in skipped:
            if key not in have and ("", int(row["line"])) not in have:
                have.add(key)
                skips.append({"kind": kind, "line": int(row["line"]), "note": skipped[sid]})
            continue
        if sid in required:
            unanswered.append(sid)
            continue
        if key in have or ("", int(row["line"])) in have:
            continue
        have.add(key)
        skips.append({"kind": kind, "line": int(row["line"]), "note": note})
    conclusion["line_skips"] = skips
    if unanswered:
        conclusion["unanswered_required_suspects"] = unanswered


def _signal(pack: Path, name: str) -> dict:
    doc = load_json(pack / name)
    return doc if isinstance(doc, dict) else {}


def _signal_rows(doc: dict, key: str) -> list[dict]:
    raw = doc.get(key)
    if not isinstance(raw, list):
        return []
    return [row for row in raw if isinstance(row, dict)]


def _one_line(row: dict) -> str:
    text = str(row.get("snippet") or row.get("name") or row.get("coord") or row.get("kind") or "")
    return " ".join(text.split())[:90]


def _samples(rows: list[dict], limit: int = 2) -> str:
    parts = []
    for row in rows:
        line = _one_line(row)
        if line and line not in parts:
            parts.append(line)
        if len(parts) >= limit:
            break
    return "；".join(parts)


def _missing(obj: dict, key: str) -> bool:
    return not str(obj.get(key) or "").strip()


def _put(obj: dict, key: str, value: str) -> None:
    if value and _missing(obj, key):
        obj[key] = value


def _dim_incomplete(existing: object) -> bool:
    """A hand-written card with a verdict and a risk stays. An empty object is filled."""
    if not isinstance(existing, dict):
        return True
    verdict = str(existing.get("verdict") or "").strip()
    prose = str(existing.get("risk") or existing.get("drivers") or "").strip()
    return not verdict or not prose


def fill_dimensions(conclusion: dict, pack: Path) -> None:
    """Write dimension sections from signal files when the conclusion left them empty.

    The judgment pass does not write these essays. Render only shows a section
    that already exists here with a non-ok verdict, so leaving the key out drops
    the whole dimension from the HTML.
    """
    _fill_risk_tier(conclusion, pack)
    _fill_design_fit(conclusion, pack)
    _fill_complexity(conclusion, pack)
    _fill_dependencies(conclusion, pack)
    _fill_resilience(conclusion, pack)
    _fill_privacy(conclusion, pack)
    _fill_rollout(conclusion, pack)
    _fill_performance(conclusion, pack)
    _fill_observability(conclusion, pack)
    _fill_contract(conclusion, pack)
    _fill_maintainability(conclusion, pack)
    _fill_llm_dimension(conclusion, pack)


def _fill_risk_tier(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "20-risk-tier.json")
    if not doc:
        return
    existing = conclusion.get("risk_tier")
    card = existing if isinstance(existing, dict) else {}
    tier = str(doc.get("tier") or "")
    industry = str(doc.get("industry_tier") or "")
    depth = doc.get("review_depth") if isinstance(doc.get("review_depth"), dict) else {}
    floor = str(depth.get("evidence_floor") or "")
    _put(card, "tier", tier)
    _put(card, "industry_tier", industry)
    _put(card, "evidence_floor", floor)
    surfaces = doc.get("drivers") if isinstance(doc.get("drivers"), dict) else {}
    rollout = surfaces.get("rollout_surfaces") if isinstance(surfaces.get("rollout_surfaces"), dict) else {}
    raised = [name for name, flag in rollout.items() if flag]
    path_tiers = [row for row in (doc.get("file_tiers") or []) if isinstance(row, dict) and row.get("path")]
    path_tier = str(path_tiers[0].get("tier") or "") if path_tiers else ""
    if raised:
        joined = "、".join(raised)
        risk = f"20-risk-tier 因 {joined} 升到 {tier or '当前档'}。"
        risk_en = f"20-risk-tier raised this to {tier or 'the current tier'} because of {joined}."
        if path_tier:
            risk += f"文件路径本身是 {path_tier}。"
            risk_en += f" The file path alone is {path_tier}."
    else:
        risk = f"20-risk-tier 给出 {tier or '未分档'}。"
        risk_en = f"20-risk-tier assigned {tier or 'no tier'}."
    _put(card, "risk", risk)
    _put(card, "risk_en", risk_en)
    _put(card, "evidence", "20-risk-tier.json")
    _put(card, "evidence_en", "20-risk-tier.json")
    _put(card, "signals_file", "20-risk-tier.json")
    conclusion["risk_tier"] = card


def _fill_design_fit(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "10-design-fit-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("design_fit")):
        return
    maintain = _signal(pack, "18-maintainability-signals.json")
    tests = _signal_rows(maintain, "prod_test_coupling")
    nested = _signal_rows(doc, "dead_nested_candidates")
    cross = _signal_rows(doc, "import_cross_layer") + _signal_rows(doc, "nested_type_cross_layer")
    if not nested and not cross and not tests and doc.get("signals_thin") is True:
        return
    layers = doc.get("layer_summary") if isinstance(doc.get("layer_summary"), dict) else {}
    layer_name = "、".join(str(key) for key in layers) or "未标注层"
    card: dict = {"verdict": "concern", "signals_file": "10-design-fit-signals.json"}
    bits = [f"变更落在{layer_name}，共 {doc.get('file_count') or 1} 个文件。"]
    bits_en = [f"The change sits in {layer_name}, across {doc.get('file_count') or 1} file(s)."]
    if tests:
        bits.append("生产类型里嵌了测试。")
        bits_en.append("A test type is nested in production code.")
    if cross:
        bits.append(f"跨层引用 {len(cross)} 处。")
        bits_en.append(f"{len(cross)} cross-layer reference(s).")
    card["risk"] = "".join(bits)
    card["risk_en"] = " ".join(bits_en)
    card["sections"] = {
        "layer": {
            "verdict": "concern",
            "risk": f"解析到的层是{layer_name}。跨层导入 {len(_signal_rows(doc, 'import_cross_layer'))} 条，存储和外部调用没有单独的层。",
            "risk_en": f"The resolved layer is {layer_name}. Cross-layer imports: {len(_signal_rows(doc, 'import_cross_layer'))}. Storage and outbound calls have no separate layer.",
            "evidence": "10-design-fit-signals.json",
            "evidence_en": "10-design-fit-signals.json",
        }
    }
    if nested or tests:
        card["sections"]["over_engineering"] = {
            "verdict": "concern",
            "risk": f"{len(nested)} 个嵌套类型或方法堆在同一文件里。",
            "risk_en": f"{len(nested)} nested types or methods are packed into the same file.",
            "evidence": "10-design-fit-signals.json",
            "evidence_en": "10-design-fit-signals.json",
        }
    card["evidence"] = "10-design-fit-signals.json"
    card["evidence_en"] = "10-design-fit-signals.json"
    conclusion["design_fit"] = card


def _fill_complexity(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "11-complexity-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("complexity")):
        return
    hot = _signal_rows(doc, "hot_methods")
    hints = _signal_rows(doc, "yagni_hints")
    if not hot and not hints:
        return
    names = "、".join(str(row.get("name") or "") for row in hot[:3] if row.get("name"))
    detail = []
    detail_en = []
    for row in hot[:2]:
        detail.append(f"{row.get('name')} 有 {row.get('decisions', 0)} 个分支、{row.get('loc', 0)} 行")
        detail_en.append(f"{row.get('name')} has {row.get('decisions', 0)} decisions and {row.get('loc', 0)} lines")
    card = {
        "verdict": "concern",
        "risk": (f"热点方法 {names}。" + "；".join(detail) + "。") if detail else f"有 {len(hot)} 个热点方法。",
        "risk_en": (f"Hot methods: {names}. " + "; ".join(detail_en) + ".") if detail_en else f"{len(hot)} hot method(s).",
        "signals_file": "11-complexity-signals.json",
        "evidence": f"11-complexity-signals.json 有 {len(hot)} 个热点方法。",
        "evidence_en": f"11-complexity-signals.json lists {len(hot)} hot method(s).",
    }
    if hints:
        card["yagni"] = f"{len(hints)} 条过早抽象或无调用方线索。"
        card["yagni_en"] = f"{len(hints)} premature-abstraction or no-caller hint(s)."
    conclusion["complexity"] = card


def _fill_dependencies(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "12-dependency-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("dependencies")):
        return
    eol = _signal_rows(doc, "eol_imports")
    floating = _signal_rows(doc, "snapshot_or_floating")
    if not eol and not floating and doc.get("signals_thin") is True:
        return
    coord = str(eol[0].get("coord") or "") if eol else ""
    note = str(eol[0].get("note") or "") if eol else ""
    summary = doc.get("summary") if isinstance(doc.get("summary"), dict) else {}
    manifest_hits = int(summary.get("manifest_hit_count") or 0)
    card = {
        "verdict": "concern",
        "risk": (
            f"生产代码依赖已停止维护的 {coord}。{note} 没有锁文件，不能据此声称存在某个 CVE。"
            if eol else
            "依赖信号指出清单或版本没有锁定，不能据此声称存在某个 CVE。"
        ),
        "risk_en": (
            f"Production code depends on unmaintained {coord}. {note} There is no lockfile, so this review does not claim a CVE."
            if eol else
            "Dependency signals show an unlocked manifest or version, so this review does not claim a CVE."
        ),
        "necessity": "旧坐标只为少量调用引入。" if eol else "",
        "necessity_en": "The old coordinate is pulled in for a small call site." if eol else "",
        "reproducibility": "没有构建清单，无法核对版本锁定。" if manifest_hits == 0 else "清单已出现，仍需核对锁文件。",
        "reproducibility_en": "No build manifest, so version locks cannot be checked." if manifest_hits == 0 else "A manifest is present; the lockfile still needs a check.",
        "license": "没有许可证清单。" if not _signal_rows(doc, "license_hints") else f"许可证线索 {len(_signal_rows(doc, 'license_hints'))} 条。",
        "license_en": "No license inventory." if not _signal_rows(doc, "license_hints") else f"{len(_signal_rows(doc, 'license_hints'))} license hint(s).",
        "vuln_posture": "本地没有依赖审计结果，不编造 CVE。",
        "vuln_posture_en": "No local dependency audit result, so no CVE is invented.",
        "evidence": "12-dependency-signals.json eol_imports" if eol else "12-dependency-signals.json",
        "evidence_en": "12-dependency-signals.json eol_imports" if eol else "12-dependency-signals.json",
        "signals_file": "12-dependency-signals.json",
    }
    conclusion["dependencies"] = card


def _fill_resilience(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "14-resilience-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("resilience")):
        return
    swallows = _signal_rows(doc, "silent_swallows")
    timeouts = _signal_rows(doc, "timeout_gaps")
    retries = _signal_rows(doc, "retry_risks")
    protection = _signal_rows(doc, "protection_gaps")
    partial = _signal_rows(doc, "partial_failure_gaps")
    idem = _signal_rows(doc, "idempotency_gaps") + _signal_rows(doc, "retry_side_effects")
    if not any((swallows, timeouts, retries, protection, partial, idem)):
        return
    card = {
        "verdict": "concern",
        "risk": f"静默吞异常 {len(swallows)} 处，超时缺口 {len(timeouts)} 处，重试 {len(retries)} 处。",
        "risk_en": f"{len(swallows)} swallowed exception(s), {len(timeouts)} timeout gap(s), {len(retries)} retry site(s).",
        "silent_swallow": f"{len(swallows)} 处 catch 没有把失败交回调用方。" + (f" 例如 {_samples(swallows, 1)}。" if swallows else ""),
        "silent_swallow_en": f"{len(swallows)} catch site(s) do not return the failure." + (f" Example: {_samples(swallows, 1)}." if swallows else ""),
        "timeouts": f"超时缺口 {len(timeouts)} 处。" + (f" 例如 {_samples(timeouts, 1)}。" if timeouts else "信号里没有超时缺口。"),
        "timeouts_en": f"{len(timeouts)} timeout gap(s)." + (f" Example: {_samples(timeouts, 1)}." if timeouts else " No timeout gap in the signals."),
        "retries": f"重试 {len(retries)} 处。" + (f" 例如 {_samples(retries, 1)}。" if retries else "信号里没有重试。"),
        "retries_en": f"{len(retries)} retry site(s)." + (f" Example: {_samples(retries, 1)}." if retries else " No retry in the signals."),
        "degradation": f"资金路径上的外部调用缺少熔断或降级，保护缺口 {len(protection)} 处。" if protection else "信号里没有降级或熔断缺口。",
        "degradation_en": f"External calls on this path have no breaker or fallback; protection gaps: {len(protection)}." if protection else "No degradation or breaker gap in the signals.",
        "partial_failure": f"部分失败缺口 {len(partial)} 处。" if partial else "信号里没有单独的部分失败条目。",
        "partial_failure_en": f"{len(partial)} partial-failure gap(s)." if partial else "No separate partial-failure row in the signals.",
        "idempotency": f"缺少幂等键的写入或通知 {len(idem)} 处。" if idem else "信号里没有幂等缺口。",
        "idempotency_en": f"{len(idem)} write or notify call(s) have no idempotency key." if idem else "No idempotency gap in the signals.",
        "evidence": "14-resilience-signals.json",
        "evidence_en": "14-resilience-signals.json",
        "signals_file": "14-resilience-signals.json",
    }
    conclusion["resilience"] = card


def _fill_privacy(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "13-privacy-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("privacy")):
        return
    logs = _signal_rows(doc, "log_exposure")
    retention = _signal_rows(doc, "retention_gaps")
    consent = _signal_rows(doc, "consent_or_transfer_hints")
    if not logs and not retention and not consent:
        return
    card = {
        "verdict": "concern",
        "risk": f"日志暴露 {len(logs)} 处，留存缺口 {len(retention)} 处。",
        "risk_en": f"{len(logs)} log exposure(s) and {len(retention)} retention gap(s).",
        "minimization": "日志或回单写出了可识别字段，超出完成该动作所需的范围。" if logs else "信号里没有最小化标记。",
        "minimization_en": "Logs or receipts include an identifier beyond what the action needs." if logs else "No minimization flag in the signals.",
        "logging": (f"审计日志拼接了标识。例如 {_samples(logs, 1)}。" if logs else "信号里没有日志暴露。"),
        "logging_en": (f"The audit log concatenates an identifier. Example: {_samples(logs, 1)}." if logs else "No log exposure in the signals."),
        "retention": f"留存或删除缺口 {len(retention)} 处。" if retention else "信号里没有留存缺口。",
        "retention_en": f"{len(retention)} retention or deletion gap(s)." if retention else "No retention gap in the signals.",
        "consent_transfer": f"传出个人数据的线索 {len(consent)} 处，没有同意或目的限制信号。" if consent else "信号里没有同意或跨境线索。",
        "consent_transfer_en": f"{len(consent)} hint(s) of personal data leaving the system, with no consent or purpose limit." if consent else "No consent or transfer hint in the signals.",
        "evidence": "13-privacy-signals.json",
        "evidence_en": "13-privacy-signals.json",
        "signals_file": "13-privacy-signals.json",
    }
    conclusion["privacy"] = card


def _fill_rollout(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "15-rollout-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("rollout")):
        return
    migrations = _signal_rows(doc, "schema_migrations")
    dual = _signal_rows(doc, "dual_write_gaps")
    flags = _signal_rows(doc, "feature_flag_gaps")
    compat = _signal_rows(doc, "compat_window_gaps")
    breaking = _signal_rows(doc, "breaking_announcement_gaps")
    rollback = _signal_rows(doc, "rollback_gaps")
    env = _signal_rows(doc, "env_config_gaps")
    if not any((migrations, dual, flags, compat, breaking, rollback, env)):
        return
    card = {
        "verdict": "concern",
        "risk": f"破坏性变更 {len(migrations)} 处，回滚缺口 {len(rollback)} 处，环境地址硬编码 {len(env)} 处。",
        "risk_en": f"{len(migrations)} destructive change(s), {len(rollback)} rollback gap(s), {len(env)} hard-coded host(s).",
        "migrations": (f"破坏性语句 {len(migrations)} 处。例如 {_samples(migrations, 1)}。" if migrations else "信号里没有迁移。"),
        "migrations_en": (f"{len(migrations)} destructive statement(s). Example: {_samples(migrations, 1)}." if migrations else "No migration in the signals."),
        "dual_write": f"双写缺口 {len(dual)} 处，新旧字段没有同时写入。" if dual else "信号里没有双写缺口。",
        "dual_write_en": f"{len(dual)} dual-write gap(s); old and new fields are not written together." if dual else "No dual-write gap in the signals.",
        "feature_flags": f"特性开关缺口 {len(flags)} 处，危险路径不能在运行时关掉。" if flags else "信号里没有特性开关缺口。",
        "feature_flags_en": f"{len(flags)} feature-flag gap(s); the risky path cannot be turned off at runtime." if flags else "No feature-flag gap in the signals.",
        "compat_window": (f"废弃接口没有兼容窗口，{len(compat)} 处。例如 {_samples(compat, 1)}。" if compat else "信号里没有兼容窗口缺口。"),
        "compat_window_en": (f"Deprecated API without a compatibility window: {len(compat)}. Example: {_samples(compat, 1)}." if compat else "No compatibility-window gap in the signals."),
        "breaking_announce": f"破坏性公告缺口 {len(breaking)} 处。" if breaking else "信号里没有破坏性公告缺口。",
        "breaking_announce_en": f"{len(breaking)} breaking-announcement gap(s)." if breaking else "No breaking-announcement gap in the signals.",
        "rollback": f"回滚缺口 {len(rollback)} 处，删除之后没有恢复路径。" if rollback else "信号里没有回滚缺口。",
        "rollback_en": f"{len(rollback)} rollback gap(s). There is no restore path after the delete." if rollback else "No rollback gap in the signals.",
        "evidence": "15-rollout-signals.json",
        "evidence_en": "15-rollout-signals.json",
        "signals_file": "15-rollout-signals.json",
    }
    conclusion["rollout"] = card


def _fill_performance(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "21-performance-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("performance")):
        return
    n_plus = _signal_rows(doc, "n_plus_one_risks")
    unbounded = _signal_rows(doc, "unbounded_allocation")
    pooled = _signal_rows(doc, "unpooled_connections")
    hot = _signal_rows(doc, "hot_path_risks")
    if not any((n_plus, unbounded, pooled, hot)):
        return
    card = {
        "verdict": "concern",
        "risk": f"N+1 {len(n_plus)} 处，无界分配 {len(unbounded)} 处，未池化连接 {len(pooled)} 处。",
        "risk_en": f"{len(n_plus)} N+1 site(s), {len(unbounded)} unbounded allocation(s), {len(pooled)} unpooled connection(s).",
        "n_plus_one": (f"循环内逐条访问。例如 {_samples(n_plus, 1)}。" if n_plus else "信号里没有 N+1。"),
        "n_plus_one_en": (f"Per-item access inside a loop. Example: {_samples(n_plus, 1)}." if n_plus else "No N+1 in the signals."),
        "hot_path": f"热点路径 {len(hot)} 处。" if hot else "没有单独的热点剖析数据。",
        "hot_path_en": f"{len(hot)} hot-path row(s)." if hot else "No separate hotspot profile.",
        "unbounded_allocation": (f"无界分配 {len(unbounded)} 处。例如 {_samples(unbounded, 1)}。" if unbounded else "信号里没有无界分配。"),
        "unbounded_allocation_en": (f"{len(unbounded)} unbounded allocation(s). Example: {_samples(unbounded, 1)}." if unbounded else "No unbounded allocation in the signals."),
        "evidence": "21-performance-signals.json",
        "evidence_en": "21-performance-signals.json",
        "signals_file": "21-performance-signals.json",
    }
    conclusion["performance"] = card


def _fill_observability(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "16-observability-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("observability")):
        return
    missing = _signal_rows(doc, "missing_observability")
    sinks = _signal_rows(doc, "uncontrolled_log_sinks")
    if not any((missing, sinks)):
        return
    card = {
        "verdict": "concern",
        "risk": f"缺少观测 {len(missing)} 处，日志直接打到标准输出 {len(sinks)} 处。",
        "risk_en": f"{len(missing)} site(s) with no observation, {len(sinks)} log(s) written straight to stdout.",
        "missing": (f"捕获异常后没有日志或指标。例如 {_samples(missing, 1)}。" if missing else "信号里没有缺少观测的捕获。"),
        "missing_en": (f"A catch has no log or metric. Example: {_samples(missing, 1)}." if missing else "No unobserved catch in the signals."),
        "sinks": (f"日志落到标准输出。例如 {_samples(sinks, 1)}。" if sinks else "信号里没有不受控的日志出口。"),
        "sinks_en": (f"Logs go to stdout. Example: {_samples(sinks, 1)}." if sinks else "No uncontrolled log sink in the signals."),
        "evidence": "16-observability-signals.json",
        "evidence_en": "16-observability-signals.json",
        "signals_file": "16-observability-signals.json",
    }
    conclusion["observability"] = card


def _fill_contract(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "17-contract-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("contract")):
        return
    breaking = _signal_rows(doc, "breaking_hints")
    errors = _signal_rows(doc, "error_payload_candidates")
    xss = _signal_rows(doc, "xss_html_hits")
    if not any((breaking, errors, xss)):
        return
    card = {
        "verdict": "concern",
        "risk": f"破坏性提示 {len(breaking)} 处，错误结果缺少说明 {len(errors)} 处，HTML 汇入 {len(xss)} 处。",
        "risk_en": f"{len(breaking)} breaking hint(s), {len(errors)} error result(s) without a cause, {len(xss)} HTML sink(s).",
        "breaking": (f"公开接口标了废弃，没有替换说明。例如 {_samples(breaking, 1)}。" if breaking else "信号里没有破坏性提示。"),
        "breaking_en": (f"A public API is deprecated without a replacement note. Example: {_samples(breaking, 1)}." if breaking else "No breaking hint in the signals."),
        "errors": (f"拒绝结果只带代码。例如 {_samples(errors, 1)}。" if errors else "信号里没有缺少说明的错误结果。"),
        "errors_en": (f"A reject result carries only a code. Example: {_samples(errors, 1)}." if errors else "No thin error result in the signals."),
        "html": (f"调用方文本进入 HTML。例如 {_samples(xss, 1)}。" if xss else "契约信号里没有 HTML 汇入。"),
        "html_en": (f"Caller text is placed in HTML. Example: {_samples(xss, 1)}." if xss else "No HTML sink in the contract signals."),
        "evidence": "17-contract-signals.json",
        "evidence_en": "17-contract-signals.json",
        "signals_file": "17-contract-signals.json",
    }
    conclusion["contract"] = card


def _fill_maintainability(conclusion: dict, pack: Path) -> None:
    doc = _signal(pack, "18-maintainability-signals.json")
    if not doc or not _dim_incomplete(conclusion.get("maintainability")):
        return
    todos = _signal_rows(doc, "todo_fixme")
    numbers = _signal_rows(doc, "magic_numbers")
    unused = _signal_rows(doc, "unused_accumulators")
    oracles = _signal_rows(doc, "test_oracle_inventory")
    hits = _signal_rows(doc, "test_oracle_hits")
    coupled = _signal_rows(doc, "prod_test_coupling")
    long_files = _signal_rows(doc, "long_files")
    if not any((todos, numbers, unused, oracles, hits, coupled, long_files)):
        return
    card = {
        "verdict": "concern",
        "risk": f"魔法数字 {len(numbers)} 处，待办 {len(todos)} 处，测试清单 {len(oracles)} 条，其中机械命中 {len(hits)} 条。",
        "risk_en": f"{len(numbers)} magic number(s), {len(todos)} TODO(s), {len(oracles)} test inventory row(s), {len(hits)} mechanical test hit(s).",
        "todos": (f"未完成的错误处理备注。例如 {_samples(todos, 1)}。" if todos else "信号里没有待办。"),
        "todos_en": (f"An unfinished error-handling note. Example: {_samples(todos, 1)}." if todos else "No TODO in the signals."),
        "numbers": (f"字面量 {len(numbers)} 处。确认后的业务常量记在规范项。" if numbers else "信号里没有魔法数字。"),
        "numbers_en": (f"{len(numbers)} literal(s). Confirmed business constants are listed as conventions." if numbers else "No magic number in the signals."),
        "tests": (
            f"测试方法 {len(oracles)} 个，机械命中 {len(hits)} 条，未使用的累加器 {len(unused)} 处，生产类型嵌测试 {len(coupled)} 处。"
        ),
        "tests_en": (
            f"{len(oracles)} test method(s), {len(hits)} mechanical hit(s), {len(unused)} unused accumulator(s), {len(coupled)} test type(s) nested in production code."
        ),
        "evidence": "18-maintainability-signals.json",
        "evidence_en": "18-maintainability-signals.json",
        "signals_file": "18-maintainability-signals.json",
    }
    conclusion["maintainability"] = card


def _fill_llm_dimension(conclusion: dict, pack: Path) -> None:
    findings = [
        row for row in findings_of_local(conclusion)
        if str(row.get("source") or "") == "llm_judgment"
    ]
    report = _signal(pack, "22-llm-judgment.json")
    novel = report.get("kept_novel")
    if not isinstance(novel, int):
        novel = len(findings)
    deduped = report.get("deduped") if isinstance(report.get("deduped"), int) else 0
    enriched = report.get("enriched") if isinstance(report.get("enriched"), int) else 0
    existing = conclusion.get("llm_judgment")
    if not findings and not report and not isinstance(existing, dict):
        return
    card = existing if isinstance(existing, dict) else {}
    if findings or novel:
        _put(card, "verdict", "concern")
        _put(card, "risk", f"语义评审保留 {novel} 条扫描器没有单独命名的问题。")
        _put(card, "risk_en", f"The semantic review kept {novel} issue(s) that the scanners did not name on their own.")
    _put(card, "novel_count", str(novel))
    _put(card, "deduped_count", str(deduped))
    _put(card, "enriched_count", str(enriched))
    files = sorted({str(row.get("file") or row.get("path") or "") for row in findings if row.get("file") or row.get("path")})
    if files:
        _put(card, "focus_files", "、".join(files[:5]))
        _put(card, "focus_files_en", ", ".join(files[:5]))
    _put(card, "evidence", f"22-llm-judgment.json：kept_novel={novel}，deduped={deduped}。")
    _put(card, "evidence_en", f"22-llm-judgment.json: kept_novel={novel}, deduped={deduped}.")
    _put(card, "signals_file", "22-llm-judgment.json")
    if card.get("verdict"):
        conclusion["llm_judgment"] = card


def seal(conclusion: dict, skeleton: dict, validate, pack: Path | None = None, judgment: dict | None = None) -> dict:
    merged = dict(conclusion)
    drift_lines = {int(n) for n in (skeleton.get("branch_drift_lines") or []) if isinstance(n, int)}
    drift_skips = [row for row in (skeleton.get("line_skips") or []) if isinstance(row, dict)]
    if pack is not None:
        merge_judgment(merged, judgment or {})
        fill_report_cards(merged, pack, validate, drift_lines, drift_skips)
        fill_suspects(merged, pack, judgment or {}, validate)
        fill_oracle(merged, pack, judgment or {})
        fill_shapes(merged, pack, validate)
        fill_test_gaps(merged, pack, validate)
        fill_dimensions(merged, pack)
    skeleton_rows = [row for row in (skeleton.get("coverage_closure") or []) if isinstance(row, dict)]
    by_id = {}
    for row in merged.get("coverage_closure") or []:
        if isinstance(row, dict) and row.get("symbol_id"):
            by_id[str(row["symbol_id"])] = dict(row)
    finding_ids = set()
    for finding in validate.findings_of(merged):
        if finding.get("symbol_id"):
            finding_ids.add(str(finding["symbol_id"]))
    for row in skeleton_rows:
        sid = str(row.get("symbol_id") or "")
        if not sid:
            continue
        got = by_id.get(sid)
        if got is None:
            got = dict(row)
            by_id[sid] = got
        if not got.get("span_hash") and row.get("span_hash"):
            got["span_hash"] = row["span_hash"]
        if not got.get("span_check") and row.get("span_check"):
            got["span_check"] = row["span_check"]
        if got.get("status") not in {"reviewed", "failed"}:
            got["status"] = "reviewed"
        if sid in finding_ids:
            got["open_result"] = "hit"
        elif got.get("open_result") not in {"hit", "none"}:
            got["open_result"] = row.get("open_result") or "none"
    if by_id:
        merged["coverage_closure"] = list(by_id.values())

    have = set()
    skips = []
    for row in merged.get("line_skips") or []:
        if isinstance(row, dict) and isinstance(row.get("line"), int):
            have.add((str(row.get("kind") or ""), int(row["line"])))
            skips.append(row)
    for row in skeleton.get("line_skips") or []:
        if not isinstance(row, dict) or not isinstance(row.get("line"), int):
            continue
        key = (str(row.get("kind") or ""), int(row["line"]))
        if key in have:
            continue
        have.add(key)
        skips.append(row)
    merged["line_skips"] = skips

    names = gap_names(merged)
    missing = []
    for row in skeleton.get("test_gaps") or []:
        if not isinstance(row, dict):
            continue
        for item in row.get("symbols") or []:
            if str(item) not in names:
                missing.append(str(item))
    if missing:
        gaps = list(merged.get("test_gaps") or [])
        gaps.append({
            "symbol": "untested-production-symbols",
            "symbol_en": "untested-production-symbols",
            "symbols": missing,
            "tested_count": "0",
            "tests_reach": "empty",
            "tests_reach_en": "No accepted test edge",
            "note": "这些符号在变更集里 tested_count 为 0。判定包 pending 之外的名字属于分支漂移。",
            "note_en": "These changed symbols have tested_count 0. Names outside the judgment packet pending list are branch drift.",
        })
        merged["test_gaps"] = gaps

    cited = validate.cited_lines(merged)
    drift = [int(n) for n in (skeleton.get("branch_drift_lines") or []) if isinstance(n, int)]
    missing_lines = [n for n in drift if n not in cited]
    if missing_lines:
        note = (
            "这些行在三方 diff 之外，是分支落后主干带来的扫描命中，不是本次提交新写的逻辑。"
            "变基后再看三方 diff。不要按这些行去改主干上已经更新的文件。"
        )
        for number in missing_lines:
            key = ("branch_drift", number)
            if key in have:
                continue
            have.add(key)
            skips.append({
                "kind": "branch_drift",
                "line": number,
                "note": note,
            })
        merged["line_skips"] = skips
    if pack is not None:
        fill_hashes(merged, pack, validate)
        fill_callers(merged, pack)
        fill_regression_tests(merged, pack)
        stamp_change_status(merged, pr_file_status(pack))
    fill_english(merged)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Seal review-conclusion.json from the skeleton")
    parser.add_argument("--dir", required=True)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    pack = Path(args.dir)
    conclusion = load_json(Path(args.input))
    if not isinstance(conclusion, dict):
        print("error: conclusion is not a JSON object", file=sys.stderr)
        return 2
    skeleton = load_json(pack / "30-conclusion-skeleton.json")
    judgment = load_json(pack / "judgment.json")
    sealed = seal(
        conclusion,
        skeleton if isinstance(skeleton, dict) else {},
        load_validate(),
        pack,
        load_judgments(pack, judgment if isinstance(judgment, dict) else {}),
    )
    Path(args.input).write_text(
        json.dumps(sealed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Sealed conclusion ledger fields")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
