# README preview assets

Sample HTML used as screenshots in the repository README. They are **illustrations**, not recorded agent output. Eight published worker skills each have a page + PNG.

| File | Skill | How it was produced |
|---|---|---|
| `defect-report.html` / `.png` | `codexqa-defect-analyzer` | Live skill pipeline: `run_scan.py adhoc --from-dir examples/inventory-service/head` → Stage1/Stage2 → `finalize` (`report_scan.html`) |
| `review-report.html` / `.png` | `codexqa-code-reviewer` | `scripts/render-review-html.sh` on `evals/fixtures/conclusion/with-llm-judgment.json` |
| `code-wiki.html` / `.png` | `codexqa-code-wiki` | Official `assets/report-template.html` filled for `examples/inventory-service` (no live `wiki inputs`; mermaid CDN stripped for offline shot) |
| `code-analyzer.html` / `.png` | `codexqa-code-analyzer` | Wrapper around published `checkout-change-impact.svg` |
| `rootcause.html` / `.png` | `codexqa-rootcause-analyzer` | English `report.md` template headings, inventory-service NPE illustration (native delivery is Markdown) |
| `ra-register.html` / `.png` | `codexqa-requirement-analyzer` | Sample gap/conflict register |
| `testcase-report.html` / `.png` | `codexqa-testcase-generator` | `generate_case_report.py --run-dir` (Web / Server / APP aggregate) |
| `testdata-writeback.html` / `.png` | `codexqa-testdata-generator` | `{placeholder}` replaced with a backend-returned id |
| `testcase-sample.html` / `.png` | `codexqa-testcase-generator` | Extra: one V56 server-end case table |

GitHub’s blob view shows HTML as source. README screenshot links therefore open the rendered page via jsDelivr (`https://cdn.jsdelivr.net/gh/openqa-cn/codexqa@main/docs/assets/previews/<file>.html`), which serves `text/html`. Locally, open the `.html` file in this directory.

Capture PNGs at **4:3** (`1280×960` CSS, `2560×1920` at 2×). Needs the Playwright Chromium cache or `PLAYWRIGHT_CHROME`:

```bash
node docs/assets/previews/screenshot.mjs
```
