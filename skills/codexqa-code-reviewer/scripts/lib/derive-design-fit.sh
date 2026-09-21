#!/usr/bin/env bash
# codexqa-code-reviewer: Derive Design-fit signals from an existing CodexQA pack.
# Pure local processing — zero extra codexqa calls.
# Inputs: 03/04/05 + impact/*/edges-in (+ optional diffs text, repo files for package/import,
#         imports/ when mode=full). Missing inputs → thin signals, exit 0.
# Usage: derive-design-fit.sh --dir <OUT_DIR> [--mode pr|full]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=python_resolve.sh
source "$SCRIPT_DIR/python_resolve.sh"
ACR_PY="$(acr_resolve_python 2>/dev/null || true)"

DIR=""
MODE="pr"

usage() {
  cat <<'EOF'
Usage: derive-design-fit.sh --dir <OUT_DIR> [--mode pr|full]

Writes <OUT_DIR>/10-design-fit-signals.json from existing pack artifacts only.
Adds package/import layer hints and dead-nested / add-heavy over-abstraction signals.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
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

OUT="$DIR/10-design-fit-signals.json"
EMPTY_JSON='{}'

cg_file="$DIR/03-change-groups.json"
files_file="$DIR/04-changed-files.json"
syms_file="$DIR/05-changed-symbols.json"
if [[ "$MODE" == "full" ]]; then
  [[ -f "$DIR/03-files-sample.json" ]] && files_file="$DIR/03-files-sample.json"
  [[ -f "$DIR/04-hot-symbols.json" ]] && syms_file="$DIR/04-hot-symbols.json"
fi
manifest_file="$DIR/manifest.json"

[[ -f "$cg_file" ]] || cg_file=""
[[ -f "$files_file" ]] || files_file=""
[[ -f "$syms_file" ]] || syms_file=""
[[ -f "$manifest_file" ]] || manifest_file=""

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
echo "$EMPTY_JSON" >"$TMPD/empty.json"
[[ -n "$cg_file" ]] || cg_file="$TMPD/empty.json"
[[ -n "$files_file" ]] || files_file="$TMPD/empty.json"
[[ -n "$syms_file" ]] || syms_file="$TMPD/empty.json"
[[ -n "$manifest_file" ]] || manifest_file="$TMPD/empty.json"

REPO="$(jq -r '.repo // empty' "$manifest_file" 2>/dev/null || true)"

# --- Extract package + import decls (bounded) from diffs text and/or repo files ---
# Generic patterns only (Java/Kotlin package/import, Go import ", JS/TS from/import paths).
if ! { [[ -n "${ACR_PY:-}" ]] || command -v ${ACR_PY:-python3} >/dev/null 2>&1; }; then
  echo '{"packages":[],"imports_sample":[],"files":[],"import_cross_layer":[]}' >"$TMPD/pkg_import.json"
else
"$SCRIPT_DIR/../acr-python" - "$DIR" "$REPO" "$files_file" "$TMPD/pkg_import.json" <<'PY'
import json, os, re, sys
from pathlib import Path

out_dir, repo, files_json, out_path = sys.argv[1:5]

LAYER_KEYS = [
    ("入口", ("controller", "controllers", "handler", "handlers", "api", "apis", "iface",
              "interfaces", "endpoint", "endpoints", "gateway", "gateways", "rpc", "grpc",
              "http", "rest")),
    ("应用", ("service", "services", "application", "app", "apps", "biz", "business",
              "usecase", "usecases", "manager", "managers")),
    ("领域", ("domain", "domains", "model", "models", "entity", "entities", "core",
              "aggregate", "aggregates")),
    ("存储", ("dao", "daos", "mapper", "mappers", "repository", "repositories", "repo",
              "repos", "storage", "persist", "infrastructure", "infra", "dal")),
]

def layer_of(token: str) -> str:
    s = (token or "").lower().replace(".", "/").replace("\\", "/")
    # strip common source roots so com/foo/service survives
    s = re.sub(r"(^|/)(src/(main|test)/(java|kotlin|scala)|src|app|lib)(/|$)", "/", s)
    parts = [p for p in re.split(r"[/]+", s) if p]
    # also consider filename stem (FooController.java)
    stem = parts[-1] if parts else ""
    stem = re.sub(r"\.(java|kt|kts|go|ts|tsx|js|jsx|py|cs)$", "", stem)
    check = parts + ([stem] if stem and stem not in parts else [])
    for layer, keys in LAYER_KEYS:
        for p in check:
            if p in keys:
                return layer
            for k in keys:
                # OrderService / PaymentController style tokens
                if len(p) > len(k) and (p.endswith(k) or k in p.split("_")):
                    return layer
    return "other"

def file_paths(obj):
    arr = (
        obj.get("nodes") or obj.get("result", {}).get("nodes")
        or obj.get("files") or obj.get("result", {}).get("files")
        or obj.get("paths") or obj.get("result", {}).get("paths")
        or []
    )
    out = []
    if not isinstance(arr, list):
        return out
    for x in arr:
        if isinstance(x, str) and x:
            out.append(x)
        elif isinstance(x, dict):
            p = x.get("path") or x.get("file") or x.get("name")
            if isinstance(p, str) and p:
                out.append(p)
    return out[:80]

PKG_RE = re.compile(r"(?m)^\s*(?:\+)?package\s+([\w.]+)\s*;?")
# Java/Kotlin: import com.foo.Bar;  Go: import "a/b";  ES: from 'x' / import 'x'
IMP_RE = re.compile(
    r"(?m)^\s*(?:\+)?"
    r"(?:import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;"
    r"|import\s+\"([^\"]+)\""
    r"|from\s+['\"]([^'\"]+)['\"]"
    r"|import\s+['\"]([^'\"]+)['\"])"
)

def extract_from_text(text: str):
    packages = PKG_RE.findall(text or "")
    imports = []
    for m in IMP_RE.finditer(text or ""):
        for g in m.groups():
            if g:
                imports.append(g)
                break
    return packages, imports

def walk_strings(obj, acc, limit=40):
    if len(acc) >= limit:
        return
    if isinstance(obj, str):
        if "package " in obj or "import " in obj or "from " in obj:
            acc.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            walk_strings(v, acc, limit)
            if len(acc) >= limit:
                return
    elif isinstance(obj, list):
        for v in obj:
            walk_strings(v, acc, limit)
            if len(acc) >= limit:
                return

try:
    with open(files_json, encoding="utf-8") as f:
        files_obj = json.load(f)
except Exception:
    files_obj = {}

paths = file_paths(files_obj)
by_file = []
all_packages = []
all_imports = []

# 1) diffs/*.diff.json text (when CodexQA emitted non-empty diffs)
diffs_dir = Path(out_dir) / "diffs"
if diffs_dir.is_dir():
    for dp in sorted(diffs_dir.glob("*.diff.json"))[:40]:
        try:
            data = json.loads(dp.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        blobs = []
        walk_strings(data, blobs)
        for blob in blobs:
            pkgs, imps = extract_from_text(blob)
            all_packages.extend(pkgs)
            all_imports.extend(imps)

# 2) On-disk changed files listed in pack (no extra CodexQA; bounded head read)
if repo and os.path.isdir(repo):
    for rel in paths:
        abs_path = os.path.join(repo, rel)
        if not os.path.isfile(abs_path):
            continue
        try:
            with open(abs_path, encoding="utf-8", errors="ignore") as f:
                head = "".join([next(f) for _ in range(200)])
        except Exception:
            continue
        pkgs, imps = extract_from_text(head)
        # prefer first package decl as file package
        pkg = pkgs[0] if pkgs else None
        file_layer = layer_of(pkg) if pkg else layer_of(rel)
        import_layers = []
        cross = []
        for imp in imps[:40]:
            il = layer_of(imp)
            import_layers.append({"import": imp, "layer": il})
            if file_layer != "other" and il != "other" and il != file_layer:
                cross.append({
                    "file": rel,
                    "file_package": pkg,
                    "file_layer": file_layer,
                    "import": imp,
                    "import_layer": il,
                    "source": "package_import",
                })
        by_file.append({
            "path": rel,
            "package": pkg,
            "path_layer": layer_of(rel),
            "package_layer": layer_of(pkg) if pkg else "other",
            "resolved_layer": file_layer if pkg else layer_of(rel),
            "imports": import_layers[:30],
            "import_cross_layer": cross[:20],
        })
        all_packages.extend(pkgs)
        all_imports.extend(imps)

# 3) CodexQA-empty fallback: imports/*-ondisk.json written by collectors
imp_dir = Path(out_dir) / "imports"
if imp_dir.is_dir():
    for op in sorted(imp_dir.glob("*-ondisk.json"))[:40]:
        try:
            data = json.loads(op.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        rel = data.get("file") or ""
        pkgs = list(data.get("packages") or [])
        imps = list(data.get("imports") or [])
        if not rel and not pkgs and not imps:
            continue
        pkg = pkgs[0] if pkgs else None
        file_layer = layer_of(pkg) if pkg else layer_of(rel)
        if file_layer == "other":
            file_layer = layer_of(rel)
        cross = []
        import_layers = []
        for imp in imps[:40]:
            il = layer_of(imp)
            import_layers.append({"import": imp, "layer": il, "source": "ondisk"})
            if file_layer != "other" and il != "other" and il != file_layer:
                cross.append({
                    "file": rel,
                    "file_package": pkg,
                    "file_layer": file_layer,
                    "import": imp,
                    "import_layer": il,
                    "source": "ondisk_import",
                })
        by_file.append({
            "path": rel,
            "package": pkg,
            "path_layer": layer_of(rel),
            "package_layer": layer_of(pkg) if pkg else "other",
            "resolved_layer": file_layer,
            "imports": import_layers[:30],
            "import_cross_layer": cross[:20],
            "source": "ondisk",
        })
        all_packages.extend(pkgs)
        all_imports.extend(imps)

# Dedupe import cross-layer across files
import_cross = []
seen = set()
for row in by_file:
    for c in row.get("import_cross_layer") or []:
        key = (c.get("file"), c.get("import"), c.get("file_layer"), c.get("import_layer"))
        if key in seen:
            continue
        seen.add(key)
        import_cross.append(c)
        if len(import_cross) >= 40:
            break
    if len(import_cross) >= 40:
        break

payload = {
    "packages": sorted(set(all_packages))[:40],
    "imports_sample": sorted(set(all_imports))[:60],
    "files": by_file[:40],
    "import_cross_layer": import_cross,
}
Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
PY
fi

# shellcheck disable=SC2016
jq -n \
  --arg mode "$MODE" \
  --slurpfile cg "$cg_file" \
  --slurpfile files "$files_file" \
  --slurpfile syms "$syms_file" \
  --slurpfile iq "$manifest_file" \
  --slurpfile pkg "$TMPD/pkg_import.json" \
  '
  def layer_token($p):
    ($p // "" | ascii_downcase | gsub("\\.";"/") | gsub("\\\\";"/")) as $s
    | if ($s | test("(^|/)(controller|controllers|handler|handlers|api|apis|iface|interfaces|endpoint|endpoints|gateway|gateways|rpc|grpc|http|rest)(/|$)"))
      then "入口"
      elif ($s | test("(^|/)(service|services|application|app|apps|biz|business|usecase|usecases|manager|managers)(/|$)"))
      then "应用"
      elif ($s | test("(^|/)(domain|domains|model|models|entity|entities|core|aggregate|aggregates)(/|$)"))
      then "领域"
      elif ($s | test("(^|/)(dao|daos|mapper|mappers|repository|repositories|repo|repos|storage|persist|infrastructure|infra|dal)(/|$)"))
      then "存储"
      else "other"
      end;

  # Prefer package/namespace layer over path when available.
  def layer_path($p): layer_token($p);
  def layer_ns($n): layer_token($n);
  # Layer from nested type / method names (PascalCase tokens), not only path/package
  def layer_name($n):
    ($n // "" | ascii_downcase) as $s
    | if ($s | test("controller|handler|endpoint|gateway|servlet|resource$|(^|[_.])api([_.]|$)"))
      then "入口"
      elif ($s | test("service|usecase|manager|application|(^|[_.])biz([_.]|$)"))
      then "应用"
      elif ($s | test("domain|entity|aggregate|(^|[_.])model([_.]|$)"))
      then "领域"
      elif ($s | test("dao|mapper|repository|(^|[_.])repo([_.]|$)|storage|persist|jdbc"))
      then "存储"
      else "other" end;

  def file_paths:
    ($files[0] | (.nodes // .result.nodes // .files // .result.files // .paths // .result.paths // []))
    | if type != "array" then []
      else
        map(
          if type == "string" then .
          elif type == "object" then (.path // .file // .name // empty)
          else empty end
        )
        | map(select(type == "string" and length > 0))
      end;

  def symbol_nodes:
    ($syms[0] | (.nodes // .result.nodes // []))
    | if type == "array" then . else [] end;

  def group_count:
    ($cg[0] | (.result.groups // .groups // []))
    | if type == "array" then length else 0 end;

  def stubs_total:
    ($iq[0].index_quality.stubs // 0) as $s
    | if ($s|type) == "object" then ($s.total // 0)
      elif ($s|type) == "number" then $s
      else 0 end;

  def pkg_files:
    if ($pkg|length) == 0 then [] else ($pkg[0].files // []) end;

  def pkg_cross:
    if ($pkg|length) == 0 then [] else ($pkg[0].import_cross_layer // []) end;

  (file_paths) as $fps
  | (symbol_nodes) as $nodes
  | (
      # Label files: package_layer from pkg extract wins over path_layer
      (
        reduce pkg_files[] as $f ({};
          .[$f.path] = $f
        )
      ) as $by
      | ($fps | map(
          . as $p
          | ($by[$p] // null) as $meta
          | {
              path: $p,
              path_layer: layer_path($p),
              package: ($meta.package // null),
              package_layer: ($meta.package_layer // "other"),
              resolved_layer: (
                if $meta != null and ($meta.resolved_layer // "other") != "other" then $meta.resolved_layer
                elif $meta != null and ($meta.package_layer // "other") != "other" then $meta.package_layer
                else layer_path($p)
                end
              )
            }
        ))
    ) as $labeled
  | (
      # Namespace layers from changed symbols (CodexQA namespace / module)
      (
        [$nodes[] | (.namespace // .module // empty) | select(type=="string" and length>0)]
        | unique
        | map({namespace: ., layer: layer_ns(.)})
      )
    ) as $ns_layers
  | (
      reduce ($labeled[] | .resolved_layer) as $L ({};
        .[$L] = ((.[$L] // 0) + 1)
      )
    ) as $layer_summary
  | ([$nodes[] | select((.change_status // "") == "add")] | length) as $add_n
  | ([$nodes[] | select((.change_status // "") == "change")] | length) as $change_n
  | ([$fps[] | split("/") | .[:-1] | join("/")] | unique | length) as $dir_n
  | (
      # Nested / type-like candidates — from_count is NOT fan-in; do NOT treat ==0 as dead.
      # Confirmed dead_nested_symbols require empty edges-in (filled after impact scan).
      [$nodes[]
        | select(
            (
              ($mode == "full")
              or ((.change_status // "") == "add")
              or ((.change_status // "default") == "default")
              or ((.change_status // "") == "")
            )
            and (
              ((.depth // 0) >= 2)
              or ((.kind // "") | test("class|type|interface|struct"; "i"))
              or (
                ((.depth // 0) >= 2)
                and ((.name // "") | test("^[A-Z][A-Za-z0-9_]*$"))
              )
            )
          )
        | {
            name, kind, depth, id, from_count, tested_count, change_status,
            fan_in_basis: "unconfirmed",
            from_count_note: "from_count is NOT fan-in; nested/interface methods often miss in-edges — confirm via empty edges-in before YAGNI"
          }
      ] | unique_by(.id // .name) | .[0:40]
    ) as $dead_nested_candidates
  | (
      [] 
    ) as $dead_nested
  | (
      # Same-file nested type name layer conflicts (path may be all 存储)
      (
        [$nodes[]
          | {
              file: (.file // .path // .location // ""),
              name: (.name // ""),
              id: (.id // .name // ""),
              layer: layer_name(.name // "")
            }
          | select(.file != "" and .layer != "other")
        ]
        | group_by(.file)
        | map(
            . as $g
            | ($g | map(.layer) | unique) as $layers
            | select(($layers | length) >= 2)
            | {
                file: $g[0].file,
                layers: $layers,
                symbols: [$g[] | {name, layer, id}][0:8],
                kind: "nested_type_cross_layer",
                note: "same-file nested type/method names resolve to multiple layers"
              }
          )
        | .[0:20]
      )
    ) as $nested_cross
  | {
      kind: "DesignFitSignals",
      mode: $mode,
      generated_by: "derive-design-fit.sh",
      schema_version: 2,
      signals_thin: (($fps|length) == 0 and ($nodes|length) == 0),
      change_group_count: group_count,
      file_count: ($fps|length),
      symbol_count: ($nodes|length),
      add_symbol_count: $add_n,
      change_symbol_count: $change_n,
      distinct_parent_dirs: $dir_n,
      layer_summary: $layer_summary,
      labeled_files: ($labeled | .[0:40]),
      namespace_layers: ($ns_layers | .[0:40]),
      packages: (if ($pkg|length)>0 then ($pkg[0].packages // []) else [] end),
      import_cross_layer: (pkg_cross | .[0:40]),
      nested_type_cross_layer: $nested_cross,
      cross_layer_edges: [],
      dead_nested_candidates: $dead_nested_candidates,
      dead_nested_symbols: $dead_nested,
      over_abstraction_hints: [],
      sprawl: {
        many_dirs: ($dir_n >= 5),
        add_heavy: ($add_n >= 5 and $add_n > $change_n),
        multi_layer: (([$layer_summary|to_entries[]|select(.key != "other")]|length) >= 3),
        dead_nested_count: ($dead_nested|length),
        dead_nested_candidate_count: ($dead_nested_candidates|length),
        nested_type_cross_layer_count: ($nested_cross|length)
      },
      confidence_caps: {
        path_heuristic: (if ($fps|length) > 0 then "medium" else "low" end),
        package_import: (if (pkg_files|length) > 0 or ($ns_layers|length) > 0 then "medium" else "low" end),
        stubs_cap_unknown: (stubs_total >= 20),
        stubs: stubs_total
      },
      imports_present: false,
      evidence_refs: (
        [
          (if group_count > 0 or (($cg[0]|keys|length) > 0 and $cg[0] != {}) then "03-change-groups.json" else empty end),
          (if ($fps|length) > 0 then "04-changed-files.json" else empty end),
          (if ($nodes|length) > 0 then "05-changed-symbols.json" else empty end),
          "impact/*/edges-in.json",
          (if (pkg_files|length) > 0 then "package/import extract (diffs + repo files)" else empty end)
        ]
      ),
      notes: []
    }
  ' >"$TMPD/base.json"

CROSS='[]'
HINTS='[]'
EDGE_FILES=()
if [[ -d "$DIR/impact" ]]; then
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    EDGE_FILES+=("$f")
    if [[ ${#EDGE_FILES[@]} -ge 40 ]]; then
      break
    fi
  done < <(find "$DIR/impact" -name 'edges-in.json' 2>/dev/null | sort)
fi

for ef in "${EDGE_FILES[@]+"${EDGE_FILES[@]}"}"; do
  [[ -f "$ef" ]] || continue
  rel="${ef#"$DIR"/}"
  CHUNK="$(jq -c --arg rel "$rel" '
    def layer($p):
      ($p // "" | ascii_downcase | gsub("\\.";"/") ) as $s
      | if ($s | test("(^|/)(controller|controllers|handler|handlers|api|apis|iface|interfaces|endpoint|endpoints|gateway|gateways|rpc|grpc|http|rest)(/|$)"))
        then "入口"
        elif ($s | test("(^|/)(service|services|application|app|apps|biz|business|usecase|usecases|manager|managers)(/|$)"))
        then "应用"
        elif ($s | test("(^|/)(domain|domains|model|models|entity|entities|core|aggregate|aggregates)(/|$)"))
        then "领域"
        elif ($s | test("(^|/)(dao|daos|mapper|mappers|repository|repositories|repo|repos|storage|persist|infrastructure|infra|dal)(/|$)"))
        then "存储"
        else "other"
        end;
    def edge_list:
      (.edges // .result.edges // .result.items // .items // []) as $e
      | if ($e|type) == "array" then $e else [] end;
    def caller_path($e):
      ($e.from_path // $e.source_path // $e.from.file // $e.from.path // $e.source.file
        // $e.from_file // $e.file // empty)
      | if type == "object" then (.path // .file // .name // empty) else . end;
    def caller_name($e):
      ($e.from_name // $e.source_name // $e.from.name // $e.source.name // $e.from_id // empty)
      | if type == "object" then (.name // .id // empty) else . end;
    def target_path($e):
      ($e.to_path // $e.target_path // $e.to.file // $e.to.path // $e.target.file
        // $e.to_file // empty)
      | if type == "object" then (.path // .file // empty) else . end;
    (edge_list) as $edges
    | {
        edge_count: ($edges|length),
        cross_layer: [
          $edges[]
          | caller_path(.) as $cp
          | target_path(.) as $tp
          | select($cp != null and ($cp|tostring|length) > 0)
          | select($tp != null and ($tp|tostring|length) > 0)
          | (layer($cp|tostring)) as $fl
          | (layer($tp|tostring)) as $tl
          | select($fl != $tl and $fl != "other" and $tl != "other")
          | {
              from_path: ($cp|tostring),
              from_layer: $fl,
              to_path: ($tp|tostring),
              to_layer: $tl,
              caller: (caller_name(.)|tostring),
              artifact: $rel,
              source: "edges_in"
            }
        ],
        artifact: $rel
      }
  ' "$ef" 2>/dev/null || echo '{"edge_count":0,"cross_layer":[],"artifact":""}')"

  EDGE_COUNT="$(echo "$CHUNK" | jq -r '.edge_count // 0')"
  if [[ "${EDGE_COUNT:-0}" == "0" ]]; then
    HINTS="$(jq -c --arg a "$rel" \
      '. + [{kind:"empty_edges_in", artifact:$a, note:"no direct callers in edges-in — check over-abstraction if change_status=add"}]' \
      <<<"$HINTS")"
  fi

  CROSS="$(jq -c --argjson chunk "$CHUNK" '. + ($chunk.cross_layer // [])' <<<"$CROSS")"
done

CROSS="$(echo "$CROSS" | jq -c '.[0:30]')"
HINTS="$(echo "$HINTS" | jq -c '.[0:20]')"

# Confirm dead_nested only via empty edges-in (never from_count==0 alone)
EMPTY_IDS='[]'
for ef in "${EDGE_FILES[@]+"${EDGE_FILES[@]}"}"; do
  [[ -f "$ef" ]] || continue
  cnt="$(jq '((.edges // .result.edges // .result.items // .items // []) | length)' "$ef" 2>/dev/null || echo 1)"
  if [[ "${cnt:-1}" == "0" ]]; then
    # impact/<safe>_?/edges-in.json → match nodes by sanitized id
    safe="$(basename "$(dirname "$ef")")"
    EMPTY_IDS="$(jq --arg s "$safe" '. + [$s]' <<<"$EMPTY_IDS")"
  fi
done

IMPORTS_PRESENT=false
if [[ "$MODE" == "full" && -f "$DIR/imports/index.json" ]]; then
  IMPORTS_PRESENT=true
fi

# Also treat on-disk import extracts as present
if [[ -d "$DIR/imports" ]] && find "$DIR/imports" -name '*-ondisk.json' 2>/dev/null | grep -q .; then
  IMPORTS_PRESENT=true
fi

jq -c \
  --argjson cross "$CROSS" \
  --argjson hints "$HINTS" \
  --argjson imports "$IMPORTS_PRESENT" \
  --argjson empty_ids "$EMPTY_IDS" \
  '
  .dead_nested_symbols = (
      [
        (.dead_nested_candidates // [])[]
        | . as $n
        | (($n.id // "") | gsub("[^A-Za-z0-9._-]"; "_")) as $safe
        | select(($empty_ids | index($safe)) != null)
        | $n + {fan_in_basis: "empty_edges_in", confirmed_unused: true}
      ] | .[0:25]
    )
  | .sprawl.dead_nested_count = (.dead_nested_symbols|length)
  | .cross_layer_edges = ($cross + (.import_cross_layer // []) + (.nested_type_cross_layer // []) | .[0:40])
  | .over_abstraction_hints = (
      .over_abstraction_hints + $hints
      + (
          if .sprawl.add_heavy then
            [{kind:"add_heavy", note:("add_symbol_count="+(.add_symbol_count|tostring)+" exceeds change; review premature abstraction")}]
          else [] end
        )
      + (
          if .sprawl.multi_layer and .sprawl.many_dirs then
            [{kind:"wide_sprawl", note:"change spans many dirs and multiple layers — confirm belonging"}]
          else [] end
        )
      + (
          if (.sprawl.dead_nested_count // 0) > 0 then
            [{kind:"dead_nested", note:("dead_nested_symbols="+(.sprawl.dead_nested_count|tostring)+" confirmed empty edges-in only (from_count is NOT fan-in)"), count:(.sprawl.dead_nested_count)}]
          else [] end
        )
      + (
          if ((.dead_nested_candidates // [])|length) > 0 and (.sprawl.dead_nested_count // 0) == 0 then
            [{kind:"dead_nested_unconfirmed", note:("nested/type candidates="+((.dead_nested_candidates|length)|tostring)+" without empty edges-in confirmation — do NOT mark YAGNI from from_count alone"), count:(.dead_nested_candidates|length)}]
          else [] end
        )
      + (
          if (.sprawl.nested_type_cross_layer_count // 0) > 0 then
            [{kind:"nested_type_cross_layer", note:("same-file nested type/method name layers="+(.sprawl.nested_type_cross_layer_count|tostring)+" — path/package alone may hide cross-layer"), count:(.sprawl.nested_type_cross_layer_count)}]
          else [] end
        )
      + (
          if ((.import_cross_layer // [])|length) > 0 then
            [{kind:"import_cross_layer", note:("package/import cross-layer deps="+((.import_cross_layer|length)|tostring)), count:(.import_cross_layer|length)}]
          else [] end
        )
    )
  | .imports_present = $imports
  | .evidence_refs = (
      .evidence_refs
      + (if $imports then ["imports/","imports/index.json"] else [] end)
      | unique
    )
  | if (.signals_thin == true) then
      .notes = ((.notes // []) + ["thin signals — Design fit may be None with residual note"])
    else . end
  ' "$TMPD/base.json" >"$OUT"

echo "Design-fit signals written: $OUT"
