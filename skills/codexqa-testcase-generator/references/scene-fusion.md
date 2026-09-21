# Test-scenario fusion rules

This document defines the rules and practical examples for test-scenario fusion. **Enforce** them when Stage 4 (test-object type analysis and test design) generates test scenarios, so scenario granularity is reasonable and not over-split.

## Core principles

Merge multiple tightly related test scenarios under the same functional module into one, to avoid over-fragmented scenarios. Merge by:
- Multiple operation steps under the same preconditions → merge into one scenario
- Positive, exception, and boundary scenarios of the same API / method → merge into one scenario
- Do not merge scenarios from different modules; keep directory ownership clear

### Special rules for analytics-event cases (priority higher than the generic merge principles)

**Analytics-event cases do not use the merge principles above; you must generate them by the principle "one analytics-event ID = one case".** Concrete rules:

1. **One analytics-event ID = one case**: generate exactly one test case for each analytics-event ID (e.g. `b_biz_1rko5sji_mv`). Inside that case, integrate all standard scenarios of the matching type (mv/mc/pv) as multiple operation steps, rather than splitting them into multiple cases
2. **Do not merge across analytics events**: even if multiple analytics events belong to the same module and the same page, do not merge them into one case. Each analytics-event ID must be an independent case
3. **Do not split the same analytics event**: all standard scenarios of the same analytics-event ID must be integrated in one case; do not split them into multiple cases
4. **Case-count calculation**: total analytics-event cases = total analytics-event IDs. Example: 3 MV analytics events + 2 MC analytics events = 5 cases (each case internally contains all standard-scenario steps of that type)
5. **Naming format**: `[Analytics]<page-name>-<module-name>_<type>(<analytics-event-ID>)`; see the "Case title convention" section above
6. **Detailed rules**: see the "Usage rules (mandatory)" of T08 analytics-event tracking in [s04-object-design.md](s04-object-design.md)

---

## Quick fusion decision table

| Difference type | Typical traits | Fusion decision | Example |
|:--------|:---------|:--------|:-----|
| **Parameter-enum type** | The same action repeats under different enum values<br>(type, status, role, client, channel) | **100% mandatory merge** | Store type (general store / specialty store / flagship store)<br>Client (user App / merchant App / mini program)<br>Status (logged in / not logged in) |
| **Condition-branch type** | Contains if / whether / when... logic | **100% mandatory merge** | In-whitelist / out-of-whitelist contract check<br>Login-state redirect logic |
| **Style-attribute type** | Multiple style attributes of the same element | **100% mandatory merge** | Member badge (style + color + font) |
| **Client-coverage type** | The same function across multiple clients / OS / versions | **100% mandatory merge** | iOS / Android / HarmonyOS<br>v8.50 / v8.68 versions |
| **Multi-verification-point type** | The same action needs to verify multiple results | **100% mandatory merge** | After clicking submit, verify the dialog / button / data / analytics event |
| **Chain-dependency type** | Multiple actions have order or dependency | **100% mandatory merge** | Enter → select → purchase → confirm order |
| **Permission type** | Permission difference | **100% mandatory merge** | Has permission / no permission |
| **Success-status type** | Status difference | **100% mandatory merge** | Success, failure |
| **Experiment / whitelist type** | Whitelist, blacklist, experiment / control group | **Allow split** | In whitelist, out of whitelist |
| **Core-logic type** | Completely different business processing flows | **Allow split** | Create order vs cancel order |

**3 conditions for split** (all must be met at the same time): different business goal + different processing flow + different verification result

---

## Fusion examples

### Example 0: Parameter-enum type

**Requirement function description:** The drawer is mutually exclusive with the right-side functions. Detail: the drawer is mutually exclusive with "cart, assistant, marketing sidebar, weather widget, order detail, qualifications and rules"; when the drawer opens, the above functions collapse, the drawer covers the above functions, and after the drawer closes, the above functions expand again.

**❌ Wrong approach (too fine-grained, 8 scenarios):**

