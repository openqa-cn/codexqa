# Domain slots

See [SLOT_SPEC.md](SLOT_SPEC.md) for the contract.

A slot is a self-contained scene skill. Drop it here (or under `workspace.slot_roots`) and the parent skill discovers it, indexes `assets/openapi/`, and binds case-pipeline executors. No second registration list.

Keyword search matches `name`, `domain`, and `description`. `description` comes from `slot.yaml` when present, otherwise from `SKILL.md`. Put the domain nouns in that field; a first line of pack boilerplate will hide the slot from `--keywords`.

Pack examples:

- `catalog` — catalog products, orders, account credit
- `distribution` — distributor account, inventory bind, commission, quote

Start the local mock before running executors:

```bash
node slots/mock_server.ts --port 8765
```
