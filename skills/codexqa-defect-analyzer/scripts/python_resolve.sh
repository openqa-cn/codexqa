#!/usr/bin/env bash
# Resolve a Python 3.10+ interpreter for codexqa-defect-analyzer scripts.
# Usage: source this file, then: PY="$(aid_resolve_python)" || exit 1
aid_resolve_python() {
  local c ver
  if [[ -n "${PYTHON:-}" ]] && command -v "$PYTHON" >/dev/null 2>&1; then
    ver="$("$PYTHON" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)"
    if [[ "$ver" -ge 310 ]]; then
      command -v "$PYTHON"
      return 0
    fi
  fi
  for c in python3.12 python3.11 python3.10 python3.13 python3.14 python3; do
    command -v "$c" >/dev/null 2>&1 || continue
    ver="$("$c" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)"
    if [[ "$ver" -ge 310 ]]; then
      # Prefer interpreters that already have PyYAML (scope_policy dependency)
      if "$c" -c 'import yaml' >/dev/null 2>&1; then
        command -v "$c"
        return 0
      fi
      if [[ -z "${_aid_py_fallback:-}" ]]; then
        _aid_py_fallback="$(command -v "$c")"
      fi
    fi
  done
  if [[ -n "${_aid_py_fallback:-}" ]]; then
    echo "$_aid_py_fallback"
    return 0
  fi
  return 1
}
