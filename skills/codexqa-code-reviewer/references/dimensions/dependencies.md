# Dimension card: Dependencies (supply chain)

Source: [Codacy — Proper Use Of Dependencies](https://blog.codacy.com/code-review-checklist);
DEV 2025 Security supply-chain practices.

| Field | Value |
|---|---|
| id | `dependencies` |
| title | Dependencies / supply chain |
| order | 3 |
| modes | pr, full |
| finding_category | `dependencies` |
| algorithm | derive (`12-dependency-signals.json`) + reuse `04-changed-files` + on-disk manifests |
| max_extra_codexqa | **0** |

## Questions (must attempt)

1. **Necessity** — Are new/upgraded dependencies justified by this change, or drive-by bloat?
2. **Reproducibility** — SNAPSHOT / floating / unpinned git versions; lockfile co-changed?
3. **License clues** — Manifest license fields present and not obviously empty/`UNLICENSED`? (not a legal opinion)
4. **Vuln posture** — Any **local** audit artifact? If none, residual: run org SCA out-of-band — **never invent CVEs**.
5. **Transitive bloat** — Large lock growth or many direct adds?

## Split vs Security

| Security (existing) | Dependencies (this card) |
|---|---|
| Auth, secrets, injection, sensitive paths | Third-party package intake & build reproducibility |
| `category: security` | `category: dependencies` |

Do **not** re-litigate injection/XSS here. Supply-chain package risk stays `dependencies`.

## Soft thresholds (auditable heuristics)

| Signal | Attention | Elevated |
|---|---|---|
| `-SNAPSHOT` **substring** (not suffix-only) / `latest` / exact version token `*` (quoted `"*"` / `'*'` — **not** `contains("*")` on ranges like `1.0.*`) / unpinned `git+https?://` **or** bare `https?://….git`; npm scan **all** of `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` (parse regex must accept peer, not only a scopes constant). **Also** scan changed **source** files for SNAPSHOT/latest/git+ string literals (`kind: source_string_floating`) — not manifests-only | P2 | Release/prod packaging path (any path **segment** such as `…/release/…`, not only prefix/suffix) → P1 |
| `import org.apache.commons.lang.` (2.x, not `lang3`), Python `imp` / `optparse`, Go `io/ioutil`, or `require("request")` in a changed source file. A pom is not required for the hit | P2 | — |
| Direct **add** deps **≥ 8** (inclusive) or lock new lines **≥ 200** (inclusive) | P2 | Entry **or** pay surfaces → may raise P1 (OR, not AND) |
| **npm `package.json` only:** license empty / `UNLICENSED` / `NONE` / values **starting with** `SEE LICENSE IN` (not whole-string equals only); recognize `license` **and** `licenses`. Do **not** apply this field check to pom/gradle/go/etc. | P2 | — |
| Local audit JSON with high/critical | — | **P1** (not P0); no invented advisory/CVE/NVD URLs |
| Bulk adds misaligned with `review_language_focus` ecosystem (Java → maven **or** gradle) | P2 | — |

Confidence default `medium`. No network NVD/OSV in collect.

## When reviewing supply-chain **checker / rule-engine** code

If the change **implements** dependency/SCA/lock/license rules (not only consumes manifests), open the rule methods and **diff the body against this card** (Soft thresholds + Non-goals + Split vs Security). Do not stop at Design/Complexity hotspots alone. At minimum verify:

1. Operators are inclusive where the table says **≥** (`>=`, not `>`); entry/pay escalate uses **OR**, not AND.
2. SNAPSHOT / floating: substring (or word-boundary), not `endsWith("-SNAPSHOT")` only; floating `*` is exact version token, not `String.contains("*")` (false-positives ranges like `1.0.*`); unpinned git covers `git+https?://` **and** bare `https?://….git`.
3. Line-scan floating helpers use `Matcher.find()` / `search` (substring), **not** `Matcher.matches()` (whole-line) — otherwise `version := +` with surrounding text never hits.
4. npm floating: **parse** regex / scope starter must include `peerDependencies` (and optional); a scopes-to-scan constant that lists peer while the parser omits it is still a miss.
5. Lock drift fires when lock is missing from the **change set**, even if a lock file exists on disk.
6. Manifest/lock **whitelist parity** with this skill’s derive set: `MANIFEST_NAMES` must include `build.gradle.kts` (no orphan `LOCK_COMPANIONS` entry without whitelist); `pyproject.toml` → `poetry.lock` **and** `uv.lock`; `LOCK_FILE_NAMES` must list every companion used for drift/bloat.
7. License clues: npm `package.json` only; `license` **and** `licenses`; weak values via `startsWith("SEE LICENSE IN")`.
8. Finding `category` is always `dependencies` (never re-badge as `security` / `license` for supply-chain rules).
9. No audit artifact → residual SCA / `present:false` — **never** claim `no_known_vulnerabilities`.
10. Local high/critical → at most P1; **no** hardcoded NVD/OSV/advisory URLs; audit basename discovery uses **contains** `audit` / `osv` (not `startsWith("osv")` only — e.g. `pkg-osv-report.json`).
11. Necessity: expected ecosystems from language focus only (Java → maven **or** gradle); do **not** union with observed ecosystems (that neuters mismatch).
12. Evidence resolution: PR → changed files (or equivalent change set); full → sample / bounded root enum — do not swap the two; root enum must not recurse into `node_modules` (or equivalent vendor trees); line cap is **≤** 8000 inclusive.
13. Thin/no-hit path must be explicit **None** in **both** pr and full modes; review checklists that list dimensions must include **Reproducibility**.

Missed threshold/polarity bugs here are correctness findings on the checker, even when `12-dependency-signals.json` is thin for the PR.

## Evidence map

| Signal | Source |
|---|---|
| Changed manifests | `04-changed-files.json` basename whitelist |
| File bodies / locks | `manifest.repo` or `--repo` bounded read |
| Language focus (necessity heuristic) | `09-language-profile.json` optional |
| Local audit | Repo-root / pack-adjacent JSON whose basename **contains** `audit` or `osv` (optional) |

## Severity

| Default | Escalate | Almost never P0 |
|---|---|---|
| P2 | Lock drift on release train; SNAPSHOT on prod path; local critical audit | P0 left to confirmed exploitable CVE via org SCA / Security |

## Output

- Always evaluate Dependencies into `review-conclusion.json` (findings **or** `ok`/`none`
  + short signal summary from `12-dependency-signals.json`).
- **Report/HTML:** include only when `verdict` is `concern`/`unknown` (omit clean).
  Concern cards **must** include `risk`（具体代码风险说明）.
- Optional `dependencies` object on `review-conclusion.json` (see template).
- Include `dependencies` in `dimensions_covered`.

## Non-goals

- No online CVE database calls; no inventing advisory IDs.
- No `node_modules` / full tree walk.
- No extra CodexQA; no raising `TOP_N`.
- Missing `12-…` → thin review or None; validate WARN only.

## skip_when

- Blocked pack / missing CodexQA engine.
- Empty change-groups (PR) → blocked before dimensions.
- No dependency-manifest hits and empty `eol_imports` → explicit None (not a failure).
- Non-empty `eol_imports` is a dependency finding even when `manifest_hits` is empty.
