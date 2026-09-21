# Publish codexqa

Skills are distributed from this GitHub repository through `npx skills add`. Publishing a codexqa npm package is not required.

## Before pushing

1. Match each skill directory to its `SKILL.md` name and `skills.json` entry.
2. If you added or changed a worker skill's frontmatter `description`, run `python3 skills/codexqa-skill-router/scripts/refresh_catalog.py` and commit `skills/codexqa-skill-router/references/catalog.json`.
3. Include user documentation, requirements, examples, and limitations.
4. Run from the repository root:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/codexqa-defect-analyzer && npm test)
node examples/checkout-boundary/verify.mjs
python3 skills/codexqa-skill-router/scripts/discover_skills.py --self-check
npx skills add . --list
```

5. Review the actual proposed file list for runtime data, private configuration, credentials, and inappropriate metadata. Ignore rules do not remove already tracked files.
6. Update the changelog, support evidence, and release checklist. Obtain human maintainer review as required by this repository.

## After pushing

Inspect hosted CI results. Confirm `npx skills add openqa-cn/codexqa --list` discovers the skill; validate installation in an isolated project before advertising it as verified. The remote command cannot install unpublished local changes.

Create a reviewed GitHub release/tag (for example `git tag 0.3.0 && git push origin 0.3.0`). `.github/workflows/release-notes.yml` drafts or updates the GitHub Release from [`.github/release-notes.md`](.github/release-notes.md), always including `https://openqa.cn/`. Fill in “What you can do now” and hosts/limits before publishing a draft. Optional ZIP assets can be built with `bash skills/codexqa-defect-analyzer/pack-skill.sh /absolute/output/directory`. Keep version metadata consistent with the selected release; check the `version` fields in `skills/*/SKILL.md` before tagging.

## Distribution boundary

The generic installer reads the Git repository; it does not necessarily apply `pack-skill.sh` exclusions. The ZIP script excludes tests, runtime data, private config, and development package metadata. Keep public sample inputs separate from actual task results in both distribution routes.

Use [the release checklist](docs/RELEASE_CHECKLIST.md). A passing command is evidence for the checks it performs, not proof of complete defect detection.
