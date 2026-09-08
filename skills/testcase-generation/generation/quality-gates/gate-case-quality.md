# R4: Single-case review (Case Review)

> **Role**: Review the content quality of each case `.md` file and ensure the case is executable, unambiguous, complete in engineering info, and compliant with the template structure.
> **Two usage scenarios**:
> - **L1 inline self-check**: In generate-skill **Phase 3 Step Two**, each generation subagent runs this immediately after writing its case files, using only Step R4-3 rules to self-check the cases it owns, fix them in place, then report back to the main agent.
> - **Independent review round**: After generate-skill **Phase 3 Step Two** is fully complete (optional; triggered when the user asks for a full review or L1 self-check reports many anomalies), or after update-skill modifies cases (required). The main agent runs the full R4-1 → R4-2 → R4-3 → R4-4 flow.
>
> **Token strategy**: The main agent only reads case-registry.json (filePath/caseName/caseType/coverage fields; the independent review round also reads the business_rules_digest field). Case `.md` files are read in parallel by subagents; each subagent owns one batch (≤5 cases).

---

## Input

| Input | Description |
|------|------|
| `usecases/testdocs/case-registry.json` | Read only filePath/caseName/caseType/category/source_design_ref/coverage fields; the independent review round also reads the business_rules_digest field (used for consistency checks against `.md` content) |
| `usecases/testdocs/design.md` | Required for `category: regression` cases: use `source_design_ref` to locate the referenced `classification=regression scenario` design point and read "Verification summary", "Covered interfaces", and "Source"; used to verify that steps only reproduce legacy flows |
| `usecases/testdocs/integrations-resolved.json` | Protocol enum, Mock protocol, and engineering table header fields; review and lint compare against this file and must not require Redis / KV store / Thrift as mandatory |
| `.md` files pointed to by each registry entry's `filePath` | Read by subagents via filePath, ≤5 cases per batch |

---

## Execution flow

```
Step R4-1  Main agent reads the registry and batches by caseType
  ↓
Step R4-2  Dispatch subagents in parallel (≤5 cases per batch)
  ↓
Step R4-3  Each subagent runs deterministic rule checks + template structure checks + semantic quality checks
  ↓
Step R4-4  Main agent aggregates findings and applies disposition
```

---

## Step R4-1: Batching strategy

The main agent reads the registry and batches by these rules:

- ≤5 cases per batch
- Cases of the same caseType should be batched together first (so a subagent can reuse context)
- Batch count = ceil(total cases / 5), at most 10 parallel subagents

---

## L1 inline self-check execution (used by generate-skill Phase 3 Step Two subagents)

> ⚠️ **Applies only to the L1 inline self-check scenario**. Ignore this section in an independent review round and follow the full R4-1 → R4-2 → R4-3 → R4-4 flow.

When a subagent runs R4-3 checks, choose the execution method by this priority:

1. **Required**: Run `{SKILL_ROOT}/generation/quality-gates/lint_case_documents.ts` with `node --experimental-strip-types --experimental-default-type=module` for deterministic rule checks (pass `--resolved usecases/testdocs/integrations-resolved.json` so table.profile_headers is compared against the resolution instead of hard-coded Redis/KV/Thrift). After the script emits findings, still run the template-structure and semantic-quality checks — those still need judgement.
2. **Fallback**: If the script is genuinely missing, say so in the report and check every Step R4-3 deterministic item by hand. Do not skip the script because it is "optional".

Both methods use the same check items and finding format; the report format back to the main agent does not change.

---

## Step R4-2: Subagent dispatch

The main agent passes to each subagent:

