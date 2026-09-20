import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse_exception } from "../scripts/parse_exception.ts";
import {
  build_skeleton_markdown,
  extract_branch,
  extract_facts,
  extract_swallow,
  gist,
  persist_draft,
  story_gaps,
  type ReportFacts,
} from "../scripts/draft_report.ts";
import { body_char_count, fit_chars, fit_parts, validate_report, SECTION_CHAR_LIMIT } from "../scripts/report.ts";

const NESTED_IF = `    public List<BmWaybill> getByRiderIdAndStatus() throws Exception {
        if (QingniuDegradeUtils.isDegrade(ConfigKeyCons.FIX_TRNSFER_AFTER_REDIGNATE_DEGRADE)) {
            bmWaybills = iBmWaybillRepository.batchBriefByRiderIdAndStatuses(riderId, statuses);
        }else {
            bmWaybills = iBmWaybillRepository.batchWaybillFromIndexSupplySuqirrel(riderId, statuses);
        }
        return bmWaybills;
    }`;

const QUERY_SWALLOW = `    @Override
    protected List<DistributionTask> query(SearchContext context) {
        try {
            List<BmWaybill> bmWaybillList = bmWaybillService.getByRiderIdAndStatus();
            return BmWaybillHelper.transToDistributionTask(bmWaybillList);
        } catch (Exception e) {
            log.error("#UnFinishSearcher.query#,error", e);
        }
        return Collections.emptyList();
    }`;

function deadlock_fixture(): { parsed: ReturnType<typeof parse_exception>; brief: Parameters<typeof extract_facts>[1] } {
  const parsed = parse_exception(`java.sql.SQLException: Deadlock found when trying to get lock
	at com.sankuai.meituan.banma.desp.common.base.repository.impl.BmWaybillMySQLRepositoryImpl.batchBriefByRiderIdAndStatuses(BmWaybillMySQLRepositoryImpl.java:178)
	at com.sankuai.deliverywaybill.desp.rider.service.query.BmWaybillService.getByRiderIdAndStatus(BmWaybillService.java:70)
	at com.sankuai.deliverywaybill.desp.rider.component.search.unfinish.AbstractUnFinishSearch.query(AbstractUnFinishSearch.java:46)
	... (后续同上 → RiderDistributionTaskSearchService → ThriftServiceIfaceImpl)
`);
  const brief = [
    { key: "BmWaybillMySQLRepositoryImpl#batchBriefByRiderIdAndStatuses", weak: true },
    {
      key: "BmWaybillService#getByRiderIdAndStatus",
      weak: false,
      lineDrift: true,
      hint: "stack line 70 is outside 94-106",
      callPath:
        "com.sankuai.deliverywaybill.desp.rider.component.search.unfinish::query(L40)→com.sankuai.deliverywaybill.desp.rider.service.query::getByRiderIdAndStatus(L94)",
      source: {
        startLine: 94,
        endLine: 106,
        text: NESTED_IF,
      },
    },
    {
      key: "AbstractUnFinishSearch#query",
      weak: false,
      callPath: "com.sankuai.deliverywaybill.desp.rider.component.search::search(L205)→com.sankuai.deliverywaybill.desp.rider.component.search.unfinish::query(L40)",
      source: { startLine: 40, endLine: 55, text: QUERY_SWALLOW },
    },
    {
      key: "AbstractSearcher#search",
      weak: false,
      callPath:
        "com.sankuai.deliverywaybill.desp.rider.service::getUnConfirmedTask(L283)→com.sankuai.deliverywaybill.desp.rider.component.search::search(L205)",
    },
  ];
  return { parsed, brief };
}

function filled_from_facts(f: ReportFacts): string {
  const throwCls = f.throwKey.split("#")[0];
  const thenCall = f.branch.thenCall || "path";
  const elseCall = f.branch.elseCall || "";
  const hypoEn = f.lineDrift.length ? "Hypothesis: " : "";
  const hops = f.hops.join(" → ") || f.entry;
  return `# Exception diagnosis

## Executive summary
${f.exceptionType}. Root ${f.rootKey || throwCls}. Confidence: ${f.confidence}.

## Symptom and exception facts
${f.exceptionType}. Primary ${f.throwKey}.

## Mapped call path
Entry ${f.entry}. Hops ${hops}. ${hypoEn}${thenCall}. Throw ${throwCls}.

## Root cause
Throw ${throwCls} is trigger, not root. ${hypoEn}${f.rootKey}: ${thenCall}${elseCall ? ` not ${elseCall}` : ""}. Raced shared work.

## Trigger
Throw ${throwCls}. Not the root.

## Contributing factors
${f.swallowKey || "n/a"}. ${f.evidenceGaps[0] || "none"}.

## Suggested fix and verification
Change ${f.rootKey || throwCls}. Replay this stack.

## Confidence and gaps
${f.confidence}. Gap: ${f.evidenceGaps.join("; ") || "none"}.
`;
}

