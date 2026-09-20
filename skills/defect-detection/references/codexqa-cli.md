# CodexQA CLI (defect-detection)

Graph / call-chain / cross-file correlation for **defect-detection** goes through `scripts/codexqa_client.py` only. Do **not** reimplement symbol graphs, callers/callees, imports, reachability, or RAG from homemade analyzers.

## Polyglot mandate (all languages)

**Every** engineering language in a scanned repo (Java, Go, Python, TypeScript/JavaScript, Rust, C/C++, Kotlin, Swift, Scala, Ruby, PHP, …) MUST use CodexQA for underlying code analysis.

| Concern | Owner |
|---------|--------|
| Code graph / call-chain / imports / reach / RAG snippets | **CodexQA only** (`prepare_polyglot_codexqa` → index + query) |
| Language label (`primary_language`, confidence, source) | `lib.detect_repo_languages` — file counts + weighted manifests; override via `primary_language` / `--language` / `AID_PRIMARY_LANGUAGE` / adhoc `.aid_scan_meta.json` |
| SAST / lint / secrets / SCA | Existing language-aware adapters (unchanged) |

Collect JSON always carries `engine=codexqa`, `graph_provider=codexqa`, `polyglot_mandate=true`. Config: `codexqa.polyglot_mandate: true` + `graph_provider: codexqa`. Misconfigured `graph_provider` → hard fail.

**This skill’s deliverable** is `report_scan.json` / `.md` / `.html` (defect findings). It is **not** a CodexQA Mermaid “必看组” QA write-up. Upstream CodexQA may produce Mermaid reports when used as its own skill; those are out of scope here.

Official package: `@openqa-cn/codexqa` (see `npm` registry). Client targets 0.1.x JSON shapes (`symbols`, `edges`, `reach`, `source`, `search`, …).

---

## Install

Requires **Node.js >= 18**.

```bash
bash scripts/install_codexqa.sh
# or:
npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/
export PATH="$(npm prefix -g)/bin:$PATH"
codexqa --help
```

After npm upgrade, run `codexqa stop` (install script does this) so the daemon loads the new binary.

Uninstall removes the CLI only, not local indexes: `npm uninstall -g @openqa-cn/codexqa`.

---

## Mock policy (defect-detection)

- Real `codexqa` on PATH and `codexqa --help` OK → **always** live graph; `CODEXQA_FORCE_MOCK` / `CODEXQA_MOCK` are ignored.
- Mock only when the binary is missing **and** mock env is set (adhoc may enable mock as last resort).
- Repo scans **hard-fail** if CLI is missing and mock is not allowed.
- Do not export `CODEXQA_FORCE_MOCK=1` for normal user scans when the real CLI works.

---

## Repo forms

`<repo>` may be a local path, canonical id (`github.com/org/repo@main`), or remote git URL (index only). Prefer `codexqa repos` when ambiguous. Omit `@branch` only when a single branch exists.

---

## Index before query

Do not `query` / chat / wiki before a trustworthy index.

```bash
codexqa index /path/to/repo
codexqa index /path/to/repo --diff-base origin/main   # incremental / PR baselines
codexqa index /path/to/repo --full                    # force full rebuild
codexqa repos
codexqa stats /path/to/repo
codexqa query --repo <repo> summary
```

- Default index is incremental; `--full` rebuilds.
- `--diff-base` marks `add` / `change` (not the same as “only reparse dirty files”).
- Without `--diff-base`, every `change_status` is `default` — change-groups / symbol-diff for diffs are unreliable.

---

## Queries used by this skill

`codexqa_client.py` shells out to forms like:

```bash
codexqa query --repo <repo> summary
codexqa query --repo <repo> symbols [--change add,change] [--file-contains …]
codexqa query --repo <repo> edges --id <id> --direction in|out
codexqa query --repo <repo> reach --id <id> --direction in --depth 2 [--edge-kinds calls,tests]
codexqa query --repo <repo> imports --file <path> --direction in|out
codexqa query --repo <repo> change-groups          # needs --diff-base index
codexqa query --repo <repo> symbol-diff --id <id>  # needs --diff-base index
codexqa query --repo <repo> source --id <id>
codexqa query --repo <repo> snippet --file <path> --start N --end M
codexqa query --repo <repo> search --query "…"
codexqa query --repo <repo> files [--prefix …]
```

Evidence for fan-in, linked files, and RAG snippets in scan context **must** come from these (or equivalent client wrappers). Do not invent modules, edges, or call chains.

Useful fields: `change_status`, `tested_count`, `from_count` / fan-in. If `stats` shows many stubs/collisions, lower confidence on blast-radius claims.

---

## What not to run by default

Unless the user explicitly asks (outside the defect-detection report path):

- `codexqa chat` / `codexqa wiki` / `codexqa serve` / `codexqa gui` (LLM or interactive UI)
- Full-repo Wiki embed or Archify-style HTML canvases

Index + `query` do not need `~/.codexqa/config.toml`. Chat/wiki do.

---

## Ops / FAQ (short)

| Symptom | Action |
|---|---|
| `command not found` | Add `$(npm prefix -g)/bin` to PATH; install only if missing |
| `repo index not found` | Run `index`; check `repos --filter` |
| All `change_status=default` / empty `file-base` | Re-index with `--diff-base <ref>` |
| Empty search | Run `search-index`; meanwhile use `symbols` / `files` |
| Chat/wiki 401 | Fix `~/.codexqa/config.toml`, then `codexqa restart` |

Destructive: `codexqa delete`, `session clear`, `uninstall` — confirm with the user first.

Full CLI help: `codexqa --help` and `codexqa query --help`.
