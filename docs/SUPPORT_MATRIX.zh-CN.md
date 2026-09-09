# 兼容性与验证状态

[English](SUPPORT_MATRIX.md)

安装兼容不等于分析质量。扩大任何一条支持结论之前，先记录 Agent / 模型、运行时、操作系统、commit 和实际结果。除非另行点名，下表行属于 `defect-detection`。产物样例：[README 预览](../README.zh-CN.md#产物长什么样)。

| 组件 | 当前证据 | 限制 |
| --- | --- | --- |
| TypeScript CLI | macOS、Node 22.15.0、开启 TypeScript stripping，本地曾通过 94 个测试 | 覆盖已测行为，不代表能发现所有缺陷 |
| Linux / Node 22 | 本仓库已配置 CI job | 推送后需要核对托管环境的实际结果 |
| Codex、Claude Code、Cursor、OpenClaw | Skill 指令覆盖 | 尚未逐一完成完整 Agent 流程验证 |
| Java / GitNexus | 有集成代码和测试 | 依赖外部工具版本和环境 |
| 多语言流水线（Java、Kotlin、Scala、JS、TS、Python、Go、C、C++、C#） | 统一语言注册表 `scripts/lang.ts` 驱动语言解析（`languageSource` explicit / declared / detected）、按语言的方法抽取与 Semgrep 精化范围（`scripts/lang_methods.ts`）、平凡方法约定、className / filePath / 代码围栏约定以及各语言检测须知（`references/rules/*-gotchas.md`）；多语言 E2E（`tests/multilang_e2e.test.ts`：Python + Go + TS 仓库走完 submit → clone → plan → read → verify → template）及各语言抽取器单测 | 抽取器基于正则/括号/缩进而非完整解析器；嵌套/匿名函数与宏密集 C 为近似；除 GitNexus 外无语言专属调用图 |
| Semgrep 种子包（10 种语言） | 102 条规则，带 CWE / OWASP Top 10 2025 / ASVS 5.0 元数据；在 Semgrep 1.99 上用 10 语言 fixture 验证（67 命中、0 解析错误）；按扫描文件的语言集合过滤规则；旧版 Semgrep 拒绝的规则按版本剔除并在 `droppedRules` 中报告 | 污点规则仅函数内（社区版）；Semgrep 0.8x 只能加载非污点子集；种子规则只覆盖浅层模式，不能替代方法级分析 |
| 可选叠加扫描 | `scripts/overlays.ts` 注册表：gitleaks、trivy / grype、bandit、gosec、go vet、staticcheck、cppcheck、eslint、detekt；解析器与运行器有桩二进制单测 | 尚无真实二进制的 CI 运行；原生工具依赖项目自身配置（eslint）或工具链（go） |
| JS / TS AST | 本地 Semgrep 种子规则 + checkout-boundary fixture 单测 | 种子规则只覆盖浅层模式，不能替代方法级业务分析 |
| JS / TS 方法级 | `scripts/lang_methods.ts` 可为 `.js/.mjs/.ts/...` 生成真实检测计划；对 `inventory-service` reservation-v2 盲测（7 个植入缺陷：跨方法状态/竞态/规格偏离/边界/吞异常/锁泄漏/跨文件不变量 + 4 个陷阱）：**召回 7/7、精确率 7/7、陷阱误报 0**（Composer，2026-09-08，运行时复现确认） | 单次 Agent/模型样本，非多模型 benchmark；文档相关性需 `add-document`（现已写入 extractedRules）或 `check-phase2-readiness` 才能把 T3 提上去 |
| Python AST | 17 条 Semgrep 种子规则（含 except-pass、`== None`、可变默认参数、SQL / shell / pickle / SSRF / 重定向 / XSS 污点）+ 语言过滤单测 | 方法级抽取基于缩进；除 GitNexus 外无调用图 |
| 前端自然语言规则 | FE-001 ~ FE-012 + 含 Node/TypeScript 小节的 `frontend-gotchas.md` | 不宣称框架级支持 |
| 本地 provider | 任务、报告、写回测试 | 未认证多人并发 |
| HTTP / GitHub provider | 有适配器和协议测试 | 真实凭据集成待验证 |
| ZIP 打包 | 打包 / 解包冒烟测试 | 需要 Bash、rsync、zip、unzip |
| Windows（defect-detection） | 运行时路径全部来自数据目录（不再依赖 `/tmp`），`.cmd` 垫片由 `scripts/sys.ts` 处理，fixture 构建脚本为纯 Node，`.gitattributes` 强制 LF | 尚未在 Windows CI 上跑过；Semgrep 的 Windows 版本为 beta，GitNexus 未测；Quick start 片段需 Git Bash / WSL |
| Windows（仓库整体） | 未验证 | shell 命令和测试脚本目前面向 POSIX |
| 证据 schema | 仓库内提供 schema | 不宣称 skill 输出自动符合该 schema |
| `testcase-generation` 脚本 | `validate_integrations.ts`、`call_integration.ts`、`lint_case_documents.ts` 在 Node 22.6+ 上用 TypeScript stripping 运行；不装 npm 包 | 无公开 fixture、无已记录 agent 运行；Windows 未测；无子 agent 的宿主未测 |
| `testdata-generation` 脚本 | 打包、slot 检索和本地 catalog mock 见该 skill 文档 | 运行依赖已配置的 adapter 与 slot；不在 defect-detection CLI 套件覆盖范围内 |
| `code-reviewer` playbook | `tooling/` 离线契约检查（在 `tooling/` 里 `npm test`） | 没有公开 fixture 或已记录的宿主 agent 运行；报告质量未测量 |
| `requirements-analyzer` | 该 skill 的 `evals/` skill-up 用例和解析/转换脚本 | 没有已记录的宿主 agent 成绩；分析靠模型，不是 `run_analysis.ts` |

当前证据：已有一次 JS 端到端盲测样本（召回/精确率 7/7，见上表 JS / TS 方法级一行）。尚未形成多模型公开 benchmark。另见[示例](../examples/README.zh-CN.md)和[评估方法](../benchmarks/README.md)。
