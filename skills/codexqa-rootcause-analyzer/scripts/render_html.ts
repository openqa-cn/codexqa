#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import { render_html_report, render_preview_html } from "./html_report.ts";

const args = process.argv.slice(2);
const previewAt = args.indexOf("--preview");
if (previewAt >= 0) {
  const out = args[previewAt + 1];
  if (!out) {
    console.error("usage: render_html.ts --preview <path.html>");
    process.exit(1);
  }
  writeFileSync(out, render_preview_html(), "utf8");
  process.exit(0);
}

const mdAt = args.indexOf("--markdown-file");
const outAt = args.indexOf("--out");
if (mdAt >= 0 && outAt >= 0) {
  const md = readFileSync(args[mdAt + 1], "utf8");
  writeFileSync(args[outAt + 1], render_html_report(md, { lang: "en", store: "rca-report" }), "utf8");
  process.exit(0);
}

console.error("usage: render_html.ts --preview <path.html>");
process.exit(1);
