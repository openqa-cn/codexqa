#!/usr/bin/env python3
"""Gate before Stage 5 / Stage 6: require prior artifacts and run-status.

Stdout is one JSON object with at least `ok`. Human summary is `msg`.
Diagnostics go to stderr. Exit 0 only when every required check passes.

  scripts/tcg-python scripts/check_run_gate.py --run-dir <run_dir> --gate stage5
  scripts/tcg-python scripts/check_run_gate.py --run-dir <run_dir> --gate stage6
  scripts/tcg-python scripts/check_run_gate.py --self-check
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

import run_gate_lib as lib


def _emit(payload: dict, code: int) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    return code


def self_check() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="check-run-gate-"))
    try:
        empty = lib.evaluate_gate(tmp / "missing", "stage5")
        if empty.get("ok"):
            print("self-check: empty run_dir must fail", file=sys.stderr)
            return 2

        no_status = lib.write_passing_run(tmp / "nostatus", for_gate="stage5")
        lib.status_path(no_status).unlink()
        missing = lib.evaluate_gate(no_status, "stage5")
        if missing.get("ok") or "STATUS_MISSING" not in (missing.get("error") or {}).get("codes", []):
            print("self-check: missing run-status.json must fail", file=sys.stderr)
            print(json.dumps(missing, ensure_ascii=False), file=sys.stderr)
            return 2

        stage5_dir = lib.write_passing_run(tmp / "s5", for_gate="stage5")
        stage5 = lib.evaluate_gate(stage5_dir, "stage5", run_id="20260910-000000")
        if not stage5.get("ok"):
            print("self-check: stage5 populated run must pass", file=sys.stderr)
            print(json.dumps(stage5, ensure_ascii=False), file=sys.stderr)
            return 2

        stage6_blocked = lib.evaluate_gate(stage5_dir, "stage6")
        if stage6_blocked.get("ok"):
            print("self-check: stage6 must fail before --allow-exec", file=sys.stderr)
            return 2

        stage6_dir = lib.write_passing_run(tmp / "s6", for_gate="stage6")
        stage6 = lib.evaluate_gate(stage6_dir, "stage6", run_id="20260910-000000")
        if not stage6.get("ok"):
            print("self-check: stage6 populated run must pass", file=sys.stderr)
            print(json.dumps(stage6, ensure_ascii=False), file=sys.stderr)
            return 2

        (stage5_dir / lib.STAGE_REPORTS["1"]).unlink()
        blocked = lib.evaluate_gate(stage5_dir, "stage5")
        if blocked.get("ok"):
            print("self-check: missing Stage 1 report must fail", file=sys.stderr)
            return 2
        shell = lib.verify_shell_rejections(tmp / "shells")
        if shell:
            print("self-check: %s" % shell, file=sys.stderr)
            return 2
        return _emit({
            "ok": True,
            "gate": "self-check",
            "runDir": str(stage5_dir),
            "failures": [],
            "msg": "self-check passed",
        }, 0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Require Stage 0–4-1 artifacts and run-status before Stage 5/6",
    )
    parser.add_argument("--run-dir", help="Absolute run_dir (userConfig.runDir)")
    parser.add_argument("--run-id", default="", help="Optional userConfig.runid to verify")
    parser.add_argument("--gate", choices=("stage5", "stage6"), help="Which gate to enforce")
    parser.add_argument("--self-check", action="store_true", help="Offline fixture check")
    args = parser.parse_args()

    if args.self_check:
        return self_check()
    if not args.run_dir or not args.gate:
        return _emit({
            "ok": False,
            "gate": args.gate or "",
            "runDir": args.run_dir or "",
            "failures": [{
                "code": "USAGE",
                "path": "",
                "reason": "--run-dir and --gate are required unless --self-check",
            }],
            "error": {"code": "USAGE", "message": "--run-dir and --gate are required unless --self-check"},
            "msg": "usage: check_run_gate.py --run-dir <run_dir> --gate stage5|stage6",
        }, 1)

    run_dir = lib.resolve_path(Path(args.run_dir))
    result = lib.evaluate_gate(run_dir, args.gate, run_id=args.run_id or None)
    lib.write_last_gate(run_dir, args.gate, result)
    if result["ok"]:
        result["msg"] = "%s gate passed for %s" % (args.gate, run_dir)
        return _emit(result, 0)

    lines = ["%s gate failed" % args.gate]
    for item in result["failures"]:
        lines.append("- %s: %s (%s)" % (item["code"], item["reason"], item["path"]))
    result["msg"] = "\n".join(lines)
    print(result["msg"], file=sys.stderr)
    return _emit(result, 1)


if __name__ == "__main__":
    sys.exit(main())
