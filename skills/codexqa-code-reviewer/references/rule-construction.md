# Rule construction algorithm

Mandatory for every **new or extended** detection rule, scanner shape, and
LLM look-for row in this skill. A rule that names one incident’s type, method,
constant, or test is not ready to merge.

Existing `rule_id`s stay until their look-for text is next edited. That edit
must pass this algorithm. Do not add a parallel one-off rule beside a family
that already covers the relation.

Operating rule: one hit does not close a family. Search every shape, and file
every matching line.

Pipeline closure (every prompt, record, and the merge script):

1. Close on the set of objects a write touches. One allow on the source object does not close the destination object, another item in a batch, or another id in a callback.
2. Close on the relation, not the line. Two ids on one line are two findings. A skip names the relation already filed.
3. A declared bound is unused until the decision reads it. Cache growth does not close a stale value that is still used. A named constant the decision never reads is still unused.
4. Follow the callee. A catch that returns normally means the caller continues. Absence of a catch in the loop is not proof the loop stops.
5. Local commit before an external acknowledgement is a separate relation from compensation that uses the wrong account or amount. Filing one does not close the other.
6. A task, message, or callback must carry tenant, actor, and trace. The worker does not have to load a row for the dropped context to count.
7. A test is an oracle. `tested_count` does not close a false claim. An assertion threshold is not a fixture.
8. Null, zero, and negative are one boundary. A later throw mapped to a generic error is still a missing explicit reject.
9. Merge keys use `rule_id` (or an unlabeled restatement). Nearby lines in the same category are not a key.

## Reject

- Look-for text whose only pattern is a sample identifier (`BigDecimal`,
  `VERIFY_PEER_CERT`, `limitBoundaryShouldHold`, a single SQL verb).
- Closing a `rule_id` after the first hit or the first signal row.
- An exclusion that drops a whole family because one method is owned by
  another `rule_id`.
- Putting a hard-gate signal row only in `residual_risks`. HTML does not
  render residuals, so a deferred defect is an undetected defect.
- A second card that repeats the same shape and the same `rule_id` on the
  same line.

## Procedure

1. **Name the relation.** One sentence of the form “A does R to B without C”.
   No project type names. If the sentence only makes sense for the seed file,
   rewrite it.
2. **Join a family** in the catalog below, or justify a new family with two
   variants that differ in names and language and are not a restatement of
   the five.
3. **Write shapes as roles.** Each shape is a role pair (source role, use
   role), not an API spelling. An illustration may follow the role sentence.
   The illustration is not the pattern.
4. **State closure.** One matching line does not close the rule. Every shape
   is searched. Every matching line is its own finding. `rule_coverage.hit`
   lists the lines, not “the rule already fired”. When look-for names more
   than one shape, `shapes[]` has one hit-or-skip entry per shape. Render
   refuses a conclusion that drops a `disposition: report` line, skips a test
   without three negative oracle answers, or omits an untested production
   symbol.
5. **State exclusion at locus scope.** “Do not also file rule X” applies only
   to the method that already has that finding. Other methods that match the
   relation still file.
6. **State visibility.** If a derive array is a hard gate, each row is a
   P0/P1/P2 finding in `review-conclusion.json` and therefore in
   `REVIEW-REPORT.html`. Residual text is only for non-defect clues
   (`residual_hardening`, `residual_performance`, thin-pack uncertainty).
7. **Assign an owner.** One owner dimension and optional `rule_id`. Aliases
   only from the table below. Scanner-owned pattern classes stay on
   `23-sast-signals.json`; do not invent a second `rule_id` for them.
8. **Fill the rule record** in the next section. A family sentence without
   mode, sanitizer, precision, and a compliant example is not a rule.
9. **Generalization check.** Before merge, confirm both variants match the
   look-for text and that the seed’s identifiers do not appear as the
   pattern:
   - Variant A: same relation, identifiers renamed.
   - Variant B: same roles, different language or different API.
   - Compliant example: the same roles, with the sanitizer or guard present,
     must not match.

Record the variants and the compliant example in the change note or the
card’s evidence note. Do not paste them into the look-for cell as the pattern.

