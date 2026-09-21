#!/usr/bin/env bash
# codexqa-code-reviewer: Render REVIEW-REPORT.html from review-conclusion.json.
# Compatible with bash 3.2+ (macOS). Requires jq.
set -euo pipefail

DIR=""
INPUT=""
OUT=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: render-review-html.sh --dir <EVIDENCE_DIR> [--input FILE] [--out FILE]

Reads structured JSON (default: <dir>/review-conclusion.json) and writes a
self-contained HTML conclusion report (default: <dir>/REVIEW-REPORT.html).

After graph-backed review the agent MUST:
  1. Write <dir>/review-conclusion.json (see templates/review-conclusion.json)
  2. Run this script
  3. Point the user at REVIEW-REPORT.html

HTML omits dimension blocks whose verdict is ok/none (issues-only surface).
Risk-tier meta section still renders when present.

Options:
  --dir DIR      Evidence pack directory (required)
  --input FILE   Conclusion JSON (default: DIR/review-conclusion.json)
  --out FILE     Output HTML (default: DIR/REVIEW-REPORT.html)
  -h, --help     Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:-}"; shift 2 ;;
    --input) INPUT="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "error: --dir must be an existing evidence pack directory" >&2
  usage
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required to render HTML report" >&2
  exit 1
fi

INPUT="${INPUT:-$DIR/review-conclusion.json}"
OUT="${OUT:-$DIR/REVIEW-REPORT.html}"

if [[ ! -f "$INPUT" ]]; then
  echo "error: missing conclusion JSON: $INPUT" >&2
  echo "Fill templates/review-conclusion.json → $DIR/review-conclusion.json first." >&2
  exit 1
fi

# Fail fast with a clear message on invalid / non-object JSON (do not dump jq stack).
if ! jq -e 'type == "object"' "$INPUT" >/dev/null 2>&1; then
  echo "error: invalid or non-object conclusion JSON: $INPUT" >&2
  echo "Expected a JSON object matching templates/review-conclusion.json." >&2
  exit 1
fi

# Optional pack sidecars: ignore corrupt files rather than aborting render.
safe_slurp_or_empty() {
  local f="$1"
  if [[ -f "$f" ]] && jq -e 'type == "object" or type == "array"' "$f" >/dev/null 2>&1; then
    printf '%s' "$f"
  else
    printf ''
  fi
}

MERGED="$(mktemp)"
FRAG="$(mktemp)"
trap 'rm -f "$MERGED" "$FRAG"' EXIT

# Merge optional manifest / language-profile defaults (compat if absent).
MANIFEST_ARGS=()
LP_ARGS=()
MANIFEST_FILE="$(safe_slurp_or_empty "$DIR/manifest.json")"
LP_FILE="$(safe_slurp_or_empty "$DIR/09-language-profile.json")"
if [[ -n "$MANIFEST_FILE" ]]; then
  MANIFEST_ARGS=(--slurpfile m "$MANIFEST_FILE")
else
  MANIFEST_ARGS=(--argjson m '[{}]')
fi
if [[ -n "$LP_FILE" ]]; then
  LP_ARGS=(--slurpfile lp "$LP_FILE")
else
  LP_ARGS=(--argjson lp '[{}]')
fi

