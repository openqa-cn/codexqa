# Contributing

Thanks for helping improve this skill. It is a vendor-neutral, MIT-licensed Agent Skill for Git-based code review, shipped inside the Apache-2.0 `openqa-skills` repository.

## Ways to contribute

- Fix gaps or contradictions in `review-playbook.md` or `playbook/`
- Add a review pattern that has a clear runtime consequence and a rule citation
- Improve helper scripts under `tooling/`
- Fix human-facing docs (`README.md`, `HOW_IT_WORKS.md`, `KNOWN_LIMITATIONS.md` and their `.zh-CN.md`)

## Before you start

1. Open an issue describing the change, unless the fix is an obvious typo.
2. Keep the skill portable: no company names, internal hostnames, staff IDs, or private incident URLs.
3. Prefer examples that use generic domains such as `example.com` and generic identifiers such as `customerDTO`.
4. New external systems belong in `config/` as optional integrations. Do not hardcode hosts or middleware into `review-playbook.md` or `tooling/`.
5. The `SKILL.md` `name` is `code-reviewer` and must match this directory.

## Development

```bash
cd tooling && npm install && npm run build && npm test && cd -
node tooling/run-local-checks.js
```

There is no application server. Most changes are Markdown instructions plus small TypeScript helpers.

### TypeScript helpers

Edit only the TypeScript sources in `tooling/` (`*.ts`, `*.d.ts`, `tsconfig.json`, `package.json`). The matching `*.js` files are `tsc` output. Do not hand-edit a compiled `.js` file.

After changing a `.ts` file, from `tooling/` run `npm run build` (or `npm test`, which builds first) and commit both the source and the emitted `.js`. Playbook commands still call `node tooling/*.js`. Offline contract checks in `tooling/contract-checks.ts` lock skip / missing-token / progress / no-diff-audit behavior.

## Pull requests

- Keep the diff focused on one concern.
- Update `playbook/` instead of lengthening `review-playbook.md` when the material is reference detail.
- If you add a file, mention it from `review-playbook.md` or `README.md` so the agent can find it, and add it to `packaging-inventory.txt`.
- Do not commit review leftovers (`.cr-*`, `.code-review-diff.tmp`).
- Publish a zip with `node tooling/pack-skill.js` so the archive is `code-reviewer/SKILL.md` without `.git` or `__MACOSX`.
- Follow the repository [code of conduct](https://github.com/openqa-cn/openqa-skills/blob/main/CODE_OF_CONDUCT.md).

Maintainers review for correctness, portability, and whether the change raises false-positive noise in reviews.

## Reporting security issues

Do not file a public issue for a vulnerability. See the repository [SECURITY.md](https://github.com/openqa-cn/openqa-skills/blob/main/SECURITY.md).