## How this relates to industry SAST

Common engines (Semgrep, CodeQL, SonarQube, SpotBugs, Bandit, gosec) do not
ship five business-review families. They ship a **rule record** plus one
**matching mode**. SARIF is the shared result shape: rule id, message,
default level, taxa, precision, primary location, related locations, and an
optional code flow.

SAST hits are triaged before any model call. `report` skips the model.
`drop` (tests, generated code, sanitizer) is discarded. `suspect` is the only
code-flow row sent to a model, and only as a slice plus that rule’s short policy.
Business rules that SAST cannot circle use a separate prompt.

Triage follows the tool, not one keyword list. A secret scanner hit and a
structural match (hash, disabled TLS, pickle, decimal or float money) are
`report`. A taint result that already carries a source-to-sink flow is
`report`. Low engine confidence or a name-only match with no sink is
`suspect`. A dependency advisory is `report` on the dependency channel
(`triage_channel: sca`), never a code-flow suspect. Style notes stay out of
this triage.

This algorithm matches that shape on purpose:

- Roles are sources and sinks. One match does not suppress the next.
- Exclusions are sanitizers or guards at a location, not a skipped rule id.
- Every match is a result. Residuals are not results.
- Examples are a failing case and a guarded case, with identifiers renamed.

It does **not** replace those engines. Injection, traversal, weak hash,
hardcoded secrets, insecure TLS, and float money stay on
`23-sast-signals.json`. Families F3–F5 are review relations those default
packs usually do not encode. Implement them with the same record and the same
matching modes, not with a sample-specific pattern.

## Rule record

Every new or edited rule carries these fields. Names follow SARIF and the
Semgrep/CodeQL metadata that packs actually fill. Leave a field empty only
when the note says why. Do not invent a CWE, CVE, or OWASP id.

| Field | Meaning |
|---|---|
| `id` | Stable id (`NULL-001`, or a new id). Never reuse an id for a different relation. |
| `name` | Short name of the relation, no sample identifiers. |
| `mode` | One matching mode from the list below. |
| `family` | `F1`–`F5`, or a new family id. |
| `kind` | `vulnerability`, `bug`, `smell`, or `hotspot`. Hotspot means a human must confirm; it is not a silent skip. |
| `precision` | `high`, `medium`, or `low`. How often a match is a true positive. Low precision stays a finding but says so. |
| `level` | Default `P0`, `P1`, or `P2`. Escalate only by the owner card’s rule. |
| `languages` | Which languages the shapes cover. Say “scanner subset” when the LLM fills the rest. |
| `scope` | `line`, `intraprocedural`, or `interprocedural`. Do not claim interprocedural when the scanner is a line regex. |
| `sources` | Role of the value or control that enters the relation. |
| `sinks` | Role of the use, write, or assertion that makes it a defect. |
| `sanitizers` | Guards, barriers, or checks that stop the match. This is the do-not-report column. |
| `propagators` | Steps that carry the role without being source or sink (assignment, wrapper call, string build). |
| `message` | One sentence with placeholders for the roles. No seed file names. |
| `remediation` | What change introduces the sanitizer or the missing precondition. |
| `taxa` | CWE or OWASP only when the weakness is that standard. Otherwise omit. |
| `examples` | One noncompliant case and one compliant case, identifiers renamed. |
| `skip_llm` | True when a high-precision source-to-sink match is reported directly. False only for a suspect. |
| `disposition` | `report`, `drop`, or `suspect`. Tests, generated code, and a sanitizer on the path are `drop`. A name-only match with no sink is `suspect`. A missing value is unstamped, not report: run triage before review. |
| `sast_class` | Optional. When the observation is this owned SAST class, file that class and not this id. |
| `narrowed_by` | Optional. Skip this id only when the named id already describes the same write. A different write on the method still matches. |

Business ids (`BIZ-*`, `PAY-*`, `TXN-001`, `CONC-*`, `LOGIC-001`) keep their
records in [business-rule-records.md](business-rule-records.md) and are judged
only in the business-logic pass.

