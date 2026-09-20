# Incremental end standard and format

## Source-standard boundary

This file only describes how Incremental consumes already-frozen end standards; it is not a copy of the three-end templates.

- The only allowed sources are this repo's three templates: `case-tpl-server.md`, `case-tpl-app.md`, and `case-tpl-web.md`.
- Only the top-level Chapter 3 may be read; freeze it first with `freeze_case_standard.py`.
- When generating or modifying cases for an end, read only that end's Chapter 3 snapshot.
- `MODIFY`, `ADD`, `SPLIT`, and `MERGE` must have the corresponding end's Chapter 3 snapshot, standard profile, and `standardRefs`.

## Both constraints hold at once

Treat each `platform + sourceId` independently. The latest cases must satisfy both:

1. The authoritative case-generation standard of the corresponding end.
2. That source baseline's file layout, file type, field positions, field order, line breaks, and unmodified-content retention requirements.

When the two conflict, the Agent must explain and block the corresponding end or request confirmation.

## End types

The Agent judges from the primary execution entry:

- `app`: APP pages, mobile gestures, native components.
- `web`: browser, PC pages, Web components.
- `server`: HTTP, RPC, MQ, DB, cache, configuration, or scheduled tasks.

Do not automatically add `server` when interfaces, DB, cache, or logs are only APP/Web result-verification surfaces.

## Standard profile and format profile

Write the standard profile to `artifacts/standards/{platform}/{sourceId}/standard-profile.json`. Write the format profile to `artifacts/case-format/{platform}/{sourceId}/format-profile.json`, and at least state `formatType`, `entryFiles`, case boundaries, case-ID location, field or section order, line breaks, directory and file naming, how unmodified content is retained, and the output layout.

Do not first normalize to a unified case structure and then force generation.

## Container placement for new target cases

New targets mean `ADD`, and every target case produced by `SPLIT` or `MERGE`. The Agent must record source-level, reusable container rules:

- The actual case container and its type, selection conditions, and how a real case is judged.
- The container's stable boundary and insertion strategy, and the protection scope outside the container.
- The ends, sources, directory layouts, and file types this rule applies to.

This project's default containers:

- Server: the large case table in `testcase_srv.md`; insert new rows immediately after the last real case; do not land after the post-table separator, statistics, or notes.
- APP / Web: add a record in the case area of the correct index table, and create a detail file whose path matches the index.

When the same file has multiple tables or sections, do not treat “the last table” or “the end of the file” as the default write location. Block that end when unique placement cannot be determined.

Before delivery, record the aggregated validation conclusion in `delivery-manifest.json.selfCheck`. If a temporary write script must be generated, pass the target file, container boundary, and before/after anchors as explicit inputs.

## Final-result fidelity of basic statistics

`DIFF_ENHANCEMENT` must write the final results back to `Total case count` and `Enhanced cases`:

- Recalculate `Total case count` from the final real, parseable, and unique case entries. Count APP / Web by the result that is consistent between index and details.
- If APP / Web has both a top summary and a `Total case count` in the basic-statistics table, keep the two in sync.
- For `Enhanced cases`, output only items whose count is greater than 0 among “added, modified, split, merged, kept, pending confirmation, pending deletion”.
- Each final case may belong to only one action state; the sum of the state counts must equal the final total case count.
- Keep the `New cases` statistics row as the baseline original text. Block when a unique statistics table cannot be found; do not guess or rebuild the section.

## Heterogeneous-format handling

Different table headers are not an error. No baseline exists only when explicit cases, `cases`, and `initialcase` are all unavailable; then return to [postsubmit-bootstrap.md](../postsubmit-bootstrap.md), and do not treat `procase` as a baseline. Block only the corresponding end for a source that cannot be understood.

## Environment context

`test_env` is control context. After it is archived, forced environment review is triggered, and it applies equally to both execution modes. Map items to the Preconditions “environment ID” (see [shared-rules.md](../shared-rules.md) “Current field names and read normalization”).

- Cover every final case of every current target `platform + sourceId`, including `KEEP` and new targets.
- When it is not provided, record that explicitly; do not fabricate.
- Each “case × environment item” must have `APPLY`, `SKIP`, or `NEED_CONFIRM`.
- Default to applicable; `SKIP` is allowed only for: already-equivalent information, unrelated functional domain, or applicable only to another end.
- Treat “environment ID” and its historical synonym labels as the same field; `SKIP` when an equivalent current field already exists.
- `APPLY` changes only that environment field: change the label to “environment ID” and write the value, merge minimally, and keep unrelated text verbatim.
- Change historical service-identifier labels in existing-case steps to `serviceId` on `MODIFY` / `ADD`; do not change unrelated text.
- Pure environment supplementation promotes `KEEP` to `MODIFY`.
