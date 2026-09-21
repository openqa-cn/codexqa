# GitHub surface (About, topics, social preview)

GitHub Settings cannot be stored in git. Apply this checklist on `https://github.com/openqa-cn/codexqa` after each positioning change. Copy in the README is the crawlable fallback.

## About

- **Description (≤350 chars):** After AI coding, the bottleneck is verifying quality: bugs, blast radius, cases, change graph (APIs/methods/chains), architecture, security, requirements, test data. 8 local Agent Skills, 360° test-and-verify. Cursor, Claude Code, Codex, OpenClaw. `npx skills add openqa-cn/codexqa`
- **Website:** [https://openqa.cn/](https://openqa.cn/) (do not point About at GitHub Pages).
- **Releases:** enabled. Pushing a version tag (or publishing a Release) runs `.github/workflows/release-notes.yml`, which fills the body from `.github/release-notes.md` and always includes `https://openqa.cn/`.

## Topics (max 20)

Keep these; drop generic leftovers if over cap:

`agent-skills` `agentskills` `cursor` `claude-code` `openai-codex` `code-review` `sast` `static-analysis` `testing` `test-automation` `manual-testing` `requirements` `root-cause-analysis` `code-analysis` `architecture` `qa` `llm` `developer-tools` `openclaw` `verification`

## Social preview

Upload `docs/assets/previews/defect-report.png` (or a 1280×640 crop) in Settings → General → Social preview. Alt text already describes a defect HTML report; do not use a logo-only image.

## README contract

- H1 stays `codexqa`.
- The line under H1 is the post-AI-coding verification bottleneck (write fast vs know it is good), **fully local execution**, and **install-and-use**; then the 360° test-and-verify dimensions, then quantified proof before the screenshot.
- First visual is a skill HTML report screenshot; all eight workers have a preview in `docs/assets/previews/`.
- Link **Documentation** to [openqa.cn](https://openqa.cn/) (optional `utm_source=github&utm_medium=readme&utm_campaign=oss-seo`) and keep GitHub as source.

## Releases

Each GitHub Release body should answer: what a user can do now, host/agent caveats, and a docs URL. Do not lead with internal refactors (those stay in `CHANGELOG.md` Internal).
