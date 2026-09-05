# Working with OpenQA Skills

OpenQA is a verification project. Agent-assisted contributions are welcome, but every change must be reviewed by a human maintainer and supported by reproducible evidence.

## Before changing a skill

1. Read the skill's `SKILL.md` and its examples.
2. State the user problem and acceptance criteria.
3. Add a known-good case and, where possible, a seeded-defect or expected-failure case.
4. Document supported agents, frameworks, environments, and limitations.
5. Run the repository checks before opening a pull request.

Never include secrets, customer code, private logs, or personal data. Do not claim that a check proves correctness when it only proves that a command exited successfully.
