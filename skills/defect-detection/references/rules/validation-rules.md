# Writeback validation rules (0–22 in `scripts/validate.ts`, plus rule 24 in `scripts/cli_run.ts`)

The table below is every writeback validation actually implemented in `scripts/validate.ts`, numbered continuously 0–22 with no gaps, followed by rule 24 which runs only in the `batch-update-process` pre-check (`scripts/cli_run.ts`). When docs or code mention "Hard rule N", that N is this table's number. **"Intercept" column**: `block` means validation failure returns an error and stops writeback; `warn` means stderr only, no block. Any document reference to a number uses this table. When a document description disagrees with `scripts/validate.ts` behavior, **always follow `scripts/validate.ts`**.

> `bugStatus` / `strategyCode` in the table are writeback-protocol fields for the Agent to fill as command arguments. They must not appear in the user-facing detection summary.

| # | Meaning | Trigger conditions | Intercept |
|---|---|---|---|
| 0 | thinking required | Any writeback with empty thinking | block |
| 1 | processSteps non-empty | processSteps is empty | block |
| 2 | rule strategy ruleId required | AST/custom-rule strategy has a defect but ruleId is empty | block |
| 3 | tagId required when there is a defect | Suspected defect / improvement writeback with empty tagId | block |
| 4 | fileCodes / git context required | fileCodes empty or missing the git triple (4.1: each item missing filePath) | block |
| 5 | AST completeness | AST scan (strategy=8) missing astRuleCount or it is 0 | block |
| 6 | Call-chain strategy analysis | Chain-based strategies (strategyCode 4 / 6 / 11) but thinking/content has no chain info (`→`, caller/callee, upstream/downstream …). Exempt: detectTier=T3 (STEP B skipped by design); bugStatus=2 only checked at T1 | block |
| 7 | Business-strategy association | Business strategies (strategyCode 6 / 11) missing referencedSources; `Test case ID:` required only when bugStatus=6/7 **and** a case covers this method (`relatedMethods` / plan `caseRelevance≠none`); when the task has cases but none is mapped to methods, every defect must cite one | block |
| 8 | Zero leak | content contains internal rule IDs / strategy numbers / internal IDs | block |
| 9 | AST full pipeline | AST scan (strategy=8) has a defect but processSteps is missing exclusion_rule_filter | block |
| 10 | tagId legality | tagId is not in the get-tag-list legal set | block |
| 11 | content prefix | When there is a defect, content does not start with `Defect:` / `Improvement:` | block |
| 12 | content line numbers | content is missing the `Lines:X-Y` format | block |
| 13 | content fix suggestion + code block | When there is a defect, missing Fix suggestion / Improvement plan field or code block | block |
| 14 | Code-read gate | Writeback has no code-read registration for the className (AST scan exempt) | block |
| 15 | Affected business required | Suspected defect / improvement content is missing `Affected business` | block |
| 16 | Reproduction path required | Suspected defect / improvement content is missing `Reproduction path` | block |
| 17 | Plain-text format + tag spec | content contains ** bold (17.1) / required fields insufficient (17.2) / tags not wrapped in [] or missing introduction-period tag (17.3) | block |
| 18 | Suggested verification items | thinking contains uncertainty wording but content is missing "suggested verification items" | warn |
| 19 | Repo-clone gate | The corresponding repo has no git clone registration before writeback | block |
| 20 | Batch writeback aggregation | Writeback should go through batch-update-process aggregated submit (empty batch is validated at the entry) | block |
| 21 | minDetectLevel depth gate | thinking does not contain the analysis evidence required by the assigned depth (L2+cases / L2 / L1+doc). Applies to every strategy except 8; `light` mode is exempt. Unlike rule 22 there is **no T3 exemption** | block |
| 22 | contextReads context gate | Too few context-read files on strategy 4/6/11 (T1≥2, T2≥1, T3 exempt; T1 drops to ≥1 in `light` mode) | block |
| 24 | Method-name authenticity (`batch-update-process` pre-check) | `methodName` is not found in the local clone of the referenced source file (the name was probably invented rather than extracted) | block |

> **Rules 21 and 22 do not self-arm.** Both read `_minDetectLevel` / `_contextReadsCount` from the write-back request body, and no CLI path injects them — the values exist on the plan item but are never propagated. They therefore only fire when the agent supplies the fields explicitly. Depth is still enforced at close time by `check-analysis-quality`, which re-derives it from recorded `contextReads` and blocks on shortfalls. Same for `_mode`: plan items carry `mode`, but the `light` relaxations above never engage automatically.

## Exit contract

- `validate.ts` failures: the command prints the rule message and exits 1; nothing is submitted.
- `batch-update-process` pre-check failures (any rule above, incl. 24): prints `{"code": -2, "msg": "pre-validation blocked ...", "errors": [{index, label, error}]}` and exits 1; **the whole batch is withheld**, fix the listed items and resubmit.
