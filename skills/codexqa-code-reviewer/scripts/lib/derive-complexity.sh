#!/usr/bin/env bash
# codexqa-code-reviewer: Derive Complexity signals from an existing CodexQA pack.
# Local only — zero extra codexqa calls. Independent of Design-fit (10- optional).
# Usage: derive-complexity.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
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
Usage: derive-complexity.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]

Writes <OUT_DIR>/11-complexity-signals.json from 04/05 + impact edges-in
and bounded on-disk method windows. Missing inputs → thin signals, exit 0.

--repo: absolute repo root for body scans. Prefer this when collect runs
before manifest.json is written (manifest.repo may be absent).
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

OUT="$DIR/11-complexity-signals.json"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

files_file="$DIR/04-changed-files.json"
syms_file="$DIR/05-changed-symbols.json"
if [[ "$MODE" == "full" ]]; then
  [[ -f "$DIR/03-files-sample.json" ]] && files_file="$DIR/03-files-sample.json"
  [[ -f "$DIR/04-hot-symbols.json" ]] && syms_file="$DIR/04-hot-symbols.json"
fi
manifest_file="$DIR/manifest.json"
design_file="$DIR/10-design-fit-signals.json"

[[ -f "$files_file" ]] || files_file=""
[[ -f "$syms_file" ]] || syms_file=""
[[ -f "$manifest_file" ]] || manifest_file=""
[[ -f "$design_file" ]] || design_file=""

echo '{}' >"$TMPD/empty.json"
[[ -n "$files_file" ]] || files_file="$TMPD/empty.json"
[[ -n "$syms_file" ]] || syms_file="$TMPD/empty.json"
[[ -n "$manifest_file" ]] || manifest_file="$TMPD/empty.json"
[[ -n "$design_file" ]] || design_file="$TMPD/empty.json"

REPO="$(jq -r '.repo // empty' "$manifest_file" 2>/dev/null || true)"
# Collect may invoke derive before writing manifest.json — prefer explicit --repo.
if [[ -n "$REPO_ARG" ]]; then
  REPO="$REPO_ARG"
elif [[ -z "$REPO" && -n "${CODEXQA_REPO:-}" ]]; then
  REPO="$CODEXQA_REPO"
fi

# Empty edges-in artifacts (bounded) + per-symbol empty map for YAGNI fan-in
EMPTY_EDGES='[]'
EMPTY_BY_ID='{}'
if [[ -d "$DIR/impact" ]]; then
  EMPTY_EDGES="$(
    find "$DIR/impact" -name 'edges-in.json' 2>/dev/null | sort | head -n 40 | while read -r ef; do
      rel="${ef#"$DIR"/}"
      ec="$(jq '(.edges // .result.edges // []) | length' "$ef" 2>/dev/null || echo 0)"
      if [[ "${ec:-0}" == "0" ]]; then
        jq -n --arg a "$rel" '{artifact:$a, edge_count:0}'
      fi
    done | jq -s '.'
  )"
  [[ -n "$EMPTY_EDGES" ]] || EMPTY_EDGES='[]'
  EMPTY_BY_ID="$(
    find "$DIR/impact" -name 'edges-in.json' 2>/dev/null | sort | head -n 80 | while read -r ef; do
      parent="$(basename "$(dirname "$ef")")"
      # impact/<id>_/edges-in.json — strip trailing underscore used by collectors
      sid="${parent%_}"
      ec="$(jq '(.edges // .result.edges // []) | length' "$ef" 2>/dev/null || echo 0)"
      if [[ "${ec:-0}" == "0" && -n "$sid" ]]; then
        jq -n --arg id "$sid" '{($id):0}'
      fi
    done | jq -s 'add // {}'
  )"
  [[ -n "$EMPTY_BY_ID" ]] || EMPTY_BY_ID='{}'
fi
echo "$EMPTY_EDGES" >"$TMPD/empty_edges.json"
echo "$EMPTY_BY_ID" >"$TMPD/empty_by_id.json"

