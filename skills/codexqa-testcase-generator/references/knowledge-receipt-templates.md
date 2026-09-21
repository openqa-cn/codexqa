# Knowledge close-reading-layer output templates

> Default templates for each stage's close-reading-layer output. If a stage has specific template requirements, those take priority; when none are provided, output per this file's default templates.

---

## Common skeleton (four fixed sections)

Every stage close-reading output file must contain the following four sections:

### Conclusion section

List actionable conclusions by dimension; each ends with `[priority|confidence|source entry ID]`.

Format:
```markdown
## Knowledge close-reading conclusions

### {dimension name}

- Conclusion 1: {executable conclusion} [must|high|BK-XXX-001]
- Conclusion 2: {executable conclusion} [important|medium|BK-XXX-002]
```

### Gap section

Explicitly list dimensions with zero hits on must-level knowledge. Omit this section if there are no gaps.

Format:
```markdown
## Knowledge gaps

- {dimension name}: must-level knowledge was not recalled; recommend human supplement
```

### Work-receipt section

Record step by step the knowledge work this stage **actually completed**, for the user to review immediately and for later audit. Each line's status may only be `SUCCESS`, `SKIP`, `MISS`, `FAIL`; field meanings and output timing follow [knowledge-adapter.md](knowledge-adapter.md) "per-stage knowledge work receipt". Do not substitute planned steps for execution results, and do not omit miss, failure, or degradation actions.

Format:
```markdown
## Knowledge work receipts

| Receipt ID | Action | Status | Input/scope | Result and evidence | Adoption or degradation |
|---------|------|------|-----------|------------|------------|
| K{N}-01 | preflight | SUCCESS | knowledge/index.md; {required dimensions} | {N} candidates | Enter retrieval |
| K{N}-02 | reuse | SKIP | {prior index.json} | current stage has no reusable entries | Retrieve from the source index |
| K{N}-03 | retrieve | SUCCESS | {keyword-group summary} | candidates {N}, close-read {N}; BK-XXX-001 | {report chapter/TO/S-xx/case ID} |
| K{N}-04 | persist | SUCCESS | current-stage close-reading directory | index.json, knowledge-audit.md already updated | For later stages to review |
```

### Reuse section

This stage's `index.json` path, for later stages to go directly; also provide the full-chain audit file path.

Format:
```markdown
## Cross-stage reuse

- Stage index: `{run_dir}/testcase/knowledge-biz/{project-name}/stage{N}-{scenario}/index.json`
- Close-reading file directory: `{run_dir}/testcase/knowledge-biz/{project-name}/stage{N}-{scenario}/knowledge/`
- Full-chain audit: `{run_dir}/testcase/knowledge-biz/{project-name}/knowledge-audit.md`
- Per-stage analysis basis and conclusions: `{run_dir}/testcase/knowledge-biz/decision-records/{project-name}/stage{N}-{scenario}.md` (an independent directory under knowledge-biz; do not write it into this close-reading artifact)
```

---

## Default conclusion-section templates per stage

### Stage 1: requirement analysis

**Conclusion-section template** (`{}` are placeholders):
```markdown
### Business terms and concepts
- {term}: {meaning} [must|high|BK-XXX-001]

### Business flows
- {flow name}: {end-to-end path description} [must|high|BK-XXX-002]

### Business rules and constraints
- Function point: {function-point name}
- Rule: {condition} → {result}
- Exception: {exception condition}
- Boundary: {boundary value} [must|high|BK-XXX-003]

### Function map
- {function name} → owning module: {module name}, entry: {entry description} [important|medium|BK-XXX-004]

### Pitfalls and retrospectives (if recalled)
- {historical issue}: {lesson learned} [optional|low|BK-XXX-005]
```

**Fill example**:
```markdown
### Business rules and constraints
- Function point: create POI whitelist
- Rule: merchant status=verified AND store status=open → may enter the whitelist
- Exception: headquarters acting on behalf does not validate store status
- Boundary: per-store cap of 50 entries [must|high|BK-POI-RULE-001]
```

---

### Stage 2: impact-scope analysis

**Conclusion-section template**:
```markdown
### System architecture and dependencies
- {service name}: upstream/downstream {upstream} → {downstream}, cascade-failure risk: {description} [must|high|BK-XXX-001]

### Services and APIs
- {API name}: {change content}; caller: {caller}; contract-break risk: {description} [must|high|BK-XXX-002]

### Data models
- {table name/entity name}: producer {service} → consumer {service}; consistency risk: {description} [important|medium|BK-XXX-003]

### Entity relationships
- {entity A} → {entity B}: {dependency} [important|medium|BK-XXX-004]

### Configuration and switches
- {config-item name}: {impact scope}, drift risk: {description} [important|medium|BK-XXX-005]

### Core business scenarios
- {scenario name}: P{0-1}, risk-judgment basis {impact surface × trigger probability}; this requirement reaches it → must list it in the impact-scope report [must|high|BK-XXX-006]

### Defect patterns
- {pattern name}: trigger condition {condition}, risk {description} [important|medium|BK-XXX-007]
```

**Fill example**:
```markdown
### Services and APIs
- createPoiWhitelist: request adds a source field; caller: PRD service; contract-break risk: old clients with empty source must take the default logic [must|high|BK-POI-API-003]
```

---

### Stage 3: existing-case recall

**Conclusion-section template**:
```markdown
### Function-module test focus
- {module name}: test focus {focus description}, used for existing-case relevance judgment [must|high|BK-XXX-001]

### Regression strategy
- {module name}: regression scope {description}, used in gap analysis to judge "existing cases already cover this but the strategy requires stronger regression" [important|medium|BK-XXX-002]

### Standard sample cases (recall only for blank fallback)
- {sample name}: {applicable scenario}, as a fallback reference when generating blank scenarios [optional|low|BK-XXX-003]
```

