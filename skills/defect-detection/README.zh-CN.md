# 缺陷检测

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md)

`defect-detection` 先跑确定性的 SAST / lint / secrets / SCA，再由**调用本 skill 的宿主 agent**做两阶段语义审查（默认 `--llm-mode agent`，无需 API key）。输出按 **P0→P3** 排序的 `report_scan.json` / `.md` / `.html`。代码图与调用链对**所有语言**统一走公开的 **CodexQA CLI**（`@openqa-cn/codexqa`）。

**不是** [`code-reviewer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-reviewer/README.zh-CN.md)（P0/P1/P2 playbook 审查），**不是** [`code-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/code-analyzer/README.zh-CN.md)（符号图影响面 / 测试缺口），也**不是** [`root-cause-diagnosis`](https://github.com/openqa-cn/codexqa/blob/main/skills/root-cause-diagnosis/README.zh-CN.md)（异常根因）。目标是代码风险 / 安全 / 逻辑的**扫描报告**时用本 skill。

## 安装要求

- **Python 3.10+**（强制；系统 `python3` 过旧时入口会自动 re-exec）
- 仓库增量/全量扫描需要 `git` 在 `PATH` 上
- 实图分析需要 `PATH` 上有 `@openqa-cn/codexqa` CLI（未允许 mock 时仓库扫描硬失败）：
  `npm install -g @openqa-cn/codexqa --registry https://registry.npmjs.org/`
- 可选扫描器：Semgrep、Bandit、gosec、gitleaks、ruff / eslint / golangci-lint、osv-scanner（`bash scripts/install_sast_tools.sh`）

## 安装 skill（npx）与跑 CLI（python）

| 命令 | 作用 |
|---|---|
| `npx skills add openqa-cn/codexqa --skill defect-detection` | 把 skill 装进 Coding Agent 的 skills 目录 |
| `python3 scripts/run_scan.py …` | 跑扫描编排器（**不是** `npx` 二进制） |

没有 `npx defect-detection` / package `bin`。安装后把 `$SKILL_DIR` 指到已安装目录，再跑 `python3 "$SKILL_DIR/scripts/run_scan.py"`。

见[安装指南](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.zh-CN.md)、[支持矩阵](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)和 [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.zh-CN.md)。

## 快速开始

在本 skill 目录下：

```bash
# 从用户话术推断场景
python3 scripts/run_scan.py choose --infer "帮我看看这个 PR 有没有安全问题"

# 增量准备（agent-inline handoff；再按 SKILL.md 做 Stage1 → Stage2 → finalize）
python3 scripts/run_scan.py incremental --repo /abs/path/to/repo --intent "PR review" -o /tmp/aid_report

# 粘贴 / 单文件 adhoc（重扫务必 --fresh）
python3 scripts/run_scan.py adhoc --scan-mode incremental --paste-file /tmp/snip.py --lang python --fresh -o /tmp/aid_report

# 仅 CI / 离线 mock
python3 scripts/run_scan.py incremental --repo . --dry-run -o /tmp/aid_report
```

默认 agent 模式总会写出 `agent_llm/` 供 Stage1/Stage2。全量重扫 / adhoc 复测加 `--fresh`。在读到 `AGENT_LLM_HANDOFF` / `MANIFEST.json` 之前不要编造发现项。

## Agent 说明

`SKILL.md` 是 AI agent 入口。主路径：选场景 → 确定性准备 → Stage1 JSON → `agent-stage2` → Stage2 JSON → `finalize` → 展示 `report_scan.*`。

运行时不要加载 `README` / `HOW_IT_WORKS` / `KNOWN_LIMITATIONS`。仅在上下文缺规则时再读 `references/`。

## 测试

```bash
# 使用 Python 3.10+（见 scripts/run_tests.sh）
npm test
# 或：
bash scripts/run_tests.sh  # 或: python3 scripts/test_pipeline_fixes.py
#（audit_policy_fixtures 已含在 run_tests.sh）
```

## 许可证

Apache License 2.0.

## 局限

依赖可选的 SAST 二进制，以及闭源的 `@openqa-cn/codexqa` CLI 做实图分析；Stage1/Stage2 质量由模型判断。具体失败面见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。数据流见[工作原理](HOW_IT_WORKS.zh-CN.md)。
