# Knowledge-processing adapter

> This document is the **only entry** for knowledge processing. Stages 0–6 and Incremental uniformly follow this document for source priority, prior reuse, gap marking, and receipts; do not invent a separate set in stage files.
>
> Knowledge comes only from requirements / technical design / prior reports, this repo's `references/`, and a local knowledge directory the user has already provided or a knowledge-repo Git URL the user explicitly gave (read the local `index.md` after a shallow clone). Calling an external knowledge-retrieval Skill is forbidden.

## Reading guide

1. Required: I (source priority), II (built-in files), III (discovery and close reading), IV (close-reading rules and stage boundaries)
2. When the user gave a local directory or Git URL, also read III's bootstrap parameters and the `index.md` format
3. When writing a work receipt, read VI and VI-1
4. On failure or re-bootstrap, read VII and IX

---

## I. Three-layer interaction architecture

Knowledge-source priority (mandatory; a later level must not overwrite a fact already stated by an earlier level):

| Priority | Source | What it provides |
|---|---|---|
| 1 | Requirement / technical design / prior-stage reports the user input (only cleaned body text already persisted in Stage 0) | **Facts** such as Business terms, flows, rules, APIs, data, and config. Sub-documents marked `unresolved-remote` / `missing` in Stage 0 are not fact sources |
| 2 | Built-in norms in this repo (generic layer) | How to analyze and how to write the plan/cases (templates, fusion, type models, ratios, priority defaults) |
| 3 | A local knowledge directory the user **has already provided**, or a knowledge-repo Git URL explicitly given in the conversation (optional) | Team supplemental materials; skip the entire layer if none |

| Layer | Mechanism |
|----|------|
| **Generic layer** | At startup, read built-in files under this repo's `references/`; do not go through retrieval |
| **Optional local pack** | When the user has given a local directory or Git URL, build `knowledge/index.md` then close-read |
| **Close-reading layer** | Extract executable conclusions from priority-1 body text + the priority-3 optional pack, and persist `index.json` |

An empty index is valid. Do not interrupt the main flow or ask the user for external retrieval because there is no local knowledge pack. When the user **actively** pastes a knowledge-repo Git URL, fetch per Section III and then close-read.

### Plan / Exec knowledge boundaries

- **Plan (Stages 0–5)**: Stage 0 only records whether an optional local pack exists; Stages 1–4 extract facts from the requirement / technical design and overlay built-in methods; Stage 4-1 only fills gaps that can be verified from the input; Stage 5 only integrates prior reports.
- **Exec (Stage 6)**: Write cases from the formal test plan + built-in three-end templates; read the local pack only when it already exists and test-data setup / format gaps remain.
- **Incremental**: First reuse the formal test plan, the frozen baseline, and Chapter 3 of this repo's three-end templates; read the local pack only when it already exists and compatibility / regression / test-data setup gaps remain. Incremental is not Stage 7.
- Do not connect to a case platform; do not call a knowledge-retrieval Skill.

---

## II. Generic layer (static load)

### Load timing

Load once at Skill startup (the run-workspace stage); it stays in effect for the whole run.

### Load contents

| Knowledge type | This-repo file | Purpose |
|---------|------|------|
| Case structure / assertions / steps / data / Meta | `case-tpl-server.md` / `-web.md` / `-app.md` | How to write three-end cases |
| Scene fusion and dedup | `scene-fusion.md` | How to split and merge scenarios |
| Visibility / analytics-event standard scenarios | `ui-visible-scenarios.md` | LIST/CLICK/SHOW, MV/MC/PV |
| Test-object types and models | `s04-object-design.md` | Types such as T01, 5:3:2, priority first draft |
| Plan layout | `plan-md-template.md` | Formal test plan chapters |
| Five-way parameter classification / trigger-source placeholders | `shared-rules.md` | Contract field classification; inventing values is forbidden |

### Load method

Read only the `references/` files above.

---

## III. On-demand layer (local knowledge pack)

### Load mechanism

During initialization this Skill calls `scripts/bootstrap_knowledge.py`:

```
The user actively provides a local knowledge directory, and/or explicitly gives a Git URL in the conversation
    │
    ├── Has a Git URL: fetch_knowledge_git.py shallow-clones to knowledge/repo/
    ├── bootstrap_knowledge.py → {run_dir}/knowledge/index.md
    │     └── Has a directory or an already-cloned repo: copy Markdown to knowledge/pack/ and build the index
    │     └── Has neither: write an empty index; the main flow continues
    ▼
Each stage filters and reads from the local `index.md` by knowledge dimension / keyword (close-reading layer; the shallow-cloned repo and the local knowledge directory use the same read method)
    │
    └── After close-reading-layer processing, write {run_dir}/testcase/knowledge-biz/{project-name}/
```

When the index is empty, continue with the requirement / technical design + the generic layer, mark gaps, and **do not mid-run ask** for a knowledge directory or Git URL.

### Discovery and close reading

