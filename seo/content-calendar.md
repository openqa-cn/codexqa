# Off-site content calendar

Every piece must be a reproducible workflow plus the evidence boundaries already in this repo. Do not spin ten keyword titles from one README.

UTM on outbound [openqa.cn](https://openqa.cn/) links: `utm_source=<site>&utm_medium=article&utm_campaign=oss-seo`.

## Principles

- One primary intent per article (see `keyword-map.md`).
- Show a sample report or command the reader can run.
- Link the [openqa.cn](https://openqa.cn/) landing URL first, GitHub second.
- Disclose limitations (no published host-agent accuracy score; CLI vs skill split).

## English originals

| Week | Title (draft) | Intent URL | Channel | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| 3 | Change-impact analysis in Cursor with a local symbol graph | https://openqa.cn/ | Dev.to / Hashnode | | todo |
| 4 | SAST plus agent detection without a separate LLM API key | https://openqa.cn/ | Dev.to | | todo |
| 5 | From PRD to a manual case library (unknowns stay TBD) | https://openqa.cn/ | Hashnode | | todo |
| 6 | Architecture wiki from the same graph, no model | https://openqa.cn/ | Personal blog | | todo |
| 8 | Show HN: local-first Agent Skills for verification | https://openqa.cn/ | Hacker News | | todo |

## Chinese originals

| Week | Title (draft) | Intent URL | Channel | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| 3 | 在 Cursor 里用符号图做变更影响分析（代码不上传） | https://openqa.cn/ | 掘金 | | todo |
| 4 | 需求和实现对不上时，缺陷报告长什么样 | https://openqa.cn/ | 知乎 | | todo |
| 5 | 从 PRD 生成手工用例，未知信息标 TBD | https://openqa.cn/ | 思否 / 开源中国 | | todo |
| 6 | Agent Skill、linter、一句「帮我 CR」有什么不同 | https://openqa.cn/ | 掘金 | | todo |

## Toutiao and ByteDance search

| Cadence | Format | Source | Destination |
| --- | --- | --- | --- |
| Weekly | 微头条 | Release / new skill / blind-eval note | 头条文章 or https://openqa.cn/ |
| Bi-weekly | 长文（结论先行 + 步骤 + 截图） | Same as Chinese originals | openqa.cn URL in the last paragraph |
| Monthly | 短视频（缺陷报告 30s） | `docs/assets/previews/defect-report.png` | 抖音 / 头条视频 |

Register a 技术/开发者 头条号. Toutiao search ranks the account corpus; it does not pass PageRank to GitHub.

## 90-day cadence

1. Days 0–14: webmaster verification on openqa.cn, GitHub About/topics (see `github-surface.md`).
2. Days 15–45: nine skill landings on openqa.cn (or deep-link to GitHub READMEs from the Skills catalog); three deep articles; ten high-quality directory rows.
3. Days 46–90: compare + cases promotion, 头条号 weekly, add pages only for queries that already show impressions.

## UTM conventions

| Field | Value |
| --- | --- |
| `utm_source` | `devto` `juejin` `zhihu` `toutiao` `oschina` `producthunt` |
| `utm_medium` | `article` `listing` `social` `video` |
| `utm_campaign` | `oss-seo` |
| `utm_content` | skill id or `home` |
