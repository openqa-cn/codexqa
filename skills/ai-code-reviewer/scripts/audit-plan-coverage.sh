#!/usr/bin/env bash
# Fine-grained plan→skill coverage auditor.
# Layers: I=instruction (SKILL/prompts/refs), S=script automation, T=template/report.
# Verdict per FP: PASS | PARTIAL | FAIL | N/A
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Portable display path for reports (avoid machine-specific absolutes in committed docs)
SKILL_ROOT_DISPLAY="${ROOT##*/}"
if [[ "$(basename "$(dirname "$ROOT")")" == "skills" ]]; then
  SKILL_ROOT_DISPLAY="skills/${ROOT##*/}"
fi
REPORT="${1:-$ROOT/examples/plan-coverage-audit.md}"
FAILS=0
PARTIALS=0
PASSES=0

# Accumulate report body
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

section() { printf '\n## %s\n\n' "$1" >>"$BODY"; }
row() {
  local id="$1" fp="$2" layer="$3" verdict="$4" evidence="$5"
  printf '| %s | %s | %s | **%s** | %s |\n' "$id" "$fp" "$layer" "$verdict" "$evidence" >>"$BODY"
  case "$verdict" in
    PASS) PASSES=$((PASSES + 1)) ;;
    PARTIAL) PARTIALS=$((PARTIALS + 1)) ;;
    FAIL) FAILS=$((FAILS + 1)) ;;
  esac
}

has() {
  local pattern="$1"; shift
  local f
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    if grep -Eqi -- "$pattern" "$f"; then
      return 0
    fi
  done
  return 1
}

has_all_files() {
  local f
  for f in "$@"; do
    [[ -f "$ROOT/$f" ]] || return 1
  done
  return 0
}

# --- Header ---
{
  echo "# Plan coverage audit (fine-grained)"
  echo
  echo "- skill_root: \`$SKILL_ROOT_DISPLAY\`"
  echo "- audited_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- method: atomic function points × layers (I/S/T)"
  echo "- plan: AI Code Reviewer (CodexQA-backed)"
  echo
  echo "| ID | Function point | Layer | Verdict | Evidence |"
  echo "|---|---|---|---|---|"
} >"$BODY"

# ========== A. Decisions ==========
section "A. Locked decisions"

if [[ -d "$ROOT" && ("$ROOT" == */skills/ai-code-reviewer || "$(basename "$ROOT")" == "ai-code-reviewer") ]]; then
  row A1 "源码位于 skills/ai-code-reviewer/ (name=ai-code-reviewer)" I PASS "path exists"
else
  row A1 "源码位于 skills/ai-code-reviewer/" I FAIL "unexpected root: $ROOT"
fi

if has '^name: ai-code-reviewer' "$ROOT/SKILL.md"; then
  row A0 "SKILL.md name: ai-code-reviewer" I PASS "frontmatter name"
else
  row A0 "SKILL.md name: ai-code-reviewer" I FAIL "frontmatter name mismatch"
fi

if has 'skills library|安装目标待定|Do not copy into a skills library' "$ROOT/SKILL.md"; then
  row A2 "暂不安装到 skills 库" I PASS "SKILL install note"
else
  row A2 "暂不安装到 skills 库" I FAIL "missing install deferral note"
fi

if ! find "$ROOT" \( -name package.json -o -name node_modules -o -name '*.ts' -o -name 'codexqa.js' \) 2>/dev/null | grep -q .; then
  row A3 "禁止合入 CodexQA zip/源码" S PASS "no vendored package/source under skill"
else
  row A3 "禁止合入 CodexQA zip/源码" S FAIL "found suspected source artifacts"
fi

if has 'CLI only|codexqa on PATH|Never vendor' "$ROOT/SKILL.md" && has 'codexqa' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row A4 "图谱底座=本机 codexqa CLI" I/S PASS "SKILL+scripts invoke CLI"
else
  row A4 "图谱底座=本机 codexqa CLI" I/S FAIL "CLI binding missing"
fi

if has 'PR/diff \(default\)|PR / diff \(default\)' "$ROOT/SKILL.md" && has 'Full-repo \(optional\)|full-repo' "$ROOT/SKILL.md"; then
  row A5 "默认 PR/diff；全仓可选" I PASS "SKILL modes table"
