# Low-Code Page / Groovy Page DSL Review Rules

> Load when the diff touches a Groovy page config package: `struct.groovy`, `dataSourceMap.groovy`, `constData.groovy`, `logics.groovy`, `componentsMap.json`, `pageBuildConfig.json`, or `*.groovy` in the same directory as `componentsMap.json`.
> Interpret the runtime as **Groovy 2.4** (not Groovy 3, and not browser JavaScript). Examples use `customerId` and role-named bindings; map them to the names the target repo actually exports.

## 📋 Rule Quick-Reference Index (scan this table first, then read details as needed)

| Section | Rule | Severity | Quick identification |
|------|------|------|------------|
| §1 | Core files and single responsibility | P1 | Missing structure / data-source / component-map files; files writing each other's concerns |
| §2 | Groovy 2.4 variables and banned syntax | P1 | `var` / `===` / `?=` / `try` / `switch` / `"${}"` |
| §3 | `?.` must be chained | P1 | `dataSource.data.extra.foo` or `a?.b.c` |
| §4 | `?:` treats `0` as false | P1 | Quantity/amount using `?: 1` may swallow `0` |
| §5 | Closures and literals | P2 | More than about 3 lines of complex math in component props |
| §6 | Page-tree nodes | P1 | `node` without `label`; prop type does not match value; nesting >5 levels |
| §7 | Complete data sources | P1 | Missing request inputs / response mapping / error state |
| §8 | Constants and lifecycle | P1 | Init constants reference live data sources or action payloads; `condition` is not boolean |
| §9 | Performance and sensitive data | P1 | Loops trigger a full-page refresh; phone numbers unmasked |
| §10 | Custom components and dependency versions | P1 | Component missing prop types; `dependencies` set to `latest` |

Runtime roles in the examples (rename to match the target repo):

| Role | Meaning |
|------|------|
| `pageQuery` | URL / entry query on first enter |
| `runtime` | Session or environment bag |
| `dataSource` | Current request/response |
| `tree` | Component-tree bindings |
| `action` | User-action payload on refresh |
| `lastData` | Previous response kept for the next refresh |
| `CONST` | Values computed once in `constData.groovy` |

---

## 1. Core Files and Single Responsibility

A same-directory page package usually includes:

| File | Responsibility |
|------|------|
| `struct.groovy` | Component tree, props mapping, render conditions |
| `dataSourceMap.groovy` | Data-source id, request inputs, response mapping, error state |
| `componentsMap.json` | Component name → implementation |
| `pageBuildConfig.json` | Build config |
| `constData.groovy` | Init-time constants (optional) |
| `logics.groovy` | Preview / refresh / submit callbacks (optional) |

Core files required for the build are missing → **P1**. Do not put large data transforms in `struct.groovy` (extract them to `constData` / `logics`).

---

## 2. Groovy 2.4 Variables and Banned Syntax

Declare variables with `def`. Do not use `var` or Java-style type declarations (the 2.4.x page parser often does not support them).

```groovy
// ✅
def query = pageQuery
def customerId = query?.customerId ?: ''

// ❌
var customerId = 'x'
String customerId = 'x'
```

**Banned** (requires Groovy 3, or is unsupported by this DSL):

- `===` / `!==`
- `?=` fallback assignment
- `a?[b]` safe subscript (use `a?.getAt(b)` instead)
- `**` exponentiation (behavior differs from JavaScript)
- `=~` / `==~`
- `try-catch-finally`, `while` / `do-while`, `switch-case`, bitwise operators
- String interpolation `"${expr}"` (binds extra context)

```groovy
// ✅ safe subscript
def item = lastData?.itemMap?.getAt(mapKey)
```

---

## 3. `?.` Must Be Chained

Every segment of a path that may be null must use `?.`. `a?.b.c` can still blow up when `a` is null (`c` is a bare access).

```groovy
// ❌
dataSource.data.extra.submitText
tree.OfferModule.props
a?.b.c

// ✅
dataSource.data?.extra?.submitText
tree?.OfferModule?.props ?: [:]
a?.b?.c
```

---

## 4. `?:` Treats 0 as False

Groovy `?:` follows Groovy Truth: `0`, `''`, `[]`, and `[:]` are all false and are replaced by the right-hand default. Do not use `?:` for quantity, amount, or status codes to mean "default only when null".

```groovy
// ❌ quantity 0 becomes 1
def quantity = action?.quantity ?: 1

// ✅ default only for null
def quantity = action?.quantity != null ? action.quantity : 1
```

Other differences from JavaScript (writing JS semantics → **P1**):

- Groovy `==` uses `equals` (deep equality), not JavaScript's loose `==`
- Empty `[]` / `[:]` are false in Groovy; empty arrays/objects are true in JavaScript
- Groovy `&&` / `||` yield a boolean; they do not return an operand
- Do not break before a binary operator: `1\n+2` is two statements in Groovy, not `1+2`
- When you need a boolean, use `!!expr` or a ternary; do not use JavaScript "or-default" to pick an object

