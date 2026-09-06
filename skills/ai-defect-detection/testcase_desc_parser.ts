/**
 * Best-effort enrichment of loosely structured test-case descriptions.
 */

const _FLAGS = "is";

const _PRE_RE = new RegExp(
  "(pre-?condition)[:：]\\s*(.+?)(?=(?:steps?|expected)[:：]|$)",
  _FLAGS,
);
const _STEPS_RE = new RegExp(
  "(steps?)[:：]\\s*(.+?)(?=(?:expected(?:\\s*result)?|pre-?condition)[:：]|$)",
  _FLAGS,
);
const _EXPECT_RE = new RegExp(
  "(expected(?:\\s*result)?)[:：]\\s*(.+?)(?=(?:pre-?condition|steps?)[:：]|$)",
  _FLAGS,
);

function _first_text(data: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function _parse_desc(blob: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!blob) return parsed;
  let match = _PRE_RE.exec(blob);
  if (match) parsed.preCondition = match[2].trim();
  match = _STEPS_RE.exec(blob);
  if (match) parsed.steps = match[2].trim();
  match = _EXPECT_RE.exec(blob);
  if (match) parsed.expectedResult = match[2].trim();
  return parsed;
}

export function enrich_test_case_fields(
  detail: Record<string, any>,
  case_id: any = null,
): Record<string, any> {
  const source = { ...(detail || {}) };
  const title = _first_text(source, "title", "name", "caseName", "caseTitle");
  let pre = _first_text(source, "preCondition", "precondition", "pre_condition");
  let steps = _first_text(source, "steps", "step", "operation");
  let expected = _first_text(source, "expectedResult", "expected", "expectResult");

  const blob = _first_text(source, "desc", "description", "raw", "content", "detail");
  let parsed_from_desc = false;
  if (!(pre || steps || expected) && blob) {
    const parsed = _parse_desc(blob);
    pre = parsed.preCondition || "";
    steps = parsed.steps || "";
    expected = parsed.expectedResult || "";
    parsed_from_desc = Boolean(pre || steps || expected);
  }

  let resolved_id: any =
    case_id !== undefined && case_id !== null && String(case_id).trim() ? case_id : null;
  if (resolved_id === null) {
    resolved_id = source.id || source.caseId || source.case_id;
  }

  const has_body = Boolean(pre || steps || expected || title);
  const result: Record<string, any> = {
    id: resolved_id,
    title,
    preCondition: pre,
    steps,
    expectedResult: expected,
    fetchStatus: has_body ? "success" : "empty",
  };
  if (parsed_from_desc) {
    result.descParseStatus = "parsed_from_desc";
  }
  return result;
}

export function enrich_case_fields(case_: Record<string, any>, case_id: any = null): Record<string, any> {
  return enrich_test_case_fields(case_, case_id);
}
