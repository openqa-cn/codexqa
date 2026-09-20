# Working with codexqa

codexqa is a verification project. Agent-assisted contributions are welcome, but every change must be reviewed by a human maintainer and supported by reproducible evidence.

## Before changing a skill

1. Read the skill's `SKILL.md` and its examples.
2. State the user problem and acceptance criteria.
3. Add a known-good case and, where possible, a seeded-defect or expected-failure case.
4. Document supported agents, frameworks, environments, and limitations.
5. Run the repository checks before opening a pull request.

Never include secrets, customer code, private logs, or personal data. Do not claim that a check proves correctness when it only proves that a command exited successfully.

## Before any `git push`

Mandatory identity gate (see `.cursor/rules/git-push-identity-gate.mdc`). Run and verify **every** item before push; if any output mismatches the expected value, **do not push** and report to the user:

```bash
git config user.name          # leviacicig
git config user.email         # eviacici@126.com
git remote -v                 # must contain github.com-leviacicig, or core.sshCommand points at this key
ssh -T git@github.com-leviacicig
```
