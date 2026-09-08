# Detection summary spec

## Baseline requirements

- **`--summary` must be written back**: write it to the current platform provider via `complete-task --summary` or a later `update-summary`, and show it in the report.

### Positioning: the terminal artifact the user reads directly

The summary is what the user **reads directly** after opening the report — no second Agent interpretation, no extra context. A glance must answer: where is the problem, what to watch, and whether to act.

**Four principles**:

1. **Only talk about what has a problem**: do not mention dimensions/directions/items that are fine. Do not write "no issue found in XX direction", "XX check passed", "XX dimension is normal" — those have no action value and dilute what matters. If there is a problem, say it; if not, it does not exist in the summary.
2. **The user must understand it directly**: every identifier in the summary (class name, method name, config item, etc.) must be self-explanatory in context so the user does not need to open the code. Isolated internal codes (enum values, strategy numbers, system IDs) are forbidden — if the user cannot tell what an identifier means from the summary text alone, it should not appear.
3. **Do not output uncertain items**: likely false positives and low-confidence findings do not go into the summary. Only output deterministic content the user must take seriously, re-review, or act on.
4. **Every sentence must be real and traceable**: every piece of information in the summary must come from real detection data (code diff, writeback conclusions, test cases, requirement docs). Do not invent, speculate, or fabricate any fact. Concrete requirements:
   - **Line numbers / class names / method names**: must come from the actual code diff or real data returned by `get-pending`; do not invent from memory
   - **Defect descriptions**: must match already-written suspected-defect / Improvement conclusions; do not add unwritten "findings" in the summary
   - **Test cases / requirement rules**: must come from `test_cases` / `DOC_SUMMARY` actually loaded in the content store; do not invent case IDs or rule descriptions
   - **Numbers / stats**: e.g. "covered N classes M methods" must come from actual detection data (`get-pending` / `check-coverage` return values); do not estimate
   - **⛔ Absolutely forbidden**: any information in the summary that cannot be found in the detection-process data. Prefer writing one fewer item over inventing one extra

> Check standard: a tester or developer who does not know the detection process opens the report and within 10 seconds knows "what risks exist and what to watch at release". If any sentence makes the user wonder "what does this mean" or "how does this relate to me", it is written wrong. If the user verifies any item and it disagrees with reality, the whole report's credibility goes to zero.

## Format spec

Split sections with emoji+[] titles, separate sections with 4 spaces, and inside a section use ▸ numbers + ｜ pipes to separate fields. **Markdown tables are forbidden** (some report renderers collapse tables into an unreadable single line). The CLI intercepts forbidden words (internal codes / system names / field names must not appear in the user-facing summary).

### Readability spec (the user must spot key info at a glance)

Core principle: **sections are separated by emoji+[], items by numbers, fields by `｜` pipes** — three levels so the eye has anchors.

- **Between sections**: 4-space separator (already specified)
- **Between items**: mark each independent item with `▸(1)` `▸(2)` `▸(3)` (▸ is a visual anchor, more visible than a bare number)
- **Between fields**: inside each risk item, use `｜` (full-width pipe) to separate location, Trigger conditions, and impact
- **Severity**: put `❗/⚡/💡` at the front of the item (high/medium/low)
- **Notes**: group by dimension; each group starts with `►Test:` `►Release:` `►Compatibility:` `►Monitoring:`; multiple items inside a group are semicolon-separated
- **End of sentence**: end each item with a period before the next number so sentences break naturally

## Required sections

`validate-summary` / `update-summary` structure validation checks **5 section markers** (missing any one fails):

| Section | Marker | Content requirements |
|------|------|----------|
| Requirement changes | 📋[Requirement changes] | What features changed; which classes/methods are involved |
| Analysis scope | 🔍[Analysis scope] | How many services/classes/methods were covered; key chains |
| Risks | ⚠️[Risks] | **Most important section**; see requirements below |
| Notes | 📌[Notes] | **Most important section**; see requirements below |
| Conclusion | ✅[Conclusion] | Release advice based on the Risks |

There is also a **content section** (not counted in the 5-marker check above, but must be written when there are in-doubt findings):

