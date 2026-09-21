# Case-platform sync (removed)

This Skill only does local Plan / Exec, **does not connect to a case-platform HTTP API**, does not create subsets, does not plan remote nodes, and does not upload or delete remote cases.

Stage 7 has been cancelled. When the user asks to "sync to the case platform", reply clearly: the current Skill only persists the test plan and test cases to `{run_dir}`, and does not sync to a remote case platform.

Local artifacts:

- Formal test plan: `{run_dir}/testdesign/test_design.md`
- Test cases: `{run_dir}/testcase/cases/` (and `initialcase/`)
- Aggregated HTML case report (Web + Server + APP): `{run_dir}/testdesign/testcase_generation_report.html`

Generate / refresh the HTML after Stage 6 dual-write (or after Markdown case edits):

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/generate_case_report.py --run-dir <userConfig.runDir>
```

The HTML is a read-only viewer; edit Markdown cases only, then regenerate. Do not write to a doc platform. Do not install or call external doc/identity CLI tools.
