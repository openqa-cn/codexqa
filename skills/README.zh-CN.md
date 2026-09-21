# Skills

[English](README.md)

每个 skill 各自独立成文。已发布的 skill 都有一份给 Agent 读的 `SKILL.md` 和一份给人读的 `README.md`。[仓库 README](../README.zh-CN.md)提供报告样例、快速开始和各 skill 文档入口。

安装某个 skill：`npx skills add openqa-cn/codexqa --skill <name>`（例如 `--skill codexqa-skill-router` 或 `--skill codexqa-defect-analyzer`）。

## 已发布的 skill

- [`codexqa-skill-router`](codexqa-skill-router/README.zh-CN.md)：对照现场兄弟与内置 catalog 匹配，必要时按需安装到路由旁边并交接。本身不干活——只选择、可拉取、再跟随其它 skill。[工作原理](codexqa-skill-router/HOW_IT_WORKS.zh-CN.md)。
- [`codexqa-defect-analyzer`](codexqa-defect-analyzer/README.zh-CN.md)：SAST/lint/secrets/SCA + Agent LLM Detection → `report_scan.*`（P0–P3，去重合并）。不是图证据审查（`codexqa-code-reviewer`），不是结构/影响面（`codexqa-code-analyzer`），也不是异常 RCA（`codexqa-rootcause-analyzer`）。[工作原理](codexqa-defect-analyzer/HOW_IT_WORKS.zh-CN.md)。
- [`codexqa-testcase-generator`](codexqa-testcase-generator/README.zh-CN.md)：对话驱动的测试方案与手工用例（Plan 0–5、Exec 6、Incremental），输入本地需求 / HTTPS 文档，产物为本地 Markdown，并生成聚合 HTML 报告（`testcase_generation_report.html`）。真实后端造数交给 `codexqa-testdata-generator`。[工作原理](codexqa-testcase-generator/HOW_IT_WORKS.zh-CN.md)。
- [`codexqa-testdata-generator`](codexqa-testdata-generator/README.zh-CN.md)：用 domain slot、工具、API 和生成脚本构造可复用测试数据，并把值回写成用例前置条件。[工作原理](codexqa-testdata-generator/HOW_IT_WORKS.zh-CN.md)。
- [`codexqa-code-reviewer`](codexqa-code-reviewer/README.zh-CN.md)：CodexQA 图证据包 + 启发式维度 + Agent LLM judgment（去重）→ 双语 `REVIEW-REPORT.html`（PR/diff、全仓或 adhoc）。不是 SAST+agent 扫描报告（`codexqa-defect-analyzer`），也不是单独的结构/影响面问答（`codexqa-code-analyzer`）。[工作原理](codexqa-code-reviewer/HOW_IT_WORKS.zh-CN.md)。
- [`codexqa-requirement-analyzer`](codexqa-requirement-analyzer/README.zh-CN.md)：对需求文档做质量与风险分析，产出一份带 P0/P1 验证项的缺口 / 冲突登记表。它不写用例——那是 `codexqa-testcase-generator`。[工作原理](codexqa-requirement-analyzer/HOW_IT_WORKS.zh-CN.md)。
- [`codexqa-code-analyzer`](codexqa-code-analyzer/README.zh-CN.md)：本机符号图质量保障——先给仓库建索引，再审变更、圈回归、找测试缺口、追报错，走 `codexqa` CLI。[Skill 手册](codexqa-code-analyzer/README.zh-CN.md)。
- [`codexqa-rootcause-analyzer`](codexqa-rootcause-analyzer/README.zh-CN.md)：在 CodexQA CLI 分析之上做异常根因诊断（堆栈/日志 → 带门禁的英文报告）。不是结构/影响面（`codexqa-code-analyzer`），也不是代码风险扫描（`codexqa-defect-analyzer`）。[工作原理](codexqa-rootcause-analyzer/HOW_IT_WORKS.zh-CN.md)。
- [`code-wiki`](code-wiki/README.zh-CN.md)：本机架构知识图谱——先建索引，再用 `wiki inputs`（不调模型）导出社区 digest，写出 Claude Code 风格的 HTML Wiki。[Skill 手册](code-wiki/README.zh-CN.md)。

提新 skill 时用 [SKILL_TEMPLATE.md](SKILL_TEMPLATE.md)。一个够格的贡献要解决一个独立的验证问题、带验收标准、并给出可复现的证据。
