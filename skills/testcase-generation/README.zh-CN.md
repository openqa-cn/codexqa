# testcase-generation

[English](README.md) · [工作原理](HOW_IT_WORKS.zh-CN.md) · [已知边界](KNOWN_LIMITATIONS.zh-CN.md) · [使用指南](user-guide.md)

面向 APP / Web / 服务端的对话式**测试方案与用例**生成。完整跑 **Plan（阶段 0–5）**、**Exec（阶段 6）** 和/或 **Incremental（提测后增量）**。产物仅为本地 Markdown。

当前策略（V56）：不连接用例平台或文档平台，也不调用外部知识检索 Skill。知识来自需求 / 技术方案、本 skill 内置规范，以及你主动提供的本地知识目录或知识库 Git URL。Stage 0 可抓取你本轮给出的 `http(s)://` 文档 URL 并落成 testdocs 正文，不爬页内其它链接。提测后增量在本 Skill 内完成；当你明确给出 PR / MR / 代码平台 PR 页或自定义 git 仓库 URL，且已有用例基线时，可用 git 拉代码做 diff 增强。

**不是** [`requirements-analyzer`](https://github.com/openqa-cn/codexqa/blob/main/skills/requirements-analyzer/README.zh-CN.md)（缺口 / 冲突登记表），**不是** [`testdata-generation`](https://github.com/openqa-cn/codexqa/blob/main/skills/testdata-generation/README.zh-CN.md)（后端造数 / 回写），也**不是**代码风险扫描（`defect-detection` / `ai-code-reviewer`）。

## 环境要求

- PATH 上有 Python **3.10+**（系统 `python3` 过旧时用 `scripts/tcg-python` 解析到 `python3.11` / `3.12` / …）
- 仅在提供知识库 Git URL 或 Incremental PR/git URL 时需要 `git`

## 安装

```bash
npx skills add openqa-cn/codexqa --skill testcase-generation
```

见[安装指南](https://github.com/openqa-cn/codexqa/blob/main/docs/GETTING_STARTED.zh-CN.md)、[支持矩阵](https://github.com/openqa-cn/codexqa/blob/main/docs/SUPPORT_MATRIX.zh-CN.md)和 [FAQ](https://github.com/openqa-cn/codexqa/blob/main/docs/FAQ.zh-CN.md)。

## 怎么用

把 PRD / 技术方案（本地文件、目录、粘贴正文，或本轮给出的 `http(s)://` 文档 URL）交给 Agent，并说明要测试方案、用例，还是两者都要。

```
生成测试方案：/Users/me/docs/prd.md
```

可选知识（二选一或都不要）：

```
知识目录：/Users/me/kb/biz
知识库仓库：https://git.example.com/team/biz-knowledge.git#main
```

- 只要方案 → 跑完阶段 0–4-1，过 stage5 gate，再写 `testdesign/test_design.md`
- 只要用例且正式方案已在盘上 → 跑阶段 6
- 方案和用例都要 → 先 Plan；方案落盘后确认一次，再写用例
- 提测后增量 / 增强已有用例 → 在既有基线上 diff 增强或直接更新，写 `testcase/cases/`
- 按 PR / 自定义仓库增量 → 先有用例基线，再明确给出 PR / MR / 代码平台 PR 页或仓库 URL；拉到 `.pr-cache/` 再 diff

只抓取本轮给出的文档 URL，不爬页内链接。需求正文里的 URL 不当作知识库或 PR。失败按脚本 `error.code` 解释：`PR_PERMISSION_DENIED`、`PR_HEAD_REF_MISSING`，其余原样上报。

**使用细节：** [user-guide.md](user-guide.md)。**Agent 执行地图：** [SKILL.md](SKILL.md)。

## 产物位置

默认运行目录：`$HOME/testdata-generation/runs/{runid}`。也可指定本地目录。内部子目录仍在该 `run_dir` 下。

| 内容 | 路径 |
|---|---|
| 配置与阶段 0–4-1 报告 | `{run_dir}/testcase/testdocs/` |
| 正式测试方案 | `{run_dir}/testdesign/test_design.md` |
| 用例生成报告（HTML，聚合 Web/服务端/APP） | `{run_dir}/testdesign/testcase_generation_report.html` |
| 初始用例 | `{run_dir}/testcase/initialcase/` |
| 当前有效用例 | `{run_dir}/testcase/cases/` |
| 增量过程区 | `{run_dir}/testcase/.case-enhance/{executionId}/` |
| PR 代码缓存 | `{run_dir}/testcase/.pr-cache/` |
| 可选知识索引 | `{run_dir}/knowledge/index.md` |

## 不做什么

- 不绑定远程用例空间；不召回 / 上传远程用例
- 不写远程文档；不安装文档平台或身份 CLI
- 不调用外部知识检索 Skill
- 不从需求正文自动 clone Git
- 提测后增量在本 Skill 内完成
- 不构造真实后端测试数据（那是 `testdata-generation`）

## 冒烟检查

```bash
./scripts/tcg-python scripts/close_stage.py --self-check
./scripts/tcg-python scripts/check_run_gate.py --self-check
./scripts/tcg-python scripts/generate_case_report.py --self-check
```

## 许可证

MIT。见 [LICENSE](LICENSE)。

## 边界

阶段门禁是确定性的；方案 / 用例正文由模型判断。见[已知边界](KNOWN_LIMITATIONS.zh-CN.md)。数据流见[工作原理](HOW_IT_WORKS.zh-CN.md)。