```
Scenario 1: [Drawer-mutex logic] Verify that the cart function collapses and recovers when the drawer opens
Scenario 2: [Drawer-mutex logic] Verify that the assistant function collapses and recovers when the drawer opens
Scenario 3: [Drawer-mutex logic] Verify that the marketing sidebar function collapses and recovers when the drawer opens
Scenario 4: [Drawer-mutex logic] Verify that the weather widget function collapses and recovers when the drawer opens
Scenario 5: [Drawer-mutex logic] Verify that the order-detail function collapses and recovers when the drawer opens
Scenario 6: [Drawer-mutex logic] Verify that the qualifications-and-rules function collapses and recovers when the drawer opens
Scenario 7: [Drawer-display] Verify that when the drawer opens it covers the right-side floating functions and the z-order is correct
Scenario 8: [Drawer-collapse] Verify that after the drawer closes the right-side floating functions expand automatically
```

**✅ Correct approach (after fusion, 1 scenario):**

```
Scenario: [Drawer-mutex logic] Verify that the mutex logic between drawer display and the right-side cart, assistant, marketing sidebar, weather widget, order detail, and qualifications and rules is correct
```

---

### Example 1: Condition-branch fusion (parameter enum + whitelist logic)

**Requirement function description:** After a service provider clicks to start contracting, add a check between the service provider's operating category and the merchant's primary L2 category corresponding to the filled store ID; the system automatically filters stores whose category check is inconsistent.
1) Check logic: a general-store service provider may only contract general stores; a specialty-store service provider may only contract the matching specialty stores; a flagship-store service provider may only contract flagship stores
2) Whitelist support: maintained by tech by store ID; stores added to the whitelist skip the category-consistency check when the service provider starts contracting, and may bind stores whose category is inconsistent

**❌ Wrong approach (too fine-grained, 8 scenarios):**

```
Scenario 1: General-store service provider contracts a general store successfully
Scenario 2: Specialty-store service provider contracts a specialty store successfully
Scenario 3: Flagship-store service provider contracts a flagship store successfully
Scenario 4: Convenience-store service provider contracts a convenience store successfully
Scenario 5: Non-whitelist store with inconsistent category fails to contract
Scenario 6: Whitelist store may contract a store with inconsistent category
```

**✅ Correct approach (after fusion, 2 scenarios):**

```
Scenario 1: [Service-provider contract-category check] Merchant ID is in the whitelist; verify that contracting succeeds when the service provider's operating category is inconsistent with the merchant's primary L2 category
Scenario 2: [Service-provider contract-category check] Merchant ID is not in the whitelist; verify that contracting is blocked when the service provider's operating category is inconsistent with the merchant's primary L2 category
```

**Key points:**
- 6 store types → do not appear in the scenario title (treat them as implicit coverage)
- In whitelist / out of whitelist → split into 2 scenarios (different business logic: skip the check vs run the check)
- Scenario title → focus on the core verification point (whitelist + category check); delete concrete type enums

---

### Example 2: Style-attribute fusion (integrate multiple style attributes)

**Requirement function description:** Change the member-badge style on the limited-time delivery-coupon asset page. Detail: on the limited-time delivery-coupon asset page, change the member-badge style from gold to platinum, and change the color from pink to blue.

**❌ Wrong approach (split into 2 scenarios):**

```
Scenario 1: Verify platinum member-badge style display
Scenario 2: Verify the badge color changes from pink to blue
```

**✅ Correct approach (after fusion, 1 scenario):**

```
Scenario: [Asset page-limited-time delivery coupon] Verify that the member-badge style and color display correctly
```

**Key points:**
- Style + color → integrate into one scenario (different attributes of the same element)
- Scenario title → use "and" to connect multiple verification dimensions
- Do not split → style attributes must be verified together in 1 scenario

---

### Example 3: Client-coverage fusion (extreme fusion of multi-dimension enum scenarios)

