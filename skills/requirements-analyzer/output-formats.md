# Output Format Options

This skill **defaults to Markdown** and must keep the 7-section prompt structure. To get **Excel**, **CSV**, **JSON**, or **Word**, add a format request at the **end** of your prompt:

- **Excel:** "Please output as a tab-separated table for pasting into Excel." Put the register in its own sheet or contiguous table.
- **CSV:** "Please output as CSV (comma-separated, header row first)." Prefer register fields.
- **JSON:** "Please output as JSON." Use `output-templates/template-json.json`; do not invent a new schema.
- **Word:** "Please output as a plain-text outline suitable for Word."
- **XMind:** "Please output as a mind-map outline."

Changing format changes the carrier only. Audit, register, P0 verification columns, and blockers must remain.
