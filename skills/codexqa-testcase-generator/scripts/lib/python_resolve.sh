#!/usr/bin/env bash
# Resolve Python 3.10+ for codexqa-testcase-generator gate and stage scripts.
# Usage: source this file, then: ACR_PY="$(tcg_resolve_python)" || exit 1
tcg_resolve_python() {
  local c ver
  if [[ -n "${PYTHON:-}" ]] && command -v "$PYTHON" >/dev/null 2>&1; then
    ver="$("$PYTHON" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)"
    if [[ "$ver" -ge 310 ]]; then
      command -v "$PYTHON"
      return 0
    fi
  fi
  for c in python3.13 python3.12 python3.11 python3.10 python3; do
    command -v "$c" >/dev/null 2>&1 || continue
    ver="$("$c" -c 'import sys; print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)"
    if [[ "$ver" -ge 310 ]]; then
      command -v "$c"
      return 0
    fi
  done
  return 1
}
