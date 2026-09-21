# 站外内容日历

每篇必须是可复现工作流，外加仓库里已经写明的证据边界。禁止把 README 扩写成十个标题党。

外链 [openqa.cn](https://openqa.cn/) 时带 UTM：`utm_source=<site>&utm_medium=article&utm_campaign=oss-seo`。

## 原则

- 一篇一个主意图（见 `keyword-map.zh-CN.md`）。
- 给出读者能跑的命令或能打开的样例报告。
- 先链 [openqa.cn](https://openqa.cn/) 着陆页，再链 GitHub。
- 写清边界（没有公开的宿主 agent 准确率；CLI 和 skill 是两套产物）。

## 英文原稿

| 周 | 标题（草稿） | 意图 URL | 渠道 | 负责人 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 3 | Change-impact analysis in Cursor with a local symbol graph | https://openqa.cn/ | Dev.to / Hashnode | | todo |
| 4 | SAST plus agent detection without a separate LLM API key | https://openqa.cn/ | Dev.to | | todo |
| 5 | From PRD to a manual case library (unknowns stay TBD) | https://openqa.cn/ | Hashnode | | todo |
| 6 | Architecture wiki from the same graph, no model | https://openqa.cn/ | 个人博客 | | todo |
| 8 | Show HN: local-first Agent Skills for verification | https://openqa.cn/ | Hacker News | | todo |

## 中文原稿

| 周 | 标题（草稿） | 意图 URL | 渠道 | 负责人 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 3 | 在 Cursor 里用符号图做变更影响分析（代码不上传） | https://openqa.cn/ | 掘金 | | todo |
| 4 | 需求和实现对不上时，缺陷报告长什么样 | https://openqa.cn/ | 知乎 | | todo |
| 5 | 从 PRD 生成手工用例，未知信息标 TBD | https://openqa.cn/ | 思否 / 开源中国 | | todo |
| 6 | Agent Skill、linter、一句「帮我 CR」有什么不同 | https://openqa.cn/ | 掘金 | | todo |

## 头条与字节系搜索

| 节奏 | 形态 | 素材 | 去向 |
| --- | --- | --- | --- |
| 每周 | 微头条 | Release / 新 skill / 盲测说明 | 头条文章或 https://openqa.cn/ |
| 双周 | 长文（结论先行 + 步骤 + 截图） | 与中文原稿相同 | 文末 https://openqa.cn/ |
| 每月 | 短视频（缺陷报告 30 秒） | `docs/assets/previews/defect-report.png` | 抖音 / 头条视频 |

注册定位为技术/开发者的头条号。头条搜索排的是号内语料，不会把权重传给 GitHub。

## 90 天节奏

1. 第 0–14 天：在 openqa.cn 做站长平台验证、GitHub About/Topics（见 `github-surface.zh-CN.md`）。
2. 第 15–45 天：在 openqa.cn 补九个 skill 着陆（或从技能目录深链到 GitHub README）；三篇深度文；十条高质量目录。
3. 第 46–90 天：对比页与案例页扩散、头条号周更；只给已有曝光的检索词补页。

## UTM 约定

| 字段 | 取值 |
| --- | --- |
| `utm_source` | `devto` `juejin` `zhihu` `toutiao` `oschina` `producthunt` |
| `utm_medium` | `article` `listing` `social` `video` |
| `utm_campaign` | `oss-seo` |
| `utm_content` | skill id 或 `home` |
