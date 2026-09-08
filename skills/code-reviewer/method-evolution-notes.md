# Code Reviewer Skill — Full review & improvement plan

> Review target: `code-reviewer` Skill V8 (maintainer)
> Review date: 2026-04-17
> Reviewer: Claude (Opus 4.7)
> References: Karpathy-Skills (forrestchang), Ralph (snarktank)

---

## 1. Five-dimension scores (out of 5)

| Dimension | Score | One-sentence conclusion |
|-----------|-------|-------------------------|
| 1. Rigor | **3.5** | Has a P0 three-step verification skeleton, but lacks a closed loop of "reverse-prove after output" |
| 2. Quality check | **3.0** | Report format is strict, but there is no self-rebuttal mechanism; AI slips into form-filling |
| 3. Large-branch handling | **3.5** | Multi-agent + rule-anchor design is advanced, but there is no persistent checkpoint |
| 4. False-positive control (optional nits) | **2.5** | No signal-to-noise gate; P1/P2 easily pad the count |
| 5. Miss control | **2.5** | Coverage outside the quick-reference card is thin, and there is no hard constraint to "scan every caller of a changed function" |

**Overall: 3.0 / 5** — Strong framework; the execution layer lacks a "self-review loop" and "persistent memory".

---

## 2. Dimension details (with evidence)

### Dimension 1 · Rigor — 3.5 / 5

**What works:**
- `review-playbook.md` lines 51-58 P0 three-step verification (A: line number / B: runtime consequence / C: rule source) — a very hard constraint
- `Confidence principle` (lines 330-334) is explicit: "do not infer from a diff fragment alone"
- `Common misjudgment correction table` (lines 427-433) explicitly lists high-frequency mistakes such as "empty catch is P0, not P1"

**What is weak:**
- **Hard constraints exist only "before output", not "after output"**: AI may treat a "line number invented from memory" as a "found line number", with no reverse Read of the file
- **C in A/B/C does not require quoting the full rule text** → easy to write "Basis: G3" without saying what G3 actually says
- **Five-item self-check is a conclusive self-report** (lines 355-362) → e.g. "⚠️ Involved, precision verified", but what was verified is not recorded
- Missing an **adversarial pass**: no step of "if I were the other developer, could I rebut this conclusion?"

---

### Dimension 2 · Quality check — 3.0 / 5

**What works:**
- Layered playbooks: always-on (project-conventions + design-quality-rules) + triggered by file type + triggered by content features
- Standardized report format (every finding must have location + basis + consequence + bad/fix code)
- `review-feedback-journal.md` collects three signal types (false positive / miss / new pattern)

**What is weak:**
- **review-feedback-journal is passive**; currently only examples, no real records → no closed loop of "used → feedback → upgrade rules"
- **No eval set**: cannot quantify whether V7 → V8 rule hit rate / false-positive rate went up or down
- **No self-critique step after the report is generated** → AI writes and submits; it will not look back and ask "is this P1 actually valuable? would a developer agree?"
- Missing a **value-assessment template**: every P1/P2 should state "what happens in 3 months if this is not fixed" → if it has no value it should not appear

---

### Dimension 3 · Large-branch handling — 3.5 / 5

**What works:**
- Four modes (standard / grouped / two-phase / multi-agent) switch automatically by diff line count; thresholds are clear
- Rule-anchor mechanism (lines 85-95) clearly prevents context truncation from dropping rules
- Sub-agents carry a "rule snapshot" instead of "read files", so each child does not re-digest the playbook
- Context self-recovery signal table (lines 251-263) has 5 trigger scenes

**What is weak:**
- **Split by "line count + file type", not by dependency graph**: A.tsx changed, B.tsx that calls it did not change, but they land in different groups → the sub-agent cannot see the whole picture
- **Multi-agent mode does not persist intermediate results**: all sub-agent JSON is merged only in the main-agent context; if that context blows up, everything is gone
- **No "batch confirmation" control**: the report should be produced in segments → wait for user/CI confirmation → then continue; today it dumps everything in one go
- Missing a Ralph-style **`.code-review-progress.json`** persistent progress file → cannot resume after interrupt

---

### Dimension 4 · False-positive control (optional nits) — 2.5 / 5 ⚠️ user-highlighted pain

**What works:**
- Confidence principle forbids "consider refactoring"
- P0 three-step verification downgrade (any miss → drop to P2)

