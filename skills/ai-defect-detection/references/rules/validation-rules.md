# Writeback validation rules (0–22; the only authority is `open_validate.ts`)

The table below is every writeback validation actually implemented in `open_validate.ts`, numbered continuously 0–22 with no gaps. When docs or code mention "Hard rule N", that N is this table's number. **"Intercept" column**: `block` means validation failure returns an error and stops writeback; `warn` means stderr only, no block. Any document reference to a number uses this table. When a document description disagrees with `open_validate.ts` behavior, **always follow `open_validate.ts`**.

> `bugStatus` / `strategyCode` in the table are writeback-protocol fields for the Agent to fill as command arguments. They must not appear in the user-facing detection summary.

| # | Meaning | Trigger conditions | Intercept |
|---|---|---|---|
| 0 | thinking required | Any writeback with empty thinking | block |
| 1 | processSteps non-empty | processSteps is empty | block |
| 2 | rule strategy ruleId required | AST/custom-rule strategy has a defect but ruleId is empty | block |
| 3 | tagId required when there is a defect | Suspected defect / improvement writeback with empty tagId | block |
| 4 | fileCodes / git context required | fileCodes empty or missing the git triple (4.1: each item missing filePath) | block |
| 5 | AST completeness | AST scan (strategy=8) missing astRuleCount or it is 0 | block |
| 6 | Call-chain strategy analysis | Business detection (strategy=11) but thinking/content has no chain info | block |
| 7 | Business-strategy association | Business detection (strategy=11) missing referencedSources / missing test-case info | block |
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
| 21 | minDetectLevel depth gate | thinking does not contain the analysis evidence required by the assigned depth (L2+cases / L2 / L1+doc) (detectTier=T3 exempt) | block |
| 22 | contextReads context gate | Business detection (strategy=11) has too few context-read files (T1≥2, T2≥1, T3 exempt) | block |
