# SAST suspect pass

Run on `27-suspect-queue.json` → `sast_packets` when that queue exists. Otherwise
run only on `23-sast-signals.json` → `suspects[]`. Do not open the rest of the
repository to re-find a SAST class. Findings with `disposition: report` are
already cards, including dependency alerts (`triage_channel: sca`) and
secret-scanner hits. A SAST row with no `disposition` is unstamped: re-run
`derive-sast.sh` before review. Do not treat it as report and do not drop it.
Findings with `disposition: drop` are discarded. Do not
rediscover either, and do not put a CVE or a style note through this pass.

## Input for each suspect

- `suspect_id`, `file`, `line`
- `slice` (about forty lines around the hit, already cut)
- `policy`: `look_for`, `do_not_report`, `fix`, `noncompliant`, `compliant`

## Decision

Answer true positive or false positive for that slice only.

- True positive when the slice matches `look_for` and does not match `do_not_report`.
- False positive when a sanitizer or guard in the slice matches `do_not_report` or `compliant`.

## Output

Write true positives into `llm-candidates.json` (`p0` / `p1` / `p2`) with:

- `source`: `llm_judgment`
- `suspect_id`: copied from the packet
- `pattern_class`: the suspect’s class
- `file`, `line`, `title`, `title_en`, `risk`, `risk_en`, `fix`, `fix_en`
- `category`: `security`

A candidate without `suspect_id` is dropped at merge. Do not add business-logic
rules (`BIZ-*`, `PAY-*`, `TXN-001`, `CONC-*`) in this pass.
