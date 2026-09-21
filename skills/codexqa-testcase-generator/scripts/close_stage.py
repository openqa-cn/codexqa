#!/usr/bin/env python3
"""Advance Plan/Exec run-status.json after a stage's artifacts exist.

  scripts/tcg-python scripts/close_stage.py --run-dir <run_dir> --stage 0|1|2|3|4|4-1|5|6
  scripts/tcg-python scripts/close_stage.py --run-dir <run_dir> --allow-exec
  scripts/tcg-python scripts/close_stage.py --run-dir <run_dir> --init
  scripts/tcg-python scripts/close_stage.py --self-check
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import run_gate_lib as lib


def _emit(payload: Dict[str, Any], code: int) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    return code


def _result(
    ok: bool,
    run_dir: Path,
    status: Dict[str, Any],
    failures: List[Dict[str, str]],
    msg: str,
    error_code: str = "",
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "ok": ok,
        "runDir": str(run_dir),
        "currentStage": status.get("currentStage", ""),
        "completed": status.get("completed", []),
        "execAllowed": bool(status.get("execAllowed")),
        "failures": failures,
        "msg": msg,
    }
    if not ok:
        codes = sorted({item["code"] for item in failures})
        payload["error"] = {
            "code": error_code or (codes[0] if codes else "GATE_FAILED"),
            "message": msg,
            "codes": codes,
        }
    return payload


def init_status(run_dir: Path) -> Dict[str, Any]:
    run_dir = lib.resolve_path(run_dir)
    existing, failures = lib.load_status(run_dir)
    if existing is not None and not failures:
        return _result(True, run_dir, existing, [], "run-status.json already exists")
    status = lib.default_status()
    lib.write_status(run_dir, status)
    return _result(True, run_dir, status, [], "initialized run-status.json at stage 0")


def close_stage(run_dir: Path, stage: str) -> Dict[str, Any]:
    run_dir = lib.resolve_path(run_dir)
    status, failures = lib.load_status(run_dir)
    if failures or status is None:
        return _result(
            False,
            run_dir,
            lib.default_status(),
            failures,
            "run-status.json is missing; run close_stage.py --init",
            "STATUS_MISSING",
        )
    if status.get("currentStage") != stage:
        fail = [{
            "code": "STAGE_NOT_CURRENT",
            "path": str(lib.status_path(run_dir)),
            "reason": "currentStage is %s; cannot close %s" % (status.get("currentStage"), stage),
        }]
        return _result(False, run_dir, status, fail, fail[0]["reason"], "STAGE_NOT_CURRENT")

    artifact_failures = lib.check_stage_artifacts(run_dir, stage)
    if artifact_failures:
        return _result(
            False,
            run_dir,
            status,
            artifact_failures,
            "stage %s artifacts incomplete" % stage,
            artifact_failures[0]["code"],
        )

    completed = list(status.get("completed") or [])
    if stage not in completed:
        completed.append(stage)
    status["completed"] = completed
    if stage == "5":
        status["planPersistedAt"] = lib.now_iso()
        status["execAllowed"] = False
        status["currentStage"] = "5"
    elif stage == "6":
        status["currentStage"] = "6"
    else:
        status["currentStage"] = lib.NEXT_STAGE[stage]
    lib.write_status(run_dir, status)
    return _result(True, run_dir, status, [], "closed stage %s; currentStage=%s" % (
        stage, status["currentStage"]
    ))


def allow_exec(run_dir: Path) -> Dict[str, Any]:
    run_dir = lib.resolve_path(run_dir)
    status, failures = lib.load_status(run_dir)
    if failures or status is None:
        return _result(
            False,
            run_dir,
            lib.default_status(),
            failures,
            "run-status.json is missing; run close_stage.py --init",
            "STATUS_MISSING",
        )
    completed = status.get("completed") or []
    if "5" not in completed or not status.get("planPersistedAt"):
        fail = [{
            "code": "EXEC_NOT_ALLOWED",
            "path": str(lib.status_path(run_dir)),
            "reason": "close stage 5 first; --allow-exec only after planPersistedAt is set",
        }]
        return _result(False, run_dir, status, fail, fail[0]["reason"], "EXEC_NOT_ALLOWED")
    plan_failures = lib.check_formal_plan(run_dir)
    if plan_failures:
        return _result(False, run_dir, status, plan_failures, "formal plan is not usable", "PLAN_INCOMPLETE")
    status["execAllowed"] = True
    status["currentStage"] = "6"
    lib.write_status(run_dir, status)
    return _result(True, run_dir, status, [], "execAllowed=true; currentStage=6")


def self_check() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="close-stage-"))
    try:
        missing_dir = tmp / "empty"
        missing_dir.mkdir()
        inited = init_status(missing_dir)
        if not inited.get("ok") or inited.get("currentStage") != "0":
            print("self-check: --init must create stage 0", file=sys.stderr)
            return 2

        run_dir = lib.write_passing_run(tmp / "full", for_gate="stage5")
        # skip 4-1: rewrite status as if only 0-4 closed
        skipped = lib.default_status()
        skipped["currentStage"] = "4-1"
        skipped["completed"] = ["0", "1", "2", "3", "4"]
        lib.write_status(run_dir, skipped)
        blocked = lib.evaluate_gate(run_dir, "stage5")
        if blocked.get("ok") or "STATUS_NOT_READY" not in (blocked.get("error") or {}).get("codes", []):
            print("self-check: skip 4-1 must fail stage5 with STATUS_NOT_READY", file=sys.stderr)
            print(json.dumps(blocked, ensure_ascii=False), file=sys.stderr)
            return 2

        ready = lib.default_status()
        ready["currentStage"] = "5"
        ready["completed"] = ["0", "1", "2", "3", "4", "4-1"]
        lib.write_status(run_dir, ready)
        closed5 = close_stage(run_dir, "5")
        if not closed5.get("ok") or closed5.get("execAllowed"):
            print("self-check: close 5 must keep execAllowed false", file=sys.stderr)
            print(json.dumps(closed5, ensure_ascii=False), file=sys.stderr)
            return 2
        stage6_blocked = lib.evaluate_gate(run_dir, "stage6")
        if stage6_blocked.get("ok"):
            print("self-check: stage6 must fail without --allow-exec", file=sys.stderr)
            return 2

        allowed = allow_exec(run_dir)
        if not allowed.get("ok") or allowed.get("currentStage") != "6":
            print("self-check: --allow-exec must set currentStage 6", file=sys.stderr)
            print(json.dumps(allowed, ensure_ascii=False), file=sys.stderr)
            return 2
        stage6 = lib.evaluate_gate(run_dir, "stage6")
        if not stage6.get("ok"):
            print("self-check: stage6 must pass after --allow-exec", file=sys.stderr)
            print(json.dumps(stage6, ensure_ascii=False), file=sys.stderr)
            return 2
        closed6 = close_stage(run_dir, "6")
        if not closed6.get("ok") or "6" not in closed6.get("completed", []):
            print("self-check: close 6 must append 6", file=sys.stderr)
            return 2

        fresh = lib.write_passing_run(tmp / "seq", for_gate="stage5")
        lib.write_status(fresh, lib.default_status())
        for stage in ("0", "1", "2", "3", "4", "4-1"):
            step = close_stage(fresh, stage)
            if not step.get("ok"):
                print("self-check: sequential close failed at %s" % stage, file=sys.stderr)
                print(json.dumps(step, ensure_ascii=False), file=sys.stderr)
                return 2
        if close_stage(fresh, "5").get("currentStage") != "5":
            print("self-check: close 5 must stay on 5", file=sys.stderr)
            return 2
        shell = lib.verify_shell_rejections(tmp / "shells")
        if shell:
            print("self-check: %s" % shell, file=sys.stderr)
            return 2
        return _emit({
            "ok": True,
            "gate": "self-check",
            "runDir": str(run_dir),
            "failures": [],
            "msg": "self-check passed",
        }, 0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Advance Plan/Exec run-status.json")
    parser.add_argument("--run-dir", help="Absolute run_dir (userConfig.runDir)")
    parser.add_argument("--stage", choices=lib.STAGES, help="Stage to close")
    parser.add_argument("--allow-exec", action="store_true", help="Unlock Stage 6 after user confirmation")
    parser.add_argument("--init", action="store_true", help="Write run-status.json at stage 0 if missing")
    parser.add_argument("--self-check", action="store_true", help="Offline fixture check")
    args = parser.parse_args()

    if args.self_check:
        return self_check()
    if not args.run_dir:
        return _emit({
            "ok": False,
            "runDir": "",
            "currentStage": "",
            "completed": [],
            "execAllowed": False,
            "failures": [{"code": "USAGE", "path": "", "reason": "--run-dir is required"}],
            "error": {"code": "USAGE", "message": "--run-dir is required", "codes": ["USAGE"]},
            "msg": "usage: close_stage.py --run-dir <run_dir> --stage N|--allow-exec|--init",
        }, 1)

    run_dir = lib.resolve_path(Path(args.run_dir))
    if args.init:
        result = init_status(run_dir)
    elif args.allow_exec:
        result = allow_exec(run_dir)
    elif args.stage:
        result = close_stage(run_dir, args.stage)
    else:
        return _emit({
            "ok": False,
            "runDir": str(run_dir),
            "currentStage": "",
            "completed": [],
            "execAllowed": False,
            "failures": [{"code": "USAGE", "path": "", "reason": "one of --stage, --allow-exec, --init is required"}],
            "error": {"code": "USAGE", "message": "one of --stage, --allow-exec, --init is required", "codes": ["USAGE"]},
            "msg": "usage: close_stage.py --run-dir <run_dir> --stage N|--allow-exec|--init",
        }, 1)

    code = 0 if result.get("ok") else 1
    if not result.get("ok"):
        print(result.get("msg", ""), file=sys.stderr)
    return _emit(result, code)


if __name__ == "__main__":
    sys.exit(main())