**What is weak (this is the biggest current pain):**
- **No signal-to-noise gate**: a report may contain N P1 + N P2 items, with no "P1+P2 total cap"
- **No "value filter"**: missing a required field "what concrete consequence happens if this is not fixed?" → if you cannot write a consequence, delete it
- **Stylistic issues have no separate throttle**: naming / comments / formatting especially pad P2 counts
- **No "developer-perspective reverse nitpick" step**: after writing a report, AI should ask "if I were the PR owner, would I think AI is padding?"
- **Missing "fix cost vs benefit" assessment**: P1 is only labeled "suggested", with no workload of "change one place vs the whole file vs refactor a component"

---

### Dimension 5 · Miss control (real issues ignored) — 2.5 / 5

**What works:**
- Team BadCases library with 7 real incidents
- high-risk-changes 5 focus areas tally incident counts + money lost

**What is weak:**
- **"Scan every caller of a changed function" is advice, not a hard constraint**: step 3 table says "Grep callers, sample-Read 2-3 places", but there is no gate of "must Grep before you may continue outputting"
- **Test files skip deep review** (line 306) — wrong mock assumptions are themselves a miss source
- **Playbook coverage is thin**:
  - No React 18 Concurrent Mode / Suspense / startTransition pits
  - No MobX 6 makeAutoObservable mismatches
  - No TS 5.x const generics, satisfies, or other new-feature misuse
  - No microfrontend / qiankun cross-app traps
- **No "anti-diff view"**: many misses come from "AI only looks at the diff, not the full file" → missing a hard constraint "for a function the diff changed, you must Read the full file before judging" (mentioned, but not execution-verified)
- **Does not actively check "should have changed but did not"**: e.g. A changed but sibling path B did not → the current skill will not report "you should have changed B as well"

---

## 3. Improvement plan (ROI order, 3 phases)

### Phase 1 · Do now (1-2 days, highest bang for buck)

#### Improvement 1: Add a self-critique pass

> **Borrowed from Karpathy "Senior engineer test"** + **Opus 4.7 extended thinking**

Before "output the report", force a self-critique pass:

```markdown
## Step 4: Self-critique (mandatory, cannot skip)

After the report draft is written, you must run these 5 counter-questions. Every P0/P1 must pass all 5:

| Counter-question | Pass standard | If it fails |
|------------------|---------------|-------------|
| Q1: Can the line number be confirmed with the Read tool? | Actually Read that file and line once | Delete the item |
| Q2: Can the runtime consequence be written as one sentence of "in what scene the user sees what"? | Concrete scene + concrete symptom | Downgrade to P2 |
| Q3: Which sentence of which rule is the basis? | Can paste a rule-text fragment | Downgrade to P2 |
| Q4: If I were the PR owner, would I think this is a nit? | There is real risk/loss | P1→P2 or delete |
| Q5: Is the fix cost 1 line / 1 function / whole file? | Matches the benefit | Annotate a cost field |
```

**Implementation:** Add "Step 4" before report output in review-playbook.md, plus a `self-critique-checklist.md` template.

---

#### Improvement 2: Add a "value filter" to govern P1/P2 signal-to-noise

> **Addresses the user feedback of "could change or not"**

```markdown
## Signal-to-noise gate (self-check before output)

- Per report: P1 cap 5, P2 cap 8 (overflow must be truncated after ranking by value)
- Required fields on every P1/P2:
  * `If unfixed`: what concrete loss happens in 3 months (cannot write empty phrases like "readability drops")
  * `Fix cost`: one of four tiers — 1 line / 1 function / whole file / refactor
  * `Priority matrix`: [high value-low cost] must report, [low value-high cost] must delete, others ranked by ROI
```

**Implementation:** Change the report template P1/P2 item format; add `If unfixed` + `Fix cost` fields.

---

#### Improvement 3: Add a persistent progress file (Ralph style)

> **Addresses long-task context amnesia**

Create `.code-review-progress.json` at each CR start:

```json
{
  "session_id": "2026-04-17-cr-xxxx",
  "branch": "feature/xxx",
  "base": "master",
  "diff_stats": { "files": 18, "lines": 3200 },
  "mode": "multi-agent",
  "phases": [
    { "name": "load_knowledge", "status": "done", "loaded_files": [...] },
    { "name": "group_1_review", "status": "done", "findings_file": ".cr-group-1.json" },
    { "name": "group_2_review", "status": "in_progress" }
  ],
  "findings_so_far": { "p0": 3, "p1": 4, "p2": 6 },
  "last_checkpoint": "2026-04-17T10:23:15Z"
}
```

