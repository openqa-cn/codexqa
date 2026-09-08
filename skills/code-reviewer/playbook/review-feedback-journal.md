# CR Skill feedback journal

> **AI fill-in**: After each CR, if you hit any of the three cases below, append one record in the matching block. Do not edit existing records.
> **Maintenance**: When someone submits new records to this file via PR, fold high-frequency signals into the matching playbook. Do not collect from developer machines, and do not sync remotely.

---

## 📥 Type 1: False positive (AI reported a problem; the developer confirmed it is fine)

> Format: date | triggered rule | actual snippet | developer explanation | suggested action

<!--
Example:
### [2025-01-15] False positive: Promise stays pending
- **Triggered rule**: javascript-review-rules.md 1.1
- **Code**: `new Promise(resolve => { emitter.once('done', resolve) })`
- **AI judgment**: Missing reject path → P0
- **Developer explanation**: This is an event-driven Promise; the emitter is guaranteed to fire; reject is not needed
- **Suggested action**: Add an exception for "event-driven Promises" to the playbook
-->

---

## 📤 Type 2: Miss (AI did not find it; a real problem showed up after launch)

> Format: date | problem type | trigger scene | why it was missed | suggested rule to add

<!--
Example:
### [2025-01-20] Miss: race condition
- **Problem type**: Async race
- **Trigger scene**: Request fired in useEffect; fast tab switches let the old request overwrite the new result
- **Why missed**: async-failure-modes.md does not cover canceling requests in useEffect cleanup
- **Suggested add**: In react-review-rules.md, add "async requests inside useEffect must be canceled in cleanup"
-->

---

## 💡 Type 3: New pattern (AI found a valuable pattern in the code that the playbook does not cover)

> Format: date | pattern name | code example | risk level | suggested file to add it to

<!--
Example:
### [2025-01-22] New pattern: Object.keys enum walk is unsafe
- **Pattern name**: Object.keys on a TS enum includes numeric reverse mappings
- **Code**: `Object.keys(Status).forEach(...)` // includes numeric keys
- **Correct write**: `Object.values(Status).filter(v => typeof v === 'string')`
- **Risk level**: P1 (iteration result is not what you expect)
- **Suggested add**: typescript-review-rules.md enum section
-->

---

## 📊 Stats summary (skill maintainer fills this)

| Period | False positives | Misses | New patterns | Handled |
|--------|-----------------|--------|--------------|---------|
| Example: 2025-Q1 | 3 | 1 | 2 | ✅ Updated V5.1 |

---

## 🔄 Skill changelog

| Version | Update | Source |
|---------|--------|--------|
| V5 | Added JS/TS standard library, fixed empty Security shell, added feedback loop | maintainer |