**Fill example**:
```markdown
### Function-module test focus
- POI whitelist: test focus whitelist-effective-condition validation + boundary values; existing cases are positive-only and need boundary supplements [must|high|BK-POI-FOCUS-001]
```

---

### Stage 4: test design

**Conclusion-section template**:
```markdown
### Business-custom test methods
- {test-object type}: positive/negative ratio {ratio}; {specific test requirement} [must|high|BK-XXX-001]

### Test focus
- {scenario type/module name}: test-design emphasis {description}, minimum coverage standard {description}, priority impact {P0/P1/no promotion and basis} [must|high|BK-XXX-005]

### Regression strategy
- {risk level/scenario name}: regression depth {must-regress/sample/skippable}, core regression list {description}, priority impact {P0/P1/no promotion and basis} [important|medium|BK-XXX-006]

### Defect patterns
- {pattern name}: trigger condition hits → force-generate a defense scenario: {defense-scenario description} [important|medium|BK-XXX-003]

### Implicit test points
- {Verification point}: source {local knowledge-pack entry}, cannot be derived from the document [important|medium|BK-XXX-004]

### Standard sample cases
- {sample name}: scenario-split granularity {description}, verification-point organization {description} [must|high|BK-XXX-005]

### Custom generation rules
- {rule name}: {aggregation/dedup/abnormal/Tag strategy} [must|high|BK-XXX-006]
```

**Fill example**:
```markdown
### Defect patterns
- Cache and DB inconsistency: trigger condition hits → force-generate a defense scenario: cache-refresh check after adding/removing from the whitelist [important|medium|BK-POI-DEFECT-001]
```

---

### Stage 5: test-plan generation

**Conclusion-section template**:
```markdown
### Plan-integration constraints
- {constraint name}: {constraint content}, affected chapters {plan chapter/scenario-table fields} [must|high|BK-XXX-001]

### Traceability requirements
- {source stage/object} → {plan presentation location}: {mapping rule} [must|high|BK-XXX-002]

### Handling of items to complete
- {missing type}: {placeholder and human-intervention note} [important|medium|BK-XXX-003]
```

**Fill example**:
```markdown
### Traceability requirements
- Stage 4-1 audit-corrected test scenarios → Chapter 3 test-scenario table: inherit scenario IDs, priorities, and priority bases; do not re-adjudicate in Stage 5 [must|high|BK-PLAN-TRACE-001]
```

---

### Stage 6: test-case generation

**Conclusion-section template** (generic-layer norms are already statically loaded; the close-reading layer focuses on on-demand knowledge):
```markdown
### Test-data setup process
- {data item} → {constructable format or Test-data setup process citation} [optional|medium|BK-XXX-001]

### Tag strategy
- {tag name}: {tagging rule} [important|medium|BK-XXX-002]

### Custom generation rules (reuse Stage 4)
- Citation: `{run_dir}/testcase/knowledge-biz/{project-name}/stage4-test-design/index.json` [must|high|BK-XXX-003]
```

**Fill example**:
```markdown
### Test-data setup process
- Precondition data "verified merchant + open store" → Test-data setup process {function module}/test-data-setup-process.md [optional|medium|BK-POI-DATA-001]
```

---

### Incremental: incremental enhancement

Fill only when the user has already provided local knowledge and compatibility / regression / test-data setup gaps remain. Persist to `{run_dir}/testcase/knowledge-biz/{project-name}/incremental-case-enhance/`; write decisions to `knowledge-biz/decision-records/{project-name}/incremental-case-enhance.md`.

**Conclusion-section template**:
```markdown
### {changed-object name} (API/table/switch/field)
- Compatibility: {conclusion}
- Regression: {conclusion}
- Switch branches: {conclusion}
- Historical-defect defense: {conclusion} [must|high|BK-XXX-001]

### Knowledge gaps
- {changed-object name}: no knowledge hit; needs human confirmation
```

**Fill example**:
```markdown
### poi_whitelist table adds a source column
- Compatibility: historical NULL data takes the default-value check
- Regression: full regression of whitelist queries [must|high|BK-POI-DB-002]
```

---

## Summary quality safeguards

- Zero hits on a must-level knowledge type → explicitly prompt the knowledge gap, and write the retrieval and degradation actions already tried as `MISS` in the work receipt; do not silently degrade
- Entries with relevance < 0.5 do not enter the summary; if an excluded entry affects a key gap, record the exclusion count and reason in the receipt
- Summarize the same entry only once within a single task; later stages cite processed_path or the summary ID in this stage's index.json
- Each stage's work receipts must appear at the same time in the conversation, `knowledge-audit.md`, and (if it exists) `index.json.knowledge_work_receipt`; the three must match on entry IDs, status, hit counts, and gaps
- Every knowledge judgment that affects a report, scenario, trigger source, or case must record "analysis basis and conclusions" in the current-stage Markdown under `{run_dir}/testcase/knowledge-biz/decision-records/{project-name}/`; although that directory sits under `knowledge-biz/`, it is isolated from `{project-name}/stage*/` close-reading directories; close-reading files and `index.json` keep only knowledge entries, close-reading conclusions, work receipts, and reuse info
- Analysis-basis records are verifiable decision summaries; do not write the model's original step-by-step internal thinking, guesses without evidence, credentials, account info, identity tickets, or restricted data
- Stage close reading has not reached the stop condition but the token budget is exhausted → explicitly mark "close reading incomplete" and the missing dimensions, and record the actual status as `FAIL` or `MISS`; do not silently truncate