**Requirement function description:** Change the member-badge style in the dish-ordering page header. Detail: change the member-badge style in the dish-ordering page header; covered clients include user App, merchant App, in-store App, and user-side mini program; covered headers include the new header and the 8.68 old header; covered badges are gold-member claimed and unclaimed states, which must change to platinum member, and the color must change from pink to blue.

**❌ Wrong approach (split into 11 scenarios):**

```
Scenario 1: Verify platinum-member claimed-state badge style display
Scenario 2: Verify platinum-member unclaimed-state badge display
Scenario 3: Verify the badge color changes from pink to blue
Scenario 4: Verify user App new-header badge display
Scenario 5: Verify merchant App new-header badge display
Scenario 6: Verify in-store App new-header badge display
Scenario 7: Verify user-side mini-program new-header badge display
Scenario 8: Verify badge display on v8.50.0 and above
Scenario 9: Verify badge display on iOS
Scenario 10: Verify badge display on Android
Scenario 11: Verify badge display on HarmonyOS
```

**✅ Correct approach (after fusion, 1 scenario):**

```
Scenario: [Dish-ordering page-member badge] Verify that the dish-ordering page header member-badge style displays correctly
```

**Key points:**
- 11 fine-grained scenarios → merge into 1 highly summarized scenario
- Client, OS, version, status → none appear in the title (treat them as implicit coverage)
- Style + color → uniformly described as "style display"
- **This is a canonical example of extreme fusion** → it proves that "default-merge into 1 scenario" is feasible

---

### Example 4: Multi-verification-point fusion (multiple verification points for the same action)

**Requirement function description:** After the user clicks the "Submit order" button, verify the following:
1. The page shows a submit-success dialog
2. The submit button becomes gray and unclickable
3. Order data is written to the database
4. The order-create analytics event is triggered and reported
5. The page automatically navigates to the order-detail page

**❌ Wrong approach (split into 5 scenarios):**

```
Scenario 1: Verify the dialog after submit
Scenario 2: Verify the submit button turns gray
Scenario 3: Verify order data is written
Scenario 4: Verify analytics-event reporting
Scenario 5: Verify page navigation
```

**✅ Correct approach (after fusion, 2 scenarios):**

```
Scenario 1: [Checkout-main flow] Verify the purchase flow from the checkout page through payment completion is correct
Scenario 2: [Analytics] Verify checkout analytics-event reporting and parameters are correct
```

**Key points:**
- 5 verification points → integrate into 2 scenarios
- Split → split analytics-event verification from business logic

---

### Example 5: Chain-dependency fusion (ordered steps)

**Requirement function description:** The complete flow of a user purchasing a product:
1. Enter the product-detail page and view product information
2. Click the "Buy now" button
3. Fill in the shipping address on the order-confirm page
4. Choose a payment method
5. Click the "Submit order" button
6. Navigate to the payment page and complete payment

**❌ Wrong approach (split into 6 scenarios):**

```
Scenario 1: Verify product-detail page information display
Scenario 2: Verify clicking the buy button navigates
Scenario 3: Verify address fill-in on the order-confirm page
Scenario 4: Verify payment-method selection
Scenario 5: Verify order submit
Scenario 6: Verify payment-page navigation
```

**✅ Correct approach (after fusion, 1 scenario):**

```
Scenario: [Checkout-main flow] Verify the purchase flow from product detail through payment completion is correct
```

**Key points:**
- 6 steps → integrate into 1 complete-flow scenario (there is sequential dependency)
- Scenario title → focus on the start and end points and summarize the complete flow
- Do not split → steps with dependency must be merged into 1 scenario
- **This is a canonical example of user-journey completeness** → it ensures the test covers the complete user operation path

---

### Example 6: Client-coverage type (user App, merchant App, in-store App, mini program, etc.)

