# Stage 3: existing-coverage judgment (local)

## Minimum persist (this stage)

- File: `{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md`
- File: `stage3-*/index.json`
- Required headings: `Reuse inventory` | `Change inventory` | `Blank-scenario inventory`

This Skill **does not connect to a case-platform HTTP API** and does not recall existing cases from a remote space. Stage 3 must still execute and persist a report, but the conclusion is fixed: treat every scenario as **new**; the reuse inventory and the change inventory are empty.

## Inputs

> Before this stage starts, first follow [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" to confirm `run_dir` is available (userConfig.runDir → user-specified path → this Skill's initialized default directory); do not perform any reads or writes before that confirmation.

- Stage 1 output: `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md`
- Stage 2 output: `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md`

Do not call any `tcm_*.py` script or case-platform `/api/xbot/*` API. `projectId` is not a precondition of this stage.

---

## Stage 3 knowledge consumption

> Knowledge-interaction adaptation is unified in [knowledge-adapter.md](knowledge-adapter.md); output templates are in [knowledge-receipt-templates.md](knowledge-receipt-templates.md).

First reuse modules, rules, and risks already located in Stage 1/2 artifacts. Scenarios that should be covered are driven primarily by the Stage 2 impact scope; only when the user has already provided a local knowledge directory and gaps still remain, filter test focus / regression strategy from `knowledge/index.md`. With no local pack, continue with Stage 2; do not ask again for a knowledge directory.

| Filter dimension | Value |
|---------|------|
| stage | `case-recall` |
| knowledge dimension | test strategy / regression strategy |

| Knowledge type | Priority | Use |
|---------|--------|------|
| Function-module test focus | Optional (local pack) | Compare with the Stage 2 impact scope to supplement scenarios that should be covered; if none, use only the Stage 2 inventory |
| Regression strategy | Optional (local pack) | Annotate scenarios that need stronger regression (still record them as new); if none, follow Stage 2 risk priority |
| Standard sample cases | Optional (local pack) | Writing reference for blank scenarios; if none, use the built-in three-end templates |

**Stop condition**: stop once the "should cover / need stronger regression" inventory can be produced. Persist close-reading artifacts to `{run_dir}/testcase/knowledge-biz/{project-name}/stage3-case-recall/`.

---

## Execution rules (mandatory)

1. **Do not recall remote existing cases**: do not pull the directory tree, do not pull case names, do not pull case details.
2. **coverage status is always "new"**: from Stage 4 onward, "reuse" or "change" that depends on a remote caseId must not appear.
3. **Still do the gap analysis**: walk every Stage 2 impact point and risk point, write the blank-scenario inventory (must new), and inherit priority from Stage 2.
4. **Must persist the report**: even if the inventory is all new, write `{run_dir}/testcase/testdocs/stage3-coverage-judgment-report.md`, and state at the top of the file "Case platform was not connected; existing-case recall was skipped; treat all as new".

---

## Report structure

```markdown
# Stage 3 existing-case recall report

> Case platform was not connected; existing-case recall was skipped; treat all scenarios as new.

## Reuse inventory

(empty)

## Change inventory

(empty)

## Blank-scenario inventory (must new)

| Scenario description | Related test object | Priority | Reason for new |
|---------|------------|--------|---------|
| ... | ... | P0-P3 | No remote existing cases to compare; create as new from the Stage 2 impact point |
```

## Handoff to Stage 4

- The reuse inventory and the change inventory are empty.
- The blank-scenario inventory is the input for Stage 4 to design test scenarios from scratch.
- Fill coverage status of every Stage 4 scenario as "new".

After Stage 3 persist, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 3` (redirect stdout only). If `ok` is false, do not enter Stage 4.
