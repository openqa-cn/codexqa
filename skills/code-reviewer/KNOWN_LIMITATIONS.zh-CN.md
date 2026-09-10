# 已知边界与失败场景

[English](KNOWN_LIMITATIONS.md)

这里每条都是文件里能看到的，或跑过之后观察到的，不是免责声明。设计背景见[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 没有公开 fixture，也没有测过准确率

没有答案键仓库，也没有和 defect-detection inventory-service 7/7 对等的宿主 agent 成绩。`tooling/` 的契约测试锁的是脚本行为（跳过、缺 token、进度、无 diff），不能证明模型会引用真实行号，也不能证明 P1/P2 噪音受控。

## 这不是 defect-detection

两句话都可能是「审这个 PR」，活不一样：

| | `code-reviewer` | `defect-detection` |
|---|---|---|
| 输入 | 本地工作副本 + 分支 / PR / commit | Git 地址 + 分支（会克隆） |
| 引擎 | playbook + 可选 `tooling/` | CLI、AST、可选调用图、23 条写回规则 |
| 输出 | P0 / P1 / P2 发现报告 | 结构化写回 + HTML 报告 |

只装本 skill 不会建检测任务、不会跑 Semgrep 种子包，也不会像 `validate.ts` 那样对照源码校验发现。

## 位置是 playbook 约定，不是机械门禁

P0 要求文件:行号、运行时后果和规则引用。`tooling/` 里没有任何步骤会回读文件证明行号存在。模型仍可能编造位置，并把三步检查标成已完成。报告必须人工看。

## 可选脚本就是可选的

`review-progress.js`、安全/依赖扫描、打包器在 Node 跑不了或宿主拦截命令时会被跳过。审查继续，只是没有进度文件，也就不能断点续跑。这是 `review-playbook.md` 约定 A，不是安装失败。

## 未开启前，HTTP 集成不会自己连上

被审仓库里没有 `code-reviewer.config.json` 时，浏览链接模板和所有 `integrations.*` 都不会用。本 skill 不会从 OpenQA 仓库里猜出你们内部的 Git 浏览器或通知 webhook。

## 许可证是 MIT

本 skill 是 MIT（本目录 `LICENSE`）。`codexqa` 其余部分是 Apache-2.0。不要假定父仓库的 SPDX 覆盖这里的文件。
