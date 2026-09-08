# Async incident examples

Portable reproductions used by this skill. Full write-ups live in [playbook/incident-catalog.md](../playbook/incident-catalog.md).

## INC-002 — Promise stays pending

`new Promise` resolves only when `location.lat` is truthy. Latitude `0` is valid, so the constructor never settles and the page waits forever.

See incident-catalog case 2 and `playbook/async-failure-modes.md` §1.

## INC-004 — Promise used as a boolean

An `async` permission check is used in `&&` without `await`. The Promise object is truthy, so the guard always passes.

See incident-catalog case 4 and `playbook/async-failure-modes.md` §2.

## INC-005 — Unprotected `JSON.parse`

Invalid payload throws, later rendering never runs.

See incident-catalog case 5 and `playbook/javascript-review-rules.md` §5.
