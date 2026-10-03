#!/usr/bin/env node
/** Render code-wiki.html from the codexqa-code-wiki test fixture (a real export of this repository). */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, "../../../skills/codexqa-code-wiki");
const lib = (name) => import(join(skill, "scripts/lib", name));
const { buildModel } = await lib("model.mjs");
const { validateNotes } = await lib("notes.mjs");
const { renderHtml } = await lib("render.mjs");
const { fileResolver, webLinks } = await lib("repo.mjs");

const fixture = (name) => JSON.parse(readFileSync(join(skill, "tests/fixtures/codexqa", name), "utf8"));
const meta = fixture("meta.json");
const model = buildModel(fixture("inputs.json"));
const { errors, notes } = validateNotes(fixture("notes.json"), model);
if (errors.length) throw new Error(`fixture notes are invalid:\n${errors.join("\n")}`);

const links = webLinks(meta.remote);
const html = renderHtml({
  model,
  notes,
  meta,
  repo: {
    name: meta.repo,
    branch: meta.branch,
    commit: meta.commit,
    commitDate: meta.commitDate,
    commitUrl: links.commit(meta.commit),
    resolveFile: fileResolver(resolve(here, "../../..")),
    fileUrl: (path) => links.file(meta.commit, path),
  },
  css: readFileSync(join(skill, "assets/wiki.css"), "utf8"),
  js: readFileSync(join(skill, "assets/wiki.js"), "utf8"),
});
writeFileSync(join(here, "code-wiki.html"), html);
console.log("code-wiki.html");