| Section | Marker | Content requirements |
|------|------|----------|
| Pending confirmation | 🔔[Pending confirmation] | Business-confirmation points for in-doubt defects; see requirements below (when there is no open point, write "this detection has no open points; all defects were confirmed at high confidence") |

## ⚠️[Risks] — write in detail (no empty spinning, no vague summary)

Risks are the core value of the summary. The Agent **must list every risk** found during detection, and each risk includes:

- **Concrete location**: Class#method line N
- **Risk description**: under what conditions what problem happens
- **Impact scope**: which business scenes / user groups are affected
- **Severity**: mark with ❗ (high) / ⚡ (medium) / 💡 (low)
- **needs confirmation hint** (append when `[Confidence:MED/LOW]`): after the severity mark add `(needs confirmation)` so the user knows this item needs a focused review, e.g. `❗(needs confirmation)`. `[Confidence:HIGH]` defects need no extra mark

### 🔑 Hard split: This change vs Pre-existing (must execute)

> **Writeback already distinguished introduction period with `Problem tags: […][This change/Pre-existing]`. The summary Risks must also present the two layers strongly so the user sees at a glance "what risk did this change actually introduce".**

The Risks section **splits into two sub-areas by introduction period**, in a fixed order (This change first, Pre-existing second):

```
⚠️[Risks]
▎This change  ← defects introduced by this diff add/change; expand all four elements; this is what the user should watch most
▸(1)❗ ...｜...｜...
▸(2)⚡ ...｜...｜...
▎Pre-existing  ← existing defects found during detection that this change did not touch; present compactly; converge by default
▸(1)💡 ...（Pre-existing, not changed this time）｜one-sentence risk｜suggest tracking as tech debt
```

Split rules:

1. **This change sub-area**: each item **fully expands** the four elements (location + Trigger conditions + impact + severity), sorted by severity descending. This is the core evidence for accepting this change; do not omit it.
2. **Pre-existing sub-area (folded / compact by default)**:
   - Each item only needs **location + one-sentence risk + the "Pre-existing, not changed this time" mark**; do not expand all four elements;
   - End with one shared disposition, e.g. "the above are existing issues; suggest tracking them as tech debt separately; they do not block this release";
   - If there are many Pre-existing items (>5), list only high/medium severity (❗/⚡); merge low-severity into "another N low-risk existing issues are marked in the report".
3. **When a sub-area is empty, omit that sub-title entirely**: if there is no This-change defect, do not write `▎This change`; if there is no Pre-existing, do not write `▎Pre-existing`. Avoid empty spinning.
4. **Conclusion and release advice use only "This change" risks**: Pre-existing does not block release by default (unless this change would directly trigger an existing defect — then lift it as a This-change-related risk and explain the trigger relationship).
5. The Notes (📌) section is the same: test/release advice prioritizes This-change risks; Pre-existing regression is mentioned only when truly needed.

**⛔ Absolutely forbidden vague descriptions (the most common mistake)**:
- ❌ "No high-confidence defect found" → must say specifically why there is no risk
- ❌ "No defect that would cause a functional error" → too vague
- ❌ "Some requirement rules are not covered by test cases" → must list which rules
- ❌ "There are some potential risks" → must say what the risk is, where, and under what conditions it fires
- ❌ "Suggest watching XX" → must say what to watch, why, and what happens if you do not
- ❌ One sentence and done
- ❌ One sentence summarizing multiple **semantically confirmed** cross-view gaps (each confirmed gap must be expanded independently)
- ❌ Dumping the keyword first-pass list (orphan methods, synonym misses) into Risks

**Core principle: Risks/Notes are not shown in the defect list. If they are also summarized here, the user gets nothing. Write in enough detail that the user can act directly.**

**Expansion format for confirmed cross-view gaps (each item must include four elements)**:
- ① Original requirement-rule text: the concrete rule from `DOC_SUMMARY.md`
- ② Code-implementation status: implemented✅ / not implemented❌ + concrete Class#method + line numbers
- ③ Test-case coverage status: covered✅ / uncovered❌ + concrete case ID or "no matching case"
- ④ Concrete test scene to add: specific enough to write a case (what to input, what to expect, which branch to verify)

Keyword matches from `cross-view-check` are a **first pass**. After semantic verify, drop synonym / path-style misses. Only confirmed gaps go here.

