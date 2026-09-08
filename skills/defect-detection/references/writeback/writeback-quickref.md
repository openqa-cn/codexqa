# Writeback quick reference

> **This file is a slim lookup mirror** for the Agent to check quickly before writeback. **It is not authoritative**.
> The authoritative, complete definition of field constraints and content format is `references/writeback.md`. When wording disagrees, follow the main doc; the final authority is programmatic validation in `scripts/validate.ts`.

> ⭐ **Unsure how to fill the format? Copy a live sample first; do not learn by submitting errors:**
> `process-sample --strategy <8/11> --bug-status <2/6/7>`
> → outputs a complete JSON already filled with real values and already self-validated. Replace `<fill:...>` placeholders and submit.

---

## Required-field lookup

| Field | bugStatus=2 | bugStatus=6/7 |
|---|---|---|
| processId | ⚠️ Strongly recommended (from get-pending) | ⚠️ Strongly recommended (from get-pending) |
| thinking | ✅ ≥30 chars, cite method name / line numbers | ✅ ≥30 chars, with concrete analysis |
| content | `No defect in this code` | Starts with `Defect:` or `Improvement:` |
| processSteps | ✅ Non-empty, conclusion non-empty | ✅ Non-empty, conclusion non-empty |
| fileCodes | ✅ Includes filePath/git/branch/commitId | ✅ Includes filePath/git/branch/commitId |
| tagId | — | ✅ Required; pick from $VALID_TAG_IDS |
| hitRuleIds | — | ✅ Required when strategy=8 |
| astRuleCount | ✅ Required and >0 when strategy=8 | ✅ Required and >0 when strategy=8 |

> **processId writeback rule**: every `get-pending` record has a `processId`. On writeback you **must** pass that processId back (CLI `--process-id`; batch-update-process adds a `"processId"` field in JSON). Omitting processId makes the platform create a new record instead of updating the existing pending record.

---

## content format (bugStatus=6/7)

```
Problem description: <concrete description>
Problem tags: [tag name][This change/Pre-existing]
Impact scope: <business description>
Affected business: <which feature/flow is affected>
Reproduction path: <call A → param X → branch Y → error Z>
Trigger conditions: <condition list>
Expected vs actual: <comparison>
Fix suggestion/Improvement plan: <direction + code block>
```

**Format requirements**:
- Field names are plain text (no `**bold**`; the platform does not render it)
- Tags wrapped in [] and must include [This change] or [Pre-existing]
- Code-block language tag matches the project's actual language (`service[].language` in content.json): ` ```java ` for Java, ` ```typescript ` / ` ```javascript ` / ` ```vue ` / ` ```css ` for frontend repos. `scripts/validate.ts` does not check the tag, but a wrong tag makes report readers misread the snippet.

---

## Strategy lookup

| strategyCode | View | content must show |
|---|---|---|
| 8 | AST scan | Hit rules + match location + exclusion reflection |
| 11 | Business detection (Agent decides depth by detectTier) | Code logic + Call chain + business-rule comparison |

---

## 5-second pre-writeback self-check

1. **processId passed back**? (taken from get-pending, passed via --process-id or the JSON field)
2. thinking ≥ 30 chars and cites concrete code/logic?
3. processSteps non-empty and conclusion non-empty?
4. fileCodes includes filePath + git + branch + commitId?
5. [has defect] content includes "Affected business:" + "Reproduction path:"?
6. [has defect] Problem tags wrapped in [] and include introduction period?
7. [strategy≠8] already called register-code-read?
8. already called register-repo-clone?
9. content has no internal-ID leak (RULE-XXX / strategyCode=N)?

**All OK → submit. Any item failing → fix first, then submit.**
