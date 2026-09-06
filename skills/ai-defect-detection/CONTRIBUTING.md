# Contributing

## Principles

- Keep providers vendor-neutral. New company systems belong behind an interface in `providers/`, not in `open_platform.ts`.
- Do not add hostnames, product codenames, or employee identifiers from a specific company.
- Local providers must remain complete enough that the CLI works offline.
- Prefer tests over comments for provider contracts.

## Layout

```
providers/           adapter interfaces + local/http/github implementations
open_platform.ts     validation + facade over get_platform()
open_detect.ts       CLI
enterprise/          sample plans / cases / docs
tests/               unit and smoke tests
```

## Checks

```bash
node --test tests/*.test.ts
```

The published skill is TypeScript run by Node 22+ (`node open_detect.ts`). Do not add runtime npm dependencies.

Please open an issue before large adapter additions so the HTTP contract stays stable.