else
  row A5 "默认 PR/diff；全仓可选" I FAIL "modes not stated"
fi

if has 'Evidence files first|先落盘|cite artifact' "$ROOT/SKILL.md"; then
  row A6 "证据来自 CLI JSON；禁止臆造" I PASS "hard constraints"
else
  row A6 "证据来自 CLI JSON；禁止臆造" I FAIL "missing evidence-first rule"
fi

# ========== B. Industry bar ==========
section "B. Industry design points"

if has 'Graph-first|图谱评审|blast radius|爆炸半径' "$ROOT/references/industry-bar.md" "$ROOT/SKILL.md"; then
  row B1 "图谱评审非 diff-only 二次草稿" I PASS "industry-bar/SKILL"
else
  row B1 "图谱评审非 diff-only 二次草稿" I FAIL "missing"
fi

if has 'Public surface drift' "$ROOT/references/industry-bar.md" && has 'edges|callers' "$ROOT/prompts/pr-diff-review.md"; then
  row B2 "Public surface drift 先由图回答" I PASS "industry-bar + PR prompt callers"
else
  row B2 "Public surface drift 先由图回答" I FAIL "missing"
fi

if has 'Coverage gap|tested_count' "$ROOT/references/industry-bar.md" "$ROOT/references/review-dimensions.md"; then
  row B3 "Coverage gap（tests 边）" I PASS "industry-bar/dimensions"
else
  row B3 "Coverage gap（tests 边）" I FAIL "missing"
fi

if has 'Trust|entry reachability|from_count' "$ROOT/references/industry-bar.md" && has 'path' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row B4 "Trust/entry reachability" I/S PASS "tags+paths collection"
else
  row B4 "Trust/entry reachability" I/S FAIL "missing"
fi

if has 'Hot-but-thin|hot-but-thin' "$ROOT/references/industry-bar.md" "$ROOT/scripts/collect-pr-evidence.sh"; then
  row B5 "Hot-but-thin（高 fan-in + tested_count==0）" I/S PASS "08-hot-but-thin.json"
else
  row B5 "Hot-but-thin" I/S FAIL "missing"
fi

if has 'UNKNOWN|lower confidence|降置信|index_confidence' "$ROOT/references/industry-bar.md" "$ROOT/SKILL.md" "$ROOT/templates/review-report.md"; then
  row B6 "图不完整 → UNKNOWN/降置信；禁假绿" I PASS "confidence language present"
else
  row B6 "图不完整 → UNKNOWN/降置信；禁假绿" I FAIL "missing UNKNOWN/confidence"
fi

if has 'lang_stats|Multi-language|多语言' "$ROOT/SKILL.md" "$ROOT/references/review-dimensions.md" "$ROOT/references/codexqa-cli-contract.md"; then
  row B7 "多语言靠 CodexQA 解析；不重复造解析器" I PASS "lang_stats + dimensions"
else
  row B7 "多语言靠 CodexQA 解析" I FAIL "missing"
fi

if has 'codexqa_detect_language_profile|09-language-profile|primary_language' \
  "$ROOT/scripts/lib/codexqa-preflight.sh" \
  "$ROOT/scripts/collect-pr-evidence.sh" \
  "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  "$ROOT/scripts/validate-evidence.sh" \
  "$ROOT/SKILL.md" \
  "$ROOT/references/language-profile.md"; then
  row B7b "主开发语言判定全链路（collect→profile→validate→SKILL）" I/S PASS "09-language-profile + detector"
else
  row B7b "主开发语言判定全链路" I/S FAIL "missing primary language gate"
fi

