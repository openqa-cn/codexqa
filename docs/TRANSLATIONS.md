# Translations

OpenQA is a global open-source project. The English README is the canonical project overview; translated READMEs should keep the same structure and link back to it.

## Current languages

- [English](../README.md)
- [简体中文](../README.zh-CN.md)

## Adding a translation

Use the filename `README.<language-code>.md`, for example `README.ja.md` or `README.es.md`. Keep product names, command names, code, links, license terms, and status labels unchanged. Add the language to the language switcher in both English and Chinese READMEs.

Translations should be updated when the English README changes materially. Do not translate a capability as shipped if it is marked experimental or planned in the English source.

## Keeping a pair aligned

A translation that silently loses sections is worse than no translation: the Chinese README once pointed at an FAQ answer the Chinese FAQ did not have. `scripts/check-docs.py` compares the `## ` count of every `X.md` / `X.zh-CN.md` pair and fails when they diverge.

A file that is deliberately shorter than its English source must be listed in `translation_gaps` in that script, with a reason. Entries are printed on every run, so a gap stays visible until someone closes it; the check also fails once a listed pair matches, which forces the entry to be removed instead of going stale.
