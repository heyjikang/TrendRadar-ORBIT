# AGENTS.md — 交给 AI 助手的一键安装说明书

> **给 WorkBuddy / Trae / Claude Code / Codex 等「能执行本地命令」的助手看。**
> 当用户说「帮我装一下这个 GitHub 项目」时，直接按本文件执行。
> **不要向用户索要参数，不要贴 JSON 让用户手动粘贴，不要手填表单。**

---

## 0. 这是什么

TrendRadar 抓取知乎 / 微博 / 头条 / 百度 / 抖音等热榜与 RSS，去重筛选后生成 HTML / 文本报告，可推送到飞书、企业微信、钉钉、Telegram。

**不配置任何 AI Key 也能完整跑通**：AI 筛选自动回退关键词匹配，AI 分析、AI 翻译自动跳过，抓取与报告全程正常，不报错。

---

## 1. 安装：只有一步

在仓库根目录执行：

```bat
install.cmd
```

它等价于 `powershell -NoProfile -ExecutionPolicy Bypass -File integrations\install-workbuddy.ps1`，幂等、可重复执行。它自动完成：

1. 没有 `.venv` 就用 `uv sync` 建环境（没装 uv 则 `python -m venv .venv` + `pip install -e .`）；
2. 自动定位 WorkBuddy 安装目录，以及它自带的 node（`%USERPROFILE%\.workbuddy\binaries\node\`）；
3. 调用 WorkBuddy 自带 CLI，把 MCP 服务 `trendradar` 注册进 `~/.codebuddy/mcp.json`（CLI 因 WorkBuddy 正在运行而不可用时，会自动改为直接写该文件，效果相同）；
4. 把 `integrations/workbuddy-skill/trendradar/SKILL.md` 复制到 `~/.workbuddy/skills/trendradar/` 和 `~/.codebuddy/skills/trendradar/`。

**执行完必须提醒用户：重启一次 WorkBuddy。** 这是整个流程里唯一需要人工的点击（MCP 连接只在启动时建立）。

非交互执行（AI 助手自己跑）建议加 `-NoPause`，避免末尾等待回车：`install.cmd -NoPause`。

macOS / Linux 上没有 WorkBuddy 时，等价动作是：

```bash
uv sync && .venv/bin/python -m trendradar --doctor
```

（MCP 服务端可用 `trendradar-mcp` 或 `python -m mcp_server.server --transport http --port 3333` 启动。）

---

## 2. 把验证结果贴给用户

```bat
.venv\Scripts\python.exe -m trendradar --doctor
```

期望输出包含 `⚠️ AI配置: 未配置 AI API Key，AI 筛选/分析/翻译将自动跳过`、`✅ MCP注册: 已注册: ...` 和 `❌ 0 项失败`。
`install.cmd` 末尾还会自动打印 MCP 健康检查，正常应为：

```
trendradar: ...\python.exe -m mcp_server.server --transport stdio ... - ✓ Connected
```

---

## 3. 装完之后：用户一句话 → 直接执行

MCP 工具共 27 个，前缀 `trendradar`。平台 ID 用小写英文：`zhihu` `weibo` `toutiao` `baidu` `douyin`。

| 用户说 | 你做什么 |
| --- | --- |
| 跑一下今天的热榜 | `trigger_crawl(save_to_local=true)` → `get_latest_news` |
| 今天有什么热点 | `get_latest_news` + `get_trending_topics` |
| 整理成报告发我 | `generate_summary_report` → `send_notification` |
| 昨天微博有什么 | `resolve_date_range` → `get_news_by_date` |
| 搜一下 XX 相关 | `search_news(keyword="XX")` |
| 发到飞书 / 群里 | `get_notification_channels` → `get_channel_format_guide` → `send_notification` |

约定：

- 省 token：查询时 `include_url=false`，用户要链接才打开；
- 平台 ID 一律小写；
- 工具返回为空就如实说「本地还没有数据，需要先跑一次抓取」，**不要编造数据**；
- 不要用 `python -m trendradar` 代替 MCP 工具组合（除非用户就要终端跑批）。

---

## 4. 定时任务：再一句话就能加

WorkBuddy 里用「自动化 / 定时任务」新建一条，内容写：

> 每天 08:00 跑一次 TrendRadar，抓取知乎、微博、头条，生成汇总报告并推送到飞书。

不依赖客户端、直接用 Windows 计划任务时：

```bat
schtasks /Create /TN "TrendRadar-Daily" /TR "\"<仓库路径>\.venv\Scripts\python.exe\" -m trendradar" /SC DAILY /ST 08:00 /F
```

把 `<仓库路径>` 换成实际路径（如 `D:\self\tendradar`）。推送目标在 `config/config.yaml` 的 `notification` 段配置。

---

## 5. 关于 AI Key

**AI 功能默认关闭**：`config/config.yaml` 里 `filter.method: keyword`、`ai_analysis.enabled: false`、`ai_translation.enabled: false`。也就是说开箱即用走的全是关键词匹配，不调用任何大模型。
需要 AI 能力时，用户主动改这三处，再按下面配置 Key。

想接本地 OpenAI 兼容服务，用**系统环境变量**（不是 `.env`，本项目不读取 `.env` 文件）：

```
AI_API_BASE=http://<IP>:<端口>/v1
AI_MODEL=<模型名>
AI_API_KEY=local
```

Windows 临时验证可在 PowerShell 里 `$env:AI_API_BASE="..."` 再运行；持久化用 `setx` 或写进 `run-trendradar.local.ps1`（已在 `.gitignore` 中）。
环境变量优先级高于 `config/config.yaml` 的 `ai` 段。

---

## 6. 关于豆包

**豆包有本地版**（能执行本地命令的那种），本地版等价于 WorkBuddy，直接用第 1 节的 `install.cmd` 即可，不需要额外配置。

这需要区分清楚：

| 环境 | 能否自动安装 | 做法 |
| --- | --- | --- |
| 豆包本地版 / WorkBuddy / Trae / Claude Code / Codex | 能（有本地命令执行权限） | 直接跑 `install.cmd`（macOS/Linux 跑 `uv sync`） |
| 豆包·工作（纯网页/云端版） | 不能（无法拉起本机进程） | 先在本机常驻 HTTP 服务，再手动建插件 |

只有纯网页版才需要走 HTTP 插件这条路：

1. 双击仓库根目录的 `start-http.bat`（监听 `0.0.0.0:3333`，端点 `/mcp`）；
2. 豆包 → 插件 → 新建自定义插件：
   - 服务器名称：`trendradar`
   - 传输类型：`HTTP`
   - 服务器 URL：`http://<本机内网IP>:3333/mcp`
