# Compatibility and verification status

[简体中文](SUPPORT_MATRIX.zh-CN.md)

Installation compatibility does not establish analysis quality. Record agent/model, runtime, OS, commit, and actual outcome before expanding a support claim.

| Component | Current evidence | Limitations |
| --- | --- | --- |
| TypeScript CLI | Local suite previously passed 94 tests on macOS, Node 22.15.0 with TypeScript stripping | Results cover tested behaviors, not all defects |
| Linux / Node 22 | CI job configured in this repository | Hosted result must be checked after pushing |
| Codex, Claude Code, Cursor, OpenClaw | Skill instructions name these hosts | Complete host-by-host review runs are pending |
| Java method / call graph | Extraction and GitNexus integration code and tests | External tool results depend on its version and environment |
| Other languages / frontend | AST scope and frontend processing paths exist | No comprehensive language or framework support claim |
| Local providers | Task lifecycle, fixtures, reports, and writeback tests | Concurrent or multi-user operation is not certified |
| HTTP / GitHub providers | Adapter implementation and selected HTTP contract tests | Real deployment credentials and integration verification required |
| ZIP packaging | Pack/unpack smoke test | Requires Bash, rsync, zip, unzip |
| Windows | Not verified | Shell commands and test script are currently POSIX-oriented |
| Evidence schema | Repository schema available | Skill output is not claimed to conform automatically |

No public precision/recall benchmark or complete agent-generated demo is claimed. See [examples](../examples/README.md) and [benchmark methodology](../benchmarks/README.md).