```groovy
condition {{ !!dataSource.data?.experimentList }}
def source = CONST?.isGroup ? 'detail' : 'list'
```

---

## 5. Closures and Literals

Closures use `{ params -> body }`. Maps use `[key: value]`; lists use `[a, b]`. Groovy keywords cannot be unquoted map keys (for example `return`).

Keep component prop expressions short; move calculations longer than about 3 lines into `constData.groovy` and only reference `CONST.xxx` in the structure. Record as **P2**.

```groovy
// constData.groovy
constData {
  object('envParam') {{ [platform: runtime?.platform ?: 'other'] }}
  object('track') {{ [channel: 'web', customerId: pageQuery?.customerId] }}
}

// struct.groovy
props {
  string('channelName') {{ CONST.track.channel }}
}
```

---

## 6. Page-Tree Nodes

```groovy
node('TimeSelectModule', '100') {
  label 'Time select'
  props {
    object('dateInfo') {{ dataSource.data?.dateInfo ?: [:] }}
    number('quantity') {{ dataSource.data?.quantity != null ? dataSource.data.quantity : 1 }}
  }
}
```

Checkpoints:

- Node ids are globally unique across `struct.groovy` and `logics.groovy`
- There must be a readable `label`
- Component names match `componentsMap.json`; PascalCase, not `comp1`
- Prop types are only `string` / `number` / `bool` / `object` / `array`, and they match the expression result (do not mark an object as `string`)
- Render with `condition` / `visible`; avoid always-true / always-false
- Component tree deeper than 5 levels → **P2**

---

## 7. Complete Data Sources

`dataSourceMap.groovy` usually includes a data-source id, request inputs (preview / refresh / submit), a response mapping written to `lastData`, and an error state. Field names follow the target repo's existing convention.

```groovy
dataSource {
  dataSourceId '16'
  requestProps {
    object('previewRequest') {{
      def query = pageQuery
      [
        *: CONST.envParam,
        customerId: query?.customerId,
        quantity: action?.quantity != null ? action.quantity : 1,
      ]
    }}
  }
  currentData {
    object('offer') {{ dataSource.data?.offer ?: [:] }}
    string('customerId') {{ dataSource.data?.customerId ?: '' }}
  }
  errorStatus {
    bool('isError') {{ dataSource?.code != 200 }}
    string('errorMsg') {{ dataSource?.msg ?: dataSource?.message ?: '' }}
    showError true
    skipStructOnError true
  }
}
```

Checkpoints:

- Preview / refresh / submit inputs must not omit required fields; serialize Map/List with the runtime JSON serializer; do not pass null
- Action payloads always use `?.`; priority is usually action payload > component props > default
- Response-mapping types and paths match the API
- Error state must distinguish network failure from business failure; preview failure may mean the structure tree should not be returned
- Submit inputs are usually a superset of preview (payment, contact, etc.); missing them → **P1**

---

## 8. Constants and Lifecycle

`constData` is computed once at init.

- May reference: page query, runtime / session context
- **Must not reference**: live `dataSource`, component `tree`, action payloads, `lastData`
- Nested fields on the runtime bag must be defaulted before `?.`

`logics.groovy` uses `node` plus hooks such as `on('preview.onSuccess')`. Common phases: `preview|update|submit` × `onResponse|onSuccess|onFail` (or follow the target repo docs).

```groovy
node('PageLifecycle', '13') {
  label 'Page lifecycle'
  on('preview.onSuccess') {
    callMethod('EventTrack', 'trackView')
    condition {{ !!dataSource.data?.experimentList }}
    props {
      string('customerId') {{ CONST.track.customerId }}
    }
  }
}

node('EventTrack', '16') {
  label 'Event tracking'
}
```

The `callMethod` target must have a matching `node` in this file; `condition` must be boolean (use `!!`). Node ids must not collide with `struct.groovy`.

---

## 9. Performance and Sensitive Data

- A full-page refresh re-requests the API: do not trigger it in a loop; keep pure UI changes in client state
- Extract repeated request-input calculations into `def` locals
- Serialize only Map/List; do not serialize null
- Mask phone numbers and government-issued ID numbers in expressions; do not put plaintext into props
- Do not pack unused environment fields (location, profile) into the page build; they slow the first screen

---

## 10. Custom Components and Dependency Versions

If the diff includes custom components (TS/JS) or `dependencies.json`:

- Prop types are complete, including host passthrough bags this DSL needs
- Preview / refresh / submit must go through the DSL lifecycle with context and action payloads; do not bypass with raw business HTTP
- Styles should cover every surface the page declares; do not use properties private to one surface only
- Business rules go through props; do not hardcode them inside the component
- Public prop / event contracts match the implementation parameters
- Pin dependency versions; ban `latest` or overly wide ranges
