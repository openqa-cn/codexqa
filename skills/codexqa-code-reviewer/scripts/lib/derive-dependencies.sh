#!/usr/bin/env bash
# codexqa-code-reviewer: Derive Dependencies / supply-chain signals from a CodexQA pack.
# Local only — zero extra codexqa calls; no network CVE lookups.
# Usage: derive-dependencies.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]
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
Usage: derive-dependencies.sh --dir <OUT_DIR> [--mode pr|full] [--repo <REPO>]

Writes <OUT_DIR>/12-dependency-signals.json from 04-changed-files (or full
sample) + bounded on-disk manifests/locks. Missing inputs → thin signals, exit 0.

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

OUT="$DIR/12-dependency-signals.json"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

files_file="$DIR/04-changed-files.json"
if [[ "$MODE" == "full" ]]; then
  [[ -f "$DIR/03-files-sample.json" ]] && files_file="$DIR/03-files-sample.json"
fi
manifest_file="$DIR/manifest.json"
lang_file="$DIR/09-language-profile.json"

[[ -f "$files_file" ]] || files_file=""
[[ -f "$manifest_file" ]] || manifest_file=""
[[ -f "$lang_file" ]] || lang_file=""

echo '{}' >"$TMPD/empty.json"
[[ -n "$files_file" ]] || files_file="$TMPD/empty.json"
[[ -n "$manifest_file" ]] || manifest_file="$TMPD/empty.json"
[[ -n "$lang_file" ]] || lang_file="$TMPD/empty.json"

REPO="$(jq -r '.repo // empty' "$manifest_file" 2>/dev/null || true)"
if [[ -n "$REPO_ARG" ]]; then
  REPO="$REPO_ARG"
elif [[ -z "$REPO" && -n "${CODEXQA_REPO:-}" ]]; then
  REPO="$CODEXQA_REPO"
fi

BODY_PY="$(cd "$(dirname "$0")" && pwd)/_dependencies_body.py"
if { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; } && [[ -f "$BODY_PY" ]]; then
  "$SCRIPT_DIR/../acr-python" "$BODY_PY" "$DIR" "$REPO" "$files_file" "$lang_file" "$TMPD/body.json"
else
  echo '{"body_ok":false,"repo_resolved":false,"signals_thin":true,"ecosystems":[],"manifest_hits":[],"snapshot_or_floating":[],"lock_drift":[],"license_hints":[],"bloat":{},"necessity_flags":[],"local_audit":{"present":false},"thresholds":{},"files_considered":0}' >"$TMPD/body.json"
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
      kind: "DependencySignals",
      mode: $mode,
      generated_by: "derive-dependencies.sh",
      schema_version: 1,
      # jq // treats false as empty — must use has() for booleans
      signals_thin: (if ($b|has("signals_thin")) then $b.signals_thin else true end),
      thresholds: ($b.thresholds // {
        direct_add: 8,
        lock_new_lines: 200,
        max_files: 40,
        max_lines: 8000
      }),
      ecosystems: ($b.ecosystems // []),
      manifest_hits: ($b.manifest_hits // []),
      snapshot_or_floating: ($b.snapshot_or_floating // []),
      lock_drift: ($b.lock_drift // []),
      license_hints: ($b.license_hints // []),
      eol_imports: ($b.eol_imports // []),
      bloat: ($b.bloat // {}),
      necessity_flags: ($b.necessity_flags // []),
      local_audit: ($b.local_audit // {present:false}),
      summary: {
        manifest_hit_count: (($b.manifest_hits // [])|length),
        floating_count: (($b.snapshot_or_floating // [])|length),
        lock_drift_count: (($b.lock_drift // [])|length),
        license_hint_count: (($b.license_hints // [])|length),
        ecosystems: ($b.ecosystems // []),
        files_considered: ($b.files_considered // 0),
        body_ok: (if ($b|has("body_ok")) then $b.body_ok else false end),
        repo_resolved: (if ($b|has("repo_resolved")) then $b.repo_resolved else false end),
        review_language_focus: ($b.review_language_focus // "")
      },
      confidence_caps: {
        heuristic: "medium",
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total,
        no_network_cve: true
      },
      evidence_refs: (
        [
          "04-changed-files.json",
          (if ($b.review_language_focus // "") != "" then "09-language-profile.json" else empty end)
        ]
      ),
      notes: (
        if (if ($b|has("body_ok")) then $b.body_ok else false end) then
          (
            if (if ($b|has("repo_resolved")) then $b.repo_resolved else false end) then []
            else ["repo not resolved — pass --repo or write manifest.repo before derive"]
            end
            + (
              if (if ($b|has("signals_thin")) then $b.signals_thin else true end) then
                ["no dependency manifests hit — emit None in review"]
              else []
              end
            )
            + (
              if ((($b.eol_imports // [])|length) > 0) then
                ["eol_imports non-empty — commons-lang 2.x import without a pom is still a dependency finding"]
              else []
              end
            )
            + ["CVE IDs are never invented; use local_audit or out-of-band SCA"]
          )
        else ["dependency body metrics skipped (${ACR_PY:-python3} missing)"]
        end
      )
    }
  ' >"$OUT"

if [[ -f "$OUT" ]]; then
  "$SCRIPT_DIR/../acr-python" "$SCRIPT_DIR/derive_triage.py" "$OUT" "${REPO:-}" || echo "warn: derive triage failed for $OUT" >&2
fi
echo "Dependency signals written: $OUT"
