# Language and rule mapping

`content.json` `service[].language` identifies the repo programming language and determines the rule set and detection strategy. Two mainstream scenarios are supported today:

| Scenario | language value | AST scan (strategy=8) | Business detection (strategy=11) | content code-block tag |
|---|---|---|---|---|
| Java backend (default) | `java` | ✅ Run (Java AST / Semgrep rule set, whole-repo scan) | Regular Call chain (dependency package / RPC interface) | ` ```java ` |
| Frontend project | `javascript` / `typescript` | ❌ **Skip** (current AST rules apply only to Java) | Degrade to module-import analysis; cross-repo identification uses npm / monorepo | ` ```typescript ` / ` ```javascript ` / ` ```vue ` |

## Writeback template language-tag requirements

- When the Agent writes fix/improvement code blocks in the `content` field, it **must use the project's actual language tag**. Do not hard-code ` ```java `.
- For Vue components use ` ```vue `; for React Hooks use ` ```typescript ` or ` ```javascript `; for CSS-related defects use ` ```css `.
- `open_validate.ts` only validates the content prefix format and thinking length; it does not validate code-block language tags. That does not mean you may fill them arbitrarily. The code-block language tag must match the project language, or report readers will misread the snippet.
