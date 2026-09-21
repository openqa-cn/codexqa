# Pre-submit case update

Pre-submit `CASE_UPDATE` only updates existing cases; it does not re-run the full test plan or the initial generation chain.

## 1. Directory boundary

```text
Read baseline: cases given by the user this turn, or <run_dir>/testcase/cases/
Write result: <run_dir>/testcase/initialcase/<end files>
```

Read `run_dir` from the `runDir` field of `{run_dir}/testcase/testdocs/userConfig.json` (see the terminology in [run-workspace.md](run-workspace.md)). Do not modify any explicitly given input file or any file under the test-design artifact directory (`testdesign/`) in `run_dir`.

Before executing the update, initialize or reuse `{run_dir}/testcase/testdocs/userConfig.json` using the existing logic in [run-workspace.md](run-workspace.md). Do not add any other config directory or workspace.

## 2. Get the current case set

The target end is determined from a standard field or by the Agent from the complete update instruction. Block if the target end is unclear.

Source priority:

```text
Case files given by the user this turn
> <run_dir>/testcase/cases/<end files>
```

Once an explicit source appears, it has exclusive priority. Fail immediately if it is illegal, unreadable, empty, in an unsupported format, or missing a target end; do not fall back to a fixed directory to fill gaps.

Fixed end files:

| End | File |
| --- | --- |
| APP | `testcase_app_index.md` + `testcases/*.md` (index + standalone case files) |
| Web | `testcase_web_index.md` + `testcases/*.md` (index + standalone case files) |
| Server | `testcase_srv.md` (large table) |

When reading fixed files, read only the target end; do not scan other directories; do not modify the source files.

> ⚠️ **APP special note**: For APP, read `testcase_app_index.md` to get the case index, then read the corresponding standalone case files from the file paths in the index.

## 3. Perform a minimal update

After reading the baseline, the Agent must:

- Locate the target end, case ID, and fields;
- Change only what the user explicitly requested;
- Generate a unique case ID when adding a case;
- Require an explicit instruction for a delete request; do not delete from a vague comment;
- Ask for confirmation when a comment cannot be uniquely located;
- Keep the content and order of unmatched cases unchanged;
- Keep the nine-column headers, column order, existing case IDs, and existing case order.

Each target end after the update must output the complete case set, not only a patch.

## 4. Save and return

Save results to:

```text
# APP (special format)
{run_dir}/testcase/initialcase/testcase_app/
├── testcase_app_index.md          # updated index file (stats, directory, existing-case associations, case index)
└── testcases/                         # updated or newly added case files
    ├── {case-ID}-{case-name}.md
    └── ...

# Web (index + standalone-file format)
{run_dir}/testcase/initialcase/testcase_web/
├── testcase_web_index.md          # updated index file (stats, directory, existing-case associations, case index)
└── testcases/                         # updated or newly added case files
    ├── {case-ID}-{case-name}.md
    └── ...

# Server (large-table format)
{run_dir}/testcase/initialcase/testcase_srv.md
```

Generate only this turn's target-end files. After saving, read back and check:

- The nine-column headers and column order are correct;
- Case IDs are non-empty and unique;
- Required fields are non-empty;
- Unmatched case content and order are unchanged;
- There is no implicit delete;
- Every update the user requested has landed.

The final response returns the actual generated file paths and the target end. The current Skill does not write `<run_dir>/testcase/cases/`.

Without explicit user authorization, do not rewrite the body of the user's local knowledge directory. This Skill does not sync to a case platform.