**Even if this run wrote back no suspected defect or Improvement, the Risks section cannot spin empty**:
- Only list items that truly have risk (concrete Trigger conditions and impact). Do not write "no issue found in XX direction" just to fill the section
- Confirmed coverage gaps from the cross-view check (**expand item by item; do not summarize**)
- Runtime risks related to config dependencies / switches / canary
- **⛔ Do not write empty "no issue found" information**: if a direction/dimension is fine, just omit it; do not occupy the user's attention

## 🔔[Pending confirmation] — write in detail (in-doubt defects must be listed one by one)

**Purpose**: take every defect that could not be fully confirmed during analysis for lack of business context (`[Confidence:MED/LOW]`) and submit it to the user as a **concrete question**, asking for business confirmation. The job is to find more defects and miss none — in doubt does not mean "there is probably no defect"; it means "business knowledge is needed to fully confirm", and it must be output to the user.

**Trigger conditions**: this detection has any `[Confidence:MED/LOW]` defect (at least 1). If none, the section content is "this detection has no open points; all defects were confirmed at high confidence."

**Format** (list items one by one inside the section; each must include three elements):

```
🔔[Pending confirmation]
▸(1) [defect title/location]
  ▸ Open question: <what business-judgment premise cannot be determined>
  ▸ Current assumption: <what temporary assumption the analysis used before business confirmation>
  ▸ Please confirm: <what business information the user must provide; can be answered directly>

▸(2) [defect title/location]
  ...
```

**How to fill each element**:

- **Open question** (must be concrete): do not write "uncertain" or "maybe a problem". State "which business-judgment premise cannot be determined" — e.g. "whether this API has an external call path", "whether this config is on in production", "whether this return value is used in some scenes"
- **Current assumption** (must be written): cannot be empty. State "if the business does not confirm, what assumption I used for the defect / no-defect judgment". That assumption helps the user quickly see "if they confirm something different, the conclusion may flip"
- **Please confirm** (must be answerable): do not vaguely say "please confirm whether this is correct". Ask a concrete business question the user can answer, e.g. "does API XX have a terminal or external call path", "what is the current production state of switch YY", "was exception ZZ historically designed as expected behavior"

**Rollup format** (usable when there are ≥ 3 open points):

```
🔔[Pending confirmation]
The N defects above cannot be fully determined for lack of business context. Please help confirm the following before test/release:
▸(X) <core pending question 1>
▸(X+1) <core pending question 2>
(Full details of each item are marked `(needs confirmation)` on the matching defect in ⚠️[Risks])
```

**Forbidden**:

- ❌ Not writing open points into the summary (the user opens the report and cannot see what needs confirmation)
- ❌ Writing "needs confirmation" without "what to confirm" and "what the current assumption is"
- ❌ Using "maybe a false positive" instead of "needs confirmation" (different meanings — false positive means the code is fine; needs confirmation means the code issue exists but its impact or Trigger conditions need business confirmation)
- ❌ Packing open points into one sentence instead of expanding them one by one

## 📌[Notes] — write in detail (no empty spinning, no vague summary)

Notes are for **release operations and test verification**. Tell testers/developers what extra to watch during test and release:

- **Test suggestions**: which scenes need focused regression, which boundary conditions need to be constructed. **Must be executable**: what input to construct, what output to verify, which branch to cover.
- **Release notes**: canary strategy, config items that must be on/off in advance, whether dependent services must be deployed first
- **Compatibility**: whether old and new versions can coexist safely, whether interface-contract changes are backward compatible
- **Monitoring**: which metrics/logs/alerts to watch after release

**⛔ No vague empty talk**:
- ❌ "Suggest regressing related scenes" → must say which scenes
- ❌ "Watch compatibility" → must say which API and what compatibility issue
- ❌ "Watch monitoring" → must say which metric and what the threshold is

**Even if detection found no defect, Notes cannot be empty** — at least include "scenes suggested for regression" (concrete scene names, not empty talk).

## Good summary examples

