#!/usr/bin/env bash
# Command traces go to commands.log. The terminal keeps warnings and the
# collector summary. Callers set LOG, OUT_DIR, SCRIPT_DIR, and COMMANDS.
# shellcheck shell=bash

collect_trace() {
  printf '+ %s\n' "$*" >>"$LOG"
}

run() {
  collect_trace "$*"
  COMMANDS+=("$*")
  if ! "$@" >>"$LOG" 2>&1; then
    echo "error: command failed: $*" >&2
    tail -n 30 "$LOG" >&2
    return 1
  fi
}

run_json() {
  local out="$1"
  shift
  printf '+ %s > %s\n' "$*" "$out" >>"$LOG"
  COMMANDS+=("$* > $out")
  if "$@" >"$out" 2>"$OUT_DIR/.last_err"; then
    return 0
  fi
  {
    echo "{\"error\":true,\"command\":\"$*\",\"stderr\":$(jq -Rs . <"$OUT_DIR/.last_err")}"
  } >"$out"
  echo "warn: command failed, wrote error stub to $out" >&2
  printf 'warn: command failed, wrote error stub to %s\n' "$out" >>"$LOG"
  return 0
}

# Index text is parsed from index.log. A failure stays visible; success does not.
collect_index() {
  local index_log="$1"
  shift
  collect_trace "$*"
  COMMANDS+=("$*")
  if ! "$@" >"$index_log" 2>&1; then
    echo "error: codexqa index failed; see $index_log" >&2
    tail -n 30 "$index_log" >&2
    return 1
  fi
  cat "$index_log" >>"$LOG"
}

# Manifest is written after the judgment packet. Render needs the stub that
# packet writer skipped while manifest.json was still absent.
collect_write_conclusion_stub() {
  [[ -f "$OUT_DIR/manifest.json" ]] || return 0
  [[ -f "$OUT_DIR/29-judgment-packet.json" ]] || return 0
  [[ -f "$OUT_DIR/review-conclusion.json" ]] && return 0
  local py=()
  if [[ -x "$SCRIPT_DIR/acr-python" ]]; then
    py=("$SCRIPT_DIR/acr-python")
  else
    py=(python3)
  fi
  if ! "${py[@]}" "$SCRIPT_DIR/lib/build-judgment-packet.py" \
      --dir "$OUT_DIR" --repo "$REPO_ABS" --conclusion-stub-only >>"$LOG" 2>&1; then
    echo "warn: review-conclusion.json stub was not written; see $LOG" >&2
  fi
}
