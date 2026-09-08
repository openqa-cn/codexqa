# Case Update Spec

> This file is the only execution spec for subagent-update. After subagent-update starts, `read_file` this file and execute by the rules below.

---

## Main flow

```
subagent-update receives: change-point list (change ID + change description + whether also marked "needs new case") + PRD-related section path + whether data must be reconstructed
    │
    ├─ Step0: Mark updating
    │         The main agent has already set this case status to "updating" before dispatch
    │
    ├─ Step1: Read the case .md + PRD-related sections, analyze and apply the update
    │         Read the full case .md + the full current content of the PRD-related sections (not only the diff)
    │         Decide the handling from the change-point content (see the "Handling decision" chapter):
    │         ├─ Change a concrete value: text replace version, config-item name, API name, etc.
    │         └─ Add/modify verification points: rule-logic change requires adjusting verification points
    │         Sync related submodules per "Field-linkage update rules"
    │
    ├─ Step2: L1 hard-constraint self-check + update-specific self-check (mandatory, cannot skip)
    │         2a. Run `generation/quality-gates/lint_case_documents.ts --file <this case.md> --resolved usecases/testdocs/integrations-resolved.json` for the deterministic pass; then `read_file` `quality-gates/gate-case-quality.md` and apply its template-structure and semantic-quality checks
    │         2b. Run update-specific checks (see the "Update-specific self-check rules" chapter)
    │         Hit a rule → fix the .md in place and re-self-check; at most 2 rounds
    │         Still failing → report the failed finding details to the main agent
    │
    ├─ Step3: If "need reconstruct data=yes", write placeholders (e.g. {new_activityId}) into the Content column of the test-data submodule
    │         subagent-update does not trigger data construction; it only keeps placeholders; the main agent later hands the caseId list to the `testdata-generation` skill in batch
    │
    └─ Step4: Return an update summary to the main agent (do not write case-registry.json yourself)
              The summary includes: caseId, caseName, last_updated, change_reason,
                        business_rules_digest (re-extracted from the PRD section),
                        coverage[] (updated verification-point list),
                        self-check result (pass / failed finding details),
                        need reconstruct data (yes/no)
```

> Structural rules (table headers, empty Construction column, placeholder form, heading order) belong to `lint_case_documents.ts` — run the script, do not eyeball them. Semantic rules stay in `quality-gates/gate-case-quality.md`; this file does not copy them. Changing a semantic rule is done in the gate file so generate and update stay aligned.

---

## Handling decision

### How to use PRD sections

The PRD section path received by subagent-update points to the PRD file + section title where the change point lives. How to read:

1. `read_file` the PRD file
2. Locate the specified section title and extract that section's **full current content** (not a diff; the final post-update version)
3. From it, understand "what the currently correct rule is" as the basis for updating the case

> ⚠️ **Confirm follow PRD**: check points, expected results, prerequisites, etc. in the case must match the current PRD section. If old case content conflicts with PRD, Confirm follow PRD and update.

### Decision logic

After reading the case `.md` and the PRD section, judge each change point's impact on the current case one by one:

```
For each change point related to the current case:
  Read the PRD section and understand the full post-change rule
  Compare related content in the case .md:

  ├─ The case has explicit old-value text (version, API name, config item, etc.) that must be replaced with the new value
  │   → Handling: text replace
  │   → Action: replace the old value with the new value directly
  │
  ├─ The case's verification points (Steps / Expected) must be adjusted to reflect the new rule
  │   → Handling: modify verification points
  │   → Action: rewrite the affected Steps and Expected per the current rule in the PRD section
  │
  └─ The change introduces a new verification dimension that the current case can carry (inside the same test scene)
      → Handling: add verification points
      → Action: append new verification steps and Expected to the existing Steps table
      → ⚠️ Limit: only "add one more check on an existing trigger path" (e.g. check one more response field after the same API call).
           If a brand-new prerequisite or trigger path is needed, that is an "independent scene" and is not added here.
```

> ⚠️ **Merge multiple change points**: if the same case relates to multiple change points, first analyze each change point's impact one by one, then apply modifications in one pass (avoid reading/writing the same file many times).

> ⚠️ **Duty boundary (verification-point update boundary)**: subagent-update only modifies existing cases; it does not create new case files. For adding verification points, follow this boundary:
> - **May do**: modify trigger/expected on an existing case's existing trigger path, or append a check that needs no new prerequisite
> - **Must not do**: add a verification point for a change point that needs an independent prerequisite and trigger path (e.g. a new degrade path, a new exception branch, a new interaction entry — independent scenes)
> - **Judgment**: if a verification point can fire only after constructing a prerequisite state completely different from the current case, it is an "independent scene" and subagent-gen is responsible for generating a new case
> - **How to recognize**: each change point in the dispatch input is marked "whether also marked needs new case". When that mark is "yes", subagent-update **strictly limits that change point to modifying existing verification points** and must not add any new verification point (even if the current case looks able to carry it); when the mark is "no", judge whether to add a verification point by the normal logic

---

## Field-linkage update rules