```text
📋[Requirement changes] Migrated coupon templates into the checkout service; added CouponTransferService.transfer() to handle template migration; changed OrderCouponValidator.validate() to add redemption checks for migrated coupons.    🔍[Analysis scope] Covered checkout_server and checkout_client — 8 changed classes and 15 methods; focused on the coupon-redemption chain CouponTransferService.transfer() → OrderCouponValidator.validate() → CouponRepository.queryByTemplate().    ⚠️[Risks]▎This change ▸(1)❗ OrderCouponValidator.validate() line 87｜Trigger conditions: call get(0) when the migrated-coupon list is empty｜Impact: every checkout-order redemption flow throws IndexOutOfBoundsException.▸(2)⚡ CouponTransferService.transfer() line 45｜Trigger conditions: coupon service responds >3s and no timeout is set｜Impact: main thread blocks and upstream requests pile up. ▎Pre-existing ▸(1)💡 CouponRepository.queryByTemplate() line 120 (Pre-existing, not changed this time)｜negative template IDs are queried without validation, returning empty but producing invalid queries｜suggest tracking as tech debt; does not block this release.    📌[Notes]►Test: construct an empty migrated-coupon list and verify validate() does not throw; simulate coupon-service timeout (>3s) and verify degrade.►Release: CouponTransferService depends on the coupon service's new transferTemplate API; confirm the coupon service is deployed before this service.►Monitoring: after release, watch coupon_transfer_timeout alerts and OrderCouponValidator ERROR log volume.    ✅[Conclusion] This change has 1 high risk (empty-list IOOBE) and 1 medium risk (RPC with no timeout); suggest fixing before release. There is also 1 Pre-existing low-risk existing issue that can be tracked separately and does not block this release.
```

```text
📋[Requirement changes] Product-detail page added a "pickup in store" entry; changed ShopEntryController.getEntries() entry-aggregation logic; added PickupEntryFilter.    🔍[Analysis scope] Covered trade_server — 5 changed classes and 11 methods; focused on the entry-delivery chain ShopEntryController → EntryAggregator → PickupEntryFilter.    ⚠️[Risks]▸(1)💡 PickupEntryFilter.filter() line 32｜Trigger conditions: a new shopType value is added without updating the equals string check｜Impact: maintainability risk; current logic is correct.▸(2)💡 Code line 28 pickupConfig is read from the config center｜Trigger conditions: high concurrency with no local cache｜Impact: frequent config-center reads but correctness is unaffected.    📌[Notes]►Test: verify the filter skips normally when shopType=null (line 30 has a null check); verify the pickup entry is hidden for shops that do not support it; verify the entry disappears when the config center is off.►Release: entry display is controlled by pickup_entry_switch; confirm that config is on in pre-release and production before release.►Compatibility: both old and new clients use getEntries; old versions ignore the new pickupEntry field; backward compatible.►Monitoring: watch whether entry exposure matches expectation; abnormally low may mean the config did not take effect.    ✅[Conclusion] No blocking risk; can release as usual. After release, confirm pickup_entry_switch took effect.
```

## How to write the summary

Use the summaryText returned by `get-findings` as the skeleton and string change → analysis scope → Risks → Notes → Conclusion into coherent text.

**Writing principles**:
- Do not summarize "what dimensions of analysis were done"; summarize "what facts were found"
- **Only talk about problems; omit what is fine**: Risks and Notes only write what the user must act on. Do not write "XX passed" / "no issue found in XX" — those have no value
- **Every identifier must be self-explanatory**: class/method/config names must have enough context for the user to understand (e.g. "OrderService#cancelOrder line 87", not an isolated code). If an identifier is unintelligible outside the detection context, do not write it into the summary
- **Every item must have a source**: every fact written into the summary (line numbers, class names, defect descriptions, case-coverage status, stats) must have a matching source in the detection-process data. The Agent must not generate summary content from "understanding" or "speculation" — only extract and organize from existing data
- Risks and Notes are the most valuable parts and must be written in detail

## Pre-submit self-check (validate-summary / --preview)

**Strongly recommended** to format-check the summary before the official writeback:

```bash
# Method 1: standalone command (no task-id; offline validation)
node "$SKILL_SCRIPT" validate-summary --summary "$DETECTION_SUMMARY"

# Method 2: complete-task --preview (validate in the converge-flow context; do not actually write back)
node "$SKILL_SCRIPT" complete-task --task-id $TASK_ID --batch-ids "$BATCH_IDS" --preview --summary "$DETECTION_SUMMARY"
```

