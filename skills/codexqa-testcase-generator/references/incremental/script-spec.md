# Incremental script contract

Seven public scripts live in `scripts/incremental/` and do not call each other. The Agent calls the needed entry directly from the current node.

## `make_ids.py`

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/make_ids.py --kind execution-id
<skill_dir>/scripts/tcg-python scripts/incremental/make_ids.py --kind change-id --seed "<stable seed>"
<skill_dir>/scripts/tcg-python scripts/incremental/make_ids.py --kind case-id --run-id "<userConfig.runid>" --seed "<stable seed>" --base-ms 1780000000000
```

`--kind`: `execution-id`, `candidate-id`, `change-id`, `action-id`, `case-id`. `case-id` must explicitly provide `userConfig.runid`. The script does not generate or identify the run root, and does not judge business actions.

## `setup_execution.py`

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/setup_execution.py \
  --run-dir "<userConfig.runDir>" \
  --run-id "<userConfig.runid>" \
  --execution-id "<executionId>"
```

`--run-root` may be omitted; when omitted it is the same as `--run-dir`. The script validates that `runDir` and `runid` match `userConfig.json`, and creates `{run_dir}/testcase/.case-enhance/{executionId}/`. It does not read business inputs, does not judge intent, and does not guess runId from a path.

## `pull_remote_code.py`

When to use: Incremental + `DIFF_ENHANCEMENT`, and the user this turn explicitly gives a PR / MR link or a custom git repo URL. Rules are in [code-fetch-spec.md](code-fetch-spec.md).

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/pull_remote_code.py \
  --pr-url "<PR/MR link or git repo URL>" \
  --run-dir "<userConfig.runDir>" \
  --run-id "<userConfig.runid>"
```

Optional `--cache-dir`, `--local-repo`, `--git-url`, `--base-sha`, `--head-sha`, `--head-ref`. Output the local worktree and full base/head SHAs. Recognize `code/repo-detail/.../pr/{n}` and rewrite it to a git remote. With `--local-repo`, by default use local objects only and do not hit the rewritten remote. Return `PR_PERMISSION_DENIED` when a private / no-permission / SSO-redirect repo cannot be fetched. The Agent must not call it when there is no valid case baseline. `--self-check` does an offline parse self-check. It does not judge cases and does not archive.

## `freeze_inputs.py`

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/freeze_inputs.py \
  --workspace "<workspace>" \
  --manifest "<archive-request.json>"
```

Output `inputs/raw/<inputId>/`, `inputs/input-manifest.json`, and `inputs/git/<repositoryId>.git/` reused by `repositoryId`. It does not select sources and does not overwrite existing inputs.

## `freeze_case_standard.py`

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/freeze_case_standard.py \
  --workspace "<workspace>" \
  --source-reference-dir "<this-repo-references-absolute-path>" \
  --source-skill-name "codexqa-testcase-generator" \
  --source-skill-version "V56"
```

Read only the top-level Chapter 3 of the three `case-tpl-*.md` files. Do not read other references, and do not overwrite an existing standard snapshot.

## `build_diff_candidates.py`

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/build_diff_candidates.py --workspace "<workspace>"
```

From frozen input pairs, generate a candidate index and full candidates with `candidateContractVersion=2.0`. `candidateConfidence` is only suitable for recall ranking, and cannot be a real-change conclusion. PATH uses a bounded snapshot diff; GIT uses Git diff of the frozen bare repository. When over the limit, set `diff` to empty; the Agent must read the frozen original.

Do not: judge real functional change, generate `KEEP`/`MODIFY`/`ADD`, or read an unfrozen external Git worktree.

## `write_task_status.py`

```bash
<skill_dir>/scripts/tcg-python scripts/incremental/write_task_status.py \
  --workspace "<workspace>" \
  --request "<status-request.json>"
```

Accept only an explicit `nodeId`, `status`, reason, artifact paths, and invalidated nodes. Do not check business content, and do not infer completion from file existence.
