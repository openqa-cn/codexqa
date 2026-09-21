# Output template and format norms

## Minimum persist (Stage 5)

- File: `{run_dir}/testdesign/test_design.md`
- Required headings: `Requirement materials` | `Test analysis` | `Test-plan detailed design` | `Test-scenario ID` | `Client type`
- This file is the only plan column/chapter authority

This file contains the Markdown output templates for the test plan and the case list. All local files are Markdown (the only edit source). This Skill does not upload to a case platform and does not write a doc platform; the HTML conversion rules below are for local typesetting reference only. Upload/sync boundaries: [plan-export-notes.md](plan-export-notes.md) and [case-export-notes.md](case-export-notes.md).

## Reading guide

Stage 5 uses only "I. Test plan". Read Section II HTML conversion only when the user explicitly asks for a local HTML export.

---
**Strictly enforce the following rules:**

# I. Test plan

## 1.1 Markdown output template

Integrate prior-stage results into one complete Markdown document. The only formal output file is `{run_dir}/testdesign/test_design.md`.

The following is the template structure (placeholders mark content that must be filled):

````markdown
# [project / requirement name] Test plan

## 1. Requirement materials

| Role | Members and assignments | Document URL |
|------|-----------|---------|
| PM | [PM name] | Project management: [project-management requirement link]<br>prd: [prd requirement link]<br>analytics-event ocean link: [ocean requirement link] |
| UI/UE | [designer name] | Design draft: [design-draft requirement link] |
| RD | Frontend: [frontend-dev name]<br>Backend: [backend-dev name] | [technical-design document link] |
| QA | Frontend test: [frontend-QA name]<br>Backend test: [backend-QA name] | |

---

## 2. Test analysis

### 2.1 Test focuses and difficulties

| Function category | Logic category | Test focuses and difficulties |
|---------|---------|--------------|
| | | |

### 2.2 Impact scope

| Module category | Test difficulties and impact analysis | Test strategy |
|---------|----------------|---------|
| | | |

### 2.3 Effective scope

| Config item | Detailed notes |
|-------|---------|
| Effective channel | |
| Effective version | |
| Tech stack | |
| Experiment | |
| **Config** | |

### 2.4 Pending clarifications and fallback plan

1. 

---

## 3. Test-plan detailed design

**Module**: [module name]