```
Task: Review the following case files and run R4 deterministic rule checks + template structure checks + semantic quality checks
Case list:
  - {filePath} (include this entry's caseName/caseType/category/source_design_ref/coverage; read the full file yourself)
  - ... (≤5 cases)
Design file: {absolute path to design.md} (only when the list contains a category=regression case; use that case's source_design_ref to locate the referenced regression-scenario design point)

Steps:
  1. For each case, read the full .md with read_file; when category=regression, also read the design point referenced by `source_design_ref` in design.md
  2. Check every item in Step R4-3 deterministic rule checks
  3. Check every item in Step R4-3 template structure checks
  4. Check every item in Step R4-3 semantic quality checks
  5. Report every finding (if none, report noIssueFound: true)

Check spec: see gate-case-quality.md Step R4-3
Output format: see gate-case-quality.md Step R4-3 Finding format
```

---

## Step R4-3: Subagent checks

### Deterministic rule checks (mechanical, unambiguous)

Check every case item by item:

| Check item | Judgment | Finding type | Severity |
|--------|----------|-------------|----------|
| Required fields complete | The case file is missing any of: case name (H1 title) / Prerequisites (at least one subsection) / Steps table / Expected results; when caseType=SERVER, chapter 4. Engineering Info must also include the Server APIs subsection | `FIELD_MISSING` | P0 |
| H1 vs body separator (optional) | Not required. If the case uses a separator comment, write `<!-- case-body-start -->` so local scripts can split title and body; missing it is not a finding | — | — |
| Frontmatter complete and consistent | The `.md` is missing a frontmatter block (wrapped by `---`), or frontmatter is missing `caseId`/`caseType`, or `caseId` is not a valid non-empty UUID, or `caseId`/`caseType` do not match the corresponding registry entry | `FRONTMATTER_MISMATCH` | P0 |
| Interface info format valid | In the 4. Engineering Info → Server APIs subsection, the protocol is not in `profile.protocols`; or the methodName is empty / an unreplaced placeholder; http must be `{HTTP method} {path}`, grpc must be a qualified name. Do not use semantic service-name abbreviations. Enterprise-added protocols in protocols are validated by their agreed format | `INTERFACE_INVALID` | P1 |
| Expected result is assertable | The expected result contains assertable wording such as "returns xxx" / "status becomes xxx" / "DB record xxx", not vague words such as "normal" / "success" / "failure" / "as expected"; copy / prompts / error codes / status values already specified in the PRD or technical design must be quoted verbatim rather than vaguely summarized | `ASSERTION_VAGUE` | P1 |
| Preconditions are constructible | Every data dependency in the preconditions has an explicit construction method (DB insert / API call / Mock) and does not contain "assume exists" / "data already exists" | `PRECONDITION_AMBIGUOUS` | P1 |
| Downstream Mock declared | When the case involves an external dependency (RPC/HTTP downstream), the mock field is not empty | `MOCK_MISSING` | P1 |
| Steps are executable | Test steps do not contain non-executable wording such as "verify business logic" / "check if correct" | `STEP_NOT_EXECUTABLE` | P1 |
| Parameter values are concrete | Request params do not contain placeholder wording such as "valid value" / "valid ID" / "correct params"; they must be concrete values or an explicit construction source | `PARAM_PLACEHOLDER` | P1 |
| Case name format | caseName format is `[domain-flow/page] scenario-goal` and does not contain a UUID / TC number / special characters | `NAME_FORMAT_INVALID` | P2 |
| Construction column left empty | Every row in the test-data table "Construction" column must be empty (backfilled by `testdata-generation`); any non-empty content is a violation | `CONSTRUCT_COL_NOT_EMPTY` | P0 |
| Folding-block content partition | In 3. Request and Assertions, a "request" fold may contain only request JSON; an "expected" fold may contain only `jsonc` expected assertions (API response / DB / cache / MQ); the two must not be mixed (expected assertions in a request block, or request construction in an expected block) | `DETAILS_CONTENT_MIXED` | P1 |
| No inline params in steps | Step descriptions must not append parameter values directly (e.g. `deliveryType=4`, `type=1`); request params are shown only in the 3. Request and Assertions folds | `STEP_INLINE_PARAM` | P1 |
| Interface-trigger step format (SERVER) | For caseType=SERVER cases, a step that calls a server API must be written as `→ trigger call `{methodName}`, request/expected see 3. Request and Assertions` — **write only the simple method name** (short form). FQCN/serviceId/protocol and other base info are listed in the 4. Engineering Info → Server APIs table, and the methodName in the step must **map 1:1** to that table; do not use semantic service-name abbreviations; if chapters 3 and 4 were deleted as whole chapters, do not cite them | `STEP_TRIGGER_FORMAT` | P1 |
| UI steps must not call APIs | For caseType=UI cases, if a step contains `→ trigger call` or a methodName (e.g. `addCartItem`, `com.xxx.XxxService.method`), keep only user-perspective action wording | `UI_STEP_HAS_TRIGGER` | P1 |
| Engineering config must not be inferred | Identifiers declared in `profile.components[].fields` (defaults: datasource / table / shardingRule / cluster / key / topic / producer / config key, etc.) must come from `analysis.md` or be marked `TBD`; an undeclared profile field or a concrete value with no source is treated as fabrication | `CONFIG_FIELD_FABRICATED` | P1 |
| Filename consistency | The `.md` filename (without the `.md` suffix) is not exactly equal to the registry `caseName` | `FILENAME_MISMATCH` | P0 |

