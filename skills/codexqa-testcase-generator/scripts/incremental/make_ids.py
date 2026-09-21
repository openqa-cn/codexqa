#!/usr/bin/env python3
"""Generate IDs without making business decisions."""

from __future__ import annotations

import argparse
import hashlib
import secrets
import time
from typing import Dict

from inc_common import (
    SkillError,
    ensure_safe_component,
    print_error,
    print_result,
)


def _digest(seed: str, index: int) -> str:
    return hashlib.sha256(f"{seed}:{index}".encode("utf-8")).hexdigest()


def _execution_id() -> str:
    return f"{int(time.time() * 1000)}-{secrets.randbelow(1000):03d}"


def generate(args: argparse.Namespace) -> Dict:
    if args.count < 1 or args.count > 1000:
        raise SkillError(
            "INVALID_COUNT",
            "count must be between 1 and 1000",
            {"count": args.count},
        )

    if args.kind == "execution-id":
        if args.count != 1:
            raise SkillError(
                "INVALID_COUNT",
                "execution-id generation creates one ID",
            )
        return {
            "ok": True,
            "kind": "executionId",
            "values": [_execution_id()],
            "generation": {"algorithm": "epoch-milliseconds-plus-random-suffix"},
        }

    prefix = {
        "candidate-id": "CAND",
        "change-id": "CHG",
        "action-id": "ACT",
        "case-id": "CASE",
    }[args.kind]
    seed = args.seed or args.content or f"{time.time_ns()}"
    values = []
    if args.kind == "case-id":
        if not args.run_id:
            raise SkillError(
                "RUN_ID_REQUIRED",
                "case-id generation requires the Agent-identified runId",
            )
        run_id = ensure_safe_component(args.run_id, "runId")
        base_ms = args.base_ms or int(time.time() * 1000)
        for index in range(args.count):
            suffix = int(_digest(seed, index)[:8], 16) % 1000
            values.append(f"{run_id}-{base_ms + index}-{suffix:03d}")
    else:
        for index in range(args.count):
            values.append(f"{prefix}-{_digest(seed, index)[:12]}")

    result = {
        "ok": True,
        "kind": args.kind,
        "values": values,
        "generation": {
            "seed": seed,
            "baseMilliseconds": (
                base_ms if args.kind == "case-id" else args.base_ms
            ),
            "algorithm": "sha256-derived",
        },
    }
    if args.kind == "case-id":
        result["runId"] = run_id
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kind",
        required=True,
        choices=(
            "execution-id",
            "candidate-id",
            "change-id",
            "action-id",
            "case-id",
        ),
    )
    parser.add_argument("--run-id")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--seed")
    parser.add_argument("--content")
    parser.add_argument("--base-ms", type=int)
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        print_result(generate(args), args.output)
        return 0
    except SkillError as error:
        print_error(error)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