After the user pastes a Git URL, shallow-clone the whole repo, or scan the user's local directory; copy to `knowledge/pack/` and generate `index.md`. Each stage filters, extracts conclusions, and writes `index.json` and receipts per the Section IV close-reading layer.

Do not automatically treat links inside the PRD / technical-design body as a knowledge-repo URL. Pull only when the user explicitly says "this is a knowledge repo / knowledge Git URL".

### Bootstrap parameters

| Field | Semantics | Required | Value source |
|------|------|------|---------|
| `--output-dir` | `{run_dir}/knowledge` | Yes | run-workspace |
| `--source` | User local knowledge directory | No | User input this turn or `userConfig.knowledgeSource` |
| `--git-url` | Git URL the user explicitly gave | No | This-turn conversation or `userConfig.knowledgeGitUrl` |
| `--git-ref` | Branch or tag | No | URL `#branch` or `userConfig.knowledgeGitRef` |

### Output artifacts

```
{run_dir}/knowledge/
├── index.md
├── knowledge-manifest.json
├── repo/                             # Exists only when the user provided a Git URL and the clone succeeded
└── pack/                             # Markdown copied from a local directory or cloned repo
```

### index.md format

The locally bootstrapped index uses a Markdown table and records knowledge-file paths relative to `{run_dir}/knowledge/`:

| Field | Description |
|------|------|
| Title | Document first-level heading or filename |
| Knowledge dimension | Inferred from path keywords; "Uncategorized" if unknown |
| Knowledge level | Local pack defaults to L1 |
| Knowledge-file local path | Relative to `{run_dir}/knowledge/`, usually `pack/...` |
| Source | Local knowledge directory the user provided |

An empty index is also a valid artifact: the table may have only an "(empty)" row, meaning this run uses only the generic layer and the requirement body.

### Local knowledge-pack conventions

`.md` / `.txt` in the user directory are copied to `knowledge/pack/`. The close-reading layer reads only these local files:

| User-directory shape | This skill's adaptation |
|------|-------------|
| Ordinary Markdown directory | Scan then build the index; retrieve by title/path/body keywords |
| Ships its own index.md or AGENTS.md | Likewise scan the full text; treat routing files only as ordinary documents; do not call an external skill |

### Knowledge-dimension mapping

Consume the local knowledge pack by dimension; the mapping is:

| Knowledge dimension | Level | This skill consumption stage | This skill internal knowledge type |
|------------|---------|------------------|---------------------|
| Object-under-test info & Test strategy | L2 | Stages 1–2 | Business terms, Business flows, Business rules, function map, System architecture, Services and APIs, Data models, entity relationships, config and switches |
| Historical risks | L2 | Stages 2–4, Incremental | Defect patterns, pitfall retrospectives |
| Test strategy | L2 | Stages 2–4, Incremental | Core business scenarios, test focus, regression strategy |
| General Case-writing standards | L0 | Generic-layer static load | Case structure, assertions, steps, data, Meta norms |
| Case samples, tags, and business-custom writing rules | L1/L2 | Stage 4, Stage 6 | Sample format, Tag strategy, aggregation/dedup and business-special format |
| Case-space info | L1 | This Skill does not bind a remote space; Stage 0 writes `SKIP` for this dimension | Do not adopt |
| Business-domain test-data construction guide | L1 | Stage 6, Incremental (uncovered gaps only) | Test-data setup process |
| Automation Case-writing standards | L1 | (this skill does not consume) | — |
| Special auth logic | L2 | Stage 4-1 (unqueried gaps only) | Trigger-source auth method |

### Knowledge-level mapping

| Level | Semantics | This skill correspondence |
|---------|------|-------------|
| L0 | Generic norms (cross-team generic) | Generic layer (static load) |
| L1 | Business-specific (team-custom) | On-demand layer + close-reading layer |
| L2 | Scenario-specific (concrete business domain) | On-demand layer + close-reading layer |

### Knowledge content standard

Each local knowledge document contains two parts:

**① Attribute info** (fields in the index.md table: title/knowledge dimension/level/path/source)

**② Knowledge content** (body of the md file the path points to): format is unrestricted; organize freely in markdown; content should be self-contained and directly consumable by AI.

### Content-standard detection

This skill triggers detection when reading knowledge from index.md:

| Detection dimension | Check method | Handling on failure |
|---------|---------|---------------|
| Whether index.md exists | Check `{run_dir}/knowledge/index.md` | If missing, rerun local bootstrap to write an empty index; record `MISS` when the entry count is 0 |
| Whether the file the path field points to exists | Check each local file pointed to by path in index.md | Mark "Knowledge file missing: {path}" |
| Whether required knowledge items are complete | Check against each sub-stage's required-knowledge list | Mark "Knowledge gap: missing {knowledge type}" |

Write detection results to the `quality_check` field of the close-reading-layer stage index.json.

---

## IV. Close-reading layer (local retrieval and summary output)

### Execution flow

