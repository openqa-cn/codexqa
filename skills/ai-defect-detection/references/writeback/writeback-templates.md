# Writeback fill-slot templates and required checklist

> This file collects all CLI/API fill-slot templates for `update-process` / `batch-update-process`.
> 💡 Template code-block examples default to ` ```java `. On real writeback you must replace them with the project language (frontend uses ` ```typescript ` / ` ```javascript ` / ` ```vue `, etc.). Same for filePath (Java: `src/main/.../Foo.java`; frontend: `src/components/Foo.vue`, etc.).

---

## Required-parameter lookup

| Strategy | Extra required params | Notes |
|------|-------------|------|
| **Generic** | `content: "No defect in this code"` | Fixed string; do not change |
| **Generic** | `thinking`: ≥30 chars | Must cite concrete line numbers / variable names |
| **Generic** | `processSteps[0].conclusion`: ≥10 chars | Do not use placeholders such as "no defect" |
| **strategy=8** | `astRuleCount: <N>` | N = AST rule count from get-rules; must be >0 |
| **strategy=11** (has test cases/docs) | `processSteps[0].referencedSources` | `[{sourceType:"tech_doc/prd_doc/test_case", sourceId:"...", sourceName:"..."}]` |
| **strategy=11** | thinking includes in-method logic analysis + Call chain `A#m → B#m → C#m` | fileCodes includes every class on the chain; Agent decides analysis depth by method difficulty |
| **Not strategy=8** | Run `register-code-read` first | Otherwise the code-read gate fires (validation rule 14) |

---

## Template A: bugStatus=2 (no defect)

```bash
--process-id <processId from get-pending>
--bug-status 2
--thinking "<required: at least 30 chars describing the analysis and why there is no defect>"
--content "No defect in this code"
--file-codes '[{"filePath":"<relative path (Java: src/main/.../Foo.java | frontend: src/components/Foo.vue)>","methodNames":["<method name>"],"git":"<SSH>","branch":"<branch>","commitId":"<commit>"}]'
--process-steps '[{"step":"first_round_detection","stepStatus":"executed","hasBug":false,"conclusion":"<substantive conclusion>","question":"<actual analysis prompt>"}]'
```

---

## Template B: bugStatus=6 (suspected defect)

> **content format**: separate fields with `\n\n` (blank lines). The report renderer splits sections on blank lines. Do not write one continuous paragraph.
> Reference: a verified defect-description format.

```bash
--process-id <processId from get-pending>
--bug-status 6
--tag-id <pick from $VALID_TAG_IDS>
--thinking "<required: detailed defect-discovery process, citing concrete line numbers and code>"
--content "Defect: <one-line title>\n\nLines: <start>-<end>\n\n[Introduction period: This change/Pre-existing]\n\n<detailed problem description: cite concrete code lines; say under what conditions what problem fires and which business is affected>\n\nAffected business: <concrete business feature/flow/scene and Impact scope>\n\nReproduction path: <call API A → pass param X → hit branch Y → produce error Z>\n\nFix suggestion: <fix direction>\n\n```<language>\n<fix code example>\n```"
--confidence-score <0.0~1.0>
--file-codes '[{"filePath":"<path>","methodNames":["<method>"],"git":"<SSH>","branch":"<branch>","commitId":"<commit>"}]'
--process-steps '[{"step":"first_round_detection","stepStatus":"executed","hasBug":true,"conclusion":"<defect conclusion>","question":"<analysis prompt>"}]'
```

**How content actually renders**:

````
Defect: Empty-list out-of-bounds risk

Lines: 87-90

[Introduction period: This change]

OrderCouponValidator#validate line 87 calls
coupons.get(0) when the transfer-coupon list is empty, throwing
IndexOutOfBoundsException. This change removed the original
isEmpty() guard. When upstream returns no transfer coupons, checkout redemption fails.

Affected business: validate is the checkout-redemption core method; empty-list OOB fails the whole order check.

Reproduction path: when transfer() returns an empty list, validate() line 87 always fires.

Fix suggestion: add an empty-list check before calling get(0).

```java
if (coupons == null || coupons.isEmpty()) {
    return ValidationResult.empty();
}
Coupon first = coupons.get(0);
```
````

---

## Template C: bugStatus=7 (Improvement)

> content format is the same as template B: separate fields with `\n\n` (blank lines). Do not write one continuous paragraph.

```bash
--process-id <processId from get-pending>
--bug-status 7
--tag-id <pick from $VALID_TAG_IDS>
--thinking "<required: explain why you recommend the improvement and what in the current code can be better>"
--content "Improvement: <one-line title>\n\nLines: <start>-<end>\n\n[Introduction period: This change/Pre-existing]\n\n<why the current writing is unreasonable: cite concrete code lines and scenes that may fail>\n\nAffected business: <involved feature/scene>\n\nCurrent impact: <it does not fail today, but under what conditions it might>\n\nImprovement plan: <change direction>\n\n```<language>\n<improved code example>\n```"
--confidence-score <0.0~1.0>
--file-codes '[{"filePath":"<path>","methodNames":["<method>"],"git":"<SSH>","branch":"<branch>","commitId":"<commit>"}]'
--process-steps '[{"step":"first_round_detection","stepStatus":"executed","hasBug":true,"conclusion":"<Improvement conclusion>","question":"<analysis prompt>"}]'
```

---

## Template D: batch item JSON (single / batch file mode)

> Used by `batch-update-process --items-json` or file mode. Fill `className` and `filePath` by project type (Java FQCN / frontend relative path).

```json
{
  "parentBatchId": 952025,
  "processId": 12345,
  "className": "com/example/MyService",
  "methodName": "doSomething",
  "bugStatus": 2,
  "strategyCode": 8,
  "thinking": "AST static scan of doSomething: scanned with 39 AST rules, no defect-pattern rule hit. No defect.",
  "content": "No defect in this code",
  "astRuleCount": 39,
  "fileCodes": [{"filePath": "src/main/.../MyService.java", "methodNames": ["doSomething"], "git": "...", "branch": "...", "commitId": "..."}],
  "processSteps": [{"step": "first_round_detection", "stepKey": "first_round_detection", "stepStatus": "executed", "hasBug": false, "conclusion": "doSomething passed AST scan of 39 rules with no defect-pattern hit; code is safe with no defect", "question": "Analyze whether doSomething has a defect"}]
}
```

---

## Template E: strategy=11 (business detection) Call-chain extras

content must include the full call path: `A#methodA(L12) → B#methodB(L45) → C#methodC(L88)`
fileCodes must include every class on the chain (at least 2–3 files)

---

## Template F: strategy=11 (business comparison) extras (when HAS_CASES/HAS_DOC)

Regardless of bugStatus 2/6/7, at least one processSteps step must include `referencedSources`:
```json
"referencedSources": [{"sourceType": "test_case", "sourceId": "<id>", "sourceName": "<title>"}]
```
Legal sourceType values: `prd_doc` / `tech_doc` / `test_case`

When bugStatus=6/7, content must include a test-case citation: `Test case ID: [<ID>](link)`

---

## Strategy extra: strategy=8 (AST rules)

```bash
--ast-rule-count <rule count, must be >0>
--hit-rule-ids '["<hit rule IDs>"]'   (required when there is a defect)
```

```json
{
  "processSteps": [
    {"step": "exclusion_rule_filter", "stepStatus": "executed", "hasBug": false, "conclusion": "..."},
    {"step": "llm_validation", "stepStatus": "executed", "hasBug": false, "conclusion": "..."}
  ]
}
```
