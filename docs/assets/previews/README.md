# README preview assets

Sample HTML used as screenshots in the repository README. They are **illustrations**, not recorded agent output. Eight published worker skills each have a page + PNG.

| File | Skill | How it was produced |
|---|---|---|
| `defect-report.html` / `.png` | `codexqa-defect-analyzer` | `merge_report.render_html_report` (testcase-generator chrome; canned inventory-service findings) |
| `review-report.html` / `.png` | `codexqa-code-reviewer` | `scripts/render-review-html.sh` on `evals/fixtures/conclusion/with-llm-judgment.json` |
| `code-wiki.html` / `.png` | `codexqa-code-wiki` | DeepWiki HTML from a filled architecture wiki (`wiki inputs` on this repo); PNG is a **4:3** crop (`1280×960`) |
| `code-analyzer.html` / `.png` | `codexqa-code-analyzer` | Wrapper around published `checkout-change-impact.svg` |
| `rootcause.html` / `.png` | `codexqa-rootcause-analyzer` | Bilingual RCA sample (English `report.md` headings + Chinese twins); native delivery is Markdown + `report.html` |
| `ra-register.html` / `.png` | `codexqa-requirement-analyzer` | Sample gap/conflict register |
| `testcase-report.html` / `.png` | `codexqa-testcase-generator` | `generate_case_report.py --run-dir` (Web / Server / APP aggregate) |
| `testdata-writeback.html` / `.png` | `codexqa-testdata-generator` | `{placeholder}` replaced with a backend-returned id |
| `testcase-sample.html` / `.png` | `codexqa-testcase-generator` | Extra: one V56 server-end case table |

Rebuild illustration HTML (except `review-report.html` and `testcase-report.html`):

```bash
python3 docs/assets/previews/rebuild_previews.py
```

GitHub blob and jsDelivr both serve these `.html` files as `text/plain` with `nosniff`, so the browser shows source. README screenshot links therefore open [htmlpreview.github.io](https://htmlpreview.github.io/) (`https://htmlpreview.github.io/?https://github.com/openqa-cn/codexqa/blob/main/docs/assets/previews/<file>.html`), which renders `text/html`. Locally, open the `.html` file in this directory.

Capture PNGs at **4:3** (`1280×960` CSS, `2560×1920` at 2×). Needs the Playwright Chromium cache or `PLAYWRIGHT_CHROME`:

```bash
node docs/assets/previews/screenshot.mjs
```
