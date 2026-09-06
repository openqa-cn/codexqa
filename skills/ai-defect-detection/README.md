# AI Defect Detection Skill

Agent-led static and business-logic defect detection for pull requests and test plans. This experimental package combines agent instructions with a TypeScript CLI and pluggable providers. Complete agent workflows and detection accuracy are not yet independently benchmarked.

## What you get

- A complete CLI (`open_detect.ts`) for task create → clone/diff → analyze → write-back → report → user feedback
- A **local platform** that persists tasks, processes, ranks, tags, and rules on disk — usable without any private backend
- Adapters for HTTP quality platforms, GitHub Issues, local/remote test plans, test cases, and documents
- The original validation gates (`open_validate.ts`) so write-backs stay structured

## Requirements

- Node.js: tested on 22.15.0 with `NODE_OPTIONS=--experimental-strip-types`
- `git` on `PATH`
- Network may be used for repository cloning, remote providers, document fetching, tool installation, and the host agent/model
- **Java call-graph (default path):** GitNexus CLI (`gitnexus analyze`) with CLI queries or optional MCP tools (`impact` / `context`). If the CLI is missing, the skill **installs GitNexus once** (`npm install -g gitnexus@latest`). Only if that install (and one agent retry) fails does it fall back to grep.

No extra npm packages are required for local mode. GitNexus is a local analyzer; it does not need a company backend.

## Quick start

See the [installation guide](https://github.com/openqa-cn/openqa-skills/blob/main/docs/GETTING_STARTED.md), [support matrix](https://github.com/openqa-cn/openqa-skills/blob/main/docs/SUPPORT_MATRIX.md), and [data-handling FAQ](https://github.com/openqa-cn/openqa-skills/blob/main/docs/FAQ.md). The `acme` addresses below are placeholders, not a runnable demo repository. For runnable examples use the [checkout fixture](https://github.com/openqa-cn/openqa-skills/blob/main/examples/checkout-boundary/README.md) or the CLI smoke suite.

```bash
cd ai-defect-detection
export NODE_OPTIONS=--experimental-strip-types
cp config.example.yaml config.yaml

node open_detect.ts submit-git \
  --git git@github.com:acme/order-service.git \
  --branch feature/demo \
  --submit-user alice

node open_detect.ts get-plan-info --plan-id 1001 --plan-type 2
# No enterprise/plans/{id}.json? Still exit 0. Pass chat materials:
node open_detect.ts get-plan-info --plan-id 999 --plan-type 2 \
  --git git@github.com:acme/order-service.git --branch feature/demo
node open_detect.ts get-tag-list
node open_detect.ts status --task-id 1
```

Sample enterprise data lives in `enterprise/` (plan 1001, one test case, requirement doc `docs/checkout-rules.md`, technical note `docs/checkout-api.md`). Local mode treats those files as optional seeds: `get-plan-info` / `get-delivery-defects` / `get-exception-traces` degrade to user materials or an empty payload instead of failing.

Local `get-tag-list` / `get-rules` are seeded from `providers/platform/seed_catalog.ts`: a rewritten open catalog (tree tags, Semgrep AST rules, AI rules, exclusion rules, frontend rules). It is **not** a dump of any private production corpus. HTTP platforms keep serving their own `/v1/tags` and `/v1/rules`.

## Configure another company

See [docs/adapters.md](docs/adapters.md), [docs/platform-api.md](docs/platform-api.md), and [docs/enterprise-http-api.md](docs/enterprise-http-api.md) (reserved slots for plans, cases, wiki, tickets, traces).

Typical remote setup:

```bash
export DETECTION_PLATFORM_KIND=http
export DETECTION_PLATFORM_BASE_URL=https://quality.example.com
export DETECTION_ENTERPRISE_BASE_URL=https://gateway.example.com
export DETECTION_PLAN_KIND=http
export DETECTION_TESTCASE_KIND=http
export DETECTION_DOCS_KIND=http
export DETECTION_ISSUES_KIND=http
export DETECTION_TRACES_KIND=http
export DETECTION_TOKEN=your-token
```

## Agent instructions

`SKILL.md` is the entry for an AI agent. Phase files and `references/` are loaded on demand.

Human / operator walkthrough (install → trigger → degrade materials → HTTP slots → feedback): [operator-manual.md](operator-manual.md).

## Tests

```bash
npm test
```

## License

Apache License 2.0. See [LICENSE](LICENSE).

## OpenQA contribution

### User problem

Reviewers need a repeatable way to find code and business-logic defects in a pull request, test plan, release plan, or existing detection task.

### Acceptance criteria

- Sample plan loading and task lifecycle are reproducible through CLI tests.
- A [known-good/seeded-defect fixture](https://github.com/openqa-cn/openqa-skills/blob/main/examples/checkout-boundary/README.md) has executable expected results; agent detection evaluation remains pending.
- Write-back validation rejects malformed findings and preserves local evidence.
- The report states coverage, rank, and residual risk.

### Compatibility

| Component | Status | Version / notes |
| --- | --- | --- |
| Node.js | Locally tested | 22.15.0 with TypeScript stripping |
| Git | Required | Needed for repository and diff analysis |
| Java call graph | Optional | GitNexus; grep fallback is available |
| Remote platforms | Optional | HTTP adapters require configured credentials |

### Limitations

The skill cannot prove the absence of defects, infer unavailable business rules, or replace human maintainer and security review. Remote providers and GitNexus depend on the configured environment.