### Template structure checks (against the manual-case-template.md template)

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Chapter heading level | Chapter 1/2/3/4 headings must be `###` (H3); subsection headings must be `####` (H4); using `####` for a chapter heading or `###` for a subsection heading is a violation | `HEADING_LEVEL_WRONG` | P1 |
| Table header format correct | The test-data header must be `\| Entity \| Content \| Construction \|`; the step header must be `\| # \| Step \| Expected \|`; the Server APIs subsection header must be `\| serviceId \| API type \| API name \|`, one row per service; database / cache / mq / config / experiment subtable headers must equal the matching component `fields` in `integrations-resolved.json` (defaults: one table each for Database / Cache / MQ / Config service / Experiment). `Cache · Redis`, `Cache · KV store`, or a column name outside the profile is a violation | `TABLE_HEADER_WRONG` | P1 |
| Folding-block title and uniqueness | The `<summary>` title of a `<details>` fold must be `Step N · {methodName} request` or `Step N · {methodName} expected`; the file may contain only one "3. Request and Assertions" chapter (`### Request and Assertions` or `### {N} · Request and Assertions`); more than one is a violation | `DETAILS_TITLE_FORMAT` | P1 |
| Request JSON source | Each interface's request JSON in 3. Request and Assertions must come from the corresponding interface's `<details>` request/response details in `api-details.md`; do not invent the field structure; if `api-details.md` has no `<details>` block for that interface, mark the source as missing instead of fabricating it | `INPUT_SOURCE_MISSING` | P1 |
| Key request-field comments | A request fold must use commented `jsonc` (not plain `json`); **key fields** must have inline `//` comments for meaning + legality basis + expected branch — including: (1) business enum / status switches; (2) legal/illegal construction fields (positive vs negative distinction); (3) boundary-value fields; (4) scenario-difference fields (fields that distinguish this case from others); (5) per-element comments when an array mixes legal and illegal elements. Judgment: for positive/negative / boundary / branch-coverage cases, request JSON with no `//` comment is a violation; simple base fields (constants and path params with no scenario difference) may omit comments and that is not a violation | `INPUT_KEY_FIELD_UNANNOTATED` | P1 |
| Expected-column ▸ prefix format | The Steps table Expected column must use `▸ {dimension} {locator}: {key value}` and put each dimension on its own line (`<br>` separated); ⛔ different dimensions must not share one line; ⛔ do not stack legacy bold tags such as `**page behavior**` / `**API response**` / `**DB**`; when a UI case includes a backend call, write `▸ page behavior: ...` first, then a backend summary `▸ API response/DB/cache/...` plus a trailing `See chapter 3`; pure frontend UI (no backend call) has only `▸ page behavior: ...` / `▸ tracking: ...` lines and does not need `See chapter 3`; SERVER cases have only backend-summary `▸` lines + `See chapter 3`. Degradation label format is `{dimension} check: TBD (engineering info missing, complete after supplying {missing field})` | `ASSERTION_LABEL_FORMAT` | P1 |
| Test-data entity source | Every row in the test-data table must come from the same entity row in `design.md §2`; do not invent out-of-list entities, and do not copy only the entity name while dropping the matching identifier, conditions, or mutex info | `TESTDATA_SOURCE_INVALID` | P1 |
| Test-data content and placeholder rules | The "Content" column must include the standard identifier placeholder from the matching §2 entity row, and must fully express that row's construction conditions / business constraints and mutex conditions in natural language. Encoding pickup/non-pickup, user type, order status, construction method, business meaning, or a meaningless serial number into the placeholder, or merging entities with different conditions into one row, is a violation | `TESTDATA_CONSTRAINT_INVALID` | P1 |
| No template residue | The file must not contain an empty table (header row with no data rows), an empty section (a heading followed immediately by the next same-level or higher heading with no content), or template-instruction comments (template guidance lines starting with `>`, e.g. `> Fill in here`, `> Example:`, `> Template notes`, `> Placeholder check`, and other original template guidance) | `TEMPLATE_RESIDUE` | P1 |
| Placeholder rules | In request JSON, field values that depend on an entity (system-generated identifiers such as userId/orderId/couponId) did not keep the `{placeholder}` form (they were written as a concrete fake value such as "123456"), or a field determined by scenario semantics (e.g. `clientType`, `phone`, `deliveryType`, enums, operation type, fixed flags) was written as `{placeholder}`; context, Config service/Experiment/gray release, Mock, environment variables, and cache switches must not receive a placeholder merely because they appear in the test-data table | `PLACEHOLDER_RULE_VIOLATED` | P1 |
| Prerequisite / Engineering Info subsections kept as needed | Compare against `profile.components`: coverage involves config/degradation but "Config service" is missing; or involves gray release/AB and the profile has experiment but "Experiment" is missing; or involves downstream-exception Mock (and the protocol is in mockableProtocols) but "Mock" is missing; or involves DB but chapter 4 is missing "Database"; or involves cache but chapter 4 is missing **one** "Cache" table (not Redis/KV split tables); or involves MQ but "MQ" is missing; or involves server APIs but "Server APIs" is missing (the inverse — a subsection appearing when coverage does not involve it — is also a violation) | `PRECONDITION_SECTION_MISMATCH` | P1 |
| Teardown completeness | Prerequisites have a Mock subsection but Teardown is missing "restore Mock"; or Prerequisites changed Config service but Teardown is missing "restore config service"; or Steps changed an entity but Teardown is missing "restore test data" | `POSTACTION_MISSING` | P1 |
| Extra teardown | Teardown contains a restore item not involved in Prerequisites/Steps (e.g. Prerequisites have no Mock but Teardown has "restore Mock") | `POSTACTION_EXTRA` | P2 |
| Chapter numbering continuity | Chapter order is fixed: 1. Prerequisites → 2. Steps and Expected Results → 3. Request and Assertions → 4. Engineering Info → 5. Teardown. Chapters 3/4/5 are deleted as whole chapters when the case does not involve them (pure frontend UI cases delete chapters 3 and 4; no teardown deletes chapter 5); when a step cites `request/expected see X. Request and Assertions`, X must match the actual chapter number (X is "3" when chapter 3 exists; if chapter 3 was deleted, the entire citation and the step-trigger format do not appear) | `SECTION_NUMBER_WRONG` | P2 |
| Assertion-dimension completeness | Per case-authoring-rules.md §1.6 assertion-dimension selection: a write with no DB assertion; a cache update with no cache assertion; an MQ send with no MQ assertion; a downstream call with no downstream-call assertion — one finding per missing dimension. **SERVER cases are checked in chapter 3 expected folds (`// ② DB` / `// ③ Cache` / `// ④ MQ` segments); UI cases are checked in the Steps table Expected column** | `ASSERTION_DIMENSION_MISSING` | P1 |
| Test-data identifier and condition format | Entity identifiers in the test-data "Content" column must keep the matching §2 `{placeholder}` (backfilled by `testdata-generation`) and must not show a concrete fake value; construction conditions / business constraints and mutex conditions must be added in natural language in the same Content cell and must not be placeholder-only or empty | `TESTDATA_NOT_PLACEHOLDER` | P1 |
| UI case version-range row | For caseType UI cases, the Client environment subsection is missing the "Version range" row (fill a concrete version or `TBD`; do not delete the row) | `UI_VERSION_MISSING` | P1 |
| Expected folds come in pairs | **Any case that involves a backend call** (SERVER cases and UI cases with a backend call): a step that calls an interface has a "request" fold but no matching "expected" fold (or the inverse); or the "expected" fold is empty | `EXPECT_BLOCK_MISSING` | P0 |
| API-response field completeness | **Any case that involves a backend call** (SERVER and UI with a backend call): in the expected fold `// ① API response` segment, `data` is not listed field-by-field from the `api-details.md` response structure (only code/msg, or response fields omitted); or the whole case only asserts the `// ② DB` dimension and has no `// ① API response` segment | `EXPECT_RETURN_INCOMPLETE` | P1 |
| Expected-fold format | **Any case that involves a backend call** (SERVER and UI with a backend call): the expected fold does not use a `jsonc` code block plus `// ① API response` / `// ② DB` / `// ③ Cache` / `// ④ MQ` dimension-segment headers; or when DB/cache/MQ locator info (must be profile fields; defaults datasource/table/shardingRule/cluster/key/topic/producer) is missing, it fabricates a concrete value instead of labeling `TBD (engineering info missing)` | `EXPECT_FORMAT_WRONG` | P1 |
| Steps-table summary does not degrade | **Applies to UI / SERVER cases**: the Steps table Expected summary degrades to non-concrete wording such as "as expected/success/failure/normal"; or an API-response summary line does not include methodName + status/error code; or a backend assertion is involved but the end is missing the `See chapter 3` index; or a page-behavior line does not quote copy specified in `analysis.md` (blurred into "prompt success", etc.) | `SUMMARY_VAGUE` | P1 |

