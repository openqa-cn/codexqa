# Plan / Exec handoff when initial-version cases are missing

Use this when the user is already doing incremental / update, but the target end has neither valid cases nor a usable baseline. This file only constrains conversation handoff, and is not a bypass flow; stage rules still follow `SKILL.md`.

## 1. Current conversation

After discovering a missing end:

- Do not change the already-written `userConfig.runDir`;
- Tell the user: confirm the formal test plan first, then decide whether to generate that end's initial-version cases;
- Artifact locations are `{run_dir}/testcase/initialcase/` and `{run_dir}/testcase/cases/`.
- After the initial version is on disk, stay in this Skill and continue incremental per [postsubmit-enhance.md](postsubmit-enhance.md).

When a file in a fixed directory exists but is illegal, treat it as an input error; do not trigger initial-version generation.

## 2. Order after user confirmation

1. Identify the missing end; do not regenerate an end that already has a valid baseline.
2. Check whether `{run_dir}/testdesign/test_design.md` exists, is readable, and contains the final client-type decision.
3. When the formal test plan is missing or incomplete, fully execute **Plan (Stages 0–5)** first; do not treat “only cases are missing” as a reason to skip analysis.
4. After the plan is valid, ask the user whether to generate the missing-end cases; execute **Exec (Stage 6)** only after the user confirms. The target end only limits the output end; do not cut Exec's internal flow.
5. Write the initial version to `<run_dir>/testcase/initialcase/`, and write the current valid cases to `<run_dir>/testcase/cases/`.
6. If the user still wants post-submit incremental, return to [postsubmit-enhance.md](postsubmit-enhance.md) and continue with the just-written `cases` as the baseline.

## 3. Forbidden actions

- Overwrite an existing `userConfig.runDir` with a new path (unless the user explicitly asks to change the directory);
- Modify cases on a non-missing end;
- Skip Plan/Exec-required steps because of “cases only”;
- Guess when requirement information is insufficient.

Persist the plan and the cases as local Markdown only. When requirements are insufficient, ask the user for materials at the matching stage.
