# CodexQA Jev Browser

[简体中文](README.zh-CN.md) · [How it works](HOW_IT_WORKS.md) · [Known limitations](KNOWN_LIMITATIONS.md)

GUI-model browser automation sends a screenshot to a vision model on every step. Recognition spends vision tokens, the loop waits for the model to read the image, and the click lands on coordinates.

CodexQA Jev Browser finds controls from an index built inside the page and treats visible page evidence as the result. Replay, goal runs, case generation, and site exploration share that index. Playwright Chromium is the default browser. An optional local Cloak build can be used when you supply your own https mirror and checksum. This repository has no benchmark against vision GUI models. The rows below are the structural answers to those costs.

## Where traditional automation gets stuck

| Pain | What this runtime does |
| --- | --- |
| A GUI model finds controls from a screenshot, and every step spends vision tokens | The decision receives an index the page already built: role, name, current value, and allowed operations. The model answers a choice question. Screenshots stay in the report and mark the control that was used. |
| Every step waits for a vision model to finish reading the image | Observation runs inside the page. `run`, `explore`, and `--decisions` do not call a decision model. After `generate` writes YAML, `--verify` replays it on the same index. |
| Coordinate and vision grounding miss the control, and a layout change breaks the click | Actions hit `data-codexqa-jev-browser-id`. Cases resolve `role` / `name` / `nth` / `within` against the live index, including controls inside iframes. The index must still be in the action space before the click, and the page is checked again after it. |
| The browser you launch is part of the run | Playwright Chromium is the default. `browser.engine: auto` uses a local Cloak binary only when one is already installed. |

## Highlights

- **Closed action space.** Observation assigns each visible control an index, a role, a name, and the operations it actually supports. The decision is accepted only when both the operation and the index are in that set. Selector-like text, JavaScript, and shell in the model reply are rejected before anything runs.
- **Jev answers structured choices.** With `TYPESAFE_API_KEY`, each step is a `/systemone` questionnaire: which operation, and which observed target. The same channel judges whether that one action showed up on the next page. An OpenAI-compatible `chat/completions` call is the fallback decision model. `--decisions` skips both.
- **Chromium unless you opt into Cloak.** `browser.engine: auto` launches a local Cloak binary when `~/.cloakbrowser` already has one, and otherwise stays on Playwright Chromium. `install-browser` downloads only from `CLOAKBROWSER_DOWNLOAD_URL` after `CLOAKBROWSER_SHA256` matches. There is no built-in mirror. `UI_PILOT_BROWSER=chromium` forces Chromium. Password field values are left out of model requests.
- **Generated cases replay without the decision model.** YAML, Markdown, and API cases name targets as `{role, name, nth, within}`. Those fields are resolved against the live index, including controls inside iframes. `generate` writes that YAML after every successful step. `--verify` then replays the file through `run`.
- **Visible evidence decides the result.** A planner names `done_when` as something that must be on the page. `DONE` passes only when that evidence is visible. A failed assertion still runs teardown. The HTML report keeps the marked screenshot, step timing, token use, and the session video.

## Architecture

```mermaid
flowchart TD
  cli["codexqa-jev-browser"] --> session["BrowserSession"]
  session --> engine{"browser.engine"}
  engine -->|"auto and Cloak installed"| cloak["Cloak: fingerprint, locale, GeoIP"]
  engine -->|"chromium or Cloak missing"| chromium["Playwright Chromium"]
  cloak --> page["Page and iframes"]
  chromium --> page
  page --> snap["snapshot.dom.js"]
  snap --> idx["Index: role, name, value, ops, within, node id"]

  idx --> observeCmd["observe: print the table"]
  idx --> runPath["run"]
  idx --> goalPath["auto and generate"]
  idx --> explorePath["explore"]

  runPath --> cases["YAML, Markdown, or API cases"]
  cases --> sem["Match role / name / nth / within"]
  sem --> act["Act on data-codexqa-jev-browser-id"]
  cases --> side["http setup and assert URL, title, text, JSON"]

  goalPath --> plan["Planner: steps plus visible done_when"]
  plan --> space["Action space minus repeated fields"]
  space --> pick{"Decision provider"}
  pick -->|"--decisions"| script["Scripted operation and index"]
  pick -->|"TYPESAFE_API_KEY"| jev["Jev /systemone choice questions"]
  pick -->|"otherwise"| oai["OpenAI-compatible JSON"]
  script --> gate["Accept only an offered operation and index"]
  jev --> gate
  oai --> gate
  gate --> act
  act --> effect["Effect check: Jev pass/fail, else local before/after"]
  goalPath --> done["DONE passes only when done_when is visible"]
  goalPath --> yaml["generate writes semantic YAML after each success"]
  yaml --> verify["--verify replays through run"]

  explorePath --> crawl["State graph; skip logout, delete, and pay"]
  crawl --> graph["explore-graph.json and compiled cases"]

  act --> report["report.html, report.json, report.md, marked screenshots, video"]
  side --> report
  done --> report
  graph --> report
```

