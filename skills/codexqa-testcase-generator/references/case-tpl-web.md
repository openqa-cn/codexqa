# Case-list Markdown output template (Web)

## Reading guide

First read the mandatory rules and the case-structure table at the top, then fill by step type. Stage 6 chooses this template per [s06-case-write.md](s06-case-write.md).

**Strictly enforce the following rules:**

1. The case list is generated and edited locally in Markdown format and is the **only edit source** of the cases. This Skill does not upload to a case platform.
2. (Mandatory)<br> means a line break.
---

## 1. Overall norms

| Standard | Description |
| --- | --- |
| **Requirement coverage** | **[New-function coverage]** Feature-point coverage: every feature point described in the PRD or technical Spec has a corresponding case; branch and state coverage: every condition branch (including state-machine judgment logic) must have a case; scenario coverage: besides single-function scatter cases, there must be business-chain serial cases (including upstream/downstream interaction linkage)<br><br>**[Historical-function coverage]** When existing functions are actually impacted, you must add regression coverage |
| **Risk coverage** | *Note: specialized tests such as performance load-test, reliability disaster recovery, and stability long-run are not included in this dimension*<br><br>**[Financial-loss safety]** (applies when amount calculation / refund / discount stacking / settlement is involved):<br>- Amount correctness: amount calculation / allocation / lock / display at any flow node must be correct, and multi-party views must be consistent<br>- State consistency: funds operations (pay / refund / settle) and business-state (order / fulfillment / split) changes must stay in sync<br>- Loss-prevention and tamper-prevention: prevent duplicate / tamper / privilege-escalation / arbitrage; every operation has a complete audit trail<br><br>**[Content and permission safety]** (applies when user-data query / operation-permission checks are involved):<br>- Authentication (auth): verify the requester's identity is legitimate<br>- Authorization: an authenticated user's operation permission on the target resource; prevent horizontal privilege-escalation (cross-user / cross-org access) and vertical privilege-escalation (a low-permission user performs a high-permission action)<br>- Data protection: sensitive information in the response is masked or encrypted per rules<br><br>**[Historical-data compatibility]** (applies when introducing a new field / data-structure change / migrating existing data):<br>- Field-level compatibility: when a newly added field is missing in existing data, do not error; handle it by the default rule<br>- Structure-level compatibility: values of existing data under the old structure can still be correctly read and processed by the new logic<br>- Migration correctness: after existing data is migrated, there is no loss / misalignment / tamper<br>- Degrade behavior: when existing data does not meet a new condition, the system degrades gracefully rather than blocking an existing function<br><br>**[Browser / hardware / version compatibility]** (applies when a new UI component / new interaction / or a new CSS/JS feature is used):<br>- Browser compatibility: page render and interaction behavior are consistent on the target browser matrix (Chrome / Safari / Firefox / Edge)<br>- Resolution compatibility: page layout does not shift and elements do not overlap in the target resolution range (1920×1080 / 1366×768 / mobile adaptation)<br>- Version compatibility: when a page involved in this change is still accessed on an old version, you must verify the old version does not error and core functions remain available |
| **Organization norms** | **[Case dedup]** Judgment rules:<br>a. Three elements fully duplicate (object under test + trigger condition + Expected results) → keep only one<br>b. Mergeable cases (object under test + trigger condition are the same; Expected results differ) → merge into one<br>c. Inclusion-relationship duplicate (A's three elements fully contain B) → B is a duplicate; keep only A<br>Judgment Priority: a → c → b<br><br>**[Organization structure]** Cases are grouped by business functional module (leaf nodes); module names come from this requirement and the optional local knowledge pack; the WEB end only accepts scenarios whose final client-type decision is web |

---

## 2. Output structure (Web special format)

The Web end uses an **standalone case file + index file** output structure and does not generate a large-table file.

### 2.1 Directory structure

```
{run_dir}/testcase/initialcase/testcase_web/
├── testcase_web_index.md          # index file (contains statistics, existing-case associations, directory structure)
└── testcases/                         # case-file directory
    ├── {case-ID1}-{case-name1}.md
    ├── {case-ID2}-{case-name2}.md
    └── ...
```

### 2.2 Index-file format

The index file `testcase_web_index.md` is the Web end's only summary file and contains:

```markdown
# [project / requirement name] Web case index

> Generated at (current time): [YYYY-MM-DD HH:mm:ss]
> Related test plan: [test-plan filename]
> Project: [project-name] (local only)
> Total cases: [N] cases

---

## Existing-case association list

This Skill does not recall remote existing cases; the table below should be empty or marked as no existing cases:

| caseId | Case name | Association type | Notes |
|--------|---------|---------|------|
| [id] | [case name] | reuse | [reuse directly, no modification needed] |
| [id] | [case name] | change | [notes on content that needs modification] |

> When no existing case needs association, mark "No existing case needs association".

---

## Directory structure

The following is the **local** directory organization of the cases. Mark all as [New]; do not fill a remote nodeId.

```
[root-directory name]
├── [directory-1 name][Existing](nodeId: [id])
│   ├── [subdirectory-1-1 name][New]→ parent node: [parent-node id]
│   └── [subdirectory-1-2 name][Existing](nodeId: [id])
├── [directory-2 name][New]→ parent node: [parent-node id]
│   └── [subdirectory-2-1 name][New]→ parent node: [upper newly created directory name]
└── [directory-3 name][Existing](nodeId: [id])
```

---

## Statistics

### Basic statistics

| Statistic | Count |
|--------|------|
| Total directory nodes | [X] items (existing [Y] + new [Z]) |
| Total cases | [N] cases |
| Existing associated cases | [M] cases (reuse [a] + change [b]) |
| New cases | [K] cases |
| Enhanced cases | [ ] cases |

### Priority distribution

| Priority | Count | Share |
|--------|------|------|
| P0 | [n] cases | [x]% |
| P1 | [n] cases | [x]% |
| P2 | [n] cases | [x]% |
| P3 | [n] cases | [x]% |

### Requirement coverage

| Coverage dimension | Total | Covered | Coverage |
|----------|------|--------|--------|
| Feature points | [n] items | [m] items | [x]% |
| Branches / states | [n] items | [m] items | [x]% |
| Business-chain cases | - | [n] cases | - |
| Historical regression cases | - | [n] cases or no regression needed |

### Risk coverage

> Mark business scenarios that are not involved as "not involved"; do not force 0.

| Risk dimension | Status | Case count |
|----------|------|--------|
| Content and permission safety (auth / privilege-escalation / data protection) | ✅ involved / not involved | [n] or - |
| Historical-data compatibility (field compatibility / migration correctness / degrade) | ✅ involved / not involved | [n] or - |
| Browser / hardware / version compatibility (browser matrix / resolution / old version) | ✅ involved / not involved | [n] or - |

### Case-type distribution

#### By test dimension

| Dimension | Count | Notes |
|------|------|------|
| UI | [n] cases | Page display, layout, style verification |
| Interaction | [n] cases | User-action response, animation verification |
| Logic | [n] cases | Business rules, state transition, data-calculation verification |
| Flow | [n] cases | Cross-page business-flow verification |
| Analytics | [n] cases | Data analytics-event trigger and field check |

### Functional-module distribution

| Functional module | Case count |
|----------|--------|
| [module-name A] | [n] cases |
| [module-name B] | [n] cases |
| ... | ... |

---

## Case index

| Case ID | Remark | Case name | Functional module | Priority | Case type | Preconditions | Generated at | Updated at | File path |
|--------|----------|---------|----------|--------|----------|----------|----------|----------|----------|
| {case-ID1} | {remark or empty} | {case-name1} | {functional-module1} | P0 | [New][UI] | {complete Preconditions, consistent with the standalone case file} | [second-level timestamp] | [second-level timestamp] | testcases/{case-ID1}-{case-name1}.md |
| {case-ID2} | {remark or empty} | {case-name2} | {functional-module2} | P1 | [New][Interaction] | {complete Preconditions, consistent with the standalone case file} | [second-level timestamp] | [second-level timestamp] | testcases/{case-ID2}-{case-name2}.md |
```

### 2.3 Standalone case file

Save each case as an independent `.md` file; field norms follow the **3.2 Field norms** chapter.

> ⚠️ **Important**:
> - **Do not write a "Priority" field** (pass it via the upload API parameter)
> - All summary information (statistics, directory, existing-case associations) is in the index file

---

## 3. Fill rules (Meta basic-information norms)

### 3.1 Overall principles

- **Completeness**: every test case must have every basic-information field complete; none may be missing.
- **Verifiability**:
  - Operation steps: every step must correspond to one Expected-results item; if a case has 5 operation steps, it must have 5 Expected-results items.
  - Expected results must be precise to a checkable object, e.g. page-display content, API return code, return field, database field; do not use vague descriptions that cannot be verified on the ground. Ban vague words such as "normal" "correct" "no exception" "as expected".
- **Reusability**: test cases should be classified by business functional module, so later regression, change analysis, and automation construction can keep reusing them.

### 3.2 Field norms

| Field | Norm requirements |
| --- | --- |
| **Case ID** | - Principle: globally unique identifier.<br>- Format: {runid} + current datetime timestamp + 3-digit random |
| **Functional module** | - Principle: split by business function down to the smallest functional unit.<br>- Module names come from this requirement and the optional local knowledge pack; all are leaf nodes.<br>- **Format: page-module**<br><br>*Correct examples*: "search-guide page-recommended words", "checkout page-submit button"<br>*Wrong examples*: "search-function phase-2 rebuild", "requirement cases"<br><br>**Note: the functional-module field value is the directory name in the directory structure** |
| **Case type** | Format: [regression mark]+[dimension]<br><br>- **Regression-mark enum**: New, Change, Regression<br>- **Dimension enum**: UI, Interaction, Logic, Flow, Analytics<br><br>*Examples*:<br>- [New][UI]<br>- [Change][Interaction]<br>- [Regression][Logic]<br>- [New][Flow]<br>- [New][Analytics] |
| **Case name** | **Principle:** dimension, page-module, and verification-goal description are clear; the title does not exceed 150 characters.<br><br>**Format:** `[dimension-test type][page-module] scenario (optional) + verification-goal description`; the dimension enum is `[UI]` `[Interaction]` `[Logic]` `[Flow]` `[Analytics]`<br><br>**Dimension description:**<br>\| Dimension \| Notes \|<br>\| --- \| --- \|<br>\| UI \| Page display, layout, style \|<br>\| Interaction \| User-action response, gesture, animation \|<br>\| Logic \| Business rules, state transition, data calculation \|<br>\| Flow \| Cross-page business flow \|<br>\| Analytics \| Data analytics-event trigger and field check \|<br><br>**Test-type description:** Positive, Negative, Exception, Boundary, Auth, Privilege-escalation, Financial-loss safety, Content safety, Performance, Reliability<br><br>*Examples*:<br>- [UI-Positive] [search-guide page-recommended words] When there is no search history, verify default recommended words are displayed<br>- [Interaction-Boundary] [checkout page-submit button] When the network is abnormal, verify clicking retry resubmits the order<br>- [Logic-Negative] [checkout page-order] When inventory is zero, verify the add-to-cart button is disabled and prompts "Sold out"<br>- [Flow] [search-place order] Full-chain verification from searching a merchant through entering the store, adding a product, entering the checkout page, and submitting the order<br>- [Analytics] checkout page-payment method-credit pay_click (bid=b_biz_4srskiyd_mc) |
| **Preconditions** | **Execution-environment description:**<br>- environment ID: {environment-ID value}<br>- End: WEB client description + login method e.g.: log in to the merchant-backend PC [https://merchant.test.example.com/dining](https://merchant.test.example.com/dining), account password xx/xx<br>- For the above, if they cannot be obtained at case-generation time, use the "TBD" placeholder.<br><br>**Data-dependency description:**<br>1）**State business constraints clearly**: in natural language write what the object is, what state it is in, and what business conditions it meets<br>> *Correct example*: Product A is listed, sellable, inventory sufficient; order O1 is paid and not yet fulfilled<br>> *Wrong example*: Product A status is normal; order O1 is fully ready and can be tested normally<br><br>2）**Reject vague words; write until it is "decidable"**: "normal, available, has a coupon, configured" must be replaced with: object type + key state + amount / quantity / boundary value. Do not chase field-level precision<br>> *Correct example*: User U1 has claimed one platform coupon C1 of spend-100-off-20; the coupon is currently valid and applies to product A; product A price is 100 yuan, buy 1<br>> *Wrong example*: User U1 has a coupon; product price is normal; the spend-threshold is met<br><br>3）**A qualified single-object description ≠ a hit**: multi-object scenarios must explicitly write inter-object relations (ownership, applicability, association)<br>> *Correct example*: Coupon C1 applies only to product A, not to product B; product A and product B both belong to store S1; account M1 is bound to store S1 and has manage permission<br>> *Wrong example*: Prepare coupon C1; prepare two sellable products A and B; prepare one merchant account M1<br><br>4）**Write data together in Preconditions; steps write only actions**: advance dependent prior-state data such as "construct an order in YY state through the default XX flow"; do not mix the test-data setup process into the operation steps<br>> *Correct example*: Preconditions: through the default place-order-and-pay flow, construct an order O1 that belongs to store S1 and is in paid-not-yet-fulfilled state (the ordered product may be a default sellable product; it does not affect this case)<br>> Steps: 1. User U1 initiates cancel on order O1<br>> *Wrong example*: Steps: 1. Create order; 2. Pay order; 3. Query order status; 4. Cancel order<br><br>5）**Structured data dependency (common to all types)**: describe each data item as "object meaning + key attributes + existence purpose"; do not directly list raw database fields or API-return JSON<br><br>6）**Client-type constraint**: the WEB template only accepts scenarios whose final client-type decision is web; server/app/unknown scenarios do not enter this template |
| **Priority** | Inherit the corresponding scenario's Priority from the **upstream test plan** (that value comes from the Stage 4-1 audit-corrected final Priority); when one case merges multiple scenarios, take the highest Priority (P0 > P1 > P2 > P3). Reuse / change existing cases keep the original Priority of the existing case recalled in Stage 3; do not re-adjudicate. Stage 6 must not re-adjudicate or override P0-P3.<br><br>**If the upstream did not provide Priority, use the following default rules:**<br>- P0: core main chain, financial-loss / safety / compliance related, wide impact; any change must regress<br>- P1: high-frequency functions, important business rules, involving key nodes of the main flow<br>- P2: ordinary functions, boundary and exception scenarios<br>- P3: low-frequency functions, experience optimization, style details, analytics-event related |
| **UI image** | The expected image link of the page corresponding to the case, sourced from the test-plan scenario table's "diagram link" column (the business-diagram provenance link written back by Stage 4-1; Stage 6 inherits it character for character with no processing); fill `---` when the scenario did not hit; do not search or invent a URL yourself |
| **Ambiguity clarification** | Describe information that was unclear during case generation<br>E.g.: path / click-position and other characteristic information the user needs to provide; mark it explicitly in the operation steps |
| **Provenance** | - xx file (filename), line xx (the line number where the provenance content is)<br>- Content excerpt (excerpt of the original content, within 30 characters) |

### 3.3 Operation-step and assertion norms

Web cases use **UI action** as the primary execution type; operation-step and assertion norms are as follows:

| Execution type | Operation-step norms | Assertion norms |
| --- | --- | --- |
| **UI action** | Describe page actions in execution order, step by step.<br><br>**Principles:**<br>- One action per step; the first step writes the starting PC entry page.<br>- Steps are complete; do not skip steps; the user can execute them directly.<br>- When the user needs to provide gap information, mark it in the operation steps.<br>- If a page action involves an API dispatch, describe the related API<br>- If a page action involves persist, state transition, etc., describe the database operation<br><br>**Format:**<br>Operation step = action verb + page or region + element + content (optional)<br>Where:<br>- Action verbs: fixed as open / click / double-click / right-click / hover / input / clear / keypress / select / check / scroll / drag / upload / download / handle dialog / switch tab / refresh / back / switch account / check; do not invent your own<br>- Page or region: represents where, system › page › region<br>- Element: a page element, e.g. the "Add to cart" button<br><br>**An HTTP API step must write clearly:**<br>- Type (request method, limited to **GET / POST**)<br>- URL (full request path)<br>- Input structure (field name + value type or enum value; when referenced across steps, mark the source step)<br>If they cannot be obtained, use the "TBD" placeholder<br><br>⚠️ **Do not appear Thrift / RPC / internal-call types**; Web cases only verify HTTP APIs<br><br>**A data operation must write clearly:**<br>- Database connection: database cluster, database name, table name<br>- SQL statement: a complete query or write statement; represent condition parameters with the placeholder ?; do not write a concrete business value<br>- Write multiple DB queries as multiple steps; do not merge them into one step<br>If they cannot be obtained, use the "TBD" placeholder | Describe the observable, decidable business behavior after each step.<br><br>**Format:**<br>Expected results = observed object + concrete value / copy / status<br>The observed object may be page display, a DB table-field result, or an API return result.<br><br>**Principles:**<br>- Each step must have a corresponding expectation.<br>- The expectation must be fully verifiable, with a concrete value, copy, or status; ban vague words such as "normal" "correct" "no exception" "as expected".<br>- For a page Expected-results item, there must be an explicit page-display requirement. Including but not limited to: the identity mark after login, the visible mark that the page is ready, the page returned to, the visible state after refresh, the page of a new tab, the visible change after click, the visible change, the menu or prompt that appears, the content that appears, the visible mark that upload or download completed, the state after a dialog closes<br><br>**API-return Expected-results format:**<br>- Return code: write the expected absolute value; for a success scenario code = 0; for a failure scenario write the concrete error code and business meaning<br>- State enum: write the expected absolute value; do not replace an enum value with a semantic description<br>- Business value: write a logical-relation expression (e.g. payableAmount = product price - discount amount); when comparing across steps, declare it explicitly<br><br>**Database-return Expected-results format:**<br>- The specified field value matches the expected logical relation (e.g. account = write-off amount × rebate ratio)<br>- Write enums as absolute values (e.g. settlement_status = SETTLED)<br>- Query-result count matches the expectation (count = expected count)<br>- A cross-step compare must explicitly declare the compare relation (e.g. step1.payableAmount = step2.payableAmount)<br><br>**Examples:**<br>\| **#** \| **Step** \| **Expected results** \|<br>\| --- \| --- \| --- \|<br>\| 3 \| Click the first merchant card in Home-merchant list ❓*what is the stably clickable element name of the product card* \| Enter the store page; the product list shows product cards \|<br>\| 4 \| Click the store page-promo-coupon product "Add to cart" button \| The cart badge count changes to "1" \|<br>\| 5 \| Click the store page-bottom "Cart" entry \| Enter the cart overlay *❓what is the cart's fixed characteristic information* \|<br>\| 6 \| Wait for the product card to appear in the cart overlay \| The product card upper-left shows a "Promo" tag; the card shows the selected spec and the combo-subproduct price area shows the discounted price, original price, and strikethrough price; the add-to-cart button is a rounded icon and shows counter "1" \|<br>\| 7 \| Click the cart overlay-product card "Add to cart" button \| The product quantity changes to "2"; above the price area a "Not combinable with other discounts" tag is shown, directly above the discounted price \|<br><br>**API / data step examples:**<br>\| **#** \| **Step** \| **Expected results** \|<br>\| --- \| --- \| --- \|<br>\| 4 \| Click the checkout page-"Submit order" button \| The page navigates to the order-success page and shows the "Order submitted successfully" copy and the order number \|<br>\| 5 \| HTTP API call (triggered by step 4):<br>- Type: POST<br>- URL: https://biz.web.example.com/api/v1/order/create<br>- Input structure: {"storeId":"long（store S1's storeId）"},"addressId":"long（address A1's addressId confirmed in step 3）"} | API returns code = 0; data.orderStatus = CREATED (enum absolute value); data.payableAmount = 3500 (unit: fen); cross-step compare: data.payableAmount ÷ 100 = the payable amount shown on the page in step 2 \|<br>\| 6 \| Data query:<br>- Database connection: order DB (cluster: TBD), database name: order_db, table name: order_info<br>- SQL: SELECT order_id, order_status FROM order_info WHERE user_id = ? AND store_id = ? | Database query result count = 1; order_status = CREATED; cross-step compare: order_id = data.orderId returned by step 5 |

---

## 5. Other fill rules

### Existing-case association list

- Extract every scenario whose coverage status is "reuse" and "change" from the test plan's "Test scenarios"
- Extract the caseId from them, dedup, and fill the table
- Association type: reuse (use directly), change (needs modification)
- Notes column: for reuse write "reuse directly, no modification needed"; for change write the concrete content that needs modification

### Directory structure

- Group local directories from the Stage 4 scenario table; do not use a remote nodeId
- From the case's functional-module ownership, judge whether a new directory node needs to be created
- The judgment standard for creating a directory is in the "Directory-ownership judgment" of [s06-case-write.md](s06-case-write.md)
- Draw the tree with characters such as `├──`, `└──`, `│`
- **The functional-module field value is the directory name**

---

## 6. Output format

### 6.1 Standalone case file

When generating cases, **create an independent `.md` file directly for each case**.

- **File path:** `{run_dir}/testcase/initialcase/testcase_web/testcases/{case-ID}-{case-name}.md`
- **Naming rule:** `{case-ID}-{case-name}.md` (the case name may be truncated to the first 50 characters, to avoid an overlong filename)
- **Field norms:** strictly follow the **3.2 Field norms** chapter
- ⚠️ **Do not write a "Priority" field** (pass it via the upload API parameter)

**File format:**

```markdown
# {case name} (e.g.: [UI-Positive][checkout page-delivery fee] When the address is inside the delivery range, verify the delivery fee displays correctly)

> Case ID: {case ID} (e.g.: demo-web-20260903001)
> Functional module: {functional module} (e.g.: delivery-fee display)
> Case type: {case type} (e.g.: [New][UI])
> Generated at: [YYYY-MM-DD HH:mm:ss] (e.g.: 2026-09-03 10:00:00)
> Updated at: [YYYY-MM-DD HH:mm:ss] (e.g.: 2026-09-03 10:00:00)

## Preconditions

**Execution-environment description**
- environment ID: {environment-ID value} (e.g.: TBD)
- End: {WEB client description} + login method (e.g.: log in to the merchant-backend PC https://merchant.test.example.com/dining, account password TBD)

**Data-dependency description**
1）{data-dependency item 1} (e.g.: store S1 is open; the delivery range covers address A1 (3 km from the store); the delivery-fee rate is 5 yuan)
2）{data-dependency item 2} (e.g.: user U1 has selected store S1; the cart has added product G1 (price 30 yuan, sellable, inventory 100); U1 is bound to store S1)

## Operation steps and Expected results (put steps and Expected results in one table, left-right corresponding)

| # | Step | Expected results |
|---|------|---------|
| 1 | Open a browser, visit the merchant-backend PC https://merchant.test.example.com/dining, and log in with account password xx/xx | Enter the merchant-backend home; the merchant data overview is shown |
| 2 | Click the left menu-"Order management", then click the "Order list" entry | Enter the order-list page; the order data table is shown |
| 3 | Double-click the row whose order status is "Pending payment" and open the order-detail dialog | The dialog shows the complete order information, including product details and amount information |
| 4 | HTTP API call (triggered by step 3):<br>- Type: POST<br>- URL: https://merchant.test.example.com/api/v1/order/create<br>- Input structure: {"storeId":"long（store S1's storeId）","addressId":"long（address A1's addressId）"} | API returns code = 0; data.orderStatus = CREATED (enum absolute value); data.payableAmount = 3500 (unit: fen) |
| 5 | Data query:<br>- Database connection: merchant-backend order DB (cluster: TBD), database name: ecom_order, table name: order_info<br>- SQL: SELECT order_id, order_status, payable_amount FROM order_info WHERE user_id = ? AND store_id = ? | Database query result count = 1; order_status = CREATED; payable_amount = 3500; cross-step compare: payable_amount = data.payableAmount returned by step 4 |
| 6 | Close the order-detail dialog | The dialog closes; return to the order-list page; the order status is still "Pending payment" |
| 7 | Wait for the store page to finish loading (if there is an analytics-event scenario) | **Report timing**: report PV on first enter of the merchant page; do not report MV on pull-to-refresh<br>**Report parameters**: store_id is consistent with the store/info API return; store_type is fixed "retail_store" |

## UI image

{scenario-table diagram link, sourced from the test plan "diagram link" column, inherited character for character; fill --- when not hit} (e.g.: https://docs.example.com/api/file/cdn/2783551353/253193639345)

## Ambiguity clarification

{ambiguity description} (e.g.: ❓what is the clickable-element characteristic name of address A1 on the address-list page)

## Provenance

- {provenance information} (e.g.: norms document §3 requirement-coverage example, line 1)
```

### 6.2 Index file

**File path:** `{run_dir}/testcase/initialcase/testcase_web/testcase_web_index.md`

**File format:**

```markdown
# Web case index

> Generated at (current time): [YYYY-MM-DD HH:mm:ss]
> Total cases: [N] cases
> Related test plan: [test-plan filename]

## Index

| Case ID | Remark | Case name | Functional module | Priority | Case type | Preconditions | Generated at | Updated at | File path |
|--------|----------|---------|----------|--------|----------|----------|----------|----------|----------|
| {case-ID1} | {remark or empty} | {case-name1} | {functional-module1} | P0 | [New][UI] | {must stay consistent with the Preconditions of the standalone case file} | [second-level timestamp] | [second-level timestamp] | testcases/{case-ID1}-{case-name1}.md |
| {case-ID2} | {remark or empty} | {case-name2} | {functional-module2} | P1 | [New][Interaction] | {must stay consistent with the Preconditions of the standalone case file} | [second-level timestamp] | [second-level timestamp] | testcases/{case-ID2}-{case-name2}.md |
```

**Field notes:**

| Field | Notes |
|------|------|
| Case ID | Locally generated unique identifier (runid + timestamp + random) |
| Remark | Backfilled after upload to the case platform; empty when not uploaded |
| Case name | The complete case title |
| Functional module | Owning functional module (corresponding local directory) |
| Priority | P0/P1/P2/P3 |
| Case type | E.g. [New][UI] |
| Preconditions | Complete Preconditions (execution-environment description + data-dependency description), consistent with the standalone case file |
| Generated at | Unix second-level timestamp (first generation) |
| Updated at | Unix second-level timestamp (last update) |
| File path | File path relative to the testcase_web directory |