**Requirement function description:** Client-type coverage includes user App, in-store App, lifestyle-service App, and user-side and merchant-side mini programs. Dish-ordering page modes and templates covered: modes include normal + paged + accessibility + brand hall + snacks + healthy meal + privacy + pickup + reservation; templates include normal list template + large-image template. Version is 8.62.0 and above. While the user adds products to the cart, the system calculates the deduplicated SKU count in real time; if it exceeds X=60, a dialog pops up (X=60, the value comes from the threshold issued by the cart API; it is the deduplicated SKU count and includes alcohol-delivery products); the user may click "Go clean up"; the system automatically opens the already-added-to-cart product overlay; the user actively deletes products from the cart.

**❌ Wrong approach (split into 8 scenarios):**

```
Scenario 1: Verify user App function correctness
Scenario 2: Verify merchant App function correctness
Scenario 3: Verify in-store App function correctness
Scenario 4: Verify merchant-side mini-program function correctness
Scenario 5: Verify user-side mini-program function correctness
Scenario 6: Verify normal-mode dish-ordering page function correctness
Scenario 7: Verify paged-mode dish-ordering page function correctness
Scenario 8: Verify brand-hall dish-ordering page function correctness
```

**✅ Correct approach (after fusion, 4 scenarios):**

```
Scenario 1: [Store page-cart add-limit] Add products to the cart; in each dish-ordering page mode, verify that add-to-cart succeeds when the deduplicated SKU count has not reached the threshold
Scenario 2: [Store page-cart add-limit] Add products to the cart; in each dish-ordering page mode, verify that a dialog pops up and add-to-cart is blocked when the deduplicated SKU count reaches the threshold
Scenario 3: [Store page-cart add-limit] In the limited add-to-cart scenario, verify that the dialog and already-added-to-cart overlay interaction logic is correct in each dish-ordering page mode
Scenario 4: [Store page-cart add-limit] After cleaning already-added products in each dish-ordering page mode, verify that products can continue to be added
```

**Key points:**
- 8 scenarios → integrate into 4 complete-flow scenarios
- Scenario title → focus on the start and end points and summarize the complete flow
- Do not split → each mode and each client type must be merged into 1 scenario
- **This is a canonical example of client coverage** → it ensures cases are not generated repeatedly

---

## Common misjudgment cases (must memorize)

| Wrong approach (too fragmented) | Essence of the difference | Correct approach (fusion) |
|:---------------|:--------|:---------------|
| ❌ General-store contract success + specialty-store contract success + flagship-store contract success | Only the type parameter differs | ✅ Category-check contract (type as a parameter) |
| ❌ User App + merchant App + in-store App | Only the client differs | ✅ Multi-client (client as coverage scope) |
| ❌ Platinum member claimed + platinum member unclaimed | Only the status parameter differs | ✅ Member-badge display (status as a parameter) |
| ❌ Style-change verification + color-change verification + font-change verification | Different attributes of the same element | ✅ Badge-style display (attributes as verification points) |
| ❌ iOS verification + Android verification + HarmonyOS verification | Only the OS differs | ✅ Multi-OS compatibility verification (OS as coverage scope) |
| ❌ Verify dialog display + verify button turns gray + verify data update + verify analytics-event reporting | Multiple verification points of the same action | ✅ Verify dialog / button / data / analytics-event status after submit (integrate all verification points) |
| ❌ Enter-page scenario + click-button scenario + fill-form scenario + submit scenario | Sequential dependency exists | ✅ Verify the complete submit flow (integrate into 1 scenario that contains all steps) |

---

## Post-generation self-check list

After generating the test scenarios for each feature point, you must run the following self-check:

- [ ] **Difference sink-down**: have enum values and condition branches been sunk into verification points or made implicit?
- [ ] **Decision-tree check**: does each scenario pass the 3-condition judgment (business goal / processing flow / verification result)?
- [ ] **Verification-point integration**: have multiple verification points of the same action been integrated into 1 scenario?
- [ ] **Chain completeness**: have steps with dependency been merged into 1 complete-flow scenario?
- [ ] **User-journey coverage**: is the complete user operation chain from enter through completion covered?
- [ ] **Dedup check**: was the three-element dedup judgment executed in a → c → b order? (see the "Case deduplication" section above)