describe("fit_chars", () => {
  it("counts only non-whitespace 字", () => {
    assert.equal(fit_chars("a b  c", 2), "a b");
    assert.equal(body_char_count(fit_chars("字".repeat(120), SECTION_CHAR_LIMIT)), SECTION_CHAR_LIMIT);
  });

  it("does not cut a mid-identifier when a prior token exists", () => {
    assert.equal(fit_chars("hello batchBriefByRiderIdAndStatuses", 20), "hello");
  });
});

describe("fit_parts", () => {
  it("keeps mandatory parts and drops optional overflow", () => {
    const out = fit_parts(
      [
        { text: "Throw Site.", keep: true },
        { text: "x".repeat(200) },
      ],
      20,
    );
    assert.match(out, /Throw Site/);
    assert.ok(body_char_count(out) <= 20);
  });
});

describe("extract_branch", () => {
  it("parses nested if/else method calls without assuming a flag helper name", () => {
    const branch = extract_branch(`
        if (QingniuDegradeUtils.isDegrade(ConfigKeyCons.FIX_TRNSFER_AFTER_REDIGNATE_DEGRADE)) {
            bmWaybills = iBmWaybillRepository.batchBriefByRiderIdAndStatuses(riderId, statuses);
        }else {
            bmWaybills = iBmWaybillRepository.batchWaybillFromIndexSupplySuqirrel(riderId, statuses);
        }`);
    assert.equal(branch.thenCall, "batchBriefByRiderIdAndStatuses");
    assert.equal(branch.elseCall, "batchWaybillFromIndexSupplySuqirrel");
    assert.match(String(branch.cond), /isDegrade\(FIX_TRNSFER_AFTER_REDIGNATE_DEGRADE\)/);
  });

  it("parses a generic enabled/cache branch", () => {
    const branch = extract_branch(`if (flags.enabled(KEY)) { store.save(id); } else { store.cache(id); }`);
    assert.equal(branch.thenCall, "save");
    assert.equal(branch.elseCall, "cache");
  });

  it("treats if-return as a branch and continues to the next call", () => {
    const branch = extract_branch(`
        if (flags.isSkip(KEY, id)) {
            return null;
        }
        return client.fetch(id);
    `);
    assert.equal(branch.thenCall, "return");
    assert.equal(branch.elseCall, "fetch");
  });
});

