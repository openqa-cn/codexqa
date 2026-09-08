After the review, output the full report in this format.

**⛔ Forbidden**: Chat-style summaries / bullet-point wrap-ups / "what went well" / "want me to fix it?" or other conversational content.
**✅ Required**: Follow every section structure below. Every finding must have location + basis + runtime consequence + code snippet.

---

### 📋 Context analysis

**This PR's change intent (required; source: step 0.1 intent block):**
- Core goal: (one sentence, extracted from the commit / PR body; if missing you must note "asked the author; no formal conclusion until a reply")
- API changes: (list backend fields added/removed; write "none" if none)
- Out of scope for this change: (e.g. "no money / no component-structure refactor")

**Files explored:**
- ✅ Full files read and key changes
- ✅ References and call relationships searched
- ✅ Test files checked (if any)

**Impact scope:**
- Call-site count and locations for added/changed functions
- Leftover references to deleted code (if any)
- Downstream impact of changed APIs

**📊 Verification summary (required in step 4):** X candidates → Y after verification (removed A / downgraded B / merged C)

---

### 📁 File coverage matrix (required; name every diff file)

> Build the initial matrix from the review-playbook.md report section "📁 File coverage matrix" (extract the file list + +/- stats from `.code-review-diff.tmp`), then update status row by row.

| # | File | +/- | Review status | Finding count |
|---|------|-----|---------------|---------------|
| 1 | `src/components/xxx.tsx` | +25 / -3 | ✅ Reviewed (2 findings) | 1×P0, 1×P1 |
| 2 | `src/pages/yyy.ts` | +12 / -0 | ✅ Reviewed (no findings) | — |

Status is one of: `✅ Reviewed (N findings)` / `✅ Reviewed (no findings)` / `⚠️ Partial review` / `❌ Unreviewed (must complete)`
**Any ❌ → this CR fails; do not output a final conclusion; finish the review and rerun.**

---

### 🔎 Necessity review conclusion (N1-N5 five-question output, required)

| # | Check | Conclusion |
|---|-------|------------|
| N1 | Intent alignment | `✅ All aligned` / `⚠️ Found X "unclear-intent changes"` |
| N2 | Can it be deleted | `✅ No redundancy` / `⚠️ Found X deletable places (see P1/G11)` |
| N3 | Can it be simpler | `✅ Already simplest` / `⚠️ Found X simplifiable places` |
| N4 | Duplicates an existing approach | `✅ No duplication` / `⚠️ Found X missed-reuse places` |
| N5 | API contract changed | `✅ Unchanged` / `❌ Found X DTO contract mismatches (G12 / P0)` |

**🔎 Unclear-intent change list** (fill when N1 fails; a question list for the PR author; does not count toward bug totals):

| File:line | Change summary | For the author to answer |
|-----------|----------------|--------------------------|
| src/xxx.tsx:47 | Only reordered exports | This PR's intent is A; why this change? Can it be reverted? |

---

### 🤖 Automated detection results

- Security scan (2.1, required, `security-scan.js` partitioned scan): ✅ Pass / ❌ Findings found [description] (covers: hardcoded secrets, XSS, eval, `new Function`, SQL concatenation, DDL)
- Dependency scan (2.2, optional, `node tooling/run-local-checks.js`): ✅ Pass / ❌ Findings found [description] / ⚠️ Not run (reason: permission blocked / deps not installed / node error)
- Optional integrations (convention C): `prMetadata` / `notify` / `telemetry` / `extraKnowledge` → ✅ Called / ⚠️ Not configured or skipped / ❌ Call failed (review still completed)

---

### 🚦 Five-item self-check conclusion

| # | Check | Conclusion |
|---|-------|------------|
| 1 | Project config changes | `✅ Not involved` / `⚠️ Changed, explained` |
| 2 | Existing-logic changes | `✅ No changes` / `⚠️ Changed, N call sites assessed` |
| 3 | Money/points calculation | `✅ Not involved` / `⚠️ Involved, precision verified` |
| 4 | Dependency upgrades | `✅ Not involved` / `⚠️ Upgraded, changelog checked` |
| 5 | Exception handling | `✅ Handling complete` / `❌ Findings found [description]` |

---

### 🔴 Critical issues (P0 — must fix, blocks merge)