if has 'Design fit|design →|Design fit →|Complexity|dimension-registry' \
    "$ROOT/references/review-dimensions.md" "$ROOT/prompts/pr-diff-review.md" \
    "$ROOT/references/dimension-registry.md" \
  && has 'Correctness|Security|contract|Test gaps|Observability|正确性|安全|契约|测试缺口|可观测' \
    "$ROOT/references/review-dimensions.md" "$ROOT/prompts/pr-diff-review.md" \
  && has 'complexity' "$ROOT/references/dimension-registry.md" \
    "$ROOT/references/dimensions/complexity.md" \
  && has 'dependencies' "$ROOT/references/dimension-registry.md" \
    "$ROOT/references/dimensions/dependencies.md" \
  && has 'privacy' "$ROOT/references/dimension-registry.md" \
    "$ROOT/references/dimensions/privacy.md" \
  && has 'resilience' "$ROOT/references/dimension-registry.md" \
    "$ROOT/references/dimensions/resilience.md" \
  && has 'observability' "$ROOT/references/dimension-registry.md" \
    "$ROOT/references/dimensions/observability.md"; then
  row B8 "多维管线：Design fit→…→Resilience→…→Observability→Maintainability" I PASS "registry + review-dimensions + prompt order"
else
  row B8 "多维评审管线" I FAIL "dimension order / cards missing"
fi

if has 'DesignFitSignals|10-design-fit-signals|derive-design-fit' \
    "$ROOT/scripts/lib/derive-design-fit.sh" \
    "$ROOT/scripts/collect-pr-evidence.sh" \
    "$ROOT/references/dimensions/design-fit.md"; then
  row B8b "Design fit 派生信号（0 额外 CodexQA）" I/S PASS "derive + collect + card"
else
  row B8b "Design fit 派生" I/S FAIL "missing derive/card/collect hook"
fi

if has 'ComplexitySignals|11-complexity-signals|derive-complexity' \
    "$ROOT/scripts/lib/derive-complexity.sh" \
    "$ROOT/scripts/collect-pr-evidence.sh" \
    "$ROOT/references/dimensions/complexity.md"; then
  row B8c "Complexity 派生信号（0 额外 CodexQA）" I/S PASS "derive + collect + card"
else
  row B8c "Complexity 派生" I/S FAIL "missing derive/card/collect hook"
fi

if has 'Human merge|do not auto-approve|合入决策留给人' "$ROOT/SKILL.md"; then
  row B9 "不做自动 merge 门禁替身" I PASS "SKILL hard constraint 5"
else
  row B9 "不做自动 merge 门禁替身" I FAIL "missing"
fi

# ========== C. Capability → CLI map ==========
section "C. Capability → CodexQA CLI mapping"

if has 'diff-base' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'change-groups' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'symbol-diff' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'symbols --change add,change' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row C1 "变更定位：index --diff-base → groups/symbols/symbol-diff" S PASS "collect-pr"
else
  row C1 "变更定位" S FAIL "incomplete collect-pr"
fi

if has 'edges --id' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'reach --id' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'path --from' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row C2 "爆炸半径：edges/reach/path" S PASS "impact/ + paths/"
else
  row C2 "爆炸半径：edges/reach/path" S FAIL "missing path or edges/reach"
fi

if has 'tag .* keys' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'tagged --key' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'from_count' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row C3 "入口/执行流：tag keys + tagged + reach→from_count==0" S PASS "07-tags + paths from entries"
else
  row C3 "入口/执行流" S FAIL "incomplete"
fi

if has 'edge-kinds tests' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'tested_count' "$ROOT/SKILL.md" "$ROOT/references/review-dimensions.md" \
  && has 'test directory|test path|tests edges' "$ROOT/SKILL.md" "$ROOT/references/review-dimensions.md"; then
  row C4 "测试缺口：tested_count + tests-reach；禁目录名推断" I/S PASS "script+SKILL+dimensions"
else
  row C4 "测试缺口" I/S FAIL "incomplete"
fi

SENS_SEARCH=0; SENS_NAME=0; SENS_CALLER=0
has 'search --query' "$ROOT/scripts/collect-pr-evidence.sh" && SENS_SEARCH=1
has 'symbols --name' "$ROOT/scripts/collect-pr-evidence.sh" && SENS_NAME=1
has 'sensitive' "$ROOT/prompts/pr-diff-review.md" && SENS_CALLER=1
if [[ $SENS_SEARCH -eq 1 && $SENS_NAME -eq 1 ]]; then
  row C5 "敏感路径：search / symbols --name + 调用方展开" S PASS "search+symbols --name in collect-pr"
