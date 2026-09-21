"""Fail fast when the host Python is older than 3.10.

Imported by gate/incremental libraries and standalone entry scripts so a bare
`python3` (e.g. 3.6) cannot partially execute and corrupt run state. Agents
should invoke via `scripts/tcg-python`, which resolves 3.10+ on PATH.
"""

from __future__ import annotations

import sys


def require_py310() -> None:
    if sys.version_info >= (3, 10):
        return
    sys.stderr.write(
        "FATAL: codexqa-testcase-generator requires Python 3.10+.\n"
        "Invoke via: <skill_dir>/scripts/tcg-python <skill_dir>/scripts/<script>.py …\n"
        f"Current interpreter: {sys.executable} ({sys.version.split()[0]})\n"
    )
    raise SystemExit(1)
