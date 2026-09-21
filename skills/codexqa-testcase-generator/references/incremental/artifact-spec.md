# Incremental Agent artifact contract

## Common rules

The Agent is responsible for generating all business artifacts. Each artifact kind has a fixed path, but has no revision.

Each Agent artifact directory contains one `artifact.json`:

```json
{
  "artifactContractVersion": "1.0",
  "artifactKind": "CASE_DECISIONS",
  "nodeId": "case-decisions:app:app-main",
  "runId": "userConfig.runid",
  "executionId": "current execution",
  "artifactStatus": "DRAFT",
  "platform": "app",
  "sourceId": "app-main",
  "updatedAt": "2026-08-28T16:30:00+08:00",
  "contentFiles": [
    "case-decisions.json"
  ],
  "sourceRefs": [
    "inputs/raw/baseline-cases-app/"
  ],
  "dependsOn": [
    {
      "nodeId": "change-analysis",
      "path": "artifacts/change-analysis/change-analysis.json"
    }
  ],
  "selfCheck": {
    "completed": false,
    "openIssues": [
      "One cross-end case pending human confirmation"
    ]
  }
}
```

Constraints:

- `artifactStatus` uses `DRAFT` or `READY`.
- `sourceRefs` and `dependsOn` must be workspace-relative paths or locatable references.
- `contentFiles` lists the current business content in that directory.
- `selfCheck` is the Agent's self-check record, not a script business referee.
- `runId` must be `userConfig.runid`, not the last path segment.

Standard-profile extra requirements:

- `sourceManifestRef` points to `artifacts/standards/source/standard-source-manifest.json`.
- `sectionSnapshotRef` may only point to the current `platform`'s Chapter 3 snapshot.
- `sourceFile` must be one of the three allowed files.
- `appliedRules` may only cite titles, line numbers, or paragraphs in the Chapter 3 snapshot.
- Decision artifacts for `MODIFY`, `ADD`, `SPLIT`, and `MERGE` must cite the corresponding standard profile and Chapter 3 snapshot.

## Fixed Agent artifacts

| Artifact | Fixed path | Format | Content requirements |
| --- | --- | --- | --- |
| Task intent | `artifacts/intent/intent.md` | Markdown | User goal, processing mode, scope, input gaps, and confirmation |
| Standard source manifest | `artifacts/standards/source/standard-source-manifest.json` | JSON | This repo's three-end templates, Chapter 3 hashes, and extraction strategy |
| Standard Chapter 3 snapshot | `artifacts/standards/source/sections/{platform}/...section-3.md` | Markdown | The unique Chapter 3 of the corresponding end template |
| Standard profile | `artifacts/standards/{platform}/{sourceId}/standard-profile.json` | JSON | Corresponding-end Chapter 3 rules, applied rules, conflicts, and resolution |
| Format profile | `artifacts/case-format/{platform}/{sourceId}/format-profile.json` | JSON | Baseline layout, file type, field positions, line breaks, and retention method |
| Change analysis | `artifacts/change-analysis/change-analysis.json` | JSON | Old behavior, new behavior, affected ends, source evidence, and open questions |
| Case decisions | `artifacts/case-decisions/{platform}/{sourceId}/case-decisions.json` | JSON | Action, rationale, evidence, and target content for each baseline case |
| Environment review | `artifacts/environment/{platform}/{sourceId}/environment-review.json` | JSON | Per-case, per-environment-item decisions |
| End-level delivery | `outputs/cases/{platform}/{sourceId}/` | JSON + original format | `artifact.json`, `delivery-manifest.json`, and `content/` |
| User report | `outputs/reports/review-summary.md` | Markdown | Latest results organized per `report-spec.md` |
| Publication plan | `publication/publication-plan.json` | JSON | Per-end baseline, `cases`/`procase` targets, publication mode, and read-back requirements |
| Publication record | `publication/publication-record.json` | JSON | Current publication result, operations, target hashes, read-back results, and failure information |

### Environment-review artifact

When archived inputs include environment context, each `platform + sourceId` must write `environment-review.json` before that end's delivery content is generated, containing at least `environmentContractVersion`, `platform`, `sourceId`, `environmentProvided`, `envSourceRef`, `filteredItemCount`, `cases[]` covering all final cases, and `coverage`.

- `decision` may only be `APPLY`, `SKIP`, or `NEED_CONFIRM`.
- When any “case × item” pair lacks a decision, do not generate this end's delivery content.
- `coverage.applied + skipped + pendingConfirm` must equal `totalDecisions`.
- Every `APPLY` must appear in the final delivery's Preconditions.
- When environment context is not provided, write `environmentProvided: false`, empty `cases`, and 0 for every `coverage` value.

## Overwrite and invalidation

When an artifact problem is found: state the error → use the status script to mark the current node and its explicit downstream as `INVALIDATED` → overwrite the current artifacts with temporary files → rerun the affected downstream → record the new hash. Do not rerun ends that have no dependency on the current artifacts.

## Publication fields

The publication plan and record must record, per `platform + sourceId`:

- `executionMode`: `DIFF_ENHANCEMENT` or `DIRECT_CASE_UPDATE`.
- `baselinePath`: the baseline path actually used.
- `caseBaselineSource`: `EXPLICIT_CASES`, `CASES`, or `INITIALCASE`.
- `casesTargetPath`: the current end's `testcase/cases/` target.
- `procaseTargetPath`: the corresponding end's `testcase/procase/` target; Direct must not write.
- `publicationMode`: `FIRST_DIFF_DUAL_WRITE` or `CASES_ONLY`.
- `procaseStateBefore`: `ABSENT`, `EMPTY_NO_CASES`, or `EXISTING_VALID`.
- APP / Web must additionally record directory layout and index / detail read-back results; Server records single-file read-back results.
- `caseCountAfter` must be consistent with `delivery-manifest.caseCount`, the report's updated case count, and the `Total case count` in the final files.
- `actionSummary` must record the non-zero action distribution of the final output cases.

`procase` state is used only for publication protection, not to infer user intent or choose a baseline.
