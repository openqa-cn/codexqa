# Install this skill

Requires Node 22+. Runtime is Node stdlib (no `npm install` needed to run scripts).

## From the GitHub repository

Same command as the other skills in this repo:

```bash
npx skills add openqa-cn/codexqa --skill testdata-generation
```

Then start a **new** agent session. Host-specific flags (`--agent cursor`, `--agent claude-code`, `--agent codex`, `--global`) are documented in the [repo getting started](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.md).

## From a local checkout (zip)

This folder **is** the skill. After packaging, IDEs must see:

```
testdata-generation/
├── SKILL.md
├── scripts/
├── references/
├── assets/
└── slots/
```

The frontmatter `name` is `testdata-generation` (lowercase `a-z`, digits, and single `-` only, per the [Agent Skills spec](https://agentskills.io/specification)). The source folder, zip root, and install directory all use this name.

```bash
node scripts/pack_skills.ts --output ./dist
```

| Zip | Use |
|---|---|
| `testdata-generation.zip` | Cursor, Claude Code skills dir, Codex |
| `testdata-generation-claude-plugin.zip` | Claude Code plugin (`plugin.json` + `skills/`) |

## Cursor

```bash
unzip dist/testdata-generation.zip -d ~/.cursor/skills
# or
unzip dist/testdata-generation.zip -d /path/to/project/.cursor/skills
```

## Claude Code

```bash
unzip dist/testdata-generation.zip -d ~/.claude/skills
# or
unzip dist/testdata-generation.zip -d .claude/skills
```

## Codex

```bash
unzip dist/testdata-generation.zip -d "${CODEX_HOME:-$HOME/.codex}/skills"
unzip dist/testdata-generation.zip -d ~/.agents/skills
unzip dist/testdata-generation.zip -d .agents/skills
```

Do not zip only a nested folder, and do not leave `SKILL.md` out of the archive root folder.

`SKILL_DIR` is the extracted `testdata-generation` directory:

```bash
node "$SKILL_DIR/scripts/search_data_build.ts" --keywords catalog --json
```
