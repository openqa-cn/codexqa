# Publish OpenQA Skills

Skills are distributed from this GitHub repository through `npx skills add`. Publishing an OpenQA npm package is not required.

## Before pushing

1. Match each skill directory to its `SKILL.md` name and `skills.json` entry.
2. Include user documentation, requirements, examples, and limitations.
3. Run from the repository root:

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
npx skills add . --list
```

4. Review the actual proposed file list for runtime data, private configuration, credentials, and inappropriate metadata. Ignore rules do not remove already tracked files.
5. Update the changelog, support evidence, and release checklist. Obtain human maintainer review as required by this repository.

## After pushing

Inspect hosted CI results. Confirm `npx skills add openqa-cn/openqa-skills --list` discovers the skill; validate installation in an isolated project before advertising it as verified. The remote command cannot install unpublished local changes.

Create a reviewed GitHub release/tag and describe changes, requirements, evidence, and known limitations. Optional ZIP assets can be built with `bash skills/ai-defect-detection/pack-skill.sh /absolute/output/directory`. Keep version metadata consistent with the selected release; the imported skill metadata currently says 0.0.2.

## Distribution boundary

The generic installer reads the Git repository; it does not necessarily apply `pack-skill.sh` exclusions. The ZIP script excludes tests, runtime data, private config, and development package metadata. Keep public sample inputs separate from actual task results in both distribution routes.

Use [the release checklist](docs/RELEASE_CHECKLIST.md). A passing command is evidence for the checks it performs, not proof of complete defect detection.
