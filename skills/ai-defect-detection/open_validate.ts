/**
 * Validation module.
 *
 * Covers updateProcess pre-checks (Hard rules 0-22 + hollow checks) and report content format validation.
 */

import { has_code_been_read, has_repo_been_cloned } from "./open_state.ts";

const _RULE_CODE_PATTERN = /RULE-[A-Z]+-\d{5,}/;
const _STRATEGY_LEAK_PATTERN = /(?:strategy|strategyCode)\s*[=:]\s*\d+/i;
const _INTERNAL_ID_PATTERN = /(?:processId|rankId|batchId|parentBatchId)\s*[=:]\s*\d+/i;

const _CODE_READ_GATE_ENFORCE = true;

export const BATCH_HOLLOW_CHECK_MIN_SIZE = 20;
export const BATCH_HOLLOW_NO_BUG_RATIO_WARN = 0.95;
export const BATCH_HOLLOW_SIMILARITY_THRESHOLD = 0.7;
export const BATCH_HOLLOW_CONSECUTIVE_LIMIT = 5;

let _cached_tag_ids: Set<any> | null = null;
let _cached_tag_map: Record<string, any> | null = null;

function _py_bool(v: any): boolean {
  if (v == null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set || v instanceof Map) return v.size > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function _in(val: any, ...vals: any[]): boolean {
  return vals.some((v) => v === val);
}

function _s(v: any): string {
  if (!_py_bool(v)) return "";
  return String(v).trim();
}

/** T3 is exempt; T2 needs ≥1; T1 needs ≥2 (light mode lowers T1 to ≥1). */
export function context_read_min(detect_tier: any, is_light = false): number | null {
  if (detect_tier === "T3") return null;
  if (detect_tier === "T2") return 1;
  return is_light ? 1 : 2;
}

function _py_list_repr(arr: any[]): string {
  return `[${arr.map((x) => (typeof x === "string" ? `'${x}'` : String(x))).join(", ")}]`;
}

function _pct0(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function _pct1(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function _round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function _to_int(v: any): number {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) throw new Error("ValueError");
  return parseInt(s, 10);
}

function _re_escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function set_valid_tag_ids(tag_ids: any): void {
  _cached_tag_ids = tag_ids instanceof Set ? tag_ids : new Set(tag_ids);
}

export function get_valid_tag_ids(): Set<any> | null {
  return _cached_tag_ids;
}

export function set_valid_tag_map(tag_map: Record<string, any> | Map<any, any>): void {
  if (tag_map instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of tag_map) obj[k as any] = v;
    _cached_tag_map = obj;
  } else {
    _cached_tag_map = tag_map;
  }
}

export function get_valid_tag_map(): Record<string, any> | null {
  return _cached_tag_map;
}

export function validate_update_process_all(
  request_body: Record<string, any>,
  context_task_id: any = null,
  mode = "strict",
): string[] {
  const errors: string[] = [];

  const thinking = _s(request_body.thinking);
  if (!thinking) {
    errors.push("Hard rule0: thinking cannot be empty; always record the AI analysis, with or without a defect.");
  }

  const process_steps = request_body.processSteps;
  if (!_py_bool(process_steps)) {
    errors.push("Hard rule1: processSteps cannot be empty; record the full detection steps.");
  }

  const bug_status = request_body.bugStatus;
  const strategy_code = request_body.strategyCode;
  const has_defect = _in(bug_status, 6, 7);

  if (has_defect && _in(strategy_code, 8, 9) && !_py_bool(request_body.ruleId)) {
    errors.push("Hard rule2: when an AST/custom-rule strategy has a defect, ruleId cannot be empty.");
  }

  if (has_defect && !_py_bool(request_body.tagId)) {
    errors.push("Hard rule3: when bugStatus=6/7 (has a defect), tagId cannot be empty.");
  }

  const file_codes = request_body.fileCodes;
  if (!_py_bool(file_codes)) {
    errors.push("Hard rule4: fileCodes cannot be empty; include the code context used in detection.");
  } else {
    for (let i = 0; i < file_codes.length; i++) {
      const fc = file_codes[i];
      const file_path = _s(fc.filePath);
      if (!file_path) {
        errors.push(`Hard rule4.1 (filePath required): fileCodes[${i}] is missing the filePath field.`);
      }
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const content_for_prefix = content_text.replace(/^#{1,6}\s*/, "");
    if (bug_status === 6 && !content_for_prefix.startsWith("Defect:")) {
      errors.push("Hard rule11 (content format-prefix): when bugStatus=6, content must start with 'Defect:'.");
    }
    if (bug_status === 7 && !content_for_prefix.startsWith("Improvement:")) {
      errors.push("Hard rule11 (content format-prefix): when bugStatus=7, content must start with 'Improvement:'.");
    }

    const line_pattern = /Lines[：:]\s*\d+(?:\s*[-~]\s*\d+)?/;
    if (!line_pattern.test(content_text)) {
      errors.push("Hard rule12 (content format-lines): when bugStatus=6/7, content must include 'Lines:X-Y' format.");
    }

    const has_fix_section = /Fix suggestion[：:]/.test(content_text);
    const has_opt_section = /Improvement plan[：:]/.test(content_text);
    const has_code_block = content_text.includes("```");
    if (bug_status === 6) {
      if (!has_fix_section) {
        errors.push("Hard rule13 (content format-fix suggestion): when bugStatus=6, content must include the 'Fix suggestion:' field.");
      }
      if (!has_code_block) {
        errors.push("Hard rule13 (content format-fix suggestion): when bugStatus=6, content must include a code block.");
      }
    } else if (bug_status === 7) {
      if (!has_opt_section) {
        errors.push("Hard rule13 (content format-improvement plan): when bugStatus=7, content must include the 'Improvement plan:' field.");
      }
      if (!has_code_block) {
        errors.push("Hard rule13 (content format-improvement plan): when bugStatus=7, content must include a code block.");
      }
    }
  }

  const first_error = validate_update_process(request_body, context_task_id, mode);
  if (first_error && !errors.includes(first_error)) {
    const first_error_id = /^Hard rule(\d+(?:\.\d+)?)/.exec(first_error);
    if (first_error_id) {
      const already_covered = errors.some((e) => e.includes(first_error_id[0]));
      if (!already_covered) errors.push(first_error);
    } else {
      errors.push(first_error);
    }
  }

  return errors;
}

export function validate_update_process(
  request_body: Record<string, any>,
  context_task_id: any = null,
  mode = "strict",
): string {
  const _resolved_mode = request_body._mode || mode;
  const _is_light = _resolved_mode === "light";

  const _VALID_DETECT_TIERS = new Set(["T1", "T2", "T3"]);
  const detect_tier = request_body.detectTier;
  if (!_py_bool(detect_tier)) {
    return (
      "detectTier is required: write-back must include detectTier (T1/T2/T3), " +
      "The server uses it to choose validation strictness. The detection plan assigns this field automatically, " +
      "If missing, check that build-detection-plan ran correctly."
    );
  }
  if (!_VALID_DETECT_TIERS.has(detect_tier)) {
    return (
      `Illegal detectTier value: current value is '${detect_tier}', ` +
      `Allowed values: T1/T2/T3. T1=high (full chain + business comparison), ` +
      `T2=medium (code logic + 1-hop chain), T3=basic (code-logic analysis).`
    );
  }

  const thinking = _s(request_body.thinking);
  if (!thinking) {
    return "Hard rule0: thinking cannot be empty; always record the AI analysis, with or without a defect.";
  }

  const process_steps = request_body.processSteps;
  if (!_py_bool(process_steps)) {
    return "Hard rule1: processSteps cannot be empty; record the full detection steps.";
  }

  const bug_status = request_body.bugStatus;
  const strategy_code = request_body.strategyCode;
  const has_defect = _in(bug_status, 6, 7);

  if (has_defect && _in(strategy_code, 8, 9) && !_py_bool(request_body.ruleId)) {
    return "Hard rule2: when an AST/custom-rule strategy has a defect, ruleId cannot be empty.";
  }

  if (has_defect && !_py_bool(request_body.tagId)) {
    return "Hard rule3: when bugStatus=6/7 (has a defect), tagId cannot be empty.";
  }

  const file_codes = request_body.fileCodes;
  if (!_py_bool(file_codes)) {
    return (
      "Hard rule4: fileCodes cannot be empty; include the code context used in detection." +
      "Even when the AST strategy has no defect (bugStatus=2), provide at least one record that includes filePath/git/branch/commitId."
    );
  }

  for (let i = 0; i < file_codes.length; i++) {
    const fc = file_codes[i];
    const file_path = _s(fc.filePath);
    if (!file_path) {
      return (
        `Hard rule4.1 (filePath required): fileCodes[${i}] is missing the filePath field.` +
        "Each fileCodes entry must include filePath (relative file path), " +
        "Example: 'src/main/java/com/example/Service.java'." +
        "The platform uses this field to locate the source file."
      );
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const content_for_prefix = content_text.replace(/^#{1,6}\s*/, "");
    if (bug_status === 6 && !content_for_prefix.startsWith("Defect:")) {
      return (
        "Hard rule11 (content format-prefix): when bugStatus=6, content must start with 'Defect:' (a markdown heading ## is allowed)." +
        "Example: 'Defect: NPE risk - method xxx has no null check\\n\\n**Lines:**407-408\\n...' " +
        "or '## Defect: NPE risk\\n\\n**Lines:**407-408\\n...'"
      );
    }
    if (bug_status === 7 && !content_for_prefix.startsWith("Improvement:")) {
      return (
        "Hard rule11 (content format-prefix): when bugStatus=7, content must start with 'Improvement:' (a markdown heading ## is allowed)." +
        "Example: 'Improvement: add a defensive null check\\n\\n**Lines:**120-125\\n...' " +
        "or '## Improvement: add a defensive null check\\n\\n**Lines:**120-125\\n...'"
      );
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const line_pattern = /Lines[：:]\s*\d+(?:\s*[-~]\s*\d+)?/;
    if (!line_pattern.test(content_text)) {
      return (
        "Hard rule12 (content format-lines): when bugStatus=6/7, content must include line info in 'Lines:X-Y' format." +
        "Example: '**Lines:**407-408' or 'Lines:120'." +
        "The platform uses this field to locate the defective code."
      );
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const has_fix_section = /Fix suggestion[：:]/.test(content_text);
    const has_opt_section = /Improvement plan[：:]/.test(content_text);
    const has_code_block = content_text.includes("```");
    if (bug_status === 6) {
      if (!has_fix_section) {
        return (
          "Hard rule13 (content format-fix suggestion): when bugStatus=6, content must include the 'Fix suggestion:' field." +
          "Example: '**Fix suggestion:**\\n```java\\n// fix code\\n```'"
        );
      }
      if (!has_code_block) {
        return (
          "Hard rule13 (content format-fix suggestion): when bugStatus=6, content must include a code block (```...```) showing the fix." +
          "Example: '**Fix suggestion:**\\n```java\\nif (obj != null) { ... }\\n```'"
        );
      }
    } else if (bug_status === 7) {
      if (!has_opt_section) {
        return (
          "Hard rule13 (content format-improvement plan): when bugStatus=7, content must include the 'Improvement plan:' field." +
          "Example: '**Improvement plan:**\\n```java\\n// improved code\\n```'"
        );
      }
      if (!has_code_block) {
        return (
          "Hard rule13 (content format-improvement plan): when bugStatus=7, content must include a code block (```...```) showing the improved code." +
          "Example: '**Improvement plan:**\\n```java\\nreturn Optional.ofNullable(value)...\\n```'"
        );
      }
    }
  }

  if (strategy_code === 8 && has_defect) {
    const hit_rule_ids = request_body.hitRuleIds;
    if (!_py_bool(hit_rule_ids)) {
      return "When strategyCode=8 (AST rule strategy) has a defect, hitRuleIds cannot be empty; return the list of matched AST rule IDs.";
    }
  }

  if (strategy_code === 8) {
    const ast_rule_count = request_body.astRuleCount;
    if (ast_rule_count === undefined || ast_rule_count === null) {
      return (
        "Hard rule5 (AST completeness): strategyCode=8 write-back must include astRuleCount, " +
        "set it to the number of category=1 rules actually loaded by this run-ast-scan." +
        "Do not write back this strategy unless run-ast-scan was executed."
      );
    }
    if (ast_rule_count === 0) {
      return (
        "Hard rule5 (AST completeness): astRuleCount=0 means run-ast-scan returned a conclusion without loading any AST rules." +
        "A Java service always has AST rules; astRuleCount=0 is abnormal, " +
        "Do not write back no-defect yet — confirm get-rules actually returned rules, then re-scan."
      );
    }
  }

  const _THINKING_PLACEHOLDER_PATTERNS = [
    "no defect",
    "no defects",
    "code is fine",
    "no issues found",
    "no problem",
    "no bug",
    "no defect",
    "no issue",
    "looks good",
    "lgtm",
  ];
  if (thinking.length < 30) {
    const lower = thinking.toLowerCase();
    if (_THINKING_PLACEHOLDER_PATTERNS.some((p) => lower.includes(p))) {
      return (
        "Hollow check: thinking is too short and has no real analysis (<30 characters of conclusory boilerplate)." +
        "Must include a concrete analysis: which logic was reviewed, which risks were considered, and why the conclusion was reached."
      );
    }
  }

  if (has_defect) {
    const _CONF_PATTERNS = /\[Confidence:(HIGH|MED|LOW)\]/;
    if (!_CONF_PATTERNS.test(thinking)) {
      return (
        "Confidence marker missing: when bugStatus=6/7, thinking must include a [Confidence:HIGH/MED/LOW] marker at the end (before [C5✓])." +
        "HIGH=high confidence (clear code evidence), MED=medium (some defense but not enough), LOW=needs business knowledge (user must confirm)." +
        "Example: '...Conclusion: defense failed. [Confidence:HIGH][C5✓]'"
      );
    }
  }

  const _CONF_MED_LOW = /\[Confidence:(MED|LOW)\]/;
  if (_CONF_MED_LOW.test(thinking) && !/\[Needs confirmation\]/.test(thinking)) {
    return (
      "Open-question output missing: thinking has [Confidence:MED/LOW] but no [Needs confirmation] section." +
      "When the analysis is uncertain and code alone cannot settle it, explicitly tell the user what is open." +
      "[Needs confirmation] must include: (1) Open question (which business premise cannot be determined), " +
      "(2) Current assumption (temporary assumption until the user confirms), " +
      "(3) Please confirm (what business information is needed to settle it)." +
      "Do not invent assumptions, and do not hide uncertainty from the user — an open question is not a false positive; still write back bugStatus=6/7 and ask the user to confirm."
    );
  }

  const _STEP_PLACEHOLDER_PATTERNS = [
    "...",
    "placeholder",
    "placeholder",
    "todo",
    "tbd",
    "TBD",
    "null",
    "none",
    "n/a",
  ];
  for (let i = 0; i < process_steps.length; i++) {
    const step = process_steps[i];
    const step_status = "stepStatus" in step ? step.stepStatus : "";
    if (step_status === "skipped") continue;
    if (step_status === "executed") {
      const conclusion = _s(step.conclusion);
      if (!conclusion) {
        return `Hollow check: processSteps[${i}] stepStatus=executed but conclusion is empty. Every executed step must have a substantive conclusion.`;
      }
      if (_in(conclusion.toLowerCase(), ..._STEP_PLACEHOLDER_PATTERNS) || conclusion.length < 5) {
        return `Hollow check: processSteps[${i}] conclusion looks like a placeholder ('${conclusion}'). Fill in the full conclusion actually produced by the LLM.`;
      }
      if (strategy_code !== 8) {
        const question = _s(step.question);
        if (!question) {
          return (
            `Hollow check: processSteps[${i}] stepStatus=executed but question is empty.` +
            "question must contain the full prompt sent to the LLM; do not omit it."
          );
        }
        if (_in(question.toLowerCase(), ..._STEP_PLACEHOLDER_PATTERNS) || question.length < 10) {
          return (
            `Hollow check: processSteps[${i}] question looks like a placeholder ('${question.slice(0, 30)}').` +
            "Fill in the full prompt actually sent to the LLM; do not substitute placeholder text."
          );
        }
      }
    }
  }

  for (let i = 0; i < file_codes.length; i++) {
    const fc = file_codes[i];
    const required_fields = strategy_code === 10 ? ["git", "branch"] : ["git", "branch", "commitId"];
    const missing_git_fields = required_fields.filter((f) => !_s(fc[f]));
    if (missing_git_fields.length) {
      return (
        `Hard rule4 (fileCodes git context): fileCodes[${i}] is missing required fields: ${_py_list_repr(missing_git_fields)}.` +
        "Each fileCodes entry must include git (repo SSH URL), branch (branch name), and commitId (commit hash), " +
        "so the platform can trace the source version."
      );
    }
  }

  if (_in(strategy_code, 4, 6, 11)) {
    const _CHAIN_KEYWORDS = [
      "→",
      "->",
      "call",
      "invoke",
      "caller",
      "callee",
      "Call chain",
      "upstream",
      "downstream",
      "entry",
      "Controller",
      "Listener",
      "Consumer",
      "RPC",
      "chain",
    ];
    const content_text = _s(request_body.content);
    if (
      !_CHAIN_KEYWORDS.some((kw) => thinking.includes(kw)) &&
      !_CHAIN_KEYWORDS.some((kw) => content_text.includes(kw))
    ) {
      return (
        `Hard rule6 (chain strategy): strategyCode=${strategy_code} requires analysis along the call chain, ` +
        "but neither thinking nor content shows chain information." +
        "Must include a call-path description, e.g. A#method → B#method → C#method." +
        "fileCodes should include code for every class on the chain."
      );
    }
  }

  if (_in(strategy_code, 6, 11)) {
    const _VALID_SOURCE_TYPES = new Set(["prd_doc", "tech_doc", "test_case"]);
    let has_ref_sources = false;
    for (const step of process_steps) {
      const ref_sources = step.referencedSources;
      if (ref_sources && Array.isArray(ref_sources) && ref_sources.length > 0) {
        for (const rs of ref_sources) {
          const st = rs.sourceType || "";
          if (_VALID_SOURCE_TYPES.has(st)) {
            has_ref_sources = true;
            break;
          }
        }
        if (has_ref_sources) break;
      }
    }
    if (!has_ref_sources) {
      return (
        "Hard rule7 (business strategy referencedSources): when strategyCode=11, " +
        "at least one processSteps entry must include referencedSources, " +
        "and sourceType must be one of prd_doc/tech_doc/test_case." +
        "Even when bugStatus=2 (no defect), record the business sources used for the analysis." +
        "Format: referencedSources: [{sourceType: 'tech_doc', sourceId: '...', sourceName: '...'}]"
      );
    }

    if (has_defect) {
      const content_text = _s(request_body.content);
      const _CASE_KEYWORDS = ["Test case ID", "test case", "case ID", "caseId", "testCaseId"];
      if (!_CASE_KEYWORDS.some((kw) => content_text.includes(kw))) {
        return (
          "Hard rule7 (business strategy): when strategyCode=11 and bugStatus=6/7, content must include the related test-case information." +
          "Format: Test case ID: [caseId](url)." +
          "Must explain which test case / business scenario this method change conflicts with."
        );
      }
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const rule_code_match = _RULE_CODE_PATTERN.exec(content_text);
    if (rule_code_match) {
      return (
        `Hard rule8 (no leak): content contains internal rule id '${rule_code_match[0]}'.` +
        "Do not expose RULE-XXX-NNNNN rule codes in content, " +
        "Only describe the problem itself (which code, what is wrong, what happens)."
      );
    }
    const strategy_match = _STRATEGY_LEAK_PATTERN.exec(content_text);
    if (strategy_match) {
      return (
        `Hard rule8 (no leak): content contains strategy code '${strategy_match[0]}'.` +
        "Do not expose internal fields such as strategyCode/strategy in content."
      );
    }
    const internal_id_match = _INTERNAL_ID_PATTERN.exec(content_text);
    if (internal_id_match) {
      return (
        `Hard rule8 (no leak): content contains internal ID '${internal_id_match[0]}'.` +
        "Do not expose internal fields such as processId/rankId/batchId in content."
      );
    }
  }

  if (strategy_code === 8 && has_defect) {
    const step_names = process_steps.map((s: any) => s.step || s.stepKey || "");
    if (!step_names.includes("exclusion_rule_filter")) {
      return (
        "Hard rule9 (AST full pipeline): when strategyCode=8 and bugStatus=6/7, " +
        "processSteps must include an 'exclusion_rule_filter' step." +
        "AST hits must pass exclusion-rule filtering before being judged a defect; do not skip."
      );
    }
    if (!step_names.includes("llm_validation")) {
      return (
        "Hard rule9 (AST full pipeline): when strategyCode=8 and bugStatus=6/7, " +
        "processSteps must include an 'llm_validation' step." +
        "AST hits must go through LLM false-positive review before being judged a defect; do not skip."
      );
    }
  }

  if (has_defect && _cached_tag_ids !== null) {
    const tag_id = request_body.tagId;
    if (_py_bool(tag_id) && !_cached_tag_ids.has(tag_id)) {
      try {
        const tag_id_int = _to_int(tag_id);
        const tag_ids_int = new Set<number>();
        for (const t of _cached_tag_ids) {
          if (/^\d+$/.test(String(t))) tag_ids_int.add(_to_int(t));
        }
        if (!tag_ids_int.has(tag_id_int)) {
          const sample = [..._cached_tag_ids].slice(0, 10);
          return (
            `Hard rule10 (tagId validity): tagId='${tag_id}' is not in the valid list.` +
            `Valid tagId list (first 10): ${_py_list_repr(sample)}.` +
            "Pick the best-matching tag from the get-tag-list response."
          );
        }
      } catch {
        const sample = [..._cached_tag_ids].slice(0, 10);
        return (
          `Hard rule10 (tagId validity): tagId='${tag_id}' is not in the valid list.` +
          `Valid tagId list (first 10): ${_py_list_repr(sample)}.` +
          "Pick the best-matching tag from the get-tag-list response."
        );
      }
    }
  }

  if (has_defect && _cached_tag_map !== null) {
    const tag_id = request_body.tagId;
    const content_text = _s(request_body.content);
    if (_py_bool(tag_id) && content_text) {
      const tag_id_key = tag_id;
      let standard_name = _cached_tag_map[tag_id_key];
      if (standard_name === undefined) {
        try {
          standard_name = _cached_tag_map[_to_int(tag_id_key)];
        } catch {
          /* pass */
        }
      }
      if (standard_name && !content_text.includes(standard_name)) {
        console.error(
          `⚠️ Tag name check (warning): tagId=${tag_id} maps to standard name '${standard_name}', ` +
            `but content does not include that tag name. Prefer the standard name in the 'Problem tags:' field.`,
        );
      }
    }
  }

  if (!_in(strategy_code, 8)) {
    const batch_id = request_body.parentBatchId;
    const class_name = request_body.className || "";
    const task_id_for_gate = request_body.taskId || context_task_id;
    if (_py_bool(batch_id) && _py_bool(class_name)) {
      if (!has_code_been_read(batch_id, class_name, task_id_for_gate)) {
        const msg =
          `Hard rule14 (code-read gate): className='${class_name}' in batch=${batch_id}` +
          " has no code-read record. Read the source and call register-code-read before write-back." +
          " Short class names and slash/dot FQCNs are treated as the same class." +
          " Do not write back a conclusion without reading the code.";
        if (_CODE_READ_GATE_ENFORCE) {
          return msg;
        }
        console.error(`⚠️ ${msg} (warning mode only; not blocked)`);
      }
    }
  }

  const batch_id = request_body.parentBatchId;
  const task_id_for_clone_gate = request_body.taskId || context_task_id;
  let git_url: string | null = null;
  if (_py_bool(file_codes)) {
    for (const fc of file_codes) {
      const g = _s(fc.git);
      if (g) {
        git_url = g;
        break;
      }
    }
  }
  if (_py_bool(batch_id) && git_url) {
    if (!has_repo_been_cloned(batch_id, git_url, task_id_for_clone_gate)) {
      return (
        `Hard rule19 (clone gate): repo '${git_url}' in batch=${batch_id}` +
        "has no git-clone record. Clone the repo locally before write-back, " +
        "and register it with register_repo_clone()." +
        "Do not write back conclusions without cloning the code — all detection must analyze real local source."
      );
    }
  }

  if (has_defect && !_is_light) {
    const content_text = _s(request_body.content);
    if (!content_text.includes("Affected business")) {
      return (
        "Hard rule15 (Affected business required): when bugStatus=6/7, content must include the 'Affected business' field." +
        "Format: 'Affected business: <which concrete business feature/flow/scenario is affected>'." +
        "Helps RD/QA quickly judge the business impact. (Exempted in light mode.)"
      );
    }
  }

  if (has_defect && !_is_light) {
    const content_text = _s(request_body.content);
    if (!content_text.includes("Reproduction path")) {
      return (
        "Hard rule16 (Reproduction path required): when bugStatus=6/7, content must include the 'Reproduction path' field." +
        "Format: 'Reproduction path: call API A → pass parameter X → hit branch Y → produce error Z'." +
        "Helps RD/QA reproduce and verify the defect. (Exempted in light mode.)"
      );
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const md_bold_count = (content_text.match(/\*\*[^*]+[：:]\*\*/g) || []).length;
    if (md_bold_count > 0) {
      return (
        `Hard rule17.1 (no bold): content contains ${md_bold_count} **field name:** bold markers.` +
        "The detection-platform report does not render Markdown bold (**text** is shown as literal asterisks)." +
        "All field names must be plain text, e.g. 'Problem description:' not '**Problem description:**'."
      );
    }
    const _REQUIRED_FIELDS = ["Problem description:", "Problem tags:", "Impact scope:", "Affected business:", "Reproduction path:"];
    const found_fields = _REQUIRED_FIELDS.filter((f) => content_text.includes(f)).length;
    const _min_required = _is_light ? 1 : 3;
    if (found_fields < _min_required) {
      return (
        `Hard rule17.2 (required fields): when bugStatus=6/7, content must include at least ${_min_required} structured field names` +
        `${_is_light ? " (light-mode requirement)" : " (strict-mode requirement)"}.` +
        `Currently found ${found_fields} (candidate fields: Problem description, Problem tags, Impact scope, Affected business, Reproduction path).` +
        "Use plain-text field names, e.g. 'Problem description:<content>'."
      );
    }
    const tag_line_match = /Problem tags[：:]\s*(.+?)(?:\n|$)/.exec(content_text);
    if (tag_line_match) {
      const tag_content = tag_line_match[1];
      if (!tag_content.includes("[")) {
        return (
          "Hard rule17.3 (tag format): tags after 'Problem tags:' must be wrapped in []." +
          "Correct format: 'Problem tags: [Parameter / null check][This change]'." +
          "Do not use bare-text tags (e.g. 'Problem tags: parameter check')."
        );
      }
      if (!tag_content.includes("[This change]") && !tag_content.includes("[Pre-existing]")) {
        return (
          "Hard rule17.3 (introduction-era tag): 'Problem tags:' must include an introduction-era tag: [This change] or [Pre-existing]." +
          "Rule: defect code added/changed in this diff → [This change]; unchanged in this change → [Pre-existing]." +
          "Correct format: 'Problem tags: [Parameter / null check][This change]'."
        );
      }
    }
  }

  if (has_defect) {
    const content_text = _s(request_body.content);
    const _UNCERTAINTY_KEYWORDS = [
      "possibly",
      "uncertain",
      "needs confirmation",
      "to be verified",
      "suspected",
      "presumably",
      "cannot rule out",
      "pending further",
      "not fully confirmed",
      "theoretically",
    ];
    const has_uncertainty = _UNCERTAINTY_KEYWORDS.some((kw) => thinking.includes(kw));
    if (has_uncertainty && !content_text.includes("Suggested checks")) {
      console.error(
        "⚠️ Hard rule18 (suggested checks): thinking contains uncertainty language, " +
          "Consider adding a 'Suggested checks:' field in content (plain text, no bold), " +
          "list the directions RD/QA should verify so the user can locate checks quickly.",
      );
    }
  }

  const min_detect_level = request_body._minDetectLevel;
  if (_py_bool(min_detect_level) && !_in(strategy_code, 8) && !_is_light) {
    if (min_detect_level === "L2+TC") {
      const _CASE_EVIDENCE_KEYWORDS = [
        "test case",
        "testCase",
        "case ID",
        "test steps",
        "expected result",
        "TC-",
        "test case",
        "expectedResult",
      ];
      if (!_CASE_EVIDENCE_KEYWORDS.some((kw) => thinking.includes(kw))) {
        return (
          "Hard rule21 (minDetectLevel depth gate): this method has minDetectLevel=L2+TC, " +
          "thinking must cite a concrete test case (case ID, steps, expected-result comparison)." +
          "Current thinking contains no test-case analysis evidence." +
          "Find the related case in DOC_SUMMARY.md / testCases and use its steps as input to verify the code behavior."
        );
      }
    } else if (min_detect_level === "L2") {
      const _DOC_EVIDENCE_KEYWORDS = [
        "DOC_SUMMARY",
        "requirement doc",
        "technical doc",
        "business rule",
        "doc description",
        "requirement description",
        "rule number",
        "API contract",
        "prd_doc",
        "tech_doc",
        "doc requirement",
      ];
      if (!_DOC_EVIDENCE_KEYWORDS.some((kw) => thinking.includes(kw))) {
        return (
          "Hard rule21 (minDetectLevel depth gate): this method has minDetectLevel=L2, " +
          "thinking must cite business rules from the requirement or technical docs." +
          "Current thinking contains no document/business-rule analysis evidence." +
          "Locate this method's business rules in DOC_SUMMARY.md and judge the code against those rules."
        );
      }
    } else if (min_detect_level === "L1+doc") {
      const _DOC_MENTION_KEYWORDS = [
        "document",
        "requirement",
        "DOC_SUMMARY",
        "rule",
        "design",
        "business context",
        "API definition",
        "prd",
        "PRD",
      ];
      if (!_DOC_MENTION_KEYWORDS.some((kw) => thinking.includes(kw))) {
        return (
          "Hard rule21 (minDetectLevel depth gate): this method has minDetectLevel=L1+doc, " +
          "thinking must include at least one document-background sentence (reviewed the docs / this method is not covered by doc rules)." +
          "Current thinking does not mention any document-related content." +
          "Read DOC_SUMMARY.md to confirm whether this method is covered by documented business rules."
        );
      }
    }
  }

  const context_reads_count = request_body._contextReadsCount;
  if (context_reads_count !== undefined && context_reads_count !== null && _in(strategy_code, 4, 6, 11)) {
    const _min_reads = context_read_min(detect_tier, _is_light);
    if (_min_reads != null && context_reads_count < _min_reads) {
      const _hint_strict =
        "Call-chain analysis must walk 2-3 hops along the call chain and read files on the Controller → Service → Dao path. Make sure STEP B already read upstream/downstream callers/callees and registered them with register-context-read.";
      const _hint_light =
        "Read at least one more upstream/downstream caller/callee and register it with register-context-read (light mode already lowers this to ≥1 file).";
      return (
        `Hard rule22 (contextReads gate): strategyCode=${strategy_code} (call-chain analysis)` +
        ` detectTier=${detect_tier} ${_is_light ? "light" : "strict"} mode requires reading code context from at least ${_min_reads} distinct files, ` +
        `currently only ${context_reads_count}.` +
        `${_is_light ? _hint_light : _hint_strict}`
      );
    }
  }

  return "";
}

export function validate_batch_hollow_check(items: any[], ast_only_exempt = false): Record<string, any> {
  if (ast_only_exempt) {
    return { passed: true, blocked: false, warnings: [], details: { ast_exempt: true } };
  }
  const trivial_only = items.length > 0 && items.every((item) => item && (item._trivialFilter || item.trivialReason));
  if (trivial_only) {
    return { passed: true, blocked: false, warnings: [], details: { trivial_filter_exempt: true } };
  }

  if (items.length < BATCH_HOLLOW_CHECK_MIN_SIZE) {
    return { passed: true, blocked: false, warnings: [], details: {} };
  }

  const warnings: string[] = [];
  let blocked = false;

  const no_bug_count = items.filter((item) => item.bugStatus === 2).length;
  const total = items.length;
  const no_bug_ratio = total > 0 ? no_bug_count / total : 0;

  if (no_bug_ratio >= BATCH_HOLLOW_NO_BUG_RATIO_WARN && !ast_only_exempt) {
    warnings.push(
      `Hollow warning (high no-defect rate): ${no_bug_count} of ${total} items in this batch are bugStatus=2` +
        ` (ratio ${_pct1(no_bug_ratio)}), exceeding the ${_pct0(BATCH_HOLLOW_NO_BUG_RATIO_WARN)} threshold.` +
        "Confirm that the code was actually read and analyzed.",
    );
  }

  const thinkings = items.map((item) => _normalize_thinking_for_hollow(item));

  let consecutive_similar = 0;
  let max_consecutive = 0;
  for (let i = 1; i < thinkings.length; i++) {
    const sim = _text_similarity(thinkings[i - 1], thinkings[i]);
    if (sim >= BATCH_HOLLOW_SIMILARITY_THRESHOLD) {
      consecutive_similar += 1;
      max_consecutive = Math.max(max_consecutive, consecutive_similar);
    } else {
      consecutive_similar = 0;
    }
  }

  if (max_consecutive >= BATCH_HOLLOW_CONSECUTIVE_LIMIT) {
    warnings.push(
      `Hollow warning (templated thinking): detected ${max_consecutive + 1} consecutive thinking entries` +
        ` similarity >= ${_pct0(BATCH_HOLLOW_SIMILARITY_THRESHOLD)}` +
        " (after stripping class/method names and the mandated Call-chain suffix)." +
        "Strongly suspected that methods were not analyzed independently and a template was filled in bulk.",
    );
    blocked = true;
  }

  const _TEMPLATE_PATTERNS = [
    /Performed detection analysis on file\s+\S+/,
    /Reviewed the code content of this [\p{L}\p{N}_]+ file/u,
    /After careful review.*complies with.*standards/,
    /No .*defects?.*issues?/,
    /Performed comprehensive .*analysis.*(?:found )?no/,
  ];
  let template_hit_count = 0;
  for (const thinking of thinkings) {
    const hits = _TEMPLATE_PATTERNS.filter((p) => p.test(thinking)).length;
    if (hits >= 3) template_hit_count += 1;
  }

  const template_ratio = total > 0 ? template_hit_count / total : 0;
  if (template_ratio >= 0.8) {
    warnings.push(
      `Hollow warning (template phrasing): ${template_hit_count}/${total} thinking entries` +
        ` (${_pct0(template_ratio)}) hit ≥3 templated-phrasing features.` +
        "The agent must analyze actual code; do not fill thinking from a template in bulk.",
    );
    blocked = true;
  }

  if (no_bug_ratio >= BATCH_HOLLOW_NO_BUG_RATIO_WARN && max_consecutive >= 3 && !ast_only_exempt) {
    warnings.push(
      `Hollow warning (templated thinking + high no-defect rate): ${max_consecutive + 1} consecutive` +
        " method-specific thinkings are highly similar while almost every item is bugStatus=2.",
    );
    blocked = true;
  }

  return {
    passed: !blocked,
    blocked,
    warnings,
    details: {
      totalItems: total,
      noBugCount: no_bug_count,
      noBugRatio: _round(no_bug_ratio, 3),
      maxConsecutiveSimilar: max_consecutive > 0 ? max_consecutive + 1 : 0,
      templateHitCount: template_hit_count,
      templateHitRatio: _round(template_ratio, 3),
    },
  };
}

const _CALL_CHAIN_LABEL = /(?:Call[\s-]+chain|调用链)\s*[:：]/i;

function _simple_class_token(class_name: string): string {
  const s = String(class_name || "").trim().replace(/\\/g, "/");
  if (!s) return "";
  return s.split("/").pop()?.split(".").pop() || "";
}

/** Drop class/method names and the mandated Call-chain suffix so batch write-back of one chain is not treated as a template. */
export function _normalize_thinking_for_hollow(item: any): string {
  let text = _s(item?.thinking);
  if (!text) return "";

  const label_at = text.search(_CALL_CHAIN_LABEL);
  if (label_at >= 0) text = text.slice(0, label_at);

  const class_name = String(item?.className || "").trim();
  const method_name = String(item?.methodName || "").trim();
  const simple = _simple_class_token(class_name);
  const names: Array<[string, string]> = [];
  if (class_name) names.push([class_name, "<CLASS>"]);
  if (class_name) {
    const slash = class_name.replace(/\./g, "/");
    const dot = class_name.replace(/\//g, ".");
    if (slash !== class_name) names.push([slash, "<CLASS>"]);
    if (dot !== class_name) names.push([dot, "<CLASS>"]);
  }
  if (simple && simple !== class_name) names.push([simple, "<FILE>"]);
  if (method_name) names.push([method_name, "<METHOD>"]);
  names.sort((a, b) => b[0].length - a[0].length);
  for (const [name, token] of names) {
    if (name) text = text.replaceAll(name, token);
  }

  return text.replace(/\s+/g, " ").trim();
}

export function _text_similarity(text_a: string, text_b: string): number {
  if (!text_a || !text_b) return 0.0;
  if (text_a === text_b) return 1.0;

  const _bigrams = (text: string): Set<string> => {
    const s = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) s.add(text.slice(i, i + 2));
    return s;
  };

  const set_a = _bigrams(text_a);
  const set_b = _bigrams(text_b);
  if (!set_a.size || !set_b.size) return 0.0;

  let intersection = 0;
  for (const x of set_a) if (set_b.has(x)) intersection += 1;
  const union = new Set([...set_a, ...set_b]).size;
  return union > 0 ? intersection / union : 0.0;
}

export function pre_validate_and_fix(request_body: Record<string, any>): Record<string, any> {
  const fixes: string[] = [];
  const bug_status = request_body.bugStatus;
  const has_defect = _in(bug_status, 6, 7);

  if (has_defect) {
    const content = _s(request_body.content);
    const content_no_md = content.replace(/^#{1,6}\s*/, "");
    if (bug_status === 6 && !content_no_md.startsWith("Defect:")) {
      if (content.startsWith("##")) {
        request_body.content = content.replace(/^(#{1,6}\s*)/, "$1Defect:");
      } else {
        request_body.content = `## Defect:${content}`;
      }
      fixes.push("Auto-filled content prefix 'Defect:'");
    } else if (bug_status === 7 && !content_no_md.startsWith("Improvement:")) {
      if (content.startsWith("##")) {
        request_body.content = content.replace(/^(#{1,6}\s*)/, "$1Improvement:");
      } else {
        request_body.content = `## Improvement:${content}`;
      }
      fixes.push("Auto-filled content prefix 'Improvement:'");
    }
  }

  if (has_defect) {
    const content = request_body.content || "";
    if (content.includes("**Lines:**") || content.includes("**Lines:**")) {
      const new_content = content.replace(/\*\*Lines[：:]\*\*\s*/g, "Lines:");
      if (new_content !== content) {
        request_body.content = new_content;
        fixes.push("Removed markdown bold wrapping from the Lines field");
      }
    }
  }

  const file_codes = request_body.fileCodes || [];
  const class_name = request_body.className || "";
  for (let i = 0; i < file_codes.length; i++) {
    const fc = file_codes[i];
    const file_path = _s(fc.filePath);
    if (!file_path && class_name) {
      const inferred = "src/main/java/" + class_name.replaceAll(".", "/") + ".java";
      fc.filePath = inferred;
      fixes.push(`fileCodes[${i}].filePath is empty; inferred from className as '${inferred}'`);
    }
  }

  if (has_defect) {
    const content = request_body.content || "";
    const _FIELD_NAMES = [
      "Problem description",
      "Problem tags",
      "Impact scope",
      "Affected business",
      "Reproduction path",
      "Trigger conditions",
      "Fix suggestion",
      "Improvement plan",
      "Current impact",
      "Rationale",
      "Expected vs actual",
      "Suggested checks",
      "expected",
      "actual",
      "Test case ID",
    ];
    let fixed_content = content;
    for (const field of _FIELD_NAMES) {
      const bold_pattern = new RegExp(`\\*\\*(${_re_escape(field)})[：:]\\*\\*\\s*`, "g");
      fixed_content = fixed_content.replace(bold_pattern, field + "：");
      const bold_pattern2 = new RegExp(`\\*\\*(${_re_escape(field)})\\*\\*[：:]\\s*`, "g");
      fixed_content = fixed_content.replace(bold_pattern2, field + "：");
    }
    if (fixed_content !== content) {
      request_body.content = fixed_content;
      fixes.push("Automatically stripped Markdown bold from content field names (platform does not render it)");
    }
  }

  return {
    fixed: fixes.length > 0,
    fixes,
    request_body,
  };
}

export function validate_report_content(detection_results: any[]): Record<string, any> {
  const issues: Record<string, any>[] = [];

  for (const batch_result of detection_results) {
    for (const job of batch_result.jobDetectionVos || []) {
      for (const rank of job.defectRankResults || []) {
        const bug_status = rank.bugStatus;
        const content = _s(rank.content);
        const rank_id = rank.id;
        const class_name = rank.className || "";
        const method_name = rank.methodName || "";

        const entry_issues: string[] = [];

        if (content.length < 80) {
          entry_issues.push("content is too short (<80 chars); the defect description may be incomplete");
        }

        if (bug_status === 6) {
          if (!content.includes("Defect:")) {
            entry_issues.push("bugStatus=6 must include the 'Defect:' title marker");
          }
          if (!content.includes("**Lines:**") && !content.includes("Lines:")) {
            entry_issues.push("Missing 'Lines' field");
          }
          if (!content.includes("**Problem description:**") && !content.includes("Problem description:")) {
            entry_issues.push("Missing 'Problem description' field");
          }
          if (!content.includes("**Problem tags:**") && !content.includes("Problem tags:")) {
            entry_issues.push("Missing 'Problem tags' field");
          }
          if (!content.includes("**Impact scope:**") && !content.includes("Impact scope:")) {
            entry_issues.push("Missing 'Impact scope' field");
          }
          if (!content.includes("**Affected business:**") && !content.includes("Affected business:")) {
            entry_issues.push("Missing 'Affected business' field (required for bugStatus=6)");
          }
          if (!content.includes("**Reproduction path:**") && !content.includes("Reproduction path:")) {
            entry_issues.push("Missing 'Reproduction path' field (required for bugStatus=6)");
          }
          if (!content.includes("**Trigger conditions:**") && !content.includes("Trigger conditions:")) {
            entry_issues.push("Missing 'Trigger conditions' field (required for bugStatus=6)");
          }
          if (!content.includes("**Expected vs actual:**") && !content.includes("Expected vs actual：")) {
            entry_issues.push("Missing 'Expected vs actual' field (required for bugStatus=6)");
          }
          if (!content.includes("**Fix suggestion:**") && !content.includes("Fix suggestion:")) {
            entry_issues.push("Missing 'Fix suggestion' field (required for bugStatus=6)");
          }
          const md_bold_count = (content.match(/\*\*[^*]+[：:]\*\*/g) || []).length;
          if (md_bold_count > 0) {
            entry_issues.push(`content contains ${md_bold_count} **bold** markers; the platform does not render them — use plain-text field names`);
          }
        } else if (bug_status === 7) {
          if (!content.includes("Improvement:")) {
            entry_issues.push("bugStatus=7 must include the 'Improvement:' title marker");
          }
          if (!content.includes("**Lines:**") && !content.includes("Lines:")) {
            entry_issues.push("Missing 'Lines' field");
          }
          if (!content.includes("**Problem description:**") && !content.includes("Problem description:")) {
            entry_issues.push("Missing 'Problem description' field");
          }
          if (!content.includes("**Problem tags:**") && !content.includes("Problem tags:")) {
            entry_issues.push("Missing 'Problem tags' field");
          }
          if (!content.includes("**Impact scope:**") && !content.includes("Impact scope:")) {
            entry_issues.push("Missing 'Impact scope' field");
          }
          if (!content.includes("**Affected business:**") && !content.includes("Affected business:")) {
            entry_issues.push("Missing 'Affected business' field (required for bugStatus=7)");
          }
          if (!content.includes("**Reproduction path:**") && !content.includes("Reproduction path:")) {
            entry_issues.push("Missing 'Reproduction path' field (required for bugStatus=7)");
          }
          if (!content.includes("**Current impact:**") && !content.includes("Current impact:")) {
            entry_issues.push("Missing 'Current impact' field (required for bugStatus=7)");
          }
          if (!content.includes("**Rationale:**") && !content.includes("Rationale:")) {
            entry_issues.push("Missing 'Rationale' field (required for bugStatus=7)");
          }
          if (!content.includes("**Improvement plan:**") && !content.includes("Improvement plan:")) {
            entry_issues.push("Missing 'Improvement plan' field (required for bugStatus=7)");
          }
          const md_bold_count = (content.match(/\*\*[^*]+[：:]\*\*/g) || []).length;
          if (md_bold_count > 0) {
            entry_issues.push(`content contains ${md_bold_count} **bold** markers; the platform does not render them — use plain-text field names`);
          }
        }

        if (entry_issues.length) {
          issues.push({
            rankId: rank_id,
            className: class_name,
            methodName: method_name,
            bugStatus: bug_status,
            contentPreview: content.length > 120 ? content.slice(0, 120) + "..." : content,
            issues: entry_issues,
          });
        }
      }
    }
  }

  return {
    checked: true,
    issueCount: issues.length,
    issues,
  };
}
