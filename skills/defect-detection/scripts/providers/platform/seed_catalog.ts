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

function _tag(tag_id: number, name: string, children: Record<string, any>[] | null = null): Record<string, any> {
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

function _child(tag_id: number, name: string): Record<string, any> {
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

/**
 * OWASP Top 10 2025 (versioned A0x on AST seeds):
 * - A05 Injection — SQLi, command injection, XSS, eval / dynamic-code injection
 * - A01 Broken Access Control — SSRF (2021 A10 folded here) and open redirect / path traversal
 * Supply-chain (A03) and generic broken-access (authz gaps) are N/A on AST seeds.
 * ASVS 5.0 ids are citation hints only — not a new required HTTP field.
 */
export function ast_rule_metadata(code: string): {
  cwe: string[];
  owaspTop10_2025: string[];
  asvs50: string[];
} {
  if (
    code === "AST-SQL-001" || code === "AST-PY-001" || code === "AST-GO-001" ||
    code === "AST-JS-004" || code === "AST-CS-001" || code === "AST-KT-001" ||
    code === "AST-SC-001"
  ) {
    return { cwe: ["CWE-89"], owaspTop10_2025: ["A05"], asvs50: ["V5.3.4"] };
  }
  if (
    code === "AST-SSRF-001" || code === "AST-PY-012" || code === "AST-GO-009" ||
    code === "AST-JS-013" || code === "AST-CS-011" || code === "AST-KT-008" ||
    code === "AST-SC-009" || code === "AST-TS-007"
  ) {
    return { cwe: ["CWE-918"], owaspTop10_2025: ["A01"], asvs50: ["V12.6.1"] };
  }
  if (
    code === "AST-PY-014" || code === "AST-GO-008" || code === "AST-JS-002" ||
    code === "AST-JS-011" || code === "AST-CS-010"
  ) {
    return { cwe: ["CWE-79"], owaspTop10_2025: ["A05"], asvs50: ["V5.3.3"] };
  }
  if (
    code === "AST-PY-002" || code === "AST-PY-008" || code === "AST-GO-002" ||
    code === "AST-JS-003" || code === "AST-C-003" || code === "AST-CS-003" ||
    code === "AST-CPP-002" || code === "AST-KT-002" || code === "AST-SC-002"
  ) {
    return { cwe: ["CWE-78"], owaspTop10_2025: ["A05"], asvs50: ["V5.2.1"] };
  }
  if (
    code === "AST-PY-006" || code === "AST-GO-006" || code === "AST-JS-005" ||
    code === "AST-CS-005" || code === "AST-CPP-005" || code === "AST-KT-005" ||
    code === "AST-SC-005"
  ) {
    return { cwe: ["CWE-22"], owaspTop10_2025: ["A01"], asvs50: ["V5.4.3"] };
  }
  if (
    code === "AST-PY-010" || code === "AST-GO-007" || code === "AST-JS-006" ||
    code === "AST-CPP-006" || code === "AST-CS-009" || code === "AST-KT-006" ||
    code === "AST-SC-006"
  ) {
    return { cwe: ["CWE-798"], owaspTop10_2025: [], asvs50: ["V6.2.1"] };
  }
  if (code === "AST-PY-013" || code === "AST-JS-014") {
    return { cwe: ["CWE-601"], owaspTop10_2025: ["A01"], asvs50: ["V3.5.1"] };
  }
  if (code === "AST-PY-005" || code === "AST-JS-001" || code === "AST-JS-010" || code === "AST-TS-005") {
    return { cwe: ["CWE-95"], owaspTop10_2025: ["A05"], asvs50: ["V5.2.1"] };
  }
  if (code === "AST-PY-003" || code === "AST-CS-004" || code === "AST-KT-007" || code === "AST-SC-007") {
    return { cwe: ["CWE-502"], owaspTop10_2025: ["A08"], asvs50: ["V5.5.1"] };
  }
  if (
    code === "AST-PY-011" || code === "AST-GO-005" || code === "AST-JS-012" ||
    code === "AST-CS-008" || code === "AST-KT-004" || code === "AST-KT-010" ||
    code === "AST-SC-004"
  ) {
    return { cwe: ["CWE-295"], owaspTop10_2025: ["A02"], asvs50: ["V9.2.1"] };
  }
  if (
    code === "AST-EXC-001" || code === "AST-TH-001" || code === "AST-PY-004" || code === "AST-PY-EXC-001" ||
    code === "AST-GO-004" || code === "AST-JS-008" || code === "AST-CPP-003" ||
    code === "AST-CS-002" || code === "AST-KT-003" || code === "AST-SC-003"
  ) {
    return { cwe: ["CWE-390"], owaspTop10_2025: ["A10"], asvs50: ["V7.1.1"] };
  }
  if (code === "AST-RES-001" || code === "AST-PY-007" || code === "AST-CS-006") {
    return { cwe: ["CWE-404"], owaspTop10_2025: ["A10"], asvs50: ["V12.1.1"] };
  }
  if (
    code === "AST-NPE-001" || code === "AST-RET-001" || code === "AST-C-004" ||
    code === "AST-C-006" || code === "AST-TS-002" || code === "AST-KT-009"
  ) {
    return { cwe: ["CWE-476"], owaspTop10_2025: ["A10"], asvs50: ["V5.1.1"] };
  }
  if (code === "AST-BOOL-001" || code === "AST-JS-009") {
    return { cwe: ["CWE-481"], owaspTop10_2025: [], asvs50: ["V5.1.3"] };
  }
  if (code === "AST-EQ-001") {
    return { cwe: ["CWE-595"], owaspTop10_2025: [], asvs50: ["V5.1.3"] };
  }
  if (code === "AST-JS-EQ-001") {
    return { cwe: ["CWE-597"], owaspTop10_2025: [], asvs50: ["V5.1.3"] };
  }
  if (code === "AST-TS-001" || code === "AST-TS-003" || code === "AST-TS-004" || code === "AST-TS-006") {
    return { cwe: ["CWE-710"], owaspTop10_2025: ["A05"], asvs50: ["V5.1.3"] };
  }
  if (code === "AST-PY-009" || code === "AST-GO-003" || code === "AST-CS-007" || code === "AST-SC-008" || code === "AST-KT-011") {
    return { cwe: ["CWE-400"], owaspTop10_2025: ["A10"], asvs50: ["V11.1.1"] };
  }
  if (
    code === "AST-C-001" || code === "AST-C-005" || code === "AST-CPP-001" ||
    code === "AST-CPP-007"
  ) {
    return { cwe: ["CWE-120"], owaspTop10_2025: ["A05"], asvs50: ["V5.4.1"] };
  }
  if (code === "AST-C-002" || code === "AST-CPP-004") {
    return { cwe: ["CWE-134"], owaspTop10_2025: ["A05"], asvs50: ["V5.2.1"] };
  }
  if (code === "AST-C-007") {
    return { cwe: ["CWE-377"], owaspTop10_2025: ["A02"], asvs50: ["V12.3.1"] };
  }
  if (code === "AST-JS-BOUND-001") {
    return { cwe: ["CWE-20"], owaspTop10_2025: ["A05"], asvs50: ["V5.1.3"] };
  }
  if (code === "AST-PY-EQ-001") {
    return { cwe: ["CWE-480"], owaspTop10_2025: [], asvs50: ["V5.1.3"] };
  }
  if (code === "AST-PY-MUT-001") {
    return { cwe: ["CWE-665"], owaspTop10_2025: [], asvs50: ["V5.1.3"] };
  }
  return { cwe: ["CWE-710"], owaspTop10_2025: [], asvs50: [] };
}

function _ast_rule(
  rule_id: number,
  code: string,
  title: string,
  yaml_text: string,
  tag_id: number,
  strategy_id = "8",
  language = "java",
): Record<string, any> {
  const meta = ast_rule_metadata(code);
  return {
    id: rule_id,
    ruleCode: code,
    title,
    category: 1,
    valid: 1,
    tagId: tag_id,
    strategyId: strategy_id,
    language,
    description: json_dumps({
      semgrepYaml: yaml_text.trim() + "\n",
      cwe: meta.cwe,
      owaspTop10_2025: meta.owaspTop10_2025,
      asvs50: meta.asvs50,
    }),
  };
}

function _nl_rule(
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
    mode: taint
    message: Tainted data flows into a SQL API
    languages: [java]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $M(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
      - pattern: $REQ.getHeader(...)
      - pattern: $REQ.getQueryString()
    pattern-sinks:
      - patterns:
          - pattern: $C.prepareStatement($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $C.createQuery($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $C.execute($Q, ...)
          - focus-metavariable: $Q
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
  _ast_rule(1009, "AST-SSRF-001", "SSRF: request data flows to URL / HttpClient / RestTemplate", `
rules:
  - id: AST-SSRF-001
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [java]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $M(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
      - pattern: $REQ.getHeader(...)
      - pattern: $REQ.getQueryString()
      - pattern: $P.getQueryParam(...)
    pattern-sinks:
      - patterns:
          - pattern: new URL($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: new URI($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: new HttpGet($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: new HttpPost($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.getForObject($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.getForEntity($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.exchange($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.postForObject($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: HttpRequest.newBuilder($URL, ...)
          - focus-metavariable: $URL
`, 701),
  _ast_rule(1101, "AST-PY-001", "SQL built by string concatenation or f-string", `
rules:
  - id: AST-PY-001
    mode: taint
    message: Tainted data flows into a SQL execute API
    languages: [python]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              def $F(..., $SRC, ...):
                ...
          - focus-metavariable: $SRC
      - pattern: request.args.get(...)
      - pattern: request.GET.get(...)
      - pattern: request.form.get(...)
      - pattern: sys.argv
    pattern-sinks:
      - patterns:
          - pattern: $CUR.execute($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $CUR.executemany($Q, ...)
          - focus-metavariable: $Q
`, 701, "8", "python"),
  _ast_rule(1102, "AST-PY-002", "subprocess with shell=True", `
rules:
  - id: AST-PY-002
    mode: taint
    message: Tainted data flows into subprocess with shell=True
    languages: [python]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              def $F(..., $SRC, ...):
                ...
          - focus-metavariable: $SRC
      - pattern: request.args.get(...)
      - pattern: request.GET.get(...)
      - pattern: sys.argv
    pattern-sinks:
      - patterns:
          - pattern: subprocess.run($CMD, ..., shell=True, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: subprocess.Popen($CMD, ..., shell=True, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: subprocess.call($CMD, ..., shell=True, ...)
          - focus-metavariable: $CMD
`, 703, "8", "python"),
  _ast_rule(1103, "AST-PY-003", "Unsafe deserialize pickle/yaml.load", `
rules:
  - id: AST-PY-003
    message: Untrusted deserialize via pickle.load or yaml.load
    languages: [python]
    severity: ERROR
    pattern-either:
      - pattern: pickle.load(...)
      - pattern: pickle.loads(...)
      - pattern: yaml.load(...)
`, 703, "8", "python"),
  _ast_rule(1104, "AST-PY-004", "Bare except swallows errors", `
rules:
  - id: AST-PY-004
    message: "Bare except: swallows all exceptions"
    languages: [python]
    severity: WARNING
    pattern: |
      try:
        ...
      except:
        ...
`, 501, "8", "python"),
  _ast_rule(1105, "AST-PY-005", "eval or exec of dynamic code", `
rules:
  - id: AST-PY-005
    message: eval/exec executes dynamic code
    languages: [python]
    severity: ERROR
    pattern-either:
      - pattern: eval(...)
      - pattern: exec(...)
`, 703, "8", "python"),
  _ast_rule(1106, "AST-PY-006", "Path join with user-controlled segment", `
rules:
  - id: AST-PY-006
    mode: taint
    message: Tainted data flows into a filesystem path join
    languages: [python]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              def $F(..., $SRC, ...):
                ...
          - focus-metavariable: $SRC
      - pattern: request.args.get(...)
      - pattern: request.GET.get(...)
      - pattern: request.form.get(...)
      - pattern: sys.argv
    pattern-sinks:
      - patterns:
          - pattern: os.path.join($BASE, $SEG, ...)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: pathlib.Path($BASE) / $SEG
          - focus-metavariable: $SEG
`, 701, "8", "python"),
  _ast_rule(1107, "AST-PY-007", "open/urlopen without a with-statement", `
rules:
  - id: AST-PY-007
    message: File or URL is opened without a with-statement
    languages: [python]
    severity: WARNING
    pattern-either:
      - pattern: $F = open(...)
      - pattern: $F = urlopen(...)
      - pattern: $F = urllib.request.urlopen(...)
`, 801, "8", "python"),
  _ast_rule(1108, "AST-PY-008", "os.system or os.popen shell command", `
rules:
  - id: AST-PY-008
    mode: taint
    message: Tainted data flows into os.system/os.popen/commands.getoutput
    languages: [python]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              def $F(..., $SRC, ...):
                ...
          - focus-metavariable: $SRC
      - pattern: request.args.get(...)
      - pattern: request.GET.get(...)
      - pattern: sys.argv
    pattern-sinks:
      - patterns:
          - pattern: os.system($CMD)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: os.popen($CMD, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: commands.getoutput($CMD)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: commands.getstatusoutput($CMD)
          - focus-metavariable: $CMD
`, 703, "8", "python"),
  _ast_rule(1109, "AST-PY-009", "requests call without timeout", `
rules:
  - id: AST-PY-009
    message: HTTP request is made without an explicit timeout
    languages: [python]
    severity: WARNING
    patterns:
      - pattern-either:
          - pattern: requests.get(...)
          - pattern: requests.post(...)
          - pattern: requests.put(...)
          - pattern: requests.delete(...)
          - pattern: requests.head(...)
          - pattern: requests.patch(...)
          - pattern: requests.request(...)
      - pattern-not: requests.get(..., timeout=$T, ...)
      - pattern-not: requests.post(..., timeout=$T, ...)
      - pattern-not: requests.put(..., timeout=$T, ...)
      - pattern-not: requests.delete(..., timeout=$T, ...)
      - pattern-not: requests.head(..., timeout=$T, ...)
      - pattern-not: requests.patch(..., timeout=$T, ...)
      - pattern-not: requests.request(..., timeout=$T, ...)
`, 801, "8", "python"),
  _ast_rule(1110, "AST-PY-010", "Hardcoded secret assignment", `
rules:
  - id: AST-PY-010
    message: Hardcoded secret-like assignment
    languages: [python]
    severity: WARNING
    patterns:
      - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "python"),
  _ast_rule(1111, "AST-PY-011", "TLS verification disabled on requests", `
rules:
  - id: AST-PY-011
    message: TLS certificate verification is disabled
    languages: [python]
    severity: ERROR
    pattern-either:
      - pattern: requests.get(..., verify=False, ...)
      - pattern: requests.post(..., verify=False, ...)
      - pattern: requests.put(..., verify=False, ...)
      - pattern: requests.delete(..., verify=False, ...)
      - pattern: requests.request(..., verify=False, ...)
      - pattern: requests.head(..., verify=False, ...)
`, 701, "8", "python"),
  _ast_rule(1112, "AST-PY-012", "SSRF: request data flows to HTTP client", `
rules:
  - id: AST-PY-012
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [python]
    severity: ERROR
    pattern-sources:
      - pattern: request.args.get(...)
      - pattern: request.args[...]
      - pattern: request.form.get(...)
      - pattern: request.form[...]
      - pattern: request.json.get(...)
      - pattern: request.GET.get(...)
      - pattern: request.GET[...]
      - pattern: request.POST.get(...)
      - pattern: request.POST[...]
      - pattern: request.query_params.get(...)
      - pattern: request.query_params[...]
    pattern-sinks:
      - patterns:
          - pattern: requests.get($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: requests.post($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: requests.request($M, $URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: urllib.request.urlopen($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: urlopen($URL, ...)
          - focus-metavariable: $URL
`, 701, "8", "python"),
  _ast_rule(1113, "AST-PY-013", "Open redirect: request data flows to redirect", `
rules:
  - id: AST-PY-013
    mode: taint
    message: Untrusted request data flows to a redirect (open redirect)
    languages: [python]
    severity: ERROR
    pattern-sources:
      - pattern: request.args.get(...)
      - pattern: request.args[...]
      - pattern: request.GET.get(...)
      - pattern: request.GET[...]
      - pattern: request.query_params.get(...)
      - pattern: request.query_params[...]
    pattern-sinks:
      - patterns:
          - pattern: redirect($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: HttpResponseRedirect($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: RedirectResponse($URL, ...)
          - focus-metavariable: $URL
`, 701, "8", "python"),
  _ast_rule(1114, "AST-PY-014", "XSS taint: request data flows to mark_safe/Markup", `
rules:
  - id: AST-PY-014
    mode: taint
    message: Untrusted request data flows to mark_safe or Markup (XSS)
    languages: [python]
    severity: ERROR
    pattern-sources:
      - pattern: request.args.get(...)
      - pattern: request.args[...]
      - pattern: request.form.get(...)
      - pattern: request.GET.get(...)
      - pattern: request.GET[...]
      - pattern: request.POST.get(...)
    pattern-sinks:
      - patterns:
          - pattern: mark_safe($X)
          - focus-metavariable: $X
      - patterns:
          - pattern: Markup($X)
          - focus-metavariable: $X
    pattern-sanitizers:
      - pattern: html.escape(...)
      - pattern: bleach.clean(...)
`, 701, "8", "python"),
  // Python Semgrep rules (category=1). Kept when project language is python.
  _ast_rule(1115, "AST-PY-EXC-001", "Typed except block only passes (Python)", `
rules:
  - id: AST-PY-EXC-001
    message: except block swallows the exception with a bare pass
    languages: [python]
    severity: WARNING
    pattern-either:
      - pattern: |
          try:
            ...
          except $E:
            pass
      - pattern: |
          try:
            ...
          except $E as $N:
            pass
`, 501, "8", "python"),
  _ast_rule(1116, "AST-PY-EQ-001", "Equality comparison with None (Python)", `
rules:
  - id: AST-PY-EQ-001
    message: Comparison with None uses == / != instead of is / is not
    languages: [python]
    severity: INFO
    pattern-either:
      - pattern: $X == None
      - pattern: None == $X
      - pattern: $X != None
      - pattern: None != $X
`, 62, "8", "python"),
  _ast_rule(1117, "AST-PY-MUT-001", "Mutable default argument (Python)", `
rules:
  - id: AST-PY-MUT-001
    message: Mutable default argument is shared across calls and leaks state
    languages: [python]
    severity: WARNING
    pattern-either:
      - pattern: |
          def $F(..., $A=[], ...):
            ...
      - pattern: |
          def $F(..., $A={}, ...):
            ...
      - pattern: |
          def $F(..., $A=set(), ...):
            ...
`, 302, "8", "python"),
  _ast_rule(1201, "AST-GO-001", "SQL built by string concatenation", `
rules:
  - id: AST-GO-001
    mode: taint
    message: Tainted data flows into a SQL API
    languages: [go]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              func $F(..., $SRC $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $R.URL.Query().Get(...)
      - pattern: $R.FormValue(...)
      - pattern: os.Args
    pattern-sinks:
      - patterns:
          - pattern: $DB.Query($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $DB.Exec($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $DB.QueryRow($Q, ...)
          - focus-metavariable: $Q
`, 701, "8", "go"),
  _ast_rule(1202, "AST-GO-002", "exec.Command with unsanitized input", `
rules:
  - id: AST-GO-002
    mode: taint
    message: Tainted data flows into exec.Command
    languages: [go]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              func $F(..., $SRC $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $R.URL.Query().Get(...)
      - pattern: $R.FormValue(...)
      - pattern: os.Args
    pattern-sinks:
      - patterns:
          - pattern: exec.Command($CMD, ...)
          - focus-metavariable: $CMD
`, 703, "8", "go"),
  _ast_rule(1203, "AST-GO-003", "HTTP client created without timeout", `
rules:
  - id: AST-GO-003
    message: HTTP client or Get/Post is used without an explicit timeout
    languages: [go]
    severity: WARNING
    pattern-either:
      - pattern: http.Get($URL)
      - pattern: http.Post($URL, $T, $B)
      - pattern: http.Client{}
`, 801, "8", "go"),
  _ast_rule(1204, "AST-GO-004", "Error ignored on a critical call", `
rules:
  - id: AST-GO-004
    message: Error return from a critical call is discarded
    languages: [go]
    severity: WARNING
    pattern-either:
      - pattern: $X, _ := $DB.Exec(...)
      - pattern: $X, _ = $F.Write(...)
      - pattern: $X, _ := os.Open(...)
`, 501, "8", "go"),
  _ast_rule(1205, "AST-GO-005", "TLS InsecureSkipVerify enabled", `
rules:
  - id: AST-GO-005
    message: TLS config sets InsecureSkipVerify
    languages: [go]
    severity: ERROR
    pattern: |
      tls.Config{..., InsecureSkipVerify: true, ...}
`, 701, "8", "go"),
  _ast_rule(1206, "AST-GO-006", "Path traversal via unsanitized join", `
rules:
  - id: AST-GO-006
    mode: taint
    message: Tainted data flows into a filesystem path
    languages: [go]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              func $F(..., $SRC $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $R.URL.Query().Get(...)
      - pattern: $R.FormValue(...)
      - pattern: os.Args
    pattern-sinks:
      - patterns:
          - pattern: filepath.Join($BASE, $SEG, ...)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: os.Open($P)
          - focus-metavariable: $P
`, 701, "8", "go"),
  _ast_rule(1207, "AST-GO-007", "Hardcoded secret assignment", `
rules:
  - id: AST-GO-007
    message: Hardcoded secret-like assignment
    languages: [go]
    severity: WARNING
    patterns:
      - pattern-either:
          - pattern: $KEY := "$VAL"
          - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "go"),
  _ast_rule(1208, "AST-GO-008", "Unescaped template.HTML / template.JS", `
rules:
  - id: AST-GO-008
    message: Unescaped HTML or JS is injected into a template
    languages: [go]
    severity: ERROR
    pattern-either:
      - pattern: template.HTML($X)
      - pattern: template.JS($X)
      - pattern: template.HTMLAttr($X)
`, 701, "8", "go"),
  _ast_rule(1209, "AST-GO-009", "SSRF: request data flows to http.Get/Post", `
rules:
  - id: AST-GO-009
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [go]
    severity: ERROR
    pattern-sources:
      - pattern: $R.URL.Query().Get(...)
      - pattern: $R.FormValue(...)
      - pattern: $R.PostFormValue(...)
      - pattern: $R.Form.Get(...)
    pattern-sinks:
      - patterns:
          - pattern: http.Get($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: http.Post($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: http.NewRequest($M, $URL, ...)
          - focus-metavariable: $URL
`, 701, "8", "go"),
  _ast_rule(1301, "AST-JS-001", "eval or new Function", `
rules:
  - id: AST-JS-001
    message: eval or new Function executes dynamic code
    languages: [javascript, typescript]
    severity: ERROR
    pattern-either:
      - pattern: eval(...)
      - pattern: new Function(...)
`, 703, "8", "javascript"),
  _ast_rule(1302, "AST-JS-002", "innerHTML or dangerouslySetInnerHTML", `
rules:
  - id: AST-JS-002
    message: Unsanitized HTML assignment
    languages: [javascript, typescript]
    severity: ERROR
    pattern-either:
      - pattern: $EL.innerHTML = $X
      - pattern: dangerouslySetInnerHTML
`, 701, "8", "javascript"),
  _ast_rule(1303, "AST-JS-003", "child_process.exec with user input", `
rules:
  - id: AST-JS-003
    mode: taint
    message: Tainted data flows into child_process.exec
    languages: [javascript, typescript]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              function $F(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.query.$X
      - pattern: $REQ.body.$X
      - pattern: $REQ.params.$X
      - pattern: process.argv
    pattern-sinks:
      - patterns:
          - pattern: child_process.exec($CMD, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: exec($CMD, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: execSync($CMD, ...)
          - focus-metavariable: $CMD
`, 703, "8", "javascript"),
  _ast_rule(1304, "AST-JS-004", "SQL or NoSQL string concatenation", `
rules:
  - id: AST-JS-004
    mode: taint
    message: Tainted data flows into a SQL/NoSQL query API
    languages: [javascript, typescript]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              function $F(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.query.$X
      - pattern: $REQ.body.$X
      - pattern: $REQ.params.$X
      - pattern: process.argv
    pattern-sinks:
      - patterns:
          - pattern: $DB.query($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $DB.execute($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $COL.find($Q, ...)
          - focus-metavariable: $Q
`, 701, "8", "javascript"),
  _ast_rule(1305, "AST-JS-005", "Path traversal via join with user input", `
rules:
  - id: AST-JS-005
    mode: taint
    message: Tainted data flows into a filesystem path
    languages: [javascript, typescript]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              function $F(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.query.$X
      - pattern: $REQ.body.$X
      - pattern: $REQ.params.$X
      - pattern: process.argv
    pattern-sinks:
      - patterns:
          - pattern: path.join($BASE, $SEG, ...)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: fs.readFile($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: fs.readFileSync($P, ...)
          - focus-metavariable: $P
`, 701, "8", "javascript"),
  _ast_rule(1306, "AST-JS-006", "Hardcoded secret assignment", `
rules:
  - id: AST-JS-006
    message: Hardcoded secret-like assignment
    languages: [javascript, typescript]
    severity: WARNING
    patterns:
      - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "javascript"),
  // Loose equality against null/undefined is the idiomatic "nullish" check and
  // typeof always yields a string, so those forms are excluded to keep noise down.
  _ast_rule(1307, "AST-JS-EQ-001", "Loose equality used for values (JS/TS)", `
rules:
  - id: AST-JS-EQ-001
    message: Comparison uses == or != instead of === or !== (type coercion may change the result)
    languages: [javascript, typescript]
    severity: INFO
    patterns:
      - pattern-either:
          - pattern: $X == $Y
          - pattern: $X != $Y
      - pattern-not: $X == null
      - pattern-not: null == $X
      - pattern-not: $X != null
      - pattern-not: null != $X
      - pattern-not: $X == undefined
      - pattern-not: undefined == $X
      - pattern-not: $X != undefined
      - pattern-not: undefined != $X
      - metavariable-pattern:
          metavariable: $X
          patterns:
            - pattern-not: typeof $A
      - metavariable-pattern:
          metavariable: $Y
          patterns:
            - pattern-not: typeof $B
`, 62, "8", "javascript"),
  _ast_rule(1308, "AST-JS-008", "Empty catch swallows exceptions", `
rules:
  - id: AST-JS-008
    message: Empty catch block swallows the exception
    languages: [javascript, typescript]
    severity: WARNING
    pattern-either:
      - pattern: |
          try {
            ...
          } catch ($E) {
          }
      - pattern: |
          try {
            ...
          } catch {
          }
`, 501, "8", "javascript"),
  _ast_rule(1309, "AST-JS-009", "Assignment used as boolean condition", `
rules:
  - id: AST-JS-009
    message: Assignment used inside a boolean condition
    languages: [javascript, typescript]
    severity: WARNING
    pattern-either:
      - pattern: if ($X = $Y) { ... }
      - pattern: while ($X = $Y) { ... }
`, 62, "8", "javascript"),
  _ast_rule(1310, "AST-JS-010", "setTimeout or setInterval with a string", `
rules:
  - id: AST-JS-010
    message: setTimeout/setInterval executes a string as code
    languages: [javascript, typescript]
    severity: ERROR
    pattern-either:
      - pattern: setTimeout("$X", ...)
      - pattern: setInterval("$X", ...)
      - pattern: setTimeout($A + $B, ...)
      - pattern: setInterval($A + $B, ...)
`, 703, "8", "javascript"),
  _ast_rule(1311, "AST-JS-011", "document.write injects unsanitized HTML", `
rules:
  - id: AST-JS-011
    message: document.write injects unsanitized HTML
    languages: [javascript, typescript]
    severity: ERROR
    pattern-either:
      - pattern: document.write(...)
      - pattern: document.writeln(...)
`, 701, "8", "javascript"),
  _ast_rule(1312, "AST-JS-012", "TLS rejectUnauthorized disabled", `
rules:
  - id: AST-JS-012
    message: TLS certificate verification is disabled
    languages: [javascript, typescript]
    severity: ERROR
    pattern-either:
      - pattern: |
          {..., rejectUnauthorized: false, ...}
      - pattern: $X.rejectUnauthorized = false
`, 701, "8", "javascript"),
  _ast_rule(1313, "AST-JS-013", "SSRF: request data flows to fetch/axios/http.get", `
rules:
  - id: AST-JS-013
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [javascript, typescript]
    severity: ERROR
    pattern-sources:
      - pattern: $REQ.query.$X
      - pattern: $REQ.query[$K]
      - pattern: $REQ.body.$X
      - pattern: $REQ.body[$K]
      - pattern: $REQ.params.$X
      - pattern: $REQ.params[$K]
    pattern-sinks:
      - patterns:
          - pattern: fetch($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: axios.get($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: axios.post($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: http.get($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: https.get($URL, ...)
          - focus-metavariable: $URL
`, 701, "8", "javascript"),
  _ast_rule(1314, "AST-JS-014", "Open redirect: request data flows to res.redirect", `
rules:
  - id: AST-JS-014
    mode: taint
    message: Untrusted request data flows to res.redirect (open redirect)
    languages: [javascript, typescript]
    severity: ERROR
    pattern-sources:
      - pattern: $REQ.query.$X
      - pattern: $REQ.query[$K]
      - pattern: $REQ.body.$X
      - pattern: $REQ.body[$K]
      - pattern: $REQ.params.$X
      - pattern: $REQ.querystring
    pattern-sinks:
      - patterns:
          - pattern: $RES.redirect($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $RES.redirect($CODE, $URL)
          - focus-metavariable: $URL
`, 701, "8", "javascript"),
  _ast_rule(1315, "AST-JS-BOUND-001", "Numeric guard rejects only negatives, not zero (JS/TS)", `
rules:
  - id: AST-JS-BOUND-001
    message: Amount/size guard uses < 0 and may accept zero when the contract requires a strictly positive value
    languages: [javascript, typescript]
    severity: WARNING
    patterns:
      - pattern-either:
          - pattern: if (<... $X < 0 ...>) { ... }
          - pattern: if (<... $X < 0 ...>) throw ...
      - pattern-not: if (<... $X <= 0 ...>) { ... }
      - pattern-not: if (<... $X <= 0 ...>) throw ...
`, 201, "8", "javascript"),
  _ast_rule(1701, "AST-TS-001", "as any on a security sink", `
rules:
  - id: AST-TS-001
    message: Type assertion as any hides an unsanitized sink
    languages: [typescript]
    severity: ERROR
    pattern-either:
      - pattern: eval($X as any)
      - pattern: $EL.innerHTML = $X as any
      - pattern: exec($X as any, ...)
      - pattern: execSync($X as any, ...)
      - pattern: dangerouslySetInnerHTML = $X as any
`, 701, "8", "typescript"),
  _ast_rule(1702, "AST-TS-002", "Non-null assertion on request or query data", `
rules:
  - id: AST-TS-002
    message: Non-null assertion on nullable request/query data
    languages: [typescript]
    severity: WARNING
    pattern-either:
      - pattern: $REQ.query!
      - pattern: $REQ.query.$X!
      - pattern: $REQ.body!
      - pattern: $REQ.body.$X!
      - pattern: $REQ.params!
      - pattern: $REQ.params.$X!
      - pattern: $REQ.query[$K]!
      - pattern: $REQ.body[$K]!
`, 101, "8", "typescript"),
  _ast_rule(1703, "AST-TS-003", "ts-ignore or ts-expect-error over a sink", `
rules:
  - id: AST-TS-003
    message: TypeScript error suppression sits over a dangerous sink
    languages: [typescript]
    severity: WARNING
    pattern-either:
      - pattern: |
          // @ts-ignore
          eval(...)
      - pattern: |
          // @ts-expect-error
          eval(...)
      - pattern: |
          // @ts-ignore
          $EL.innerHTML = $X
      - pattern: |
          // @ts-expect-error
          $EL.innerHTML = $X
      - pattern: |
          // @ts-ignore
          exec(...)
      - pattern: |
          // @ts-expect-error
          exec(...)
`, 701, "8", "typescript"),
  _ast_rule(1704, "AST-TS-004", "Double assertion as unknown as on a sink", `
rules:
  - id: AST-TS-004
    message: as unknown as bypasses the type checker on a sink
    languages: [typescript]
    severity: ERROR
    pattern-either:
      - pattern: eval($X as unknown as $T)
      - pattern: $EL.innerHTML = $X as unknown as $T
      - pattern: fetch($X as unknown as $T, ...)
      - pattern: exec($X as unknown as $T, ...)
`, 701, "8", "typescript"),
  _ast_rule(1705, "AST-TS-005", "eval or Function with an any-typed argument", `
rules:
  - id: AST-TS-005
    message: eval or Function is called with an any-typed argument
    languages: [typescript]
    severity: ERROR
    pattern-either:
      - pattern: eval($X as any)
      - pattern: Function($X as any)
      - pattern: new Function($X as any)
      - pattern: |
          ($X: any) => {
            ...
            eval($X)
            ...
          }
`, 703, "8", "typescript"),
  _ast_rule(1706, "AST-TS-006", "JSON.parse result asserted as any", `
rules:
  - id: AST-TS-006
    message: JSON.parse is asserted as any, dropping shape checks
    languages: [typescript]
    severity: WARNING
    pattern-either:
      - pattern: JSON.parse(...) as any
      - pattern: JSON.parse(...) as unknown as $T
`, 62, "8", "typescript"),
  _ast_rule(1707, "AST-TS-007", "fetch or URL built from an any-asserted value", `
rules:
  - id: AST-TS-007
    message: Outbound URL is taken from an any assertion
    languages: [typescript]
    severity: ERROR
    pattern-either:
      - pattern: fetch($X as any, ...)
      - pattern: new URL($X as any)
      - pattern: axios.get($X as any, ...)
      - pattern: $C.get($X as any, ...)
`, 701, "8", "typescript"),
  _ast_rule(1401, "AST-C-001", "Unsafe string copy (strcpy/strcat/gets/sprintf)", `
rules:
  - id: AST-C-001
    message: Unbounded C string copy or gets/sprintf
    languages: [c]
    severity: ERROR
    pattern-either:
      - pattern: strcpy(...)
      - pattern: strcat(...)
      - pattern: gets(...)
      - pattern: sprintf(...)
`, 701, "8", "c"),
  _ast_rule(1402, "AST-C-002", "printf with user-controlled format", `
rules:
  - id: AST-C-002
    message: printf uses a non-literal format string
    languages: [c]
    severity: ERROR
    patterns:
      - pattern: printf($FMT, ...)
      - metavariable-regex:
          metavariable: $FMT
          regex: ^(?!".*).*
`, 701, "8", "c"),
  _ast_rule(1403, "AST-C-003", "system() with unsanitized command", `
rules:
  - id: AST-C-003
    mode: taint
    message: Tainted data flows into system()
    languages: [c]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $F(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: argv
      - pattern: getenv(...)
    pattern-sinks:
      - patterns:
          - pattern: system($CMD)
          - focus-metavariable: $CMD
`, 703, "8", "c"),
  _ast_rule(1404, "AST-C-004", "malloc result used without a null check", `
rules:
  - id: AST-C-004
    message: malloc/calloc result is used without a null check
    languages: [c]
    severity: WARNING
    pattern-either:
      - pattern: |
          $P = malloc(...);
          $P->$F = $V;
      - pattern: |
          $P = calloc(...);
          memcpy($P, ...);
`, 101, "8", "c"),
  _ast_rule(1405, "AST-C-005", "scanf with unbounded %s", `
rules:
  - id: AST-C-005
    message: scanf/sscanf uses unbounded %s
    languages: [c]
    severity: ERROR
    patterns:
      - pattern-either:
          - pattern: scanf($FMT, ...)
          - pattern: sscanf($SRC, $FMT, ...)
          - pattern: fscanf($F, $FMT, ...)
      - metavariable-regex:
          metavariable: $FMT
          regex: .*\%s.*
`, 701, "8", "c"),
  _ast_rule(1406, "AST-C-006", "fopen result used without a null check", `
rules:
  - id: AST-C-006
    message: fopen result is used without a null check
    languages: [c]
    severity: WARNING
    pattern-either:
      - pattern: |
          $F = fopen(...);
          fread(..., $F);
      - pattern: |
          $F = fopen(...);
          fwrite(..., $F);
      - pattern: |
          $F = fopen(...);
          fprintf($F, ...);
      - pattern: |
          $F = fopen(...);
          fgets(..., $F);
`, 101, "8", "c"),
  _ast_rule(1407, "AST-C-007", "Insecure temp name tmpnam/mktemp", `
rules:
  - id: AST-C-007
    message: tmpnam/mktemp creates a predictable temp path
    languages: [c]
    severity: ERROR
    pattern-either:
      - pattern: tmpnam(...)
      - pattern: mktemp(...)
`, 701, "8", "c"),
  _ast_rule(1501, "AST-CPP-001", "Unsafe C-family string copy", `
rules:
  - id: AST-CPP-001
    message: Unbounded C string copy in C++
    languages: [cpp]
    severity: ERROR
    pattern-either:
      - pattern: strcpy(...)
      - pattern: strcat(...)
      - pattern: gets(...)
      - pattern: sprintf(...)
`, 701, "8", "cpp"),
  _ast_rule(1502, "AST-CPP-002", "system() with unsanitized command", `
rules:
  - id: AST-CPP-002
    message: system() executes a shell command
    languages: [cpp]
    severity: ERROR
    pattern: system(...)
`, 703, "8", "cpp"),
  _ast_rule(1503, "AST-CPP-003", "Empty catch-all swallows exceptions", `
rules:
  - id: AST-CPP-003
    message: Empty catch (...) swallows the exception
    languages: [cpp]
    severity: WARNING
    pattern: |
      try {
        ...
      } catch (...) {
      }
`, 501, "8", "cpp"),
  _ast_rule(1504, "AST-CPP-004", "printf with user-controlled format", `
rules:
  - id: AST-CPP-004
    message: printf uses a non-literal format string
    languages: [cpp]
    severity: ERROR
    patterns:
      - pattern: printf($FMT, ...)
      - metavariable-regex:
          metavariable: $FMT
          regex: ^(?!".*).*
`, 701, "8", "cpp"),
  _ast_rule(1505, "AST-CPP-005", "Path traversal via ifstream/ofstream concat", `
rules:
  - id: AST-CPP-005
    mode: taint
    message: Tainted data flows into an ifstream/ofstream path
    languages: [cpp]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $F(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: argv
      - pattern: getenv(...)
    pattern-sinks:
      - patterns:
          - pattern: std::ifstream($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: ifstream($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: std::ofstream($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: ofstream($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: std::fstream($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: fstream($P, ...)
          - focus-metavariable: $P
`, 701, "8", "cpp"),
  _ast_rule(1506, "AST-CPP-006", "Hardcoded secret assignment", `
rules:
  - id: AST-CPP-006
    message: Hardcoded secret-like assignment
    languages: [cpp]
    severity: WARNING
    patterns:
      - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "cpp"),
  _ast_rule(1507, "AST-CPP-007", "scanf with unbounded %s", `
rules:
  - id: AST-CPP-007
    message: scanf/sscanf uses unbounded %s
    languages: [cpp]
    severity: ERROR
    patterns:
      - pattern-either:
          - pattern: scanf($FMT, ...)
          - pattern: sscanf($SRC, $FMT, ...)
          - pattern: fscanf($F, $FMT, ...)
      - metavariable-regex:
          metavariable: $FMT
          regex: .*\%s.*
`, 701, "8", "cpp"),
  _ast_rule(1601, "AST-CS-001", "SQL built by string concatenation", `
rules:
  - id: AST-CS-001
    mode: taint
    message: Tainted data flows into a SQL API
    languages: [csharp]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $M(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: Request.Query[$K]
      - pattern: Request.Form[$K]
      - pattern: Request.QueryString[$K]
      - pattern: args
    pattern-sinks:
      - patterns:
          - pattern: $CMD.CommandText = $Q
          - focus-metavariable: $Q
      - patterns:
          - pattern: $DB.Execute($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: string.Format($Q, ...)
          - focus-metavariable: $Q
`, 701, "8", "csharp"),
  _ast_rule(1602, "AST-CS-002", "Empty catch swallows exceptions", `
rules:
  - id: AST-CS-002
    message: Empty catch block swallows the exception
    languages: [csharp]
    severity: WARNING
    pattern: |
      try {
        ...
      } catch ($T $E) {
      }
`, 501, "8", "csharp"),
  _ast_rule(1603, "AST-CS-003", "Process.Start with unsanitized input", `
rules:
  - id: AST-CS-003
    mode: taint
    message: Tainted data flows into Process.Start
    languages: [csharp]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $M(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: Request.Query[$K]
      - pattern: Request.Form[$K]
      - pattern: args
    pattern-sinks:
      - patterns:
          - pattern: Process.Start($CMD, ...)
          - focus-metavariable: $CMD
`, 703, "8", "csharp"),
  _ast_rule(1604, "AST-CS-004", "BinaryFormatter or untrusted deserialize", `
rules:
  - id: AST-CS-004
    message: Untrusted deserialize via BinaryFormatter or equivalent
    languages: [csharp]
    severity: ERROR
    pattern-either:
      - pattern: new BinaryFormatter()
      - pattern: $F.Deserialize(...)
`, 703, "8", "csharp"),
  _ast_rule(1605, "AST-CS-005", "Path traversal via Combine with user input", `
rules:
  - id: AST-CS-005
    mode: taint
    message: Tainted data flows into a filesystem path
    languages: [csharp]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              $RET $M(..., $SRC, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: Request.Query[$K]
      - pattern: Request.Form[$K]
      - pattern: args
    pattern-sinks:
      - patterns:
          - pattern: Path.Combine($BASE, $SEG, ...)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: File.ReadAllText($P, ...)
          - focus-metavariable: $P
      - patterns:
          - pattern: File.Open($P, ...)
          - focus-metavariable: $P
`, 701, "8", "csharp"),
  _ast_rule(1606, "AST-CS-006", "Stream opened without using", `
rules:
  - id: AST-CS-006
    message: Disposable file stream is created outside a using block
    languages: [csharp]
    severity: WARNING
    pattern-either:
      - pattern: new FileStream(...)
      - pattern: new StreamReader(...)
      - pattern: new StreamWriter(...)
      - pattern: File.Open(...)
      - pattern: File.OpenRead(...)
      - pattern: File.OpenWrite(...)
`, 801, "8", "csharp"),
  _ast_rule(1607, "AST-CS-007", "HttpClient or WebRequest without timeout", `
rules:
  - id: AST-CS-007
    message: HTTP client is created without an explicit timeout
    languages: [csharp]
    severity: WARNING
    pattern-either:
      - pattern: new HttpClient()
      - pattern: new WebClient()
      - pattern: WebRequest.Create(...)
`, 801, "8", "csharp"),
  _ast_rule(1608, "AST-CS-008", "TLS certificate validation always succeeds", `
rules:
  - id: AST-CS-008
    message: Server certificate validation is forced to succeed
    languages: [csharp]
    severity: ERROR
    pattern-either:
      - pattern: $X.ServerCertificateValidationCallback = ($A, $B, $C, $D) => true
      - pattern: $X.ServerCertificateCustomValidationCallback = ($A, $B, $C, $D) => true
      - pattern: ServicePointManager.ServerCertificateValidationCallback = ($A, $B, $C, $D) => true
`, 701, "8", "csharp"),
  _ast_rule(1609, "AST-CS-009", "Hardcoded secret assignment", `
rules:
  - id: AST-CS-009
    message: Hardcoded secret-like assignment
    languages: [csharp]
    severity: WARNING
    patterns:
      - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "csharp"),
  _ast_rule(1610, "AST-CS-010", "Html.Raw or unencoded HTML string", `
rules:
  - id: AST-CS-010
    message: Unencoded HTML is rendered
    languages: [csharp]
    severity: ERROR
    pattern-either:
      - pattern: Html.Raw(...)
      - pattern: new HtmlString(...)
`, 701, "8", "csharp"),
  _ast_rule(1611, "AST-CS-011", "SSRF: request data flows to HTTP client", `
rules:
  - id: AST-CS-011
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [csharp]
    severity: ERROR
    pattern-sources:
      - pattern: Request.Query[$K]
      - pattern: Request.Form[$K]
      - pattern: Request.QueryString[$K]
    pattern-sinks:
      - patterns:
          - pattern: $C.GetAsync($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.GetStringAsync($URL, ...)
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.DownloadString($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: WebRequest.Create($URL)
          - focus-metavariable: $URL
`, 701, "8", "csharp"),
  _ast_rule(1801, "AST-KT-001", "SQL string template or concat into execute", `
rules:
  - id: AST-KT-001
    mode: taint
    message: Tainted data flows into a SQL execute/createQuery API
    languages: [kotlin]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              fun $M(..., $SRC: $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
      - pattern: $REQ.queryParameters[$K]
    pattern-sinks:
      - patterns:
          - pattern: $C.execute($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $C.createQuery($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $C.prepareStatement($Q, ...)
          - focus-metavariable: $Q
`, 701, "8", "kotlin"),
  _ast_rule(1802, "AST-KT-002", "Runtime.exec or ProcessBuilder with interpolation", `
rules:
  - id: AST-KT-002
    mode: taint
    message: Tainted data flows into a process launch
    languages: [kotlin]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              fun $M(..., $SRC: $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
    pattern-sinks:
      - patterns:
          - pattern: Runtime.getRuntime().exec($CMD, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: ProcessBuilder($CMD, ...)
          - focus-metavariable: $CMD
      - patterns:
          - pattern: $PB.command($CMD, ...)
          - focus-metavariable: $CMD
`, 703, "8", "kotlin"),
  _ast_rule(1803, "AST-KT-003", "Empty catch swallows exceptions", `
rules:
  - id: AST-KT-003
    message: Empty catch block swallows the exception
    languages: [kotlin]
    severity: WARNING
    pattern-either:
      - pattern: |
          try {
            ...
          } catch ($E: $T) {
          }
      - pattern: |
          try {
            ...
          } catch ($E: $T) {
            }
`, 501, "8", "kotlin"),
  _ast_rule(1804, "AST-KT-004", "Hostname or TLS verification disabled", `
rules:
  - id: AST-KT-004
    message: Hostname or TLS verification is forced to succeed
    languages: [kotlin]
    severity: ERROR
    pattern-either:
      - pattern: HostnameVerifier { $A, $B -> true }
      - pattern: HostnameVerifier { _, _ -> true }
      - pattern: $X.setHostnameVerifier { $A, $B -> true }
`, 701, "8", "kotlin"),
  _ast_rule(1805, "AST-KT-005", "Path join with a user segment", `
rules:
  - id: AST-KT-005
    mode: taint
    message: Tainted data flows into a filesystem path
    languages: [kotlin]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              fun $M(..., $SRC: $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
    pattern-sinks:
      - patterns:
          - pattern: File($BASE, $SEG)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: Paths.get($BASE, $SEG, ...)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: File($P)
          - focus-metavariable: $P
`, 701, "8", "kotlin"),
  _ast_rule(1806, "AST-KT-006", "Hardcoded secret assignment", `
rules:
  - id: AST-KT-006
    message: Hardcoded secret-like assignment
    languages: [kotlin]
    severity: WARNING
    patterns:
      - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "kotlin"),
  _ast_rule(1807, "AST-KT-007", "Insecure Java deserialize", `
rules:
  - id: AST-KT-007
    message: ObjectInputStream deserialize of untrusted data
    languages: [kotlin]
    severity: ERROR
    pattern-either:
      - pattern: ObjectInputStream(...)
      - pattern: $S.readObject()
`, 703, "8", "kotlin"),
  _ast_rule(1808, "AST-KT-008", "SSRF: request data flows to URL or HTTP client", `
rules:
  - id: AST-KT-008
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [kotlin]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              fun $M(..., $SRC: $T, ...) {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
      - pattern: $REQ.queryParameters[$K]
    pattern-sinks:
      - patterns:
          - pattern: URL($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: URL($URL).openConnection()
          - focus-metavariable: $URL
      - patterns:
          - pattern: $C.get($URL, ...)
          - focus-metavariable: $URL
`, 701, "8", "kotlin"),
  _ast_rule(1809, "AST-KT-009", "Unsafe non-null assertion on request data", `
rules:
  - id: AST-KT-009
    message: Non-null assertion on request or query data
    languages: [kotlin]
    severity: WARNING
    pattern-either:
      - pattern: $REQ.getParameter(...)!!
      - pattern: $REQ.queryParameters[$K]!!
      - pattern: $REQ.parameters[$K]!!
`, 101, "8", "kotlin"),
  _ast_rule(1810, "AST-KT-010", "TrustManager or SSL always succeeds", `
rules:
  - id: AST-KT-010
    message: Trust manager or SSL check is forced to succeed
    languages: [kotlin]
    severity: ERROR
    pattern-either:
      - pattern: checkServerTrusted(...) {}
      - pattern: checkClientTrusted(...) {}
      - pattern: $X.checkServerTrusted(...)
`, 701, "8", "kotlin"),
  _ast_rule(1811, "AST-KT-011", "HttpURLConnection created without a timeout", `
rules:
  - id: AST-KT-011
    message: HTTP connection is opened without an explicit timeout
    languages: [kotlin]
    severity: WARNING
    pattern-either:
      - pattern: URL($U).openConnection()
      - pattern: $U.openConnection() as HttpURLConnection
`, 801, "8", "kotlin"),
  _ast_rule(1901, "AST-SC-001", "SQL concat or interpolator into JDBC", `
rules:
  - id: AST-SC-001
    mode: taint
    message: Tainted data flows into a JDBC SQL API
    languages: [scala]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              def $M(..., $SRC: $T, ...) = {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
    pattern-sinks:
      - patterns:
          - pattern: $C.execute($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $C.prepareStatement($Q, ...)
          - focus-metavariable: $Q
      - patterns:
          - pattern: $C.createQuery($Q, ...)
          - focus-metavariable: $Q
`, 701, "8", "scala"),
  _ast_rule(1902, "AST-SC-002", "Process or sys.process execution", `
rules:
  - id: AST-SC-002
    message: Unsanitized data is passed to a process launcher
    languages: [scala]
    severity: ERROR
    pattern-either:
      - pattern: $CMD.!!
      - pattern: $CMD.!
      - pattern: Process($CMD)
      - pattern: Process($CMD, ...)
      - pattern: $CMD.lineStream
`, 703, "8", "scala"),
  _ast_rule(1903, "AST-SC-003", "Empty catch swallows exceptions", `
rules:
  - id: AST-SC-003
    message: Empty catch block swallows the exception
    languages: [scala]
    severity: WARNING
    # try $X matches both block and expression forms; an empty case body is the smell.
    pattern: |
      try $X catch { case $P => }
`, 501, "8", "scala"),
  _ast_rule(1904, "AST-SC-004", "SSL or hostname verification disabled", `
rules:
  - id: AST-SC-004
    message: SSL or hostname verification is forced to succeed
    languages: [scala]
    severity: ERROR
    pattern-either:
      - pattern: $X.setHostnameVerifier(...)
      - pattern: ALLOW_ALL_HOSTNAME_VERIFIER
      - pattern: $X.setSSLSocketFactory(...)
`, 701, "8", "scala"),
  _ast_rule(1905, "AST-SC-005", "Path concat with user input", `
rules:
  - id: AST-SC-005
    mode: taint
    message: Tainted data flows into a filesystem path
    languages: [scala]
    severity: WARNING
    pattern-sources:
      - patterns:
          - pattern: |
              def $M(..., $SRC: $T, ...) = {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
    pattern-sinks:
      - patterns:
          - pattern: new File($BASE, $SEG)
          - focus-metavariable: $SEG
      - patterns:
          - pattern: Paths.get($BASE, $SEG, ...)
          - focus-metavariable: $SEG
`, 701, "8", "scala"),
  _ast_rule(1906, "AST-SC-006", "Hardcoded secret assignment", `
rules:
  - id: AST-SC-006
    message: Hardcoded secret-like assignment
    languages: [scala]
    severity: WARNING
    patterns:
      - pattern: $KEY = "$VAL"
      - metavariable-regex:
          metavariable: $KEY
          regex: (?i).*(secret|password|apiKey|token|privateKey).*
`, 701, "8", "scala"),
  _ast_rule(1907, "AST-SC-007", "Java deserialize interop", `
rules:
  - id: AST-SC-007
    message: ObjectInputStream deserialize of untrusted data
    languages: [scala]
    severity: ERROR
    pattern-either:
      - pattern: new ObjectInputStream(...)
      - pattern: $S.readObject()
`, 703, "8", "scala"),
  _ast_rule(1908, "AST-SC-008", "HTTP client created without a timeout", `
rules:
  - id: AST-SC-008
    message: HTTP client is created without an explicit timeout
    languages: [scala]
    severity: WARNING
    pattern-either:
      - pattern: new URL($U).openConnection()
      - pattern: HttpClient.newHttpClient()
      - pattern: HttpURLConnection
`, 801, "8", "scala"),
  _ast_rule(1909, "AST-SC-009", "SSRF: request data flows to URL or HTTP client", `
rules:
  - id: AST-SC-009
    mode: taint
    message: Untrusted request data flows to an outbound HTTP client (SSRF)
    languages: [scala]
    severity: ERROR
    pattern-sources:
      - patterns:
          - pattern: |
              def $M(..., $SRC: $T, ...) = {
                ...
              }
          - focus-metavariable: $SRC
      - pattern: $REQ.getParameter(...)
    pattern-sinks:
      - patterns:
          - pattern: new URL($URL)
          - focus-metavariable: $URL
      - patterns:
          - pattern: new URL($URL).openConnection()
          - focus-metavariable: $URL
`, 701, "8", "scala"),
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

/**
 * Bump when a seed rule / tag changes. `data/platform/rules.json` and `tags.json` are
 * copies of this catalog; the local platform refreshes a copy whose `seedVersion` is
 * older, unless the copy is marked `userModified: true`.
 */
export const SEED_CATALOG_VERSION = 3;

export function build_rules_payload(): Record<string, any> {
  const custom = AST_RULES.concat(CUSTOM_AI_RULES, EXCLUSION_RULES, FRONTEND_RULES);
  return {
    seedVersion: SEED_CATALOG_VERSION,
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
