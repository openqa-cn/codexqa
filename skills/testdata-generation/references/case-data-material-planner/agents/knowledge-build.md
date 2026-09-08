# agents/knowledge-build

> Host launches this Agent only when `pipeline.ts` exits **12** (Path A). After the patch is written, the host runs `merge_patch.ts` then `pipeline.ts --resume`. This file is the Agent's sole execution spec.

## Role

Read the requirements document and technical design, and produce a structured **business knowledge graph** (business-context.json) that later parse-case / `select_tool.ts` / `invoke_entity.ts` / `bind_action.ts` can use for business-context disambiguation.

> **Core principle**: this Agent produces "an understanding of the business domain", **not** a data checklist. Do not output "what data to prepare"; only output "what this business domain looks like".

## Input

The Task prompt carries:
- `manifest`: absolute path to manifest.json
- `prdContent`: requirements-document content (already read by the host; use directly; may be null)
- `techDesignContent`: technical-design content (already read by the host; use directly; may be null)
- `changeApis`: changed-API list JSON (obtained by the host via api-catalog; may be null)

## Output spec

**Write two files**:
1. `business-context.json` (**parent directory** of the manifest directory, i.e. `case-materials/` level, shared across cases)
2. `patches/knowledge-build.all.patch.json`

Patch format:
```jsonc
{
  "agent": "knowledge-build",
  "targetType": "meta",
  "targetId": "all",
  "timestamp": "<ISO8601>",
  "fields": {
    "businessContext": "<absolute path to business-context.json>"
  }
}
```

**Must not write**:
- `pipelines.*` (`pipeline.ts` owns these)
- `entities[]` / `actions[]` (parse-case-only)
- `confirmations[]` (host / C3 only)

---

## Task details

### 1. Confirm input content

Use `prdContent` / `techDesignContent` / `changeApis` from the Task prompt directly.

- `prdContent` is null → skip requirements understanding; process only the technical design
- `techDesignContent` is null → infer configMap and systemDependencies from requirements and mark `"inferred": true`
- Both are null → should not happen (the host starts this Agent only when at least one is non-empty)

### 2. Structured understanding of requirements

Extract from the requirements document:
- Feature-point list (what it does, who uses it, in what scenario)
- Business rules (constraints, calculation logic, state transitions)
- Roles and permissions involved
- Business nouns and their meanings

### 3. Structured understanding of the technical design

Extract from the technical design:
- Services involved (serviceId list)
- API changes (new/changed APIs and their parameters)
- Data-model changes (table/field changes)
- Config changes (config-store / feature-flag experiments)
- Inter-system dependencies

### 4. Fill business-context.json

Fill the following 5 modules based on template `templates/business-context-template.json`:

---

#### Module 1: requirement (requirements summary)

```jsonc
{
  "name": "catalog night promo",
  "summary": "Between 18:00 and 06:00, automatically discount on-sale standard catalog products and show a promo badge on search and detail pages",
  "coreFlow": "user search → list (promo badge + discount) → detail (price explanation) → book",
  "affectedServices": ["catalog-marketing", "catalog-search", "catalog-detail", "catalog-pricing"]
}
```

- `summary`: 3–5 sentences covering what was built + the core mechanism
- `coreFlow`: main path, joined with →
- `affectedServices`: extract serviceId from the technical design

---

#### Module 2: glossary (business-noun table)

**This is the most critical module** — the core basis for parse-case disambiguation.

```jsonc
{
  "night promo": {
    "definition": "an automatic discount marketing campaign applied to on-sale standard catalog products between 18:00 and 06:00 the next day",
    "prerequisites": [
      "product is listed (status=on-sale)",
      "feature flag catalog.nightPromo.enable = true",
      "product is enrolled in the promo campaign via the marketing API",
      "campaign config is active for the current time window"
    ],
    "relatedEntities": ["product", "standard catalog product", "promo campaign config"],
    "relatedConfigs": [
      {"key": "catalog.nightPromo.enable", "serviceId": "catalog-marketing", "description": "promo master switch"},
      {"key": "catalog.nightPromo.cities", "serviceId": "catalog-marketing", "description": "canary city list"}
    ]
  },
  "price explanation tag": {
    "definition": "the 'X% lower than usual' tag shown on list/detail pages, computed from the gap between daytime average price and the current price",
    "prerequisites": [
      "gap between the product current price and daytime average price ≥ 5%",
      "tag offline refresh completed (T+1 or manual trigger; takes effect in about 30min)"
    ],
    "relatedEntities": ["discounted product", "tag refresh task"],
    "relatedConfigs": [
      {"key": "catalog.priceTag.threshold", "serviceId": "catalog-pricing", "description": "minimum price-gap ratio to show the tag"}
    ]
  }
}
```

**glossary writing rules**:
- The key is the original business noun as it may appear in requirements/cases
- `definition`: one-sentence explanation, enough for someone unfamiliar with the business to understand
- `prerequisites`: what must already be true for this concept to "exist" — parse-case expands entities from this
- `relatedEntities`: involved business entity types — parse-case generates entities from these
- `relatedConfigs`: involved config items — parse-case generates config-class entities from these
- Include only nouns that **need explanation** (domain-specific concepts); do not include generic words ("order", "user" need no explanation)

