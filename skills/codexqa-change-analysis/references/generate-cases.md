# Generate case code (deliverable B)

The report answers "what to test". This file answers "make the uncovered points actually run".
The output is **new case files that run on their own** (possibly more than one: one API-layer file, one end-to-end file). Not a snippet. Not pseudocode.

## Hard rules

1. **Add only. Do not edit existing test files.** Do not edit test files already in the repo (`tests/`, `__tests__/`, `*test*`, `*_test.*`, `*spec*`, and similar), and do not edit `package.json` scripts. Write the missing assertion as a **new case**. Do not touch the old case.
   **"Add only" forbids editing existing files. It does not mean "only one file".**
   When a point can only be checked in a browser (page render, button state, interaction), **create another end-to-end file** (for example `scripts/change-impact-e2e.mjs`). Do not mark it "cannot cover" because the existing e2e file must not be edited. Measured miss: three UI points were written as "cannot cover" when one new e2e file covered all of them.
2. **You must actually run them.** Start the service → run → record the real result (pass / skip counts, exit code) and write it into the report. If a run fails, fix the assertion or the expectation. **Do not deliver a case that was never run.** Measured miss: a status code was written from memory (401) while `util.bad()` actually returns **400**. The run is what exposed it.
3. **Do not pollute existing data.** Destructive cases (password change, profile edit, placing an order) use a **temporarily registered account or temporary data**. Do not change passwords of existing accounts, and do not change existing business data. Restore any state you changed at the end of the case.
4. **Follow the repo's style.** Read an existing test file first. Reuse its assertion helper, HTTP helper, cookie handling, `BASE` environment variable, and output format.

## How many layers, and what to name the files

**Two layers. The cut is "can this be observed without opening a browser", not a testing-technique taxonomy:**

| Layer | Rule | Typical assertion | What to write in the report "kind" column |
|---|---|---|---|
| **L1 API / integration** | Assert by an in-process call, a request, or a command | HTTP/RPC response and status, error codes, auth branches (401/403), exported functions, MQ consumers, CLI commands, data-layer behavior (write-back, de-duplication, cross-user isolation) | `API smoke` / `API regression` / `API test` (follow the repo) |
| **L2 end-to-end** | **Must open a real browser and read the DOM** | Page render (did the list / cards draw), transient states such as a `disabled` button, toast / dialog / navigation, client-only validation | `UI end-to-end` / `UI render smoke` |

The same point often spans both layers: **the API assertion goes in L1, the browser observation in L2.** The report "kind" column then says "API regression + UI end-to-end".

### Names: fixed stem, suffix and place follow the repo

The stem is `change-impact-*`. **Suffix, language, and directory follow the repo's existing test files** (read one first and copy its style):

| Language | L1 | L2 |
|---|---|---|
| JS / TS | `change-impact-tests.mjs` | `change-impact-e2e.mjs` |
| Python | `test_change_impact.py` | `test_change_impact_e2e.py` |
| Java / Kotlin | `ChangeImpactTests.java` | `ChangeImpactE2ETests.java` |
| Rust | `tests/change_impact.rs` | `tests/change_impact_e2e.rs` |
| Go | `change_impact_test.go` | `change_impact_e2e_test.go` |

The table is a translation aid. **Use the language and framework the repo already tests with.** Do not drop a `.mjs` file into a Python or Rust repo.

### Fallback (do not force two layers)

1. **The service starts and a browser can run** → emit both layers. UI points must land in L2.
2. **The service starts but there is no browser or end-to-end framework** → emit L1 only. Points that need a render get disposition `uncovered`, and the reason goes in the "case file" column (for example `not generated: no end-to-end framework`). Say so in the coverage verdict.
3. **Only a unit-test framework** (no HTTP service, no browser) → L1 shrinks to the **smallest observable unit the repo's test framework can assert directly** (call the function, query the store, build the input). L2 is marked "not created" with a reason.
4. **Neither layer can be created** → do not generate a file. State the reason in the coverage verdict. **Only this case may be written as "cannot cover".** A browser was available and L2 was not created: that is a rewrite, under the conditions below.

## Steps