### Semantic quality checks (require understanding the content)

| Check item | Judgment | Finding type | Severity |
|--------|---------|-------------|---------|
| Steps match expected results | The object/params operated on in the test steps do not match the object verified in the expected-result description | `STEP_RESULT_MISMATCH` | P1 |
| Preconditions conflict with steps | The state set by preconditions contradicts the premise of the test steps | `PRECONDITION_CONFLICT` | P0 |
| coverage matches case content | The registry coverage description for this case does not match what the case file actually tests | `COVERAGE_MISMATCH` | P1 |
| Regression steps mixed with incremental logic | When `category=regression`, the case Prerequisites, Steps, called interfaces/sequence, parameter values, or assertion fields contain content that cannot be proven as a legacy flow by the owning module's matching regression-scenario row ("Verification summary", "Covered interfaces", "Source"), but is used to verify a newly added/changed entry, param/enum, field, branch, or behavior | `REGRESSION_STEP_CONTAMINATED` | P0 |
| Regression steps have no legacy source | When `category=regression`, the owning module has no matching `classification=regression scenario` row, or the case steps/assertions cannot be traced to that row's "Verification summary", "Covered interfaces", and "Source"; do not backfill the basis from this-change descriptions in analysis.md, the PRD, or the technical design | `REGRESSION_STEP_NO_LEGACY_SOURCE` | P0 |
| Exception cases have an exception trigger | For a case whose caseName or coverage contains keywords such as "exception" / "illegal" / "failure" / "error", the test steps include an explicit exception-trigger action (illegal params / Mock error return / abnormal DB data) | `EXCEPTION_NOT_TRIGGERED` | P1 |
| Boundary cases have boundary values | For a case whose caseName or coverage contains keywords such as "boundary" / "max" / "min" / "threshold", the request params include an explicit boundary value (max / min / critical value) | `BOUNDARY_VALUE_MISSING` | P1 |
| Expected-result degradation labels are correct | An expected result contains the degradation label `TBD (engineering info missing)`, and that engineering info is indeed missing from analysis.md (not the subagent skipping the lookup); conversely, analysis.md already has explicit engineering info but the expected result still says `TBD` is also a violation | `DEGRADATION_LABEL_WRONG` | P1 |
| business_rules_digest accuracy | The `business_rules_digest` extracted from the `.md` / already written into the registry must accurately summarize the core business rules this case verifies: it must not omit key business rules explicitly verified in the `.md` (e.g. amount thresholds, state-machine constraints, limit conditions), and must not invent rules the `.md` does not cover; L1 self-check validates the digest about to be reported, the independent review round validates the digest already written in the registry; an empty digest or one that only copies caseName is also a violation | `BUSINESS_DIGEST_INACCURATE` | P2 |