describe("draft_report", () => {
  it("extracts facts and a heading skeleton without authoring RCA prose", () => {
    const { parsed, brief } = deadlock_fixture();
    const facts = extract_facts(parsed, brief);
    assert.equal(facts.throwKey, "BmWaybillMySQLRepositoryImpl#batchBriefByRiderIdAndStatuses:178");
    assert.equal(facts.rootKey, "BmWaybillService#getByRiderIdAndStatus");
    assert.equal(facts.branch.thenCall, "batchBriefByRiderIdAndStatuses");
    assert.equal(facts.branch.elseCall, "batchWaybillFromIndexSupplySuqirrel");
    assert.equal(facts.swallowKey, "AbstractUnFinishSearch#query");
    assert.ok(facts.lineDrift.some((d) => d.includes("70")));
    assert.equal(facts.confidence, "medium");
    assert.match(facts.entry, /RiderDistributionTaskSearchService#getUnConfirmedTask/);
    assert.ok(facts.hops.some((h) => h.startsWith("BmWaybillService#getByRiderIdAndStatus")));
    assert.ok(facts.mustCite.mapped.includes(facts.throwKey));
    assert.equal(facts.messageGist.includes("10."), false);
    assert.notEqual(facts.messageGist, "deadlock");

    const md = build_skeleton_markdown();
    const check = validate_report(md);
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.equal(md.includes("concurrent lock holders"), false);
    assert.equal(md.includes("keep non-throwing"), false);
    assert.equal(md.includes("swallows catch-all"), false);
    assert.equal(md.includes("verify revision or retry"), false);
    assert.equal(md.includes("异常诊断"), false);
    const gaps = story_gaps(md, facts);
    assert.ok(gaps.includes("mapped-empty"));
    assert.ok(gaps.includes("root-empty"));
    assert.ok(gaps.includes("missing-confidence"));
    assert.equal(gaps.some((g) => g.endsWith("-zh")), false);
  });

  it("accepts a filled English draft that cites extracted facts", () => {
    const { parsed, brief } = deadlock_fixture();
    const facts = extract_facts(parsed, brief);
    const md = filled_from_facts(facts);
    const check = validate_report(md);
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(story_gaps(md, facts), [], md);
  });

  it("flags missing hypothesis when lineDrift and root is stated as certain", () => {
    const md = `# Exception diagnosis

## Executive summary
SQLException: lock wait. Root Foo. Confidence: medium.

## Symptom and exception facts
SQLException: lock wait. Primary BmWaybillMySQLRepositoryImpl#x:1.

## Mapped call path
Throw BmWaybillMySQLRepositoryImpl. Branch → batchBriefByRiderIdAndStatuses. Entry Bar.

## Root cause
Throw BmWaybillMySQLRepositoryImpl is trigger, not root. In-repo root Foo: when isDegrade it called batchBriefByRiderIdAndStatuses instead of batchWaybillFromIndexSupplySuqirrel. Raced concurrent work.

## Trigger
Throw BmWaybillMySQLRepositoryImpl. Not the root.

## Contributing factors
weak frames.

## Suggested fix and verification
replay this stack.

## Confidence and gaps
Medium. Gap: lineDrift.
`;
    const gaps = story_gaps(md, {
      throwKey: "BmWaybillMySQLRepositoryImpl#x:1",
      branch: { thenCall: "batchBriefByRiderIdAndStatuses", elseCall: "batchWaybillFromIndexSupplySuqirrel" },
      lineDrift: ["BmWaybillService#getByRiderIdAndStatus:70 vs 94-106"],
    } as ReportFacts);
    assert.ok(gaps.includes("root-missing-hypothesis-on-drift"), JSON.stringify(gaps));
    assert.equal(gaps.some((g) => g.endsWith("-zh")), false);
  });

  it("detects catch-all empty/default swallow without encoding a race slogan", () => {
    assert.equal(extract_swallow(QUERY_SWALLOW), true);
    assert.equal(extract_swallow("try { run(); } catch (Exception e) { return null; }"), true);
    assert.equal(extract_swallow(NESTED_IF), false);
    assert.equal(
      extract_swallow(`
        if (flag) { return null; }
        try { return client.fetch(); }
        catch (TException e) { throw e; }
        catch (Exception e) { throw e; }
      `),
      false,
    );
  });

  it("gists a host:port message without cutting an IP or collapsing by exception class", () => {
    const parsed = parse_exception(`org.apache.thrift.TException: mtthrift remote(10.147.23.189:8080) invoke(getUser) method timeout
	at com.example.app.UserProxy.getUser(UserProxy.java:29)
`);
    const facts = extract_facts(parsed, [
      {
        key: "UserProxy#getUser",
        weak: false,
        source: { text: "User getUser() { return client.fetch(); }", startLine: 20, endLine: 30 },
      },
    ]);
    assert.equal(facts.messageGist.includes("10.147"), false);
    assert.equal(facts.messageGist, gist(parsed.message, 48));
    assert.match(facts.messageGist, /invoke\(getUser\)/);
    assert.notEqual(facts.messageGist, "timeout");
    assert.match(facts.messageGist, /timeout/i);
    assert.equal(facts.throwKey, "UserProxy#getUser:29");
    const md = build_skeleton_markdown();
    assert.equal(md.includes("TException: timeout"), false);
    assert.equal(md.includes("callee/IO wait"), false);
  });

  it("keeps timeout in the gist when invoke(method) is long", () => {
    const parsed = parse_exception(`org.apache.thrift.TException: mtthrift remote(10.147.23.189:8080) invoke(getFullUserStationByUserId) method timeout
	at com.sankuai.deliverywaybill.desp.rider.proxy.BmUserQueryProxy.getBmFullUserWithStationById(BmUserQueryProxy.java:29)
`);
    const facts = extract_facts(parsed, [
      {
        key: "BmUserQueryProxy#getBmFullUserWithStationById",
        weak: false,
        source: { text: "BmFullUser getBmFullUserWithStationById() { return client.getFullUserStationByUserId(id); }", startLine: 22, endLine: 40 },
      },
    ]);
    assert.equal(facts.messageGist.includes("10.147"), false);
    assert.match(facts.messageGist, /invoke\(getFullUserStationByUserId\)/);
    assert.match(facts.messageGist, /timeout/i);
    assert.ok(body_char_count(facts.messageGist) <= 48);
    assert.notEqual(facts.messageGist, "timeout");
  });

  it("persists facts.json and a heading skeleton under DIAGNOSE_DATA_DIR", () => {
    const tmp = mkdtempSync(join(tmpdir(), "diag-draft-"));
    const saved = process.env.DIAGNOSE_DATA_DIR;
    process.env.DIAGNOSE_DATA_DIR = tmp;
    try {
      const parsed = parse_exception("java.lang.NullPointerException: order is null\n\tat com.example.OrderService.checkout(OrderService.java:42)\n");
      const draft = persist_draft(1, parsed, [
        { key: "OrderService#checkout", weak: false, source: { text: "void checkout(Order o) { o.id(); }", startLine: 40, endLine: 50 } },
      ]);
      assert.equal(draft.validated, false);
      assert.ok(draft.storyGaps.includes("mapped-empty"));
      assert.match(draft.path, /report\.draft\.md$/);
      assert.match(draft.factsPath, /facts\.json$/);
      assert.equal(existsSync(draft.factsPath), true);
      const facts = JSON.parse(readFileSync(draft.factsPath, "utf8"));
      assert.equal(facts.throwKey, "OrderService#checkout:42");
      assert.equal(draft.chat.en, "");
      assert.match(readFileSync(draft.path, "utf8"), /## Root cause/);
      assert.equal(readFileSync(draft.path, "utf8").includes("keep non-throwing"), false);
    } finally {
      if (saved === undefined) delete process.env.DIAGNOSE_DATA_DIR;
      else process.env.DIAGNOSE_DATA_DIR = saved;
    }
  });
});
