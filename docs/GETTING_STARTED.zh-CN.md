# 安装与运行 codexqa

[English](GETTING_STARTED.md)

在 Cursor、Claude Code、Codex 或 OpenClaw 上一次只装一个 skill。本页以 [`defect-detection`](../skills/defect-detection/README.zh-CN.md) 为例，因为它有可冒烟的 CLI。同一条命令也可以加 `--skill code-reviewer`、`--skill requirements-analyzer`、`--skill testcase-generation`、`--skill testdata-generation`——那四个没有 `detect.ts` 套件。

每个 skill 要交的材料不一样（[FAQ](FAQ.zh-CN.md#每个-skill-要我交什么)）。跑完长什么样见 [README · 产物长什么样](../README.zh-CN.md#产物长什么样)。

## 环境要求

需要 Node.js、npm/npx、Git，以及能够读取 skill 文件并执行命令的 Coding Agent。CLI 测试在 macOS、Node 22.15.0 上通过，运行 TypeScript 需要：

```bash
export NODE_OPTIONS=--experimental-strip-types
node --version
git --version
```

这个环境变量要设在**实际执行 Agent CLI 命令的那个 shell** 里。桌面版 Agent 不一定继承你另开的终端的环境。如果某条 `.ts` 命令报 `ERR_UNKNOWN_FILE_EXTENSION`，就去查那条命令用的 Node 版本和环境。上面的写法会覆盖已有的 `NODE_OPTIONS`，需要保留的选项请自己拼上。

分析过程可能尝试安装 Semgrep（Python/pip 或 Homebrew）和 GitNexus（npm/pnpm）。打包测试还需要 Bash、rsync、zip 和 unzip。联网与数据行为见 [FAQ](FAQ.zh-CN.md)。

## 从 GitHub 安装

```bash
npx skills add openqa-cn/codexqa --skill defect-detection
```

按提示选择 Agent。默认安装范围是当前项目。为 Codex 跨项目安装：

```bash
npx skills add openqa-cn/codexqa --skill defect-detection --agent codex --global
```

想要复制而不是软链到 Agent 目录，加 `--copy`。安装位置由第三方 `skills` 安装器决定，看它的输出找已安装目录。**装得上不等于在那个 Agent 上能跑完整分析。**

## 本地验证

推送前，先不安装、只列出本地可用的 skill：

```bash
npx skills add . --list
```

要把当前 checkout 装上，在仓库根目录运行：

```bash
npx skills add . --skill defect-detection --agent codex --copy
```

只做 CLI 冒烟，不需要模型也不需要私有平台：

```bash
export NODE_OPTIONS=--experimental-strip-types
node skills/defect-detection/scripts/detect.ts --help
node --test skills/defect-detection/tests/cli_smoke.test.ts
```

冒烟套件验证样例计划加载、任务创建和材料缺失时的处理。里面的 `acme` 仓库地址是样例数据，这个测试不会去克隆它们。想看一组「正常实现 + 预置缺陷」的对照，跑[边界案例](../examples/checkout-boundary/README.md)。

## 启动审查

安装后新建会话。给出可访问的仓库 URL 和分支，以及你能提供的需求或测试用例。可以直接这么说：

> 用 defect-detection 审查我的仓库 REPOSITORY_URL，分支 BRANCH_NAME。对照这些需求检查改动实现：REQUIREMENTS。每个疑似缺陷给出代码位置、触发条件和依据。

把大写占位符换成真实内容。流程跑通的话，你会拿到一个任务、若干分析记录和一个报告链接。接受报告前，先确认有没有服务没跑完、工具不可用。疑似发现一律留给人复核，不是自动合并决定。

## 更新与卸载

用第三方安装器自己的帮助确认当前可用选项：

```bash
npx skills --help
npx skills list
npx skills update
npx skills remove defect-detection --agent codex
```

全局安装在支持的地方加 `--global`。更新或删除已安装目录前，先备份配置和任务数据。默认 skill 把数据存在自己的安装目录里，**更新不能当备份手段用**。

## 其他已发布 skill

```bash
npx skills add openqa-cn/codexqa --skill code-reviewer
npx skills add openqa-cn/codexqa --skill requirements-analyzer
npx skills add openqa-cn/codexqa --skill testcase-generation
npx skills add openqa-cn/codexqa --skill testdata-generation
```

安装后新建 Agent 会话并指向该 skill。输入各不相同：

- `code-reviewer` 需要本地 Git 工作副本，再加上分支 / PR / commit。它不克隆。见 [README · 你要交什么](../skills/code-reviewer/README.zh-CN.md#你要交什么)。
- `requirements-analyzer` 需要需求文档，不要交仓库。见 [README · 你要交什么](../skills/requirements-analyzer/README.zh-CN.md#你要交什么)。
- `testcase-generation` 需要 `prd/`（PRD / 技术方案 / 契约）。`code/` 可选，且只在更新时用。见其 [README](../skills/testcase-generation/README.zh-CN.md)。
- `testdata-generation` 需要造数请求、用例或 API 来源，**不要**丢被测源码当输入。见其 [README · 你要交什么](../skills/testdata-generation/README.zh-CN.md#你要交什么)。

对各 skill 可以直接说的话：[仓库 README · 快速开始](../README.zh-CN.md#快速开始)。

原理索引：[各 skill 的工作原理](HOW_IT_WORKS.zh-CN.md)。各 skill 要交什么：[FAQ](FAQ.zh-CN.md#每个-skill-要我交什么)。

## 排错

| 现象 | 查什么 |
| --- | --- |
| 从 GitHub 装不到这个 skill | skill 必须已提交并推送到被安装的那个仓库 |
| Agent 找不到这个 skill | 选中的 Agent、项目 / 全局安装范围，以及是否需要新开会话 |
| 报 `.ts` 扩展名无法识别 | 该命令的 Node 版本和 TypeScript stripping 环境 |
| 没有检测计划 | 补上仓库 / 分支和业务材料；降级加载成功不等于材料够 |
| 静态分析或调用图不可用 | 工具安装结果、PATH、权限和网络 |
| 本地报告链接打不开 | 直接用浏览器打开返回的 HTML 文件 |

求助时请附上 commit、Node 版本、操作系统、Agent 及版本、命令和脱敏后的报错。不要上传源码或含私有数据的任务目录。
