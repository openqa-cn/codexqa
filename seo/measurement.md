# Measurement

North-star: **non-brand organic sessions on [openqa.cn](https://openqa.cn/)** (GA4 and 百度统计). Brand sessions, GitHub stars, and paid social are supporting context only.

## North-star metric

Count sessions whose source/medium is organic search and whose landing-page query is not `codexqa`, `openqa`, or `openqa-cn`. Review weekly after Search Console data exists; do not judge rank from a single SERP screenshot.

## Supporting KPIs

| KPI | Source | Target by day 90 |
| --- | --- | --- |
| Indexed URLs (openqa.cn) | GSC, Bing, 百度资源平台 | Skill + product URLs on openqa.cn |
| Impressions on task queries | GSC Performance, 百度搜索词 | Growing; add pages for orphans |
| Referring domains (relevant) | GSC Links | Directories + 3 editorial posts live |
| GitHub clones / `npx skills add` proxies | GitHub Insights, npm (CLI) | Trend up with content, not stars-only |
| Toutiao article search impressions | 头条号后台 | Weekly cadence kept |

## Instrumentation

- GA4 (or plausible) on [openqa.cn](https://openqa.cn/); exclude `localhost`.
- 百度统计 on the same host for Baidu/Toutiao-adjacent Chinese traffic.
- Google Search Console + Bing Webmaster Tools on `openqa.cn`.
- Optional: `utm_*` from `content-calendar.md` in a Looker/Sheets export.

IndexNow and 百度主动推送 run from the **openqa.cn** publish pipeline, not this repository. Push ≠ rank.

## 90-day review

1. Drop queries with impressions and zero clicks if the title/description mismatches intent; rewrite, do not add synonyms.
2. Promote queries with clicks on `/` into a dedicated skill page if they map to one skill.
3. Kill directory rows that stay `submitted` with no referral after 30 days.
4. Stars are a health metric. Do not buy social proof.

## What not to optimize

- Keyword stuffing in README H1s.
- Duplicate Markdown on GitHub and openqa.cn with different claims.
- Fake stars, comment spam, private blog networks, 快排.
