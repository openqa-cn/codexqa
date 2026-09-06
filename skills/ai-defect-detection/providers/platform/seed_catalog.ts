/** Vendor-neutral default tags and rules for the local platform. */

function json_dumps(value: any): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => json_dumps(v)).join(", ")}]`;
  if (typeof value === "object") {
    const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${json_dumps(v)}`);
    return `{${parts.join(", ")}}`;
  }
  return JSON.stringify(value);
}

export function _tag(tag_id: number, name: string, children: Record<string, any>[] | null = null): Record<string, any> {
  const node: Record<string, any> = {
    id: tag_id,
    tagId: tag_id,
    name,
    tagName: name,
    parentId: 0,
    children: children || [],
  };
  for (const child of node.children) {
    child.parentId = tag_id;
  }
  return node;
}

export function _child(tag_id: number, name: string): Record<string, any> {
  return {
    id: tag_id,
    tagId: tag_id,
    name,
    tagName: name,
    parentId: 0,
    children: [],
  };
}

export const DEFAULT_TAGS = [
  _tag(1, "Null pointer / null value", [
    _child(101, "Null dereference"),
    _child(102, "Return value not null-checked"),
    _child(103, "Optional value unhandled"),
    _child(104, "Parameter / null check"),
    _child(105, "Null pointer"),
  ]),
  _tag(2, "Boundary", [
    _child(201, "Numeric overflow"),
    _child(202, "Empty collection / empty string"),
    _child(203, "Index out of bounds"),
  ]),
  _tag(3, "Concurrency", [
    _child(301, "Race condition"),
    _child(302, "Unsynchronized shared state"),
  ]),
  _tag(4, "Business rule deviation", [
    _child(401, "Wrong condition"),
    _child(402, "Spec vs implementation mismatch"),
  ]),
  _tag(5, "Exception handling", [
    _child(501, "Swallowed exception"),
    _child(502, "Over-broad catch"),
    _child(503, "Unchecked exception escape"),
  ]),
  _tag(6, "Logic and data validity", [
    _child(61, "Self-assignment / no-op assignment"),
    _child(62, "Always-true / always-false condition"),
  ]),
  _tag(7, "Security and permissions", [
    _child(701, "Injection risk"),
    _child(702, "Missing authorization"),
    _child(703, "Remote code execution"),
  ]),
  _tag(8, "Performance and resources", [
    _child(801, "Resource leak"),
    _child(802, "Unbounded loop or oversized allocation"),
  ]),
  _tag(9, "Compatibility"),
  _tag(10, "Maintainability"),
  _tag(11, "Missing functionality"),
  _tag(12, "Implementation drift"),
  _tag(13, "Call-chain propagation", [
    _child(131, "Error rethrown without translation"),
    _child(132, "Null propagated along call chain"),
  ]),
  _tag(14, "SQL / data access"),
  _tag(15, "Frontend / client"),
];

export function _ast_rule(
  rule_id: number,
  code: string,
  title: string,
  yaml_text: string,
  tag_id: number,
  strategy_id = "8",
): Record<string, any> {
  return {
    id: rule_id,
    ruleCode: code,
    title,
    category: 1,
    valid: 1,
    tagId: tag_id,
    strategyId: strategy_id,
    language: "java",
    description: json_dumps({ semgrepYaml: yaml_text.trim() + "\n" }),
  };
}

export function _nl_rule(
  rule_id: number,
  code: string,
  title: string,
  category: number,
  logic: string,
  tag_id: number,
  extra: Record<string, any> | null = null,
  strategy_id = "",
): Record<string, any> {
  const payload: Record<string, any> = {
    schema_version: "rule_description_v1",
    rule_logic: logic,
  };
  if (extra) {
    Object.assign(payload, extra);
  }
  if (!strategy_id) {
    strategy_id = ({ 2: "11", 3: "8,10,11", 4: "10" } as Record<number, string>)[category] || "11";
  }
  const record: Record<string, any> = {
    id: rule_id,
    ruleCode: code,
    title,
    category,
    valid: 1,
    tagId: tag_id,
    strategyId: strategy_id,
    description: json_dumps(payload),
  };
  if (extra && extra.parentRuleId !== undefined && extra.parentRuleId !== null) {
    record.parentRuleId = extra.parentRuleId;
  }
  return record;
}