A finding cites source line and sink line when they differ. That is the
related-location pair SARIF uses. A single-line pattern uses one location.

## Matching modes

Pick one mode per rule. Do not mix a taint story into a line-search rule
without saying the scanner only sees one line.

| Mode | Algorithm | Use when |
|---|---|---|
| `search` | Structural match on roles, plus `pattern-not` for sanitizers in the same statement or block. | The defect is local syntax (empty check, literal off, deprecated call). |
| `taint` | Data from a source reaches a sink along propagators, and no sanitizer is on the path. | Untrusted or absent values, identifiers in a sink, client-controlled amounts. |
| `guard` | A sink is reachable on a path that does not pass the required check. | Missing null test, missing status read, missing authz before a write. |
| `typestate` | An object is created and a required later call (close, shutdown, commit) is missing on a path. | Resource and transaction lifetime. |
| `constant` | A decision reads a compile-time literal, or a bound symbol has no read at the decision. | Unused timeout, flag fixed off, unbounded literal. |

F1 is usually `search` or `taint`. F2 is not a matching mode; it is the rule
that every match becomes a visible result. F3 is `constant`. F4 is `guard`.
F5 is `search` over test assertions versus the calls in that test.

Sanitizer scope is the same as exclusion scope: the guard must sit on the
path or in the block that contains the sink. A sanitizer in another method
does not clear this method unless `scope` is `interprocedural` and the call
was actually resolved.

## Family catalog

New rules extend one family. Scanners implement a **subset** of that family’s
shapes. The order-16 pass treats the family text as the spec and the signal
array as incomplete evidence.

### F1 — Shape set stays open

**Relation:** a documented look-for lists more than one way the same defect
appears.

**Shapes:** every role pair in the look-for cell, across the changed files.

**Closure:** a hit on shape 1 does not skip shape 2. A hit on line N does not
skip line M.

**Implement:** scanner emits the rows it can prove; the LLM pass files the
remaining shapes with the same `rule_id`.

### F2 — Signal row is a visible finding

**Relation:** a hard-gate array entry is a defect the report must show.

**Shapes:** one finding per array element (`path` + `line`). Grouping is
allowed only inside one call site when every line of that site is cited in
that finding’s evidence.

**Closure:** `residual_risks` cannot satisfy this family.

**Implement:** resilience swallow/timeout/retry/partial/idempotency/unwrap
rows, performance N+1/hot-path/unbounded rows, and the other hard gates named
on the owner card.

### F3 — Declared constraint unused at the decision

**Relation:** a named bound, switch, expiry, or check exists, and the
decision point does not read it, or the decision is a compile-time literal
that forces the unsafe or legacy side.

**Shapes:**

- Bound declared (timeout, expiry, limit, capacity, checksum, verification)
  and the read/call/branch that should enforce it does not reference it.
- Boolean or enum switch initialized to a literal off/on, with no read from
  environment, config, or a feature service in the same file.
- Decision uses an unbounded or disabled literal (`0` meaning forever,
  a negative, an unbounded sentinel, or a fixed true or false). Reading the
  symbol or calling the setter does not clear this shape when that value
  disables the bound.

**Closure:** each unused or disabled constraint is its own finding. Do not
stop after the first flag. Storing an expiry or a fetch time does not enforce
it. The finding is that the decision still uses the stale, default, or
disabling value. A performance note that the cache grows does not close this
relation. `residual_risks` cannot hold this shape.

**Not this family:** a secret literal (SAST `hardcoded_secret`) or a
certificate check that is already the insecure-TLS pattern class. Host and
URL literals stay on `env_config_gaps`. File this family when the unread
symbol should have changed a computed result.

### F4 — State write missing a precondition

**Relation:** an operation changes balance, stock, or business status, and
the write is not guarded by a prior read of that status or by a unique
business key.

**Shapes:**

- Repeat write with no unique business id.
- Reverse, void, settle, capture, or retry with no read of the previous
  status.
- Batch or loop that keeps writing after one item fails, with no recorded
  failure. Resolve the callee: a catch that returns normally does not stop
  the caller.
