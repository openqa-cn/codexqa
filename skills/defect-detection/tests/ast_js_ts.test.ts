import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detect_project_language,
  extract_semgrep_yaml_from_rules,
  filter_rules_by_language,
  run_ast_scan,
} from "../scripts/ast.ts";
import { AST_RULES } from "../scripts/providers/platform/seed_catalog.ts";

describe("JS/TS AST rule path", () => {
  it("detects javascript from .mjs/.js change sets", () => {
    assert.equal(detect_project_language(["src/checkout.mjs", "lib/util.js"]), "javascript");
    assert.equal(detect_project_language(["src/app.ts", "src/main.tsx"]), "typescript");
  });

  it("keeps JS/TS Semgrep rules and drops Java-only ones for javascript projects", () => {
    const extracted = extract_semgrep_yaml_from_rules(AST_RULES);
    assert.ok(extracted.length >= 10, "seed catalog should include Java + JS AST rules");

    const [js_rules, skipped] = filter_rules_by_language(extracted, "javascript");
    assert.ok(js_rules.length >= 4, `expected JS/TS rules, got ${js_rules.length}`);
    assert.ok(skipped >= 1, "Java-only rules should be filtered out");
    for (const r of js_rules) {
      assert.match(String(r.ruleCode || r.id), /AST-JS-|JS-/);
    }

    const [java_rules] = filter_rules_by_language(extracted, "java");
    assert.ok(java_rules.every((r) => !String(r.ruleCode || "").startsWith("AST-JS-")));
  });

  it("treats typescript as compatible with javascript Semgrep languages", () => {
    const extracted = extract_semgrep_yaml_from_rules(AST_RULES);
    const [ts_rules] = filter_rules_by_language(extracted, "typescript");
    assert.ok(ts_rules.some((r) => String(r.ruleCode || "").startsWith("AST-JS-")));
  });

  it("run-ast-scan on a JS fixture does not skip and can hit the zero-amount boundary rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-ast-js-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    const defective = join(dir, "src", "checkout.mjs");
    writeFileSync(
      defective,
      "export function checkout(amount) {\n" +
        "  if (!Number.isFinite(amount) || amount < 0) throw new Error('amount must be positive');\n" +
        "  return { accepted: true, amount };\n" +
        "}\n",
      "utf8",
    );

    const result = run_ast_scan(
      AST_RULES,
      dir,
      ["src/checkout.mjs"],
      join(dir, ".semgrep-ast-rules.yaml"),
      "javascript",
    );

    assert.notEqual(result.skipped, true);
    assert.notEqual(
      result.skipReason,
      "AST rules only apply to Java; current language: javascript",
    );
    if (result.scanOk === false && (result.errors || []).some((e: string) => /semgrep/i.test(e))) {
      // Environment without a working Semgrep: still prove we did not hard-skip non-Java.
      assert.ok((result.ruleCount || 0) >= 1);
      return;
    }

    assert.ok((result.ruleCount || 0) >= 1, `expected JS rules loaded, got ${JSON.stringify(result)}`);
    assert.ok((result.scannedFiles || 0) >= 1, `expected files scanned: ${JSON.stringify(result)}`);
    const ids = (result.findings || []).map((f: any) => String(f.ruleId || f.check_id || f.ruleCode || ""));
    assert.ok(
      ids.some((id: string) => id.includes("AST-JS-BOUND-001") || id.includes("BOUND")),
      `expected boundary hit on defective checkout, got ${JSON.stringify(result.findings)}`,
    );
  });

  it("AST-JS-EQ-001 ignores nullish and typeof comparisons but still flags value ==", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-ast-eq-"));
    writeFileSync(
      join(dir, "eq.js"),
      [
        "function f(a, b) {",
        "  if (a == null) return 0;",
        "  if (b != undefined) return 1;",
        "  if (typeof a == 'string') return 2;",
        "  if ('number' == typeof b) return 3;",
        "  if (a == b) return 4;",
        "  return a != 5;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = run_ast_scan(AST_RULES, dir, ["eq.js"], join(dir, ".rules.yaml"), "javascript");
    if (result.scanOk === false) return; // no Semgrep in this environment
    const eq_lines = (result.findings || [])
      .filter((f: any) => String(f.ruleId || "").includes("AST-JS-EQ-001"))
      .map((f: any) => f.line)
      .sort();
    assert.deepEqual(eq_lines, [6, 7], `expected only value comparisons flagged, got ${JSON.stringify(result.findings)}`);
  });
});

describe("Python AST rule path", () => {
  it("keeps Python seed rules for python projects and drops them for Java", () => {
    const extracted = extract_semgrep_yaml_from_rules(AST_RULES);
    const [py_rules] = filter_rules_by_language(extracted, "python");
    assert.ok(py_rules.length >= 3, `expected Python seed rules, got ${py_rules.length}`);
    assert.ok(py_rules.every((r) => String(r.ruleCode || "").startsWith("AST-PY-")));
    const [java_rules] = filter_rules_by_language(extracted, "java");
    assert.ok(java_rules.every((r) => !String(r.ruleCode || "").startsWith("AST-PY-")));
  });

  it("run-ast-scan on a Python fixture is not skipped and hits the seed rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-ast-py-"));
    writeFileSync(
      join(dir, "svc.py"),
      [
        "def handle(x, acc=[]):",
        "    try:",
        "        x.run()",
        "    except Exception:",
        "        pass",
        "    if x == None:",
        "        return acc",
        "    return x",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = run_ast_scan(AST_RULES, dir, ["svc.py"], join(dir, ".rules.yaml"), "python");
    assert.notEqual(result.skipped, true, `python must not be skipped: ${JSON.stringify(result)}`);
    assert.ok((result.ruleCount || 0) >= 3);
    if (result.scanOk === false) return;
    const ids = new Set((result.findings || []).map((f: any) => String(f.ruleId || "")));
    for (const want of ["AST-PY-EXC-001", "AST-PY-EQ-001", "AST-PY-MUT-001"]) {
      assert.ok(ids.has(want), `expected ${want} in ${JSON.stringify([...ids])}`);
    }
  });

  it("full-repo scan without a declared language only collects known source extensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "dd-ast-fullrepo-"));
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "README.md"), "if (a == b) {}\n", "utf8");
    writeFileSync(join(dir, "config.json"), "{}\n", "utf8");
    writeFileSync(join(dir, "node_modules", "x", "index.js"), "if (a == b) {}\n", "utf8");
    writeFileSync(join(dir, "app.js"), "function f(a, b) { return a == b; }\n", "utf8");
    const result = run_ast_scan(AST_RULES, dir, null, join(dir, ".rules.yaml"), null);
    assert.equal(result.scanMode, "full_repo");
    if (result.scanOk === false) return;
    assert.equal(result.scannedFiles, 1, `only app.js should be scanned: ${JSON.stringify(result)}`);
    const paths = new Set((result.findings || []).map((f: any) => String(f.filePath || "")));
    assert.ok(!paths.has("README.md") && !paths.has("config.json"), "non-source files must not produce findings");
  });
});
