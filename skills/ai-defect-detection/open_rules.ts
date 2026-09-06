/**
 * Rule utility module.
 *
 * Provides rule grouping, strategy matching, and exclusion-rule association.
 * - prepare_rules: group by category + strategyId
 * - get_rules_for_ast_strategy: get rules for AST strategy (strategy=8)
 * - get_rules_for_agent_strategy: get rules for non-AST strategies
 * - attach_exclusion_context: attach exclusion-rule context to AST findings
 */

function _strategy_matches(rule: Record<string, any>, strategy_code: number): boolean {
  let strategy_id_str: any = rule.strategyId || "";
  if (typeof strategy_id_str === "number") {
    return strategy_id_str === strategy_code;
  }
  for (let sid_str of String(strategy_id_str).split(",")) {
    sid_str = sid_str.trim();
    if (/^\d+$/.test(sid_str) && parseInt(sid_str, 10) === strategy_code) {
      return true;
    }
  }
  return false;
}

export function prepare_rules(rules_list: Record<string, any>[]): Record<string, any> {
  const by_category: Record<string, Record<string, any>[]> = {};
  const by_strategy: Record<string, Record<string, any>[]> = {};
  const exclusion_index: Record<string, Record<string, any>[]> = {};

  for (const rule of rules_list) {
    const cat = rule.category;
    if (cat !== undefined && cat !== null) {
      if (!by_category[cat]) by_category[cat] = [];
      by_category[cat].push(rule);
    }

    if (cat === 3) {
      const parent_id = rule.parentRuleId;
      if (parent_id) {
        const key = parent_id as any;
        if (!exclusion_index[key]) exclusion_index[key] = [];
        exclusion_index[key].push(rule);
      }
    }

    let strategy_id_str: any = rule.strategyId || "";
    if (typeof strategy_id_str === "number") {
      strategy_id_str = String(strategy_id_str);
    }
    for (let sid_str of String(strategy_id_str).split(",")) {
      sid_str = sid_str.trim();
      if (/^\d+$/.test(sid_str)) {
        const sid = parseInt(sid_str, 10);
        if (!by_strategy[sid]) by_strategy[sid] = [];
        by_strategy[sid].push(rule);
      }
    }
  }

  // Match Python f-string brace-escaping: the comprehensions are printed literally.
  console.error(
    `[open_rules] rule grouping complete: ` +
      `category={k: len(v) for k, v in by_category.items()}, ` +
      `strategy={k: len(v) for k, v in by_strategy.items()}, ` +
      `exclusion_index=${Object.keys(exclusion_index).length} entries`,
  );

  return {
    by_category,
    by_strategy,
    exclusion_index,
    all_rules: rules_list,
  };
}

export function get_rules_for_ast_strategy(
  grouped: Record<string, any>,
  strategy_code = 8,
): Record<string, any> {
  const by_category = grouped.by_category || {};
  let scan_rules = (by_category[1] || []).filter((r: Record<string, any>) =>
    _strategy_matches(r, strategy_code),
  );
  if (!scan_rules.length) {
    scan_rules = by_category[1] || [];
  }
  const exclusion_rules = by_category[3] || [];
  return {
    scan_rules,
    exclusion_rules,
  };
}

export function get_rules_for_agent_strategy(
  grouped: Record<string, any>,
  strategy_code: number,
): Record<string, any> {
  const by_category = grouped.by_category || {};
  const custom_rules = (by_category[2] || []).filter((r: Record<string, any>) =>
    _strategy_matches(r, strategy_code),
  );
  const exclusion_rules = by_category[3] || [];
  const system_rules = by_category[4] || [];
  return {
    custom_rules,
    exclusion_rules,
    system_rules,
  };
}

export function attach_exclusion_context(
  findings: Record<string, any>[],
  exclusion_index: Record<string, any>,
  _rules_json: any = null,
): Record<string, any>[] {
  if (!exclusion_index || !Object.keys(exclusion_index).length) {
    for (const f of findings) {
      f.hasExclusionRules = false;
      f.exclusionRules = [];
    }
    return findings;
  }

  for (const finding of findings) {
    const rule_id = finding.ruleId || finding.check_id || "";
    let matched_exclusions: Record<string, any>[] = [];

    if (typeof rule_id === "number") {
      matched_exclusions = exclusion_index[rule_id] || [];
    } else if (typeof rule_id === "string") {
      const parts = rule_id.split("-");
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (/^\d+$/.test(part)) {
          matched_exclusions = exclusion_index[parseInt(part, 10)] || [];
          if (matched_exclusions.length) break;
        }
      }
      if (!matched_exclusions.length) {
        matched_exclusions = exclusion_index[rule_id] || [];
      }
    }

    finding.hasExclusionRules = matched_exclusions.length > 0;
    finding.exclusionRules = matched_exclusions.map((exc) => ({
      id: exc.id,
      name: exc.name || exc.ruleName || "",
      exclusionDesc: exc.exclusionDesc || exc.description || "",
      parentRuleId: exc.parentRuleId,
    }));
  }

  return findings;
}