### Finding format

```
[{Severity}] {Finding type} | {caseName}
Issue: {concrete description, quote the original text in the case}
Suggestion: {fix direction}
```

Example:
```
[P1] ASSERTION_VAGUE | [Order-Checkout Flow] happy path-order succeeds with sufficient inventory
Issue: expected result is "API returns success", no concrete assertion
Suggestion: change to "API returns HTTP 200, response body data.orderId IS NOT NULL, data.status = 'CREATED'"

[P0] CONSTRUCT_COL_NOT_EMPTY | [Coupon-Issue API] happy path-issue coupon succeeds
Issue: test-data table "Construction" column row 1 is filled with "create via API"
Suggestion: clear every row in the "Construction" column; that column is backfilled by `testdata-generation`

[P1] PLACEHOLDER_RULE_VIOLATED | [Order-Checkout Flow] happy path-order succeeds with sufficient inventory
Issue: userId in the request JSON is "123456"; this field depends on an entity (system-generated) and must keep a placeholder
Suggestion: change to "{userId}"
```

---

## Step R4-4: Main agent aggregation + disposition

### Aggregation rules

The main agent collects all subagent findings and groups them by Severity:

```
R4 single-case review complete
Cases reviewed: {N}  |  P0 issues: {x}  P1 issues: {y}  P2 suggestions: {z}

P0 issues (blocking, fix immediately):
  [P0] FIELD_MISSING | xxx-case-name
  ...

P1 issues (must fix, may be batched):
  [P1] ASSERTION_VAGUE | xxx-case-name
  ...

P2 suggestions (optional optimization):
  [P2] NAME_FORMAT_INVALID | xxx-case-name
  ...
```

### Disposition rules

**Has P0 finding**:
- The main agent re-dispatches the P0 finding plus the case file path to the corresponding subagent and requires an in-place fix
- After the subagent reports the fix, the main agent dispatches a verification subagent to read the file and confirm the P0 finding is gone
- Continue after the fix is complete

**Has P1 finding (count ≤ 10)**:
- The main agent dispatches the P1 findings plus file paths to the corresponding subagent for item-by-item fix
- Continue after the fix is complete

**Has P1 finding (count > 10)**:
- List all P1 findings and ask the user: batch fix / skip / selective fix
- Dispatch subagents per the user's instruction

**Only P2 findings or no findings**:
- Output the review summary and end the flow

---

## Forbidden actions

- The main agent directly reads or modifies case `.md` files (both reads and fixes must go through a subagent)
- Except for `category=regression` cases reading `design.md` to locate a legacy regression basis, a subagent reads upstream intermediate files other than analysis.md (during L1 inline self-check the subagent already has analysis.md read access, which may be used to compare the source of engineering config)
- Blocking the flow on a P2 finding
- Only labeling a finding for vague expected results such as "normal" / "success" without fixing them (P1 findings must be fixed)
- Changing the case's test intent while fixing (only fix wording issues, do not change the test scenario)
