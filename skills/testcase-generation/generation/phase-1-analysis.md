# Phase 1: Requirement analysis

> Load this file only when the resume table in `generate-skill.md` says Phase 1 is current. After the exit condition, discard this file from working context and load the next phase from `generate-skill.md`.


**Entry condition**: Phase 0 complete.

### Generate analysis.md (requirement-analysis subagent)

**Dispatch 1 subagent (requirement-analysis subagent)** to read source materials directly and serially generate §1.1→§1.6 per `requirement-analysis-guide.md`, appending each section into `usecases/testdocs/analysis.md`.

**Required contents of the main-agent dispatch prompt**:
- Full path to `requirement-analysis-guide.md` (the subagent `read_file`s it after start, as the generation spec)
- Full path list of all source-material files under `prd/` (skip `__MACOSX/`, `._*`, and `.DS_Store`)
- Path to `usecases/testdocs/integrations-resolved.json` (the subagent renders §1.3 engineering subtables from its `profile`; do not hardcode Redis/KV/Thrift)
- Output file path: `usecases/testdocs/analysis.md`
- **Knowledge-base paths** (conditional): pass the `cachePath` list of **all** entries in the Phase 0 stashed `knowledgeDocs` (omit if none), and state "these are available knowledge bases; based on §1.3 engineering info (Database, Cache, etc.) decide which are relevant, read on demand, and ignore the rest". Rules are in `requirement-analysis-guide.md`
- **External systems**: reading environments, filling config / middleware / experiment, and searching knowledge must call `scripts/call_integration.ts` (`--capability env_info` / `knowledge_search` / `config_lookup` / `middleware_lookup` / `experiment_lookup`); do not hand-write curl

> ⛔ The first requirement-analysis dispatch must not pass a `changed-interface-knowledge.json` path: that file is generated only after the analysis.md first draft, and the first analysis does not consume it. On R1 fix, a P1 that impacts downstream input, or a §1.6 ruling that changes interfaces/anchors, always dispatch a new same-role requirement-analysis fix subagent; do not resume a historical subagent. The fix subagent must receive `requirement-analysis-guide.md`, `gate-requirement-review.md`, the current `analysis.md`, all `prd/` source-material paths, available knowledge-base paths, the finding original text, a clear fix scope, and the current knowledge-file path; after a minimal-scope fix, a new knowledge-recall subagent refreshes affected records.
>
> ⛔ The main agent passes paths only and must not paraphrase `requirement-analysis-guide.md` or source-material contents. The subagent `read_file`s itself.

**Requirement-analysis subagent execution strategy (after start the subagent runs `wc -l` itself to count total source-material lines, then decides by the result)**:

#### Case 1: source materials total ≤ 5000 lines

The subagent `read_file`s every source-material file in full (complete read of each file, no offset/limit), then serially generates §1.1→§1.6 per `requirement-analysis-guide.md`.

#### Case 2: source materials total > 5000 lines

The subagent **chunks internally** (no intermediate files, no child subagents), as follows:

1. **Chunked read**: `read_file(offset, limit)` each source-material file in 2000~3000-line windows with 200-line overlap so cross-chunk information is not lost. Overlap keeps context continuous at paragraph boundaries.

2. **Extract points per chunk**: After each chunk, extract that chunk's function points, business rules, technical changes, interface info, call chains and dependencies, client pages, exception handling, engineering identifiers, and other key information into the subagent's working memory. Extraction rules:
   - **Extract only, do not analyze**: classify original text into buckets; do not derive, summarize, judge, or complete
   - **Keep identifier originals**: interface/method names, serviceId, and fields declared in `integrations-resolved.json` `profile.components[].fields` (e.g. datasource / table / cluster / topic / experimentKey), plus error codes, must be copied verbatim
   - **Filter strikethrough**: content marked `~~text~~` or `:[del]...[/del]` is obsolete; do not extract it
   - **Write numbers and conditions in full**: quantity limits, time windows, and concrete values in formulas must be kept; if/else branches must appear in pairs
   - **Dedup overlap**: do not re-extract the same information that appears in the overlap with the previous chunk