```
index.md already bootstrapped (empty allowed) → close-reading layer executes
  │
  ├── 1. Keyword extraction and combination
  ├── 2. Filter entries from index.md (by stage/sub_stage/knowledge dimension) + keyword retrieval Top10
  ├── 3. Composite scoring and ranking
  ├── 4. Extract executable conclusions per close-reading rules
  ├── 5. Summarize output per the stage template
  └── 6. Persist index.json + knowledge/ for cross-stage reuse
```

### 1. Keyword extraction and combination strategy

| Dimension | Description | Extraction source per stage |
|------|------|--------------|
| **Base keywords** (required) | Core business entities: function names, module names, business actions, API names, table names, switch names | Stage 1: full PRD text; Stage 2: Stage 1 function points; Stage 3: function-module paths; Stage 4: test-object types; Stage 4-1: objects to complete; Stage 6: formal test plan scenarios and directory ownership |
| **Stage modifiers** (required) | Identify the technical/business dimensions the current stage cares about | Stage 1: terms/rules/flows/map; Stage 2: architecture/APIs/data/config/entities; Stage 3: test focus/regression; Stage 4: test methods/defects/implicit/samples/rules; Stage 4-1: current gaps; Stage 6: samples/tags/test-data setup/business format |
| **Combination method** | Combine base + modifiers for retrieval to raise hit rate and precision | e.g. "create POI whitelist+Business rules", "createPoiWhitelist+interface contract" |
| **Exclusion words** (optional) | Filter entries unrelated to the current stage to reduce noise | Stage 6 excludes strategy/defect entries already covered by Stage 4, unless the formal test plan explicitly has a corresponding gap |
| **Batch input** (keyword_group) | Support inputting multiple keyword groups at once for unified close reading: merge multiple words inside the same function module into one group; split across function modules into multiple groups; take TopN per group then merge | Stage 2 splits groups by six-dimension impact; Stage 6 splits groups only by uncovered case constructability gaps |

Keywords are of two kinds: business-object words (function/API/table/switch names) and knowledge-dimension words (rules/contracts/Defect patterns); prefer combination matching.

Stage 1's three-layer keyword extraction from the full PRD, hit thresholds, and stage-specific fallbacks are unified in [s01-req-analysis.md](s01-req-analysis.md) "Stage 1 knowledge consumption". This document only provides the generic filter, close-reading, reuse, and receipt mechanisms for those keywords.

### 2. Retrieval Top10 mechanism

**Input**: knowledge dimensions the current stage needs + keyword combinations (base + modifiers; keyword_group batch is supported).

**Retrieval**: filter `{run_dir}/knowledge/index.md` along three dimensions:

| Filter dimension | Rule |
|---------|------|
| Stage dimension | `stage`/`sub_stage` in index.md matches the current stage |
| Dimension dimension | Knowledge dimension in index.md matches the knowledge types the current stage needs (see Section III knowledge-dimension mapping) |
| Keyword dimension | tags/title/content in the md file pointed to by `path` match the keyword combination; tokenization + synonym expansion are supported |

On batch input, retrieve by keyword_group, then dedup and merge across groups.

**Ranking**: composite score = stage match × dimension match × keyword match × priority weight (must=3, important=2, optional=1).

**Output**: take the top 10 by relevance per keyword_group (relevance < 0.5 does not enter close reading); for each one, read the local entry body then close-read.

### 2.5 Local expansion search for API and dependency keywords

When keywords contain an API name, service name, method name, or dependency identifier, grep once more in **already-persisted local materials** to backfill entry locations the technical design did not fully write. Search only testdocs and the optional pack; do not assume a `domains/`, `systems/`, or `wiki/services/` directory structure.

**Trigger conditions (all of the following must be met)**:
1. The current stage is Stage 1 or Stage 2.
2. The keywords contain Interface, Service, Method, Gateway, Provider, RPC, API, or a service name that appears in the requirement / technical design.
3. Filtering by `knowledge/index.md` alone still lacks entry location, protocol, or parameter structure.

**Expansion-search actions**:

| Step | Action | Search scope | Keywords |
|------|------|---------|--------|
| 1 | Extract API/method/service names | — | API names, method names, serviceId (including service-identifier fields in the source text), and service short names extracted from the PRD/technical design |
| 2 | grep in local materials | `{run_dir}/testcase/testdocs/**/*.md`, and existing `{run_dir}/knowledge/pack/**/*.md` | `InterfaceName`, `MethodName`, `ServiceName`, `serviceId` |
| 3 | After hit dedup, include in close reading | Same unified close-reading rules | Extract only protocol, parameters, and degradation already stated in the source text; unify the service identifier as `serviceId`; do not invent Class/Provider |

**Stop and degrade**:
- If there are hits, merge close reading; annotate `index.json` with `"expansion_search": true` and the file paths.
- If there are no hits, write `"Entry location missing: {API name / service name}"` in `gaps`, and pass it into Stage 2 as a pending-clarification item; do not invent.

### 3. Unified close-reading rules