export const AST_RULES = [
  _ast_rule(1001, "AST-EXC-001", "Empty catch swallows exceptions", `
rules:
  - id: AST-EXC-001
    message: Empty catch block swallows the exception
    languages: [java]
    severity: WARNING
    pattern: |
      try {
        ...
      } catch ($T $E) {
      }
`, 501),
  _ast_rule(1002, "AST-EQ-001", "Reference equality used for objects", `
rules:
  - id: AST-EQ-001
    message: Object comparison uses == instead of equals
    languages: [java]
    severity: WARNING
    patterns:
      - pattern: $X == $Y
      - metavariable-regex:
          metavariable: $X
          regex: ^(?!null$)[A-Z].*
`, 62),
  _ast_rule(1003, "AST-SQL-001", "SQL built by string concatenation", `
rules:
  - id: AST-SQL-001
    message: SQL statement is built with string concatenation
    languages: [java]
    severity: ERROR
    pattern-either:
      - pattern: $C.prepareStatement($A + $B)
      - pattern: $C.createQuery($A + $B)
      - pattern: $C.execute($A + $B)
`, 701),
  _ast_rule(1004, "AST-RES-001", "Closeable opened without try-with-resources", `
rules:
  - id: AST-RES-001
    message: Closeable resource is created outside try-with-resources
    languages: [java]
    severity: WARNING
    pattern-either:
      - pattern: new FileInputStream(...)
      - pattern: new FileOutputStream(...)
      - pattern: new FileReader(...)
      - pattern: new FileWriter(...)
`, 801),
  _ast_rule(1005, "AST-NPE-001", "Optional.get without isPresent", `
rules:
  - id: AST-NPE-001
    message: Optional.get() is called without isPresent/orElse
    languages: [java]
    severity: ERROR
    patterns:
      - pattern: $OPT.get()
      - metavariable-regex:
          metavariable: $OPT
          regex: .*Optional.*
`, 101),
  _ast_rule(1006, "AST-BOOL-001", "Assignment used as boolean condition", `
rules:
  - id: AST-BOOL-001
    message: Assignment used inside a boolean condition
    languages: [java]
    severity: WARNING
    pattern-either:
      - pattern: if ($X = $Y) { ... }
      - pattern: while ($X = $Y) { ... }
`, 62),
  _ast_rule(1007, "AST-RET-001", "Method returns null from a collection lookup", `
rules:
  - id: AST-RET-001
    message: Direct return of a map/list lookup that may be null
    languages: [java]
    severity: WARNING
    pattern-either:
      - pattern: return $M.get($K);
      - pattern: return $L.get($I);
`, 102),
  _ast_rule(1008, "AST-TH-001", "printStackTrace instead of structured handling", `
rules:
  - id: AST-TH-001
    message: Exception is only printed, not handled
    languages: [java]
    severity: INFO
    pattern: |
      catch ($T $E) {
        $E.printStackTrace();
      }
`, 501),
];

export const CUSTOM_AI_RULES = [
  _nl_rule(2001, "AI-NULL-001", "Caller does not guard a nullable callee result", 2,
    "If a method can return null and the caller uses a field or method on the result without a null check, report a suspected defect.", 102),
  _nl_rule(2002, "AI-BIZ-001", "Implementation adds or drops a documented constraint", 2,
    "When a test case or requirement states condition A but the code adds extra condition B, or drops B, mark a specification mismatch.", 402),
  _nl_rule(2003, "AI-CHAIN-001", "Unchecked error propagates across a call chain", 2,
    "If an error or empty value originates in a callee and the caller forwards it without translation or fallback, report call-chain propagation.", 13),
  _nl_rule(2004, "AI-CONC-001", "Shared mutable state updated without coordination", 2,
    "If a field used by multiple threads is read and written without synchronization, locks, or concurrent types, report a concurrency risk.", 301),
  _nl_rule(2005, "AI-BOUND-001", "Empty collection or list get(0) without a size check", 2,
    "If the code calls get(0) or equivalent on a list/array that may be empty, report a boundary defect.", 203),
  _nl_rule(2006, "AI-ASSIGN-001", "Self-assignment or write that cannot change state", 2,
    "If a field is assigned to itself, or a computed value is discarded, report an ineffective assignment.", 61),
  _nl_rule(2007, "AI-EXC-001", "Catch block ignores a failure that callers must see", 2,
    "If a catch block logs nothing, returns a success-shaped result, or continues as if the call succeeded, report swallowed exception handling.", 501),
];