**[P0-1] [Issue type]**
- **Location**: [src/components/UserList.tsx:45]({{CODE_BASE_URL}}/blob/{{BRANCH}}/src/components/UserList.tsx#L45)
- **Basis**: Quick-reference card G4 / frontend-security-rules.md §1.1
- **Rule text**: `Do not inject external data into the DOM via dangerouslySetInnerHTML; sanitize first`
- **If unfixed**:
   ① Trigger: backend `content` is injected with a `<script>` tag (e.g. the comment API does not sanitize HTML)
   ② Observable: Cookie / Token of users who open the page is sent to an attacker server; monitoring shows many cross-origin requests to unknown domains
   ③ Scale: **all logged-in users** (anyone who opens the detail page), about 100k+ by page DAU
- **Fix cost**: `1 line`
- **Cross-file verification**: —  (this item is a single-file call; Q0 not triggered)
- **Problem code**:
  ```javascript
  // ❌ Current
  <div dangerouslySetInnerHTML={{ __html: content }} />
  ```
- **Fix**:
  ```javascript
  // ✅ Fixed
  import DOMPurify from 'dompurify';
  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
  ```

---

### 🟡 Suggested improvements (P1 — strongly recommended)

**[P1-1] [Improvement type]**
- **Location**: [src/hooks/useUserList.ts:23]({{CODE_BASE_URL}}/blob/{{BRANCH}}/src/hooks/useUserList.ts#L23)
- **Basis**: react-review-rules.md §1.1
- **Rule text**: `A useEffect dependency array must include every external variable referenced in the function body`
- **If unfixed**:
   ① Trigger: user switches userId via the route on the user-list page (not first entry)
   ② Observable: the list still shows the previous user's data; a manual refresh is required
   ③ Scale: all users on a multi-account switch path (about 15% of list-page PV)
- **Fix cost**: `1 line`
- **Cross-file verification**: `Grep pattern='useUserList' glob='**/*.{ts,tsx}' → 3 hits, sampled src/pages/admin/UserList.tsx:12, Read confirmed no sync change needed`
- **Problem code**:
  ```javascript
  // ❌ Current
  useEffect(() => { fetchData(userId); }, []);
  ```
- **Fix**:
  ```javascript
  // ✅ Fixed
  useEffect(() => { fetchData(userId); }, [userId]);
  ```

---

### 💡 Improvement suggestions (P2 — optional)

**[P2-1] [Suggestion type]**
- **Location**: [src/components/Button.tsx]({{CODE_BASE_URL}}/blob/{{BRANCH}}/src/components/Button.tsx)
- **Basis**: react-review-rules.md §3.1
- **Pending confirmation**: If the parent re-renders this component at high frequency (Grep the parent to confirm render frequency), consider wrapping with `React.memo`; if it only renders on route changes, no action needed
- **Fix cost**: `1 function`

---

### 🧐 AI dissonance list (required 3-5 items; "none" is not allowed)

> Do not look up rules or cite playbooks; output by intuition only. Exists independently alongside P0/P1/P2.
> Items later upgraded to P0/P1/P2 stay in this list, marked `→ Upgraded to Pn-N`.

1. **[src/utils/storage/types.ts:8]** — Off because: `StorageAdapter` allows both sync and async return values
   Explain: The interface defines `getItem: (key) => string | null | Promise<string | null>`; the implementation (line 14) returns only a sync value, but the caller (index.ts:54) always `await`s. Three sides disagree — either narrow to sync or narrow to async; today it is a design that leans on neither. Ask the author: should this interface support both sync and async storage? If not, narrow it.

2. **[src/pages/xxx.tsx:47]** — Off because: the whole-file change does not match the PR title's "add customerDTO submit" goal
   Explain: Reverting these changes still satisfies PR intent; the author must explain why they are here.

3. **[src/components/yyy.tsx:125]** — Off because: old/new copy branches reach 4 variants, but product should need only one
   Explain: Likely leftover error-code distinction (NO_CUSTOMER vs NO_SELECTED_CUSTOMER) that no longer matters; recommend merge and simplify.

(Examples stop here; actually write 3-5 items)

---

### 📊 Overall assessment

| Dimension | Score | Main findings |
|-----------|-------|---------------|
| Security | ⭐⭐⭐⭐☆ | (any XSS / secret / injection risk) |
| Performance | ⭐⭐⭐⭐☆ | (any N+1 / useless re-renders / whole-package imports) |
| Robustness | ⭐⭐⭐⭐☆ | (boundary handling / loading-error states / exception handling) |
| Reuse | ⭐⭐⭐⭐☆ | (any duplicated logic / parameterizable hardcoding) |
| Architecture compliance | ⭐⭐⭐⭐☆ | (are responsibilities clear / any cross-layer deps) |
| Maintainability | ⭐⭐⭐⭐☆ | (magic numbers / config coupling / extension-point design) |

**Merge conclusion**: [P0 count] P0 blockers / [one-sentence merge recommendation]

---

### 🔁 Skill feedback (fill only when there is a signal)

> This block helps the skill evolve. Delete the section if empty.

- **False positive**: (items AI reported that the developer confirmed are fine; brief reason)
- **Miss**: (historical pits / real bugs mentioned in this review that AI did not identify)
- **New pattern**: (new problem patterns in the code worth adding to the playbook)
