/**
 * Overlay registry: parsers for every supported tool, language-aware tool
 * selection, and the runner with stubbed binaries (nothing on PATH is required).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OVERLAY_TOOLS,
  overlayHooks,
  overlay_tools_for,
  parse_bandit_json,
  parse_cppcheck_template,
  parse_detekt_sarif,
  parse_eslint_json,
  parse_gitleaks_json,
  parse_gosec_json,
  parse_govet_json,
  parse_grype_json,
  parse_ruff_json,
  parse_staticcheck_json,
  parse_trivy_json,
  run_optional_overlays,
} from "../scripts/overlays.ts";
import { ALL_PROFILES } from "../scripts/lang.ts";

const original_which = overlayHooks.which;
const original_run = overlayHooks.run;
afterEach(() => {
  overlayHooks.which = original_which;
  overlayHooks.run = original_run;
});

describe("overlay parsers", () => {
  it("gitleaks / trivy / grype keep the tool's file path and cap severities", () => {
    const g = parse_gitleaks_json(JSON.stringify([{ RuleID: "aws-access-token", File: "config/prod.env", StartLine: 3, Description: "AWS key" }]));
    assert.equal(g.length, 1);
    assert.equal(g[0].ruleId, "SECRET-GLEAKS-aws-access-token");
    assert.equal(g[0].filePath, "config/prod.env");
    assert.equal(g[0].kind, "secret");

    const t = parse_trivy_json(JSON.stringify({
      Results: [{ Target: "package-lock.json", Vulnerabilities: [
        { VulnerabilityID: "CVE-2024-1", Severity: "LOW", PkgName: "a" },
        { VulnerabilityID: "CVE-2024-2", Severity: "CRITICAL", PkgName: "lodash", InstalledVersion: "4.17.0", FixedVersion: "4.17.21", Title: "proto pollution" },
      ] }],
    }));
    assert.equal(t.length, 1);
    assert.equal(t[0].ruleId, "SCA-TRIVY-CVE-2024-2");
    assert.match(t[0].message, /fixed in 4\.17\.21/);

    const gr = parse_grype_json(JSON.stringify({ matches: [{ vulnerability: { id: "GHSA-x", severity: "High" }, artifact: { name: "requests", version: "2.0", locations: [{ path: "requirements.txt" }] } }] }));
    assert.equal(gr[0].filePath, "requirements.txt");
    assert.equal(gr[0].severity, "HIGH");

    assert.deepEqual(parse_trivy_json("not json"), []);
    assert.deepEqual(parse_gitleaks_json(""), []);
  });

  it("native analyzers map to repo-relative paths and language", () => {
    const b = parse_bandit_json(JSON.stringify({ results: [{ filename: "/repo/app/api/users.py", line_number: 12, test_id: "B602", test_name: "subprocess_popen_with_shell_equals_true", issue_text: "shell=True", issue_severity: "HIGH", issue_cwe: { id: 78 }, line_range: [12, 13] }] }), "/repo");
    assert.equal(b[0].filePath, "app/api/users.py");
    assert.equal(b[0].ruleId, "NATIVE-BANDIT-B602");
    assert.equal(b[0].language, "python");
    assert.match(b[0].message, /CWE-78/);
    assert.equal(b[0].endLine, 13);

    const gs = parse_gosec_json(JSON.stringify({ Issues: [{ file: "/repo/internal/pay/charge.go", line: "8-10", rule_id: "G204", details: "Subprocess launched with variable", severity: "MEDIUM", cwe: { id: "78" } }] }), "/repo");
    assert.equal(gs[0].filePath, "internal/pay/charge.go");
    assert.equal(gs[0].line, 8);

    const gv = parse_govet_json(JSON.stringify({ "example.com/pay": { printf: [{ posn: "/repo/internal/pay/charge.go:21:2", message: "Sprintf format %d has arg of wrong type" }] } }), "/repo");
    assert.equal(gv[0].ruleId, "NATIVE-GOVET-printf");
    assert.equal(gv[0].line, 21);

    const sc = parse_staticcheck_json('{"code":"SA4006","severity":"error","location":{"file":"/repo/a.go","line":4},"message":"unused value"}\n\n', "/repo");
    assert.equal(sc[0].severity, "HIGH");
    assert.equal(sc[0].filePath, "a.go");

    const cc = parse_cppcheck_template("src/net/sock.c\t42\terror\tbufferAccessOutOfBounds\tArray index out of bounds\nx.c\t1\tinformation\tmissingIncludeSystem\tskip\n", "/repo");
    assert.equal(cc.length, 1);
    assert.equal(cc[0].ruleId, "NATIVE-CPPCHECK-bufferAccessOutOfBounds");
    assert.equal(cc[0].severity, "HIGH");
    assert.equal(cc[0].language, "c");

    const es = parse_eslint_json(JSON.stringify([{ filePath: "/repo/web/src/cart.ts", messages: [{ ruleId: "no-eval", severity: 2, line: 3, message: "eval can be harmful" }, { ruleId: null, severity: 1, line: 9, message: "ignored" }] }]), "/repo");
    assert.equal(es.length, 1);
    assert.equal(es[0].language, "typescript");
    assert.equal(es[0].severity, "HIGH");

    const rf = parse_ruff_json(JSON.stringify([
      { code: "F821", message: "Undefined name `total`", filename: "/repo/app/api/users.py", location: { row: 12 }, end_location: { row: 12 } },
      { code: "S608", message: "Possible SQL injection", filename: "/repo/app/api/users.py", location: { row: 20 } },
      { code: "B008", message: "Function call in default argument", filename: "/repo/app/api/users.py", location: { row: 30 } },
      { code: "E501", message: "Line too long", filename: "/repo/app/api/users.py", location: { row: 40 } },
      { code: null, message: "SyntaxError: unexpected token", filename: "/repo/app/api/users.py", location: { row: 1 } },
    ]), "/repo");
    assert.deepEqual(rf.map((f) => f.ruleId), [
      "NATIVE-RUFF-F821", "NATIVE-RUFF-S608", "NATIVE-RUFF-B008", "NATIVE-RUFF-syntax-error",
    ], "formatting-only codes are dropped");
    assert.equal(rf[0].filePath, "app/api/users.py");
    assert.equal(rf[0].language, "python");
    assert.equal(rf[0].severity, "HIGH");
    assert.equal(rf[2].severity, "MEDIUM");
    assert.deepEqual(parse_ruff_json("not json"), []);

    const dk = parse_detekt_sarif(JSON.stringify({ runs: [{ results: [{ ruleId: "detekt.exceptions.SwallowedException", level: "warning", message: { text: "swallowed" }, locations: [{ physicalLocation: { artifactLocation: { uri: "file:///repo/src/main/kotlin/A.kt" }, region: { startLine: 7 } } }] }] }] }), "/repo");
    assert.equal(dk[0].filePath, "src/main/kotlin/A.kt");
    assert.equal(dk[0].language, "kotlin");
  });
});

describe("overlay registry", () => {
  it("selects language-independent tools always and native tools per language", () => {
    const ids = (langs: string[], kinds?: any) => overlay_tools_for(langs, kinds).map((t) => t.id);
    assert.deepEqual(ids(["java"]), ["gitleaks", "trivy", "grype"]);
    assert.ok(ids(["python"]).includes("bandit"));
    assert.ok(ids(["python"]).includes("ruff"), "the profile declares ruff, so it must be registered");
    assert.ok(!ids(["python"]).includes("gosec"));
    assert.deepEqual(ids(["go"]).filter((i) => !["gitleaks", "trivy", "grype"].includes(i)), ["gosec", "govet", "staticcheck"]);
    assert.ok(ids(["ts"]).includes("eslint"));
    assert.ok(ids(["c"]).includes("cppcheck") && ids(["cpp"]).includes("cppcheck"));
    assert.deepEqual(ids(["python", "go"], new Set(["native"])), ["bandit", "ruff", "gosec", "govet", "staticcheck"]);
    for (const t of OVERLAY_TOOLS) assert.ok(typeof t.parse === "function" && t.bin, t.id);

    // Every analyzer a language profile advertises must have a registered overlay.
    const registered = new Set(OVERLAY_TOOLS.map((t) => t.id));
    for (const profile of ALL_PROFILES) {
      for (const analyzer of profile.nativeAnalyzers) {
        assert.ok(registered.has(analyzer), `${profile.id} advertises ${analyzer} but no overlay is registered`);
      }
    }
  });

  it("runs only available tools, skips the rest, and annotates inDiff", () => {
    const repo = mkdtempSync(join(tmpdir(), "dd-overlay-"));
    mkdirSync(join(repo, "app/api"), { recursive: true });
    mkdirSync(join(repo, "internal/pay"), { recursive: true });
    writeFileSync(join(repo, "app/api/users.py"), "import os\n");
    writeFileSync(join(repo, "internal/pay/charge.go"), "package pay\n");

    const calls: string[][] = [];
    overlayHooks.which = (cmd) => (["gitleaks", "bandit", "grype"].includes(cmd) ? `/usr/bin/${cmd}` : null);
    overlayHooks.run = (cmd) => {
      calls.push(cmd);
      const bin = cmd[0].split("/").pop();
      const stdout =
        bin === "gitleaks"
          ? JSON.stringify([{ RuleID: "generic-api-key", File: join(repo, "app/api/users.py"), StartLine: 1 }, { RuleID: "aws", File: "deploy/.env", StartLine: 2 }])
          : bin === "bandit"
            ? JSON.stringify({ results: [{ filename: join(repo, "app/api/users.py"), line_number: 1, test_id: "B404", issue_text: "import subprocess", issue_severity: "LOW" }] })
            : JSON.stringify({ matches: [{ vulnerability: { id: "CVE-1", severity: "Critical" }, artifact: { name: "x", locations: [{ path: "go.sum" }] } }] });
      return { returncode: bin === "bandit" ? 1 : 0, stdout, stderr: "", timedOut: false, notFound: false } as any;
    };

    const result = run_optional_overlays({
      codeDir: repo,
      diffFiles: ["app/api/users.py", "internal/pay/charge.go"],
      scanPurpose: "pr",
    });

    assert.deepEqual(result.languages, ["go", "python"]);
    assert.deepEqual(result.scannedTools, ["gitleaks", "grype", "bandit"]);
    assert.ok(result.skipped.includes("gosec") && result.skipped.includes("govet") && result.skipped.includes("staticcheck"));
    assert.ok(!result.skipped.includes("trivy") || !result.scannedTools.includes("trivy"), "trivy group replaced by grype");
    assert.ok(!result.consideredTools.includes("cppcheck"));

    const bandit_call = calls.find((c) => c[0].endsWith("bandit"))!;
    assert.ok(bandit_call.includes("app/api/users.py") && !bandit_call.includes("internal/pay/charge.go"), "bandit gets only python files");

    const by_rule = Object.fromEntries(result.findings.map((f: any) => [f.ruleId, f]));
    assert.equal(by_rule["NATIVE-BANDIT-B404"].filePath, "app/api/users.py");
    assert.equal(by_rule["NATIVE-BANDIT-B404"].inDiff, true);
    assert.equal(by_rule["SECRET-GLEAKS-aws"].inDiff, false);
    assert.equal(by_rule["SCA-GRYPE-CVE-1"].inDiff, false);
    assert.equal(result.totalFindings, 4);
    assert.equal(result.verifyRequiredFindings, 3, "SCA stays verify-required even outside the diff");
    assert.deepEqual(result.findingsByKind, { secret: 2, sca: 1, native: 1 });
    assert.ok(result.warnings.some((w: string) => /gosec not on PATH/.test(w)));
  });

  it("exits cleanly when nothing is installed", () => {
    overlayHooks.which = () => null;
    const repo = mkdtempSync(join(tmpdir(), "dd-overlay-none-"));
    const result = run_optional_overlays({ codeDir: repo, diffFiles: ["a.py"], languages: ["python"] });
    assert.deepEqual(result.scannedTools, []);
    assert.equal(result.totalFindings, 0);
    assert.ok(result.skipped.includes("gitleaks") && result.skipped.includes("bandit") && result.skipped.includes("ruff"));
  });
});
