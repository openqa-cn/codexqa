# AI Defect Detection FAQ

## What is OpenQA Skills?

OpenQA Skills is an experimental open-source repository for AI-assisted defect review. Its current skill, ai-defect-detection, combines agent instructions with a CLI and local or remote providers.

## Do I need an npm account or an OpenQA account?

No. `npx skills add` runs a community installer that fetches skill files from GitHub. Local providers do not require an OpenQA account. Your agent or remote providers may have their own account requirements.

## Does installing the skill run a review?

No. Installation makes the files available to the agent. Provide an actual repository and branch to start a review. The CLI stores and validates results; it does not supply an AI model.

## Does code stay on my machine?

Local providers persist results on disk, but that is not a guarantee of offline execution. The host agent/model controls how source context is processed. Configured HTTP providers can send business material and findings to external services. GitHub issue integration can create external records.

Repository cloning and fetching public documents can also use the network. Current analysis commands may attempt to install Semgrep via pip/Homebrew and GitNexus globally via npm/pnpm. Review configuration and host permissions before analyzing confidential repositories.

## Where are reports and configuration stored?

Defaults include `data/` under the skill installation and local `enterprise/` inputs. Runtime overrides include `DETECTION_DATA_DIR`, `CONTENT_JSON_BASE`, and `DETECTION_ENTERPRISE_DIR`; consult the [operator manual](../skills/ai-defect-detection/operator-manual.md) and [adapter guide](../skills/ai-defect-detection/docs/adapters.md). Keep runtime data and private configuration outside version control and back them up before upgrading.

## Is this a replacement for static analysis or testing?

It combines static-analysis integration with agent-led review. It does not replace test execution or establish the absence of defects. Structure/coverage gates validate records, not semantic correctness. AI candidates require human review.

## What languages and agents are supported?

The instructions mention Codex, Claude Code, Cursor, and OpenClaw. Installation compatibility, runtime tests, and complete agent validation are different claims. See the [support matrix](SUPPORT_MATRIX.md) for what has actually been checked. Java receives method/call-graph-oriented handling; other language behavior depends on the relevant extraction and scan paths.

## Is detection accuracy measured?

Not yet on a published agent benchmark. The regression suite validates CLI and workflow behaviors. The boundary example demonstrates a deterministic defect, not AI detection accuracy or a false-positive rate.
