---
name: trendradar
description: 本机 TrendRadar 热点雷达。用户说「跑一下热榜」「今天有什么热点」「整理成报告发我」时使用，负责抓取知乎/微博/头条等热榜与 RSS、检索历史数据、生成汇总报告并推送。
---

# TrendRadar 热点雷达

本技能调用本机已部署的 TrendRadar MCP 服务（工具前缀 `trendradar`，共 26 个工具）。
不需要任何在线 AI Key 也能正常抓取和出报告；未配置 Key 时 AI 分析/翻译会自动跳过。

## 什么时候用

- 「跑一下今天的新闻」「看看现在什么最火」「整理一份热点报告」
- 「昨天微博有什么热搜」「搜一下和 XX 相关的新闻」
- 「把这份报告发到飞书 / 企业微信」

## 推荐调用顺序

1. 需要历史/指定日期时，先 `resolve_date_range` 把「昨天」「上周」转成标准日期。
2. 需要「现在最新」的数据：`trigger_crawl(save_to_local=true)` 现抓一次。
3. 读取数据：
   - 热榜：`get_latest_news` 或 `get_trending_topics`
   - RSS：`get_latest_rss`、`search_rss`
   - 按天：`get_news_by_date`、`list_available_dates`
4. 分析：`analyze_topic_trend`、`analyze_data_insights`、`find_related_news`。
5. 出报告：`generate_summary_report`。
6. 推送：只有用户明确说「发给我 / 发到群里」时才调用 `send_notification`；
   先用 `get_notification_channels` 确认渠道，再用 `get_channel_format_guide` 适配格式。

## 约定

- 平台 ID 用英文小写，如 `zhihu`、`weibo`、`toutiao`、`baidu`、`douyin`。
- 省 token：查询时 `include_url=false`；只有用户要链接时才打开。
- 不要编造数据：工具返回为空就如实说明「本地还没有数据，需要先跑一次抓取」。
- 完整流程（抓取 → 报告 → 推送）用工具组合完成，不要尝试执行 `python -m trendradar`。

## 常见一句话对应

| 用户说 | 动作 |
| --- | --- |
| 跑一下热榜 | `trigger_crawl(save_to_local=true)` → `get_latest_news` |
| 今天有什么热点 | `get_latest_news` + `get_trending_topics` |
| 整理成报告 | `generate_summary_report` |
| 发到飞书 | `get_notification_channels` → `send_notification` |
| 搜一下 XX | `search_news(keyword="XX")` |
