# Skill 发布流程

[English](PUBLISHING.md)

Skill 从本 GitHub 仓库通过 `npx skills add` 分发，无需发布 OpenQA 自有 npm 包。

发布前确认目录名与 `SKILL.md` 的 `name` 一致，提供 README、验收标准、可复现案例、兼容性和局限性，并运行：

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
npx skills add . --list
```

提交前检查实际文件列表，排除运行数据、私有配置和凭据。推送后确认 CI 和远程安装结果，再创建经过人工审核的 release。