export const EXCLUSION_RULES = [
  _nl_rule(
    3001,
    "EXCL-NULL-INIT",
    "Null branch re-initializes the value before use",
    3,
    "If a field or local is checked for null and the null branch assigns a new non-null value (setter or constructor) before any later use, treat the later use as safe and do not report a null-dereference defect.",
    101,
    {
      scene_title: "Null check followed by re-initialization is safe",
      rule_type: "EXCLUSION",
      parentRuleId: 1005,
      business_knowledge: (
        "A common lazy-init pattern: if a getter returns null, the same branch "
        + "assigns a new collection or object through the matching setter. Later "
        + "calls on that field are then safe."
      ),
      code_example: (
        "if (request.getAttrs() == null) {\n"
        + "    request.setAttrs(new HashMap<>());\n"
        + "}\n"
        + "request.getAttrs().put(key, value);"
      ),
      pattern_keywords: [
        "null check", "lazy init", "setter", "HashMap", "NPE exclusion",
      ],
      reason: (
        "The null branch replaces the empty value before use, so a later "
        + "method call is not a null dereference."
      ),
      code_anchors: {
        class_names: [],
        method_names: [],
        object_names: ["request"],
        api_calls: ["getAttrs", "setAttrs"],
      },
    },
  ),
  _nl_rule(
    3002,
    "EXCL-TEST-ONLY",
    "Code path exists only in tests or fixtures",
    3,
    "If the match lives under a test or fixture directory and is not reachable from production entry points, exclude it from defect write-back.",
    10,
    {
      scene_title: "Test-only or fixture code",
      rule_type: "EXCLUSION",
      pattern_keywords: ["src/test", "fixture", "mock"],
      reason: "Test helpers are not production defects.",
    },
  ),
  _nl_rule(
    3003,
    "EXCL-FIELD-INIT",
    "Constructor initializes each field once before first use",
    3,
    "If an object is constructed and each field is assigned a non-null value on a distinct line before any getter is used, do not report those later getters as null dereferences.",
    101,
    {
      scene_title: "Per-field initialization after construction",
      rule_type: "EXCLUSION",
      parentRuleId: 1005,
      pattern_keywords: ["constructor", "setter", "field init"],
      reason: "Fields are populated before use; later getters are safe.",
    },
  ),
];

export const FRONTEND_RULES = [
  _nl_rule(4001, "FE-001", "React Hook rules", 4,
    "useEffect missing dependencies, conditional Hook calls, or missing cleanup.", 15),
  _nl_rule(4002, "FE-002", "Unsafe type assertions", 4,
    "as any or non-null assertions that hide a real null or shape mismatch.", 15),
  _nl_rule(4003, "FE-003", "Event listener leak", 4,
    "addEventListener without a matching remove on unmount.", 15),
  _nl_rule(4004, "FE-004", "Async race or swallowed rejection", 4,
    "Overlapping async calls without abort, or missing catch on a Promise.", 15),
  _nl_rule(4005, "FE-005", "Stale closure state", 4,
    "Timeouts or listeners capture a stale state value instead of a ref or functional update.", 15),
  _nl_rule(4006, "FE-006", "Direct DOM bypass", 4,
    "document.getElementById or innerHTML used where the framework already owns the node.", 15),
  _nl_rule(4007, "FE-007", "Impression callback not de-duplicated", 4,
    "List item appear callbacks fire more than once for the same item without a Set/Map guard.", 15),
  _nl_rule(4008, "FE-008", "Storage read/write namespace mismatch", 4,
    "Read and write use different storage APIs or key prefixes.", 15),
  _nl_rule(4009, "FE-009", "Visibility flag skips frequency control", 4,
    "shouldShow or visible is set true on a path that never checks the display-frequency limit.", 15),
  _nl_rule(4010, "FE-010", "Context field stripped in transit", 4,
    "A required field such as limit or enabled is deleted or omitted while passing context/props.", 15),
  _nl_rule(4011, "FE-011", "Side effect in the wrong lifecycle", 4,
    "Unconditional expose or network work in didMount/render, or derived-state loops.", 15),
  _nl_rule(4012, "FE-012", "Missing optional chaining on nullable access", 4,
    "API, props, or array [0] access without a null/empty guard.", 15),
];

export function build_rules_payload(): Record<string, any> {
  const custom = AST_RULES.concat(CUSTOM_AI_RULES, EXCLUSION_RULES, FRONTEND_RULES);
  return {
    customRules: custom,
    astRules: AST_RULES,
    exclusionRules: EXCLUSION_RULES,
    systemRules: FRONTEND_RULES,
  };
}

export const DEFAULT_RULES = build_rules_payload();

export function flatten_tag_ids(tags: any[] | null = null): number[] {
  const ids: number[] = [];

  function walk(nodes: any[]): void {
    for (const node of nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const tid = node.id ?? node.tagId;
      if (tid !== undefined && tid !== null) {
        ids.push(parseInt(String(tid), 10));
      }
      const children = node.children || [];
      if (Array.isArray(children)) {
        walk(children);
      }
    }
  }

  walk(tags !== null ? tags : DEFAULT_TAGS);
  return ids;
}

export function is_legacy_tag_catalog(tags: any): boolean {
  if (!Array.isArray(tags) || !tags.length) return true;
  if (tags.some((t) => t && typeof t === "object" && !Array.isArray(t) && t.children && t.children.length)) {
    return false;
  }
  return tags.length <= 12 && tags.every((t) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) return true;
    return (t.tagId || t.id || 0) <= 12;
  });
}

export function is_legacy_rule_catalog(rules: any): boolean {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return true;
  const custom = rules.customRules || [];
  const ast_rules = rules.astRules || [];
  if (!custom.length) {
    return ast_rules.length <= 2;
  }
  return !custom.some((r: any) => r && typeof r === "object" && !Array.isArray(r) && r.strategyId);
}