Pass returns `code=0` + character count + section list; fail returns `code=1` + a concrete problem list (which section is missing, which forbidden word was hit).

## How complete-task writes the summary back

`complete-task` automatically tries to write `--summary` back. If format validation fails (missing a required section marker), **task converge is not blocked**, but the return includes:

- `_summary_status: "FAILED"` + `_summary_hint`: tells the Agent to rewrite with `update-summary`

**When you see `_summary_status=FAILED`**: fix the summary format and write it back again with the standalone command:

```bash
node "$SKILL_SCRIPT" update-summary --task-id $TASK_ID --summary "$FIXED_SUMMARY"
```

`update-summary` can also be called **at any time** after complete-task, to fix a non-compliant summary, overwrite a previous version with better content, or backfill `--summary` if it was forgotten at complete-task time.

> ⚠️ `update-summary` runs the same structure check as `complete-task` (must include the five section markers 📋[Requirement changes] 🔍[Analysis scope] ⚠️[Risks] 📌[Notes] ✅[Conclusion]). Failure errors with a fix hint. ⚠️[Risks] and 📌[Notes] are the most important sections; vague descriptions are forbidden.

## Post-writeback summary self-check [MUST — do not skip]

> **Purpose**: stop the written-back summary from disagreeing with actual detection results, missing content, or being unreadable.

**Immediately after writing the summary back, the Agent must run this self-check**:

### Self-check 1: content consistency

Against every finding returned by `get-findings --task-id $TASK_ID`, confirm item by item that the summary covers:

- Every already-written suspected defect / Improvement appears in Risks
- Every **semantically confirmed** cross-view gap is expanded in risk hints / Notes. Keyword first-pass orphans and synonym misses stay out of the summary
- Every **confirmed** case-coverage gap is listed (do not write "some rules are not covered"; do not list matcher false negatives)

### Self-check 2: readability

- Does each risk include: concrete location + Trigger conditions + Impact scope + severity
- Do Notes include: actionable concrete advice (not empty "suggest watching XX")
- Do confirmed cross-view gaps include the four elements: original requirement-rule text + code-implementation status + case-coverage status + scene to add
- **This change vs Pre-existing hard split**: if both classes exist, Risks must split them with `▎This change` / `▎Pre-existing` sub-areas; This change is fully expanded first; Pre-existing is compact afterward and marked "Pre-existing, not changed this time"; the conclusion uses only This-change risks for the release judgment
- **Forbidden vague wording**: "some rules are not covered", "there are some risks", "suggest watching", "need to note", and other empty talk with no concrete information

### Self-check 3: truth and traceability

- **Verify the source of each item**: every factual statement in the summary (line numbers, class names, method names, defect descriptions, case IDs, stats) must have a matching source in the detection-process data:
  - Line numbers / class names / method names → from the method list returned by `get-pending` or the code diff
  - Defect descriptions → from already-written suspected-defect / Improvement content (queryable via `get-findings`)
  - Test cases / requirement rules → from `test_cases` / `DOC_SUMMARY` in the content store
  - Stats (N classes / M methods) → from `get-pending` / `check-coverage` return values
- **No fabrication**: if an item has no source in the detection data, delete it. Prefer a shorter summary over any invented content
- **No "reasonable speculation"**: the Agent must not add risks to the summary from its "understanding" of the code that the detection flow never confirmed — every risk must have a matching writeback conclusion or cross-view finding as evidence

### Self-check 4: purpose and purity

- **Do not mention what is fine**: check for "no issue found in XX direction", "XX check passed", "XX dimension is normal" — delete if present
- **No isolated codes**: check for unexplained custom codes/terms (internal enum values, strategy numbers, system IDs) — identifiers the user cannot understand from the summary text alone must be deleted or replaced with business language
- **Do not output possible false positives**: only output real findings the user must take seriously and act on. Uncertain / likely false-positive items do not go into the summary

### Self-check 5: report-link check

- Confirm the final summary ends with a report link: `> View full report: [Open]({reportUrl})`
- `reportUrl` comes from the current platform provider (local default `file://.../reports/{taskId}.html`; remote uses the configured `report_base_url`)
- Confirm the task id in the link matches this task

**If self-check fails**: immediately rewrite with `update-summary` and self-check again until all five pass.
