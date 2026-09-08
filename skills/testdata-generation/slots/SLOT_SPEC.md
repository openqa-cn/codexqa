# Domain slot specification

A slot is one self-contained scene skill. Drop it under `slots/` (or one path in `workspace.slot_roots`) and the parent skill discovers it, indexes its OpenAPI, and binds case-pipeline executors. No second registration list.

## Enterprise extension (two things)

1. **The scene skill** — a folder with executors plus either `slot.yaml` or `SKILL.md`
2. **One config line, only if the folder is not under the default `slots/`**

```yaml
# testdata/config.yaml
workspace:
  slot_roots:
    - /opt/company/data-slots
```

Gateway: set `DATA_BUILD_API_BASE` (and `auth` if needed). Do not hardcode hosts in executors.

```bash
# optional helper: OpenAPI → slot.yaml + executor stubs + generated docs
node slot-scaffolder/scripts/scaffold_slot.ts --domain wallet --openapi ./openapi --output ./slots/wallet
# then implement main() in the stubs and add scenes to slot.yaml
```

## Required layout

```
<domain>/
├── slot.yaml                 # one config: entities / actions / scenes
├── scripts/executors/*.ts    # the construction skill
├── SKILL.md                  # optional if generated from slot.yaml
├── references/tools-guide.md # optional if generated from slot.yaml
└── assets/openapi/           # optional; auto-indexed when present
```

`name` must match the directory name and may contain only lowercase `a-z`, digits, and single `-` (no `_`, no uppercase, no leading/trailing/consecutive hyphens). Follow the [Agent Skills spec](https://agentskills.io/specification).

`slot.yaml` is the single source of truth. Run `node scripts/sync_slot.ts --dir <slot>` to refresh generated docs. Hand-written `SKILL.md` is left alone.

If `slot.yaml` is missing, entities are inferred from `scripts/executors/*` and `assets/openapi` operationIds. Add `slot.yaml` when you need scenes, aliases, or a search `description`. Keyword search matches `name` + `domain` + `description`; without `description` it falls back to the `SKILL.md` frontmatter.

## slot.yaml

```yaml
name: wallet
domain: wallet
description: Constructs wallet accounts and top-ups.   # keyword search reads this
entities:
  - id: wallet-account
    executor: scripts/executors/createwallet.ts
    aliases: [wallet, 钱包]          # optional; id tokens are inferred
    invokeParams: [name]
actions:
  - id: topup-wallet
    executor: scripts/executors/topupwallet.ts
    aliases: [topup, 充值]
    params: [walletId, amount]
scenes:
  - id: recharge-ready-wallet
    steps: [wallet-account::create, topup-wallet]
```

Put **more specific** entities before generic ones (limited / credit before standard catalog).

`scenes[].steps` are dependency edges. Pass upstream `data` downstream. If a later step needs material this slot cannot create, ask, then continue.

## Executor contract

1. `main(params) -> {success, data, error}`
2. `--json '{...}'` for local and registry execution
3. HTTP only through adapters or `DATA_BUILD_API_BASE`
4. Missing required IDs fail; do not invent them
5. Timeouts on network calls; never `shell: true`