**Function**: [the function's original requirement description and original technical-implementation description]

1. The function's original requirement description and original technical-implementation description 1
2. The function's original requirement description and original technical-implementation description 2
3. The function's original requirement description and original technical-implementation description 3
4. The function's original requirement description and original technical-implementation description 4

**Images**: [corresponding images]

**Test scenarios:**

> Aggregate scenarios into this module by "related test object (TO) → TO owning module" from the Stage 4-1 audit-corrected report; do not infer module ownership from the test point or API name; each scenario is aggregated only once.
> Test-scenario IDs reuse the Stage 4-1 audit-corrected IDs; do not re-number; do not use Stage 4 original IDs or derived IDs.
> This table carries every scenario in the Stage 4-1 audit-corrected report; server-scenario trigger-source information has been written back to the same report; web/app scenario page-ownership information and diagram links have been written back to the same report; unknown scenarios keep client type and verification surface; related information may be filled as `---`.
> If the Stage 4-1 audit-corrected scenario has multiple sub-verification points, the Stage 5 plan table must keep the one-to-one correspondence between `1）2）3）` in Preconditions and `①②③` in Expected results; do not compress them into a wrap-up sentence or a matrix summary.

| Test-scenario ID | Test point | Priority | Priority basis | Scenario type | Client type | Coverage status | Preconditions | Expected results | Trigger-source information | Diagram link |
|-------|-------|---------|------------|---------|---------|---------|---------|------------|------------|---------|
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | |

**Preconditions / Expected results alignment requirements**:

- When the Stage 4-1 audit-corrected scenario contains multiple sub-verification points, the "Preconditions" in the Stage 5 plan table must be expanded numbered as `1）2）3）`.
- The same scenario's "Expected results" must be expanded as `①②③` corresponding to the Preconditions.
- Do not compress multiple sub-verification points into one wrap-up precondition or one wrap-up expected result.
- If the scenario itself has only one shared precondition and one verification point, numbering may be omitted.

## Server-side contract information summary

This chapter has no independent template; inherit as-is the entire "Server-side contract information summary" chapter at the end of the Stage 4-1 audit-corrected report (including the "five-way parameter classification" table, the contract-dimension table, the minimal identification-information format, the field-dimension table, and the fill rules). Inheritance terms are in [s05-plan-compose.md](s05-plan-compose.md) a-2; chapter structure and fill norms follow [s04a-design-audit.md](s04a-design-audit.md). Stage 5 must not add or delete columns, rewrite headers, or regenerate table content.

**Diagram-link column fill notes**: this column is a provenance-link column so a person can see the latest diagram of the page that corresponds to the scenario.

- **app/web scenarios**: fill the diagram link written back after the Stage 4-1 audit correction (the image URL registered in the Stage 1 business-diagram list); give only the URL, do not paste the original image; separate multiple hits with semicolons
- **server / unknown scenarios**: fill `---`; not applicable
- When Stage 4-1 did not hit a diagram, fill `---`; the corresponding gap was already registered as a TBD item by Stage 4-1; do not register it again here
- **Forbidden**: concatenating, rewriting, or truncating a URL; cropping a new link from an aggregated design-draft image; inventing any URL not registered in the Stage 1 business-diagram list

**Change-case notes:**

For scenarios whose coverage status is "change", supplement a concrete change suggestion:

1. **caseId: [id] — [case name]**: existing content covers [summary]; needs to modify [concrete change content, against which point in the requirements / technical design].

**Trigger-source information column fill notes**: server scenarios fill information already present in the Stage 1 API / technical-object list, Stage 4-1 audit fill-in results, and the Stage 2 report; app/web scenarios fill page-ownership information already present in the Stage 1 analytics-event / UI content list, requirement-document page descriptions, design drafts / page screenshots, Stage 2 page-hosting information, and the optional local-pack function map. Each type's fixed structure is as follows (separate with semicolons inside the table):

| Trigger-source type | Fixed fields | Fill-format example |
|-----------|---------|-------------|
| RPC | type; protocol; serviceId; class; method; params; auth | `RPC; protocol: Thrift; serviceId: com.xxx.api; class: com.xxx.ActivityService; method: createActivity; params: {"name": "", "type": 0}; auth: no auth required` (protocol value is Thrift/InternalRPC, sourced from the Stage 1 API-object list or testdocs / optional local pack; if it cannot be confirmed fill `protocol: ---` and register a TBD item; do not infer) |
| HTTP | type; serviceId; url; method; request params; auth | `HTTP; serviceId: com.xxx.api; url: https://xxx.com/api/activity/create; method: POST; params: {"name": "", "type": 0}; auth: Header carries access token` |
| MQ | type; topic; consume group; consumer serviceId; message body; auth | `MQ; topic: activity.created; consume group: ---; consumer serviceId: com.xxx.consumer; message body: {"activityId": 0, "status": 0}; auth: ---` |
| JobScheduler | type; job name; serviceId | `JobScheduler; job: activitySyncTask; serviceId: com.xxx.api` |
| ConfigCenter | type; serviceId; key; meaning | `ConfigCenter; serviceId: com.xxx.api; key: activity.switch; meaning: controls the activity switch` |
| Page ownership (app/web) | type; page; page path / route; entry; action controls; page-level permission / visibility; page-level verification focuses | `Page ownership; page: activity detail page; route: /activity/detail; entry: click in the activity list; action controls: claim button; page-level permission / visibility: visible after login; page-level verification focuses: button grays after claim` |
| Scenario chain | In step order, each step contains complete trigger-source information (same format as a single API), connected with →; if the original text or Stage 2 already made the inter-step parameter-pass relationship explicit, append `param pass:`; if not explicit fill `param pass: ---` | `Step 1: RPC; protocol: Thrift; serviceId: com.xxx.api; class: com.xxx.OrderService; method: createOrder; params: {"userId": 0}; auth: no auth required → Step 2: RPC; protocol: InternalRPC; serviceId: com.xxx.pay; class: com.xxx.PayService; method: payCallback; params: {"orderId": 0}; auth: ---; param pass: Step 1.response.orderId -> Step 2.request.orderId` |

> **Two sources of a scenario chain**: ① multi-step trigger inside a feature point ② Stage 2 change-chain verification scenarios (changed API → downstream verification API, carrying verification focuses)

**Fill requirements**:
- Fill only information already present in Stage 1, Stage 2, Stage 4-1 audit-corrected results, and the optional local pack; do not invent; do not infer
- When a field is missing, fill the `---` placeholder, meaning a human must intervene to complete it (do not leave it blank and do not omit the field name)
- **Server trigger-source request parameters must be a legal JSON object template**; prefer writing confirmed stable common parameters or fixed technical values into field values; do not invent concrete values for business-semantic parameters, test-data parameters, or dependency-result backfill parameters; keep only empty placeholders by type (int/long→`0`, string→`""`, boolean→`false`, object→`{}`, array→`[]`); `---` does not enter a JSON value position; do not write it as a `{field-name:type}` summary format
- Expand nested objects into legal JSON: `"settleInfo": {"sqtInvoiceTag": 0}` rather than `"settleInfo": {sqtInvoiceTag:int}`
- When the field's internal structure is unknown, use `{}` as a placeholder; do not invent
- When parameters are empty (a no-arg method), fill `{}`
- Do not mark dynamic / fixed (Stage 1 has no such distinction)
- A scenario chain only records a cross-API parameter-pass relationship already explicit in the original text or Stage 2; when it is not explicit, fill `param pass: ---`; do not guess from field names
- Do not write verification means (DB query, cache read) in this column; write them in the "Expected results" column, e.g. `API returns code=0; DB: activity table status=1`
- **Every step in a scenario chain must contain complete trigger-source information** (RPC: type; protocol; serviceId; class; method; params; HTTP: type; serviceId; url; method; params); do not write only the API name; keep already-explicit parameter-pass relationships as well
- **app/web scenarios**, besides page ownership, must still keep client type, verification surface, and page-level key entries; fill `---` when page ownership cannot be found
- Server trigger-source write-back rules are detailed in [s04a-design-audit.md](s04a-design-audit.md)
````

## 1.2 Test-plan trimming rules

- If it is a pure API test, omit UI-related test points and interaction-experience analysis
- If the user only needs a certain stage's output, output only the corresponding chapters
- If the requirement is simple (a single feature point), chapters may be merged and the output slimmed
- Keep placeholders for information not provided in the requirement-materials table; do not invent

## 1.3 Test-plan format-selection principles

- **Use a table**: structured list data (requirement materials, function objects, API objects, analytics-event objects, test scenarios); a table is clearer when there are ≥3 columns and many items
- **Use prose / lists**: analytical content (impact scope, risk assessment, high-risk items, pending-clarification items); this content is about description and explanation, so prose paragraphs or numbered lists are easier to read
- **Trim flexibly**: if a chapter has only 1-2 items, prefer prose over a table

## 1.4 Test-plan template structure notes

The template uses the team's standard three-part structure and maps pipeline analysis results to the corresponding chapters: Chapter 1 "Requirement materials" comes from what the user provided and Stage 1, and contains roles, member assignments, and document links; Chapter 2 "Requirement analysis" comes from Stage 1+2, and contains pre-dependencies, effective channel, version, tech stack, experiment, and configuration; Chapter 3 "Test-plan detailed design" follows the Stage 4-1 audit-corrected test design; server-scenario trigger-source information has been written back to the same report; the test-scenario summary integrates Stage 3 existing-case coverage status.

---

# II. ProseMirror HTML conversion rules (optional local HTML export; not used for a case platform)

# Markdown-to-ProseMirror HTML conversion rules

When converting a local Markdown file to ProseMirror HTML, you must follow the following mapping rules and constraints.

## ProseMirror HTML tag-mapping rules

When generating HTML you must strictly follow the following mapping so that format is correct after paste into a ProseMirror-supporting editor:

### Block-node mapping

| Node type | HTML tag | Notes |
|---|---|---|
| paragraph | `<p>` | Paragraph |
| heading | `<h1>` ~ `<h5>` | Heading; level corresponds to 1-5 |
| bullet_list | `<ul>` | Unordered list |
| ordered_list | `<ol>` | Ordered list |
| list_item | `<li>` | List item; wrap inner content in `<p>` |
| blockquote | `<blockquote>` | Block quote |
| horizontal_rule | `<hr>` | Horizontal rule |
| table | `<table>` | Table |
| table_row | `<tr>` | Table row |
| table_header | `<th>` | Header cell |
| table_cell | `<td>` | Table cell |
| code_block | `<pre><code>` | Code block |

### Inline-mark mapping

| mark type | HTML tag | Notes |
|---|---|---|
| strong | `<strong>` | Bold |
| em | `<em>` | Italic |
| underline | `<u>` | Underline |
| strikethrough | `<s>` or `<del>` | Strikethrough |
| color | `<span style="color: #xxx">` | Text color |
| backgroundcolor | `<span style="background-color: #xxx">` | Background color |

### Key constraints

1. A table must contain a complete `<table><tr><th>...</th></tr><tr><td>...</td></tr></table>` structure
2. Text inside a list item `<li>` must be wrapped in `<p>`
3. Headings only support h1-h5; do not use h6
4. Do not use `<thead>` / `<tbody>` / `<tfoot>`; the target editor does not recognize these tags
5. Do not use `<br>` for line breaks; use a new `<p>` paragraph instead
6. A table cell may nest block elements such as `<p>`, `<ul>`, `<ol>`
7. Use semantic tags: `<strong>` rather than `<b>`, `<em>` rather than `<i>`

---

## HTML conversion reference template

When converting a Markdown file to ProseMirror HTML, refer to the following HTML structure. After conversion, save as `{run_dir}/testdesign/test_design.html`; the file content contains only the HTML fragment inside the body.

The following is the HTML template structure (showing the HTML output corresponding to each Markdown element):

```html
<h1>[project / requirement name] Test plan</h1>

<h2>1. Requirement materials</h2>
<table border="1">
  <thead>
    <tr>
      <th width="50">Role</th>
      <th width="262">Members and assignments</th>
      <th width="522">Document URL</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>PM</td>
      <td>[PM name]</td>
      <td>
        Project management: [project-management requirement link]<br>
        prd: [prd requirement link]<br>
        analytics-event ocean link: [ocean requirement link]
      </td>
    </tr>
    <tr>
      <td>UI/UE</td>
      <td>[designer name]</td>
      <td>Design draft: [design-draft requirement link]</td>
    </tr>
    <tr>
      <td>RD</td>
      <td>
        Frontend: [frontend-dev name]<br>
        Backend: [backend-dev name]
      </td>
      <td>[technical-design document link]</td>
    </tr>
    <tr>
      <td>QA</td>
      <td>
        Frontend test: [frontend-QA name]<br>
        Backend test: [backend-QA name]
      </td>
      <td></td>
    </tr>
  </tbody>
</table>

<h2>2. Test analysis</h2>

<h3>2.1 Test focuses and difficulties</h3>
<table border="1">
  <thead>
    <tr>
      <th width="205">Function category</th>
      <th width="145">Logic category</th>
      <th width="500">Test focuses and difficulties</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h3>2.2 Impact scope</h3>
<table border="1">
  <thead>
    <tr>
      <th width="205">Module category</th>
      <th width="350">Test difficulties and impact analysis</th>
      <th width="500">Test strategy</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h3>2.3 Effective scope</h3>
<table border="1">
  <thead>
    <tr>
      <th width="145">Config item</th>
      <th width="500">Detailed notes</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Effective channel</td>
      <td></td>
    </tr>
    <tr>
      <td>Effective version</td>
      <td></td>
    </tr>
    <tr>
      <td>Tech stack</td>
      <td></td>
    </tr>
    <tr>
      <td>Experiment</td>
      <td></td>
    </tr>
    <tr>
      <td><strong>Config</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>

<h4>2.4 Pending clarifications and fallback plan</h4>
<p>1.</p>

<h2>3. Test-plan detailed design</h2>
<p><strong>Module</strong>: [module name]</p>
<p><strong>Function</strong>: [the function's original requirement description and original technical-implementation description]</p>
<p>1) The function's original requirement description and original technical-implementation description 1</p>
<p>2) The function's original requirement description and original technical-implementation description 2</p>
<p>3) The function's original requirement description and original technical-implementation description 3</p>
<p>4) The function's original requirement description and original technical-implementation description 4</p>
<p><strong>Images</strong>: [corresponding images]</p>
<p><strong>Test scenarios:</strong></p>
<p>Aggregate scenarios into this module by "related test object (TO) → TO owning module" from the Stage 4-1 audit-corrected report; do not infer module ownership from the test point or API name; each scenario is aggregated only once.</p>
<p>Test-scenario IDs reuse the Stage 4-1 audit-corrected IDs; do not re-number; do not use Stage 4 original IDs or derived IDs.</p>
<p>This table carries every scenario in the Stage 4-1 audit-corrected report; server-scenario trigger-source information has been written back to the same report; web/app scenario page-ownership information and diagram links have been written back to the same report; unknown scenarios keep client type and verification surface; related information may be filled as <code>---</code>.</p>
<p>If the Stage 4-1 audit-corrected scenario has multiple sub-verification points, the Stage 5 plan table must keep the one-to-one correspondence between <code>1）2）3）</code> in Preconditions and <code>①②③</code> in Expected results; do not compress them into a wrap-up sentence or a matrix summary.</p>
<table border="1">
  <thead>
    <tr>
      <th width="80">Test-scenario ID</th>
      <th width="211">Test point</th>
      <th width="75">Priority</th>
      <th width="150">Priority basis</th>
      <th width="102">Scenario type</th>
      <th width="102">Client type</th>
      <th width="107">Coverage status</th>
      <th width="371">Preconditions</th>
      <th width="413">Expected results</th>
      <th width="200">Trigger-source information</th>
      <th width="120">Diagram link</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>
<p><strong>Diagram-link column fill notes:</strong> this column is a provenance-link column. app/web scenarios fill the diagram link written back after the Stage 4-1 audit correction (the image URL registered in the Stage 1 business-diagram list); give only the URL, do not paste the original image; separate multiple hits with semicolons; server / unknown scenarios fill <code>---</code>; when not hit fill <code>---</code>; do not concatenate, rewrite, or truncate a URL; do not crop a new link from an aggregated design-draft image; do not invent any URL not registered in the Stage 1 business-diagram list.</p>
<p><strong>Preconditions / Expected results alignment requirements:</strong></p>
<ul>
  <li><p>When the Stage 4-1 audit-corrected scenario contains multiple sub-verification points, the "Preconditions" in the Stage 5 plan table must be expanded numbered as <code>1）2）3）</code>.</p></li>
  <li><p>The same scenario's "Expected results" must be expanded as <code>①②③</code> corresponding to the Preconditions.</p></li>
  <li><p>Do not compress multiple sub-verification points into one wrap-up precondition or one wrap-up expected result.</p></li>
  <li><p>If the scenario itself has only one shared precondition and one verification point, numbering may be omitted.</p></li>
</ul>

<h2>Server-side contract information summary</h2>
<p>This chapter's content is generated by converting the Stage 4-1 contract summary inherited as-is at the matching position in the Markdown template: tables follow the table rules in this file's "II. ProseMirror HTML conversion rules"; chapter structure and fill norms follow s04a-design-audit.md; Stage 5 must not add or delete columns or rewrite headers.</p>

<p><strong>Change-case notes:</strong></p>
<p>For scenarios whose coverage status is "change", supplement a concrete change suggestion:</p>
<ol>
  <li><p><strong>caseId: [id] — [case name]</strong>: existing content covers [summary]; needs to modify [concrete change content, against which point in the requirements / technical design].</p></li>
</ol>
```

## Markdown-to-HTML conversion notes

1. **Table structure**: do not use `<thead>`/`<tbody>`/`<tfoot>`; use the flat `<table><tr><th>...<td>...` structure directly. The first row uses `<th>` as the header; subsequent rows use `<td>`.
2. **Cell content**: text inside every `<th>` and `<td>` must be wrapped in a `<p>` tag; this is a ProseMirror requirement (the content rule of table_cell/table_header is `block+`).
3. **List-item content**: text inside `<li>` must also be wrapped in a `<p>` tag (the content rule of list_item is `(paragraph | block)+`).
4. **Do not use self-closing tags**: except `<hr>`, every tag uses a complete open/close pair.
5. **Text emphasis**: use `<strong>` for bold, `<em>` for italic, `<u>` for underline, `<s>` for strikethrough.
6. **Heading levels**: the document title uses `<h1>`, chapters use `<h2>`, sections use `<h3>`, subsections use `<h4>`, the deepest uses `<h5>`.
7. **Paragraph separation**: separate chapters with `<hr>`; use independent `<p>` tags between paragraphs; do not use `<br>`.
8. **Priority highlight**: P0 uses `<span style="color: #FF0000"><strong>P0</strong></span>` (red bold); P1 uses `<span style="color: #FF8C00"><strong>P1</strong></span>` (orange bold); P2 uses ordinary text; P3 uses `<span style="color: #999999">P3</span>` (gray).
9. **Risk-level highlight**: high risk uses `<span style="color: #FF0000">High</span>`; medium risk uses `<span style="color: #FF8C00">Medium</span>`; low risk stays ordinary text.
10. **Output file**: save as a `.html` file; the file content contains only the HTML fragment inside the body (no outer structure such as `<!DOCTYPE>`, `<html>`, `<head>`), so it can be copied and pasted into an editor directly.