---

#### Module 3: entityGraph (entity relationship graph)

```jsonc
{
  "product": {
    "fields": ["productId", "cityId", "status", "businessStatus"],
    "states": ["creating", "opened", "closed", "offline"],
    "upstream": [],
    "downstream": ["standard catalog product", "limited catalog product", "supplier"]
  },
  "standard catalog product": {
    "fields": ["productId", "skuId", "basePrice", "status"],
    "states": ["pending review", "on-sale", "delisted", "deleted"],
    "upstream": ["product", "sku"],
    "downstream": ["campaign enrollment", "price record"]
  },
  "promo campaign config": {
    "fields": ["activityId", "activityName", "startTime", "endTime", "discountRule"],
    "states": ["not started", "in progress", "ended"],
    "upstream": [],
    "downstream": ["campaign enrollment"]
  }
}
```

**entityGraph writing rules**:
- The key is the entity-type name (English), corresponding to glossary.relatedEntities
- `fields`: core field names of the entity (parse-case pre-fills entity.fields keys from these)
- `states`: all states in the state machine (parse-case uses these to understand what field value "a completed order" implies)
- `upstream`/`downstream`: dependency direction (parse-case auto-fills entity.dependencies from these)

---

#### Module 4: configMap (configuration map)

```jsonc
{
  "catalog.nightPromo.enable": {
    "serviceId": "catalog-marketing",
    "env": "test",
    "default": "false",
    "description": "night promo master switch; false disables all promo logic"
  },
  "catalog.nightPromo.cities": {
    "serviceId": "catalog-marketing",
    "env": "test",
    "default": "[]",
    "description": "canary city ID list; empty = effective for all cities"
  }
}
```

**configMap writing rules**:
- Extract all config-store / feature-flag config changes from the technical design
- Annotate serviceId and environment so `generate_config_commands.ts` / invoke has precise information when constructing config-class entities
- `default` is the current default value, not the target value

---

#### Module 5: systemDependencies (system dependencies)

```jsonc
{
  "tag refresh": {
    "type": "offline-task",
    "service": "catalog-tag-refresh",
    "interface": "/internal/trigger-refresh",
    "latency": "takes effect in about 30min",
    "description": "T+1 offline refresh or manual trigger; refreshes the product price-tag index"
  },
  "price calculation": {
    "type": "realtime",
    "service": "catalog-pricing",
    "interface": "/api/price/calculate",
    "latency": "realtime",
    "description": "computes the final display price in realtime from product base price + campaign discount"
  },
  "campaign enrollment": {
    "type": "realtime",
    "service": "catalog-marketing",
    "interface": "/api/activity/enroll",
    "latency": "realtime",
    "description": "enrollment API for a product joining a marketing campaign"
  }
}
```

**systemDependencies writing rules**:
- `type`: `realtime` (callable via an API directly) / `offline-task` (offline job; must wait for effect) / `external` (external system; must be mocked)
- `select_tool.ts` / `bind_action.ts` use this to judge operation feasibility and search direction
- Write a concrete path in `interface` whenever possible to make action queries more precise

---

### 5. Completeness self-check

After filling, self-check:
- [ ] Does glossary cover every non-generic business noun in the requirements?
- [ ] Are upstream/downstream relations of every entity in entityGraph closed?
- [ ] Does configMap cover every config change in the technical design?
- [ ] Do systemDependencies cover every system behavior that is not a direct frontend operation?

### 6. Write to disk and exit

1. Use the Write tool to write `business-context.json` to the **parent directory** of the manifest directory (i.e. `case-materials/` level, shared by all cases under the same requirement)
2. Use the Write tool to write `patches/knowledge-build.all.patch.json` (patches directory is sibling to the manifest)
3. Response text reports: glossary entry count / entityGraph node count / configMap entry count / systemDependencies entry count

---

## Handling insufficient information

| Situation | Handling |
|---|---|
| Requirements document only, no technical design | Infer configMap and systemDependencies from requirements and mark `"inferred": true` |
| API information in the technical design is vague | Write null for systemDependencies.interface; put known information in description |
| A business noun's meaning cannot be determined from the documents | Write "meaning to be confirmed" for that glossary entry's definition; leave prerequisites empty |
| changeApis is null | Does not affect the main flow; extract API information from the technical-design text |

**Principle**: when information is insufficient, produce an incomplete context (something is better than nothing); do not error-stop because of missing information.

---

## Common pitfalls

- Do not write "data that needs to be prepared" into context — that is parse-case's job. context only describes "what the business looks like"
- Do not put every noun into glossary — only domain-specific business concepts whose meaning is unknown without the documents
- entityGraph fields list only core fields (5–10), not the full table schema
- configMap includes only configs involved in this requirement change, not every config of the service
- systemDependencies include only "system behaviors that may appear in operation steps", not every inter-system call in the architecture
