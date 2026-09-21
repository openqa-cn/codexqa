# Case-set incremental-update report contract

## 1. Scope

This contract defines the fixed chapters of `outputs/reports/review-summary.md`. The report shows only the latest results of the current execution; do not force-merge different ends or different sources.

## 2. Fixed chapters

```markdown
# Case-set incremental-update report

## 1. Execution conclusion
## 2. Execution intent and chain
## 3. Analysis scope and capability status
## 4. Business-change overview
## 5. Full comparison of modified cases
## 6. Full content of added cases
## 7. Full content of cases proposed for deletion or retirement
## 8. Full content of split and merged cases
## 9. KEEP case notes
## 10. Pending confirmation, conflicts, and risks
## 11. Quality check
## 12. Deliverables
```

Do not delete a chapter because it has no content. When there is no actual content, write “This round has no modified cases.” and replace it with the matching wording per chapter.

## 3. Chapters 1 through 3

### 3.1 Execution conclusion

| Item | Result |
| --- | --- |
| Execution status | Success, blocked, or failed, and whether Set B was generated |
| `runid` | `userConfig.runid` |
| `runDir` | `userConfig.runDir` |
| `requirementId` | Requirement identifier; record it explicitly when missing |
| `executionId` | Current Skill execution |
| Execution mode | `DIFF_ENHANCEMENT` or `DIRECT_CASE_UPDATE` |
| Baseline case count | The baseline count actually used by the current execution |
| Updated case count | Must be consistent with the end-level file's `Total case count` and `delivery-manifest.caseCount` |
| Action statistics | Non-zero action counts of the final output cases; must be consistent with the end-level file's `Enhanced cases` row |
| Case standard | Status, version, and applicable scope |
| Environment supplementation | When provided, write the filtered item count and the decision distribution; when not provided, write “No environment context was provided” |
| Quality check | Result and error count |
| Publish status | Whether it has been written to `{run_dir}/testcase/cases/` |

Use this `runid` and `executionId` as the execution identity.

### 3.2 Execution intent and chain

State the execution mode, decision source, decision rationale, confidence, user confirmation, routing boundary, and the actual execution chain. If `test_env` is enabled, separately state the environment-dependency supplementation status. When environment context is not provided, explicitly write “This run did not provide environment context; environment supplementation was not executed”.

### 3.3 Analysis scope and capability status

At least include the lifecycle and freeze locations of the seven business inputs, Set A's end types and case counts, input gaps, case-standard status, and the end-type judgment notes.

## 4. Business-change overview

The table must use the following column names; do not use “Original behavior” or “New behavior”:

| changeId | Change summary | Original logic | New logic | Impact scope |
| --- | --- | --- | --- | --- |

Keep `changeId` stable across the whole document, and use it as the primary key of the Chapters 5–8 modules. Chapter 4 does not directly stack full case content.

## 5. Shared layout of Chapters 5 through 8

Inside each chapter, split modules by Chapter 4's change points; do not flatten by case.

Generate a module only for a change point that actually has associated cases, and order them by Chapter 4's `changeId`. Each case at least includes action ID, action, applicable end, source, associated changes, handling basis, a brief of the modified content, confidence, whether human review is needed, and standard citations.

Standard citations for `MODIFY`, `ADD`, `SPLIT`, and `MERGE` must point to both the corresponding end's `standard-profile.json` and the Chapter 3 snapshot. Evidence must be locatable to a file or line number inside the frozen workspace.

Full-content requirements:

| Action | Full content that must be shown |
| --- | --- |
| `MODIFY` | Full case before modification, full case after modification |
| `ADD` | Full added case |
| `DEPRECATE_CANDIDATE` | Full original case, and state clearly that it will not be deleted directly |
| `SPLIT` | Full source case, each full target case |
| `MERGE` | Each full source case, the full merged target case |
| `NEED_CONFIRM` | Current case full content, items pending confirmation, and the blocking reason |

Full cases must keep the baseline format. Show APP / Web by index and detail files respectively; Server keeps the original table headers and column order.

End-level Markdown basic statistics: recalculate `Total case count` from the final real cases; for `Enhanced cases`, output only items whose count is greater than 0 among “added, modified, split, merged, kept, pending confirmation, pending deletion”. `DEPRECATE_CANDIDATE` may only mean pending deletion.

## 6. Cases with multiple change points

When the same case is associated with multiple change points, it must appear under every associated module, but may be shown in full only once. Later modules keep only the handling basis and the modified-content brief for the current change point.

## 7. Semantics of Chapters 5 through 8

- Chapter 5 includes only `MODIFY`.
- Chapter 6 includes only `ADD`.
- Chapter 7 includes only `DEPRECATE_CANDIDATE`, and must state that this is a pending-confirmation retirement candidate.
- Chapter 8 includes `SPLIT` and `MERGE`.

## 8. Chapters 9 through 12

- Chapter 9 may aggregate KEEP notes by end or by theme, and must list case IDs and keep reasons.
- Chapter 10 lists unresolved issues, conflicts, format limits, input gaps, and `NEED_CONFIRM` from environment review.
- Chapter 11 lists check results for format, citations, action completeness, standard compliance, and artifact completeness.
- Chapter 12 lists the current execution's delivery content, report, publication plan / record, and the targets actually written.

## 9. Forbidden items

- Do not use “Original behavior” or “New behavior” as visible headers in Chapter 4.
- Do not flatten all cases in Chapters 5 through 8 without going through change modules.
- Do not show the same case's full content repeatedly under multiple change points.
- Do not write `DEPRECATE_CANDIDATE` as already deleted.
- Do not force APP / Web directory-style cases and the Server large table into the same report format.