`observe`, `run`, `explore`, and `--decisions` stop at the index and the actor. Live `auto` and `generate --goal` add the planner and a decision provider. `generate` turns a passing trace back into a case the actor can replay alone.

Typing uses text the decision already chose when it can. Otherwise a small chat model supplies the characters for that field, using any matching note from `knowledge/<app>/`. Which control receives them is still the node id on the index.

## Install

```bash
npm install
cp .env.example .env   # live auto / generate --goal
```

Optional Cloak download, only with a mirror you are allowed to use:

```bash
# CLOAKBROWSER_DOWNLOAD_URL=https://example.com/cloakbrowser
# CLOAKBROWSER_SHA256=<64 hex chars>
npx codexqa-jev-browser install-browser
```

GeoIP is separate: `CLOAKBROWSER_GEOIP_URL` and `CLOAKBROWSER_GEOIP_SHA256`. Do not point either URL at a database you are not licensed to fetch. Files land in `~/.cloakbrowser`. Model calls use `HTTPS_PROXY` only when that variable is set.

Node.js 20 or newer.

## Model

The CLI calls Jev or an OpenAI-compatible API itself. The host Cursor or Codex session is not the decision model.

| Call | When | Key |
| --- | --- | --- |
| Jev `/systemone` | Per-step operation and target, and the per-step effect verdict | `TYPESAFE_API_KEY`. Optional: `TYPESAFE_MODEL` (`jev-latest`), `TYPESAFE_BASE_URL` |
| Chat completions | Task plan, `DONE` confirmation, and field text the goal did not already contain. Also the whole decision when Jev is unset | `OPENAI_API_KEY`. Optional: `OPENAI_BASE_URL`, `OPENAI_MODEL`, `TEXT_MODEL` |
| None | `observe`, `run`, `explore`, `auto --decisions`, `generate --decisions` | — |

Priority for the decision provider: `--decisions` script, then Jev when `TYPESAFE_API_KEY` is set, then chat completions. `--model` and `--base-url` override the chat model and gateway. `codexqa-jev-browser.config.yaml` may use `${OPENAI_API_KEY}`-style placeholders. The CLI loads `cwd/.env`, then the repo-root `.env`, and does not overwrite variables already set in the shell. Do not pass `--api-key` or put a raw key in a case file.

Live `auto` / `generate --goal` still needs `OPENAI_API_KEY` for the planner, even when Jev chooses each click.

## Commands

```bash
npx codexqa-jev-browser observe examples/app/index.html
npx codexqa-jev-browser run cases/examples/search-docs.yaml cases/examples/login.yaml
npx codexqa-jev-browser run cases/examples/search-docs.md
npx codexqa-jev-browser run --from-api https://qa.example.com/cases
npx codexqa-jev-browser auto --url examples/app/index.html --goal '搜索 Pilot 并打开文档' \
  --decisions cases/scripts/decisions-search.yaml
npx codexqa-jev-browser generate --url examples/app/index.html --goal '搜索 Pilot 并打开文档' \
  --decisions cases/scripts/decisions-search.yaml --out generated/search.yaml --md --verify
npx codexqa-jev-browser explore --url examples/app/index.html --out generated/explore
```

The window is visible by default. `browser.headless: true` hides it. `--headed` forces a window. `--no-screenshots` skips images.

Reports land in `reports/<run-id>/report.html`. `report.json` is the machine-readable copy. `report.md` is the short summary. A failing case exits non-zero.

## Portable skill

This directory is the skill. `SKILL.md` sits next to the CLI.

```bash
npx skills add openqa-cn/codexqa --skill codexqa-jev-browser
```

Any agent that can run a shell uses the same CLI. The skill does not call a vendor browser tool.

Schema and verbs: [references/schema.md](references/schema.md). Examples: [references/examples.md](references/examples.md).

## Tests

```bash
npm test
```

Tests are offline. A passing run matches the fixtures. It does not show that a live site or a live model will succeed.
