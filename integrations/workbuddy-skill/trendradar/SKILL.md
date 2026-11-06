---
name: trendradar
description: 本机 TrendRadar 热点雷达。用户说「跑一下热榜」「今天有什么热点」「整理成报告发我」时使用，负责抓取知乎/微博/头条等热榜与 RSS、检索历史数据、生成汇总报告并推送。
---

# TrendRadar 热点雷达

本技能调用本机已部署的 TrendRadar MCP 服务（工具前缀 `trendradar`，共 27 个工具）。
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

## 推送飞书

**已经配过**：`get_notification_channels` 里 `feishu.configured=true` → 直接 `send_notification(channel="feishu")`。

**还没配过**（`configured=false`）：不要反复试 `send_notification`，按下面引导用户，全程只有一步人工：

1. 告诉用户去飞书群里拿地址：群右上「···」→ 设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook。
   同时提醒：安全设置**不要勾「签名校验」**（本项目未实现签名算法），留空或选「自定义关键词」填 `热点`。
2. 用户把地址发给你后，执行（把 `<仓库>` 换成实际项目路径）：
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "<仓库>\integrations\setup-feishu.ps1" -Webhook "<地址>" -NoPause
   ```
   脚本会自动校验格式、写入本地配置并实发一条测试消息，成功后群里能看到「TrendRadar 通知测试消息」。
3. 提醒用户重启一次 WorkBuddy（MCP 进程只在启动时读取环境变量），然后就可以「发到飞书」了。

**安全约定（必须遵守）**：

- 绝不把 webhook 写进 `config/config.yaml`——仓库是公开的，提交即泄露。脚本已改为写 `run-trendradar.local.ps1`（已被 .gitignore 忽略）+ MCP 配置的 env + 用户环境变量。
- 向用户回显时只显示首尾几位（如 `https://open.feishu.cn/...abc123`），不要完整打印。
- 用户如果直接在对话里贴了完整地址，不要记录到任何文件、不要写进 markdown 回复，用完即止。

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
| 帮我把推送接到飞书 | 见上节「推送飞书」，执行 `setup-feishu.ps1` |
| 搜一下 XX | `search_news(keyword="XX")` |