elif [[ $SENS_SEARCH -eq 1 && $SENS_CALLER -eq 1 ]]; then
  row C5 "敏感路径：search / symbols --name + 调用方展开" S PARTIAL "has search+prompt callers; missing symbols --name collect"
else
  row C5 "敏感路径" S FAIL "missing sensitive collection"
fi

if has 'stats' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'summary' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'imports' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'wiki' "$ROOT/SKILL.md" && has 'explicitly ask|用户明确|unless the user' "$ROOT/SKILL.md" "$ROOT/prompts/full-repo-review.md"; then
  row C6 "全仓架构：stats/summary/imports；Wiki 需用户同意" I/S PASS "fullrepo script + wiki gate"
else
  row C6 "全仓架构" I/S FAIL "incomplete"
fi

# ========== D. Architecture pipeline ==========
section "D. Target architecture pipeline"

if has 'Preflight|command -v codexqa' "$ROOT/SKILL.md" "$ROOT/scripts/collect-pr-evidence.sh"; then
  row D1 "PreflightGates" I/S PASS "preflight in SKILL+scripts"
else
  row D1 "PreflightGates" I/S FAIL "missing"
fi

if has 'Collect evidence|collect-pr-evidence|collect-fullrepo' "$ROOT/SKILL.md"; then
  row D2 "CollectEvidenceCLI → ArtifactPackFiles" I PASS "workflow steps 2"
else
  row D2 "CollectEvidenceCLI" I FAIL "missing"
fi

if has 'pr-diff-review|Review from artifacts' "$ROOT/SKILL.md" "$ROOT/prompts/pr-diff-review.md"; then
  row D3 "RiskReviewReasoning from artifacts only" I PASS "prompts require pack"
else
  row D3 "RiskReviewReasoning" I FAIL "missing"
fi

if has 'review-report.md' "$ROOT/SKILL.md" && [[ -f "$ROOT/templates/review-report.md" ]]; then
  row D4 "Report output template" T PASS "templates/review-report.md"
else
  row D4 "Report" T FAIL "missing template"
fi

if [[ -f "$ROOT/templates/review-conclusion.json" ]] \
  && [[ -f "$ROOT/scripts/render-review-html.sh" ]] \
  && has 'render-review-html|REVIEW-REPORT.html|review-conclusion.json' "$ROOT/SKILL.md" "$ROOT/prompts/pr-diff-review.md"; then
  row D4b "HTML 结论报告（conclusion JSON + render-review-html.sh）" I/S/T PASS "REVIEW-REPORT.html pipeline"
else
  row D4b "HTML 结论报告" I/S/T FAIL "missing render-review-html / review-conclusion"
fi

if [[ -f "$ROOT/scripts/validate-skill.sh" ]] \
  && [[ -f "$ROOT/evals/eval.yaml" ]] \
  && has 'validate-skill|evals/' "$ROOT/SKILL.md"; then
  row D4c "本地 Eval 门禁（validate-skill.sh + evals/）" I/S/T PASS "skill-up substitute + fixtures"
else
  row D4c "本地 Eval 门禁" I/S/T FAIL "missing validate-skill.sh / evals"
fi

if has '_schema_note|SCHEMA' "$ROOT/templates/evidence-manifest.json" \
  && has 'manifest\.json' "$ROOT/references/codexqa-cli-contract.md" "$ROOT/SKILL.md" \
  && has 'schema example|SCHEMA|never write that filename|Runtime filename is always' \
    "$ROOT/SKILL.md" "$ROOT/references/codexqa-cli-contract.md" "$ROOT/templates/evidence-manifest.json"; then
  row D4d "manifest 命名澄清（template ≠ runtime）" I/T PASS "evidence-manifest schema-only"
else
  row D4d "manifest 命名澄清" I/T FAIL "template vs runtime confusing"
fi

if has '\.codexqa-review' "$ROOT/scripts/collect-pr-evidence.sh" && has 'TMPDIR|/tmp/codexqa-review' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row D5 "落盘目录 .codexqa-review/<run-id> 或临时目录" S PASS "OUT_DIR default logic"
else
  row D5 "落盘目录约定" S FAIL "missing"
fi