# Body metrics via ${ACR_PY:-python3} when available (sibling module — no heredoc)
BODY_PY="$(cd "$(dirname "$0")" && pwd)/_complexity_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$DIR" "$REPO" "$files_file" "$syms_file" "$TMPD/body_metrics.json" "$TMPD/empty_by_id.json"
else
  echo '{"body_metrics_ok":false,"hot_methods":[],"hot_types":[],"yagni_hints_body":[],"files_scanned":0,"symbols_considered":0,"repo_resolved":false}' >"$TMPD/body_metrics.json"
fi

jq -n \
  --arg mode "$MODE" \
  --slurpfile syms "$syms_file" \
  --slurpfile iq "$manifest_file" \
  --slurpfile design "$design_file" \
  --slurpfile body "$TMPD/body_metrics.json" \
  --slurpfile empty_edges "$TMPD/empty_edges.json" \
  '
  def stubs_total:
    ($iq[0].index_quality.stubs // 0) as $s
    | if ($s|type) == "object" then ($s.total // 0)
      elif ($s|type) == "number" then $s
      else 0 end;

  def nodes:
    ($syms[0] | (.nodes // .result.nodes // []))
    | if type == "array" then . else [] end;

  def design_ok:
    ($design[0].kind // "") == "DesignFitSignals";

  ($body[0] // {}) as $b
  | (nodes) as $nodes
  | ($empty_edges[0] // []) as $ee
  | {
      kind: "ComplexitySignals",
      mode: $mode,
      generated_by: "derive-complexity.sh",
      schema_version: 1,
      signals_thin: (($nodes|length) == 0 and (($b.hot_methods // [])|length) == 0),
      thresholds: {
        loc_attention: 80,
        loc_high: 150,
        decisions: 10,
        nesting: 5,
        type_add_methods: 15
      },
      hot_methods: ($b.hot_methods // []),
      hot_types: ($b.hot_types // []),
      yagni_hints: (
        ($b.yagni_hints_body // [])
        + (
            $ee
            | map({kind:"empty_edges_in", artifact, note:"no direct callers — review unused / premature complexity if add"})
          )
        + (
            if design_ok then
              (
                [(($design[0].dead_nested_symbols // [])[]
                  | {kind:"design_dead_nested_xref", name, id, note:"optional xref from design-fit dead_nested"}
                )][0:15]
              )
              + (
                  if ($design[0].sprawl.add_heavy // false) then
                    [{kind:"design_add_heavy_xref", note:"optional xref: design-fit sprawl.add_heavy"}]
                  else [] end
                )
            else [] end
          )
        | .[0:40]
      ),
      summary: {
        hot_method_count: (($b.hot_methods // [])|length),
        hot_type_count: (($b.hot_types // [])|length),
        yagni_hint_count: 0,
        files_scanned: ($b.files_scanned // 0),
        symbols_considered: ($b.symbols_considered // ($nodes|length)),
        body_metrics_ok: ($b.body_metrics_ok // false),
        design_xref: design_ok
      },
      confidence_caps: {
        heuristic: "medium",
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total
      },
      evidence_refs: (
        [
          (if ($nodes|length) > 0 then "05-changed-symbols.json" else empty end),
          "04-changed-files.json",
          "impact/*/edges-in.json",
          (if design_ok then "10-design-fit-signals.json" else empty end)
        ]
      ),
      notes: (
        if ($b.body_metrics_ok // false) then
          (if ($b.repo_resolved // false) then []
           else ["repo not resolved at derive time — pass --repo or write manifest.repo before derive; decisions/nesting may be 0"]
           end)
        else ["body metrics skipped (${ACR_PY:-python3} missing) — LOC from symbols only when present"]
        end
      )
    }
  | .summary.yagni_hint_count = (.yagni_hints|length)
  ' >"$OUT"

echo "Complexity signals written: $OUT"
