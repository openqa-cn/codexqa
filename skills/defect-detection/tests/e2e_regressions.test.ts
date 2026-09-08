/**
 * Regressions found by walking a real Java PR (6 planted defects) through Phase 1–4.
 * Each test pins one bug that either blocked the run or silently weakened a gate.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load_settings } from "../scripts/providers/config.ts";
import { _extract_changed_methods_from_diff, restamp_plan_relevance, run_build_detection_plan } from "../scripts/cli_auto.ts";
import { _reconcile_file_codes } from "../scripts/cli_run.ts";
import { classify_trivial_method } from "../scripts/trivial.ts";
import { ContentStore, content_base_dir, normalize_changed_method } from "../scripts/store.ts";
import { set_valid_tag_ids, validate_update_process } from "../scripts/validate.ts";
import { register_code_read, register_repo_clone } from "../scripts/state.ts";
import { render_report_html } from "../scripts/providers/platform/report_html.ts";
import { local_plan_gaps } from "../scripts/platform.ts";
import { spawnSync } from "node:child_process";

const JAVA_WITH_EARLY_BLOCK = `package p;
public class Svc {
    public long applyCoupon(String orderId, String code) {
        Order o = orders.findById(orderId).orElseThrow(() -> new IllegalArgumentException("no order " + orderId));
        Integer pct = coupons.get(code);
        if (pct == null) {
            throw new IllegalArgumentException("unknown coupon {" + code + "}");
        }
        pending.put(orderId, pct);
        return PriceUtils.applyDiscount(o.getTotalCents(), pct);
    }

    public boolean checkout(String orderId) {
        // braces in a comment { should not count
        String s = "}";
        return true;
    }
}
`;

describe("e2e regressions: Phase 1", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "dd-e2e-"));
    for (const k of ["CONTENT_JSON_BASE", "DETECTION_DATA_DIR", "DETECTION_CONFIG"]) saved[k] = process.env[k];
    process.env.CONTENT_JSON_BASE = join(tmp, "data");
    process.env.DETECTION_DATA_DIR = join(tmp, "data");
    mkdirSync(join(tmp, "data"), { recursive: true });
  });
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("config.yaml: inline `# comments` after a value do not leak into the value", () => {
    const cfg = join(tmp, "config.yaml");
    writeFileSync(cfg, [
      "data_dir: ./data",
      "providers:",
      "  auth:",
      "    kind: none          # none | bearer | api_key",
      "    options: {}",
      "  platform:",
      "    kind: local         # local | http",
      "    options:",
      "      report_base_url: \"http://x/#/r\"   # keep the # inside quotes",
      "",
    ].join("\n"), "utf8");
    const s = load_settings(cfg);
    assert.equal(s.platform.kind, "local");
    assert.equal(s.auth.kind, "none");
    assert.equal(s.platform.options.report_base_url, "http://x/#/r");
  });

  it("Java method extraction: an `if {` opened in the first 5 lines no longer swallows the rest of the class", () => {
    const repo = join(tmp, "repo");
    mkdirSync(join(repo, "src/main/java/p"), { recursive: true });
    const git = (...a: string[]) => {
      const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "src/main/java/p/Svc.java"), "package p;\npublic class Svc {}\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feat");
    writeFileSync(join(repo, "src/main/java/p/Svc.java"), JAVA_WITH_EARLY_BLOCK);
    git("add", "-A");
    git("commit", "-qm", "feat");

    const out = _extract_changed_methods_from_diff(repo, null, "main");
    const methods = out["p/Svc"];
    assert.ok(methods, "class extracted");
    const by = Object.fromEntries(methods.map((m: any) => [m.methodName, m]));
    assert.equal(by.applyCoupon.startLine, 3);
    assert.equal(by.applyCoupon.endLine, 11);
    assert.equal(by.applyCoupon.bodyLineCount, 7);
    assert.equal(by.checkout.startLine, 13);
    assert.equal(by.checkout.endLine, 17);
    assert.equal(Object.keys(out).includes("__hunks"), false);
  });

  it("keeps expressionBody through normalization so zero-line expressions are not empty", () => {
    const method = normalize_changed_method({
      methodName: "value",
      bodyLineCount: 0,
      expressionBody: true,
      filePath: "src/value.ts",
    });
    assert.equal(method.expressionBody, true);
    assert.equal(classify_trivial_method(method).trivialReason, null);
  });

  it("carries expressionBody from changed methods into the persisted detection plan", () => {
    const task_id = 700_000 + Math.floor(Math.random() * 100_000);
    try {
      const store = new ContentStore(task_id);
      store.set_diff_files(["src/value.ts"]);
      store.set_total_change_lines(1);
      store.add_changed_methods("src/value", [{
        methodName: "value",
        bodyLineCount: 0,
        expressionBody: true,
        filePath: "src/value.ts",
        language: "typescript",
      }]);
      store.save();
      const built = run_build_detection_plan({ task_id } as any);
      assert.equal(built.detectionPlan[0].expressionBody, true);
      assert.equal(built.detectionPlan[0].trivialReason, null);
    } finally {
      rmSync(join(content_base_dir(), String(task_id)), { recursive: true, force: true });
    }
  });

  it("plan relevance re-stamp: docs/cases registered after --with-plan upgrade T3 → T1/T2", () => {
    const store = new ContentStore(901);
    store.add_or_update_service({ gitUrl: "g", branch: "b", serviceKey: "svc", batchIds: [1] , localDir: join(tmp, "repo") });
    store.add_changed_methods("p/Svc", [{ methodName: "applyCoupon", bodyLineCount: 7 }, { methodName: "checkout", bodyLineCount: 4 }, { methodName: "other", bodyLineCount: 9 }]);
    store.add_detection_plan_items([
      { className: "p/Svc", methodName: "applyCoupon", strategyCode: 11, detectTier: "T3", minDetectLevel: "L1", source: "diff", status: "pending" },
      { className: "p/Svc", methodName: "checkout", strategyCode: 11, detectTier: "T3", minDetectLevel: "L1", source: "diff", status: "pending" },
      { className: "p/Svc", methodName: "other", strategyCode: 11, detectTier: "T3", minDetectLevel: "L1", source: "diff", status: "pending" },
    ], true);
    store.upsert_test_case({ id: "TC-1", title: "t", steps: "s", expectedResult: "e", relatedMethods: ["p/Svc#checkout"], fetchStatus: "success" });
    store.set_meta("extractedRules", [{ id: "R1", text: "coupon charged at checkout", source: "prd_doc/x.md", related: "Svc#applyCoupon" }]);
    store.save();

    const r = restamp_plan_relevance(store);
    assert.ok(r.updated >= 2);
    const items = store.load_plan_only().detectionPlan;
    const tier = Object.fromEntries(items.map((i: any) => [i.methodName, i.detectTier]));
    assert.equal(tier.checkout, "T1"); // case-direct
    assert.equal(tier.applyCoupon, "T2"); // doc-direct via the related column
    assert.equal(tier.other, "T3");
  });

  it("resolve_writeback_context resolves git/branch for diff-sourced plan items (batchId=null)", () => {
    const store = new ContentStore(902);
    store.add_or_update_service({ gitUrl: "git@x:y/z.git", branch: "feat", commitId: "abc", serviceKey: "svc", batchIds: [7] });
    store.add_detection_plan_items([
      { className: "p/Svc", methodName: "checkout", strategyCode: 11, filePath: "src/main/java/p/Svc.java", source: "diff", status: "pending" },
    ], true);
    const ctx = store.resolve_writeback_context("p/Svc", "checkout", 11);
    assert.equal(ctx.resolved, true);
    assert.equal(ctx.gitUrl, "git@x:y/z.git");
    assert.equal(ctx.parentBatchId, 7);
    assert.equal(ctx.fileCodesItem.filePath, "src/main/java/p/Svc.java");
  });

  it("corrects exactly one primary fileCodes path and preserves call-chain paths", () => {
    const store = new ContentStore(903);
    store.add_or_update_service({ gitUrl: "git@x:y/z.git", branch: "feat", commitId: "abc", serviceKey: "svc", batchIds: [8] });
    store.add_detection_plan_items([
      { className: "p/Svc", methodName: "checkout", strategyCode: 11, filePath: "src/main/java/p/Svc.java", source: "diff", status: "pending" },
    ], true);

    const [missing_names] = _reconcile_file_codes(store, "p/Svc", "checkout", 11, [
      { filePath: "wrong/Primary.java" },
      { filePath: "src/main/java/p/Caller.java" },
    ]);
    assert.equal(missing_names[0].filePath, "src/main/java/p/Svc.java");
    assert.equal(missing_names[1].filePath, "src/main/java/p/Caller.java");

    const [duplicates] = _reconcile_file_codes(store, "p/Svc", "checkout", 11, [
      { filePath: "wrong/Primary.java", methodNames: ["checkout"] },
      { filePath: "src/main/java/p/Caller.java", methodNames: ["checkout"] },
    ]);
    assert.equal(duplicates[0].filePath, "src/main/java/p/Svc.java");
    assert.equal(duplicates[1].filePath, "src/main/java/p/Caller.java");

    const [no_method] = _reconcile_file_codes(store, "p/Svc", null, 11, [
      { filePath: "wrong/Primary.java" },
      { filePath: "src/main/java/p/Caller.java" },
    ]);
    assert.equal(no_method[0].filePath, "src/main/java/p/Svc.java");
    assert.equal(no_method[1].filePath, "src/main/java/p/Caller.java");
  });
});

describe("e2e regressions: Phase 2 gates", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "dd-e2e2-"));
    for (const k of ["CONTENT_JSON_BASE", "DETECTION_DATA_DIR"]) saved[k] = process.env[k];
    process.env.CONTENT_JSON_BASE = join(tmp, "data");
    process.env.DETECTION_DATA_DIR = join(tmp, "data");
    set_valid_tag_ids([401, 402, 302]);
  });
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function item(over: Record<string, any>) {
    return {
      parentBatchId: 1,
      className: "p/Svc",
      methodName: "findPage",
      strategyCode: 11,
      bugStatus: 6,
      detectTier: "T2",
      tagId: 401,
      fileCodes: [{ filePath: "src/main/java/p/Svc.java", methodNames: ["findPage"], git: "g", branch: "b", commitId: "c" }],
      thinking: "Review findPage lines 25-32: line 29 calls skip(page * size) although the caller OrderController#list passes a 1-based page; the first page is skipped. Conclusion: defense failed. [Confidence:HIGH][C5✓]",
      content: "Defect:findPage off-by-one\n\nLines:25-32\n\nProblem description: skip(page*size)\n\nProblem tags: [Wrong condition][This change]\n\nImpact scope: findPage\n\nAffected business: lists\n\nReproduction path: a → b\n\nTrigger conditions: page>=1\n\nExpected vs actual:\n- expected: first page\n- actual: second page\n\nFix suggestion:(page-1)*size\n\n```java\nskip((page-1)*size)\n```",
      processSteps: [{ step: "first_round_detection", stepKey: "first_round_detection", stepStatus: "executed", hasBug: true, conclusion: "findPage skips page*size records while the controller passes a 1-based page, so the first page is never returned", question: "Does the pagination contract start at page 1?", referencedSources: [{ sourceType: "prd_doc", sourceId: "d", sourceName: "d" }] }],
      ...over,
    };
  }

  it("Hard rule 7: a task with cases mapped to other methods does not force a Test case ID on an unrelated method", () => {
    const store = new ContentStore(903);
    store.upsert_test_case({ id: "TC-1", title: "t", steps: "s", expectedResult: "e", relatedMethods: ["p/Svc#checkout"], fetchStatus: "success" });
    store.add_detection_plan_items([
      { className: "p/Svc", methodName: "findPage", strategyCode: 11, caseRelevance: "none", status: "pending" },
      { className: "p/Svc", methodName: "checkout", strategyCode: 11, caseRelevance: "direct", status: "pending" },
    ], true);
    store.save();
    register_code_read(903, 1, "p/Svc", "src/main/java/p/Svc.java", "class Svc {}");
    register_repo_clone(903, 1, "g", tmp, "b");
    assert.ok(!validate_update_process(item({}), 903), "expected no error");
    const err = validate_update_process(item({ methodName: "checkout", fileCodes: [{ filePath: "src/main/java/p/Svc.java", methodNames: ["checkout"], git: "g", branch: "b", commitId: "c" }] }), 903);
    assert.match(String(err), /Hard rule7/);
  });

  it("Hard rule 7: cases without relatedMethods keep the task-wide requirement", () => {
    const store = new ContentStore(904);
    store.upsert_test_case({ id: "TC-1", title: "t", steps: "s", expectedResult: "e", fetchStatus: "success" });
    store.save();
    register_code_read(904, 1, "p/Svc", "src/main/java/p/Svc.java", "class Svc {}");
    register_repo_clone(904, 1, "g", tmp, "b");
    assert.match(String(validate_update_process(item({}), 904)), /Hard rule7/);
  });

  it("Hard rule 6: T3 is exempt from chain evidence; bugStatus=2 only needs it at T1", () => {
    register_code_read(905, 1, "p/Svc", "src/main/java/p/Svc.java", "class Svc {}");
    register_repo_clone(905, 1, "g", tmp, "b");
    const no_chain = "Review findPage lines 25-32: loop bounds fine, no null path. Conclusion: no defect. [Confidence:HIGH]";
    assert.ok(!validate_update_process(item({ detectTier: "T3", bugStatus: 2, thinking: no_chain, content: "No defect in this code" }), 905), "expected no error");
    assert.ok(!validate_update_process(item({ detectTier: "T2", bugStatus: 2, thinking: no_chain, content: "No defect in this code" }), 905), "expected no error");
    assert.match(String(validate_update_process(item({ detectTier: "T1", bugStatus: 2, thinking: no_chain, content: "No defect in this code" }), 905)), /Hard rule6/);
    const defect_no_chain = item({ detectTier: "T2", thinking: "Review findPage lines 25-32: skip(page*size) is off by one. Conclusion: defense failed. [Confidence:HIGH][C5✓]" });
    defect_no_chain.content = defect_no_chain.content.replace("Reproduction path: a → b", "Reproduction path: open the list on page 1");
    assert.match(String(validate_update_process(defect_no_chain, 905)), /Hard rule6/);
  });
});

describe("e2e regressions: Phase 3/4", () => {
  let tmp: string;
  const saved: Record<string, string | undefined> = {};
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "dd-e2e3-"));
    for (const k of ["CONTENT_JSON_BASE", "DETECTION_DATA_DIR"]) saved[k] = process.env[k];
    process.env.CONTENT_JSON_BASE = join(tmp, "data");
    process.env.DETECTION_DATA_DIR = join(tmp, "data");
  });
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("plan coverage: unwritten plan items block finalize; a write-back closes them", () => {
    const store = new ContentStore(905);
    store.add_detection_plan_items([
      { className: "p/Svc", methodName: "a", strategyCode: 11, status: "pending" },
      { className: "p/Svc", methodName: "b", strategyCode: 11, status: "pending", trivial: true },
    ], true);
    let gaps = local_plan_gaps(905);
    assert.equal(gaps.gaps.length, 2);
    assert.match(gaps.blockers[0], /2\/2 detection-plan method\(s\) have no write-back/);
    store.record_process_writeback({ parentBatchId: 1, className: "Svc", methodName: "a", strategyCode: 11, bugStatus: 6, writeMethod: "update-process" });
    store.save();
    gaps = local_plan_gaps(905);
    assert.deepEqual(gaps.gaps.map((g) => g.methodName), ["b"]);
    assert.equal(store.load_plan_only().detectionPlan.find((i: any) => i.methodName === "a").status, "written");
  });

  it("mark-bug: user verdicts (3/4/5/8) are stored on the local rank", () => {
    const store = new ContentStore(906);
    store.record_rank({ className: "p/Svc", methodName: "a", bugStatus: 6, parentBatchId: 1, writeMethod: "finalize-all" });
    assert.equal(store.apply_rank_verdict({ className: "p/Svc", methodName: "a", rankId: 9, parentBatchId: 1 }, 4, { operator: "u" }), true);
    const rk = store.load_writebacks_only().ranks.find((r: any) => r.methodName === "a");
    assert.equal(rk.bugStatus, 4);
    assert.equal(rk.rankId, 9);
    assert.equal(rk.operator, "u");
    assert.throws(() => store.record_rank({ className: "p/Svc", methodName: "z", bugStatus: 9 }), /bugStatus illegal/);
  });

  it("report: the risk right before ▎Pre-existing keeps its own era", () => {
    const summary = "📋[Requirement changes] x    🔍[Analysis scope] y    ⚠️[Risks]▎This change ▸(1)❗ A#a line 1｜Trigger conditions: t｜Impact: i ▸(2)⚡ B#b line 2｜Trigger conditions: t｜Impact: i ▎Pre-existing ▸(3)❗ C#c line 3｜Trigger conditions: t｜Impact: i    📌[Notes] n    ✅[Conclusion] c";
    const html = render_report_html({ taskId: 1, status: "completed", git: "g", developBranch: "d", contrastBranch: "main", submitUser: "u", summary }, []);
    const rows = [...html.matchAll(/<tr><td>(\d)<\/td><td><span class="sev[^"]*">\w+<\/span><\/td><td>(This change|Pre-existing)<\/td><td><code>(\w#\w)/g)].map((m) => [m[1], m[2], m[3]]);
    assert.deepEqual(rows, [["1", "This change", "A#a"], ["2", "This change", "B#b"], ["3", "Pre-existing", "C#c"]]);
  });
});
