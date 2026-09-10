# Test Case Generation

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

Open-source Agent Skill for generating and updating structured **manual test cases** from local PRD, technical design, API specs, and optional knowledge files.

What a finished case looks like (Markdown rendered):

<p align="center">
  <a href="https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/testcase-sample.html"><img src="https://raw.githubusercontent.com/openqa-cn/codexqa/main/docs/assets/previews/testcase-sample.png" alt="Sample generated manual test case" width="880"></a>
</p>

**Input is documents, not a git clone.** Generate reads `prd/` (and optional `knowledge/`). `code/` is used only on **update**, to diff what changed and decide which existing cases are affected — not to invent schemas or fill test data.

## What it does

1. **Generate** — analyze requirements, design coverage, query interface contracts, write Markdown cases with unique IDs.
2. **Update** — detect PRD/code diffs, locate affected cases, incrementally redesign and regenerate.

No intranet CLIs, internal config centers, or usage telemetry are required. Scripts are TypeScript and need **Node.js 22.6+** (`node --experimental-strip-types --experimental-default-type=module`); no npm packages.

Data flow, gates, and the `TBD` rule: [How it works](HOW_IT_WORKS.md). Unmeasured items and update-diff limits: [Known limitations](KNOWN_LIMITATIONS.md).

Test data is a separate concern: cases ship with `{placeholder}` markers that the sibling `testdata-generation` skill backfills from real backends.

## Zero-config (local files)

Without `{workspace}/.ai-testcase/integrations.yaml`, the skill uses `config/integrations.default.yaml`:

- Protocols: `http`, `grpc`. One cache table, one MQ table. No Redis / KV split, no required Thrift.
- `spec_lookup` / `knowledge_search` / `env_info` read `prd/specs/`, `knowledge/`, and `.project/context.json`.
- `config_lookup` / `middleware_lookup` / `experiment_lookup` stay disabled (`call_integration.ts` returns `status=skipped`).

Place materials in the workspace (or let the agent copy them there):

```
{workspace}/
├── .project/context.json   # optional: env, branch, doc local paths
├── knowledge/              # optional: local knowledge base (markdown / JSON)
├── prd/
│   ├── requirementDocs/    # PRD
│   ├── techDocs/           # technical design
│   └── specs/              # OpenAPI / IDL / other contract files
├── code/                   # system under test (optional)
└── usecases/
```

Public URLs can be fetched and saved under `prd/`. Private intranet document platforms are not used.

## Enterprise HTTP adapters

To plug in your own spec portal, knowledge search, config center, or env service:

1. Copy [`config/integrations.example.yaml`](config/integrations.example.yaml) to `{workspace}/.ai-testcase/integrations.yaml`.
2. Implement the JSON endpoints in [`references/integration-api.md`](references/integration-api.md).
3. Put tokens and cert paths in environment variables (`${OAUTH_CLIENT_SECRET}`, `${MTLS_CERT_PATH}`). Never commit raw secrets or PEM.
4. Optional per-capability `http.query`, `http.auth.kind` (`header` / `query` / `oauth2_client_credentials` / `token_exchange` / `session`), and `http.tls` — see `references/integration-api.md`.
5. Optionally extend `profile.protocols` (e.g. add `thrift`) and `profile.components` field names.

The agent must call `scripts/call_integration.ts` — no hand-written curl, no vendor SDK. Phase 0 writes `usecases/testdocs/integrations-resolved.json` (no secrets) so later steps only read the resolved profile.

Validate:

```bash
node --experimental-strip-types --experimental-default-type=module scripts/validate_integrations.ts --workspace "{workspace}" --resolve-out usecases/testdocs/integrations-resolved.json
```

## Outputs

```
usecases/
├── cases/{module}/*.md
└── testdocs/
    ├── analysis.md
    ├── integrations-resolved.json
    ├── design.md
    ├── api-details.md
    ├── case-registry.json
    └── ...
```

## Layout

```
testcase-generation/
├── SKILL.md
├── README.md
├── README.zh-CN.md
├── HOW_IT_WORKS.md         # data flow and constraints
├── HOW_IT_WORKS.zh-CN.md
├── KNOWN_LIMITATIONS.md
├── KNOWN_LIMITATIONS.zh-CN.md
├── config/                 # default / example integrations YAML + schema
├── scripts/                # validate_integrations.ts, call_integration.ts (Node 22.6+)
├── references/             # HTTP adapter contract
├── generation/             # orchestrator + per-phase files, guides, quality gates
├── maintenance/            # incremental update workflow
└── evals/                  # representative prompts; no published fixture yet
```

## Install

```bash
npx skills add openqa-cn/codexqa --skill testcase-generation
```

Start a **new** agent session. The installer copies this directory into the host skills folder (Cursor, Claude Code, Codex, OpenClaw). Packing a zip yourself is not required.

## How to use

Ask the agent to generate or update test cases. It reads `SKILL.md`, then the generate or update document.

```text
Generate a manual case library with testcase-generation from the documents under prd/.
Do not invent engineering fields that are not in the source. Mark those TBD.
```

When the generate flow asks the user to resolve a PRD vs technical-design conflict, reply with `Confirm follow PRD` or `Item N follow technical design`.