**Benefits:**
- If a single context blows up, the next CR can read the progress file and continue
- Main-agent merge reads each group's JSON files; it does not depend on in-context memory
- Users can interrupt mid-way and still see progress

**Implementation:** Add `tooling/review-progress.js`; write it in step 0; update it at the end of each phase.

---

### Phase 2 · Mid-term (3-5 days)

#### Improvement 4: Add an adversarial sub-agent (Opus 4.7 Task tool)

> **Borrowed from Opus 4.7 self-review + Ralph "verification"**

Before the main report is output, **start an independent Task agent** whose prompt is:

```
You are a harsh senior PR owner. Below is the CR report an AI wrote for your PR.
Your job is to nitpick item by item:
- Find items where "AI is padding / judged without reading the code / false positive"
- Find items whose "runtime consequence" is vague (no concrete scene)
- Find items whose "basis" does not match (the rule text does not support this judgment)

Output JSON:
{
  "to_remove": ["P1-3", "P2-5"],   // should delete
  "to_downgrade": [{"id": "P0-2", "to": "P2"}],
  "to_strengthen": [{"id": "P0-1", "missing": "which concrete user scene triggers this"}]
}

The main agent must execute these suggestions after receiving them; ignoring them is not allowed.
```

**Implementation:**
- Add "Step 5: Adversarial Review" in review-playbook.md
- Pair with `report-formats/adversarial-prompt.md`

---

#### Improvement 5: Harden "scan every caller of a changed function"

> **Addresses misses: cross-file impact**

Upgrade step 3's "context expansion table" from "advice" to a "gate":

```markdown
## Mandatory Grep verification before outputting P0/P1

Any report item that hits the cases below must **Grep callers first**.
Not searched → that item may not be output:

| Trigger | Must do |
|---------|---------|
| Changed an exported function / Hook / Component | `Grep` every import of that export; sample-Read 2 places |
| Changed a type / interface | `Grep` every `as XXX` and `: XXX` reference |
| Changed a Store observable field | `Grep` every read/write of that field |
| Changed RouteParams / API in/out | `Grep` callers |

Results must be written in the report `📋 Context analysis` section; if not executed → downgrade that item to P2 (pending confirmation)
```

**Implementation:** Change the step 3 table in review-playbook.md, plus a `tooling/check-callers.js` to auto-count callers.

---

#### Improvement 6: Build an eval set (quantified quality baseline)

> **Borrowed from skill-creator's measure-performance idea**

Put 10-20 **known-answer diff samples** under `.spec/eval/`:

```
.spec/eval/
  ├── case-01-promise-pending.diff
  ├── case-01-expected.json       # { "p0": ["G1 hit line 24"], "p1": [], "p2": [] }
  ├── case-02-money-float.diff
  ├── case-02-expected.json
  ...
```

Run before every skill upgrade:
```bash
node tooling/eval.js
# Output:
# Case 01: ✅ P0 hit / 0 false positives
# Case 02: ❌ Missed G6 float
# Pass rate: 8/10, regression vs V7: +1 case
```

---

### Phase 3 · Long-term (as needed)

#### Improvement 7: Ralph-style "PR.json" task decomposition

Split a large CR into enumerable atomic stories:

```json
{
  "review_id": "cr-2026-04-17",
  "stories": [
    { "id": "S1", "scope": "src/store/", "checks": ["G1", "G2", "G3", "store-rules"], "passes": false },
    { "id": "S2", "scope": "src/components/", "checks": ["react-rules"], "passes": false }
  ]
}
```

Each story owns one sub-agent context; mark `passes: true` when done.
All pass → main agent merges the final report.

#### Improvement 8: Periodically fold review-feedback-journal back into the playbooks

Set up a `consolidate-feedback` sub-flow (see consolidate-memory skill):
- Run monthly; add "false positives" from review-feedback-journal to a "whitelist exception"
- Add "misses" to the matching playbook chapter
- Propose "new patterns" as draft rules

---

## 4. Concrete plan to adopt Opus 4.7 self-review features

> Opus 4.7 is stronger at extended thinking, sub-agent orchestration, and tool-grounded verification.
> These features can systematically address "AI talking to itself / one wrong step, every later step wrong".

