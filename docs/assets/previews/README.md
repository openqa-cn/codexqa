# README preview assets

Sample pages used as screenshots in the repository README. They are **illustrations**, not recorded agent output.

| File | What it shows |
|---|---|
| `defect-report.html` | Real `render_report_html` output with three inventory-hold findings |
| `testcase-sample.html` | What a generated manual case looks like after Markdown is rendered |
| `cr-findings.html` | Typical `code-reviewer` P0 / P1 report shape |
| `ra-register.html` | One `requirements-analyzer` gap / conflict register |
| `testdata-writeback.html` | `{placeholder}` replaced with a backend-returned id |

Regenerate the defect report:

```bash
export NODE_OPTIONS=--experimental-strip-types
node docs/assets/previews/render-defect-report.ts
```

Then capture PNGs (needs Chromium):

```bash
# uses PLAYWRIGHT_CHROME if set, else the local Playwright cache
node docs/assets/previews/screenshot.mjs
```