3. **Global cross-reference check**: After all chunks are read, the subagent runs one global check:
   - Cross-chunk reference completeness (e.g. an earlier chunk said "See chapter XX"; was that chapter extracted from a later chunk)
   - Identifier consistency (whether the same interface/table/config has the same name across chunks)
   - Business-rule completeness (if/else branches paired; no broken flows)
   - If omissions or inconsistencies are found, reread the corresponding chunks to complete or correct

4. **Generate analysis.md**: From all extraction results, serially generate §1.1→§1.6 per `requirement-analysis-guide.md`, appending each section into `analysis.md`.

> ⚠️ **Key constraint**: The first analysis output is only `analysis.md`. Do not produce source-material summaries or shard files (no source-summary.md, no .shards/). Chunked reading is an internal subagent implementation detail, transparent to the main agent.

**First-output exit condition**: `usecases/testdocs/analysis.md` has been generated, containing §1.1~§1.5 (required) + §1.6 (conditional; present when there are inconsistencies).

### R1 review (triggered immediately after the requirement-analysis subagent finishes)

**Dispatch 1 subagent** to run R1 review and validate `analysis.md` structural completeness.

```
Dispatch subagent (R1 review):
  Pass in: absolute paths of gate-requirement-review.md, analysis.md, integrations-resolved.json + comparison sources (all source-material paths under prd/) + knowledge-base paths (cachePath list of all entries in Phase 0 stashed knowledgeDocs; omit if none; the subagent decides which are relevant to §1.3 engineering-info calibration)
  Duty: read gate-requirement-review.md and review per its rules (structural completeness + change traceability + engineering info + risk identification); fix P0 in place on analysis.md; for each P1, judge whether it impacts downstream input and mark the reason
  Report: structural-completeness pass/block + P0 fix summary + P1/P2 list (each P1 must mark whether it impacts downstream input and the impact scope)
```

**Main-agent handling of the report**: After the report, check for blocking issues (missing structure, omitted sections) and P1s that "impact downstream input". If structural completeness failed, dispatch a new requirement-analysis fix subagent with full fix context, complete missing sections, then dispatch a new R1 subagent for re-review. If there is a P1 that impacts downstream input, before entering Phase 2 you must dispatch a new requirement-analysis fix subagent for a minimal-scope fix, then dispatch a new R1 subagent for targeted re-review of §1.3/§1.4 and the affected coverage; if the interface set or anchors changed, then dispatch a new changed-interface knowledge-recall subagent to refresh affected records and pass the ready check. Ordinary P1/P2 are recorded only and do not block. Only after the above gates pass, run §1.6 confirmation (if any). The main agent must not directly modify `analysis.md` or `changed-interface-knowledge.json`.

#### Human confirmation (triggered after R1 passes, when §1.6 exists)

After R1 passes, the main agent checks whether `analysis.md` contains a §1.6 section. If it does, **the flow must pause** and present the following readable ruling panel to the user; do not only output paragraphs, raw Markdown, or ask the user to compare documents themselves.

**Display template (content must be extracted from analysis.md §1.6 and presented item-by-item in full):**

```markdown
## Requirement analysis confirmation: {N} inconsistencies between PRD and technical design

Current handling principle: conclusions currently follow **PRD**; please confirm whether any adjustment is needed.

| # | Inconsistency | PRD requirement | Technical design description | Current adopted conclusion | Impact scope |
|---|---|---|---|---|---|
| 1 | {inconsistency} | {condensed paraphrase of PRD original} | {condensed paraphrase of technical-design original} | {current adopted conclusion} | {affected modules / interfaces / rules} |
| … | … | … | … | … | … |

Please reply directly: `Confirm follow PRD`, or state the item number and ruling to adjust, for example: `Item 2 follow technical design`.

[View requirement analysis]({analysis.md absolute path})
```

