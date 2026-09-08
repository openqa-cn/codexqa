/**
 * Quality gates and summary commands: validate-summary / update-summary /
 * cross-view-check / check-req-coverage / check-analysis-quality /
 * show-local-progress / cleanup-stale-data / finalize-all
 */

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";

import {
  check_summary_forbidden,
  finalize_all,
  get_task_status,
  normalize_summary_for_plaintext,
  update_detection_summary,
} from "./platform.ts";
import { _cli_result, _cli_success, _require_save } from "./cli_common.ts";
import { ContentStore, changed_method_name, content_base_dir, repo_clone_base_dir } from "./store.ts";
import { SKILL_ROOT } from "./providers/config.ts";
import { _get_local_state_path, get_local_progress, get_all_batch_gits } from "./state.ts";

type Args = Record<string, any>;


export function cmd_validate_summary(args: Args): void {
  const summary = args.summary;
  if (!summary) {
    console.error("[validate-summary] ❌ --summary cannot be empty");
    process.exit(1);
  }

  const normalized = normalize_summary_for_plaintext(summary);
  const issues: string[] = [];

  const forbidden = check_summary_forbidden(normalized);
  if (forbidden) {
    for (const it of forbidden) {
      issues.push(`Forbidden term: "${it.matched}" — ${it.reason}; suggestion: ${it.suggestion}`);
    }
  }

  const _REQUIRED_SECTIONS: Array<[string, string]> = [
    ["📋[Requirement changes]", "Requirement changes"],
    ["🔍[Analysis scope]", "Analysis scope"],
    ["⚠️[Risks]", "Risks"],
    ["📌[Notes]", "Notes"],
    ["✅[Conclusion]", "Conclusion"],
  ];
  const present_sections: string[] = [];
  const missing_sections: string[] = [];
  for (const [marker, name] of _REQUIRED_SECTIONS) {
    if (normalized.includes(marker)) present_sections.push(name);
    else missing_sections.push(name);
  }

  if (missing_sections.length) {
    issues.push(`Missing section markers: ${missing_sections.join(", ")}`);
  }

  if (issues.length) {
    console.error("[validate-summary] ❌ summary format check failed:");
    for (const iss of issues) {
      console.error(`  - ${iss}`);
    }
    if (missing_sections.length) {
      console.error(
        "[validate-summary] Hint: must include 5 sections (📋[Requirement changes] 🔍[Analysis scope] ⚠️[Risks] 📌[Notes] ✅[Conclusion]), " +
          "Separate sections with 4 spaces; keep a flat plain-text layout.",
      );
    } else {
      console.error("[validate-summary] Hint: sections are complete; fix the wording issues above (no internal tool / rule names, no Markdown tables).");
    }
    _cli_result(1, {
      issues,
      charCount: normalized.length,
      presentSections: present_sections,
      missingSections: missing_sections,
    }, "summary_validation_failed");
    process.exit(1);
  } else {
    let layering_warning: string | null = null;
    if (
      normalized.includes("Pre-existing")
      && !normalized.includes("▎This change")
      && !normalized.includes("▎Pre-existing")
    ) {
      layering_warning = (
        "The summary mentions Pre-existing defects but Risks is not strongly layered. " +
        "In ⚠️[Risks], split into two sub-blocks ▎This change and ▎Pre-existing: " +
        "Expand This change fully first, then keep Pre-existing brief and mark it " +
        "'Pre-existing, unchanged in this change'. " +
        "The conclusion should judge release readiness only from This-change risks. See the summary-spec strong-layering rules."
      );
      console.error(`[validate-summary] ⚠️ Hint: ${layering_warning}`);
    }
    // The report renders ⚠️[Risks] as a table only when items are anchored with ▸(n) and
    // fields split by ｜; free prose collapses into a single row.
    let structure_warning: string | null = null;
    const risks_idx = normalized.indexOf("⚠️[Risks]");
    if (risks_idx >= 0) {
      const next = ["📌[Notes]", "🔔[Pending confirmation]", "✅[Conclusion]"]
        .map((m) => normalized.indexOf(m, risks_idx))
        .filter((i) => i > risks_idx);
      const risks_body = normalized.slice(risks_idx, next.length ? Math.min(...next) : undefined);
      const has_risk_marks = /[❗⚡💡]/.test(risks_body);
      if (has_risk_marks && !risks_body.includes("▸(")) {
        structure_warning = (
          "⚠️[Risks] lists risks without ▸(n) anchors / ｜ field separators; the report will show them as one row. " +
          "Use one item per risk: ▸(1)❗ Class#method line N｜Trigger conditions: ...｜Impact: ... (summary-spec.md)."
        );
        console.error(`[validate-summary] ⚠️ Hint: ${structure_warning}`);
      }
    }
    console.error(`[validate-summary] ✅ summary format OK (${normalized.length} chars, 5 sections present, no forbidden terms)`);
    const data: Record<string, any> = {
      charCount: normalized.length,
      sections: present_sections,
      normalizedPreview: normalized.slice(0, 200) + (normalized.length > 200 ? "..." : ""),
    };
    if (layering_warning) data.layeringWarning = layering_warning;
    if (structure_warning) data.structureWarning = structure_warning;
    _cli_result(0, data, "summary_validation_passed");
  }
}

