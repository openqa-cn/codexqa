# UI / visibility standard scenario library (load on demand)

Read this file only when the target mode includes WEB, APP, or the full set, or when the user explicitly asks to output visibility test design. Do not load the body of this file in server-only mode.

## T08 analytics-event tracking standard test scenarios

For each analytics event, you must match and generate test scenarios from the standard scenario library below according to its type (mv/mc/pv). Standard scenarios are the minimum requirement; you may add more for the specific business, but you may not remove any.

### MV (impression) analytics-event standard test scenarios

| Scenario ID | Scenario description | Expected reporting logic |
|---------|---------|-------------|
| MV-01 | First exposure of 1px | Report MV |
| MV-02 | Loaded but not exposed | Do not report MV |
| MV-03 | Scroll the page and show a card that has not been impressed | Report MV |
| MV-04 | Scroll the page and show a card that has already been impressed | Do not report MV |
| MV-05 | Pull-to-refresh the page | Report MV |
| MV-06 | Pull-up load more | Report newly loaded content; do not re-report already reported content |
| MV-07 | Navigate from page A to page B (including a overlay), then return to page A | Report MV |
| MV-08 | On page A, go back to the previous page, then enter page A again | Report MV |
| MV-09 | Switch tab and show again | Report MV |
| MV-10 | Switch from background back to foreground | Report MV |

### MC (click) analytics-event standard test scenarios

| Scenario ID | Scenario description | Expected reporting logic |
|---------|---------|-------------|
| MC-01 | Valid click | Report once per click; no duplicate report; no missed report |
| MC-02 | Filter and select multiple conditions | Do not report when selecting conditions; report MC after clicking confirm |

### PV (page view) analytics-event standard test scenarios

| Scenario ID | Scenario description | Expected reporting logic |
|---------|---------|-------------|
| PV-01 | First enter the page | Report one PV event; no duplicate report; no missed report |
| PV-02 | Pull-to-refresh the page | Do not report PV |
| PV-03 | Go back to the previous page | Report the previous page's PV |
| PV-04 | On the page, go back to the previous page, then enter this page again | Report PV |
| PV-05 | APP is in background; launch from background and enter the page | Report PV |
| PV-06 | PV and PD appear as a pair | PV and PD appear as a pair |
| PV-07 | Press Home or the power key to turn off the screen, then open the page again | Report PV |
| PV-08 | Close a page overlay | Do not report PV |
| PV-09 | Report PV in page-impression order | Different PV report order matches the actual page impression order |

## T08 usage rules

1. One analytics event = one test scenario: each analytics-event ID must generate exactly one test scenario. Inside that scenario, organize all standard sub-scenarios of the matching type as multiple verification steps in a single scenario.
2. Do not split the same analytics event into multiple scenarios, and do not merge multiple analytics events into the same scenario.
3. Scenario naming: `[Analytics]<page-name>-<module-name>_<type>(<analytics-event-ID>)`, where `type` is the analytics-event type description.
4. Total analytics-event test scenarios = total analytics-event IDs.
5. Assign all analytics-event scenarios under the "Analytics-event testing" group, then group by module or page.

## Generic interaction-pattern standard test scenarios

The following three classes are common UI interaction patterns and are not limited to a specific type. When the test object involves list display, click actions, or data display, you must match and generate test scenarios from the corresponding scenario library.

### List-class standard test scenarios

| Scenario ID | Scenario description | Expected results |
|---------|---------|---------|
| LIST-01 | List has no data | Show an empty-state page (e.g. "No data"), with no exception error |
| LIST-02 | Pagination — data does not fill one page | Display normally; no pagination control, or the pagination control is grayed / hidden |
| LIST-03 | Pagination — not the last page | Can page to the next page normally; no duplicate data and no missing data |
| LIST-04 | Pagination — last page | Show "No more" or gray the pagination control; no duplicate request |
| LIST-05 | On a non-first page, filter or search and re-request the API | Reset the page parameter to the first page; the list starts displaying from the first page |
| LIST-06 | List load fails and a "Reload" button appears | After click, re-request the API; after a successful load, display normally |
| LIST-07 | Sticky header and unstick | When scrolling to the specified position, the table header / filter bar sticks; after scrolling back, unstick, with no jitter |
| LIST-08 | Click a list item, navigate away, then return to the list | Filter conditions, search content, and scroll position stay unchanged |

### Click-function standard test scenarios

| Scenario ID | Scenario description | Expected results |
|---------|---------|---------|
| CLICK-01 | Hot-zone range | The clickable response area matches the visual area; there is no unresponsive click or accidental trigger outside the range |
| CLICK-02 | Idempotency — rapid consecutive clicks | Do not produce a duplicate request or duplicate action (e.g. duplicate submit, duplicate navigation) |
| CLICK-03 | Single-select scenario | Only one option can be selected; selecting a new option automatically deselects the old option |
| CLICK-04 | Multi-select scenario | Multiple options can be selected at the same time; the selected count matches the business limit |
| CLICK-05 | Deselect | A selected option can be clicked again to deselect (if the business supports it) |

### Display-class standard test scenarios

| Scenario ID | Scenario description | Expected results |
|---------|---------|---------|
| SHOW-01 | Data has a value | Display the data content normally; format, unit, and precision match expectations |
| SHOW-02 | Data has no value (null / empty string / undefined) | Show fallback copy (e.g. "--", "None"); do not show raw values such as "null" / "undefined" |
| SHOW-03 | Illegal data (overlong text, special characters, XSS script) | Display safely; no overflow, no abnormal truncation, no XSS execution |

## Generic-interaction usage rules

When designing test scenarios, first judge whether the test object involves list, click, or display interaction; if it does, generate test scenarios one by one from the corresponding standard scenario table. Replace generic words in the scenario description (e.g. "list", "option") with the concrete names in the actual business. These three classes of scenarios may be stacked with T01–T10 type scenarios.
