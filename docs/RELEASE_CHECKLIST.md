# Release checklist

- [ ] If worker skill descriptions changed, `skills/codexqa-skill-router/references/catalog.json` refreshed via `refresh_catalog.py`
- [ ] `python3 skills/codexqa-skill-router/scripts/discover_skills.py --self-check` passes
- [ ] Human maintainer reviewed the actual diff and proposed file list
- [ ] English and Chinese README agree on shipped capabilities
- [ ] Documentation links and skill registry checks pass
- [ ] CLI suite and deterministic example pass; environment recorded
- [ ] ZIP contents and installation in an isolated project checked
- [ ] Remote skill discovery checked after push
- [ ] Hosted CI result verified, not merely workflow configuration
- [ ] No runtime data, private configuration, secrets, or unreviewed sample provenance
- [ ] Network/model data handling and automatic tool installation disclosed
- [ ] Changelog and version metadata agree with the selected release
- [ ] GitHub Release body includes `https://openqa.cn/` (workflow `.github/workflows/release-notes.yml` + skeleton `.github/release-notes.md`; fill hosts/limits by hand)
- [ ] Release notes distinguish CLI tests, agent validation, and benchmark claims
- [ ] Report preview is labeled as fixture, illustrative, or actual agent output
