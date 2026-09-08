/**
 * Seed AST catalog integrity across the ten supported languages, plus the
 * Semgrep-version resilience helpers in ast.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extract_semgrep_yaml_from_rules,
  filter_rules_by_language,
  invalid_rule_ids_from_semgrep_errors,
  merge_rules_to_yaml,
  rule_id_at_yaml_line,
} from "../scripts/ast.ts";
import { SUPPORTED_LANGUAGES, semgrep_rule_languages_for } from "../scripts/lang.ts";
import { AST_RULES, SEED_CATALOG_VERSION, ast_rule_metadata, flatten_tag_ids } from "../scripts/providers/platform/seed_catalog.ts";

describe("multi-language seed catalog", () => {
  it("has unique ids / codes and a pack for every supported language", () => {
    const ids = AST_RULES.map((r) => r.id);
    const codes = AST_RULES.map((r) => r.ruleCode);
    assert.equal(new Set(ids).size, ids.length, "numeric ids must be unique");
    assert.equal(new Set(codes).size, codes.length, "rule codes must be unique");
    assert.ok(AST_RULES.length >= 100, `expected the merged pack, got ${AST_RULES.length}`);
    const by_lang = new Map<string, number>();
    for (const r of AST_RULES) by_lang.set(r.language, (by_lang.get(r.language) || 0) + 1);
    for (const lang of SUPPORTED_LANGUAGES) {
      assert.ok((by_lang.get(lang) || 0) >= 7, `${lang} needs a seed pack, has ${by_lang.get(lang) || 0}`);
    }
    assert.ok(SEED_CATALOG_VERSION >= 3, "catalog version must be bumped so local copies refresh");
  });

  it("every rule points at a valid tag, declares languages and carries security metadata", () => {
    const tag_ids = new Set(flatten_tag_ids());
    for (const r of AST_RULES) {
      assert.ok(tag_ids.has(r.tagId), `${r.ruleCode} tagId ${r.tagId} is not in the tag catalog`);
      const desc = JSON.parse(r.description);
      assert.match(desc.semgrepYaml, /languages:\s*\[/, `${r.ruleCode} must declare Semgrep languages`);
      assert.ok(Array.isArray(desc.cwe) && desc.cwe.length, `${r.ruleCode} needs a CWE`);
      assert.ok(Array.isArray(desc.owaspTop10_2025), `${r.ruleCode} needs owaspTop10_2025`);
      assert.ok(Array.isArray(desc.asvs50), `${r.ruleCode} needs asvs50`);
      // message values with an unquoted ": " break the merged YAML for every other rule
      for (const m of desc.semgrepYaml.matchAll(/^\s*message:\s*(.*)$/gm)) {
        const v = String(m[1]).trim();
        if (v.startsWith('"') || v.startsWith("'") || v === "|" || v === ">") continue;
        assert.ok(!v.includes(": ") && !v.endsWith(":"), `${r.ruleCode} message needs quoting: ${v}`);
      }
    }
    assert.deepEqual(ast_rule_metadata("AST-SQL-001").cwe, ["CWE-89"]);
    assert.deepEqual(ast_rule_metadata("AST-JS-BOUND-001").cwe, ["CWE-20"]);
  });

  it("keeps our refined JS/PY rules and drops the upstream duplicates", () => {
    const codes = new Set(AST_RULES.map((r) => r.ruleCode));
    for (const kept of ["AST-JS-EQ-001", "AST-JS-BOUND-001", "AST-PY-EXC-001", "AST-PY-EQ-001", "AST-PY-MUT-001", "AST-JS-001", "AST-PY-004"]) {
      assert.ok(codes.has(kept), `${kept} missing`);
    }
    for (const dropped of ["AST-JS-007", "AST-JS-EVAL-001", "AST-JS-EXC-001"]) {
      assert.ok(!codes.has(dropped), `${dropped} duplicates another rule`);
    }
  });

  it("filters by a language set so polyglot change sets keep every pack", () => {
    const extracted = extract_semgrep_yaml_from_rules(AST_RULES);
    const [py_go] = filter_rules_by_language(extracted, ["python", "go"]);
    const codes = py_go.map((r) => String(r.ruleCode));
    assert.ok(codes.some((c) => c.startsWith("AST-PY-")));
    assert.ok(codes.some((c) => c.startsWith("AST-GO-")));
    assert.ok(!codes.some((c) => c.startsWith("AST-JS-") || c.startsWith("AST-KT-") || /^AST-[A-Z]+-001$/.test(c) && !/PY|GO/.test(c)));

    const [ts] = filter_rules_by_language(extracted, "typescript");
    assert.ok(ts.some((r) => String(r.ruleCode).startsWith("AST-TS-")));
    assert.ok(ts.some((r) => String(r.ruleCode).startsWith("AST-JS-")));
    const [js] = filter_rules_by_language(extracted, "javascript");
    assert.ok(!js.some((r) => String(r.ruleCode).startsWith("AST-TS-")), "TS-only rules do not apply to a JS project");

    const [cpp] = filter_rules_by_language(extracted, "cpp");
    assert.ok(cpp.some((r) => String(r.ruleCode).startsWith("AST-C-")), "C++ projects take the C pack too");
    const [kt] = filter_rules_by_language(extracted, "kotlin");
    assert.ok(kt.every((r) => String(r.ruleCode).startsWith("AST-KT-")), "Kotlin never inherits Java YAML");

    assert.deepEqual([...semgrep_rule_languages_for(["ts"])].sort(), ["generic", "javascript", "typescript"]);
  });

  it("maps semgrep config errors back to the offending rule", () => {
    const extracted = extract_semgrep_yaml_from_rules(AST_RULES.slice(0, 3));
    const yaml = merge_rules_to_yaml(extracted);
    const lines = yaml.split("\n");
    const second_id_line = lines.findIndex((l, i) => i > 0 && /^\s*-\s*id:/.test(l) && lines.slice(0, i).some((p) => /^\s*-\s*id:/.test(p)));
    const second_code = String(extracted[1].ruleCode);
    assert.equal(rule_id_at_yaml_line(yaml, second_id_line + 3), second_code);

    const bad = invalid_rule_ids_from_semgrep_errors(
      [
        { type: "InvalidRuleSchemaError", long_msg: "Additional properties are not allowed", spans: [{ file: "/tmp/x.yaml", start: { line: second_id_line + 2 } }] },
        { type: "SemgrepError", message: "invalid configuration file found (1 configs were invalid)" },
        { type: "Timeout", message: "timeout on foo.py" },
      ],
      yaml,
      "/tmp/x.yaml",
    );
    assert.deepEqual(bad.map((b) => b.ruleId), [second_code]);
    assert.deepEqual(invalid_rule_ids_from_semgrep_errors([{ type: "Timeout", message: "x" }], yaml, "/tmp/x.yaml"), []);
  });
});