1. Read an existing test file and copy its skeleton (assertion helper, request helper, exit code). **Do not import a script-style test file.** Those usually export nothing. Write a minimal copy.
2. Choose the layer count and file names from "How many layers" above: how many files, what they are called, where they go. **Never overwrite an existing file.** L2 copies the repo's existing browser automation. If that is headless Chrome + CDP, copy the `findChrome` / `launchChrome` / `waitForCdp` / CDP client + `Runtime.evaluate` block, and **use a different debug port** so it does not collide with the existing script. If the repo uses Playwright / Cypress / Selenium, copy that stack.
3. Write cases from the test plan:
   - Rows marked **add** under "points this change must newly cover" → one case each.
   - Rows marked **add** under "points to regression-test" → one case each.
   - Gaps marked **extend** in either table → **cover the same assertion with a new case**. **Leave the existing weak assertion alone.**
   - Points that can only be observed in a browser (page render, button disabled, interaction feedback) → **cover them in a new end-to-end file**. A transient `disabled` state can be captured by reading once synchronously after the click in the page context, then reading again after the request finishes.
   - **Wait for a condition, not for time.** Existing cases often use a fixed `sleep` (measured: one end-to-end file had 19 `sleep`s totaling about 28s, almost its whole runtime). New cases poll until the condition holds:
     ```js
     const waitFor = async (fn, ms = 8000) => {        // return as soon as the condition holds; fail only on timeout
       const t0 = Date.now();
       for (;;) {
         const v = await fn();
         if (v) return v;
         if (Date.now() - t0 > ms) throw new Error('timed out waiting');
         await new Promise((r) => setTimeout(r, 100));
       }
     };
     await waitFor(async () => (await evalJs('__toasts()')).includes('Added to favorites'));   // instead of sleep(900)
     await waitFor(async () => (await evalJs('document.querySelectorAll(".book-card").length')) < before);
     ```
     This is faster and more stable than a fixed wait (a slow machine does not false-fail).
     **Wait for a change, not for a condition that is already true.** If the previous branch already set the state you are waiting for (for example the error box is already non-empty), `waitFor(() => length > 0)` returns immediately and reads the old value. Wait for the **specific new text** (for example `errHas('current password is wrong')`), or clear the state first. Measured miss: waiting on `__errText().length > 0` returned the previous branch's message.
   - A gap like this is written in the report as `extend <existing file:line> → new <generated:line> covers`. **The locations already say the old case was not edited.** **Do not** add "existing case was not edited" (process notes do not enter the report; see [report.md](report.md)). Measured miss: a disposition of "extend" with no location made the reader think the old case had to be edited.
4. One `check('case name', condition, extra)` per case. The case name uses business language and matches the existing case style.
5. Print a pass / fail summary at the end, and `process.exit(fail ? 1 : 0)` (or the equivalent in the repo's language).
6. Start the service and run (**every generated file**). Record the real pass / skip counts. Step 8 writes each file into `#testplan-artifact`.
7. **Write back the "case file" column.** Every test-plan row whose disposition is "add" gets the `file:line` of its `check` in the generated file. An "extend" row is written as `existing <file:line> → new <generated:line> covers`. A point that truly cannot be written (UI behavior when there is no end-to-end framework) is disposition `uncovered`, with the reason in the "case file" column. Do not wave it through. If the report says "add" and the generated file has no matching `check`, the report and the code disagree.

## Two notes during analysis (**do not write them into the report**)

"Add only, do not edit existing files" has two side effects. Keep them in mind (the report only states case counts and pass results):

1. **The old weak assertion stays in the repo.** An existing case marked "extend" was not strengthened. It still passes. The strong assertion exists only in the generated file.
2. **The generated file is not wired into the repo's own test entry.** The hard rule forbids editing `package.json` / `Makefile` and similar, so the repo's normal test command **does not run the generated file**. Run it explicitly (see "Run and check" below). Do not assume one run of the repo's own tests covered this change. "Now covered / still not" in the coverage verdict follows the generated file's actual `check`s.

Wiring the generated file into the test script means editing `package.json`. That is outside this skill's hard rule. Do it only when the user explicitly asks.

## Run and check

```bash
<the repo's own start command>   # for example npm start / cargo run / ./gradlew bootRun (background)
<how to run the L1 file>         # example: node scripts/change-impact-tests.mjs; pytest tests/test_change_impact.py
<how to run the L2 file>         # example: node scripts/change-impact-e2e.mjs (needs a browser; skip if there is none)
```

- **If the port is taken, the service is already running. Do not kill someone else's process.** Run against it.
- `BASE` can point at another instance.
- Coverage claims must match the file: if the report says a row is covered, the file has the matching `check`.

## How it appears in the report

Put a `.callout.ok` at the end of the test-plan section (the template already has the `#testplan-artifact` slot). The example below is a JS repo; swap the file names for other languages:

```html
<div class="callout ok" id="testplan-artifact">
  <b>New case files:</b> <code>scripts/change-impact-tests.mjs</code> (API layer, N cases: X passed / Y skipped),
  <code>scripts/change-impact-e2e.mjs</code> (end-to-end, M cases: all passed) — <b>N+M cases, all passed</b>.
</div>
```

**Do not paste the whole test source into the report.** `#testplan-artifact` states only "file + case count + pass / skip" (see [report.md](report.md)). How to run, and the rest of the notes, stay in this file or in the chat.

## Rewrite if any of these happen

- An existing test file was edited, or `package.json` was edited
- A case was never run, or a failing run was delivered anyway (fix the assertion or the expectation; if it truly cannot be fixed, put the point in `#coverage` item 3 "still cannot cover" with a reason, and **do not** put it in `#testplan-artifact`)
- A case changed an existing account's password or existing business data, or did not restore state it changed
- **A browser was available** and L2 was not created, and the point was written as "cannot cover" / "not generated" (if there really is no browser or end-to-end framework, follow the fallback above and state the reason; that is not a rewrite)
- A `.mjs` file was generated in a non-JS repo
- The whole test source was pasted into the report
- Only the happy path was written; boundary and rejection paths named in the test plan were not covered
- The file cannot run on its own (it depends on an edited `package.json` script or a manual setup step)
- Several files were generated but the report names only one
