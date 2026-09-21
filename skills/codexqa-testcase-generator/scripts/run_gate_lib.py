"""Shared Plan/Exec artifact checks and run-status helpers."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from py_version import require_py310

require_py310()


MIN_REPORT_BYTES = 200
MIN_PLAN_BYTES = 1500
STATUS_REL = "testcase/testdocs/run-status.json"
STAGES = ("0", "1", "2", "3", "4", "4-1", "5", "6")
NEXT_STAGE = {
    "0": "1",
    "1": "2",
    "2": "3",
    "3": "4",
    "4": "4-1",
    "4-1": "5",
    "5": "5",
    "6": "6",
}
STAGE_INDEX_GLOBS = {
    "1": "testcase/knowledge-biz/*/stage1-*/index.json",
    "2": "testcase/knowledge-biz/*/stage2-*/index.json",
    "3": "testcase/knowledge-biz/*/stage3-*/index.json",
    "4": "testcase/knowledge-biz/*/stage4-*/index.json",
}
STAGE_REPORTS = {
    "0": "testcase/testdocs/stage0-input-processing-report.md",
    "1": "testcase/testdocs/stage1-requirement-analysis-report.md",
    "2": "testcase/testdocs/stage2-impact-and-risk-report.md",
    "3": "testcase/testdocs/stage3-coverage-judgment-report.md",
    "4": "testcase/testdocs/stage4-test-design-report.md",
    "4-1": "testcase/testdocs/stage4-1-audit-receipt.md",
}
AUDIT_SUMMARY = "Stage 4-1 three-round audit summary"
AUDIT_TRAIL_HEADERS = (
    "Problem type",
    "Source",
    "Correction action",
    "Result",
)
PLAN_MARKERS = (
    "Requirement materials",
    "Test analysis",
    "Test-plan detailed design",
    "Test-scenario ID",
    "Client type",
)
PLAN_BODY_MARKERS = (
    "Requirement materials",
    "Test analysis",
    "Test-plan detailed design",
)
CLIENT_TYPE_TOKENS = ("server", "web", "app", "unknown")
REPORT_HEADINGS = {
    "0": ("gapStats", "input form"),
    "1": ("Function inventory", "Interface-object inventory", "Scope boundary"),
    "2": ("Function impact chain", "Risk assessment and priority"),
    "3": ("Reuse inventory", "Change inventory", "Blank-scenario inventory"),
    "4": ("Type-identification results", "Test-scenario summary", "Test-scenario ID"),
    "4-1": AUDIT_TRAIL_HEADERS,
}
INDEX_REQUIRED = {
    "stage": str,
    "scenario": str,
    "keywords_used": list,
    "keyword_groups": list,
    "entries": list,
    "summary_output": str,
    "quality_check": dict,
    "knowledge_work_receipt": dict,
}
LOOP_BODY_MIN = 20
PLAN_BODY_MIN = 40
SCENARIO_ID_RE = re.compile(r"\bS-\d+\b")
LOOP_OR_H2_RE = re.compile(r"(?m)^(?:### Loop |## )")
HEADING_LINE_RE = re.compile(r"(?m)^#{1,3} ")
TABLE_RULE_RE = re.compile(r"^\|[\s\-:|]+\|$")
EMPTY_ROW_RE = re.compile(r"^\|(?:\s*\|)+$")


def resolve_path(path: Path) -> Path:
    return path.expanduser().resolve()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def default_status() -> Dict[str, Any]:
    return {
        "statusContractVersion": "1.0",
        "currentStage": "0",
        "completed": [],
        "lastGate": None,
        "planPersistedAt": "",
        "execAllowed": False,
    }


def status_path(run_dir: Path) -> Path:
    return run_dir / STATUS_REL


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def load_status(run_dir: Path) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, str]]]:
    path = status_path(run_dir)
    if not path.is_file():
        return None, [{
            "code": "STATUS_MISSING",
            "path": str(path),
            "reason": "run-status.json is missing; run close_stage.py --init",
        }]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None, [{
            "code": "STATUS_INVALID",
            "path": str(path),
            "reason": "run-status.json is not valid JSON",
        }]
    if not isinstance(data, dict):
        return None, [{
            "code": "STATUS_INVALID",
            "path": str(path),
            "reason": "run-status.json root must be an object",
        }]
    completed = data.get("completed")
    if not isinstance(completed, list):
        data["completed"] = []
    else:
        data["completed"] = [str(item) for item in completed]
    data["currentStage"] = str(data.get("currentStage") or "0")
    data["execAllowed"] = bool(data.get("execAllowed"))
    data["planPersistedAt"] = str(data.get("planPersistedAt") or "")
    return data, []


def write_status(run_dir: Path, status: Dict[str, Any]) -> None:
    path = status_path(run_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_last_gate(run_dir: Path, gate: str, result: Dict[str, Any]) -> None:
    status, failures = load_status(run_dir)
    if failures or status is None:
        return
    codes = []
    error = result.get("error")
    if isinstance(error, dict):
        extra = error.get("codes")
        if isinstance(extra, list):
            codes = [str(item) for item in extra]
    status["lastGate"] = {
        "gate": gate,
        "ok": bool(result.get("ok")),
        "at": now_iso(),
        "codes": codes,
    }
    write_status(run_dir, status)


def check_user_config(run_dir: Path, run_id: Optional[str] = None) -> List[Dict[str, str]]:
    failures: List[Dict[str, str]] = []
    config_path = run_dir / "testcase" / "testdocs" / "userConfig.json"
    if not config_path.is_file():
        return [{
            "code": "USER_CONFIG_MISSING",
            "path": str(config_path),
            "reason": "userConfig.json is missing; finish workspace init and Stage 0 first",
        }]
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return [{
            "code": "USER_CONFIG_INVALID",
            "path": str(config_path),
            "reason": "userConfig.json is not valid JSON",
        }]
    if not isinstance(config, dict):
        return [{
            "code": "USER_CONFIG_INVALID",
            "path": str(config_path),
            "reason": "userConfig.json root must be an object",
        }]
    stored = str(config.get("runDir") or "").strip()
    if not stored:
        failures.append({
            "code": "RUN_DIR_MISSING",
            "path": str(config_path),
            "reason": "userConfig.runDir is empty",
        })
    else:
        try:
            stored_resolved = resolve_path(Path(stored))
        except OSError:
            stored_resolved = Path(stored)
        if stored_resolved != run_dir:
            failures.append({
                "code": "RUN_DIR_MISMATCH",
                "path": str(config_path),
                "reason": "userConfig.runDir does not match --run-dir (%s vs %s)" % (
                    stored_resolved, run_dir
                ),
            })
    if run_id:
        stored_id = str(config.get("runid") or "").strip()
        if stored_id != run_id:
            failures.append({
                "code": "RUN_ID_MISMATCH",
                "path": str(config_path),
                "reason": "userConfig.runid does not match --run-id",
            })
    return failures


def check_cleaned_inputs(run_dir: Path) -> List[Dict[str, str]]:
    testdocs = run_dir / "testcase" / "testdocs"
    patterns = ("requirement-*.md", "tech-spec-*.md", "Spec-*.md")
    found: List[Path] = []
    for pattern in patterns:
        found.extend(p for p in testdocs.glob(pattern) if p.is_file())
    if found:
        return []
    return [{
        "code": "ARTIFACT_MISSING",
        "path": str(testdocs),
        "reason": "no cleaned Stage 0 input (requirement-*.md / tech-spec-*.md / Spec-*.md)",
    }]


def check_report(run_dir: Path, rel: str, label: str) -> List[Dict[str, str]]:
    path = run_dir / rel
    if not path.is_file():
        return [{
            "code": "ARTIFACT_MISSING",
            "path": str(path),
            "reason": "%s is missing" % label,
        }]
    if path.stat().st_size < MIN_REPORT_BYTES:
        return [{
            "code": "ARTIFACT_EMPTY",
            "path": str(path),
            "reason": "%s is too small to be a real stage report" % label,
        }]
    return []


def check_headings(run_dir: Path, stage: str) -> List[Dict[str, str]]:
    rel = STAGE_REPORTS.get(stage)
    if not rel:
        return []
    path = run_dir / rel
    if not path.is_file():
        return []
    text = read_text(path)
    missing = [heading for heading in REPORT_HEADINGS[stage] if heading not in text]
    if not missing:
        return []
    return [{
        "code": "HEADING_MISSING",
        "path": str(path),
        "reason": "Stage %s report is missing template headings: %s" % (stage, ", ".join(missing)),
    }]


def empty_index(stage_name: str, scenario: str) -> Dict[str, Any]:
    return {
        "stage": stage_name,
        "scenario": scenario,
        "keywords_used": [],
        "keyword_groups": [],
        "entries": [],
        "summary_output": "",
        "quality_check": {},
        "knowledge_work_receipt": {"events": []},
    }


def check_stage_index(run_dir: Path, stage: str) -> List[Dict[str, str]]:
    matches = [p for p in run_dir.glob(STAGE_INDEX_GLOBS[stage]) if p.is_file()]
    if not matches:
        return [{
            "code": "ARTIFACT_MISSING",
            "path": str(run_dir / "testcase" / "knowledge-biz" / ("stage%s-*/index.json" % stage)),
            "reason": "Stage %s index.json is missing" % stage,
        }]
    failures: List[Dict[str, str]] = []
    for path in matches:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            failures.append({
                "code": "ARTIFACT_INVALID",
                "path": str(path),
                "reason": "Stage %s index.json is not valid JSON" % stage,
            })
            continue
        if not isinstance(data, dict):
            failures.append({
                "code": "ARTIFACT_INVALID",
                "path": str(path),
                "reason": "Stage %s index.json root must be an object" % stage,
            })
            continue
        for key, expected in INDEX_REQUIRED.items():
            if not isinstance(data.get(key), expected):
                failures.append({
                    "code": "ARTIFACT_INVALID",
                    "path": str(path),
                    "reason": "Stage %s index.json must contain %s as %s" % (
                        stage, key, expected.__name__,
                    ),
                })
        receipt = data.get("knowledge_work_receipt")
        if isinstance(receipt, dict) and not isinstance(receipt.get("events"), list):
            failures.append({
                "code": "ARTIFACT_INVALID",
                "path": str(path),
                "reason": "Stage %s index.json knowledge_work_receipt.events must be a list" % stage,
            })
    return failures


def _loop_body(text: str, n: int) -> Optional[str]:
    start = re.search(r"(?m)^### Loop %d\b.*" % n, text)
    if not start:
        return None
    rest = text[start.end():]
    end = LOOP_OR_H2_RE.search(rest)
    if end:
        rest = rest[:end.start()]
    return rest


def _strip_table_filler(body: str) -> str:
    kept: List[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or TABLE_RULE_RE.match(stripped) or EMPTY_ROW_RE.match(stripped):
            continue
        kept.append(stripped)
    return "\n".join(kept)


def _section_body(text: str, heading: str) -> Optional[str]:
    start = re.search(r"(?m)^#{1,3} .*%s.*$" % re.escape(heading), text)
    if not start:
        return None
    rest = text[start.end():]
    end = HEADING_LINE_RE.search(rest)
    if end:
        rest = rest[:end.start()]
    return rest


def _strip_plan_filler(body: str) -> str:
    kept: List[str] = []
    in_table = False
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            in_table = False
            continue
        if TABLE_RULE_RE.match(stripped) or EMPTY_ROW_RE.match(stripped):
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            if not in_table:
                in_table = True
                continue
            kept.append(stripped)
            continue
        in_table = False
        kept.append(stripped)
    return "\n".join(kept)


def fixture_plan(*, scenario_id: str = "S-01") -> str:
    return (
        "# Formal test plan\n\n"
        "## 1. Requirement materials\n\n"
        "Local PRD covers login and session. Authentication is the only in-scope flow.\n\n"
        "## 2. Test analysis\n\n"
        "Login failure is P0. Auth service and session store sit on the impact chain.\n\n"
        "## 3. Test-plan detailed design\n\n"
        "| Test-scenario ID | Test point | Priority | Client type |\n"
        "|---|---|---|---|\n"
        "| %s | login | P0 | server |\n\n"
        "Client type: server. Scenario %s is the login happy path.\n"
        % (scenario_id, scenario_id)
        + ("notes\n" * 200)
    )


def check_audit_markers(run_dir: Path) -> List[Dict[str, str]]:
    stage4 = run_dir / STAGE_REPORTS["4"]
    if not stage4.is_file():
        return [{
            "code": "ARTIFACT_MISSING",
            "path": str(stage4),
            "reason": "Stage 4 report is missing",
        }]
    path = run_dir / STAGE_REPORTS["4-1"]
    if not path.is_file():
        return [{
            "code": "ARTIFACT_MISSING",
            "path": str(path),
            "reason": "Stage 4-1 audit receipt is missing",
        }]
    text = read_text(path)
    failures: List[Dict[str, str]] = []
    missing = [heading for heading in AUDIT_TRAIL_HEADERS if heading not in text]
    if missing:
        failures.append({
            "code": "HEADING_MISSING",
            "path": str(path),
            "reason": "Stage 4-1 audit receipt is missing trail headers: %s" % ", ".join(missing),
        })
    for n in (1, 2, 3):
        body = _loop_body(text, n)
        if body is None:
            failures.append({
                "code": "AUDIT_MARKER_MISSING",
                "path": str(path),
                "reason": "Stage 4-1 receipt is missing ### Loop %d" % n,
            })
            continue
        compact = re.sub(r"\s+", "", _strip_table_filler(body))
        if len(compact) < LOOP_BODY_MIN:
            failures.append({
                "code": "AUDIT_EMPTY",
                "path": str(path),
                "reason": "Loop %d has no non-empty body (heading plus empty table is not enough)" % n,
            })
    return failures


def extract_scenario_ids(text: str) -> set:
    return set(SCENARIO_ID_RE.findall(text))


def check_scenario_id_sets(run_dir: Path) -> List[Dict[str, str]]:
    stage4 = run_dir / STAGE_REPORTS["4"]
    plan = run_dir / "testdesign" / "test_design.md"
    if not stage4.is_file() or not plan.is_file():
        return []
    ids4 = extract_scenario_ids(read_text(stage4))
    ids5 = extract_scenario_ids(read_text(plan))
    if not ids4:
        return [{
            "code": "SCENARIO_ID_MISMATCH",
            "path": str(stage4),
            "reason": "Stage 4 report has no S-xx scenario IDs",
        }]
    if ids4 != ids5:
        return [{
            "code": "SCENARIO_ID_MISMATCH",
            "path": str(plan),
            "reason": "Stage 4 S-xx set %s does not match Stage 5 S-xx set %s" % (
                ",".join(sorted(ids4)) or "-",
                ",".join(sorted(ids5)) or "-",
            ),
        }]
    return []


def check_formal_plan(run_dir: Path) -> List[Dict[str, str]]:
    path = run_dir / "testdesign" / "test_design.md"
    failures: List[Dict[str, str]] = []
    if not path.is_file():
        return [{
            "code": "PLAN_INCOMPLETE",
            "path": str(path),
            "reason": "formal test plan is missing; finish Stage 5 first",
        }]
    if path.stat().st_size < MIN_PLAN_BYTES:
        return [{
            "code": "ARTIFACT_EMPTY",
            "path": str(path),
            "reason": "test_design.md is too small to be a formal test plan",
        }]
    text = read_text(path)
    missing = [marker for marker in PLAN_MARKERS if marker not in text]
    if missing:
        failures.append({
            "code": "PLAN_INCOMPLETE",
            "path": str(path),
            "reason": "test_design.md is missing required plan-template markers: %s" % ", ".join(missing),
        })
    lowered = text.lower()
    if not any(token in lowered for token in CLIENT_TYPE_TOKENS):
        failures.append({
            "code": "PLAN_INCOMPLETE",
            "path": str(path),
            "reason": "test_design.md has no final client-type decision (server/web/app/unknown)",
        })
    empty_chapters = []
    for heading in PLAN_BODY_MARKERS:
        body = _section_body(text, heading)
        if body is None:
            continue
        compact = re.sub(r"\s+", "", _strip_plan_filler(body))
        if len(compact) < PLAN_BODY_MIN:
            empty_chapters.append(heading)
    if empty_chapters:
        failures.append({
            "code": "PLAN_EMPTY",
            "path": str(path),
            "reason": "test_design.md has empty plan chapters (heading plus empty table is not enough): %s"
            % ", ".join(empty_chapters),
        })
    return failures


def _dir_has_file(root: Path) -> bool:
    if not root.is_dir():
        return False
    return any(path.is_file() for path in root.rglob("*"))


def _case_relpaths(root: Path) -> set:
    if not root.is_dir():
        return set()
    return {path.relative_to(root) for path in root.rglob("*") if path.is_file()}


def check_initial_cases(run_dir: Path) -> List[Dict[str, str]]:
    initial = run_dir / "testcase" / "initialcase"
    cases = run_dir / "testcase" / "cases"
    failures: List[Dict[str, str]] = []
    if not initial.is_dir() or not _dir_has_file(initial):
        failures.append({
            "code": "ARTIFACT_MISSING",
            "path": str(initial),
            "reason": "testcase/initialcase/ is missing or has no case files",
        })
    if not cases.is_dir() or not _dir_has_file(cases):
        failures.append({
            "code": "ARTIFACT_MISSING",
            "path": str(cases),
            "reason": "testcase/cases/ is missing or has no case files",
        })
        return failures
    missing = sorted(str(rel) for rel in _case_relpaths(initial) if rel not in _case_relpaths(cases))
    if missing:
        failures.append({
            "code": "ARTIFACT_MISSING",
            "path": str(cases),
            "reason": "testcase/cases/ is missing dual-write of: %s" % ", ".join(missing),
        })
    return failures


def check_stage_artifacts(run_dir: Path, stage: str, run_id: Optional[str] = None) -> List[Dict[str, str]]:
    if stage == "0":
        failures = []
        failures.extend(check_user_config(run_dir, run_id))
        failures.extend(check_cleaned_inputs(run_dir))
        failures.extend(check_report(run_dir, STAGE_REPORTS["0"], "Stage 0 report"))
        failures.extend(check_headings(run_dir, "0"))
        return failures
    if stage in ("1", "2", "3", "4"):
        failures = check_report(run_dir, STAGE_REPORTS[stage], "Stage %s report" % stage)
        failures.extend(check_headings(run_dir, stage))
        failures.extend(check_stage_index(run_dir, stage))
        return failures
    if stage == "4-1":
        failures = check_report(run_dir, STAGE_REPORTS["4-1"], "Stage 4-1 audit receipt")
        failures.extend(check_headings(run_dir, "4-1"))
        failures.extend(check_audit_markers(run_dir))
        return failures
    if stage == "5":
        failures = check_formal_plan(run_dir)
        failures.extend(check_scenario_id_sets(run_dir))
        return failures
    if stage == "6":
        return check_initial_cases(run_dir)
    return [{
        "code": "USAGE",
        "path": "",
        "reason": "unknown stage %s" % stage,
    }]


def check_prior_artifacts(run_dir: Path, run_id: Optional[str] = None) -> List[Dict[str, str]]:
    failures = []
    failures.extend(check_user_config(run_dir, run_id))
    failures.extend(check_cleaned_inputs(run_dir))
    for stage, rel in STAGE_REPORTS.items():
        failures.extend(check_report(run_dir, rel, "Stage %s report" % stage))
        failures.extend(check_headings(run_dir, stage))
    for stage in ("1", "2", "3", "4"):
        failures.extend(check_stage_index(run_dir, stage))
    failures.extend(check_audit_markers(run_dir))
    return failures


def check_status_for_gate(run_dir: Path, gate: str) -> List[Dict[str, str]]:
    status, failures = load_status(run_dir)
    if failures:
        return failures
    assert status is not None
    path = str(status_path(run_dir))
    completed = status.get("completed") or []
    current = str(status.get("currentStage") or "")
    if gate == "stage5":
        if "4-1" not in completed or current != "5":
            return [{
                "code": "STATUS_NOT_READY",
                "path": path,
                "reason": "currentStage must be 5 and completed must include 4-1 before writing the plan (currentStage=%s)" % current,
            }]
        return []
    if gate == "stage6":
        if "5" not in completed or current != "6" or not status.get("execAllowed"):
            return [{
                "code": "EXEC_NOT_ALLOWED",
                "path": path,
                "reason": "stage6 requires completed 5, currentStage 6, and execAllowed after --allow-exec",
            }]
        return []
    return [{
        "code": "USAGE",
        "path": path,
        "reason": "unknown gate %s" % gate,
    }]


def evaluate_gate(run_dir: Path, gate: str, run_id: Optional[str] = None) -> Dict[str, Any]:
    failures: List[Dict[str, str]] = []
    try:
        run_dir = resolve_path(run_dir)
    except OSError:
        pass
    if not run_dir.is_dir():
        failures.append({
            "code": "RUN_DIR_MISSING",
            "path": str(run_dir),
            "reason": "run_dir does not exist",
        })
        return {
            "ok": False,
            "gate": gate,
            "runDir": str(run_dir),
            "failures": failures,
            "error": {"code": "GATE_FAILED", "message": failures[0]["reason"], "codes": ["RUN_DIR_MISSING"]},
        }

    failures.extend(check_prior_artifacts(run_dir, run_id))
    if gate == "stage6":
        failures.extend(check_formal_plan(run_dir))
        failures.extend(check_scenario_id_sets(run_dir))
        failures.extend(check_initial_cases(run_dir))
    failures.extend(check_status_for_gate(run_dir, gate))

    ok = not failures
    codes = sorted({item["code"] for item in failures})
    result: Dict[str, Any] = {
        "ok": ok,
        "gate": gate,
        "runDir": str(run_dir),
        "failures": failures,
    }
    if not ok:
        result["error"] = {
            "code": "GATE_FAILED",
            "message": "%s gate failed (%s)" % (gate, ", ".join(codes)),
            "codes": codes,
        }
    return result


def write_passing_run(root: Path, *, for_gate: str = "stage5") -> Path:
    run_dir = resolve_path(root / "run")
    testdocs = run_dir / "testcase" / "testdocs"
    biz = run_dir / "testcase" / "knowledge-biz" / "demo"
    testdocs.mkdir(parents=True)
    (run_dir / "testdesign").mkdir(parents=True)
    (testdocs / "userConfig.json").write_text(
        json.dumps({"runid": "20260910-000000", "runDir": str(run_dir)}, ensure_ascii=False),
        encoding="utf-8",
    )
    (testdocs / "requirement-demo.md").write_text(
        "# Demo requirement\n\nEnough body for ingest.\n" * 8,
        encoding="utf-8",
    )
    reports = {
        "0": (
            "# Stage 0 input processing\n\n"
            "input form: A local file/directory\n"
            "gapStats: unresolvedRemoteCount=0 missingLocalCount=0\n"
            + ("notes\n" * 30)
        ),
        "1": (
            "# Stage 1 report\n\n"
            "## Function inventory\n\nLogin and session.\n\n"
            "## Interface-object inventory\n\nPOST /login\n\n"
            "## Scope boundary\n\nInScope: auth.\n"
            + ("notes\n" * 20)
        ),
        "2": (
            "# Stage 2 report\n\n"
            "## Function impact chain\n\nAuth service to session store.\n\n"
            "## Risk assessment and priority\n\nP0 login failure.\n"
            + ("notes\n" * 20)
        ),
        "3": (
            "# Stage 3 existing-case recall report\n\n"
            "## Reuse inventory\n\n(empty)\n\n"
            "## Change inventory\n\n(empty)\n\n"
            "## Blank-scenario inventory\n\nAll new from Stage 2.\n"
            + ("notes\n" * 20)
        ),
        "4": (
            "# Stage 4 report\n\n"
            "## Type-identification results\n\nTO-01 login.\n\n"
            "## Test-scenario summary\n\n"
            "| Test-scenario ID | Test point | Priority |\n"
            "|---|---|---|\n"
            "| S-01 | login | P0 |\n"
            + ("notes\n" * 20)
        ),
        "4-1": (
            "# Stage 4-1 audit receipt\n\n"
            "## Stage 4-1 three-round audit summary\n\n"
            "### Loop 1 coverage-mapping results\n\n"
            "Function list 1 item covered, corresponding S-01.\n\n"
            "### Loop 1 coverage completeness and knowledge fill-in\n\n"
            "| Problem type | Source | Correction action | Result |\n"
            "|---|---|---|---|\n"
            "| none | Stage 4 first draft | No structural issue | fixed 0 / known gap 0 |\n\n"
            "### Loop 2 dimension-check results\n\n"
            "No empty cells remained after fill-in for S-01.\n\n"
            "### Loop 3 correctness and executability\n\n"
            "S-01 preconditions and verification points are executable.\n"
        ),
    }
    for stage, body in reports.items():
        path = run_dir / STAGE_REPORTS[stage]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    index_names = {
        "stage1-requirement-analysis": "requirement-analysis",
        "stage2-impact-analysis": "impact-analysis",
        "stage3-case-recall": "case-recall",
        "stage4-test-design": "test-design",
    }
    for name, scenario in index_names.items():
        folder = biz / name
        folder.mkdir(parents=True)
        (folder / "index.json").write_text(
            json.dumps(empty_index(name, scenario), ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    (run_dir / "testdesign" / "test_design.md").write_text(
        fixture_plan(),
        encoding="utf-8",
    )
    case_body = "# Case\n\nstep\n"
    for rel in ("testcase/initialcase", "testcase/cases"):
        folder = run_dir / rel
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "testcase_srv.md").write_text(case_body, encoding="utf-8")
    status = default_status()
    if for_gate == "stage6":
        status["currentStage"] = "6"
        status["completed"] = ["0", "1", "2", "3", "4", "4-1", "5"]
        status["execAllowed"] = True
        status["planPersistedAt"] = now_iso()
    else:
        status["currentStage"] = "5"
        status["completed"] = ["0", "1", "2", "3", "4", "4-1"]
        status["execAllowed"] = False
    write_status(run_dir, status)
    return run_dir


def _codes(result: Dict[str, Any]) -> List[str]:
    error = result.get("error") or {}
    return list(error.get("codes") or [])


def verify_shell_rejections(root: Path) -> Optional[str]:
    """Return an error string if a shell fixture incorrectly passes."""
    heading_dir = write_passing_run(root / "heading", for_gate="stage5")
    (heading_dir / STAGE_REPORTS["1"]).write_text("# Report\n\n" + ("content\n" * 40), encoding="utf-8")
    heading = evaluate_gate(heading_dir, "stage5")
    if heading.get("ok") or "HEADING_MISSING" not in _codes(heading):
        return "200-byte Stage 1 report without headings must fail HEADING_MISSING"

    index_dir = write_passing_run(root / "index", for_gate="stage5")
    stub = next(index_dir.glob(STAGE_INDEX_GLOBS["1"]))
    stub.write_text('{"ok": true}\n', encoding="utf-8")
    index = evaluate_gate(index_dir, "stage5")
    if index.get("ok") or "ARTIFACT_INVALID" not in _codes(index):
        return "stub index.json {\"ok\": true} must fail ARTIFACT_INVALID"

    missing_receipt_dir = write_passing_run(root / "missing-receipt", for_gate="stage5")
    (missing_receipt_dir / STAGE_REPORTS["4-1"]).unlink()
    missing_receipt = evaluate_gate(missing_receipt_dir, "stage5")
    if missing_receipt.get("ok") or "ARTIFACT_MISSING" not in _codes(missing_receipt):
        return "missing stage4-1-audit-receipt.md must fail ARTIFACT_MISSING"

    loop_dir = write_passing_run(root / "loops", for_gate="stage5")
    (loop_dir / STAGE_REPORTS["4-1"]).write_text(
        "# Stage 4-1 audit receipt\n\n"
        + ("notes\n" * 30)
        + "| Problem type | Source | Correction action | Result |\n"
        + "|---|---|---|---|\n\n"
        + "## Stage 4-1 three-round audit summary\n\n"
        + "### Loop 1 coverage-mapping results\n\n"
        + "### Loop 2 dimension-check results\n\n"
        + "### Loop 3 correctness and executability\n",
        encoding="utf-8",
    )
    loops = evaluate_gate(loop_dir, "stage5")
    if loops.get("ok") or "AUDIT_EMPTY" not in _codes(loops):
        return "Loop titles only must fail AUDIT_EMPTY"

    thin_plan_dir = write_passing_run(root / "thin-plan", for_gate="stage5")
    (thin_plan_dir / "testdesign" / "test_design.md").write_text(
        "# Formal test plan\n\n"
        "| Test-scenario ID | Test point | Priority | Client type |\n"
        "|---|---|---|---|\n"
        "| S-01 | login | P0 | server |\n"
        + ("notes\n" * 250),
        encoding="utf-8",
    )
    thin_plan = check_stage_artifacts(thin_plan_dir, "5")
    if not any(item["code"] == "PLAN_INCOMPLETE" for item in thin_plan):
        return "plan with S-xx and client type but no template chapters must fail PLAN_INCOMPLETE"

    empty_body_dir = write_passing_run(root / "empty-plan-body", for_gate="stage5")
    (empty_body_dir / "testdesign" / "test_design.md").write_text(
        "# Formal test plan\n\n"
        + ("padding\n" * 250)
        + "## 1. Requirement materials\n\n"
        + "## 2. Test analysis\n\n"
        + "## 3. Test-plan detailed design\n\n"
        + "| Test-scenario ID | Test point | Priority | Client type |\n"
        + "|---|---|---|---|\n"
        + "| S-01 | login | P0 | server |\n\n"
        + "Client type: server\n",
        encoding="utf-8",
    )
    empty_body = check_stage_artifacts(empty_body_dir, "5")
    if not any(item["code"] == "PLAN_EMPTY" for item in empty_body):
        return "plan headings with empty chapter bodies must fail PLAN_EMPTY"

    no_cases_dir = write_passing_run(root / "no-cases", for_gate="stage6")
    shutil.rmtree(no_cases_dir / "testcase" / "cases", ignore_errors=True)
    no_cases = check_stage_artifacts(no_cases_dir, "6")
    if not any(item["code"] == "ARTIFACT_MISSING" and "cases" in item.get("path", "") for item in no_cases):
        return "initialcase-only persist must fail close stage 6 without testcase/cases/"
    no_cases_gate = evaluate_gate(no_cases_dir, "stage6")
    if no_cases_gate.get("ok") or "ARTIFACT_MISSING" not in _codes(no_cases_gate):
        return "initialcase-only persist must fail --gate stage6 without testcase/cases/"

    id_dir = write_passing_run(root / "ids", for_gate="stage6")
    (id_dir / "testdesign" / "test_design.md").write_text(
        fixture_plan(scenario_id="S-99"),
        encoding="utf-8",
    )
    mismatch = evaluate_gate(id_dir, "stage6")
    if mismatch.get("ok") or "SCENARIO_ID_MISMATCH" not in _codes(mismatch):
        return "S-01 vs S-99 must fail SCENARIO_ID_MISMATCH on stage6"
    close5_status = default_status()
    close5_status["currentStage"] = "5"
    close5_status["completed"] = ["0", "1", "2", "3", "4", "4-1"]
    write_status(id_dir, close5_status)
    id_close = check_stage_artifacts(id_dir, "5")
    if not any(item["code"] == "SCENARIO_ID_MISMATCH" for item in id_close):
        return "S-01 vs S-99 must fail SCENARIO_ID_MISMATCH on close stage 5"
    return None
