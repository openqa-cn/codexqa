# Skill 发布流程

[English](PUBLISHING.md)

Skill 从本 GitHub 仓库通过 `npx skills add` 分发，无需发布 OpenQA 自有 npm 包。

## 推送前

1. 确认每个 Skill 目录名与 `SKILL.md` 中的 `name` 和 `skills.json` 注册项一致。
2. 提供面向用户的说明、运行要求、示例和局限性。
3. 在仓库根目录运行：

```bash
python3 scripts/check-docs.py
export NODE_OPTIONS=--experimental-strip-types
(cd skills/ai-defect-detection && npm test)
node examples/checkout-boundary/verify.mjs
npx skills add . --list
```

4. 检查实际待提交文件，排除运行数据、私有配置、凭据和不应发布的元数据。忽略规则不会自动移除已被 Git 跟踪的文件。
5. 更新 CHANGELOG、支持状态和发布检查清单，并按仓库要求完成人工审核。

## 推送后

检查远程 CI 结果，确认 `npx skills add openqa-cn/openqa-skills --list` 能发现 Skill，并在隔离项目中验证安装流程。远程安装命令无法读取尚未推送的本地修改。

创建经过审核的 GitHub release/tag，说明变更、运行要求和已知限制。可通过以下命令生成可选 ZIP 包：

```bash
bash skills/ai-defect-detection/pack-skill.sh /absolute/output/directory
```

版本元数据应与 release 保持一致；当前导入的 Skill 元数据版本为 0.0.2。

## 分发边界

通用安装器直接读取 Git 仓库，不一定应用 `pack-skill.sh` 的排除规则。ZIP 脚本会排除测试、运行数据、私有配置和开发期 package 元数据。无论使用哪种分发方式，都应把公开示例输入与真实任务结果分开存放。

发布时使用[发布检查清单](docs/RELEASE_CHECKLIST.md)。命令通过只能说明对应检查成功，不能证明不存在未发现的缺陷。
