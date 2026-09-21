# Case-list Markdown output template (server)

**Strictly enforce the following rules:**

1. The case list is generated and edited locally in Markdown format and is the **only edit source** of the cases. This Skill does not upload to a case platform.
2. (Mandatory)<br> means a line break.
---

## 1. (Mandatory) Overall norms

| Standard | Description |
| --- | --- |
| **Requirement coverage** | **[New-function coverage]** Feature-point coverage: every feature point described in the PRD or technical Spec has a corresponding case; branch and state coverage: every condition branch (including state-machine judgment logic) must have a case; scenario coverage: besides single-function scatter cases, there must be business-chain serial cases (including upstream/downstream interaction linkage)<br><br>**[Historical-function coverage]** When existing functions are actually impacted, you must add regression coverage |
| **Risk coverage** | *Note: specialized tests such as performance load-test, reliability disaster recovery, and stability long-run are not included in this dimension*<br><br>**[Financial-loss safety]** (applies when amount calculation / refund / discount stacking / settlement is involved):<br>- Amount correctness: amount calculation / allocation / lock / display at any flow node must be correct, and multi-party views must be consistent<br>- State consistency: funds operations (pay / refund / settle) and business-state (order / fulfillment / split) changes must stay in sync<br>- Loss-prevention and tamper-prevention: prevent duplicate / tamper / privilege-escalation / arbitrage; every operation has a complete audit trail<br><br>**[Content and permission safety]** (applies when user-data query / operation-permission checks are involved):<br>- Authentication (auth): verify the requester's identity is legitimate<br>- Authorization: an authenticated user's operation permission on the target resource; prevent horizontal privilege-escalation (cross-user / cross-org access) and vertical privilege-escalation (a low-permission user performs a high-permission action)<br>- Data protection: sensitive information in the response is masked or encrypted per rules<br><br>**[Concurrency and timing]** (applies when the same resource is operated concurrently):<br>- Isolation: concurrent operations do not interfere; intermediate states are not visible; the final result does not depend on arrival order<br>- Consistency: after concurrency completes, all related data-source states align<br>- Idempotency: repeating the same request produces the effect only once<br><br>**[Historical-data compatibility]** (applies when introducing a new field / data-structure change / migrating existing data):<br>- Field-level compatibility: when a newly added field is missing in existing data, do not error; handle it by the default rule<br>- Structure-level compatibility: values of existing data under the old structure can still be correctly read and processed by the new logic<br>- Migration correctness: after existing data is migrated, there is no loss / misalignment / tamper<br>- Degrade behavior: when existing data does not meet a new condition, the system degrades gracefully rather than blocking an existing function |
| **Organization norms** | **[Case dedup]** Judgment rules:<br>a. Three elements fully duplicate (object under test + trigger condition + Expected results) → keep only one<br>b. Mergeable cases (object under test + trigger condition are the same; Expected results differ) → merge into one<br>c. Inclusion-relationship duplicate (A's three elements fully contain B) → B is a duplicate; keep only A<br>Judgment Priority: a → c → b<br><br>**[Organization structure]** Cases are grouped by business functional module (leaf nodes); module names come from this requirement and the optional local knowledge pack; the server end only accepts scenarios whose final client-type decision is server |

---

## 2. Markdown template structure

Save to the user's working directory; filename format: `testcase_srv.md`.

````markdown
# [project / requirement name] Case list

> Generated at (current time): [YYYY-MM-DD HH:mm]
> Related test plan: [test-plan filename]
> Project: [project-name] (local only)

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

> Directory structure is determined by the functional-module ownership of the Stage 4 scenario table; all are newly created locally.

---

## Case details

> ⚠️ **Note**: the table below is the local Markdown storage format and is the only edit source. This Skill does not upload to a case platform.

| Case ID | Functional module | Case name | Preconditions | Operation steps | Expected results | Priority | Case type | Provenance |
|--------|---------|---------|--------|---------|---------|--------|--------|------|
| {runid}-[millisecond timestamp (must differ per case)+3-digit random] | [functional-module name] | [Function-Positive][API HTTP] - Place an order with a coupon successfully | **Environment dependency:** environment ID, domain<br><br>**Data dependency:**<br>1）The user is logged in; account status is normal<br>2）The user owns an available coupon; coupon status is unused<br>3）The cart contains qualifying products | 1. Execute the place-order API<br>**serviceId:** com.example.xxx<br>**Type:** POST<br>**URL:** https://api.test.example.com/api/order/create<br>**Input structure:** { ... }<br><br>2. Record the returned orderId | **API return:**<br>1. Return code=0<br>2. Return orderId (e.g. 123456789)<br><br>**Database check:**<br>1. A new record is added in the order table, status=1<br>2. The coupon_usage table records that the coupon has been used | P0 | [New][Function-Positive][API-HTTP] | PRD line 10: place-order main flow |
| {runid}-[millisecond timestamp (must differ per case)+3-digit random] | [functional-module name] | [Function-Negative][API Thrift] - Place-order fails when the order amount is 0 | **Environment dependency:** environment ID, domain<br><br>**Data dependency:**<br>1）The user is logged in<br>2）The total amount of products in the cart is 0 | 1. Execute the place-order API<br>**serviceId:** com.example.xxx<br>**Interface:** OrderService<br>**Method:** createOrder<br>**Input structure:** { ... } | **API return:**<br>1. Return code=1001 (illegal parameter)<br>2. Return errorMsg="Order amount cannot be 0" | P1 | [New][Function-Negative][API-Thrift] | Technical Spec line 25: amount-validation logic |

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
| Financial-loss safety (amount correctness / state consistency / loss-prevention and tamper-prevention) | ✅ involved / not involved | [n] or - |
| Content and permission safety (auth / privilege-escalation / data protection) | ✅ involved / not involved | [n] or - |
| Concurrency and timing (isolation / consistency / idempotency) | ✅ involved / not involved | [n] or - |
| Historical-data compatibility (field compatibility / migration correctness / degrade) | ✅ involved / not involved | [n] or - |

### Case-type distribution

#### By test type

| Type | Count |
|------|------|
| Function-Positive | [n] cases |
| Function-Negative | [n] cases |
| Function-Boundary | [n] cases |
| Function-Exception | [n] cases |
| Security-Auth | [n] cases or not involved |
| Security-Privilege-escalation | [n] cases or not involved |
| Security-Financial-loss safety | [n] cases or not involved |
| Security-Content safety | [n] cases or not involved |
| Performance | [n] cases or not involved |
| Reliability | [n] cases or not involved |

#### By execution type

| Execution type | Count |
|----------|------|
| API(HTTP) | [n] cases |
| API(Thrift) | [n] cases or not involved |
| API(InternalRPC) | [n] cases or not involved |
| MQ | [n] cases or not involved |
| DB | [n] cases or not involved |
| Config(ConfigCenter) | [n] cases or not involved |
| Cache(Redis/DistCache/CacheCluster) | [n] cases or not involved |
| Scheduled job(JobScheduler) | [n] cases or not involved |
| Combined verification | [n] cases or not involved |

### Functional-module distribution

| Functional module | Case count |
|----------|--------|
| [module-name A] | [n] cases |
| [module-name B] | [n] cases |
| ... | ... |

````

---

## 3. Fill rules (Meta basic-information norms)

### 3.1 Overall principles

- **Completeness**: every test case must have every basic-information field complete; none may be missing.
- **Verifiability**:
  - Operation steps: every step must correspond to one Expected-results item; if a case has 5 operation steps, it must have 5 Expected-results items.
  - Expected results must be precise to a checkable object, e.g. API return code, return field, database field, message status, downstream-call result; do not use vague descriptions that cannot be verified on the ground.
- **Reusability**: test cases should be classified by service capability or business domain, so later regression, change analysis, and automation construction can keep reusing them.

### (Mandatory) 3.2 Field norms
| Field | Norm requirements |
| --- | --- |
| **Case ID** | - Principle: globally unique identifier.<br>- Format: {runid} + current datetime timestamp + 3-digit random |
| **Functional module** | - Cases are grouped by the business functional module<br>- Module names come from this requirement and the optional local knowledge pack; all are leaf nodes<br><br>*Correct examples*: "private-room info", "store home"<br>*Wrong examples*: "store-home phase-2 rebuild", "requirement cases"<br><br>**Note: the functional-module field value is the directory name in the directory structure** |
| **Case type** | Format: [regression mark]+[test type]+[execution type]<br><br>- **Regression-mark enum**: New, Change, Regression<br>- **Test-type enum**: Function (Positive, Negative, Exception, Boundary), Security (Auth, Privilege-escalation, Financial-loss safety, Content safety), Performance, Reliability<br>- **Execution-type enum**: API (Http, Thrift, InternalRPC), MQ, DB, Config (ConfigCenter), Cache, Scheduled job, Combined verification (a combination of the types above)<br><br>*Examples*:<br>- [New][Function-Positive][API-HTTP]<br>- [Regression][Function-Positive][API-InternalRPC]<br>- [New][Security-Privilege-escalation][API-HTTP]<br>- [New][Reliability][Combined verification] |
| **Case name** | **Principle:** the title needs a structured & patterned description that can clearly point out the object under test and briefly and accurately summarize the test scenario, test goal, and Expected results.<br><br>**Format:** `[case type - execution type] - action-expected result`<br><br>*Examples*:<br>- [Function-Positive][API HTTP] - Place an order with a coupon successfully<br>- [Function-Negative][API Thrift] - Place-order fails when the order amount is 0<br>- [Security-Privilege-escalation][API HTTP] - Merchant A carrying merchant B's store ID to query the order list returns no permission<br>- [Reliability][Combined verification] - When the payment callback times out the order enters pending-confirm status and has a retry mechanism |
| **Preconditions** | **Environment dependency:** environment ID, domain: if they cannot be obtained at case-generation time, use the "TBD" placeholder.<br><br>**Data dependency:**<br>1）**State business constraints clearly**: in natural language write what the object is, what state it is in, and what business conditions it meets<br>> *Correct example*: Product A is listed, sellable, inventory sufficient; order O1 is paid and not yet fulfilled<br>> *Wrong example*: Product A status is normal; order O1 is fully ready and can be tested normally<br><br>2）**Reject vague words; write until it is "decidable"**: "normal, available, has a coupon, configured" must be replaced with: object type + key state + amount / quantity / boundary value. Do not chase field-level precision<br>> *Correct example*: User U1 has claimed one platform coupon C1 of spend-100-off-20; the coupon is currently valid and applies to product A; product A price is 100 yuan, buy 1<br>> *Wrong example*: User U1 has a coupon; product price is normal; the spend-threshold is met<br><br>3）**A qualified single-object description ≠ a hit**: multi-object scenarios must explicitly write inter-object relations (ownership, applicability, association)<br>> *Correct example*: Coupon C1 applies only to product A, not to product B; product A and product B both belong to store S1; account M1 is bound to store S1 and has manage permission<br>> *Wrong example*: Prepare coupon C1; prepare two sellable products A and B; prepare one merchant account M1<br><br>4）**Write data together in Preconditions; steps write only actions**: advance dependent prior-state data such as "construct an order in YY state through the default XX flow"; do not mix the test-data setup process into the operation steps<br>> *Correct example*: Preconditions: through the default place-order-and-pay flow, construct an order O1 that belongs to store S1 and is in paid-not-yet-fulfilled state (the ordered product may be a default sellable product; it does not affect this case)<br>> Steps: 1. User U1 initiates cancel on order O1<br>> *Wrong example*: Steps: 1. Create order; 2. Pay order; 3. Query order status; 4. Cancel order<br><br>5）**Structured data dependency (common to all types)**: describe each data item as "object meaning + key attributes + existence purpose"; do not directly list raw database fields or API-return JSON<br><br>6）**Client-type constraint**: server cases only accept scenarios whose final client-type decision is server; web/app/unknown scenarios do not enter this template |
| **Priority** | A new case inherits the Priority of the corresponding scenario in the Stage 5 test plan; that value comes from the Stage 4-1 audit-corrected final Priority; when one case merges multiple scenarios, take the highest Priority (P0 > P1 > P2 > P3). Reuse / change existing cases keep the original Priority of the existing case recalled in Stage 3; do not re-adjudicate. Stage 6 must not re-adjudicate or override P0-P3. |
| **Provenance** | - xx file (filename), line xx (the line number where the provenance content is)<br>- Content excerpt (excerpt of the original content, within 30 characters) |

### (Mandatory) 3.3 Operation-step and assertion norms

Classify and constrain operation steps and assertion methods by execution type, covering the following seven types:
API (Http, Thrift, InternalRPC), MQ, DB, Config (ConfigCenter), Cache, Scheduled job, Combined verification (a combination of the types above)
One case has multiple steps; one step has at least one Expected-results item; correspondence is mandatory.

| Execution type | Operation-step norms | Assertion norms |
| --- | --- | --- |
| **API(HTTP)** | An HTTP API step must write the following clearly:<br>- **serviceId** (service identifier)<br>- **Auth method**: if it cannot be obtained at case-generation time, use the "TBD" placeholder<br>- **Type** (request method, enum: GET / POST / PUT / DELETE / PATCH)<br>- **URL** (full request path)<br>- **Input structure** (field name + value type or enum value; when referenced across steps, mark the source step)<br><br>**Input-structure fill rules (mandatory):**<br>1）**Do not guess or infer and fill an actual value**: do not invent a concrete business ID, number, or other actual value in the request parameters (e.g. `"storeId":282`, `"userId":12345`). Describe them with a type annotation + Preconditions reference (e.g. `"storeId":"String（S1, description: store ID）"`, `"userId":"String（U1, description: user ID）"`).<br>2）**Fill enum values directly and list them in full**: if the parameter is an enum type and the test plan has already made the enum-value definition explicit, choose the matching enum value for the case purpose and fill it directly, and list every optional enum value in parentheses (e.g. `orderType="TAKEOUT"（enum: TAKEOUT, DINE_IN）`, `payMethod="WECHAT"（enum: WECHAT, ZFB, APPLE_PAY）`).<br>3）**Field-meaning description**: each parameter must annotate the field meaning after the value (e.g. `"storeId":"String（S1, description: store ID）"`), so the parameter's use is understandable. **API assertion** against the API return must describe the expected value field by field per the following rules:<br>- **Return code**: write the expected absolute value; for a success scenario make `code = 0` explicit; for a failure scenario write the concrete error code and business meaning; do not generalize as `code ≠ 0`<br>- **State enum**: write the expected absolute value; do not replace an enum value with a semantic description<br>- **Business calculated value**: write a logical-relation expression, using the concrete data in Preconditions as the calculation base (e.g. `payableAmount = product price - discount amount`)<br><br>**Database assertion** for any scenario that involves data persist, you must make the following explicit:<br>- **DB/table information**: database cluster, database name, table name; "TBD" placeholder is allowed when they cannot be obtained<br>- **Field expectation**: write each checked field's expected enum value or logical-relation expression; do not replace it with a vague conclusion such as "data written successfully" |
| **API(Thrift/InternalRPC)** | The step must write the following clearly:<br>- **Protocol** (Thrift / InternalRPC, sourced from the trigger-source `protocol:` field; it decides the third segment of the case type and the automation-script call channel; if it cannot be confirmed, fill `---` and register TBD; do not default to Thrift)<br>- **serviceId** (service identifier)<br>- **Interface** (fully qualified interface name)<br>- **Method** (method name)<br>- **Input structure** (field name + value type or enum value; when referenced across steps, mark the source step)<br><br>**Input-structure fill rules (mandatory):**<br>1）**Do not guess or infer and fill an actual value**: do not invent a concrete business ID, number, or other actual value in the request parameters (e.g. `"storeId":282`, `"userId":12345`). Describe them with a type annotation + Preconditions reference (e.g. `"storeId":"String（S1, description: store ID）"`, `"userId":"String（U1, description: user ID）"`).<br>2）**Fill enum values directly and list them in full**: if the parameter is an enum type and the test plan has already made the enum-value definition explicit, choose the matching enum value for the case purpose and fill it directly, and list every optional enum value in parentheses (e.g. `orderType="TAKEOUT"（enum: TAKEOUT, DINE_IN）`, `payMethod="WECHAT"（enum: WECHAT, ZFB, APPLE_PAY）`).<br>3）**Field-meaning description**: each parameter must annotate the field meaning after the value (e.g. `"storeId":"String（S1, description: store ID）"`), so the parameter's use is understandable. | **Same assertion method as API(HTTP)** |
| **DB** | When the case involves persist, state transition, data calculation, etc., you must write clearly:<br>- **Database connection**: database cluster, database name, table name ("TBD" placeholder is allowed when they cannot be obtained)<br>- **SQL statement**: a complete query or write statement; represent condition parameters with the placeholder ?; do not write a concrete business value<br>- Write multiple DB queries as multiple steps; do not merge them into one step | **Data assertion**<br>- The specified field's value matches the expected logical relation (e.g. account = write-off amount × rebate ratio)<br>- Write enums as absolute values (e.g. settlement_status=SETTLED)<br>- Query-result count matches the expectation (count = expected count)<br>- Cross-step compare: you must explicitly declare the compare relation (e.g. step1.payableAmount = step2.payableAmount) |
| **MQ** | When the case involves sending a message to implement an operation step, you must write clearly:<br>- Topic<br>- Message-body structure | **MQ assertion** - MQ push succeeded<br><br>**Other assertions** - judge from the business capability the MQ implements, and assert on data, APIs, etc. |
| **Scheduled job** | When the case involves executing a scheduled job to implement an operation step, you must write clearly:<br>- JobScheduler job name<br>- Job execution parameters | **JobScheduler assertion**<br>- Status enum: SUCCESS / FAILED (you must write the failure reason)<br><br>**Other assertions** - from the business capability the scheduled job drives, assert on the database, API, or cache, and verify the business effect after the job runs |
| **ConfigCenter** | If the ConfigCenter value changed or newly added in this change should change, you must write clearly:<br>- **serviceId** (the service the config belongs to)<br>- **Config Key**, **Value** (the value after the change)<br>- **Business meaning** (one-sentence note)<br>- **Change type** (enum: add config / modify config / delete config) | **Config assertion**<br>- ConfigCenter value change took effect / did not take effect (you must write the reason)<br>- Assert on data, APIs, etc. from the business capability the config change affects |
| **Cache** | From the feature point, describe the following clearly:<br>- **Cache type** (enum: Redis / DistCache / CacheCluster / local cache)<br>- **Operation type** (enum: write / read / update / delete)<br>- **Key** (full Key format)<br>- **Trigger method** (fill on write / update / delete; enum: API-call trigger / scheduled-job trigger / direct cache operation)<br>- Write multiple cache operations as multiple steps; do not merge them into one step | **Cache assertion**<br>Write: a direct cache query of the value matches the expected logical relation<br>Read: verify the cache hits correctly per business rules<br>Update: a direct cache query of the value has been updated to the expected logical relation<br>Delete: a direct cache query confirms the Key has been cleared<br><br>**Consistency assertion:** when the cache value must be consistent with the database value, you must explicitly declare the compare relation (e.g. cache value = DB.available_stock) |
| **Combined verification** | From the feature point, describe the operation steps clearly per the following rules:<br>- Each step must be an atomic action, numbered continuously in actual execution order; operations of different execution types must not be merged into the same step<br>- Each step must mark the execution type at the start of the step (HTTP / Thrift / InternalRPC / MQ / DB / ConfigCenter / Cache / Scheduled job) and strictly follow that execution type's step-writing norms<br>- Inter-step data passing must explicitly declare the dependency: which field returned by the previous step is which input of the next step; do not replace it with a vague phrase such as "use the previous step's result"<br>- All prior data must be constructed in the Preconditions phase; operation steps must not mix in any test-data setup action | - Each step must have a corresponding assertion; steps and assertions correspond one-to-one<br>- Assertion type matches the step's execution type (API assertion, database assertion, cache assertion, etc.); the norms match each execution type's assertion norms<br>- The last step must contain a terminal-state assertion that verifies the final data state of the business closed loop, not only the return value of an intermediate step |

---

## 4. Standard case Demo

| Case ID | Functional module | Case name | Preconditions | Operation steps | Expected results | Priority | Case type | Provenance |
|--------|---------|---------|--------|---------|---------|--------|--------|------|
| REQ001-20260819100000015 | Place order | [New][Function-Positive][Combined verification] - The user places an order with a spend-threshold coupon and pays successfully; full-chain verification of order-status change, inventory deduction, coupon-status change, and fulfillment notification | **Environment dependency:** environment ID TBD; auth: TBD<br><br>**Data dependency:**<br>1）User U1 has claimed one platform coupon C1 of spend-100-off-20; the coupon is currently valid and applies to product A<br>2）Product A price is 100 yuan, inventory is 10, belongs to store S1<br>3）Store S1 is within the delivery range | **Step 1 [API(HTTP)]** Execute the place-order API and create the order.<br>- **serviceId:** com.example.food.order.api<br>- **Type:** POST<br>- **Auth method:** TBD<br>- **URL:** TBD/api/order/create<br>- **Input structure:** {"userId":"String（U1, description: user ID）","storeId":"String（S1, description: store ID）","orderType":"TAKEOUT"（enum: TAKEOUT, DINE_IN）,"skuList":"List<Object>(skuId=product A,quantity=int)","couponId":"String（C1, description: coupon ID）"}<br><br>**Step 2 [API(THRIFT)]** Query order detail and verify the order-create result.<br>- **serviceId:** com.example.food.order.query<br>- **Interface:** OrderQueryService<br>- **Method:** getOrderDetail<br>- **Input structure:** {"orderId":"String（O6 returned by step 1, description: order ID）"}<br><br>**Step 3 [API(HTTP)]** Execute the pay API.<br>- **serviceId:** com.example.food.payment.api<br>- **Type:** POST<br>- **Auth method:** TBD<br>- **URL:** TBD/api/pay/submit<br>- **Input structure:** {"orderId":"String（O6 returned by step 1, description: order ID）","userId":"String（U1, description: user ID）","amount":"int（payableAmount returned by step 1, description: pay amount）","payMethod":"WECHAT"（enum: WECHAT, ZFB, APPLE_PAY）}<br><br>**Step 4 [DB]** Query order status.<br>- Connect to the database: TBD/order_db<br>- Execute SQL: SELECT order_status FROM order_info WHERE order_id = ?（O6 returned by step 1）<br><br>**Step 5 [DB]** Query the inventory-deduction result.<br>- Connect to the database: TBD/order_db<br>- Execute SQL: SELECT available_stock FROM sku_stock WHERE sku_id = ?（product A） AND store_id = ?（S1）<br><br>**Step 6 [Cache]** Direct-connect cache and query the inventory cache value.<br>- **Cache type:** Redis<br>- **Key:** stock:{storeId}:{skuId}<br>- **Operation type:** read<br><br>**Step 7 [API(InternalRPC)]** Verify the coupon status has changed.<br>- **serviceId:** com.example.coupon.service<br>- **Interface:** CouponQueryService<br>- **Method:** getCouponStatus<br>- **Input structure:** {"couponId":"String（C1, description: coupon ID）","userId":"String（U1, description: user ID）"}<br><br>**Step 8 [MQ]** Listen for the fulfillment-notification message.<br>- **Operation type:** listen and consume<br>- **Topic:** order.fulfillment.notify<br>- **Consume group:** fulfillment-consumer<br>- **Consumer serviceId:** com.example.fulfillment.service<br>- **Message-body structure:** {"orderId":"String","storeId":"String","status":"String","createTime":"long"} | **Step 1 expectation:**<br>1. Return code=0<br>2. Return orderId (record as O6, String)<br>3. Return payableAmount (int), value = product price - discount amount (use the product price and coupon face value in Preconditions)<br>4. Return deliveryFee (int), value calculated per the delivery-distance rule<br><br>**Step 2 expectation:**<br>1. Return code=0<br>2. Return orderStatus=PENDING_PAY<br>3. Return couponId (String), couponAmount (int)<br>4. Return payableAmount (int), value = step1.payableAmount<br><br>**Step 3 expectation:**<br>1. Return code=0<br>2. Return paymentId (record as P1, String)<br>3. Return payStatus=SUCCESS<br><br>**Step 4 expectation:**<br>1. order_status=PAID<br><br>**Step 5 expectation:**<br>1. available_stock = inventory value in Preconditions - the place-order quantity of step 1<br><br>**Step 6 expectation:**<br>1. Cache value = step5.available_stock<br><br>**Step 7 expectation:**<br>1. Return code=0<br>2. Return couponStatus=USED<br><br>**Step 8 expectation:**<br>1. Message status=consume succeeded<br>2. Message body.orderId = O6 returned by step 1<br>3. Message body.storeId = S1<br>4. Message body.status=PAID | P0 | [New][Function-Positive][Combined verification] | place-order PRD.md, line XX, "The user may use a spend-threshold coupon when placing an order; after payment succeeds, deduct inventory and notify fulfillment" |

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
