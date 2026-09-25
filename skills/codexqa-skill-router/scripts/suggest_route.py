#!/usr/bin/env python3
"""Suggest which catalog skill should handle a user request.

Discovery lists candidates. This script breaks ties that descriptions lose:
shared words such as review / PR / diff / 评审 / 影响面 / HTML must not decide
the skill. Artifact and task shape do.

Usage:
  python3 suggest_route.py --text "对这段代码进行评审"
  python3 suggest_route.py --text-file /path/to/request.txt
  python3 suggest_route.py --self-check

Exit 0 on success. --self-check exits 1 when a fixture is mis-routed.
Prefers CPython 3.10+. Re-execs onto python3.10+ when system python3 is older.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

_MIN_PY = (3, 10)
_REEXEC_ENV = "SKILL_ROUTER_PY_REEXEC"
_PY_CANDIDATES = (
    "python3.12",
    "python3.11",
    "python3.10",
    "python3.13",
    "python3.14",
    "python3",
)


def _reexec_if_needed():
    # type: () -> None
    if sys.version_info >= _MIN_PY:
        return
    if os.environ.get(_REEXEC_ENV) == "1":
        sys.stderr.write(
            "suggest_route.py needs Python %d.%d+; got %d.%d\n"
            % (_MIN_PY[0], _MIN_PY[1], sys.version_info[0], sys.version_info[1])
        )
        sys.exit(1)
    script = os.path.abspath(__file__)
    for name in _PY_CANDIDATES:
        try:
            out = subprocess.check_output(
                [name, "-c", 'import sys; print("%d.%d" % sys.version_info[:2])'],
                stderr=subprocess.PIPE,
            )
            if not isinstance(out, str):
                out = out.decode("utf-8", "replace")
            parts = out.strip().split(".")
            ver = (int(parts[0]), int(parts[1]))
        except Exception:
            continue
        if ver < _MIN_PY:
            continue
        env = os.environ.copy()
        env[_REEXEC_ENV] = "1"
        os.execvpe(name, [name, script] + sys.argv[1:], env)
    sys.stderr.write(
        "suggest_route.py needs Python %d.%d+ on PATH\n" % (_MIN_PY[0], _MIN_PY[1])
    )
    sys.exit(1)


_reexec_if_needed()

sys.path.insert(0, str(Path(__file__).resolve().parent))
from discover_skills import default_skills_root, discover, load_bundled_catalog, merge_catalog  # noqa: E402

POLICY = "suggest_route/2"

REVIEWER = "codexqa-code-reviewer"
DEFECT = "codexqa-defect-analyzer"
ANALYZER = "codexqa-code-analyzer"
CHANGE = "codexqa-change-analysis"
WIKI = "codexqa-code-wiki"
RCA = "codexqa-rootcause-analyzer"
REQUIREMENT = "codexqa-requirement-analyzer"
TESTCASE = "codexqa-testcase-generator"
TESTDATA = "codexqa-testdata-generator"
JEV = "codexqa-jev-browser"

# Longer aliases first so "codexqa-code-reviewer" occupies its span before
# the shorter "code-reviewer" is tested.
ALIASES = (
    (REVIEWER, ("codexqa-code-reviewer", "ai-code-reviewer", "code-reviewer")),
    (DEFECT, ("codexqa-defect-analyzer", "defect-detection", "defect-analyzer")),
    (ANALYZER, ("codexqa-code-analyzer", "code-analyzer")),
    (CHANGE, ("codexqa-change-analysis", "change-impact-analysis", "change-analysis")),
    (WIKI, ("codexqa-code-wiki", "code-wiki")),
    (RCA, ("codexqa-rootcause-analyzer", "root-cause-diagnosis", "rootcause-analyzer")),
    (REQUIREMENT, ("codexqa-requirement-analyzer", "requirements-analyzer", "requirement-analyzer")),
    (TESTCASE, ("codexqa-testcase-generator", "testcase-generation", "testcase-generator")),
    (TESTDATA, ("codexqa-testdata-generator", "testdata-generation", "testdata-generator")),
    (JEV, ("codexqa-jev-browser", "jev-browser", "jev browser")),
)

NEG_BEFORE = re.compile(
    r"(不要|别用|不用|无需|勿|不是|而非|避免|跳过|(?<!特)(?<!区)(?<!类)(?<!性)(?<!分)别|"
    r"instead of|rather than|without|don't|do not|\bno)\s*$",
    re.I,
)
CHAIN_RE = re.compile(
    r"先.{0,24}再|然后再|然后(?:再)?(?:做|出|写|跑|扫描)|first\b.{0,48}\bthen\b|之后再|"
    r"再(?:造|写|出|扫|评|做)",
    re.I,
)
STACK_RE = re.compile(
    r"堆栈|traceback|stacktrace|stack trace|exception in thread|崩溃|crash",
    re.I,
)
SCAN_LEX_RE = re.compile(
    r"漏洞|缺陷检测|缺陷扫描|缺陷分析|检测缺陷|sast|secret scan|密钥|gitleaks|semgrep|"
    r"bandit|安全扫描|静态扫描|静态分析|report_scan|风险扫描|code-risk|代码风险|"
    r"扫一遍|扫一下|扫描清单|增量扫描|全量扫描|基线扫描|baseline-scan|找缺陷|"
    r"找\s*bug|有没有\s*bug|有没有缺陷|defect detection|vulnerabilit|"
    r"sql\s*注入|sql injection|\bxss\b|跨站|硬编码密码|硬编码密钥|"
    r"依赖漏洞|组件漏洞|供应链|密钥泄露|敏感信息|凭据扫描|安全基线|"
    r"依赖扫描|组件扫描|\bSCA\b|\bCVE\b|gitleaks|osv-scanner|\bgosec\b|\bbandit\b",
    re.I,
)
REQ_CTX_RE = re.compile(r"需求|prd|requirement", re.I)
CODE_CTX_RE = re.compile(
    r"代码|仓库|repo|pull request|\bpr\b|\bmr\b|\bdiff\b|\bcommit\b|类|函数|文件|patch",
    re.I,
)


CHANGE_REPORT_RE = re.compile(
    r"(影响|变更|impact|change)[^，。,.;；]{0,8}(报告|report)",
    re.I,
)
CHANGE_TESTS_RE = re.compile(
    r"补上?(缺的|缺失的|没覆盖的)测试|补测(?!试缺口)|新增(可运行的?)?测试|生成测试文件|"
    r"(new|generate|add)\s+(runnable\s+)?tests?\b|runnable tests",
    re.I,
)
CHANGE_CTX_RE = re.compile(
    r"变更|改动|这次|本次|分支|origin/|提交|(?<![A-Za-z])(diff|pr|mr|commit|branch|patch)(?![A-Za-z])",
    re.I,
)


def is_negated(text: str, start: int) -> bool:
    window = text[max(0, start - 8) : start]
    return NEG_BEFORE.search(window) is not None


def _unnegated(text: str, pattern: "re.Pattern[str]") -> bool:
    return any(not is_negated(text, m.start()) for m in pattern.finditer(text))


def _ascii_pattern(phrase: str) -> str:
    body = re.escape(phrase.strip()).replace(r"\ ", r"\s+")
    if re.fullmatch(r"[A-Za-z0-9.+_-]+", phrase.strip()) and len(phrase.strip()) <= 4:
        return r"(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9])"
    return body


def present(text: str, phrase: str) -> bool:
    phrase = phrase.strip()
    if not phrase:
        return False
    if re.fullmatch(r"[A-Za-z0-9 .+/_-]+", phrase):
        pat = _ascii_pattern(phrase)
    else:
        pat = re.escape(phrase)
    for match in re.finditer(pat, text, re.I):
        if not is_negated(text, match.start()):
            return True
    return False


def any_present(text: str, phrases: Sequence[str]) -> bool:
    return any(present(text, p) for p in phrases)


def present_unless(text: str, phrase: str, suffixes: Sequence[str]) -> bool:
    """Match phrase unless the immediate tail is one of suffixes."""
    phrase = phrase.strip()
    if not phrase:
        return False
    if re.fullmatch(r"[A-Za-z0-9 .+/_-]+", phrase):
        pat = _ascii_pattern(phrase)
    else:
        pat = re.escape(phrase)
    for match in re.finditer(pat, text, re.I):
        if is_negated(text, match.start()):
            continue
        tail = text[match.end() : match.end() + 12]
        if any(tail.startswith(suf) for suf in suffixes):
            continue
        return True
    return False


def earliest(text: str, phrases: Sequence[str]) -> int:
    best = len(text) + 1
    lower = text.lower()
    for phrase in phrases:
        token = phrase.lower().strip()
        if not token:
            continue
        idx = lower.find(token)
        if idx >= 0 and not is_negated(text, idx):
            best = min(best, idx)
    return best


def alias_mentions(text: str) -> Tuple[List[str], List[str]]:
    """Return (explicit skill names, negated skill names) in mention order."""
    occupied: List[Tuple[int, int]] = []
    found: List[Tuple[int, str, bool]] = []
    ranked: List[Tuple[int, str, str]] = []
    for skill, aliases in ALIASES:
        for alias in aliases:
            ranked.append((len(alias), skill, alias))
    ranked.sort(key=lambda row: -row[0])
    for _length, skill, alias in ranked:
        pat = r"(?<![A-Za-z0-9])" + re.escape(alias) + r"(?![A-Za-z0-9])"
        for match in re.finditer(pat, text, re.I):
            span = (match.start(), match.end())
            if any(not (span[1] <= a or span[0] >= b) for a, b in occupied):
                continue
            occupied.append(span)
            found.append((match.start(), skill, is_negated(text, match.start())))
    found.sort()
    explicit: List[str] = []
    rejected: List[str] = []
    for _pos, skill, negated in found:
        bucket = rejected if negated else explicit
        if skill not in bucket:
            bucket.append(skill)
    explicit = [name for name in explicit if name not in rejected]
    return explicit, rejected


def weak_english_review(text: str) -> bool:
    for match in re.finditer(r"(?<![A-Za-z])reviews?(?:ing)?(?![A-Za-z])", text, re.I):
        if is_negated(text, match.start()):
            continue
        window = text[max(0, match.start() - 16) : match.end() + 8]
        if re.search(r"requirements?\s+reviews?(?:ing)?", window, re.I):
            continue
        if re.search(r"reviews?(?:ing)?\s+(?:the\s+|these\s+|this\s+)?requirements?\b", window, re.I):
            continue
        return True
    return False


def score_request(text: str) -> Dict[str, Dict[str, Any]]:
    """Return per-skill score plus the phrases that fired."""
    scores: Dict[str, Dict[str, Any]] = {
        name: {"score": 0, "hits": []}
        for name in (
            REVIEWER,
            DEFECT,
            ANALYZER,
            CHANGE,
            WIKI,
            RCA,
            REQUIREMENT,
            TESTCASE,
            TESTDATA,
            JEV,
        )
    }

    def add(skill: str, weight: int, label: str) -> None:
        row = scores[skill]
        row["score"] += weight
        if label not in row["hits"]:
            row["hits"].append(label)

    strong_review = (
        "代码评审",
        "代码审查",
        "代码走查",
        "代码走读",
        "代码复查",
        "代码质量",
        "全仓评审",
        "全仓健康",
        "审查报告",
        "review report",
        "REVIEW-REPORT",
        "证据包",
        "evidence pack",
        "evidence-pack",
        "graph-backed review",
        "合入建议",
        "code review",
        "code reviewer",
        "pr review",
        "mr review",
        "pull request review",
        "安全评审",
        "性能评审",
        "合入评审",
        "合并评审",
        "评审意见",
        "审查意见",
        "语义评审",
        "semantic review",
        "semantic cr",
        "单文件评审",
        "整仓评审",
        "全量评审",
        "双语审查",
        "双语评审",
        "仓库健康度",
        "review comments",
        "adhoc review",
    )
    if any_present(text, strong_review):
        add(REVIEWER, 5, "strong-review")
    generic_review = bool(
        re.search(r"(做个|做一次|做个代码|来|进行|帮我).{0,6}评审", text)
        or present(text, "做评审")
        or present(text, "评审代码")
        or present(text, "评审这段")
        or present(text, "评审一下")
        or re.search(r"(能不能合|能否合入|能合入|合入吗|能否合并|能否合入)", text)
    )
    weak_zh = bool(re.search(r"审(一下|这段|这个|当前|下)", text))
    casual_code = any_present(text, ("看看代码", "看下代码", "检查这段代码", "检查代码", "审一下代码"))
    design_review = present(text, "设计评审") and not present(text, "需求")
    requirementish = REQ_CTX_RE.search(text) is not None and CODE_CTX_RE.search(text) is None
    if not requirementish and (
        generic_review or weak_zh or casual_code or design_review or weak_english_review(text)
    ):
        add(REVIEWER, 3, "weak-review")
    if present(text, "审当前") or present(text, "审一下这个仓库") or present(text, "审这个仓库"):
        add(REVIEWER, 3, "repo-review")
    if re.search(r"看看这个\s*(diff|pr|mr|代码|类|文件|patch)", text, re.I):
        add(REVIEWER, 3, "look-at-change")
    if re.search(r"(过一下|过一遍|给个 review|给份评审).{0,12}(pr|mr|代码|diff|仓库|类)", text, re.I):
        add(REVIEWER, 3, "pass-over")
    if re.search(r"(代码|这个类|这个文件|这段).{0,8}有没有问题", text) and not SCAN_LEX_RE.search(text):
        add(REVIEWER, 3, "any-problem")

    if SCAN_LEX_RE.search(text) and not _scan_only_negated(text):
        add(DEFECT, 5, "scan")
    if present(text, "scan") and re.search(
        r"\b(diff|repo|repository|pr|mr|commit|code|branch|patch)\b", text, re.I
    ):
        if not is_negated(text, text.lower().find("scan")):
            add(DEFECT, 4, "scan-object")

    analyzer_phrases = (
        "符号图",
        "建索引",
        "查调用",
        "调用方",
        "调用链",
        "影响面",
        "回归范围",
        "测试缺口",
        "--diff-base",
        "变更审查",
        "impact analysis",
        "test gaps",
        "regression scope",
        "symbol graph",
        "who calls",
        "entry risk",
        "入口风险",
        "影响分析",
        "变更影响",
        "谁调用",
        "谁在调",
        "被谁调用",
        "敏感路径",
        "敏感链路",
        "变更分组",
        "symbol diff",
        "symbol-diff",
        "模块归属",
        "架构漂移",
        "分层不对",
        "单测覆盖",
        "哪些没测",
        "没测到",
        "有没有单测",
        "要回归",
        "回归哪些",
        "错误定位",
        "报错在哪",
        "定位报错",
    )
    if any_present(text, analyzer_phrases):
        add(ANALYZER, 5, "graph-query")
    if re.search(r"\bcallers?\b", text, re.I):
        add(ANALYZER, 5, "callers")
    if re.search(r"建(一下|个)?索引|索引这个仓库|codexqa\s+index", text, re.I):
        add(ANALYZER, 5, "index")
    if re.search(
        r"(相对|对比|against|vs\.?)\s*(origin/)?(main|master)", text, re.I
    ) and re.search(r"变了|改了|变更|diff|影响|调用", text, re.I):
        add(ANALYZER, 5, "vs-base")

    change_phrases = (
        "变更分析",
        "变更代码分析",
        "变更影响报告",
        "影响入口",
        "召回测试用例",
        "召回用例",
        "change impact report",
        "change-impact report",
        "change analysis",
        "change-impact analysis",
        "recall tests",
        "link existing tests",
    )
    if any_present(text, change_phrases):
        add(CHANGE, 5, "change-impact")
    # The analyzer also writes a report, so shared impact words need one diff
    # plus an HTML report or new tests. A chain keeps its own steps.
    if scores[ANALYZER]["score"] > 0 and CHANGE_CTX_RE.search(text) and not CHAIN_RE.search(text):
        if _unnegated(text, CHANGE_REPORT_RE) and re.search(r"html", text, re.I):
            add(CHANGE, 5, "impact-html-report")
        if _unnegated(text, CHANGE_TESTS_RE):
            add(CHANGE, 5, "impact-new-tests")

    wiki_strong = (
        "架构 wiki",
        "架构Wiki",
        "architecture wiki",
        "模块地图",
        "阅读导览",
        "wiki inputs",
        "社区检测",
        "community detection",
        "module map",
        "reading guide",
        "deepwiki",
        "repo wiki",
        "仓库 wiki",
        "从哪开始读",
        "从哪里开始读",
        "从哪读起",
        "阅读路径",
        "新人导览",
        "仓库导览",
        "模块划分",
        "模块职责",
        "系统怎么组织",
        "系统是怎么组织",
        "这个仓库是干什么",
        "讲讲这个模块",
        "介绍这个模块",
        "模块是干什么",
        "--no-llm",
        "不调模型",
        "社区划分",
    )
    if any_present(text, wiki_strong):
        add(WIKI, 5, "wiki")
    if any_present(text, ("代码知识图谱", "知识图谱", "knowledge graph")):
        add(WIKI, 2, "graph-word")
        add(ANALYZER, 2, "graph-word")

    rca_phrases = (
        "堆栈",
        "stack trace",
        "stacktrace",
        "traceback",
        "根因",
        "root cause",
        "root-cause",
        "崩溃分析",
        "crash analysis",
        "异常诊断",
        "堆栈诊断",
        "exception rca",
        "NullPointerException",
        "Exception in thread",
        "仓内根因",
        "为什么报错",
        "为何报错",
        "报错原因",
        "异常原因",
        "为何抛",
        "为什么抛",
        "线上报错",
        "生产报错",
        "线上故障",
        "调试日志",
        "调试输出",
        "根因报告",
        "异常报告",
        "代码诊断",
        "code diagnosis",
        "调用链转储",
        "call-chain dump",
        "call chain dump",
    )
    if any_present(text, rca_phrases) or (
        present(text, "NPE") and any_present(text, ("根因", "堆栈", "诊断", "crash", "stack"))
    ):
        add(RCA, 5, "rca")
    if present(text, "崩溃") and not present(text, "崩溃分析"):
        add(RCA, 4, "crash")
    if re.search(r"日志|\blogs?\b", text, re.I) and re.search(
        r"报错|异常|根因|崩溃|失败原因|NPE|NullPointer", text, re.I
    ):
        add(RCA, 5, "log-cause")

    if re.search(r"(?<!数据)需求分析", text) or any_present(
        text,
        (
            "需求评审",
            "需求缺口",
            "需求质量",
            "需求冲突",
            "需求文档",
            "需求规格",
            "gap register",
            "requirement quality",
            "requirements review",
            "requirement review",
            "需求风险",
            "需求一致性",
            "需求歧义",
            "需求矛盾",
            "需求对质",
            "非功能需求",
            "需求气味",
            "多来源需求",
            "需求能不能测",
            "验收标准缺",
        ),
    ) or (
        re.search(r"\brequirements?\b", text, re.I)
        and re.search(r"\bgaps?\b|\bconflicts?\b|\bquality\b|缺口|冲突|质量|歧义|一致性", text, re.I)
    ):
        add(REQUIREMENT, 5, "requirement")
    if re.search(r"PRD|需求", text, re.I) and re.search(r"缺口|冲突|歧义|一致性|能不能测|气味", text):
        add(REQUIREMENT, 5, "prd-quality")
    if present(text, "可测性") and re.search(r"需求|PRD", text, re.I) and not any_present(
        text, ("写用例", "出用例", "测试用例", "测试方案")
    ):
        add(REQUIREMENT, 4, "testability")

    testcase_phrases = (
        "测试方案",
        "测试计划",
        "测试设计",
        "写用例",
        "出用例",
        "只要用例",
        "只要方案",
        "测试用例",
        "test plan",
        "test cases",
        "test case",
        "提测后",
        "提测前",
        "回归用例",
        "补回归",
        "case design",
        "出测试用例",
        "方案和用例",
        "按 PRD 出测试",
        "帮我出测试",
        "做一轮测试设计",
        "生成用例",
        "生成测试方案",
        "从需求做到用例",
        "改用例",
        "补用例",
        "增补用例",
        "接口用例",
        "服务端用例",
        "用例设计",
        "已有用例增强",
        "diff 补用例",
        "预提测",
    )
    if any_present(text, testcase_phrases) or present_unless(text, "测试分析", ("数据",)) or present_unless(
        text, "补测试", ("缺口",)
    ) or present_unless(text, "出测试", ("数据", "方案")):
        add(TESTCASE, 5, "cases")

    testdata_phrases = (
        "构造测试数据",
        "准备测试数据",
        "造数据",
        "造数",
        "用例数据",
        "用例物料",
        "用例前置",
        "前置数据",
        "测试数据回写",
        "测试物料",
        "数据需求分析",
        "回写前置",
        "test data",
        "为用例准备数据",
        "用例数据构造",
        "用例数据准备",
        "用例前置数据",
        "测试数据准备",
        "数据物料",
        "数据诉求",
        "需求测试数据",
        "测试数据分析",
        "测试物料清单",
        "造数脚本",
        "构造脚本",
        "数据构造",
        "回写到用例",
        "发布成工具",
        "沉淀成工具",
        "沉淀方法",
        "case materials",
        "case data",
        "prepare test data",
        "write back test data",
        "data inventory",
        "test material",
    )
    if any_present(text, testdata_phrases):
        add(TESTDATA, 5, "testdata")
    if re.search(r"openapi", text, re.I) and re.search(
        r"账号|账户|account|脚本|script|scaffold", text, re.I
    ):
        add(TESTDATA, 5, "openapi-build")
    if re.search(r"前置账号|造账号|造个账号|准备账号", text) or (
        present(text, "造出来") and re.search(r"账号|账户|数据|前置|物料", text)
    ):
        add(TESTDATA, 5, "account-build")
    if re.search(r"\bapis?\b", text, re.I) and re.search(r"脚本|script|造数据|构造", text, re.I):
        add(TESTDATA, 4, "api-script")
    if re.search(r"造一笔|造个订单|造一笔订单|来一条数据", text):
        add(TESTDATA, 4, "business-row")
    if re.search(r"scaffold", text, re.I) and re.search(r"openapi|domain|领域", text, re.I):
        add(TESTDATA, 5, "scaffold-domain")

    jev_phrases = (
        "jev browser",
        "jev-browser",
        "codexqa-jev-browser",
        "浏览器回放",
        "浏览器自动化",
        "explore a site",
        "browser ui cases",
        "generate browser ui",
    )
    if any_present(text, jev_phrases) or re.search(r"\bjev\b", text, re.I):
        add(JEV, 5, "browser")

    _resolve_overlaps(text, scores)
    return scores


def _scan_only_negated(text: str) -> bool:
    """True when every scan-lexicon hit sits under a negation prefix."""
    hits = list(SCAN_LEX_RE.finditer(text))
    if not hits:
        return False
    return all(is_negated(text, match.start()) for match in hits)


def _zero(scores: Dict[str, Dict[str, Any]], skill: str, why: str) -> None:
    row = scores[skill]
    if row["score"] <= 0:
        return
    row["score"] = 0
    row["hits"].append("dropped:" + why)


def _resolve_overlaps(text: str, scores: Dict[str, Dict[str, Any]]) -> None:
    reviewer = scores[REVIEWER]["score"] > 0
    defect = scores[DEFECT]["score"] > 0
    strong = "strong-review" in scores[REVIEWER]["hits"]
    drop_scan = any_present(
        text,
        ("不要漏洞", "不要缺陷", "不要扫描", "不要 sast", "不要安全扫描", "without a scan", "not a scan"),
    ) or _scan_only_negated(text)
    drop_review = any_present(text, ("不要评审", "不要审查", "不要代码审查", "不要 code review"))
    analyzer_only = any_present(
        text,
        (
            "只要影响面",
            "只查调用",
            "只建索引",
            "仅影响面",
            "不要评审",
            "不要审查报告",
            "不要审查",
        ),
    )

    if reviewer and defect:
        if drop_scan and not drop_review:
            _zero(scores, DEFECT, "review-not-scan")
        elif drop_review and not drop_scan:
            _zero(scores, REVIEWER, "scan-not-review")
        elif strong and defect:
            pass
        elif not strong:
            _zero(scores, REVIEWER, "weak-review-plus-scan")

    if scores[REVIEWER]["score"] > 0 and scores[ANALYZER]["score"] > 0:
        if analyzer_only and not strong:
            _zero(scores, REVIEWER, "graph-only")
        else:
            _zero(scores, ANALYZER, "review-includes-impact")

    if scores[CHANGE]["score"] > 0:
        named = alias_mentions(text)[0]
        if strong:
            _zero(scores, CHANGE, "review-includes-impact")
        elif any_present(text, ("只要影响面", "只查调用", "只建索引", "仅影响面")):
            _zero(scores, CHANGE, "graph-only")
        elif any(name != CHANGE and scores[name]["score"] > 0 for name in named):
            _zero(scores, CHANGE, "user-named-another-skill")
        else:
            _zero(scores, REVIEWER, "change-impact-not-review")
            _zero(scores, ANALYZER, "change-impact-report")
    if scores[CHANGE]["score"] > 0 and scores[TESTCASE]["score"] > 0 and not CHAIN_RE.search(text):
        if REQ_CTX_RE.search(text) or re.search(r"提测", text):
            _zero(scores, CHANGE, "cases-from-prd")
        else:
            _zero(scores, TESTCASE, "diff-impact-tests")

    if scores[WIKI]["score"] >= 5 and scores[ANALYZER]["score"] <= 2:
        _zero(scores, ANALYZER, "wiki-shape")
    elif scores[ANALYZER]["score"] >= 5 and 0 < scores[WIKI]["score"] <= 2:
        _zero(scores, WIKI, "query-not-wiki")

    if scores[TESTCASE]["score"] > 0 and scores[REQUIREMENT]["score"] > 0:
        wants_cases = any_present(
            text,
            (
                "写用例",
                "出用例",
                "测试方案",
                "测试用例",
                "test plan",
                "test case",
                "只要用例",
                "生成用例",
                "补用例",
                "帮我出测试",
                "出测试",
                "方案和用例",
            ),
        )
        wants_gaps = any_present(text, ("需求缺口", "需求冲突", "需求评审", "gap register", "需求质量"))
        if wants_cases and not wants_gaps:
            _zero(scores, REQUIREMENT, "cases-from-prd")
        elif wants_gaps and not wants_cases:
            _zero(scores, TESTCASE, "requirement-register")

    if scores[TESTDATA]["score"] > 0 and scores[TESTCASE]["score"] > 0:
        wants_data = scores[TESTDATA]["score"] > 0
        wants_cases = any_present(
            text,
            (
                "写用例",
                "出用例",
                "测试方案",
                "测试用例",
                "test plan",
                "生成用例",
                "补用例",
                "方案和用例",
                "从需求做到用例",
                "做到用例",
                "帮我出测试",
                "测试设计",
                "测试分析",
            ),
        )
        if wants_data and wants_cases:
            pass
        elif wants_data:
            _zero(scores, TESTCASE, "data-not-cases")

    if scores[TESTDATA]["score"] > 0 and scores[REQUIREMENT]["score"] > 0:
        if "数据需求分析" in text and not any_present(text, ("需求评审", "需求缺口", "需求文档")):
            _zero(scores, REQUIREMENT, "data-needs-not-prd")

    if scores[RCA]["score"] > 0 and scores[ANALYZER]["score"] > 0:
        impact_ask = any_present(
            text, ("影响面", "测试缺口", "建索引", "回归范围", "变更审查", "影响分析", "变更影响", "要回归")
        )
        graph_as_evidence = any_present(text, ("调用链", "调用方", "callers", "who calls", "调用链转储")) and not impact_ask
        locate_only = any_present(text, ("错误定位", "报错在哪", "定位报错")) and not impact_ask
        if (graph_as_evidence or locate_only) and (
            STACK_RE.search(text) is not None or present(text, "根因") or present(text, "报错原因")
        ):
            _zero(scores, ANALYZER, "graph-or-locate-for-rca")

    if scores[RCA]["score"] > 0 and scores[REVIEWER]["score"] > 0:
        stack = STACK_RE.search(text) is not None or present(text, "根因")
        if strong and not stack:
            _zero(scores, RCA, "review-not-rca")
        elif stack and not strong:
            _zero(scores, REVIEWER, "stack-not-review")

    if scores[RCA]["score"] > 0 and scores[DEFECT]["score"] > 0:
        stack = STACK_RE.search(text) is not None or present(text, "根因")
        if stack and "scan" not in scores[DEFECT]["hits"]:
            _zero(scores, DEFECT, "rca-not-scan")
        elif scores[DEFECT]["score"] > 0 and not stack:
            _zero(scores, RCA, "scan-not-rca")

    if scores[REQUIREMENT]["score"] > 0 and scores[REVIEWER]["score"] > 0:
        code_review = any_present(text, ("代码评审", "代码审查", "代码走查", "code review", "审查报告"))
        if not code_review:
            _zero(scores, REVIEWER, "requirement-review")

    if scores[JEV]["score"] > 0 and scores[TESTCASE]["score"] > 0:
        _zero(scores, TESTCASE, "browser-not-prd-plan")


def positive_skills(scores: Dict[str, Dict[str, Any]]) -> List[str]:
    ranked = [name for name, row in scores.items() if row["score"] > 0]
    ranked.sort(key=lambda name: (-scores[name]["score"], name))
    return ranked


def suggest(text: str, catalog_names: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    raw = " ".join((text or "").split())
    names = set(catalog_names or [])
    explicit, rejected_names = alias_mentions(raw)
    scores = score_request(raw)
    for name in rejected_names:
        _zero(scores, name, "user-rejected-name")
    if names:
        for skill in list(scores):
            if skill not in names:
                _zero(scores, skill, "not-in-catalog")
        explicit = [name for name in explicit if name in names]

    ranked = positive_skills(scores)
    chain = CHAIN_RE.search(raw) is not None
    outcome = "none"
    winner: Optional[str] = None
    steps: List[str] = []
    reason = "no catalog skill claimed this request"
    alternatives: List[str] = []

    if len(explicit) == 1:
        named = explicit[0]
        others = [name for name in ranked if name != named]
        if scores[named]["score"] > 0 or not others:
            outcome = "explicit"
            winner = named
            reason = "user named %s" % named
        else:
            outcome = "explicit_conflict"
            winner = None
            alternatives = others[:3]
            reason = (
                "%s was named, but the request shape matches %s"
                % (named, alternatives[0] if alternatives else "another skill")
            )
    elif len(explicit) >= 2:
        outcome = "chain" if chain else "ambiguous"
        steps = explicit[:3]
        alternatives = explicit[:3]
        reason = "user named more than one skill"
    elif len(ranked) == 1:
        outcome = "clear"
        winner = ranked[0]
        reason = _reason_for(winner, scores)
    elif len(ranked) >= 2:
        alternatives = ranked[:3]
        if chain:
            outcome = "chain"
            steps = sorted(ranked, key=lambda name: _first_hit(raw, name))
            reason = "request asks for more than one skill in order"
        else:
            outcome = "ambiguous"
            reason = "top candidates are %s" % ", ".join(alternatives)
    else:
        reason = (
            "no task shape matched; do not treat shared words "
            "(review, PR, diff, 评审, 影响面, HTML) as a defect-scan or wiki claim"
        )

    if winner and names and winner not in names:
        outcome = "none"
        winner = None
        reason = "winner not in catalog"

    return {
        "ok": True,
        "policy": POLICY,
        "outcome": outcome,
        "winner": winner,
        "steps": steps,
        "rejected": rejected_names,
        "reason": reason,
        "alternatives": alternatives,
        "scores": {name: row["score"] for name, row in scores.items() if row["score"] > 0 or row["hits"]},
        "hits": {name: row["hits"] for name, row in scores.items() if row["hits"]},
    }


def _reason_for(winner: str, scores: Dict[str, Dict[str, Any]]) -> str:
    hits = ",".join(scores[winner]["hits"])
    notes = {
        REVIEWER: "code review / 代码评审 / review report, not a SAST scan",
        DEFECT: "defect scan / SAST / report_scan, not a code review",
        ANALYZER: "symbol-graph query / impact / test gaps, not an HTML review",
        CHANGE: "one-diff change-impact HTML report plus new tests, not general graph Q&A",
        WIKI: "architecture wiki / module map",
        RCA: "exception root cause from a stack, log, or crash",
        REQUIREMENT: "requirement quality / gap register, not code review",
        TESTCASE: "test plan or cases, not requirement gap analysis",
        TESTDATA: "construct or write back test data",
        JEV: "Jev browser replay or site exploration, not a PRD test plan",
    }
    return "%s (%s)" % (notes.get(winner, winner), hits)


def _first_hit(text: str, skill: str) -> int:
    phrases = {
        REVIEWER: ("代码评审", "代码审查", "code review", "审查报告", "评审"),
        DEFECT: ("缺陷", "扫描", "sast", "漏洞", "report_scan"),
        ANALYZER: ("影响面", "查调用", "建索引", "测试缺口", "回归范围"),
        CHANGE: ("变更分析", "变更影响报告", "影响入口", "召回", "change analysis", "change impact"),
        WIKI: ("wiki", "模块地图", "阅读导览"),
        RCA: ("根因", "堆栈", "崩溃", "stack"),
        REQUIREMENT: ("需求", "gap register", "requirement"),
        TESTCASE: ("测试方案", "测试用例", "写用例", "test plan", "用例"),
        TESTDATA: ("造数据", "测试数据", "前置", "openapi", "test data"),
        JEV: ("jev", "浏览器回放", "explore a site"),
    }
    return earliest(text, phrases.get(skill, ()))


FIXTURES: Tuple[Dict[str, Any], ...] = (
    {"text": "对上面这段代码进行代码评审", "outcome": "clear", "winner": REVIEWER},
    {"text": "请对这段代码进行评审", "outcome": "clear", "winner": REVIEWER},
    {"text": "code review this payment service", "outcome": "clear", "winner": REVIEWER},
    {"text": "review this PR", "outcome": "clear", "winner": REVIEWER},
    {"text": "review this MR before merge", "outcome": "clear", "winner": REVIEWER},
    {"text": "review a diff", "outcome": "clear", "winner": REVIEWER},
    {"text": "PR review", "outcome": "clear", "winner": REVIEWER},
    {
        "text": "对照 origin/main 审当前仓库，要能打开的双语 HTML 审查报告，不要漏洞扫描清单",
        "outcome": "clear",
        "winner": REVIEWER,
    },
    {"text": "全仓评审，要 REVIEW-REPORT.html", "outcome": "clear", "winner": REVIEWER},
    {"text": "用证据包做 graph-backed review", "outcome": "clear", "winner": REVIEWER},
    {"text": "代码评审时顺便看影响面和测试缺口", "outcome": "clear", "winner": REVIEWER},
    {"text": "代码评审里看看异常处理", "outcome": "clear", "winner": REVIEWER},
    {"text": "给这个类做一次安全评审", "outcome": "clear", "winner": REVIEWER},
    {"text": "检查这段代码的设计", "outcome": "clear", "winner": REVIEWER},
    {"text": "对仓库做缺陷检测，输出 report_scan", "outcome": "clear", "winner": DEFECT},
    {"text": "SAST scan this diff", "outcome": "clear", "winner": DEFECT},
    {"text": "扫一下这个 PR 的安全漏洞", "outcome": "clear", "winner": DEFECT},
    {
        "text": "review this diff for vulnerabilities and secrets",
        "outcome": "clear",
        "winner": DEFECT,
    },
    {"text": "增量扫描这个 commit 的代码风险", "outcome": "clear", "winner": DEFECT},
    {"text": "上传这段代码做 adhoc 缺陷检测", "outcome": "clear", "winner": DEFECT},
    {"text": "跑 semgrep 做静态扫描", "outcome": "clear", "winner": DEFECT},
    {"text": "不要代码评审，只要漏洞扫描", "outcome": "clear", "winner": DEFECT},
    {"text": "只建索引并查调用方和回归范围，不要审查报告", "outcome": "clear", "winner": ANALYZER},
    {"text": "这段改动的影响面和测试缺口", "outcome": "clear", "winner": ANALYZER},
    {"text": "变更审查", "outcome": "clear", "winner": ANALYZER},
    {"text": "impact analysis only, no review report", "outcome": "clear", "winner": ANALYZER},
    {"text": "who calls this method", "outcome": "clear", "winner": ANALYZER},
    {"text": "生成架构 Wiki 和模块地图", "outcome": "clear", "winner": WIKI},
    {"text": "用 wiki inputs 出阅读导览", "outcome": "clear", "winner": WIKI},
    {"text": "NPE stack trace 做根因分析", "outcome": "clear", "winner": RCA},
    {"text": "这段崩溃堆栈帮我诊断根因", "outcome": "clear", "winner": RCA},
    {"text": "Solo router scenario: NPE stack + /tmp/my-app → 仓内根因", "outcome": "clear", "winner": RCA},
    {"text": "需求评审，出缺口和冲突清单", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "requirements review: build a gap register", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "按 PRD 写测试用例，只要用例", "outcome": "clear", "winner": TESTCASE},
    {"text": "write a test plan first (Plan only)", "outcome": "clear", "winner": TESTCASE},
    {"text": "提测后按 git 补回归用例", "outcome": "clear", "winner": TESTCASE},
    {"text": "构造测试数据并回写到用例前置", "outcome": "clear", "winner": TESTDATA},
    {"text": "create this account from the OpenAPI", "outcome": "clear", "winner": TESTDATA},
    {"text": "数据需求分析，准备用例物料", "outcome": "clear", "winner": TESTDATA},
    {"text": "使用 codexqa-code-reviewer 做代码评审", "outcome": "explicit", "winner": REVIEWER},
    {"text": "只用 codexqa-defect-analyzer", "outcome": "explicit", "winner": DEFECT},
    {
        "text": "用 codexqa-defect-analyzer 做代码评审，要审查报告",
        "outcome": "explicit_conflict",
        "winner": None,
        "alternatives": [REVIEWER],
    },
    {
        "text": "用 codexqa-code-reviewer 只出 report_scan 漏洞扫描，不要审查报告",
        "outcome": "explicit_conflict",
        "winner": None,
        "alternatives": [DEFECT],
    },
    {
        "text": "先写测试方案，再构造前置数据",
        "outcome": "chain",
        "winner": None,
        "steps": [TESTCASE, TESTDATA],
    },
    {
        "text": "从需求做到用例，再造一笔订单",
        "outcome": "chain",
        "winner": None,
        "steps": [TESTCASE, TESTDATA],
    },
    {
        "text": "既要审查报告也要 report_scan 缺陷扫描",
        "outcome": "ambiguous",
        "winner": None,
        "alternatives": [REVIEWER, DEFECT],
    },
    {
        "text": "代码知识图谱",
        "outcome": "ambiguous",
        "winner": None,
        "alternatives": [ANALYZER, WIKI],
    },
    {"text": "帮我评审一下这份需求文档", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "review the requirements for gaps", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "给 PRD 做需求质量分析，别写用例", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "根据调用链定位这个 NPE 的根因", "outcome": "clear", "winner": RCA},
    {"text": "看看这个 diff 能不能合", "outcome": "clear", "winner": REVIEWER},
    {"text": "把这些用例的前置账号造出来", "outcome": "clear", "winner": TESTDATA},
    {"text": "这段代码有没有 SQL 注入", "outcome": "clear", "winner": DEFECT},
    {"text": "先做代码评审，再做漏洞扫描", "outcome": "chain", "winner": None, "steps": [REVIEWER, DEFECT]},
    {"text": "先做变更分析，再构造前置数据", "outcome": "chain", "winner": None, "steps": [CHANGE, TESTDATA]},
    {"text": "用 codexqa-code-reviewer 只查调用方，不要审查报告", "outcome": "explicit_conflict", "winner": None, "alternatives": [ANALYZER]},
    {"text": "单文件评审这个支付类，给审查意见", "outcome": "clear", "winner": REVIEWER},
    {"text": "整仓做一次语义评审，要双语审查", "outcome": "clear", "winner": REVIEWER},
    {"text": "这段代码有没有问题", "outcome": "clear", "winner": REVIEWER},
    {"text": "过一遍这个 PR，看能不能合", "outcome": "clear", "winner": REVIEWER},
    {"text": "帮我看看这段粘贴的代码有没有漏洞", "outcome": "clear", "winner": DEFECT},
    {"text": "扫一下依赖里的 CVE 和密钥泄露", "outcome": "clear", "winner": DEFECT},
    {"text": "对仓库做安全基线，跑 gitleaks 和 osv-scanner", "outcome": "clear", "winner": DEFECT},
    {"text": "这段粘贴有没有 bug", "outcome": "clear", "winner": DEFECT},
    {"text": "相对 main 这次改了哪些调用方", "outcome": "clear", "winner": ANALYZER},
    {"text": "谁在调用这个方法，入口风险是什么", "outcome": "clear", "winner": ANALYZER},
    {"text": "哪些调用方没测到，有没有单测", "outcome": "clear", "winner": ANALYZER},
    {"text": "补测试缺口，不要写用例", "outcome": "clear", "winner": ANALYZER},
    {"text": "这个报错在哪个方法，帮我错误定位", "outcome": "clear", "winner": ANALYZER},
    {"text": "模块归属是不是分层不对", "outcome": "clear", "winner": ANALYZER},
    {"text": "变更分析：新增了哪些方法，影响了哪些入口", "outcome": "clear", "winner": CHANGE},
    {
        "text": "分析这次变更相对 origin/main 的影响面，出一份变更影响报告并补上缺的测试",
        "outcome": "clear",
        "winner": CHANGE,
    },
    {"text": "这次改动的影响面，出一份 HTML 影响报告", "outcome": "clear", "winner": CHANGE},
    {"text": "这个PR影响面，帮我补上缺的测试", "outcome": "clear", "winner": CHANGE},
    {"text": "change impact report for this diff with new runnable tests", "outcome": "clear", "winner": CHANGE},
    {"text": "召回测试用例，看这次 diff 有哪些现有用例能复用", "outcome": "clear", "winner": CHANGE},
    {"text": "变更分析，不要评审", "outcome": "clear", "winner": CHANGE},
    {"text": "用 codexqa-change-analysis 分析这个 PR", "outcome": "explicit", "winner": CHANGE},
    {"text": "只要影响面，不要变更影响报告", "outcome": "clear", "winner": ANALYZER},
    {"text": "代码评审时顺便出变更影响报告", "outcome": "clear", "winner": REVIEWER},
    {"text": "按 PRD 写测试用例，顺便召回测试用例", "outcome": "clear", "winner": TESTCASE},
    {"text": "帮我出一份影响分析报告", "outcome": "clear", "winner": ANALYZER},
    {"text": "who calls this and generate tests", "outcome": "clear", "winner": ANALYZER},
    {"text": "用 code-analyzer 出变更影响报告", "outcome": "explicit", "winner": ANALYZER},
    {"text": "先看影响面再补测试", "outcome": "chain", "winner": None, "steps": [ANALYZER, TESTCASE]},
    {"text": "先做变更分析，再写测试方案", "outcome": "chain", "winner": None, "steps": [CHANGE, TESTCASE]},
    {"text": "这个仓库从哪开始读，给一份模块划分", "outcome": "clear", "winner": WIKI},
    {"text": "讲讲这个模块是干什么的，要阅读路径", "outcome": "clear", "winner": WIKI},
    {"text": "不调模型，用 wiki inputs 出仓库导览", "outcome": "clear", "winner": WIKI},
    {"text": "看看这段日志里的报错原因", "outcome": "clear", "winner": RCA},
    {"text": "线上这个 NPE，结合日志给我一份根因报告", "outcome": "clear", "winner": RCA},
    {"text": "把这段异常整理成根因报告", "outcome": "clear", "winner": RCA},
    {"text": "调试输出里为什么抛了 NullPointerException", "outcome": "clear", "winner": RCA},
    {"text": "这份 PRD 歧义很多，需求能不能测", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "多来源需求互相矛盾，看需求一致性", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "需求有没有非功能需求缺口", "outcome": "clear", "winner": REQUIREMENT},
    {"text": "按 PRD 出测试，方案和用例都要", "outcome": "clear", "winner": TESTCASE},
    {"text": "提测前改一下已有用例", "outcome": "clear", "winner": TESTCASE},
    {"text": "做一轮测试设计，帮我出测试", "outcome": "clear", "winner": TESTCASE},
    {"text": "提测后按这个 PR diff 补用例", "outcome": "clear", "winner": TESTCASE},
    {"text": "只做测试分析，先不要造数据", "outcome": "clear", "winner": TESTCASE},
    {"text": "为用例准备数据，出测试物料清单", "outcome": "clear", "winner": TESTDATA},
    {"text": "把造数脚本发布成工具", "outcome": "clear", "winner": TESTDATA},
    {"text": "测试数据分析一下，要数据诉求", "outcome": "clear", "winner": TESTDATA},
    {"text": "scaffold a new domain from this OpenAPI directory", "outcome": "clear", "winner": TESTDATA},
    {"text": "造一笔订单作为前置", "outcome": "clear", "winner": TESTDATA},
    {"text": "write back test data into the case preconditions", "outcome": "clear", "winner": TESTDATA},
    {"text": "用 Jev browser 回放这个站点", "outcome": "explicit", "winner": JEV},
    {"text": "explore a site and generate browser UI cases", "outcome": "clear", "winner": JEV},
    {"text": "格式化一下这段代码", "outcome": "none", "winner": None},
    {"text": "帮我写个单元测试", "outcome": "none", "winner": None},
    {"text": "帮我看看", "outcome": "none", "winner": None},
    {"text": "我要一份 HTML 报告", "outcome": "none", "winner": None},
    {"text": "这个服务怎么启动", "outcome": "none", "winner": None},
)


def self_check() -> int:
    bundled = {row["name"] for row in load_bundled_catalog()}
    failures: List[str] = []
    for index, case in enumerate(FIXTURES, 1):
        result = suggest(case["text"], bundled)
        expect_outcome = case["outcome"]
        expect_winner = case.get("winner")
        if result["outcome"] != expect_outcome or result["winner"] != expect_winner:
            failures.append(
                "#%d outcome got %s winner %s expected %s %s :: %s"
                % (index, result["outcome"], result["winner"], expect_outcome, expect_winner, case["text"])
            )
            continue
        for name in case.get("alternatives") or []:
            if name not in result["alternatives"]:
                failures.append("#%d missing alternative %s :: %s" % (index, name, case["text"]))
        if case.get("steps") is not None and result["steps"] != case["steps"]:
            failures.append(
                "#%d steps got %s expected %s :: %s" % (index, result["steps"], case["steps"], case["text"])
            )
    # Live catalog still merges; suggestion must keep working with live+bundled names.
    live = discover(default_skills_root())
    merged = {row["name"] for row in merge_catalog(live, load_bundled_catalog())}
    sample = suggest("对上面这段代码进行代码评审", merged)
    if sample["winner"] != REVIEWER or sample["outcome"] != "clear":
        failures.append("live+bundled review sample got %s" % sample["outcome"])
    report = {
        "ok": not failures,
        "policy": POLICY,
        "fixtures": len(FIXTURES),
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failures else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Suggest a codexqa skill for a request")
    parser.add_argument("--text", default="", help="User request text")
    parser.add_argument("--text-file", type=Path, default=None, help="Read the request from a file")
    parser.add_argument("--self-check", action="store_true")
    parser.add_argument(
        "--skills-root",
        type=Path,
        default=None,
        help="Skills directory used to restrict suggestions to known names",
    )
    args = parser.parse_args(argv)
    if args.self_check:
        return self_check()
    if args.text_file is not None:
        text = args.text_file.read_text(encoding="utf-8", errors="replace")
    else:
        text = args.text
    root = args.skills_root or default_skills_root()
    try:
        live = discover(root)
    except FileNotFoundError:
        live = []
    names = [row["name"] for row in merge_catalog(live, load_bundled_catalog())]
    print(json.dumps(suggest(text, names), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
