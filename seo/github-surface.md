# GitHub surface (About, topics, social preview)

GitHub Settings cannot be stored in git. Apply this checklist on `https://github.com/openqa-cn/codexqa` after each positioning change. Copy in the README is the crawlable fallback.

## About

- **Description (≤350 chars):** Local-first Agent Skills for AI verification: PRD review, test design, test data, architecture wiki, change impact, exception RCA, SAST/code-risk scan, and graph-evidence review. Cursor, Claude Code, Codex, OpenClaw. `npx skills add openqa-cn/codexqa`
- **Website:** [https://openqa.cn/](https://openqa.cn/) (do not point About at GitHub Pages).
- **Releases:** enabled. Pushing a version tag (or publishing a Release) runs `.github/workflows/release-notes.yml`, which fills the body from `.github/release-notes.md` and always includes `https://openqa.cn/`.

## Topics (max 20)

Keep these; drop generic leftovers if over cap:

`agent-skills` `agentskills` `cursor` `claude-code` `openai-codex` `code-review` `sast` `static-analysis` `testing` `test-automation` `manual-testing` `requirements` `root-cause-analysis` `code-analysis` `architecture` `qa` `llm` `developer-tools` `openclaw` `verification`

## Social preview

Upload `docs/assets/previews/defect-report.png` (or a 1280×640 crop) in Settings → General → Social preview. Alt text already describes a defect HTML report; do not use a logo-only image.

## README contract

- H1 stays `codexqa`.
- The line under H1 must name the category (Agent Skills, local-first verification) before the nine-skill inventory.
- Link **Documentation** to [openqa.cn](https://openqa.cn/) and keep GitHub as source.

## Releases

Each GitHub Release body should answer: what a user can do now, host/agent caveats, and a docs URL. Do not lead with internal refactors (those stay in `CHANGELOG.md` Internal).
