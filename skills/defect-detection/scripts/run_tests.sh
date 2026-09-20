#!/usr/bin/env bash
# Run defect-detection unit/policy suites under Python 3.10+.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=python_resolve.sh
source "$HERE/python_resolve.sh"
PY="$(aid_resolve_python)" || {
  echo "FATAL: Python 3.10+ required on PATH (python3.10 / 3.11 / 3.12…)" >&2
  exit 1
}
"$PY" "$HERE/test_pipeline_fixes.py"
"$PY" "$HERE/audit_policy_fixtures.py"
