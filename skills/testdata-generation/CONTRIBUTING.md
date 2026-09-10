# Contributing

Thanks for helping make this skill pack useful across organizations.

## Principles

1. Keep the [Agent Skills](https://agentskills.io/specification) contract: `SKILL.md` `name` may contain only lowercase `a-z`, digits, and single `-` (no `_`, no uppercase, no leading/trailing/consecutive hyphens) and must match the directory. `SKILL.md` stays under 500 lines; details go in `references/`.
2. Do not add organization-specific product names, internal hostnames, or private package registries.
3. New platform integrations belong behind an adapter in `scripts/adapters/`. Default implementations must work offline with local files.
4. Domain capabilities belong in `slots/` (or `workspace.slot_roots`) and must follow `slots/SLOT_SPEC.md`. Do not add a second registration list.
5. Public docs, comments, identifiers, and config keys are written in English.

## Development setup

```bash
cd testdata-generation
# Node 22+; npm install for typescript/@types/node only; runtime is Node stdlib
npm install
```

Copy the example config and point slot paths at this tree:

```bash
mkdir -p testdata
cp assets/config.example.yaml testdata/config.yaml
```

## Checks before you open a pull request

- `node scripts/search_data_build.ts --keywords catalog --query "create a catalog product" --json`
- `node slots/catalog/scripts/executors/create_product.ts` against the local mock (see README)
- Grep the tree for organization-specific leftovers (internal hostnames, private registries, hardcoded tokens)
- Validate each `SKILL.md` frontmatter (`name`, `description`, `license`)

## Commit style

Use a short why-focused subject:

```
feat: add HTTP tool-registry adapter
fix: keep SQL adapter read-only
docs: clarify slot.yaml scene edges
```

## Security (skill-specific)

Vulnerability reporting is at the repository level: [SECURITY.md](https://github.com/openqa-cn/codexqa/blob/main/SECURITY.md). For this skill specifically:

- Never commit tokens, cookies, private keys, or connection strings.
- Put secrets only in environment variables or a local untracked config file.
- HTTP adapters must send credentials via the `Authorization` header from the auth adapter — do not hardcode headers.
- SQL adapters accept `SELECT` only.
- Generated scripts must call subprocesses with argument lists (`shell=False`).

## License

By contributing you agree that your work is licensed under Apache-2.0.