3. 前提是豆包侧能访问到该地址（公网访问需内网穿透）。

---

## 7. 常见故障

| 现象 | 处理 |
| --- | --- |
| `install.cmd` 报找不到 WorkBuddy | 先启动一次 WorkBuddy；或执行 `install.cmd -WorkBuddyHome "D:\software\WorkBuddy"` |
| 重启后 WorkBuddy 里仍看不到 trendradar | 再跑一次 `install.cmd` 看末尾健康检查；仍不 Connected 就把报错原文贴给用户 |
| 抓取结果全空 | 平台接口偶发风控，过几分钟重试；确认能访问 weibo.com / zhihu.com |
| 中文乱码 | 脚本已注入 `PYTHONIOENCODING=utf-8`；cmd 窗口先 `chcp 65001` |
| 安装时出现 `EADDRINUSE 127.0.0.1:607xx` | 正常现象：WorkBuddy 正在运行，占用了内置 CLI 的本地端口。脚本会自动改为直写 `~/.codebuddy/mcp.json`，看到「已直写」即注册成功；也可以先退出 WorkBuddy 再装 |
| `install.cmd` 停在最后不退出 | 末尾在等回车。非交互执行（AI 自己跑）请加 `-NoPause` |
| 想知道 MCP 装没装上 | `--doctor` 看第 9 项 `MCP注册`：`已注册: ~/.codebuddy/mcp.json` 即正常 |
| 端口 3333 被占用 | `python -m mcp_server.server --transport http --port 3334`，豆包 URL 同步改端口 |
