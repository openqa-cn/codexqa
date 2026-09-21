# Stage 2: impact scope and risk analysis

## Minimum persist (this stage)

- File: `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md`
- File: `stage2-*/index.json`
- Required headings: `Function impact chain` | `Risk assessment and priority`

Based on Stage 1 requirement analysis and test-object identification results, precisely bound the change impact, identify risks, and assign test priority.

## Knowledge execution boundary

Stage 2 reuses Stage 1 conclusions per [knowledge-adapter.md](knowledge-adapter.md) and uses the technical design as the primary fact source for six-dimension impact analysis. With no local knowledge pack, continue with the technical design + Stage 1, mark gaps as pending clarification, do not shrink the six-dimension analysis, and do not call an external retrieval Skill.

## Inputs

> Before this stage starts, first follow [shared-rules.md](shared-rules.md) "Stage entry check (mandatory)" to confirm `run_dir` is available (userConfig.runDir → user-specified path → this Skill's initialized default directory); do not perform any reads or writes before that confirmation.

- Stage 1 output: read from `{run_dir}/testcase/testdocs/stage1-requirement-analysis-report.md` (business-function inventory, technical architecture, risk signals, five-dimension test-object inventory (including the interface-object inventory, the technical-implementation-object inventory, client-type candidates / calibration results, validation surfaces), scope boundary, user paths, pending clarification items)
- Optional local knowledge: only when the user already provided a knowledge directory at init, read from `{run_dir}/knowledge/index.md` and Stage 1 close-reading artifacts to supplement interfaces/config not written in the technical design; locate entries by grepping testdocs and pack per [knowledge-adapter.md](knowledge-adapter.md) section 2.5. Skip this item when there is no local pack.
- Extract related information from UI figures, function descriptions, and the technical design in the requirement document
**Extract from UI figures:**
- [ ] New page list: ___
- [ ] Revised page list: ___ (diff points versus the historical version)
- [ ] Historical pages that host new action entries: ___
- [ ] Target pages jumped to after the flow completes: ___
- [ ] Historical component/module references that appear in the UI: ___

**Extract from function descriptions:**
- [ ] New business function points: ___
- [ ] Changed business rules (old rule → new rule): ___
- [ ] New/changed status enums: ___
- [ ] New/changed permissions/roles: ___
- [ ] Historical function names mentioned in the text: ___ (mention means associate)
- [ ] Data entities mentioned in the text: ___

#### 1.2 Extract from the technical design

**Extract from flowcharts:**
- [ ] Main-flow node list: ___
- [ ] Exception-handling paths: ___
- [ ] Existing services/modules called: ___ (not newly added this time)
- [ ] Data tables read or written: ___
- [ ] Events/messages triggered: ___

**Extract from interface information:**
- [ ] New interface list: ___
- [ ] Changed interface list + change content: ___
- [ ] Deprecated interface list: ___
- [ ] Changed data tables/fields: ___
- [ ] Changed config items: ___



## Knowledge consumption: close-reading layer (mandatory)

> Knowledge-interaction adaptation is unified in [knowledge-adapter.md](knowledge-adapter.md); output templates are in [knowledge-receipt-templates.md](knowledge-receipt-templates.md).

**Execute before six-dimension impact analysis.** Knowledge consumption has two goals: ① complete interface/config information not mentioned in the technical design; ② widen impact-scope identification and find functions and modules that the technical design did not mention but that are actually indirectly affected.

### Consumption timing

After the Stage 1 report is persisted and before six-dimension impact analysis starts.

### Knowledge acquisition

First read the Stage 1 `index.json` and reuse already-confirmed terms, rules, interfaces, and module locations; treat the technical design as primary for technical facts. Only when a local pack already exists and the dimensions in the table below were not covered in Stage 1, filter directionally from `knowledge/index.md`. Do not ask for a directory to be supplied when the index is empty; mark gaps as pending clarification; do not skip impact analysis.

| Filter dimension | Value |
|---------|------|
| stage | `impact-analysis` |
| knowledge dimension | object-under-test knowledge / technical knowledge, test strategy |

### Needed knowledge types (corresponding knowledge dimensions: object-under-test knowledge / technical knowledge + test strategy)

| Knowledge type | Priority | Use |
|---------|--------|------|
| System architecture and dependencies | Required | Function-impact-chain analysis (upstream → downstream → parallel dependencies), cascade-failure risk identification |
| Services and interfaces (call chain including MQ) | Required | Interface-impact-surface analysis (caller → provider → protocol change), contract-break risk identification |
| Data model | Important | Data-impact-domain analysis (producer → consumer → transform node), data-consistency risk identification |
| Entity relationships | Important | Cross-service dependency and prerequisite-entity identification, supporting the dependency-object inventory |
| Config and switches | Important | Config-impact-point analysis (global config → environment differences → gray-release switches), config-drift risk identification |
| Core business scenarios (P0/P1 inventory) | Required | Business prior for risk-assessment weighting: functions that hit a core business scenario are automatically raised in priority |
| Defect patterns | Important | Scoring basis for the technical-risk dimension (prior probability of concurrency / cache / compatibility risks) |

### Close-reading layer execution

Content to obtain: interface name, serviceId, path/Interface, request method/Method, request-parameter structure, response structure, auth method, MQ information, JobScheduler tasks, config items. Whatever the original key name of a service identifier in the source, land it on `serviceId` per [shared-rules.md](shared-rules.md) "Current field names and read normalization".

**Keyword combination**: base keywords (Stage 1 function points / interface names / table names / module names) + stage modifiers (architecture / interface / data / config / entity); split into 6 keyword_group groups by the six dimensions and retrieve.

**Close-reading rules**:

| Item | Spec |
|------|------|
| Close-reading objects | System architecture, interface contracts, data model, entity relationships, config switches, core scenarios and priority, defect patterns |
| Close-reading artifacts | Six-dimension impact facts (service / interface / data / config / compatibility / core regression scenarios); focus on depositing stage2/index.json for Stage 4/6 reuse |
| TopN · budget | Split into 6 keyword_group groups by the six dimensions; merge Top5 from each |
| Stop condition | For each change object, locate upstream/downstream and key risks as far as possible; mark as pending clarification what the technical design did not write |

**Extended retrieval**: for interface / service / dependency keywords, grep testdocs and the optional pack per [knowledge-adapter.md](knowledge-adapter.md) section 2.5; adopt only entries and parameters already written in the source; when not hit, write them into the interface impact surface and pending clarification items.

**Output**: output per the Stage 2 template in [knowledge-receipt-templates.md](knowledge-receipt-templates.md) and persist to `{run_dir}/testcase/knowledge-biz/{project-name}/stage2-impact-analysis/`. This stage's conclusions deposit stage2/index.json for direct Stage 4/6 reuse.

### Knowledge use

Fact basis for six-dimension impact analysis, prior input for joint business-risk × technical-risk scoring, and P0-P3 priority assignment. When a P0 core scenario written in the requirements or the local pack is touched by this requirement, it must be listed explicitly in the impact-scope report and marked with its source (requirements / technical design / local knowledge pack).

### Retrieval-result merge

Merge close-reading conclusions from knowledge consumption with Stage 1 information:

- Append interfaces completed from the local pack to the interface-object inventory and mark the source as "local knowledge pack"; completed entries must carry `serviceId` (fill `---` when not written); do not invent another service-identifier field
- Append completed message queues to the technical-implementation-object inventory
- Append completed scheduled jobs to the technical-implementation-object inventory
- Append completed config items to the config-impact-point inventory (see six-dimension impact analysis item 4)
- For objects whose client-type candidate is `unknown` or that the technical design did not make explicit, fill `terminal_type` and `validation_surface` only when the local pack already wrote them; if still undecidable, keep `unknown` explicitly; do not default them to server
- Append identified indirectly affected functions to function-impact-chain analysis (see six-dimension impact analysis item 1)
- Append historical faults and risks to the risk-assessment input
- The merged inventory is the complete input for later six-dimension impact analysis, Stage 4 client-type calibration, and Stage 4-1 client-type information write-back

### Quality requirements

- The local pack only supplements information the technical design did not write; when the local pack is more complete (for example a full package path covering a short class name), the local pack may overwrite the brief information, marked as source "local knowledge pack (override)"
- Mark completed results as source "local knowledge pack", distinct from information extracted from the technical design
- For interfaces marked `_incomplete: true` in Stage 1, re-check first in testdocs and the optional local pack
- Convert hit interface parameters and full class paths to JSON object templates per the parameter-extraction rules in [knowledge-adapter.md](knowledge-adapter.md)
- Do not check the remote knowledge-base `log.md`
- Remote or missing child docs marked Stage 0 `unresolved-remote` / `missing` **are not already-read impact evidence**; do not guess upstream/downstream, interfaces, or config from a title, URL, or "TBD" annotation

### `_incomplete` interface fallback rules

After checking testdocs and the optional local pack, interface parameters still have three states:

| State | Handling |
|------|------|
| Complete parameters were filled | Remove the `_incomplete` marker; parameters can be used directly |
| Partial parameters were filled | Keep `_incomplete: true`, annotate filled fields and unfilled fields, and mark unfilled fields "pending human confirmation" |
| Still no parameters | Keep `_incomplete: true` and annotate "pending human confirmation" |

**Do not invent parameters**: for fields provided by neither the technical design nor the local pack, do not speculate, do not generate a skeleton, do not fill default-value placeholders; annotate explicitly

### Execution preconditions

- An empty index is valid and does not stop this stage from continuing
- With no local pack, annotate "no local knowledge pack" and skip index filtering; do not skip the six-dimension analysis
- The local pack does not overwrite explicit descriptions already in the technical design; it only supplements unmentioned information
- Unretrieved remote child pages must not be treated as already covered by the technical design or the knowledge pack; mark gaps as pending clarification; do not invent; do not pull pages

---

## Change-path verification-scenario identification (lightweight)

**Execute after the technical design and optional local pack are checked, and before six-dimension impact analysis.** This change added/changed a field on some interface, and downstream consumers need to verify that field's pass-through result. This step identifies that kind of cross-interface path verification scenario.

### Execution logic

1. **Take changed interfaces**: from the Stage 1 interface-object inventory, take interfaces marked **new** or **change**
2. **Find downstream consumers**: for each changed interface, use the technical design, the Stage 1 report, and the optional local pack to identify its downstream consumers:
   - Who subscribed to the MQ it emits?
   - Who read the DB table/field it wrote?
   - What interfaces correspond to successor functions on the requirement / technical-design business path?
3. **Output the scenario path**: when there is a downstream consumer, output one scenario path: `changed interface → downstream verification interface`, and annotate the verification focus (for example "Verify that the new field promoId is correctly passed through in the detail-interface response")
4. **Skip when there is no downstream**: not every change has a downstream consumer; do not invent one

### Output format

Fold into this stage's existing "function call-path diagram" artifact; do not add a separate document. Format:

```
**Change-path verification scenarios**
| Owning module | Changed interface | Downstream verification interface | Verification focus |
|---------|---------|------------|---------|
| [module of the changed interface] | POST /api/order/create (new promoId field) | GET /api/order/detail | Verify promoId is correctly passed through in the detail-interface response |
```

### Constraints

- Derive only downstream verification scenarios of this change's interfaces; do not derive all business paths in full
- **Identify only independent call paths between interfaces**: interface A's output is consumed by interface B. Interface A internally calling B and C is A's implementation detail and does not count as a change-path verification scenario
- When neither the technical design nor the local pack finds a downstream consumer, mark "pending human confirmation"; do not invent
- When the downstream consumer is pure frontend display (for example order-detail page display), still annotate it — frontend display is a verification means, but the trigger source is the backend interface
- Take the owning module from the changed interface's owning module in the Stage 1 interface-object inventory; do not infer it from the downstream interface name
- Each output scenario path must first land as one test scenario in the Stage 4 scenario table, associated with the TO of that changed interface; after Stage 4-1 audit correction, mark the trigger source type as "scenario path". If the downstream interface belongs to another module, still assign it to the changed interface's owning module; the downstream interface is only a verification step on the scenario path and does not associate a TO across modules

---

## Six-dimension impact analysis

### 1. Function-impact-chain analysis

- Upstream entry → downstream consumption → parallel dependencies
- Risk label: `cascade-failure risk`
- Output: function call-path diagram + cascade-failure scenario inventory + client-type annotation (server/web/app/unknown)

### 2. Data-impact-domain analysis

- Data producer → consumer → transform node (ETL/sync/heterogeneous)
- Risk label: `data-consistency risk`
- Output: data-lineage diagram + consistency Verification point inventory + client-type annotation (only when the impact point can land on a concrete hosting end)

### 3. Interface-impact-surface analysis

- Caller inventory → provider dependencies → protocol change (field/type/enum)
- Risk label: `contract-break risk`
- Output: interface-contract change matrix + compatibility test strategy + terminal_type calibration result
- Fill an RPC interface's protocol type (Thrift/InternalRPC) only from the technical design or the optional local pack: when the Stage 1 protocol field is `---`, re-check testdocs/pack and fill on a hit; if still no hit, keep `---` and pass pending clarification; do not speculate

### 4. Config-impact-point analysis

- Global config (switches/thresholds/allowlists) → environment-config differences → tenant config
- Risk label: `config-drift risk`
- Output: config-item change inventory + environment-consistency verification plan

### 5. Performance/capacity semantic-impact analysis

- Batch, timeout, rate-limit, degrade, and similar constraints → whether they change the interface response, data state, or business-fallback result
- Risk label: `business-result-degradation risk`
- Output: business-result impact-point inventory; record only constraints that change server-side business results

### 6. Compatibility-impact analysis

- Historical-data compatibility → old-version clients → third-party dependencies
- Risk label: `compatibility-break risk`
- Output: compatibility test matrix (version × data state × client)

## Risk assessment and priority assignment

Based on six-dimension impact-analysis results, combine Stage 1 risk signals and perform joint risk assessment.

### Business-risk dimension

| Dimension | High-risk flags | Weight |
|------|---------|------|
| Business impact | Core transaction path, funds-related | 30% |
| Implied-function risk | Supporting functions missing, exception flows not covered | 20% |
| Rule-ambiguity risk | Multiple interpretations possible, subjective acceptance criteria | 15% |
| User scale | All users, high-frequency operations | 20% |
| Compliance requirements | Finance, healthcare, cross-border data | 15% |

### Technical-risk dimension

| Dimension | High-risk flags | Test response |
|------|---------|---------|
| Architecture complexity | First use, no production validation | Convert to a test scenario only when it affects a business path or interface result |
| Data risk | 10-million-plus table change | Historical-data compatibility and data-result verification |
| Concurrency risk | Shared-resource contention such as inventory / balance / coupon state | Business-result verification under concurrency conflict |
| Dependency risk | Downstream failure, timeout, or empty result would change this interface's semantics | Verification of return code, data state, and fallback result after a downstream exception |
| Performance risk | Timeout, batch, rate-limit, or degrade defines a business result | Interface-semantic verification after timeout / rate-limit / degrade |
| Compatibility risk | Incompatible change or multi-version coexistence affects consumer results | Contract compatibility and old-version business-result verification |

### Joint scoring and priority

**Risk score = business risk × 0.5 + technical risk × 0.5**

| Priority | Judgment standard | Test depth | Resource share |
|-------|---------|---------|---------|
| P0-blocking | Business high + technical high | Full coverage of the core business path + key-exception closed loop | 40% |
| P1-core | Business high or technical high | Standard coverage + key-path automation | 35% |
| P2-general | Business medium + technical medium | Scenario coverage + sample testing | 20% |
| P3-edge | Business low + technical low | Smoke verification | 5% |

> Non-functional technical risk is not directly equivalent to a Stage 4/5 obligation to generate a server-side main scenario. Only when performance, gray release, rollback, monitoring, circuit-breaking, and similar factors explicitly change the interface response, data state, business rule, or downstream consumption result do they enter server-side business-function test scenarios; content that belongs only to launch assurance, ops assurance, or capacity assurance does not output test scenarios in this period.

### High-risk items (TOP 5)

Identify the top 5 high-risk items; each item includes: risk description, source stage, risk type, business-function verification strategy.

### Ambiguity fallback plan

For each pending clarification item, make a fallback: ambiguity → risk assumption → fallback test strategy → suggested clarification deadline.

## Output format

Write the complete report to the single file `{run_dir}/testcase/testdocs/stage2-impact-and-risk-report.md`.

Output as Markdown with the following sections:

### [{project-name}] Impact-scope and risk analysis report

#### 1. Function impact chain
Upstream entry, downstream consumption, parallel dependencies; annotate cascade-failure risk.

#### 2. Data impact domain
Data producer, consumer, transform node; annotate consistency Verification points.

#### 3. Interface impact surface
Interface-contract change matrix (including interfaces extracted from the Stage 1 technical design + completed from the optional local pack); annotate compatibility risk level and information source.

#### 4. Config impact points
Config-item change inventory (including config extracted from the Stage 1 technical design + completed from the optional local pack); annotate environment differences and drift risk.

#### 5. Performance/capacity semantic impact
List only impact points such as batch, timeout, rate-limit, and degrade that change the interface response, data state, or business-fallback result; do not output pure load tests, capacity estimates, or monitoring alerts.

#### 6. Compatibility impact
Compatibility test matrix covering version × data state × client.

#### 7. Risk assessment and priority
Group test objects, risk level, test strategy, and resource allocation by P0-P3. Include high-risk items TOP 5 and the ambiguity fallback plan.

#### 8. Impact-scope summary
Summarize all impact points by risk level and annotate recommended test priority.

After Stage 2 persist, run `<skill_dir>/scripts/tcg-python <skill_dir>/scripts/close_stage.py --run-dir <userConfig.runDir> --stage 2` (redirect stdout only). If `ok` is false, do not enter Stage 3.