| Rule | Description |
|------|------|
| **① Admission** | Relevance < 0.5 does not enter close reading; must-level first; low confidence is a hint only and cannot alone support a hard conclusion |
| **② How to read** | Read small entries in full; for large entries read only the paragraphs that correspond to hit keywords, applicable stages, and related anchors |
| **③ Extraction** | Must convert into executable conclusions; do not copy source text: for rules extract conditions/boundaries/exceptions; for contracts extract fields/enums/error codes/compatibility requirements; for defects extract trigger conditions/risks/suggested scenarios; for Test strategy extract coverage focus/priority/regression scope |
| **④ Traceability** | Each conclusion keeps source, processed_path, confidence, actionable_summary for cross-stage reuse and feedback |

### 4. Stage close-reading boundaries

Each stage's reference is the only source of the close-reading profile: Stage 0 only prechecks; Stages 1–4 make explicit their own close-reading objects/artifacts/TopN/stop conditions; Stage 4-1 only completes unqueried gaps; Stage 5 does not add retrieval; Stage 6 close-reads only gaps that case generation has not yet covered. This document does not repeat those stage-specific rules.

### 5. Close-reading-layer output format

Write close-reading results to this stage's directory; for output templates see [knowledge-receipt-templates.md](knowledge-receipt-templates.md).

**Common skeleton** (four fixed sections):

- **Conclusion section**: list actionable conclusions by dimension; each ends with `[priority|confidence|source entry ID]`
- **Gap section**: explicitly list dimensions with zero hits on must-level knowledge (omit if none)
- **Work-receipt section**: record step by step the knowledge checks, reuse, expansion, close reading, and adoption actions this stage actually executed; for the format see this file's "per-stage knowledge work receipt"
- **Reuse section**: path to this stage's `stage{N}-{scenario}/index.json`, for later stages to go directly

Analysis basis and conclusions must be written separately to `{run_dir}/testcase/knowledge-biz/decision-records/{project-name}/stage{N}-{scenario}.md`. That directory sits under `knowledge-biz/`, but is not part of the `{project-name}/stage*/` close-reading artifacts; see this file's "reviewable analysis basis and conclusions".

### 6. Stage index format (index.json)

```json
{
  "stage": "stage1-requirement-analysis",
  "scenario": "requirement-analysis",
  "keywords_used": ["create POI whitelist", "Business rules"],
  "keyword_groups": [
    {
      "group_id": "g1",
      "keywords": ["create POI whitelist", "Business rules"],
      "top_n": 10
    }
  ],
  "entries": [
    {
      "id": "BK-POI-RULE-001",
      "source": "testdocs/requirement.md#Business-rules",
      "processed_path": "knowledge/business-rules-summary.md",
      "title": "POI whitelist Business rules",
      "dimension": "object-under-test knowledge/business knowledge/Business rules",
      "priority": "must",
      "confidence": "high",
      "relevance_score": 0.92,
      "actionable_summary": "Whitelist effective condition: merchant status=verified AND store status=open",
      "keywords_matched": ["POI whitelist", "Business rules"]
    }
  ],
  "summary_output": "full text of conclusion section + gap section + work-receipt section + reuse section",
  "quality_check": {
    "attribute_table_present": true,
    "required_attributes_filled": true,
    "missing_knowledge_types": []
  },
  "knowledge_work_receipt": {
    "audit_file": "{run_dir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md",
    "events": [
      {
        "id": "K1-01",
        "action": "preflight",
        "status": "SUCCESS",
        "evidence": "knowledge/index.md exists; required dimensions: Business terms, Business rules, Business flows",
        "result": "hit 12 candidates",
        "fallback": "SKIP: no completion needed"
      }
    ],
    "usage_links": [
      {
        "entry_ids": ["BK-POI-RULE-001"],
        "target": "stage1-requirement-analysis-report.md#Business-rules-and-constraints"
      }
    ]
  }
}
```

---

## V. Cross-stage reuse mechanism

### Reuse order (all knowledge-consumption stages)

1. Verify the current stage's required `run_dir`, prior formal artifacts, and a readable index; Stage 6 must also verify the formal test plan and the Stage 4 close-reading index.
2. Prefer reading the prior `index.json`; first-screen with `actionable_summary`, then retrieve usable conclusions via `processed_path`.
3. Explicitly record covered items and uncovered items. Only for uncovered, stale, or current-stage-unique knowledge types, do directed filtering and close reading from `{run_dir}/knowledge/index.md`.
4. When the index is empty or a dimension has no hit, continue with the requirement / technical design and the generic layer, and mark gaps as `---` / pending clarification; do not rerun a prior stage because the index is empty, and do not invent.

### Cache strategy