- Irreversible local write before an external acknowledgement, with no
  pending or held state. Wrong compensation math is a second shape.

**Closure:** another `rule_id` on one method does not close this relation on
a different method. On the same write, a record’s `narrowed_by` keeps only
the narrower id. One authorized object does not close another object in the
same write. One shape of a two-shape record does not close the other shape.

**Not this family:** the check-then-act race (`CONC-001`) and the missing
transaction around several writes (`TXN-001`). Those stay separate findings
when the code has each shape.

### F5 — Test claim does not match the exercised behavior

**Relation:** a test’s name, comment, or assertion talks about a risk, and
the test does not exercise that risk, or the assertion requires the unsafe
outcome.

**Shapes:**

- The assertion is true from the test’s own setup (collection size after
  add, elapsed time under a very large limit, a thread started and not
  joined).
- The assertion requires a dangerous output (full personal identifier,
  unescaped caller text, a deprecated value treated as the contract).
- The name or comment claims a boundary, failure, concurrency, or
  authorization case, and the inputs stay on the happy interior, a single
  null, the legacy branch, or an empty collection.
- The test reads or writes private production state, or the test type is
  nested in the production type. A test-only dependency that the production
  type also imports locks that dependency.
- A condition in the test cannot be true, or the assertion only counts
  attempts, or a flag’s other value is never executed.
- A numeric literal is the assertion’s pass condition (boundary, duration,
  count). That literal is not a fixture.

**Closure:** graph `tested_count == 0` does not replace this family. List
every production symbol the test source calls whose tests-reach edge is
empty, and file each false claim above. A call in test source is not a
coverage edge. One false claim does not close the next.

## Alias table

Detection identity is the shape. `rule_id` is a label. Dedupe only when both
findings share that id, or both are unlabeled and the wording is the same
defect. Nearby lines without the same id stay separate.

| Shape | Owners that may both file | Do not |
|---|---|---|
| Personal identifier reaches a human-visible sink (log, receipt, message) | `HYG-001` and Privacy | Drop hygiene because privacy already filed |
| Authorization predicate is a disjunction or a substring role check | Security `AUTH-*` | Also file `ARCH-001` unless a layer boundary is skipped in the same code |
| Scanner pattern class (injection, traversal, weak hash, float money, secret, insecure TLS, XSS) | `23-sast-signals.json` only | Invent `SEC-001` or another id for that same shape |
| Same write already filed under the record’s `narrowed_by` id | The narrower id only | The broader id on that same write |

Any new alias is a row in this table, added by the same procedure. It is not
a sentence buried in one card.

## Scanner contract

A new scanner function implements one family subset:

- Input is source text, not a sample file name.
- The comment quotes the family id (`F1`–`F5`) and the matching mode
  (`search`, `taint`, `guard`, `typestate`, or `constant`).
- Output rows use `path`, `line`, and a `kind` that names the **role**, not
  the seed API. When source and sink differ, emit both lines.
- A sanitizer on the sink path suppresses that row only.
- Tests for the scanner include a renamed noncompliant case, a second API or
  language shape, and a compliant case where the sanitizer is present. A test
  that only matches the seed sample fails the generalization check.

The LLM pass must still walk shapes the scanner does not emit. “The array
already contains this `rule_id`” is not a reason to skip.

## Card snippet

Put this above a new or rewritten detection-rule row:

```text
id: BIZ-002
name: status write without prior state
mode: guard
family: F4
kind: bug
precision: medium
level: P1
languages: scanner subset plus LLM
scope: intraprocedural
sources: status-changing entry (reverse, settle, capture, retry, second post)
sinks: write of balance or business status
sanitizers: prior status read, unique business key, allowed-transition guard
propagators: local assignment into the write
message: a status-changing write has no prior status read and no unique business key
remediation: read the previous status or reject a duplicate business key before the write
taxa: omit
examples: renamed noncompliant write; compliant write after a status check
closure: per line; narrowed_by skips this id only for the same write
visibility: finding, not residual
owner: correctness
sast_class:
narrowed_by: PAY-006
```