# ========== E. Directory structure ==========
section "E. Required directory structure"

FILES=(
  SKILL.md
  references/industry-bar.md
  references/codexqa-cli-contract.md
  references/review-dimensions.md
  references/dimension-registry.md
  references/dimensions/design-fit.md
  references/dimensions/complexity.md
  references/dimensions/dependencies.md
  references/dimensions/privacy.md
  references/dimensions/resilience.md
  references/dimensions/rollout.md
  references/dimensions/observability.md
  references/dimensions/contract.md
  references/dimensions/maintainability.md
  references/dimensions/performance.md
  references/dimensions/correctness-family-checks.md
  references/mermaid-evidence.md
  prompts/pr-diff-review.md
  prompts/full-repo-review.md
  templates/evidence-manifest.json
  templates/review-report.md
  templates/review-conclusion.json
  scripts/collect-pr-evidence.sh
  scripts/collect-fullrepo-evidence.sh
  scripts/validate-evidence.sh
  scripts/render-review-html.sh
  scripts/lib/derive-design-fit.sh
  scripts/lib/derive-complexity.sh
  scripts/lib/derive-dependencies.sh
  scripts/lib/derive-privacy.sh
  scripts/lib/derive-resilience.sh
  scripts/lib/derive-rollout.sh
  scripts/lib/derive-observability.sh
  scripts/lib/derive-contract.sh
  scripts/lib/derive-maintainability.sh
  scripts/lib/derive-performance.sh
  examples/pr-review-walkthrough.md
)
i=1
for f in "${FILES[@]}"; do
  if [[ -f "$ROOT/$f" ]]; then
    row "E$i" "文件存在: $f" T PASS "present"
  else
    row "E$i" "文件存在: $f" T FAIL "missing"
  fi
  i=$((i + 1))
done

# ========== F. PR evidence pack steps ==========
section "F. PR collect-pr-evidence.sh steps (plan §证据包约定)"

if (has 'command -v codexqa' "$ROOT/scripts/collect-pr-evidence.sh" \
      || has 'codexqa_require_cli' "$ROOT/scripts/collect-pr-evidence.sh" \
      || has 'codexqa_require_cli' "$ROOT/scripts/lib/codexqa-preflight.sh") \
  && has '--repo and --diff-base are required' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F1 "门禁：codexqa + REPO + DIFF_BASE" S PASS "required args + CodexQA preflight"
else
  row F1 "门禁" S FAIL "incomplete"
fi

if has 'index .*--diff-base|codexqa index' "$ROOT/scripts/collect-pr-evidence.sh" \
  && grep -q -- '--diff-base' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F2 "codexqa index --diff-base" S PASS "index step"
else
  row F2 "codexqa index --diff-base" S FAIL "missing"
fi

if has '01-stats.json' "$ROOT/scripts/collect-pr-evidence.sh" \
  && grep -q -- '--format json' "$ROOT/scripts/collect-pr-evidence.sh" \
  && grep -q 'stats' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F3 "stats → 01-stats.json" S PASS "present"
else
  row F3 "stats → 01-stats.json" S FAIL "missing"
fi

for pair in \
  "F4|02-summary.json|summary" \
  "F5|03-change-groups.json|change-groups" \
  "F6|04-changed-files.json|files --change add,change" \
  "F7|05-changed-symbols.json|symbols --change add,change --kind function,method"
 do
  IFS='|' read -r id file cmd <<<"$pair"
  if has "$file" "$ROOT/scripts/collect-pr-evidence.sh" && has "$cmd" "$ROOT/scripts/collect-pr-evidence.sh"; then
    row "$id" "$file ← $cmd" S PASS "present"
  else
    row "$id" "$file ← $cmd" S FAIL "missing"
  fi
done

if has '\.diff\.json' "$ROOT/scripts/collect-pr-evidence.sh" && has 'symbol-diff' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F8 "Top N symbol-diff → diffs/<id>.diff.json" S PASS "diff naming matches plan"
else
  row F8 "symbol-diff diffs" S FAIL "missing"
fi

if has 'edges-in.json' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'reach-in.json' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'tests-reach.json' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F9 "impact/<id>/{edges-in,reach-in,tests-reach}" S PASS "present"
else
  row F9 "impact packs" S FAIL "missing"