Whichever module a change point hits, update that module's corresponding submodules; **do not touch unrelated fields**. If the change introduces a new dependency, add the corresponding submodule in the template format; when a dependency is removed, delete the corresponding submodule; after add/delete, re-maintain chapter numbers per `manual-case-template.md`.

Linkage-update scope by change type:

| Change type | Fields/submodules that must be synced |
| ----------- | ------------------------------------- |
| Business-rule / validation-logic change | Steps table + Expected; if the rule changes prerequisites, also sync the test-data submodule |
| Validation target / case-title change | File name (H1 title changes in sync) |
| API name / parameter-field change | Server APIs submodule + engineering-info summary request JSON + API teardown submodule (if any) |
| Config service change | Config-info submodule + 5. Teardown-restore Config service submodule |
| Mock downstream-API change | Mock submodule + 5. Teardown-restore Mock submodule |
| MQ topic/consumer-group change | MQ submodule + verification steps in Steps for message send/consume |
| DB field add/change | Matching DB assertions in Steps + engineering-info summary (if there are DB-related request params) |
| Version / platform change | Client-env description in prerequisites + Steps that involve version judgment |

---

## Update-specific self-check rules

> The following checks are specific to the update scene and supplement the common self-check rules in `gate-case-quality.md`. subagent-update runs them in Step2b.

| Check item | Judgment basis | Finding type | Severity |
|--------|----------|-------------|----------|
| Old-identifier residue | Any rename/delete `search_key` (old value) in this change point still exists in the updated .md | `OLD_IDENTIFIER_RESIDUE` | P0 |
| Expected matches the new PRD | Expected values involved in the change (e.g. error codes, thresholds, states) in the updated file must match the current PRD section and must not keep old values | `EXPECTED_VALUE_STALE` | P0 |
| Data construction matches the change logic | If the change involves quantity/threshold change and is marked "need reconstruct data=yes", Entity counts/conditions in the test-data submodule must reflect the new threshold (e.g. for an over-limit scene with a claim cap of 3, the Entity should have placeholders for 3 already-claimed records) | `DATA_LOGIC_MISMATCH` | P1 |
| New fields have been added | For "API parameter added" changes in the change-point description, the corresponding case's engineering-info summary request JSON must already include the new field | `NEW_FIELD_MISSING` | P1 |
| Deleted fields have been removed | For "API parameter deleted" changes in the change-point description, the corresponding case's engineering-info summary request JSON must already have removed that field | `DELETED_FIELD_RESIDUE` | P1 |
| Linkage submodules are complete | Per the "Field-linkage update rules" table, hit submodules have all been updated; unhit submodules were not changed by mistake | `LINKAGE_INCOMPLETE` | P1 |

---

## Registry-field update rules

> ⚠️ The following fields update the corresponding case record in `usecases/testdocs/case-registry.json` and **are not written into the case `.md` itself**. subagent-update does not write the registry itself; it only provides these field values in the returned summary, and the main agent writes them in batch.

Fields that must be refreshed on every update:

| Field | Update content | When to write |
| ----------------------- | ------------------------------------------------ | ---------------------------- |
| `status` | Set to `"updating"` before dispatch; set to `"done"` after completion | Before dispatch (main agent) + after completion (first batch write) |
| `last_updated` | Real time of this update (YYYY-MM-DD HH:MM:SS); **must run `date "+%Y-%m-%d %H:%M:%S"` before writing; do not fill from memory** | First batch write |
| `change_reason` | Append this change reason | Batch write |
| `business_rules_digest` | Re-extract from the current PRD section and overwrite | First batch write |
| `coverage[]` | Updated verification-point list (trigger + expected) | First batch write |
| `caseName` | Update only when the case title changes in sync | First batch write |
| `change_history` | Append a structured change record (format below) | First batch write |

> ⚠️ **`_meta` fields are written by the main agent in batch**: `_meta.last_prd_commit`, `_meta.last_code_commits`, `_meta.last_update_time` are top-level registry fields. The main agent updates them after all subagents finish; subagent-update does not return them.

**change_history format** (array; append one record per update):

```json
{
  "date": "2024-01-15 14:30:00",
  "changes": ["R-001: remove HarmonyOS platform support", "R-002: min version 2.5.0→2.4.0"],
  "source": "PRD change"
}
```

---

## Forbidden operations

- Must not delete an existing case file
- Must not change a case's `caseId`
- Must not change Expected to the actual code behavior when it conflicts with the current PRD (when code and PRD disagree, Confirm follow PRD)
- Must not keep using old prerequisite data after a quantity/threshold rule change (that would make the case logic wrong)
- subagent-update does not write `case-registry.json` itself; after completion it returns an update summary, and the main agent writes in batch
- Must not change case content unrelated to this change point (do not touch unrelated fields)
- **Do not write registry fields into the case .md**: metadata such as `last_updated`, `change_reason`, `business_rules_digest`, `coverage[]`, `status` is returned to the main agent as text in Step4 only, and is never written into the case `.md`. The case `.md` front matter may keep only the two fields `caseId` and `caseType`
