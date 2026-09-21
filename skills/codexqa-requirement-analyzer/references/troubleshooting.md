# Troubleshooting

## Sources look outdated or version-mismatched

Do not mark `aligned`. Record recency/comparability in the audit, use `stale` on the register, and ask which version is authoritative.

## Apparent conflict is only a wording difference

Ask whether the observable failure differs. If behavior matches, do not raise a P0 `conflict`.

## The requirement is one vague sentence

Still ship a 7-section draft. Missing rules are `missing`; unobservable statements are `untestable`. List working assumptions in section 2. Do not invent SLAs or fields.

## A P0 item has no verification column

Then it is not ready as P0. Add an observable expected result, or demote it and mark `untestable`.
