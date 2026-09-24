#!/usr/bin/env bash
# codexqa-code-reviewer: Derive performance signals (hot path / N+1 / unbounded alloc).
# Local only — zero extra codexqa; no profiler.
# Usage: derive-performance.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"

DIR=""
MODE="pr"
REPO_ARG=""

usage() {
  cat <<'EOF'
Usage: derive-performance.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]

Writes <OUT_DIR>/21-performance-signals.json from 04-changed-files (+ full
sample) + 07-tags + bounded on-disk scan (N+1 / hot-path / unbounded alloc).
Missing inputs → thin signals, exit 0.

--repo: absolute repo root (prefer when collect runs before manifest.json).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --repo) REPO_ARG="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "error: --dir must be an existing evidence pack directory" >&2
  exit 2
fi

case "$MODE" in
  pr|full) ;;
  *) echo "error: --mode must be pr or full" >&2; exit 2 ;;
esac

OUT="$DIR/21-performance-signals.json"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

files_file="$DIR/04-changed-files.json"
if [[ "$MODE" == "full" ]]; then
  [[ -f "$DIR/03-files-sample.json" ]] && files_file="$DIR/03-files-sample.json"
fi
manifest_file="$DIR/manifest.json"

[[ -f "$files_file" ]] || files_file=""
[[ -f "$manifest_file" ]] || manifest_file=""

echo '{}' >"$TMPD/empty.json"
[[ -n "$files_file" ]] || files_file="$TMPD/empty.json"
[[ -n "$manifest_file" ]] || manifest_file="$TMPD/empty.json"

REPO="$(jq -r '.repo // empty' "$manifest_file" 2>/dev/null || true)"
if [[ -n "$REPO_ARG" ]]; then
  REPO="$REPO_ARG"
elif [[ -z "$REPO" && -n "${CODEXQA_REPO:-}" ]]; then
  REPO="$CODEXQA_REPO"
fi

BODY_PY="$(cd "$(dirname "$0")" && pwd)/_performance_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$DIR" "$REPO" "$files_file" "$TMPD/body.json"
else
  echo '{"body_ok":false,"repo_resolved":false,"signals_thin":true,"n_plus_one_risks":[],"hot_path_risks":[],"unbounded_allocation":[],"residual_performance":[],"files_considered":0,"files_scanned":0}' >"$TMPD/body.json"
fi

jq -n \
  --arg mode "$MODE" \
  --slurpfile iq "$manifest_file" \
  --slurpfile body "$TMPD/body.json" \
  '
  def stubs_total:
    ($iq[0].index_quality.stubs // 0) as $s
    | if ($s|type) == "object" then ($s.total // 0)
      elif ($s|type) == "number" then $s
      else 0 end;

  ($body[0] // {}) as $b
  | {
      kind: "PerformanceSignals",
      mode: $mode,
      generated_by: "derive-performance.sh",
      schema_version: 1,
      signals_thin: (if ($b|has("signals_thin")) then $b.signals_thin else true end),
      thresholds: ($b.thresholds // {
        max_files: 40,
        max_lines: 4000,
        neighbor: 6
      }),
      n_plus_one_risks: ($b.n_plus_one_risks // []),
      hot_path_risks: ($b.hot_path_risks // []),
      unbounded_allocation: ($b.unbounded_allocation // []),
      weak_perf_tests: ($b.weak_perf_tests // []),
      unpooled_connections: ($b.unpooled_connections // []),
      residual_performance: ($b.residual_performance // []),
      summary: {
        n_plus_one_count: (($b.n_plus_one_risks // [])|length),
        hot_path_count: (($b.hot_path_risks // [])|length),
        unbounded_allocation_count: (($b.unbounded_allocation // [])|length),
        weak_perf_test_count: (($b.weak_perf_tests // [])|length),
        unpooled_connection_count: (($b.unpooled_connections // [])|length),
        residual_count: (($b.residual_performance // [])|length),
        files_considered: ($b.files_considered // 0),
        files_scanned: ($b.files_scanned // 0),
        body_ok: (if ($b|has("body_ok")) then $b.body_ok else false end),
        repo_resolved: (if ($b|has("repo_resolved")) then $b.repo_resolved else false end)
      },
      confidence_caps: {
        heuristic: "medium",
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total,
        no_profiler: true
      },
      evidence_refs: ["04-changed-files.json", "07-tags.json"],
      notes: (
        if (if ($b|has("body_ok")) then $b.body_ok else false end) then
          (
            if (if ($b|has("repo_resolved")) then $b.repo_resolved else false end) then []
            else ["repo not resolved — pass --repo or write manifest.repo before derive"]
            end
            + (
              if (if ($b|has("signals_thin")) then $b.signals_thin else true end) then
                (
                  if (($b.residual_performance // [])|length) > 0 then
                    ["signals_thin for findings — emit None; still report residual_performance"]
                  else
                    ["no performance pathology heuristics hit — emit None in review"]
                  end
                )
              else []
              end
            )
            + (
              if (($b.n_plus_one_risks // [])|length) > 0
                 or (($b.hot_path_risks // [])|length) > 0
                 or (($b.unbounded_allocation // [])|length) > 0 then
                ["Hard gate: non-empty n_plus_one/hot_path/unbounded_allocation → findings or deferred residuals with path:line"]
              else []
              end
            )
            + (
              if (($b.unpooled_connections // [])|length) > 0 then
                ["Hard gate: each unpooled_connections row is its own finding even when signals_thin stays true. Do not fold it into n_plus_one."]
              else []
              end
            )
            + ["Never invent profiler/SLO/p99 conclusions; residual when thin"]
          )
        else ["performance body metrics skipped (${ACR_PY:-python3} missing)"]
        end
      )
    }
  ' >"$OUT"

if [[ -f "$OUT" ]]; then
  "$SCRIPT_DIR/../acr-python" "$SCRIPT_DIR/derive_triage.py" "$OUT" "${REPO:-}" || echo "warn: derive triage failed for $OUT" >&2
fi
echo "Performance signals written: $OUT"
