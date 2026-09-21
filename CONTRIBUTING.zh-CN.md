# 贡献指南

[English](CONTRIBUTING.md)

欢迎提交 Skill、适配器、案例和可复现问题。贡献必须包含用户问题、预期结果、运行命令和环境信息；尽可能同时提供正常对照与预置缺陷案例。

提交前运行：

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
(cd skills/testcase-generation && ./scripts/tcg-python scripts/close_stage.py --self-check && ./scripts/tcg-python scripts/check_run_gate.py --self-check && ./scripts/tcg-python scripts/generate_case_report.py --self-check)
python3 skills/skill-router/scripts/discover_skills.py --self-check
```

请勿提交客户代码、凭据、私有日志或个人数据。AI 生成的代码或文字本身不构成正确性证据。新增干活 skill 后请在完整 checkout 中运行 `skills/skill-router/scripts/refresh_catalog.py` 并提交更新后的 `catalog.json`。完整流程与质量条见英文 [CONTRIBUTING.md](CONTRIBUTING.md)。