| Opus 4.7 feature | Landing in the CR Skill | Pain it solves |
|------------------|-------------------------|----------------|
| **Extended Thinking** | Before each P0, finish A/B/C verification in a `<thinking>` block, then output | AI blurts → force slow thinking |
| **Sub-agent (Task tool)** | Improvement 4: start an adversarial reviewer | AI talking to itself → opponent view |
| **Tool-grounded verification** | Improvement 1 Q1: every conclusion must be reverse-checked with Read | Invented from memory → must have an evidence chain |
| **Multi-pass review** | Pass 1 (draft) → Pass 2 (Adversarial) → Pass 3 (final) | One-shot output cannot rewind → three revision rounds |
| **Persistent scratchpad** | Improvement 3: `.code-review-progress.json` | Long-task context amnesia → persist state |

---

## 5. Concrete takeaways from Karpathy & Ralph

### From Karpathy-Skills

| Principle | CR Skill today | Borrowed change |
|-----------|----------------|-----------------|
| Think Before Coding | ❌ Executes immediately | Before step 0, first output a review plan listing what this review will check |
| Simplicity First | △ Report fields already converged | Add a "value filter" for P1/P2; cut valueless items |
| Surgical Changes | ❌ No boundary | Add a constraint: "only evaluate files the diff touches; do not evaluate what it did not change" |
| Goal-Driven Execution | △ Has a self-check table | Write every P0 as a verifiable form of "if I wrote a test to reproduce, how would I write it" |
| Clarification-First | ❌ Missing | Uncertain scenes should ask the user, not guess |

### From Ralph

| Mechanism | CR Skill today | Borrowed change |
|-----------|----------------|-----------------|
| Ephemeral context, Persistent memory | ❌ All in-context memory | Improvement 3: `.code-review-progress.json` |
| Right-sized decomposition | △ Multi-agent mode already splits | Improvement 7: PR.json task decomposition |
| Tight feedback loops | ❌ No phase verification | Self-check after each phase + write the progress file |
| Deliberate scratchpad updates | ❌ review-feedback-journal is passive | Improvement 8: every CR must append at least one "learned this time" |
| Verification gate | △ Has 5 self-check items but they are conclusive | Improvement 1: every P0 must reverse-check with Read |
| Observable progress | ❌ Black box | progress.json + readable phase status |

---

## 6. Countermeasures for the "4 AI long-task diseases"

| Disease | Where the current Skill is exposed | Countermeasure |
|---------|------------------------------------|----------------|
| **Scattered context** | Multi-agent merge relies entirely on main-agent memory | Improvement 3 + Improvement 7: each phase writes a .json to disk |
| **No persistent memory** | Everything accumulated resets when the session ends | Improvement 3 persist progress + Improvement 8 fold back into playbooks |
| **One wrong step, every later step wrong** | A P0 misjudgment → later discussion is based on the wrong judgment | Improvement 4 adversarial pass + Improvement 1 Q1 Read reverse-check |
| **AI skating / talking to itself** | Report is submitted as soon as it is written; no reverse nitpick | Improvement 1 self-critique + Improvement 2 value filter + Improvement 4 adversarial sub-agent |

---

## 7. Recommended landing order

| Priority | Item | Effort | Immediate benefit |
|----------|------|--------|-------------------|
| P0 | Improvement 1 self-critique + Improvement 2 value filter | 1 day | Directly cut false positives and the "padding" feel |
| P0 | Improvement 3 persist progress.json | 1 day | Large branches no longer "lose all prior work" |
| P1 | Improvement 4 adversarial sub-agent | 2 days | Opponent view; quality jump |
| P1 | Improvement 5 harden caller scan | 1 day | Directly cut misses |
| P2 | Improvement 6 eval set | 3 days | Makes "is V8 → V9 actually better" measurable |
| P3 | Improvements 7/8 task decomposition + playbook fold-back | Ongoing | Lets the skill evolve long term |

---

## 8. Appendix: review-playbook.md patch list you can apply now

1. Insert a new section `## Step 4: Self-critique (mandatory)` before the "Output report" section
2. After "P0/P1/P2 common misjudgment corrections", append `## Signal-to-noise gate`
3. Change the report-template P1/P2 item format; add `If unfixed` + `Fix cost` fields
4. In step 0, append the command `node $SKILL_DIR/tooling/review-progress.js init`
5. Before the step 3 context-expansion table, add a red callout: "The following is a gate, not advice"

——

**Summary**: Current V8 has an advanced framework and complete rules, but the execution layer still lacks a "self-review loop" and "persistent memory".
After the three Phase 1 improvements, expect to address about 80% of user feedback (false positives, misses, long-task amnesia).