export function cmd_update_summary(args: Args): void {
  const task_id = args.task_id;
  const summary = args.summary;

  if (!summary) {
    console.error("[update-summary] ❌ --summary cannot be empty");
    process.exit(1);
  }

  const result = update_detection_summary(task_id, summary);
  if ("_error" in result) {
    console.error(`[update-summary] ❌ ${result._error}`);
    process.exit(1);
  }
  if (result.code !== 0) {
    console.error(`[update-summary] ❌ API error: code=${result.code}, msg=${result.msg}`);
    process.exit(1);
  }
  console.error(`✅ Detection summary uploaded/updated (taskId=${task_id}, length: ${summary.length} chars)`);
  console.log(JSON.stringify(result, null, 2));
}

function _cv_tokenize(text: string): Set<string> {
  if (!text) return new Set();
  const tokens = new Set<string>();
  const lowered = text.toLowerCase();
  const identRe = /[a-zA-Z][a-zA-Z0-9_]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = identRe.exec(text)) !== null) {
    const ml = m[0].toLowerCase();
    tokens.add(ml);
    const partRe = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;
    let pm: RegExpExecArray | null;
    while ((pm = partRe.exec(m[0])) !== null) {
      if (pm[0].length > 2) tokens.add(pm[0].toLowerCase());
    }
  }
  const cnRe = /[\u4e00-\u9fa5]{2,}/g;
  let cm: RegExpExecArray | null;
  while ((cm = cnRe.exec(lowered)) !== null) {
    tokens.add(cm[0]);
  }
  return tokens;
}