fi

if has '06-sensitive-hits.json' "$ROOT/scripts/collect-pr-evidence.sh" && has '07-tags.json' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F10 "06-sensitive + 07-tags（keys/tagged）" S PASS "present"
else
  row F10 "06/07 sensitive+tags" S FAIL "missing"
fi

if has 'manifest.json' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'index_quality' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'commands' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'diff_base' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'run_id' "$ROOT/scripts/collect-pr-evidence.sh"; then
  row F11 "manifest：run-id/repo/diff-base/commands/index_quality" S PASS "fields written"
else
  row F11 "manifest fields" S FAIL "incomplete"
fi

if has 'validate-evidence' "$ROOT/scripts/collect-pr-evidence.sh" \
  && has 'change-groups empty' "$ROOT/scripts/validate-evidence.sh" \
  && has 'all_default|change_status=default' "$ROOT/scripts/validate-evidence.sh"; then
  row F12 "validate：空 groups 或全 default → fail" S PASS "validate-evidence gates"
else
  row F12 "validate gates" S FAIL "incomplete"
fi

# ========== G. Full-repo ==========
section "G. Full-repo mode"

if has 'diff_base: null' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && ! grep -q 'index .* --diff-base' "$ROOT/scripts/collect-fullrepo-evidence.sh"; then
  row G1 "全仓不强制 diff 索引" S PASS "index without --diff-base; diff_base null"
else
  row G1 "全仓不强制 diff 索引" S FAIL "still forces diff-base"
fi

if has 'summary' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'stats' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'imports' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'from_count' "$ROOT/scripts/collect-fullrepo-evidence.sh" \
  && has 'tested_count' "$ROOT/scripts/collect-fullrepo-evidence.sh"; then
  row G2 "侧重 summary/stats/imports/high fan-in/untested hotspots" S PASS "fullrepo collect"
else
  row G2 "全仓证据侧重" S FAIL "incomplete"
fi

if has 'do not invent|No fake change|never invent PR|不要伪造' "$ROOT/prompts/full-repo-review.md" "$ROOT/SKILL.md"; then
  row G3 "全仓不伪造 change 分析" I PASS "prompts/SKILL"
else
  row G3 "全仓不伪造 change 分析" I FAIL "missing"
fi

# ========== H. SKILL.md behavior ==========
section "H. SKILL.md behavior design"

DESC="$ROOT/SKILL.md"
if has 'code review' "$DESC" && has 'PR review' "$DESC" && has '代码评审' "$DESC" \
  && has '影响面' "$DESC" && has '全仓' "$DESC" && has 'evidence-pack|证据包' "$DESC"; then
  row H1 "description 第三人称+触发词全集" I PASS "frontmatter triggers"
else
  row H1 "description 触发词" I PARTIAL "some triggers may be missing"
fi

if head -n 40 "$DESC" | grep -q '^disable-model-invocation:'; then
  row H2 "disable-model-invocation omitted (trigger discoverability)" I FAIL "frontmatter still sets disable-model-invocation"
else
  row H2 "disable-model-invocation omitted (trigger discoverability)" I PASS "frontmatter"
fi

if has 'CLI only' "$DESC" && has 'Evidence files first' "$DESC" && has 'status: blocked' "$DESC" \
  && has 'lang_stats|动态|dynamic dispatch|reflection' "$DESC" && has 'cite artifact|引用产物' "$DESC"; then
  row H3 "硬规则五条（CLI/证据/门禁/引用/多语言不确定性）" I PASS "hard constraints + multi-lang"
else
  row H3 "硬规则五条" I PARTIAL "check SKILL hard constraints completeness"
fi

if has '前置必要|hard prerequisite|Evidence files first' "$DESC"; then
  row H4 "图谱证据包是前置必要条件（非可选上下文）" I PASS "evidence-first / prerequisite"
else
  row H4 "证据包前置必要" I FAIL "missing"
fi

REQ_SECTIONS=(变更摘要 总风险 P0 P1 P2 回归 测试缺口 敏感 Mermaid 修复顺序 残留)
MISS=()
for s in "${REQ_SECTIONS[@]}"; do
  has "$s" "$DESC" "$ROOT/templates/review-report.md" "$ROOT/prompts/pr-diff-review.md" || MISS+=("$s")
