# Phase 0: Environment initialization

> Load this file only when the resume table in `generate-skill.md` says Phase 0 is current (or this is a first-time generate). After the exit condition, do not keep this file in working context — go back to `generate-skill.md` and load the next phase.


1. Create the directory structure (see Directory structure in `generate-skill.md`). If `prd/.gitignore` is missing, write it with `__MACOSX/`, `.DS_Store`, and `._*` so the later `git -C prd/ add -A` baseline does not pick up macOS metadata.
2. Initialize `usecases/testdocs/case-registry.json` (shape `{ "_meta": {}, "cases": [] }`; `_meta` is filled in step 8)
3. **Load external-system config**: from the skill root, run:
   ```bash
   node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/validate_integrations.ts" --workspace "{workspace}" --resolve-out usecases/testdocs/integrations-resolved.json
   ```
   Workspace `{workspace}/.ai-testcase/integrations.yaml` takes priority; otherwise use the skill's `config/integrations.default.yaml`. On validation failure, stop and show errors. Later subagents read only `integrations-resolved.json` (no secrets) for `profile.protocols`, `profile.mockableProtocols`, `profile.components`, and whether each capability is enabled.
4. **Read global config**: read `.project/context.json` (skip if missing). Stash the entire `knowledgeBases` array in a variable (`knowledgePath` on `type: "knowledge"` entries is used for changed-interface knowledge recall and regression script-library recall; `type: "docs"` entries are preloaded as knowledge-base files in the next step). If the file is missing or the field is absent, record an empty array; do not block the flow.
5. **Read global user-feedback rules**: read `.ai-testcase/feedback-rules.md`; if the file is missing, continue with empty rules — do not create it, do not block. The file contains only reusable test methods and display rules; it is not requirement fact or review evidence. Later, pass the file path only into the matching phase: Phase 2 Step 1 reads "Module organization, verification-point design, regression design"; Phase 3 Step One reads "Case generation"; diagram rendering reads "Diagram display". Do not pass or inline the file body to unrelated subagents.
6. **Knowledge-base preload** (run when `type: "docs"` entries exist or a `knowledge/` directory exists; otherwise skip). Process each entry:
   - `cache_path` or a non-empty local path: reuse it directly.
   - Public `url` only: `web_fetch` the content and **redirect it to disk** at `.ai-testcase/knowledge-cache/{name}.md` (do not pour the full document back into the main-agent context), then write the absolute path back to that entry's `cache_path` in `.project/context.json`; on read failure, leave it empty and retry next time — do not block the flow.
   - Workspace already has a `knowledge/` directory: add all markdown/JSON files under it to the knowledge-base list, skipping `__MACOSX/`, `._*`, and `.DS_Store`.

   After processing, stash `knowledgeDocs: [{ name, cachePath }]`. Subagents in later phases (Phase 1 §1.3 engineering-info calibration; Phase 2 §1 scenario identification / §2 entity-dependency completion) all receive **every** knowledge-base `cachePath`; each subagent decides which are relevant to the current task, greps / reads on demand, and ignores the rest.

7. **In parallel**, save source materials into the matching directories:
    - PRD / requirement docs → `prd/requirementDocs/`
    - Technical design → `prd/techDocs/`
    - spec info → `prd/specs/`

    **Remote document fetch**: When the user provides a public URL, `web_fetch` it and write it to the matching source-material directory (must write a file; do not leave the full document in the main-agent context). When the user already provided a local file, copy it to the matching directory.
    Choose the target directory by document type: PRD / requirement → `prd/requirementDocs/`; technical design → `prd/techDocs/`; spec → `prd/specs/`.

8. **Establish baseline + write _meta** (after step 7; creates the initial baseline for update-skill change detection):

   **8.1 Establish the `prd/` git baseline**
    ```bash
    # If prd/ is not yet a git repo (normal on first generation)
    if [ ! -d "prd/.git" ]; then
      git -C prd/ init
      git -C prd/ add -A
      git -C prd/ commit -m "baseline: initial PRD snapshot"
    fi
    PRD_HASH=$(git -C prd/ rev-parse HEAD)
    ```

   **8.2 Record each code-repo HEAD (if any)**
    ```bash
    # If the code/ directory exists and has subdirectories, record each HEAD commit hash; otherwise skip.
    # Emits one "dirName<TAB>commitHash" line per repo; collect them for the _meta write in 8.3.
    # Plain POSIX shell on purpose: bash associative arrays need bash 4+, and macOS still ships bash 3.2.
    if [ -d "code" ]; then
      for dir in code/*/; do
        [ -d "$dir" ] || continue
        printf '%s\t%s\n' "$(basename "$dir")" "$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo '')"
      done
    fi
    ```

   **8.3 Write `_meta` into case-registry.json**

   Write the following fields into the `_meta` object of `case-registry.json`:

   | Field | Value |
   |------|-----|
   | `last_prd_commit` | `PRD_HASH` from the previous step |
   | `last_code_commits` | `{ dirName: commitHash }` map of each code repo (omit this field when code/ does not exist) |
   | `last_update_time` | current time (`date "+%Y-%m-%d %H:%M:%S"`) |

   > ⚠️ **Write method**: Use `node -e` + `JSON.parse` / `JSON.stringify` to read the existing `case-registry.json`, update `_meta` fields, and write back without changing the `cases` array.

**Exit condition**: Directories created; `integrations-resolved.json` written; global config read (`knowledgeBases` stashed); knowledge bases preloaded (`knowledgeDocs` stashed, recording only `{ name, cachePath }`; empty array when no knowledge-base config); all source materials saved; registry file initialized; prd/ git baseline established; `_meta` written into `case-registry.json`.