# Coerce missing / wrong-typed list fields so partial conclusions still render.
jq \
  --arg DIR "$DIR" \
  "${MANIFEST_ARGS[@]}" \
  "${LP_ARGS[@]}" \
  '
  def nonempty($x): ($x != null and ($x | tostring) != "");
  def pick($a; $b): if nonempty($a) then $a else $b end;
  def as_array($x):
    if $x == null then []
    elif ($x | type) == "array" then $x
    else [] end;
  def as_finding_list($x):
    if ($x | type) == "array" then
      [$x[] | if type == "object" then . else {title: (.|tostring), risk: "coerced non-object finding"} end]
    else [] end;
  def as_string_list($x):
    if ($x | type) == "array" then [$x[] | tostring]
    elif $x == null then []
    else [($x | tostring)] end;
  . as $c0
  | (($m[0] // {}) | if type == "object" then . else {} end) as $m0
  | (($lp[0] // {}) | if type == "object" then . else {} end) as $lp0
  | (as_finding_list($c0.p0)) as $p0
  | (as_finding_list($c0.p1)) as $p1
  | (as_finding_list($c0.p2)) as $p2
  | $c0 + {
      evidence_dir: pick($c0.evidence_dir; $DIR),
      repo: pick($c0.repo; $m0.repo // ""),
      diff_base: pick($c0.diff_base; $m0.diff_base // ""),
      mode: pick($c0.mode; $m0.mode // "pr"),
      skill: pick($c0.skill; $m0.skill // "codexqa-code-reviewer"),
      analysis_backend: pick($c0.analysis_backend; $m0.analysis_backend // "codexqa-cli"),
      codexqa_version: pick($c0.codexqa_version; $m0.codexqa_version // ""),
      primary_language: pick($c0.primary_language; $m0.primary_language // $lp0.primary_language // ""),
      review_language_focus: pick($c0.review_language_focus; $m0.review_language_focus // $lp0.review_language_focus // ""),
      language_confidence: pick($c0.language_confidence; $lp0.confidence // ""),
      is_polyglot: (if $c0.is_polyglot != null then $c0.is_polyglot else ($m0.is_polyglot // $lp0.is_polyglot // false) end),
      p0: $p0,
      p1: $p1,
      p2: $p2,
      p0_count: ($c0.p0_count // ($p0 | length)),
      p1_count: ($c0.p1_count // ($p1 | length)),
      p2_count: ($c0.p2_count // ($p2 | length)),
      regression_tests: as_array($c0.regression_tests),
      test_gaps: as_array($c0.test_gaps),
      fix_order: as_string_list($c0.fix_order),
      residual_risks: as_string_list($c0.residual_risks),
      diagrams: as_array($c0.diagrams)
    }
  ' "$INPUT" >"$MERGED"

# Build escaped HTML fragments object.
jq -c '
  def esc:
    tostring
    | gsub("&"; "&amp;")
    | gsub("<"; "&lt;")
    | gsub(">"; "&gt;")
    | gsub("\""; "&quot;");
  def nonempty($x): ($x != null and ($x | tostring) != "");
  def pick($a; $b): if nonempty($a) then $a else $b end;
  # Report only dimensions with issues. ok/none (and empty) stay out of HTML.
  def dim_issue($v):
    (($v // "") | tostring | ascii_downcase | gsub("^\\s+|\\s+$"; "")) as $s
    | ($s != "" and $s != "ok" and $s != "none" and $s != "n/a" and $s != "na");
  def risk_class:
    ascii_downcase
    | if . == "high" then "risk-high"
      elif . == "low" then "risk-low"
      else "risk-med" end;
  def label_en($zh):
    ({
      "位置":"Location","变更":"Change","分类":"Category","风险":"Risk","依据":"Evidence",
      "入口":"Entry","修复建议":"Fix","调用链路":"Call chain","结论":"Verdict",
      "风险说明":"Risk","总评":"Overall","依据汇总":"Evidence summary","信号文件":"Signals file",
      "过度设计":"Over-engineering","必要性":"Necessity","可复现性":"Reproducibility",
      "许可证线索":"License clues","漏洞态势":"Vuln posture","最小化":"Minimization",
      "日志脱敏":"Log redaction","留存/删除/导出":"Retention / erase / export",
      "同意/跨境":"Consent / transfer","静默吞异常":"Silent swallow","超时":"Timeouts",
      "重试":"Retries","降级/熔断":"Degradation / breaker","部分失败":"Partial failure",
      "幂等与补偿":"Idempotency","迁移":"Migrations","双写/扩缩":"Dual-write",
      "配置开关":"Feature flags","兼容窗口":"Compat window","破坏性公告":"Breaking announce",
      "回滚路径":"Rollback","档位":"Tier","行业别名":"Industry tier","审查深度":"Evidence floor",
      "热点路径":"Hot path","无界分配":"Unbounded allocation","N+1":"N+1"
    }[$zh] // $zh);
  def field_k($zh):
    "<span class=\"field-k\" data-zh=\"" + ($zh|esc) + "\" data-en=\"" + (label_en($zh)|esc) + "\">" + ($zh|esc) + "</span>";
  def bi_val($zh; $en):
    (if nonempty($zh) then $zh elif nonempty($en) then $en else "" end) as $z
    | (if nonempty($en) then $en else $z end) as $e
    | {zh:$z, en:$e};
  def field_bi($k; $cls; $zh; $en):
    bi_val($zh; $en) as $b
    | if ($b.zh == "" and $b.en == "") then ""
      else
        "<div class=\"field\">" + field_k($k)
        + "<div class=\"field-v " + $cls + "\" data-zh=\"" + ($b.zh|esc) + "\" data-en=\"" + ($b.en|esc) + "\">"
        + ($b.zh|esc)
        + "</div></div>"
      end;
  def field($k; $cls; $v):
    field_bi($k; $cls; $v; null);
  def field_html($k; $inner):
    if nonempty($inner) then
      "<div class=\"field\">" + field_k($k) + "<div class=\"field-v is-chain\">" + $inner + "</div></div>"
    else "" end;
  def h2bi($zh; $en):
    "<h2 data-zh=\"" + ($zh|esc) + "\" data-en=\"" + ($en|esc) + "\">" + ($zh|esc) + "</h2>\n";
  def pbi($cls; $zh; $en):
    "<p class=\"" + $cls + "\" data-zh=\"" + ($zh|esc) + "\" data-en=\"" + ($en|esc) + "\">" + ($zh|esc) + "</p>\n";
  def bi_text($zh; $en):
    "<span data-zh=\"" + ($zh|esc) + "\" data-en=\"" + ($en|esc) + "\">" + ($zh|esc) + "</span>";
  def verdict_bi($v):
    (($v // "") | tostring | ascii_downcase) as $x
    | if $x == "concern" then bi_text("需关注"; "concern")
      elif $x == "ok" then bi_text("通过"; "ok")
      elif $x == "none" then bi_text("无问题"; "none")
      elif $x == "" then ""
      else ($v | tostring | esc)
      end;
  def risk_level_bi($v):
    (($v // "") | tostring) as $raw
    | (($raw | ascii_downcase)) as $x
    | if $x == "critical" then bi_text("严重"; "Critical")
      elif $x == "high" then bi_text("高"; "High")
      elif $x == "medium" then bi_text("中等"; "Medium")
      elif $x == "low" then bi_text("低"; "Low")
      elif $raw == "" then ""
      else ($raw | esc)
      end;
  def category_bi($v):
    (($v // "") | tostring) as $raw
    | (($raw | ascii_downcase)) as $x
    | ({
        "complexity":"复杂度","correctness":"正确性","test_gaps":"测试缺口","concurrency":"并发",
        "security":"安全","privacy":"隐私","resilience":"韧性","design":"设计契合",
        "dependencies":"依赖","rollout":"发布变更","observability":"可观测性",
        "maintainability":"可维护性","contract":"契约","regression":"回归","performance":"性能",
        "llm_judgment":"模型语义评审","risk_tier":"风险分档"
      }[$x] // null) as $zh
    | if $zh == null then ($raw | esc)
      else bi_text($zh; $raw)
      end;
  # Pure-HTML call-chain graph (no Mermaid / external JS).
  # Accepts:
  #   ["A","B","C"]
  #   { "paths": [["A","B"],["C","D"]], "focus": ["B"], "title": "..." }
  #   { "edges": [["A","B"],["B","C"]], "focus": ["C"], "title": "..." }
  def node_html($name; $focus):
    (($name // "") | tostring) as $n
    | (if ($focus | index($n)) then " is-risk" else "" end) as $cls
    | "<span class=\"chain-node" + $cls + "\">" + ($n | esc) + "</span>";
  def path_html($path; $focus):
    ($path // []) as $p
    | if ($p | length) == 0 then ""
      else
        "<div class=\"call-chain-path\">"
        + ([range(0; $p|length) | . as $i
            | node_html($p[$i]; $focus)
              + (if $i < (($p|length)-1) then "<span class=\"chain-arrow\" aria-hidden=\"true\">→</span>" else "" end)
           ] | join(""))
        + "</div>"
      end;
  def edges_to_paths($edges):
    # Best-effort: emit each edge as a 2-node path (readable without layout engine).
    ($edges // [])
    | map(
        if type == "array" and length >= 2 then [.[0], .[1]]
        elif type == "object" then [(.from // .src // .a), (.to // .dst // .b)]
        else empty end
      )
    | map(select(.[0] != null and .[1] != null));
  def call_chain_html($cc):
    if $cc == null then ""
    elif ($cc | type) == "array" then
      if ($cc | length) == 0 then ""
      elif (($cc[0] | type) == "array") then
        "<div class=\"call-chain\">"
        + ($cc | map(path_html(.; [])) | join(""))
        + "</div>"
      else
        "<div class=\"call-chain\">" + path_html($cc; []) + "</div>"
      end
    elif ($cc | type) == "object" then
      ($cc.focus // []) as $focus
      | ($cc.title // "") as $title
      | (if (($cc.paths // null) != null) then ($cc.paths // [])
         elif (($cc.edges // null) != null) then edges_to_paths($cc.edges)
         elif (($cc.nodes // null) != null) and (($cc.nodes|type)=="array") then [($cc.nodes)]
         else [] end) as $paths
      | if ($paths | length) == 0 then ""
        else
          "<div class=\"call-chain\">"
          + (if nonempty($title) then
                "<div class=\"chain-title\" data-zh=\"" + ($title|esc) + "\" data-en=\"" + (($cc.title_en // $title)|esc) + "\">" + ($title|esc) + "</div>"
              else "" end)
          + ($paths | map(path_html(.; $focus)) | join(""))
          + "</div>"
        end
    else ""
    end;
  # Fallback: callers fan-in → focus label from location / first caller target.
  def chain_from_callers($callers; $focus_label):
    if ($callers | type) != "array" or ($callers | length) == 0 then ""
    else
      ($focus_label // "缺陷点") as $f
      | "<div class=\"call-chain\">"
        + "<div class=\"chain-title\" data-zh=\"调用方 → 缺陷点\" data-en=\"Callers → defect\">调用方 → 缺陷点</div>"
        + ($callers | map(
            . as $c
            | if (($c | tostring) | test("→|->")) then
                # already a mini-path string like "a→b"
                "<div class=\"call-chain-path\"><span class=\"chain-node\">" + ($c | tostring | esc) + "</span></div>"
              else
                path_html([$c, $f]; [$f])
              end
          ) | join(""))
        + "</div>"
    end;
  def finding_chain($item):
    if ($item.call_chain != null) then call_chain_html($item.call_chain)
    else
      chain_from_callers(
        $item.callers // [];
        (if nonempty($item.location) then ($item.location | tostring | split("（")[0] | split(",")[0] | gsub("^\\s+|\\s+$"; "")) else "缺陷点" end)
      )
    end;
  # Machine change_status → bilingual human label (keep raw values in JSON).
  def change_label($s; $mode):
    (($s // "") | tostring | ascii_downcase) as $c
    | if $c == "add" then bi_text("本次新增"; "Added in this change")
      elif $c == "change" then bi_text("本次修改"; "Modified in this change")
      elif $c == "default" or $c == "" then
        (if (($mode // "") | tostring | test("full"; "i"))
         then bi_text("既有代码（全仓评审，非本次 diff）"; "Existing code (full-repo review, not this diff)")
         else bi_text("未纳入本次 diff（既有代码）"; "Not in this diff (existing code)")
         end)
      else ($s | tostring | esc)
      end;
  def finding_cards($sev; $items; $mode):
    if ($items | length) == 0 then
      "<article class=\"finding empty\"><div class=\"finding-head\"><span class=\"sev \($sev)\">\($sev | ascii_upcase)</span><h3 data-zh=\"无\" data-en=\"None\">无</h3></div><p class=\"muted pad\" data-zh=\"无此项。\" data-en=\"None.\">无此项。</p></article>"
    else
      ($items | map(
        ((.title // "Finding") | tostring) as $tz
        | ((.title_en // .title // "Finding") | tostring) as $te
        | "<article class=\"finding \($sev)\">" +
        "<div class=\"finding-head\"><span class=\"sev \($sev)\">\($sev | ascii_upcase)</span>"
        + "<h3 data-zh=\"" + ($tz|esc) + "\" data-en=\"" + ($te|esc) + "\">" + ($tz|esc) + "</h3></div>" +
        "<div class=\"finding-body\">" +
        field_bi("位置"; "is-path"; .location; .location_en) +
        ("<div class=\"field\">" + field_k("变更") + "<div class=\"field-v is-cat\">" + change_label(.change_status; $mode) + "</div></div>") +
        ("<div class=\"field\">" + field_k("分类") + "<div class=\"field-v is-cat\">" + category_bi(.category) + "</div></div>") +
        field_bi("风险"; ""; .risk; .risk_en) +
        field_html("调用链路"; finding_chain(.)) +
        field_bi("依据"; ""; .evidence; .evidence_en) +
        field_bi("入口"; ""; .entry; .entry_en) +
        field_bi("修复建议"; ""; .fix; .fix_en) +
        "</div></article>"
      ) | join(""))
    end;
  . as $r
  | {
      title: (("Code Review 结论 · " + (pick($r.repo_label; $r.repo // "repo") | tostring)) | esc),
      title_zh: (("Code Review 结论 · " + (pick($r.repo_label; $r.repo // "repo") | tostring))),
      title_en: (("Code Review Report · " + (pick($r.repo_label; $r.repo // "repo") | tostring))),
      overall_risk_raw: (($r.overall_risk // "Medium") | tostring),
      repo: (($r.repo // "") | esc),
      repo_label: ((pick($r.repo_label; $r.repo // "") | tostring) | esc),
      diff_base: (($r.diff_base // "") | esc),
      branch: (($r.branch // "") | esc),
      mode: (($r.mode // "pr") | esc),
      mode_html: (
        (($r.mode // "pr") | tostring) as $m
        | if ($m | test("full"; "i")) then bi_text("全仓评审"; "full-repo")
          elif ($m | test("pr"; "i")) then bi_text("PR 评审"; "pr")
          else ($m | esc) end
      ),
      evidence_dir: (($r.evidence_dir // "") | esc),
      codexqa_version: (($r.codexqa_version // "") | esc),
      primary_language: (($r.primary_language // "") | esc),
      review_language_focus: (($r.review_language_focus // "") | esc),
      language_confidence: (($r.language_confidence // "") | esc),
      overall_risk: (($r.overall_risk // "Medium") | esc),
      overall_risk_html: risk_level_bi($r.overall_risk // "Medium"),
      risk_class: (($r.overall_risk // "Medium") | risk_class),
      intent: (($r.intent // "") | esc),
      scope: (($r.scope // "") | esc),
      summary: (($r.summary // "") | esc),
      summary_zh: (($r.summary // "") | tostring),
      summary_en: (($r.summary_en // $r.summary // "") | tostring),
      intent_zh: (($r.intent // "") | tostring),
      intent_en: (($r.intent_en // $r.intent // "") | tostring),
      scope_zh: (($r.scope // "") | tostring),
      scope_en: (($r.scope_en // $r.scope // "") | tostring),
      sensitive_zh: (($r.sensitive // "None") | tostring),
      sensitive_en: (($r.sensitive_en // $r.sensitive // "None") | tostring),
      generated_at: (($r.generated_at // "") | esc),
      p0_count: ($r.p0_count // 0),
      p1_count: ($r.p1_count // 0),
      p2_count: ($r.p2_count // 0),
      p0_html: finding_cards("p0"; $r.p0 // []; $r.mode),
      p1_html: finding_cards("p1"; $r.p1 // []; $r.mode),
      p2_html: finding_cards("p2"; $r.p2 // []; $r.mode),
      regression_rows: (
        ($r.regression_tests // [])
        | if length == 0 then "<tr><td colspan=\"3\" class=\"muted\" data-zh=\"无\" data-en=\"None\">无</td></tr>"
          else map(
            "<tr>"
            + "<td data-zh=\"" + ((.target // "")|esc) + "\" data-en=\"" + ((.target_en // .target // "")|esc) + "\">" + ((.target // "")|esc) + "</td>"
            + "<td data-zh=\"" + ((.why // "")|esc) + "\" data-en=\"" + ((.why_en // .why // "")|esc) + "\">" + ((.why // "")|esc) + "</td>"
            + "<td data-zh=\"" + ((.evidence // "")|esc) + "\" data-en=\"" + ((.evidence_en // .evidence // "")|esc) + "\">" + ((.evidence // "")|esc) + "</td>"
            + "</tr>"
          ) | join("")
          end
      ),
      gap_rows: (
        ($r.test_gaps // [])
        | if length == 0 then "<tr><td colspan=\"4\" class=\"muted\" data-zh=\"无\" data-en=\"None\">无</td></tr>"
          else map(
            "<tr>"
            + "<td data-zh=\"" + ((.symbol // "")|esc) + "\" data-en=\"" + ((.symbol_en // .symbol // "")|esc) + "\">" + ((.symbol // "")|esc) + "</td>"
            + "<td>" + ((.tested_count // "") | tostring | esc) + "</td>"
            + "<td data-zh=\"" + ((.tests_reach // "")|esc) + "\" data-en=\"" + ((.tests_reach_en // .tests_reach // "")|esc) + "\">" + ((.tests_reach // "")|esc) + "</td>"
            + "<td data-zh=\"" + ((.note // "")|esc) + "\" data-en=\"" + ((.note_en // .note // "")|esc) + "\">" + ((.note // "")|esc) + "</td>"
            + "</tr>"
          ) | join("")
          end
      ),
      sensitive: (($r.sensitive // "None") | esc),
      sensitive_zh: (($r.sensitive // "None") | tostring),
      sensitive_en: (($r.sensitive_en // $r.sensitive // "None") | tostring),
      fix_order_html: (
        ($r.fix_order // [])
        | if length == 0 then "<li class=\"muted\">None</li>"
          else map("<li>" + (. | esc) + "</li>") | join("")
          end
      ),
      residual_html: (
        ($r.residual_risks // [])
        | if length == 0 then "<li class=\"muted\">None</li>"
          else map("<li>" + (. | esc) + "</li>") | join("")
          end
      ),
      diagrams_html: "",
      design_fit_html: (
        if ($r.design_fit == null) then ""
        else
          ($r.design_fit) as $d
          | def sec_issue($obj):
              ($obj != null and dim_issue($obj.verdict));
          def any_sec_issue:
              if ($d.sections == null) then false
              else
                sec_issue($d.sections.belong)
                or sec_issue($d.sections.layer)
                or sec_issue($d.sections.over_engineering)
                or sec_issue($d.sections.timing)
              end;
          def sec($title; $obj):
              if sec_issue($obj) then
                "<h3>" + $title + "</h3>"
                + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($obj.verdict) + "</div></div>")
                + field_bi("风险说明"; ""; ($obj.risk // $obj.notes); ($obj.risk_en // $obj.notes_en))
                + field_html("调用链路"; call_chain_html($obj.call_chain))
                + field_bi("依据"; ""; $obj.evidence; $obj.evidence_en)
              else ""
              end;
          if (dim_issue($d.verdict) or any_sec_issue) then
            "<section>" + h2bi("架构契合"; "Design fit")
              + (if dim_issue($d.verdict) then ("<div class=\"field\">" + field_k("总评") + "<div class=\"field-v is-cat\">" + verdict_bi($d.verdict) + "</div></div>") else "" end)
              + field_bi("风险说明"; ""; $d.risk; $d.risk_en)
              + field_html("调用链路"; call_chain_html($d.call_chain))
              + (if ($d.sections != null) then
                  sec("Belong"; $d.sections.belong)
                  + sec("Layer"; $d.sections.layer)
                  + sec("Over-engineering"; $d.sections.over_engineering)
                  + sec("Timing"; $d.sections.timing)
                elif dim_issue($d.verdict) then
                  (if nonempty($d.belong_in_repo) then "<h3>Belong</h3>" + field_bi("风险说明"; ""; $d.belong_in_repo; $d.belong_in_repo_en) else "" end)
                  + (if nonempty($d.layer_fit) then "<h3>Layer</h3>" + field_bi("风险说明"; ""; $d.layer_fit; $d.layer_fit_en) else "" end)
                  + (if nonempty($d.over_engineering) then "<h3>Over-engineering</h3>" + field_bi("风险说明"; ""; $d.over_engineering; $d.over_engineering_en) else "" end)
                  + (if nonempty($d.timing_note) then "<h3>Timing</h3>" + field_bi("风险说明"; ""; $d.timing_note; $d.timing_note_en) else "" end)
                else ""
                end)
              + field_bi("依据汇总"; ""; $d.evidence; $d.evidence_en)
              + field("信号文件"; "is-path"; $d.signals_file)
              + "</section>\n"
          else ""
          end
        end
      ),
      complexity_html: (
        if ($r.complexity == null or (dim_issue($r.complexity.verdict) | not)) then ""
        else
          ($r.complexity) as $c
          | "<section>" + h2bi("复杂度 / 认知负担"; "Complexity")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($c.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; ($c.risk // $c.hotspots); ($c.risk_en // $c.hotspots_en))
            + field_html("调用链路"; call_chain_html($c.call_chain))
            + field_bi("过度设计"; ""; $c.yagni; $c.yagni_en)
            + field_bi("依据"; ""; $c.evidence; $c.evidence_en)
            + field("信号文件"; "is-path"; $c.signals_file)
            + "</section>\n"
        end
      ),
      dependencies_html: (
        if ($r.dependencies == null or (dim_issue($r.dependencies.verdict) | not)) then ""
        else
          ($r.dependencies) as $d
          | "<section>" + h2bi("依赖 / 供应链"; "Dependencies")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($d.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; $d.risk; $d.risk_en)
            + field_html("调用链路"; call_chain_html($d.call_chain))
            + field_bi("必要性"; ""; $d.necessity; $d.necessity_en)
            + field_bi("可复现性"; ""; $d.reproducibility; $d.reproducibility_en)
            + field_bi("许可证线索"; ""; $d.license; $d.license_en)
            + field_bi("漏洞态势"; ""; $d.vuln_posture; $d.vuln_posture_en)
            + field_bi("依据"; ""; $d.evidence; $d.evidence_en)
            + field("信号文件"; "is-path"; $d.signals_file)
            + "</section>\n"
        end
      ),
      privacy_html: (
        if ($r.privacy == null or (dim_issue($r.privacy.verdict) | not)) then ""
        else
          ($r.privacy) as $p
          | "<section>" + h2bi("隐私 / 合规"; "Privacy")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($p.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; $p.risk; $p.risk_en)
            + field_html("调用链路"; call_chain_html($p.call_chain))
            + field_bi("最小化"; ""; $p.minimization; $p.minimization_en)
            + field_bi("日志脱敏"; ""; $p.logging; $p.logging_en)
            + field_bi("留存/删除/导出"; ""; $p.retention; $p.retention_en)
            + field_bi("同意/跨境"; ""; $p.consent_transfer; $p.consent_transfer_en)
            + field_bi("依据"; ""; $p.evidence; $p.evidence_en)
            + field("信号文件"; "is-path"; $p.signals_file)
            + "</section>\n"
        end
      ),
      resilience_html: (
        if ($r.resilience == null or (dim_issue($r.resilience.verdict) | not)) then ""
        else
          ($r.resilience) as $e
          | "<section>" + h2bi("韧性 / 错误处理"; "Resilience")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($e.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; $e.risk; $e.risk_en)
            + field_html("调用链路"; call_chain_html($e.call_chain))
            + field_bi("静默吞异常"; ""; $e.silent_swallow; $e.silent_swallow_en)
            + field_bi("超时"; ""; $e.timeouts; $e.timeouts_en)
            + field_bi("重试"; ""; $e.retries; $e.retries_en)
            + field_bi("降级/熔断"; ""; $e.degradation; $e.degradation_en)
            + field_bi("部分失败"; ""; $e.partial_failure; $e.partial_failure_en)
            + field_bi("幂等与补偿"; ""; $e.idempotency; $e.idempotency_en)
            + field_bi("依据"; ""; $e.evidence; $e.evidence_en)
            + field("信号文件"; "is-path"; $e.signals_file)
            + "</section>\n"
        end
      ),
      rollout_html: (
        if ($r.rollout == null or (dim_issue($r.rollout.verdict) | not)) then ""
        else
          ($r.rollout) as $o
          | "<section>" + h2bi("变更与发布风险"; "Change / rollout")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($o.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; $o.risk; $o.risk_en)
            + field_html("调用链路"; call_chain_html($o.call_chain))
            + field_bi("迁移"; ""; $o.migrations; $o.migrations_en)
            + field_bi("双写/扩缩"; ""; $o.dual_write; $o.dual_write_en)
            + field_bi("配置开关"; ""; $o.feature_flags; $o.feature_flags_en)
            + field_bi("兼容窗口"; ""; $o.compat_window; $o.compat_window_en)
            + field_bi("破坏性公告"; ""; $o.breaking_announce; $o.breaking_announce_en)
            + field_bi("回滚路径"; ""; $o.rollback; $o.rollback_en)
            + field_bi("依据"; ""; $o.evidence; $o.evidence_en)
            + field("信号文件"; "is-path"; $o.signals_file)
            + "</section>\n"
        end
      ),
      risk_tier_html: (
        if ($r.risk_tier == null) then ""
        else
          ($r.risk_tier) as $t
          | "<section>" + h2bi("风险分档"; "Risk tier")
            + field("档位"; "is-cat"; $t.tier)
            + field("行业别名"; ""; $t.industry_tier)
            + field("审查深度"; ""; $t.evidence_floor)
            + field_bi("风险说明"; ""; ($t.risk // $t.drivers); ($t.risk_en // $t.drivers_en))
            + field_html("调用链路"; call_chain_html($t.call_chain))
            + field_bi("依据"; ""; $t.evidence; $t.evidence_en)
            + field("信号文件"; "is-path"; $t.signals_file)
            + "</section>\n"
        end
      ),
      performance_html: (
        if ($r.performance == null or (dim_issue($r.performance.verdict) | not)) then ""
        else
          ($r.performance) as $p
          | "<section>" + h2bi("性能专项"; "Performance")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($p.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; $p.risk; $p.risk_en)
            + field_html("调用链路"; call_chain_html($p.call_chain))
            + field_bi("N+1"; ""; $p.n_plus_one; $p.n_plus_one_en)
            + field_bi("热点路径"; ""; $p.hot_path; $p.hot_path_en)
            + field_bi("无界分配"; ""; $p.unbounded_allocation; $p.unbounded_allocation_en)
            + field_bi("依据"; ""; $p.evidence; $p.evidence_en)
            + field("信号文件"; "is-path"; $p.signals_file)
            + "</section>\n"
        end
      ),
      llm_judgment_html: (
        if ($r.llm_judgment == null or (dim_issue($r.llm_judgment.verdict) | not)) then ""
        else
          ($r.llm_judgment) as $lj
          | "<section>" + h2bi("模型语义评审"; "Agent LLM judgment")
            + ("<div class=\"field\">" + field_k("结论") + "<div class=\"field-v is-cat\">" + verdict_bi($lj.verdict) + "</div></div>")
            + field_bi("风险说明"; ""; $lj.risk; $lj.risk_en)
            + field("新颖问题数"; ""; ($lj.novel_count // ""))
            + field("去重合并数"; ""; ($lj.deduped_count // ""))
            + field("enrich 数"; ""; ($lj.enriched_count // ""))
            + field_bi("审阅焦点"; ""; $lj.focus_files; $lj.focus_files_en)
            + field_bi("依据"; ""; $lj.evidence; $lj.evidence_en)
            + field("信号文件"; "is-path"; $lj.signals_file)
            + "</section>\n"
        end
      ),
      compare_link: (
        if nonempty($r.compare_url) then
          "<p><a href=\"" + ($r.compare_url | esc) + "\" target=\"_blank\" rel=\"noopener\" data-zh=\"打开对比 / PR\" data-en=\"Open Compare / PR\">打开对比 / PR</a></p>"
        else "" end
      )
    }
' "$MERGED" >"$FRAG"

CSS="$(cat <<'CSS'
@import url("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap");
:root{
  --paper:#efe6d4;
  --sheet:#f7f1e4;
  --ink:#1a1714;
  --muted:#6b645c;
  --line:#d7ccb8;
  --steel:#1c2228;
  --steel-2:#2a323a;
  --hazard:#e3b341;
  --eyebrow:#8a6914;
  --link:#8a5a12;
  --lang-bg:#e8edc8;
  --lang-fg:#3f4d1a;
  --diagram-ink:#334155;
  --inset-hi:rgba(255,255,255,.85);
  --p0:#b42318;
  --p0-bg:#fde8e4;
  --p1:#c2410c;
  --p1-bg:#ffedd5;
  --p2:#9a6700;
  --p2-bg:#fef3c7;
  --ok:#17663a;
  --ok-bg:#dcfce7;
  --med:#b45309;
  --med-bg:#ffedd5;
  --hero-0:#fbf8f1;
  --hero-1:#f3ebe0;
  --hero-2:#efe6d4;
  --hero-border:#cfc3ae;
  --card:#fffdf8;
  --chip:#f3ead6;
  --grid:rgba(28,34,40,.045);
  --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
  --sans:"IBM Plex Sans","PingFang SC","Noto Sans SC",sans-serif;
  --display:"Barlow Condensed","IBM Plex Sans Condensed","PingFang SC",sans-serif;
}
html[data-theme="dark"]{
  --paper:#14181e;
  --sheet:#1b222b;
  --ink:#e8edf2;
  --muted:#b0bac4;
  --line:#3a4654;
  --steel:#0f1318;
  --steel-2:#1a222b;
  --hazard:#e3b341;
  --eyebrow:#e3b341;
  --link:#f0c14d;
  --lang-bg:#2a3520;
  --lang-fg:#d4e89a;
  --diagram-ink:#c5d0db;
  --inset-hi:rgba(255,255,255,.06);
  --p0:#ff8a80;
  --p0-bg:#3a1d1c;
  --p1:#ffb074;
  --p1-bg:#3a2718;
  --p2:#e6c35c;
  --p2-bg:#3a3218;
  --ok:#7ddea4;
  --ok-bg:#163526;
  --med:#ffb86b;
  --med-bg:#3a2718;
  --hero-0:#1a222b;
  --hero-1:#171e26;
  --hero-2:#14181e;
  --hero-border:#2f3a46;
  --card:#1b222b;
  --chip:#24303b;
  --grid:rgba(232,237,242,.05);
}
*{box-sizing:border-box}
html,body{max-width:100%;margin:0}
body{
  color:var(--ink);
  font-family:var(--sans);
  line-height:1.6;
  background-color:var(--paper);
  background-image:
    linear-gradient(var(--grid) 1px,transparent 1px),
    linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:22px 22px;
}
.toolbar{
  position:sticky;
  top:0;
  z-index:50;
  display:flex;
  justify-content:flex-end;
  gap:8px;
  padding:10px 12px;
  background:color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);
}
.toolbar button{
  appearance:none;
  border:1px solid var(--line);
  background:var(--card);
  color:var(--ink);
  font-family:var(--mono);
  font-size:11px;
  letter-spacing:.04em;
  padding:6px 10px;
  cursor:pointer;
}
.toolbar button[aria-pressed="true"]{
  background:var(--chip);
  border-color:var(--hazard);
}
.wrap{
  width:min(1120px,calc(100% - 24px));
  margin:0 auto;
  padding:28px 0 72px;
  min-width:0;
}
header.hero{
  position:relative;
  color:var(--ink);
  background:
    linear-gradient(180deg,var(--hero-0) 0%,var(--hero-1) 55%,var(--hero-2) 100%);
  border:1px solid var(--hero-border);
  box-shadow:0 14px 32px rgba(28,34,40,.10);
  overflow:hidden;
  min-width:0;
}
header.hero::before{
  content:"";
  display:block;
  height:10px;
  background:repeating-linear-gradient(-45deg,#e3b341 0 10px,#1a1714 10px 20px);
}
.hero-inner{padding:22px 24px 24px;min-width:0}
.eyebrow{
  margin:0 0 8px;
  font-family:var(--mono);
  font-size:11px;
  letter-spacing:.18em;
  text-transform:uppercase;
  color:var(--eyebrow);
}
h1{
  margin:0 0 8px;
  font-family:var(--display);
  font-weight:800;
  font-size:clamp(1.7rem,4vw,2.55rem);
  letter-spacing:.04em;
  line-height:1.05;
  color:var(--ink);
  overflow-wrap:anywhere;
}
.sub{
  margin:0;
  color:var(--muted);
  max-width:70ch;
  overflow-wrap:anywhere;
}
.badge-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.badge{
  display:inline-flex;
  align-items:center;
  max-width:100%;
  padding:4px 10px;
  border:1px solid var(--line);
  font-family:var(--mono);
  font-size:11px;
  font-weight:600;
  letter-spacing:.04em;
  background:var(--card);
  color:var(--ink);
  overflow-wrap:anywhere;
}
.badge.risk-med{background:var(--med-bg);color:var(--med);border-color:transparent}
.badge.risk-high{background:var(--p0-bg);color:var(--p0);border-color:transparent}
.badge.risk-low{background:var(--ok-bg);color:var(--ok);border-color:transparent}
.badge.lang{background:var(--lang-bg);color:var(--lang-fg);border-color:transparent}
.badge.ok{background:var(--ok-bg);color:var(--ok);border-color:transparent}
.meta-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));
  gap:10px;
  margin-top:20px;
}
.meta{
  min-width:0;
  padding:10px 12px;
  background:var(--card);
  border:1px solid var(--line);
  box-shadow:0 1px 0 var(--inset-hi) inset;
  color:var(--ink);
}
.meta .k{
  display:block;
  font-family:var(--mono);
  font-size:10px;
  letter-spacing:.16em;
  text-transform:uppercase;
  color:var(--muted);
}
.meta .v{
  display:block;
  margin-top:4px;
  font-size:13px;
  font-weight:500;
  color:var(--ink);
  overflow-wrap:anywhere;
  word-break:break-word;
}
section{
  margin-top:18px;
  min-width:0;
  padding:22px 22px 20px;
  background:var(--sheet);
  border:1px solid var(--line);
  box-shadow:0 1px 0 var(--inset-hi) inset;
}
h2{
  display:flex;
  align-items:center;
  gap:10px;
  margin:0 0 16px;
  font-family:var(--display);
  font-size:1.35rem;
  font-weight:700;
  letter-spacing:.08em;
  text-transform:uppercase;
}
h2::before{
  content:"";
  width:10px;
  height:18px;
  background:var(--hazard);
  flex:0 0 auto;
}
h3{font-size:1rem;margin:16px 0 8px;color:var(--ink)}
.muted{color:var(--muted)}
a{color:var(--link)}
a:hover{filter:brightness(1.12)}
code{
  font-family:var(--mono);
  font-size:.86em;
  background:var(--chip);
  padding:1px 5px;
  overflow-wrap:anywhere;
}
.stats{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
}
.stat{
  min-width:0;
  padding:14px 10px;
  text-align:center;
  background:var(--card);
  border:1px solid var(--line);
}
.stat .n{
  font-family:var(--display);
  font-size:clamp(1.15rem,2.8vw,2rem);
  font-weight:800;
  line-height:1.1;
  margin-bottom:6px;
  overflow-wrap:anywhere;
}
.stat .l{font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
.stat.p0 .n{color:var(--p0)}
.stat.p1 .n{color:var(--p1)}
.stat.p2 .n{color:var(--p2)}
.stat.risk .n{color:var(--med);font-size:clamp(1rem,2.4vw,1.55rem)}
.lede{
  margin:16px 0 0;
  overflow-wrap:anywhere;
  word-break:break-word;
}
.findings-stack{display:grid;gap:14px;min-width:0;max-width:100%}
.finding{
  display:flex;
  flex-direction:column;
  min-width:0;
  max-width:100%;
  margin:0;
  background:var(--card);
  border:1px solid var(--line);
  overflow:visible;
}
.finding.p0{border-left:5px solid var(--p0)}
.finding.p1{border-left:5px solid var(--p1)}
.finding.p2{border-left:5px solid var(--p2)}
.finding.empty{border-left:5px solid var(--ok);background:var(--ok-bg)}
.finding-head{
  display:flex;
  align-items:flex-start;
  gap:10px;
  padding:14px 16px 12px;
  background:linear-gradient(180deg,var(--chip) 0%,var(--card) 100%);
  border-bottom:1px solid var(--line);
  min-width:0;
}
.sev{
  flex:0 0 auto;
  font-family:var(--display);
  font-size:13px;
  font-weight:800;
  letter-spacing:.12em;
  padding:3px 8px;
  border:1px solid currentColor;
}
.sev.p0{background:var(--p0-bg);color:var(--p0)}
.sev.p1{background:var(--p1-bg);color:var(--p1)}
.sev.p2{background:var(--p2-bg);color:var(--p2)}
.finding h3{
  margin:2px 0 0;
  flex:1 1 auto;
  min-width:0;
  font-family:var(--display);
  font-size:clamp(1.05rem,2vw,1.35rem);
  font-weight:700;
  letter-spacing:.02em;
  line-height:1.25;
  overflow-wrap:anywhere;
  word-break:break-word;
}
.finding-body{
  display:grid;
  gap:0;
  min-width:0;
}
.field{
  display:grid;
  grid-template-columns:76px minmax(0,1fr);
  gap:12px;
  padding:12px 16px;
  border-top:1px dashed var(--line);
  min-width:0;
}
.field:first-child{border-top:0}
.field-k{
  font-family:var(--mono);
  font-size:10px;
  letter-spacing:.14em;
  text-transform:uppercase;
  color:var(--muted);
  padding-top:3px;
}
.field-v{
  min-width:0;
  margin:0;
  font-size:13.5px;
  line-height:1.65;
  overflow-wrap:anywhere;
  word-break:break-word;
  white-space:pre-wrap;
}
.field-v.is-path{
  font-family:var(--mono);
  font-size:12px;
  background:var(--chip);
  padding:8px 10px;
  word-break:break-all;
}
.field-v.is-cat,.field-v.is-conf{
  font-family:var(--mono);
  font-size:12px;
  font-weight:600;
  letter-spacing:.04em;
}
.pad{padding:12px 16px}
.table-wrap{max-width:100%;overflow-x:auto}
table{
  width:100%;
  table-layout:fixed;
  border-collapse:collapse;
  font-size:13px;
  background:var(--card);
  border:1px solid var(--line);
}
th,td{
  text-align:left;
  padding:10px 12px;
  border-bottom:1px solid var(--line);
  vertical-align:top;
  overflow-wrap:anywhere;
  word-break:break-word;
}
th{
  background:var(--chip);
  font-family:var(--mono);
  font-size:11px;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:var(--muted);
}
tr:last-child td{border-bottom:0}
ol.fix,ul{padding-left:1.2rem;overflow-wrap:anywhere}
ol.fix li,ul li{margin:6px 0}
.diagram{
  background:var(--card);
  border:1px dashed var(--line);
  padding:14px;
  margin:10px 0 16px;
  overflow-x:auto;
  font-family:var(--mono);
  font-size:12px;
  line-height:1.45;
  white-space:pre-wrap;
  overflow-wrap:anywhere;
  color:var(--diagram-ink);
}
.field-v,.lede,p,td,li,footer{
  color:var(--ink);
}
.field-v.is-chain{padding:4px 0}
.call-chain{
  display:flex;
  flex-direction:column;
  gap:10px;
  min-width:0;
  max-width:100%;
  padding:12px;
  background:var(--card);
  border:1px dashed var(--line);
}
.chain-title{
  font-family:var(--mono);
  font-size:11px;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:var(--muted);
}
.call-chain-path{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  min-width:0;
}
.chain-node{
  display:inline-block;
  max-width:100%;
  padding:6px 10px;
  border:1px solid var(--line);
  background:var(--chip);
  font-family:var(--mono);
  font-size:12px;
  line-height:1.35;
  overflow-wrap:anywhere;
  word-break:break-word;
}
.chain-node.is-risk{
  background:var(--p1-bg);
  border-color:var(--p1);
  color:var(--p1);
  font-weight:600;
}
.chain-arrow{
  flex:0 0 auto;
  color:var(--muted);
  font-family:var(--mono);
  font-size:14px;
}
footer{
  margin-top:28px;
  color:var(--muted);
  font-size:12px;
  text-align:center;
  font-family:var(--mono);
  letter-spacing:.04em;
}
.path{overflow-wrap:anywhere;word-break:break-all;font-family:var(--mono);font-size:12px}
@media (max-width:720px){
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .field{grid-template-columns:1fr}
  .field-k{padding-top:0}
  section,.hero-inner{padding-left:16px;padding-right:16px}
}
CSS
)"

jq -n -r --slurpfile p "$FRAG" --arg css "$CSS" '
  def esc: tostring | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;") | gsub("\""; "&quot;");
  def h2bi($zh; $en): "<h2 data-zh=\"" + ($zh|esc) + "\" data-en=\"" + ($en|esc) + "\">" + ($zh|esc) + "</h2>\n";
  $p[0] as $p
  | "<!DOCTYPE html>\n<html lang=\"zh-CN\" data-theme=\"light\">\n<head>\n<meta charset=\"UTF-8\"/>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n<title data-zh=\"" + ($p.title_zh|esc) + "\" data-en=\"" + ($p.title_en|esc) + "\">\($p.title)</title>\n<style>\n"
  + $css + "\n</style>\n</head>\n<body>\n"
  + "<div class=\"toolbar\" role=\"toolbar\" aria-label=\"Report controls\">\n"
  + "<button type=\"button\" id=\"btn-lang-zh\" aria-pressed=\"true\" data-zh=\"中文\" data-en=\"中文\">中文</button>\n"
  + "<button type=\"button\" id=\"btn-lang-en\" aria-pressed=\"false\" data-zh=\"EN\" data-en=\"EN\">EN</button>\n"
  + "<button type=\"button\" id=\"btn-theme\" aria-pressed=\"false\" data-zh=\"黑夜\" data-en=\"Dark\">黑夜</button>\n"
  + "</div>\n"
  + "<div class=\"wrap\">\n"
  + "<header class=\"hero\"><div class=\"hero-inner\">\n<p class=\"eyebrow\" data-zh=\"审查档案 · codexqa-code-reviewer · CodexQA\" data-en=\"INSPECTION DOSSIER · codexqa-code-reviewer · CodexQA\">审查档案 · codexqa-code-reviewer · CodexQA</p>\n"
  + "<h1 data-zh=\"Code Review 结论报告\" data-en=\"Code Review Report\">Code Review 结论报告</h1>\n"
  + "<p class=\"sub\">\($p.repo_label) · <span class=\"mode-bi\">\($p.mode_html)</span> · <strong>\($p.branch)</strong> vs <strong>\($p.diff_base)</strong></p>\n"
  + "<div class=\"badge-row\">\n<span class=\"badge \($p.risk_class)\"><span data-zh=\"总体风险\" data-en=\"Overall risk\">总体风险</span> \($p.overall_risk_html)</span>\n"
  + "<span class=\"badge lang\"><span data-zh=\"主语言\" data-en=\"Primary language\">主语言</span> \($p.primary_language) · \($p.language_confidence)</span>\n"
  + "<span class=\"badge ok\">P0=\($p.p0_count) · P1=\($p.p1_count) · P2=\($p.p2_count)</span>\n"
  + "<span class=\"badge\"><span data-zh=\"焦点语言\" data-en=\"focus\">焦点语言</span>: \($p.review_language_focus)</span>\n</div>\n"
  + "<div class=\"meta-grid\">\n"
  + "<div class=\"meta\"><span class=\"k\">repo</span><span class=\"v\">\($p.repo)</span></div>\n"
  + "<div class=\"meta\"><span class=\"k\">diff_base</span><span class=\"v\">\($p.diff_base)</span></div>\n"
  + "<div class=\"meta\"><span class=\"k\">codexqa</span><span class=\"v\">\($p.codexqa_version)</span></div>\n"
  + "<div class=\"meta\"><span class=\"k\" data-zh=\"evidence\" data-en=\"evidence\">evidence</span><span class=\"v\">\($p.evidence_dir)</span></div>\n"
  + "<div class=\"meta\"><span class=\"k\" data-zh=\"generated\" data-en=\"generated\">generated</span><span class=\"v\">\($p.generated_at)</span></div>\n"
  + "</div>\n</div></header>\n"
  + "<section>" + h2bi("结论一览"; "Overview") + "<div class=\"stats\">\n"
  + "<div class=\"stat p0\"><div class=\"n\">\($p.p0_count)</div><div class=\"l\" data-zh=\"P0 阻断\" data-en=\"P0 Blocker\">P0 阻断</div></div>\n"
  + "<div class=\"stat p1\"><div class=\"n\">\($p.p1_count)</div><div class=\"l\" data-zh=\"P1 本迭代应修\" data-en=\"P1 fix this iteration\">P1 本迭代应修</div></div>\n"
  + "<div class=\"stat p2\"><div class=\"n\">\($p.p2_count)</div><div class=\"l\" data-zh=\"P2 可选 / 债\" data-en=\"P2 optional / debt\">P2 可选 / 债</div></div>\n"
  + "<div class=\"stat risk\"><div class=\"n\">\($p.overall_risk_html)</div><div class=\"l\" data-zh=\"总体风险\" data-en=\"Overall risk\">总体风险</div></div>\n"
  + "</div>\n<p class=\"lede\" data-zh=\"" + ($p.summary_zh|esc) + "\" data-en=\"" + ($p.summary_en|esc) + "\">" + ($p.summary_zh|esc) + "</p>\n"
  + "<p class=\"muted lede\"><span data-zh=\"意图：\" data-en=\"Intent: \">意图：</span>"
  + "<span data-zh=\"" + ($p.intent_zh|esc) + "\" data-en=\"" + ($p.intent_en|esc) + "\">" + ($p.intent_zh|esc) + "</span></p>\n"
  + "<p class=\"muted lede\"><span data-zh=\"范围：\" data-en=\"Scope: \">范围：</span>"
  + "<span data-zh=\"" + ($p.scope_zh|esc) + "\" data-en=\"" + ($p.scope_en|esc) + "\">" + ($p.scope_zh|esc) + "</span></p>\n"
  + $p.compare_link
  + "<p class=\"muted lede\" data-zh=\"合入决策留给人工；本报告不自动通过合入。\" data-en=\"Merge decision is left to humans; this report does not auto-approve.\">合入决策留给人工；本报告不自动通过合入。</p>\n</section>\n"
  + ($p.risk_tier_html // "")
  + ($p.design_fit_html // "")
  + ($p.complexity_html // "")
  + ($p.dependencies_html // "")
  + ($p.resilience_html // "")
  + ($p.privacy_html // "")
  + ($p.rollout_html // "")
  + ($p.performance_html // "")
  + ($p.llm_judgment_html // "")
  + "<section>" + h2bi("发现项"; "Findings") + "<div class=\"findings-stack\">\n" + $p.p0_html + "\n" + $p.p1_html + "\n" + $p.p2_html + "\n</div></section>\n"
  + "<section>" + h2bi("回归必测清单"; "Regression must-test")
  + "<p class=\"muted\" data-zh=\"目标列写清可执行场景（入口/条件/期望）；证据列用通俗依据，勿只填符号 UUID 或证据包路径。\" data-en=\"Write executable scenarios (entry/conditions/expected result). Evidence should be plain language — not only UUIDs or pack paths.\">目标列写清可执行场景（入口/条件/期望）；证据列用通俗依据，勿只填符号 UUID 或证据包路径。</p>\n"
  + "<div class=\"table-wrap\"><table><thead><tr>"
  + "<th data-zh=\"回归测试场景\" data-en=\"Regression scenario\">回归测试场景</th>"
  + "<th data-zh=\"为什么必测\" data-en=\"Why required\">为什么必测</th>"
  + "<th data-zh=\"依据说明\" data-en=\"Evidence\">依据说明</th>"
  + "</tr></thead><tbody>\n"
  + $p.regression_rows + "\n</tbody></table></div></section>\n"
  + "<section>" + h2bi("测试缺口"; "Test gaps")
  + "<p class=\"muted\" data-zh=\"统计口径：看调用图里该生产符号是否被测试覆盖边罩住——tested_count&gt;0 或 tests-reach 非空才算已测。这不是「仓库有没有 tests 目录 / 有没有单测文件」。测试文件里普通调用了函数、或文件名带 test，都不算覆盖。因此可能出现：仓库里已有测试代码，但图上仍记为缺口。\" data-en=\"Criterion: a production symbol counts as tested only when the call graph has a tests coverage edge (tested_count&gt;0 or non-empty tests-reach). This is not about whether a tests/ folder or unit-test files exist. Ordinary calls from test files, or test-like filenames, do not count as coverage. So the repo may already have tests while the graph still shows a gap.\">统计口径：看调用图里该生产符号是否被测试覆盖边罩住——tested_count>0 或 tests-reach 非空才算已测。这不是「仓库有没有 tests 目录 / 有没有单测文件」。测试文件里普通调用了函数、或文件名带 test，都不算覆盖。因此可能出现：仓库里已有测试代码，但图上仍记为缺口。</p>\n"
  + "<div class=\"table-wrap\"><table><thead><tr>"
  + "<th data-zh=\"符号\" data-en=\"Symbol\">符号</th>"
  + "<th>tested_count</th><th>tests-reach</th>"
  + "<th data-zh=\"说明\" data-en=\"Notes\">说明</th>"
  + "</tr></thead><tbody>\n"
  + $p.gap_rows + "\n</tbody></table></div>\n"
  + "<p class=\"muted lede\"><span data-zh=\"敏感路径：\" data-en=\"Sensitive paths: \">敏感路径：</span>"
  + "<span data-zh=\"" + ($p.sensitive_zh|esc) + "\" data-en=\"" + ($p.sensitive_en|esc) + "\">" + ($p.sensitive_zh|esc) + "</span></p></section>\n"
  + "<footer><span data-zh=\"由技能 codexqa-code-reviewer · CodexQA CLI · scripts/render-review-html.sh 生成\" data-en=\"Generated by skill codexqa-code-reviewer · CodexQA CLI · scripts/render-review-html.sh\">由技能 codexqa-code-reviewer · CodexQA CLI · scripts/render-review-html.sh 生成</span>"
  + (if (($p.evidence_dir // "") | length) > 0 then " · <span class=\"path\">\($p.evidence_dir)</span>" else "" end)
  + "</footer>\n"
  + "</div>\n"
  + "<script>\n"
  + "(function(){\n"
  + "var root=document.documentElement;\n"
  + "var LANG_KEY=\"acr-report-lang\";\n"
  + "var THEME_KEY=\"acr-report-theme\";\n"
  + "function applyLang(lang){\n"
  + "  root.setAttribute(\"lang\", lang===\"en\"?\"en\":\"zh-CN\");\n"
  + "  document.querySelectorAll(\"[data-zh][data-en]\").forEach(function(el){\n"
  + "    var v=el.getAttribute(lang===\"en\"?\"data-en\":\"data-zh\");\n"
  + "    if(v!=null) el.textContent=v;\n"
  + "  });\n"
  + "  var zh=document.getElementById(\"btn-lang-zh\");\n"
  + "  var en=document.getElementById(\"btn-lang-en\");\n"
  + "  if(zh) zh.setAttribute(\"aria-pressed\", lang===\"zh\"?\"true\":\"false\");\n"
  + "  if(en) en.setAttribute(\"aria-pressed\", lang===\"en\"?\"true\":\"false\");\n"
  + "  try{localStorage.setItem(LANG_KEY, lang);}catch(e){}\n"
  + "}\n"
  + "function applyTheme(theme){\n"
  + "  root.setAttribute(\"data-theme\", theme);\n"
  + "  var btn=document.getElementById(\"btn-theme\");\n"
  + "  if(btn){\n"
  + "    btn.setAttribute(\"aria-pressed\", theme===\"dark\"?\"true\":\"false\");\n"
  + "    btn.setAttribute(\"data-zh\", theme===\"dark\"?\"白天\":\"黑夜\");\n"
  + "    btn.setAttribute(\"data-en\", theme===\"dark\"?\"Light\":\"Dark\");\n"
  + "    var lang=root.getAttribute(\"lang\")===\"en\"?\"en\":\"zh\";\n"
  + "    btn.textContent=btn.getAttribute(lang===\"en\"?\"data-en\":\"data-zh\");\n"
  + "  }\n"
  + "  try{localStorage.setItem(THEME_KEY, theme);}catch(e){}\n"
  + "}\n"
  + "var lang=\"zh\", theme=\"light\";\n"
  + "try{lang=localStorage.getItem(LANG_KEY)||lang; theme=localStorage.getItem(THEME_KEY)||theme;}catch(e){}\n"
  + "applyTheme(theme===\"dark\"?\"dark\":\"light\");\n"
  + "applyLang(lang===\"en\"?\"en\":\"zh\");\n"
  + "document.getElementById(\"btn-lang-zh\").addEventListener(\"click\", function(){applyLang(\"zh\");});\n"
  + "document.getElementById(\"btn-lang-en\").addEventListener(\"click\", function(){applyLang(\"en\");});\n"
  + "document.getElementById(\"btn-theme\").addEventListener(\"click\", function(){\n"
  + "  applyTheme(root.getAttribute(\"data-theme\")===\"dark\"?\"light\":\"dark\");\n"
  + "});\n"
  + "})();\n"
  + "</script>\n"
  + "</body>\n</html>\n"
' >"$OUT"

echo "HTML review report written: $OUT"
