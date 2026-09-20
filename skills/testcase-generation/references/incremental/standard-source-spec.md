# This repo's three-end standard contract

Incremental uses this repo's three end-case templates as the authoritative standard source for added and modified cases, but uses only the top-level Chapter 3 of each template. Other files and other chapters of the templates are not incremental-judgment inputs.

| End | Source file |
| --- | --- |
| `server` | `references/case-tpl-server.md` |
| `app` | `references/case-tpl-app.md` |
| `web` | `references/case-tpl-web.md` |

## Source location

`--source-reference-dir` must be the absolute path of this repo's `references/`. Do not use a script, `find`, `rg`, directory traversal, or a fixed user path to look up another Skill. Do not read template copies outside this repo.

```bash
<skill_dir>/scripts/tcg-python <skill_dir>/scripts/incremental/freeze_case_standard.py \
  --workspace <workspace-absolute-path> \
  --source-reference-dir <this-repo-references-absolute-path> \
  --source-skill-name testcase-generation \
  --source-skill-version V56
```

The script accepts only a directory the Agent passes explicitly, and does not look up Skill identity. `source-skill-name` must be `testcase-generation`.

## Chapter 3 extraction

The script reads only the UTF-8 bytes of the three files, and from each file extracts the unique top-level `## 3` section, cutting off before the next top-level `##`:

```text
artifacts/standards/source/
├── standard-source-manifest.json
└── sections/
    ├── server/case-tpl-server.md.section-3.md
    ├── app/case-tpl-app.md.section-3.md
    └── web/case-tpl-web.md.section-3.md
```

Constraints:

- Read only the three files in the table above; do not read other files in the directory.
- Save only the Chapter 3 snapshot; do not save a full template copy.
- The Chapter 3 snapshot is frozen input of the current execution; it cannot be overwritten inside the same execution.
- Standard fetch fails when a source file is not valid UTF-8, is missing Chapter 3, has multiple top-level Chapter 3s, is a symlink, or the source directory is not `references`.
- On failure, do not compensate with Chapter 1, 2, 4, or 5.

## Per-end consumption

The Agent judges the end type from the primary execution entry. Do not choose a standard snapshot before the end type is determined.

| Target end | May only read |
| --- | --- |
| `server` | `artifacts/standards/source/sections/server/case-tpl-server.md.section-3.md` |
| `app` | `artifacts/standards/source/sections/app/case-tpl-app.md.section-3.md` |
| `web` | `artifacts/standards/source/sections/web/case-tpl-web.md.section-3.md` |

Do not read the other two ends' Chapter 3 to generate one end's cases, and do not read back the original full templates. Incremental contract files may be read as the task needs, but cannot replace the end standard.

For each actually processed `platform + sourceId`, the Agent generates `artifacts/standards/{platform}/{sourceId}/standard-profile.json`, containing at least `platform`, `sourceId`, `sourceManifestRef`, `sectionSnapshotRef`, `sourceFile`, `appliedRules` that cite Chapter 3 only, `conflicts`, and `resolution`.

## Action gate

- `KEEP`, `NEED_CONFIRM`, and `DEPRECATE_CANDIDATE` may be unbound from an end standard.
- `MODIFY`, `ADD`, `SPLIT`, and `MERGE` must first read the target end's Chapter 3 snapshot and provide `standardRefs`.
- When one action includes multiple ends, each end binds its own Chapter 3 snapshot.
- Do not generate modified or added content when the standard snapshot, standard profile, or standard citations are missing.
