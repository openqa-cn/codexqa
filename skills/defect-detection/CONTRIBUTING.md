# Contributing

## Principles

- Keep providers vendor-neutral. New company systems belong behind an interface in `scripts/providers/`, not in `scripts/platform.ts`.
- Do not add hostnames, product codenames, or employee identifiers from a specific company.
- Local providers must remain complete enough that the CLI works offline.
- Prefer tests over comments for provider contracts.

## Layout

```
SKILL.md                 entry: routing, constraints, output (kept short)
references/              agent-facing docs, loaded on demand
  phase1-preparation.md  Phase 1
  phase2-detection.md    Phase 2
  phase3-close.md        Phase 3
  writeback.md           write-back fields / bugStatus
  feedback.md            user feedback (Phase 4)
  operator-manual.md     human walkthrough
  api/                   HTTP contracts for remote adapters
  analysis/ output/ rules/ writeback/   detailed specs
scripts/                 all runtime code (Node 22+, no npm deps)
  detect.ts              CLI entry
  cli_*.ts               command handlers
  platform.ts            validation + facade over get_platform()
  providers/             adapter interfaces + local/http/github implementations (scripts/providers/)
enterprise/              sample plans / cases / docs (local adapter seed, user-editable)
tests/                   unit and scenario tests (not shipped)
```

## Security (skill-specific)

Vulnerability reporting is at the repository level: [SECURITY.md](https://github.com/openqa-cn/openqa-skills/blob/main/SECURITY.md). For this skill specifically:

- Do not commit tokens, cookies, or a `config.yaml` that contains secrets.
- Put credentials in environment variables (`DETECTION_TOKEN`, `DETECTION_API_KEY`, `GITHUB_TOKEN`).
- Local mode writes under `data/`; treat that directory as workspace-private.
- Reach remote providers over TLS; the skill sends the configured auth header on every call.

## Checks

```bash
node --test tests/*.test.ts
```

The published skill is TypeScript run by Node 22+ (`node scripts/detect.ts`). Do not add runtime npm dependencies.

Please open an issue before large adapter additions so the HTTP contract stays stable.
