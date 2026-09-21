# 已知边界

[English](KNOWN_LIMITATIONS.md)

这里每一条都是当前 skill 的真实边界，不是免责声明。设计切分见[工作原理](HOW_IT_WORKS.zh-CN.md)。

## 需要 Python 3.10+

门禁与关阶段脚本依赖较新的类型注解与标准库行为。**一律**通过 `scripts/tcg-python` 调用。裸 `python3` 若低于 3.10 会立即 FATAL 退出。

## 不绑定用例平台或文档平台

本 skill 只写本地 Markdown。不召回 / 上传 / 同步远程用例空间，也不安装或调用文档平台 / 身份 CLI。

## 聚合 HTML 报告是只读视图

Stage 6 双写后，`generate_case_report.py` 写出 `testdesign/testcase_generation_report.html`（Web / 服务端 / APP 分栏、中英界面、白天/黑夜主题）。编辑源仍是 `cases/` 下的 Markdown；改用例后需重新生成 HTML。界面文案可中英切换；用例正文语言随 Markdown 原文。

## 方案与用例正文由模型判断

`check_run_gate.py` / `close_stage.py` 约束产物是否存在、标题是否齐全、是否双写。场景与步骤是否符合业务域由宿主模型决定。门禁通过仍可能写出错误方案或用例——如果模型编造事实而不是标 TBD / 待澄清。

## 增量需要有效基线

按 PR / git URL 做 diff 增强前，必须先有用例基线。没有基线时先 bootstrap 初版，此时不要拉代码。权限与缺 ref 失败以脚本 `error.code` 返回。

## 知识可选且本地

空知识索引合法。本 skill 不调用外部知识检索 Skill。跑中途不会仅为补维度而向你要知识源。

## 无公开宿主 agent 成绩

离线 `--self-check` 覆盖门禁夹具与 HTML 报告生成器。完整 Plan→Exec 或 Incremental 没有公开标准答案夹具，也没有已记录的宿主 agent 成绩。

## 工作流边界

本 skill 产出**测试方案与手工用例**。它不替代 `codexqa-requirement-analyzer` 的缺口登记、`codexqa-testdata-generator` 的真实后端造数，也不替代代码评审 / 扫描类 skill 的缺陷结论。