- Across stages, prefer reusing already-generated stage index.json; across sessions, first restore from already-persisted indexes and close-reading files.
- Re-route only when an entry is missing, stale (the entry's updated lags the source-repo time), or the current stage has a unique gap.
- Close-read the full text of the same entry only once within a single task; later stages cite it by entry ID and already-persisted conclusions.

### Requirement-complexity adaptation

| Requirement complexity | Routing behavior | Context and cache strategy |
|-----------|---------|----------------|
| Single service, single domain | index.md hits 1 domain → load that domain's overview + target function-module entries; shortest routing path | Across stages prefer reusing already-generated index.json; re-filter from index.md only when missing |
| Multi-service, multi-domain | index.md hits N domains → persist by domain into separate directories → merge and dedup same-dimension items then inject | Quota by domain, so one domain's knowledge does not crowd out others |
| Cross-session / context compression | Restore from the stage index.json: cite if visible, read the close-reading file if not; re-route only on a miss | When a cached entry's updated lags Diff/PR time, take the code as authoritative and report stale |

---

## VI. Unified preflight, reuse, and gap-fill mechanism

When a stage file enters its "knowledge consumption" chapter, execute uniformly in the following order; do not misread "has index.md" as requiring a full close read, and do not call external retrieval because of an empty index.

| Order | Generic action | Execution rule |
|------|----------|----------|
| ① Preflight | Check `{run_dir}` and prior artifacts; record whether `knowledge/index.md` is empty | Stage 0 only records availability; Stage 6 must also check `testdesign/test_design.md` and the Stage 4 `index.json`. |
| ② Prior reuse | Read existing stage reports, `index.json`, and close-reading files | First form a "covered / to-fill" list; Stage 5 executes only this item. |
| ③ Gap judgment | Against facts the current stage must extract from the input + built-in methods | Mark what the input does not have as `---`; do not invent. |
| ④ Optional local close reading | Filter and close-read from pack only when the index has entries and uncovered dimensions exist | Must not replace prior reports or rerun Plan; write `SKIP` for an empty index. |
| ⑤ Local completion / fallback | Read `pack/` only when the user **already provided** a knowledge directory at initialization; do not follow up or block on an empty index | Stage 0 only records whether a local pack exists; Stage 5 does not complete. |
| ⑥ Persist receipts | Write the stage close-reading artifacts, `knowledge-audit.md`, and necessary decision records | Leave a trail immediately for each actual action; `SKIP`, `MISS`, and `FAIL` must likewise state a reason. |

---

## VI-1. Per-stage knowledge work receipt (mandatory)

### Goal and general principles

Knowledge consumption must be reviewable. Every stage must output to the user, step by step, the knowledge actions **already actually completed**, rather than only saying in general at the end of the stage that "knowledge was queried". At the same time append the same facts to `{run_dir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md`, so a human can recheck after the session by stage, step, and evidence path.

- A receipt records only the extract/close-read process, hit counts, entry IDs, source paths, adoption locations, and gaps; do not copy knowledge body text, and do not output credentials or restricted data.
- Immediately after each action finishes, output one receipt line; do not write a step that has not yet happened as completed.
- When an action does not apply, has zero hits, or fails, it must still be recorded; do not silently omit it; later execution must follow the recorded degradation actions and gaps.
- The conversation receipt, `knowledge-audit.md`, and that stage's `index.json.knowledge_work_receipt` for the same stage must be consistent. When Stages 0, 4-1, 5, and 7 have no independent index, write only `knowledge-audit.md`, and add a citation in the consumed prior index (if applicable).

### Status and receipt-line format

| Status | Meaning | Follow-up requirement |
|------|------|---------|
| `SUCCESS` | The action executed and obtained a valid result | Record the hit count, key entry IDs, or output path |
| `SKIP` | The action does not apply to the current stage or does not need to execute | Must record a concrete reason, for example "prior index already covers this; no completion needed" |
| `MISS` | Retrieval/expansion was executed, but there is no adoptable result | Record the query object, the gap, and the fallback actions already executed |
| `FAIL` | The action did not complete because of a file, tool, permission, or similar exception | Record an exception summary and the degradation actions already executed / to execute; do not disguise it as `SKIP` |

Use the following format in the conversation; `K{N}-{seq}` is unique within this run:

```text
[Stage {N} | Knowledge work receipt]
[K{N}-01][SUCCESS] Preflight: knowledge/index.md is readable; required dimensions={dimension list}; candidates={N} entries.
[K{N}-02][SUCCESS] Prior reuse: read {prior index.json path}; reused={N} entries (BK-XXX-001, BK-XXX-002).
[K{N}-03][SKIP] Local completion: the prior index covers the current dimensions; no need to follow up.
[K{N}-04][SUCCESS] Local retrieval: keyword groups={keyword-group summary}; candidates={N}; selected for close reading={N}.
[K{N}-05][SKIP] Local expansion: the current keywords are not API/dependency keywords; not triggered.
[K{N}-06][SUCCESS] Close reading and adoption: formed={N} executable conclusions; already written={report chapter/TO/S-xx/case ID}.
[K{N}-07][SUCCESS] Review persist: audit={knowledge-audit.md path}; stage index={index.json path}.
```

Each stage outputs only actually applicable actions, but must explicitly output `SKIP` to state why something was not executed; show at most 10 entry IDs, and collapse extras as "and N more". In human mode, first fully output the current stage's work receipts, then show the stage summary and pause; in fully automatic mode also output in the order actions complete; do not backfill them in the final summary.

### Actions that must be recorded

| Action | Evidence the receipt must include |
|------|------------------|
| Preflight (`preflight`) | Whether `knowledge/index.md` exists, readability, the current stage's required dimensions, and candidate count |
| Prior reuse (`reuse`) | Path of the prior `index.json` that was read, reused entry count and entry IDs; reason if not reused |
| Local completion (`refresh`) | Record only whether a local pack already existed at initialization; `SKIP` if not provided; do not mid-run follow up |
| Local retrieval (`retrieve`) | Keyword-group summary, filter dimensions, candidate count, selected-for-close-reading count; do not record knowledge body text |
| Local expansion (`expansion`) | Trigger judgment for Stage 1/2 API or dependency keywords, testdocs/pack search scope, hit paths or miss gaps |
| Close reading and adoption (`deep_read`/`apply`) | Count of executable conclusions, mapping from source entry IDs to target report chapters/TOs/scenarios/cases |
| Gaps and degradation (`gap`) | Zero-hit / exception / unfinished dimensions, actions already tried, later human-completion locations |
| Review persist (`persist`) | Actual paths of `knowledge-audit.md`, the current stage `index.json`, and the close-reading directory |

### Persist format

Create `knowledge-audit.md` in Stage 0; append in execution order; do not overwrite historical receipts. Each stage uses one second-level heading and records all actions in a table:

```markdown
## Stage 2: impact-scope analysis

| Receipt ID | Action | Status | Input/scope | Result and evidence | Adoption or degradation |
|---------|------|------|-----------|------------|------------|
| K2-01 | preflight | SUCCESS | knowledge/index.md; architecture/APIs/data/config | 24 candidates | Enter retrieval |
| K2-02 | reuse | SUCCESS | stage1-requirement-analysis/index.json | reused BK-XXX-001, BK-XXX-002 | API impact surface |
| K2-03 | expansion | MISS | InterfaceName, serviceId | no hit on system-layer entry | pending-clarification item: Class/Provider |
| K2-04 | persist | SUCCESS | stage2-impact-analysis | index.json, knowledge/ already written | reusable by Stages 4/6 |
```

When the stage index exists, you must append `knowledge_work_receipt`: `audit_file`, ordered `events` (`id/action/status/evidence/result/fallback`), and `usage_links` (`entry_ids → target artifact location`). `quality_check` keeps its original responsibility; do not use it to replace a complete work receipt.

### Reviewable analysis basis and conclusions (mandatory)

#### Record boundary

What is kept is a **structured decision summary** that supports review of business conclusions, not the model's original step-by-step internal thinking. Each record contains only verifiable facts, applicable criteria, candidate trade-offs, judgment basis, the conclusion, and its landing point; do not record free association, trial-and-error drafts, guesses without evidence, model self-evaluation, or any credentials, accounts, identity tickets, or restricted data.

When a knowledge entry affects report content, a TO, a model, a scenario, a trigger-source field, a priority, a case, or gap handling, you must record at least one decision. Purely mechanical actions such as file checks and directory creation do not need a decision record.

#### Independent directory and file naming

Decision records are fully isolated from `{project-name}/stage*/` close-reading artifacts; do not write them into any close-reading file, `knowledge-audit.md`, or the stage `index.json`. Persist them uniformly in a dedicated sibling directory under `knowledge-biz/`:

```text
{run_dir}/testcase/knowledge-biz/decision-records/{project-name}/
├── stage0-input-processing.md
├── stage1-requirement-analysis.md
├── stage2-impact-analysis.md
├── stage3-case-recall.md
├── stage4-test-design.md
├── stage4-1-test-design-review.md
├── stage5-plan-generation.md
├── stage6-case-generation.md
└── incremental-case-enhance.md
```

At stage start, create or reuse the corresponding file and write the file title, stage name, and created/updated time; append decisions inside the stage as `D{stage}-{seq}`. When the stage formed no knowledge-related judgment, the file must still state "This stage does not need a decision record: {reason}".

#### Decision-record fields

Each stage file uses one decision table; each record uses `D{stage}-{seq}` as its unique ID.

| Field | Requirement |
|------|------|
| `subject` | The API, rule, dependency, scenario, field, or gap object being judged |
| `entry_ids` / `evidence_anchors` | Knowledge entry IDs and source-text locations (file path + heading/line number) used to adopt or exclude; a source excerpt may be attached when needed, no more than 30 characters per item |
| `applicable_criteria` | Explicit rules, contracts, priorities, or filter criteria this stage used for judgment |
| `candidates_considered` | At least list the adopted candidate; when comparable candidates or exclusion results exist, record the candidates, `adopted` / `rejected` / `deferred` results, and a reason of no more than 50 characters |
| `rationale` | A judgment-basis summary derived from evidence and criteria, no more than 80 characters; do not write evidence-free wording such as "the model thinks" |
| `conclusion` | An executable, verifiable final conclusion, no more than 120 characters |
| `target` | The report chapter, TO, S-xx, trigger-source field, case ID, or pending-clarification item the conclusion lands in |
| `limitations` | Gaps, assumptions, unverified scope, or human-completion requirements; fill "none" if none |

Each stage file should have no more than 20 decisions; when exceeding that, merge by the same object and the same conclusion, and state the merge scope in "artifact landing / limitations". All "judgment basis" text in a stage combined must not exceed 1500 characters, to prevent the decision file from bloating and to keep review efficient.

#### Independent Markdown file template and conversation output

Each stage file uses the following format; Stages 0, 4-1, 5, and 7 apply the same way; "evidence and criteria" may cite consumed prior `index.json` entries or report locations, but must not write back into them.

```markdown
# Stage 2: impact-scope analysis | Analysis basis and conclusions

- Stage: Stage 2 (impact-scope analysis)
- Project: {project-name}
- Created: {YYYY-MM-DD HH:mm:ss}
- Last updated: {YYYY-MM-DD HH:mm:ss}
- Close-reading artifact citation: `{run_dir}/testcase/knowledge-biz/{project-name}/stage2-impact-analysis/index.json`

| Decision ID | Analysis object | Evidence and criteria | Candidate trade-offs | Judgment basis | Conclusion | Artifact landing / limitations |
|---------|----------|------------|----------|----------|------|----------------|
| D2-01 | Downstream coupon-fact query dependency | BK-API-001#Provider; API-contract required-field rule | Adopt Provider A; exclude B (not the current serviceId) | Provider A's serviceId, method, and call direction match the changed API. | Downstream success-with-empty-result must take the no-coupon branch; failure results need explicit degradation. | Stage 2 impact scope#dependencies; S-05; missing timeout threshold TBD |
```

In the conversation, immediately after the stage work receipts show a summary of no more than 3 items; each item contains only "object | key evidence/criteria | conclusion | landing"; write the full candidate trade-offs, judgment basis, and limitations only into the independent Markdown decision file. For example:

```text
[Stage 2 | Analysis basis and conclusions]
[D2-01] Downstream coupon-fact query dependency | BK-API-001#Provider + required-field rule | empty result takes no-coupon, failure degrades explicitly | already landed on S-05.
```

#### Traceability and consistency

The following chain must be traceable in both directions:

```text
evidence anchors / entry IDs in the decision Markdown → applicable criteria → candidate trade-offs → judgment basis → conclusion → close-reading index.json.usage_links.target / business artifact
```

- Entry IDs cited in the decision file must exist in `entries.id` of the current or a cited prior index; a zero-hit decision may be empty, but must cite the corresponding `K{N}-xx` `MISS` / `FAIL` receipt in "artifact landing / limitations".
- When a decision conclusion semantically conflicts with `entries.actionable_summary`, take the evidence-anchor source text as authoritative; the conflict must be explicitly recorded as `deferred` and enter a pending-clarification item; do not silently overwrite.
- "Artifact landing / limitations" must be locatable. When there is no actual artifact, explicitly write "Pending human completion: {object}"; do not forge an already-persisted state.
- During quality check, sample at least 3 independent decision records under `knowledge-biz/decision-records/` per stage (all of them if fewer than 3), and confirm anchors are accessible, the basis is within the character limit, the conclusion is verifiable, the landing exists, and the content is consistent; at the same time confirm that `{project-name}/stage*/` close-reading directories, close-reading files, `knowledge-audit.md`, and the stage `index.json` did not receive an analysis-basis-and-conclusions table or `decision_records`.

### Plan / Exec stage action matrix

| Scope and stage | Required/optional knowledge actions | Review landing |
|------------|------------------|----------|
| Plan/initialization (Stage 0, Step 2 local config) | Write only local userConfig (`projectSource=none`); explicitly `SKIP` the "case-space info" dimension; do not call a case-platform API | `{run_dir}/testcase/testdocs/userConfig.json` |
| Plan/Stage 0 input processing | Only record whether the optional local pack has been bootstrapped; do no business close reading; do not ask for a knowledge directory. Case-space binding follows the initialization row; write `SKIP` for other inapplicable actions | `knowledge-biz/decision-records/{project-name}/stage0-input-processing.md` |
| Plan/Stage 1 requirement analysis | Extract facts from the PRD; close-read supplements only if a local pack exists; grep API names in testdocs (and the optional pack) | `stage1-requirement-analysis/index.json` + `knowledge-biz/decision-records/.../stage1-requirement-analysis.md` |
| Plan/Stage 2 impact analysis | Reuse Stage 1 + the technical design; fill gaps only if a local pack exists; grep entry locations in testdocs/pack | `stage2-impact-analysis/index.json` + `knowledge-biz/decision-records/.../stage2-impact-analysis.md` |
| Plan/Stage 3 coverage judgment | Reuse Stages 1/2; do not connect a remote space; treat all as new; optionally read test focus from the local pack | `stage3-case-recall/index.json` + `knowledge-biz/decision-records/.../stage3-case-recall.md` |
| Plan/Stage 4 test design | Reuse Stages 1–3 + built-in T01–Txx / fusion / 5:3:2 / templates; the local pack only supplements team-custom rules | `stage4-test-design/index.json` + `knowledge-biz/decision-records/.../stage4-test-design.md` |
| Plan/Stage 4-1 audit completion | Fill only gaps that can be verified from the input and prior reports, at most 8 objects; do not open new external retrieval | `knowledge-biz/decision-records/.../stage4-1-test-design-review.md` |
| Plan/Stage 5 plan integration | Only reuse prior indexes/reports; do not newly retrieve; do not ask for a knowledge directory | `knowledge-biz/decision-records/.../stage5-plan-generation.md` + traceable fields in the test plan |
| Exec/Stage 6 case generation | Formal test plan + built-in three-end templates; read pack only when a local pack already exists and test-data setup / format gaps remain | `stage6-case-generation/index.json` + `knowledge-biz/decision-records/.../stage6-case-generation.md` |
| Incremental post-submit incremental | First reuse the formal test plan, the frozen baseline, and Chapter 3 of the three-end templates; read pack only when a local pack already exists and compatibility / regression / test-data setup gaps remain | `incremental-case-enhance/index.json` + `knowledge-biz/decision-records/.../incremental-case-enhance.md` |
| (Removed) Stage 7 case-platform sync | Do not execute | — |

---

## VII. Local knowledge-pack debugging and fallback

### Re-bootstrap the local knowledge pack

When the index is missing, or the user actively provides a directory / Git URL, run only the local scripts:

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/bootstrap_knowledge.py \
  --output-dir {run_dir}/knowledge \
  --source <user local knowledge directory>

<skill_dir>/scripts/tcg-python <skill_dir>/scripts/bootstrap_knowledge.py \
  --output-dir {run_dir}/knowledge \
  --git-url <Git URL the user explicitly gave> \
  --git-ref <optional branch or tag>
```

When both are provided, take this turn's Git URL as authoritative and refetch. Accept only https / `git@` / `ssh://git@`. On clone failure, write an empty index and `FAIL`; Plan/Exec continues. stdout is a single JSON (`ok`, `msg`, `indexPath`).

### grep fallback retrieval

When index.md is empty or dimension entries are insufficient, search only inside the already-bootstrapped local pack:

```bash
grep -rl "function-name" {run_dir}/knowledge --include="*.md"
grep -rn "ClassName\|methodName" {run_dir}/knowledge --include="*.md"
```

When no knowledge directory was provided, do not blindly search the user's home directory or other repos.

---

## VIII. Parameter extraction rules

Extract API parameters from the requirement / technical design or the optional local pack, and convert them into a legal JSON object template (consistent with Stage 1 rules):

| Java type | JSON placeholder value |
|---------|-----------|
| int / Integer | 0 |
| long / Long | 0 |
| String | "" |
| boolean / Boolean | false |
| object / DTO | {} |
| array / List | [] |
| BigDecimal / Double | 0 |

Parameter existence forms: tables (extract by column), field descriptions (field name + type), JSON Schema (convert directly).

### Merge rules

- The optional local pack does not overwrite explicit descriptions already in the technical design
- Fields completed from the local pack mark the source as "local knowledge pack"
- What none of the requirement / technical design / local pack have, mark as "pending human confirmation"; do not invent

---

## IX. Failure handling

| Failure scenario | Handling |
|---------|---------|
| No local knowledge directory or Git URL was provided | Stage 0 writes an empty index and records `MISS`; continue throughout with the requirement / technical design + the generic layer; do not mid-run follow up |
| The Git URL the user gave is illegal or the clone failed | Write an empty index, receipt `FAIL`, do not interrupt Plan/Exec |
| index.md does not exist | Rerun `bootstrap_knowledge.py` to generate an empty index, then continue |
| No hit in the local pack | Mark "Knowledge gap: {knowledge type} was not found in the input or the local pack"; continue with generic-layer methods; do not invent |
| Content standard is noncompliant | Mark the noncompliant items; keep the entry but use it at reduced weight |
| Close reading has not reached the stop condition but the token budget is exhausted | Explicitly mark "close reading incomplete" and the missing dimensions; do not silently truncate |

---

## X. Notes

- Take APIs/Class/parameters only from the requirement, the technical design, or a local pack the user has already provided; if they cannot be found, do not invent
- Do not check a remote knowledge-base `log.md`, and do not distinguish dual-repo paths `scene-apis/` vs `wiki/services/`
- Must-level facts the input does not state → mark pending clarification, continue analysis with generic-layer methods, do not silently invent
- Close-read the same entry only once within a single task; later stages cite processed_path or the summary ID in this stage's index.json