Table constraints: long originals may be condensed, but conditions, thresholds, states, interfaces, fields, or behavior differences must not be omitted; impact scope must be specific to a module, interface, or rule — do not write only "has impact". The link area **only shows** this run's `analysis.md` address; do not show PRD, technical-design, or design.md links.

After the user explicitly confirms "follow PRD", enter Phase 2. If the user rules any item "follow technical design", walk that row's "Impact scope" and correct every affected section in `analysis.md` to match the technical design; update and remove that §1.6 entry (delete §1.6 when the table is empty); then re-display only still-pending items and the affected-fix summary with the same template, give `[View requirement analysis]({analysis.md absolute path})` again, and wait for confirmation once more.

> ⛔ If §1.6 exists, do not skip confirmation and enter Phase 2. Inconsistency rulings directly affect test-design points and must be resolved in the analysis phase.

### Changed-interface knowledge recall (run when a local knowledge base is configured)

After the requirement-analysis first draft, in parallel with R1, dispatch a **new changed-interface knowledge-recall subagent** to read current changed interfaces and implementation identifiers from `analysis.md §1.3` and search the local knowledge base per interface. Each run of this subagent is independent, using the current on-disk artifacts as full context. The main agent must pass `requirement-analysis-guide.md`, the current `analysis.md`, the current knowledge-file path (if it exists), `knowledgePath`, all `prd/` source-material paths, and available knowledge-base paths, so it can read the full context itself and then:

Run `node --experimental-strip-types --experimental-default-type=module "{skillRoot}/scripts/call_integration.ts" --workspace "{workspace}" --capability knowledge_search --arg "query={serviceId} {interfaceName}" --arg "knowledgePath={knowledgePath}"`, and take top excerpts from returned `hits`. When `status=skipped` or there is no local hit, fall back to `knowledge/` grep.

Write `usecases/testdocs/changed-interface-knowledge.json`. This phase only deposits anchors, hit documents, and locatable body excerpts for changed interfaces, for later reuse; do not generate test points, expected results, or regression conclusions here.

**Minimum format**: the root object contains an `interfaces` array; every current changed interface must have one record, even if no document was hit.

```json
{
  "interfaces": [
    {
      "serviceId": "com.example.service",
      "interfaceName": "queryCoupon",
      "changeAnchors": ["CouponService.queryCoupon", "couponStatus field read"],
      "query": "com.example.service queryCoupon interface business knowledge",
      "documents": [
        {
          "title": "queryCoupon interface business knowledge",
          "source": "document ID or link",
          "excerpts": ["original excerpt containing the anchor or related call relationships"]
        }
      ]
    }
  ]
}
```

`changeAnchors` come from `analysis.md §1.3`; `query` records the primary query actually executed; `documents` keep only hit-document sources and original excerpts; write an empty array when there is no hit. Downstream may judge observation locations, data dependencies, or path associations only from these original excerpts; do not treat a document title, interface name, or empty record as conclusion evidence.

On R1 fix, a P1 that impacts downstream input, or a §1.6 ruling that changes interfaces or change anchors, dispatch a new changed-interface knowledge-recall subagent to refresh only the corresponding interface records; add a record when a current changed interface is added; clean redundant records when an interface is deleted or downgraded to "existing"; update the original record when anchors change. Skip when there is no local knowledge base. Before Phase 2 starts, you must output and pass the "changed-interface knowledge ready check": current changed-interface count, knowledge-file record count, missing interfaces, redundant interfaces, uncovered anchors, and the final `ready / blocked` status; only when `ready` may Phase 2 be dispatched with the three-way strategy.

**Phase 1 exit condition**: `analysis.md` has been generated and R1 structural-completeness review passed; there is no outstanding `DOWNSTREAM_INPUT_IMPACTED` P1; if §1.6 inconsistencies exist, user confirmation has been obtained (or confirmation after correction per the user ruling); when a local knowledge base is configured, `changed-interface-knowledge.json` has passed the changed-interface knowledge ready check and the last validation status is `ready`.
