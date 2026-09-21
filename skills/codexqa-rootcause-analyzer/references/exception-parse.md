# Exception parse

`parse-exception` writes `data/<taskId>/parsed.json`. `run` / `submit` already do this. Do not re-parse by hand unless `parsed.json` is missing or the CLI is wrong. On the happy path, use `facts.json` / `brief.json` instead of interpreting `parsed.json`.

## Fields

| Field | Meaning |
|---|---|
| `exceptionType` | Top-level type (`NullPointerException`, `ValueError`, `Error`) |
| `message` | Message after the first colon / `Error:` |
| `causes[]` | `Caused by` / chained exceptions |
| `frames[]` | All parsed frames |
| `appFrames[]` | Frames not classified as JDK / framework / runtime internals |
| `primaryFrame` | Throw site: first app frame for Java/Node, last app frame for Python |

Each frame: `raw`, `language`, `className`, `methodName`, `file`, `line`, `library`, `key` (`Class#method` when both exist). Class-only frames have `methodName` and `line` null.

## Languages

- **Java**: `at com.foo.Bar.baz(Bar.java:12)` including `Caused by` / `Suppressed`.
- **Python**: `File "x.py", line N, in name` plus the final `Type: message`.
- **Node / generic**: `at fn (/path/file.js:12:3)` and `file:line` fallbacks.

## Truncated Java stacks

Keep `→ Class` tails as class-only frames. Do **not** invent `Class#search:1` (or other placeholder methods) for those tails; the parser collapses that pattern when arrows exist.

JDBC / Druid / Zebra / mtthrift interceptors / `$Client` stubs are **library** frames, not app frames.

## Ranking

1. Use **appFrames** for CodexQA lookup (cap applied by `analyze-frames`).
2. Keep library frames as **context** (trigger inside JDK/Spring is still usually an app contract bug).
3. Do not treat a library frame as the root cause unless no app frame exists.

## Weak evidence

If parse yields zero frames, still diagnose from the exception type/message and repo search; say so in Confidence and gaps.
