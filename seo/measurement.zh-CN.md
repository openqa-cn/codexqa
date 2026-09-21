# 度量

北极星：**[openqa.cn](https://openqa.cn/) 上的非品牌自然搜索会话**（GA4 与百度统计）。品牌会话、GitHub star、付费社交只作背景，不作成功标准。

## 北极星指标

统计来源/媒介为自然搜索、落地查询不含 `codexqa` / `openqa` / `openqa-cn` 的会话。有 Search Console 数据后再按周看；不要拿一张 SERP 截图判断排名。

## 辅助 KPI

| KPI | 来源 | 第 90 天目标 |
| --- | --- | --- |
| openqa.cn 索引 URL 数 | GSC、Bing、百度资源平台 | 主站上的 skill 与产品页 |
| 任务型查询曝光 | GSC Performance、百度搜索词 | 上升；有曝光无专页则补页 |
| 相关引荐域 | GSC 链接 | 目录 + 3 篇编辑型文章 live |
| GitHub clone / `npx skills add` 近似 | GitHub Insights、npm（CLI） | 随内容上升，而不是只看 star |
| 头条文章搜索曝光 | 头条号后台 | 维持周更 |

## 埋点

- [openqa.cn](https://openqa.cn/) 接 GA4（或 Plausible）；排除 `localhost`。
- 同一主机接百度统计，观察百度/头条周边中文流量。
- 在 `openqa.cn` 上验证 Google Search Console 与 Bing Webmaster。
- 可选：把 `content-calendar.md` 的 `utm_*` 导出到表格。

IndexNow 和百度主动推送走 **openqa.cn** 自己的发布流水线，不在本仓库。推送不等于排名。

## 90 天评审

1. 有曝光零点击：标题/描述与意图不符就改写，不要堆同义词。
2. 首页承接的点击若只对应一个 skill，拆到该 skill 专页。
3. 目录行 `submitted` 超过 30 天仍无引荐则放弃。
4. Star 只作健康度。禁止买社交证明。

## 不要优化这些

- 在 README H1 堆砌关键词。
- GitHub 与 openqa.cn 两套互相矛盾的说法。
- 假 star、评论垃圾、站群、快排。
