# Skills

[English](README.md)

每个 skill 各自独立成文。已发布的 skill 都有一份给 Agent 读的 `SKILL.md` 和一份给人读的 `README.md`。[仓库 README](../README.zh-CN.md)提供报告样例、快速开始和各 skill 文档入口。

## 已发布的 skill

- [`defect-detection`](defect-detection/README.zh-CN.md)：SAST/lint/secrets/SCA + agent 内联语义扫描 → `report_scan.*`（P0–P3）。不是图证据审查（`ai-code-reviewer`），不是结构/影响面（`code-analyzer`），也不是异常 RCA（`root-cause-diagnosis`）。[工作原理](defect-detection/HOW_IT_WORKS.zh-CN.md)。
- [`testcase-generation`](testcase-generation/README.zh-CN.md)：对话驱动的测试方案与手工用例（Plan 0–5、Exec 6、Incremental），输入本地需求 / HTTPS 文档，产物为本地 Markdown。真实后端造数交给 `testdata-generation`。[工作原理](testcase-generation/HOW_IT_WORKS.zh-CN.md)。
- [`testdata-generation`](testdata-generation/README.zh-CN.md)：用 domain slot、工具、API 和生成脚本构造可复用测试数据，并把值回写成用例前置条件。[工作原理](testdata-generation/HOW_IT_WORKS.zh-CN.md)。
- [`ai-code-reviewer`](ai-code-reviewer/README.zh-CN.md)：CodexQA 图证据包 → 双语 `REVIEW-REPORT.html`（PR/diff、全仓或 adhoc）。不是 SAST+agent 扫描报告（`defect-detection`），也不是单独的结构/影响面问答（`code-analyzer`）。[工作原理](ai-code-reviewer/HOW_IT_WORKS.zh-CN.md)。
- [`requirements-analyzer`](requirements-analyzer/README.zh-CN.md)：对需求文档做质量与风险分析，产出一份带 P0/P1 验证项的缺口 / 冲突登记表。它不写用例——那是 `testcase-generation`。[工作原理](requirements-analyzer/HOW_IT_WORKS.zh-CN.md)。
- [`code-analyzer`](code-analyzer/README.zh-CN.md)：本机符号图质量保障——先给仓库建索引，再审变更、圈回归、找测试缺口、追报错，走 `codexqa` CLI。[Skill 手册](code-analyzer/README.zh-CN.md)。
- [`root-cause-diagnosis`](root-cause-diagnosis/README.zh-CN.md)：在 CodexQA CLI 分析之上做异常根因诊断（堆栈/日志 → 带门禁的英文报告）。不是结构/影响面（`code-analyzer`），也不是代码风险扫描（`defect-detection`）。[工作原理](root-cause-diagnosis/HOW_IT_WORKS.zh-CN.md)。

提新 skill 时用 [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md)。一个够格的贡献要解决一个独立的验证问题、带验收标准、并给出可复现的证据。