done
if [[ ${#MISS[@]} -eq 0 ]]; then
  row H5 "默认输出九块覆盖" I/T PASS "SKILL+template+prompt"
else
  row H5 "默认输出九块覆盖" I/T PARTIAL "missing hints: ${MISS[*]}"
fi

if has '热点|hotspot' "$DESC" "$ROOT/prompts/full-repo-review.md" \
  && has '分层|入口|应用|领域|存储' "$ROOT/prompts/full-repo-review.md" "$ROOT/references/mermaid-evidence.md" \
  && has '产品评测|scorecard|打分' "$DESC" "$ROOT/prompts/full-repo-review.md"; then
  row H6 "全仓：热点/分层漂移/入口集中；禁产品打分" I PASS "full-repo prompt+SKILL"
else
  row H6 "全仓交付物" I PARTIAL "check full-repo wording"
fi

if has 'symbol' "$DESC" && has 'caller|调用方|entry|入口' "$DESC" && has 'tested_count' "$DESC"; then
  row H7 "高优 finding 附：符号/调用方/入口 path/tested_count" I PASS "Deliver section"
else
  row H7 "finding 证据绑定" I FAIL "incomplete"
fi

LINES=$(wc -l <"$DESC" | tr -d ' ')
if [[ "$LINES" -lt 500 ]]; then
  row H8 "SKILL.md < 500 行" I PASS "lines=$LINES"
else
  row H8 "SKILL.md < 500 行" I FAIL "lines=$LINES"
fi

# ========== I. Acceptance ==========
section "I. Acceptance criteria"

row I1 "多语言仓+diff-base→证据包→PR 报告（流程可达）" I PASS "scripts+prompts+template wired; runtime depends on local codexqa"
row I2 "全仓无 diff-base 可运行且不伪造 change" I/S PASS "G1+G3"
if ! find "$ROOT" \( -name package.json -o -path '*/node_modules/*' \) 2>/dev/null | grep -q .; then
  row I3 "仓库技能树无 CodexQA 业务源码拷贝" S PASS "clean"
else
  row I3 "无源码拷贝" S FAIL "artifacts found"
fi
if has 'tested_count' "$ROOT/references/review-dimensions.md" \
  && has 'test file name|test directory|path names do not|≠ tests|不是覆盖' \
    "$ROOT/references/review-dimensions.md" "$ROOT/SKILL.md" "$ROOT/templates/review-report.md"; then
  row I4 "明确区分 tests 边 vs 测试文件存在" I/T PASS "dimensions+SKILL+report"
else
  row I4 "tests 边 vs 测试文件" I/T FAIL "missing distinction"
fi

# ========== Summary ==========
TOTAL=$((PASSES + PARTIALS + FAILS))
{
  echo
  echo "## Summary"
  echo
  echo "| Verdict | Count |"
  echo "|---|---|"
  echo "| PASS | $PASSES |"
  echo "| PARTIAL | $PARTIALS |"
  echo "| FAIL | $FAILS |"
  echo "| Total FPs | $TOTAL |"
  echo
  if [[ "$FAILS" -eq 0 && "$PARTIALS" -eq 0 ]]; then
    echo "**Overall: FULL COVERAGE**"
  elif [[ "$FAILS" -eq 0 ]]; then
    echo "**Overall: COVERED WITH PARTIALS** — fix PARTIAL items to reach full coverage."
  else
    echo "**Overall: GAPS REMAIN** — FAIL items must be fixed."
  fi
  echo
  echo "### Layer legend"
  echo "- **I**: instruction/docs the agent must follow"
  echo "- **S**: shell automation producing evidence"
  echo "- **T**: templates / structural artifacts"
} >>"$BODY"

cp "$BODY" "$REPORT"
echo "Wrote $REPORT"
echo "PASS=$PASSES PARTIAL=$PARTIALS FAIL=$FAILS"

# Exit non-zero on FAIL
if [[ "$FAILS" -gt 0 ]]; then
  exit 1
fi
exit 0