function _set_intersect(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

export function cmd_cross_view_check(args: Args): void {
  const store = new ContentStore(args.task_id);

  const extracted_rules = store.get_extracted_rules();
  const test_cases = store.get_test_cases();
  const plan = store.load_plan_only().detectionPlan || [];
  const changed_methods = (store.load_meta_only().diff || {}).changedMethods || {};

  const has_doc = Boolean(extracted_rules && extracted_rules.length);
  const has_cases = Boolean(test_cases && test_cases.length);
  const has_code = Boolean((plan && plan.length) || Object.keys(changed_methods).length);

  const code_keywords = new Set<string>();
  for (const item of plan) {
    const cn = item.className || "";
    const mn = item.methodName || "";
    const simple_class = cn.includes("/") ? cn.split("/").pop()! : cn;
    if (simple_class) {
      for (const t of _cv_tokenize(simple_class)) code_keywords.add(t);
    }
    if (mn) {
      for (const t of _cv_tokenize(mn)) code_keywords.add(t);
    }
  }
  for (const [cn, methods] of Object.entries(changed_methods) as [string, any][]) {
    const simple_class = cn.includes("/") ? cn.split("/").pop()! : cn;
    if (simple_class) {
      for (const t of _cv_tokenize(simple_class)) code_keywords.add(t);
    }
    for (const m of methods as any[]) {
      const name = changed_method_name(m);
      if (name) {
        for (const t of _cv_tokenize(name)) code_keywords.add(t);
      }
    }
  }

  const case_keywords = new Set<string>();
  const case_titles: string[] = [];
  for (const caseObj of test_cases) {
    if (caseObj.fetchStatus === "failed") continue;
    const title = (caseObj.title || "").trim();
    case_titles.push(title);
    for (const text of [title, caseObj.steps || "", caseObj.expectedResult || "", caseObj.preCondition || ""]) {
      for (const t of _cv_tokenize(text)) case_keywords.add(t);
    }
  }

  const rule_texts: string[] = [];
  for (const rule of extracted_rules) {
    if (rule && typeof rule === "object" && !Array.isArray(rule)) {
      rule_texts.push(rule.text ?? rule.description ?? String(rule));
    } else {
      rule_texts.push(String(rule));
    }
  }

  let findings: Record<string, any>[] = [];
  const directions_executed: string[] = [];

  if (has_cases && has_code) {
    directions_executed.push("case_to_code");
    for (let i = 0; i < test_cases.length; i++) {
      const caseObj = test_cases[i];
      if (caseObj.fetchStatus === "failed") continue;
      const title = (caseObj.title || "").trim();
      const case_words = _cv_tokenize(title);
      if (case_words.size && !_set_intersect(case_words, code_keywords)) {
        findings.push({
          phase: "analysis",
          category: "cross-view",
          direction: "case_to_code",
          status: "open",
          actionRequired: "confirm_or_dismiss",
          text: `Test case "${title.slice(0, 60)}" has no matching implementation in the changed code; it may be missing or out of this change's scope`,
          source: `test-case-${caseObj.id ?? i}`,
        });
      }
    }
  }

  if (has_doc && has_cases) {
    directions_executed.push("doc_to_case");
    for (const rule_text of rule_texts) {
      const rule_words = _cv_tokenize(rule_text);
      if (rule_words.size && !_set_intersect(rule_words, case_keywords)) {
        findings.push({
          phase: "analysis",
          category: "cross-view",
          direction: "doc_to_case",
          status: "open",
          actionRequired: "suggest_add_case",
          text: `Requirement rule "${rule_text.slice(0, 60)}" is not covered by an existing test case; consider adding one`,
          source: "doc-rule",
        });
      }
    }
  }

  if (has_doc && has_code) {
    directions_executed.push("doc_to_code");
    for (const rule_text of rule_texts) {
      const rule_words = _cv_tokenize(rule_text);
      if (rule_words.size && !_set_intersect(rule_words, code_keywords)) {
        findings.push({
          phase: "analysis",
          category: "cross-view",
          direction: "doc_to_code",
          status: "open",
          actionRequired: "confirm_missing_impl",
          text: `Requirement rule "${rule_text.slice(0, 60)}" has no matching implementation in the changed code; suspected missing work`,
          source: "doc-rule",
        });
      }
    }
  }

  if (has_code && (has_cases || has_doc)) {
    directions_executed.push("code_to_case_doc");
    if (!has_cases) {
      console.error("[cross-view] ℹ️  No test-case data; code_to_case_doc only checks requirement-rule coverage (case side auto-passes)");
    }
    for (const item of plan.slice(0, 50)) {
      const cn = item.className || "";
      const mn = item.methodName || "";
      const simple_class = (cn.includes("/") ? cn.split("/").pop()! : cn).toLowerCase();
      const method_lower = mn.toLowerCase();
      let case_covers = false;
      if (has_cases && (simple_class || method_lower)) {
        for (const kw of [simple_class, method_lower]) {
          if (kw && case_keywords.has(kw)) {
            case_covers = true;
            break;
          }
        }
      }
      let doc_covers = false;
      if (has_doc && (simple_class || method_lower)) {
        for (const rt of rule_texts) {
          const rt_lower = rt.toLowerCase();
          if ((simple_class && rt_lower.includes(simple_class)) || (method_lower && rt_lower.includes(method_lower))) {
            doc_covers = true;
            break;
          }
        }
      }
      const is_orphan = has_cases ? (!case_covers && !doc_covers) : !doc_covers;
      if (is_orphan) {
        const label = (simple_class ? simple_class + "#" + mn : mn).slice(0, 60);
        const orphan_text = has_cases
          ? `Changed method "${label}" has neither a test case nor a requirement-rule link; it may be a helper or a missing test`
          : `Changed method "${label}" has no requirement-rule link (no test-case data); it may be a helper`;
        findings.push({
          phase: "analysis",
          category: "cross-view",
          direction: "code_to_case_doc",
          status: "open",
          actionRequired: "review_orphan_change",
          text: orphan_text,
          source: "plan-item",
        });
      }
    }
  }

  const seen = new Set<string>();
  const deduped: Record<string, any>[] = [];
  for (const f of findings) {
    const key = `${f.direction}\0${String(f.text).slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }
  findings = deduped;

  let written_count = 0;
  for (const f of findings) {
    try {
      store.add_finding(f);
      written_count += 1;
    } catch {
      // pass
    }
  }

  if (written_count > 0) {
    _require_save(store);
  }

  const candidate_findings = findings.filter((f) => f.actionRequired !== "review_orphan_change");
  const orphan_count = findings.length - candidate_findings.length;

  const result: Record<string, any> = {
    directionsExecuted: directions_executed,
    totalFindings: findings.length,
    writtenCount: written_count,
    role: "first_pass",
    blocking: false,
    // Kept true so older agents that still treat this field as a Phase 3 gate do not loop.
    gate_passed: true,
    firstPassComplete: true,
    needsSemanticVerify: candidate_findings.length > 0,
    candidateCount: candidate_findings.length,
    orphanCount: orphan_count,
    criticalCount: candidate_findings.length,
    byDirection: {},
    findings: findings.slice(0, 30),
  };
  for (const d of directions_executed) {
    const d_findings = findings.filter((f) => f.direction === d);
    result.byDirection[d] = { count: d_findings.length };
  }

  if (!directions_executed.length) {
    _cli_success(
      { skipped: true, reason: "Not enough data (need code changes plus test cases or document rules)" },
      "Cross-view check skipped: not enough data",
    );
    return;
  }

  const msg = (
    `Cross-view first pass finished: ran ${directions_executed.length} direction(s), ` +
    `recorded ${findings.length} keyword-match candidate(s)` +
    ` (${candidate_findings.length} to semantically verify; ${orphan_count} orphan-method notes). ` +
    "This is not a close gate — do not block Phase 3, and do not put keyword misses in the user summary " +
    "until you confirm they are real gaps (synonyms and path-style class names false-positive easily)."
  );
  _cli_success(result, msg);
}

export function cmd_check_req_coverage(args: Args): void {
  const store = new ContentStore(args.task_id);

  const extracted_rules = store.get_extracted_rules();
  if (!extracted_rules || !extracted_rules.length) {
    _cli_success(
      { skipped: true, reason: "No extractedRules (no documents, or business rules were not extracted)" },
      "Requirement coverage check skipped: no business-rule data",
    );
    return;
  }

  const plan = store.load_plan_only().detectionPlan || [];
  const changed_methods = (store.load_meta_only().diff || {}).changedMethods || {};

  const change_scope = new Set<string>();
  for (const item of plan) {
    const cn = item.className || "";
    const mn = item.methodName || "";
    const simple_class = cn.includes("/") ? cn.split("/").pop()! : cn;
    change_scope.add(simple_class.toLowerCase());
    change_scope.add(mn.toLowerCase());
  }
  for (const [cn, methods] of Object.entries(changed_methods) as [string, any][]) {
    const simple_class = cn.includes("/") ? cn.split("/").pop()! : cn;
    change_scope.add(simple_class.toLowerCase());
    for (const m of methods as any[]) {
      const name = changed_method_name(m);
      if (name) change_scope.add(name.toLowerCase());
    }
  }

  const covered: any[] = [];
  const uncovered: any[] = [];
  for (const rule of extracted_rules) {
    let rule_text = "";
    if (rule && typeof rule === "object" && !Array.isArray(rule)) {
      rule_text = rule.text ?? rule.description ?? String(rule);
    } else {
      rule_text = String(rule);
    }

    // Match on the rule text plus its "Related code file/method" column; strip code
    // punctuation so `findPage(userId,` still yields the token findpage.
    const related = rule && typeof rule === "object" ? String(rule.related || "") : "";
    const rule_words = new Set(
      `${rule_text} ${related}`
        .replace(/[.#`"'(),:;<>[\]{}—–*|]/g, " ")
        .split(/\s+/)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length > 2),
    );
    let has_overlap = false;
    for (const w of rule_words) {
      if (change_scope.has(w)) {
        has_overlap = true;
        break;
      }
    }

    const entry = { rule: rule_text, matchedInChangeScope: has_overlap };
    if (has_overlap) covered.push(entry);
    else uncovered.push(entry);
  }

  for (const item of uncovered) {
    const finding = {
      phase: "analysis",
      category: "gap",
      text: `Requirement rule has no matching implementation in the changed code: ${String(item.rule).slice(0, 100)}`,
      source: "req-coverage-check",
    };
    try {
      store.add_finding(finding);
    } catch {
      // pass
    }
  }

  if (uncovered.length) {
    _require_save(store);
  }

  const test_cases = store.get_test_cases();
  let case_coverage_result: Record<string, any> | null = null;
  const case_uncovered_rules: any[] = [];

  if (test_cases.length && extracted_rules.length) {
    const case_text_corpus = new Set<string>();
    for (const caseObj of test_cases) {
      if (caseObj.fetchStatus === "failed") continue;
      const title = (caseObj.title || "").toLowerCase();
      const steps = (caseObj.steps || "").toLowerCase();
      const expected = (caseObj.expectedResult || "").toLowerCase();
      const pre_cond = (caseObj.preCondition || "").toLowerCase();
      for (const text of [title, steps, expected, pre_cond]) {
        const words = text.replace(/\./g, " ").replace(/#/g, " ").replace(/,/g, " ").replace(/，/g, " ").split(/\s+/).filter((w: string) => w.length > 2);
        for (const w of words) case_text_corpus.add(w);
      }
    }

    const case_covered: any[] = [];
    for (const rule of extracted_rules) {
      let rule_text = "";
      if (rule && typeof rule === "object" && !Array.isArray(rule)) {
        rule_text = rule.text ?? rule.description ?? String(rule);
      } else {
        rule_text = String(rule);
      }

      const rule_words = new Set(
        rule_text.replace(/\./g, " ").replace(/#/g, " ").split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length > 2),
      );
      let has_cases_overlap = false;
      for (const w of rule_words) {
        if (case_text_corpus.has(w)) {
          has_cases_overlap = true;
          break;
        }
      }

      if (has_cases_overlap) {
        case_covered.push({ rule: rule_text, caseCovered: true });
      } else {
        case_uncovered_rules.push({ rule: rule_text, caseCovered: false });
      }
    }

    for (const item of case_uncovered_rules) {
      const finding = {
        phase: "analysis",
        category: "gap",
        text: `Requirement rule is not covered by a test case; consider adding one: ${String(item.rule).slice(0, 100)}`,
        source: "case-coverage-check",
      };
      try {
        store.add_finding(finding);
      } catch {
        // pass
      }
    }

    case_coverage_result = {
      totalRules: extracted_rules.length,
      caseCoveredCount: case_covered.length,
      caseUncoveredCount: case_uncovered_rules.length,
      caseCoverageRate: extracted_rules.length ? `${Math.round(case_covered.length / extracted_rules.length * 100)}%` : "N/A",
      caseUncoveredRules: case_uncovered_rules.slice(0, 20),
      caseCount: test_cases.filter((c: any) => c.fetchStatus !== "failed").length,
    };

    if (case_uncovered_rules.length) {
      _require_save(store);
    }
  }

  const result: Record<string, any> = {
    totalRules: extracted_rules.length,
    coveredCount: covered.length,
    uncoveredCount: uncovered.length,
    coverageRate: extracted_rules.length ? `${Math.round(covered.length / extracted_rules.length * 100)}%` : "N/A",
    uncoveredRules: uncovered.slice(0, 20),
    coveredRules: covered.slice(0, 10),
  };

  if (case_coverage_result) {
    result.caseCoverage = case_coverage_result;
  }

  const msg_parts: string[] = [];
  if (uncovered.length) {
    msg_parts.push(
      `Requirement coverage check finished: of ${extracted_rules.length} rules, ` +
        `${uncovered.length} have no matching implementation in the changed code and were recorded as findings.` +
        "The agent should confirm each uncoveredRules item and decide whether it is suspected missing work.",
    );
  } else {
    msg_parts.push(
      `Requirement coverage check passed: all ${extracted_rules.length} rules have a match in the change scope.`,
    );
  }

  if (case_uncovered_rules.length) {
    msg_parts.push(
      `Test-case coverage check: of ${extracted_rules.length} rules, ` +
        `${case_uncovered_rules.length} are not covered by existing test cases, ` +
        "Consider adding cases. Recorded as a risk hint.",
    );
  } else if (test_cases.length && extracted_rules.length) {
    msg_parts.push("Test-case coverage check passed: every document rule has a matching test case.");
  }

  const combined_msg = msg_parts.join(" | ");

  if (uncovered.length || case_uncovered_rules.length) {
    _cli_result(0, result, combined_msg);
  } else {
    _cli_success(result, combined_msg);
  }
}

export function cmd_check_analysis_quality(args: Args): void {
  const store = new ContentStore(args.task_id);
  const plan = store.load_plan_only().detectionPlan || [];
  const wb_shard = store.load_writebacks_only();
  const writebacks = wb_shard.processWritebacks || [];
  const context_reads = wb_shard.contextReads || [];

  const issues: any[] = [];

  const wb_map = new Map<string, any>();
  for (const wb of writebacks) {
    const key = `${wb.className}\0${wb.methodName}\0${wb.strategyCode}`;
    wb_map.set(key, wb);
  }

  for (const item of plan) {
    const class_name = item.className || "";
    const method_name = item.methodName || "";
    const strategy_code = item.strategyCode;
    const min_level = item.minDetectLevel || "L1";

    const key = `${class_name}\0${method_name}\0${strategy_code}`;
    const wb = wb_map.get(key);
    if (!wb) continue;

    if (wb.bugStatus !== 2) continue;

    const detect_tier = item.detectTier || wb.detectTier || "T3";
    const trivial = Boolean(item.trivial);
    if ([4, 6, 11].includes(strategy_code) && !trivial && detect_tier !== "T3") {
      const min_reads = detect_tier === "T2" ? 1 : 2;
      const ctx_files = new Set(
        context_reads.filter((r: any) => r.className === class_name).map((r: any) => r.filePath),
      );
      if (ctx_files.size < min_reads) {
        issues.push({
          className: class_name,
          methodName: method_name,
          strategyCode: strategy_code,
          issue: `strategy=11 detectTier=${detect_tier} but too few context-read files`,
          expected: `≥${min_reads} distinct file(s) (T1≥2 / T2≥1 / T3 and trivial-filter exempt)`,
          actual: `${ctx_files.size} file(s)`,
          severity: "BLOCK",
        });
      }
    }

    if (["L2+TC", "L2"].includes(min_level) && strategy_code !== 8) {
      const ctx_files = new Set(
        context_reads.filter((r: any) => r.className === class_name).map((r: any) => r.filePath),
      );
      if (ctx_files.size < 1) {
        issues.push({
          className: class_name,
          methodName: method_name,
          strategyCode: strategy_code,
          issue: `minDetectLevel=${min_level} but there is no context-read record`,
          expected: "Read at least 1 related file (caller / dependency / config)",
          actual: "0 context reads",
          severity: "WARN",
        });
      }
    }
  }

  const block_count = issues.filter((i) => i.severity === "BLOCK").length;
  const warn_count = issues.filter((i) => i.severity === "WARN").length;
  const passed = block_count === 0;

  const result = {
    passed,
    blockCount: block_count,
    warnCount: warn_count,
    totalChecked: plan.filter((i: any) =>
      wb_map.has(`${i.className}\0${i.methodName}\0${i.strategyCode}`),
    ).length,
    issues,
  };

  if (!passed) {
    _cli_result(1, result,
      `Quality gate failed: ${block_count} blocker(s), ${warn_count} warning(s).` +
        "Add context reads and write back again.");
  } else {
    _cli_success(result, `Quality gate passed (${warn_count} warning(s), not blocking).`);
  }
}

export function cmd_show_local_progress(args: Args): void {
  const task_id = args.task_id;
  const result = get_local_progress(task_id);
  result.stateFile = _get_local_state_path(task_id);

  const msg_parts: string[] = [];
  if ("_error" in result) {
    msg_parts.push(result._error);
  } else {
    const summary = result.summary || {};
    const total_written = Object.values(summary).reduce((acc: number, v: any) => acc + (v.total || 0), 0);
    const total_has_bug = Object.values(summary).reduce((acc: number, v: any) => acc + (v.hasBug || 0), 0);
    msg_parts.push(`Locally recorded: ${total_written} items (Suspected defect: ${total_has_bug} | no defect: ${total_written - total_has_bug})`);
  }
  if ("_warning" in result) {
    msg_parts.push(result._warning);
  }

  _cli_result(
    !("_error" in result) ? 0 : 1,
    result,
    msg_parts.join(" | "),
  );
}

const _TASK_DIR_KEEP_FILES = new Set([
  "meta.json", "static.json", "context.json", "test_cases.json",
  "plan.json", "writebacks.json", "findings.json",
  "local_state.json", "local_state.json.lock", "DOC_SUMMARY.md",
]);

const _RESERVED_DATA_DIRS = new Set(["platform", "issues", "repos", "_tmp"]);

function _is_temp_artifact(name: string): boolean {
  if (_TASK_DIR_KEEP_FILES.has(name)) return false;
  if (name.endsWith(".bak") || name.includes(".bak.")) return true;
  if (name.endsWith(".py") || name.endsWith(".pyc") || name.endsWith(".log") || name.endsWith(".err")) return true;
  return true;
}

export function cmd_cleanup_stale_data(args: Args): void {
  const max_age_hours = args.max_age_hours || 48;
  const dry_run = args.dry_run || false;
  const scrub_only = args.scrub_only || false;

  // .bak scrub covers the skill root and scripts/ (where code lives now).
  const skill_dir = SKILL_ROOT;
  const base_dir = content_base_dir();

  if (!existsSync(base_dir) || !statSync(base_dir).isDirectory()) {
    _cli_result(0, { cleaned: [], skipped: [], scrubbed: [] }, "Data directory does not exist; nothing to clean");
    return;
  }

  const now = Date.now() / 1000;
  const cleaned: any[] = [];
  const skipped: any[] = [];
  const scrubbed: any[] = [];
  const errors: any[] = [];

  function _rm_file(path: string, kind: string, owner: string): void {
    const rel = relative(base_dir, path);
    if (dry_run) {
      scrubbed.push({ file: rel, kind, owner, action: "will_delete" });
      return;
    }
    try {
      unlinkSync(path);
      scrubbed.push({ file: rel, kind, owner, action: "deleted" });
    } catch (e: any) {
      errors.push({ file: rel, error: String(e) });
    }
  }

  const invalid_dirs_cleaned: any[] = [];
  for (const entry of readdirSync(base_dir).sort()) {
    const entry_path = join(base_dir, entry);
    try {
      if (!statSync(entry_path).isDirectory()) continue;
    } catch {
      continue;
    }
    // Reserved non-task directories under the data dir: never treat them as stray.
    //   platform/  local platform provider (tasks, batches, ranks, reports)
    //   issues/    runtime issue store written by mark-bug / create-issue
    //   repos/     git clones made by clone-and-diff (aged out separately below)
    //   _tmp/      scratch, removed wholesale below
    if (_RESERVED_DATA_DIRS.has(entry)) continue;
    const is_valid_task_dir = /^\d+$/.test(entry) && parseInt(entry, 10) > 0;
    if (is_valid_task_dir) continue;
    if (dry_run) {
      invalid_dirs_cleaned.push({ dir: entry, action: "will_delete" });
    } else {
      try {
        rmSync(entry_path, { recursive: true, force: true });
        invalid_dirs_cleaned.push({ dir: entry, action: "deleted" });
      } catch (e: any) {
        errors.push({ dir: entry, error: String(e) });
      }
    }
  }

  for (const entry of readdirSync(base_dir).sort()) {
    const entry_path = join(base_dir, entry);

    try {
      if (!statSync(entry_path).isDirectory() || !/^\d+$/.test(entry) || parseInt(entry, 10) <= 0) {
        continue;
      }
    } catch {
      continue;
    }

    let age_hours: number;
    try {
      let latest_mtime = statSync(entry_path).mtimeMs / 1000;
      function walk(dir: string): void {
        let ents: string[] = [];
        try {
          ents = readdirSync(dir);
        } catch {
          return;
        }
        for (const f of ents) {
          const p = join(dir, f);
          try {
            const st = statSync(p);
            if (st.isDirectory()) walk(p);
            else if (st.mtimeMs / 1000 > latest_mtime) latest_mtime = st.mtimeMs / 1000;
          } catch {
            // pass
          }
        }
      }
      walk(entry_path);
      age_hours = (now - latest_mtime) / 3600;
    } catch (e: any) {
      errors.push({ taskId: entry, error: String(e) });
      continue;
    }

    if (age_hours >= max_age_hours && !scrub_only) {
      if (dry_run) {
        cleaned.push({ taskId: parseInt(entry, 10), ageHours: Math.round(age_hours * 10) / 10, action: "will_delete" });
      } else {
        try {
          rmSync(entry_path, { recursive: true, force: true });
          cleaned.push({ taskId: parseInt(entry, 10), ageHours: Math.round(age_hours * 10) / 10, action: "deleted" });
        } catch (e: any) {
          errors.push({ taskId: entry, error: String(e) });
        }
      }
    } else {
      skipped.push({ taskId: parseInt(entry, 10), ageHours: Math.round(age_hours * 10) / 10 });
      try {
        for (const fname of readdirSync(entry_path)) {
          const fpath = join(entry_path, fname);
          try {
            if (statSync(fpath).isFile() && _is_temp_artifact(fname)) {
              _rm_file(fpath, "task-temp", entry);
            }
          } catch {
            // skip
          }
        }
      } catch (e: any) {
        errors.push({ taskId: entry, error: String(e) });
      }
    }
  }

  const tmp_dir = join(base_dir, "_tmp");
  if (existsSync(tmp_dir) && statSync(tmp_dir).isDirectory()) {
    try {
      let tmp_count = 0;
      function countWalk(dir: string): void {
        let ents: string[] = [];
        try {
          ents = readdirSync(dir);
        } catch {
          return;
        }
        for (const f of ents) {
          const p = join(dir, f);
          try {
            if (statSync(p).isDirectory()) countWalk(p);
            else tmp_count += 1;
          } catch {
            // skip
          }
        }
      }
      countWalk(tmp_dir);
      if (dry_run) {
        scrubbed.push({ file: "_tmp/", kind: "tmp-dir", owner: "_tmp", fileCount: tmp_count, action: "will_delete" });
      } else {
        rmSync(tmp_dir, { recursive: true, force: true });
        scrubbed.push({ file: "_tmp/", kind: "tmp-dir", owner: "_tmp", fileCount: tmp_count, action: "deleted" });
      }
    } catch (e: any) {
      errors.push({ file: "_tmp/", error: String(e) });
    }
  }

  // Git clones under repos/: age out by the last time git touched them.
  const repos_cleaned: any[] = [];
  const repos_dir = repo_clone_base_dir();
  if (!scrub_only && existsSync(repos_dir) && statSync(repos_dir).isDirectory()) {
    for (const entry of readdirSync(repos_dir).sort()) {
      const repo_path = join(repos_dir, entry);
      try {
        if (!statSync(repo_path).isDirectory()) continue;
        let latest = statSync(repo_path).mtimeMs / 1000;
        for (const marker of ["HEAD", "FETCH_HEAD", "ORIG_HEAD", "index"]) {
          try {
            const t = statSync(join(repo_path, ".git", marker)).mtimeMs / 1000;
            if (t > latest) latest = t;
          } catch {
            // marker absent
          }
        }
        const age_hours = (now - latest) / 3600;
        if (age_hours < max_age_hours) continue;
        if (dry_run) {
          repos_cleaned.push({ repo: entry, ageHours: Math.round(age_hours * 10) / 10, action: "will_delete" });
        } else {
          rmSync(repo_path, { recursive: true, force: true });
          repos_cleaned.push({ repo: entry, ageHours: Math.round(age_hours * 10) / 10, action: "deleted" });
        }
      } catch (e: any) {
        errors.push({ repo: entry, error: String(e) });
      }
    }
  }

  for (const entry of readdirSync(base_dir)) {
    const entry_path = join(base_dir, entry);
    try {
      if (statSync(entry_path).isFile() && _is_temp_artifact(entry)) {
        _rm_file(entry_path, "data-root-stray", "data");
      }
    } catch {
      // skip
    }
  }

  try {
    for (const fname of readdirSync(skill_dir)) {
      const fpath = join(skill_dir, fname);
      try {
        if (statSync(fpath).isFile() && (fname.endsWith(".bak") || fname.includes(".bak."))) {
          const rel = relative(skill_dir, fpath);
          if (dry_run) {
            scrubbed.push({ file: rel, kind: "code-bak", owner: "skill", action: "will_delete" });
          } else {
            try {
              unlinkSync(fpath);
              scrubbed.push({ file: rel, kind: "code-bak", owner: "skill", action: "deleted" });
            } catch (e: any) {
              errors.push({ file: rel, error: String(e) });
            }
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // pass
  }

  const result_data: Record<string, any> = {
    cleaned,
    skipped,
    scrubbed,
    scrubbedCount: scrubbed.length,
    invalidDirsCleaned: invalid_dirs_cleaned,
    reposCleaned: repos_cleaned,
    maxAgeHours: max_age_hours,
    dryRun: dry_run,
    scrubOnly: scrub_only,
  };
  if (errors.length) result_data.errors = errors;

  const action_word = dry_run ? "will clean" : "cleaned";
  const invalid_msg = (invalid_dirs_cleaned.length
    ? `, ${action_word} ${invalid_dirs_cleaned.length} invalid director(ies)`
    : "") + (repos_cleaned.length ? `, ${action_word} ${repos_cleaned.length} stale git clone(s)` : "");
  const dir_msg = scrub_only
    ? " (scrub-only mode; do not delete task directories)"
    : `${action_word} ${cleaned.length} stale director(ies) (threshold ${max_age_hours}h)`;
  _cli_result(0, result_data,
    `${dir_msg}${invalid_msg}, ${action_word} ${scrubbed.length} temp artifact(s), ` +
      `kept ${skipped.length} active director(ies)` +
      (errors.length ? `, ${errors.length} error(s)` : ""));
}

export function cmd_finalize_all(args: Args): void {
  let batch_ids: number[];
  if (!args.batch_ids) {
    const git_map: any = get_all_batch_gits(args.task_id);
    const raw_keys = Array.isArray(git_map)
      ? git_map.map((e: any) => e.batchId)
      : Object.keys(git_map || {});
    batch_ids = raw_keys.filter((bid: any) => /^\d+$/.test(String(bid))).map((bid: any) => parseInt(String(bid), 10));
    if (!batch_ids.length) {
      // Fallback: platform task.batchIds (submit-git path never wrote pending_cache)
      try {
        const status = get_task_status(args.task_id);
        const from_task = (status?.data?.batchIds || []).map((b: any) => parseInt(String(b), 10)).filter((n: number) => Number.isFinite(n) && n > 0);
        if (from_task.length) {
          batch_ids = from_task;
          console.error(`[finalize-all] 🔧 Auto-loaded ${batch_ids.length} batchId(s) from task status: ${batch_ids}`);
        }
      } catch {
        // ignore
      }
    } else {
      console.error(`[finalize-all] 🔧 Auto-loaded ${batch_ids.length} batchId(s) from pending_cache: ${batch_ids}`);
    }
    if (!batch_ids.length) {
      console.log(JSON.stringify({ code: -1, msg: "--batch-ids is empty and no batchId found in pending_cache or task status (pass --batch-ids or run get-pending first)" }));
      process.exit(1);
    }
  } else {
    batch_ids = args.batch_ids.split(",").map((x: string) => x.trim()).filter(Boolean).map((x: string) => parseInt(x, 10));
    if (!batch_ids.length) {
      console.log(JSON.stringify({ code: -1, msg: "--batch-ids cannot be empty" }));
      process.exit(1);
    }
  }

  // Same contract as complete-task: the report needs a summary. finalize-all accepts it
  // inline so Phase 3 really is one command; without it the task completes but the
  // summary must still be uploaded via update-summary.
  const summary: string | null = args.summary || null;
  if (summary) {
    const normalized = normalize_summary_for_plaintext(summary);
    const forbidden = check_summary_forbidden(normalized);
    if (forbidden && forbidden.length) {
      console.log(JSON.stringify({ code: -1, msg: "summary_format_invalid", data: { issues: forbidden } }, null, 2));
      process.exit(1);
    }
  } else {
    console.error("[finalize-all] ⚠️  no --summary/--summary-file given; the task will complete without a detection summary. Run update-summary afterwards.");
  }

  const result = finalize_all(args.task_id, batch_ids, summary);
  console.log(JSON.stringify(result, null, 2));
  if (result.code !== 0) process.exit(1);
}
