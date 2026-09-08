import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { enrich_test_case_fields } from "../scripts/testcase_desc_parser.ts";

describe("enrich_test_case_fields", () => {
  it("accepts case id and keeps structured fields", () => {
    const result = enrich_test_case_fields({
      id: "wrong",
      title: "Reject negative checkout amount",
      preCondition: "User is logged in.",
      steps: "Submit checkout with price -1.",
      expectedResult: "API returns 400.",
      planId: 1001,
    }, "TC-1001");
    assert.equal(result.id, "TC-1001");
    assert.equal(result.preCondition, "User is logged in.");
    assert.equal(result.fetchStatus, "success");
    assert.ok(!("planId" in result));
    assert.ok(!("descParseStatus" in result));
  });

  it("parses free text desc when trio empty", () => {
    const result = enrich_test_case_fields({
      title: "Discount code filter",
      desc: "Precondition: Discount code is already on the blacklist\nSteps: 1. Query the list 2. Verify the filter\nExpected: The entry does not appear in the results",
    }, "TC-9");
    assert.equal(result.id, "TC-9");
    assert.match(result.preCondition, /blacklist/);
    assert.match(result.steps, /Query the list/);
    assert.match(result.expectedResult, /does not appear/);
    assert.equal(result.descParseStatus, "parsed_from_desc");
    assert.equal(result.fetchStatus, "success");
  });

  it("empty payload marks fetch status empty", () => {
    const result = enrich_test_case_fields({}, "TC-empty");
    assert.equal(result.id, "TC-empty");
    assert.equal(result.fetchStatus, "empty");
    assert.equal(result.preCondition, "");
    assert.equal(result.steps, "");
  });
});
