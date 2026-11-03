# coding=utf-8
"""
ORBIT 3D 热点情报舱适配模块

将 ``prepare_report_data`` 过滤后的 report_data 转换为前端 UI 消费的 JSON，
并把 WebGL / Canvas / CSS 全部内联为单个离线 HTML 文件。

设计边界：
- 不解析最终 HTML，也不伪造新闻或 AI 摘要；
- 无第三方依赖，不引入 CDN；
- 不修改抓取、存储、通知与原有报告渲染逻辑。
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import urlparse

from trendradar.report.orbit_history import WINDOW_HOURS, update_history

# 主题配色（粉/紫/青为主的暖色情报舱色板）
COLORS = (
    "#f36bbe", "#8d79ff", "#49dce2", "#ffa76b", "#c58dff", "#f17d9a",
    "#8bb6ff", "#ffc977", "#db70ec", "#66d4c8", "#ff8aab",
)

# 视觉定稿配色：主题脊线用色 + 高亮色（高亮必须叠加在既有壳层上，不做贴片）
TOPIC_PALETTE = {
    "金融宏观": "#F274B7",
    "智能汽车": "#AA88FA",
    "文娱IP": "#F0AF71",
    "中国科技": "#60DDE6",
    "全球科技巨头": "#C28AF3",
}
HIGHLIGHT_COLOR = "#FFC1ED"

# 脊线径向偏移限幅：合同要求 2%–5%，不改变球体整体半径
RIDGE_MIN = 0.02
RIDGE_MAX = 0.05
# peakRank=1 → 1/log2(3)；peakRank=11 → 1/log2(13)。用绝对映射避免主题间相互耦合
_RIDGE_RAW_MIN = 1.0 / math.log2(13)
_RIDGE_RAW_MAX = 1.0 / math.log2(3)


def _name_key(name: str) -> str:
    """主题名归一化：去掉空白后再匹配配色与历史统计。"""
    return re.sub(r"\s+", "", str(name or ""))


def _topic_anchor(name: str) -> list[float]:
    """由稳定主题名派生的单位锚点，不随数组序号或排行变化。"""
    digest = hashlib.sha1(_name_key(name).encode("utf-8")).digest()
    azimuth = int.from_bytes(digest[0:4], "big") / 0xFFFFFFFF * math.tau
    z = int.from_bytes(digest[4:8], "big") / 0xFFFFFFFF * 2.0 - 1.0
    radius = math.sqrt(max(0.0, 1.0 - z * z))
    return [
        round(radius * math.cos(azimuth), 4),
        round(z, 4),
        round(radius * math.sin(azimuth), 4),
    ]


def _ridge_for(peak: int | None) -> float:
    """peakRank → 脊线高度，绝对映射并限幅在 2%–5%。"""
    if not isinstance(peak, int) or peak <= 0:
        return RIDGE_MIN
    raw = 1.0 / math.log2(peak + 2)
    ratio = (raw - _RIDGE_RAW_MIN) / (_RIDGE_RAW_MAX - _RIDGE_RAW_MIN)
    ratio = min(1.0, max(0.0, ratio))
    return round(RIDGE_MIN + (RIDGE_MAX - RIDGE_MIN) * ratio, 4)


def _bundle_for(title_count: int) -> float:
    """titleCount → 次级线束复杂度；1 条标题不产生额外线束。"""
    if title_count <= 1:
        return 0.0
    return round(min(1.0, (math.log2(title_count + 1) - 1.0) / 1.6), 3)


def _has_variance(values: Sequence[float]) -> bool:
    """只有真实存在统计差异时才允许把统计值转成视觉强弱。"""
    return len({round(float(value), 3) for value in values}) > 1


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def build_topic_fields(
    payload: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    selected_topic_id: str | int | None = None,
) -> list[dict[str, Any]]:
    """纯函数：把主题数据映射为稳定的视觉场参数。

    - ``anchor`` 由主题名哈希派生，重排数组或改动 peakRank 都不会移动；
    - ``ridge`` 只由 peakRank 决定（限幅 2%–5%）；
    - ``bundle`` 只由 titleCount 决定（1 条标题为 0）；
    - weight / momentum / freshness 仅在滚动窗口存在真实统计差异时才激活，
      单条快照下全部为 0，避免把同一份数据编成强弱。
    """
    if isinstance(payload, Mapping):
        topics = list(payload.get("topics") or [])
        history = payload.get("history") or {}
    else:
        topics = list(payload or [])
        history = {}

    history_topics = history.get("topics") if isinstance(history, Mapping) else None
    stats: dict[str, Mapping[str, Any]] = {}
    for item in history_topics or []:
        if isinstance(item, Mapping) and item.get("name"):
            stats[_name_key(str(item["name"]))] = item
    snapshot_count = int(history.get("snapshotCount") or 0) if isinstance(history, Mapping) else 0

    weights = [float(item.get("weight") or 0.0) for item in stats.values()]
    momenta = [float(item.get("momentum") or 0.0) for item in stats.values()]
    freshnesses = [float(item.get("freshness") or 0.0) for item in stats.values()]
    weight_active = snapshot_count > 1 and _has_variance(weights)
    momentum_active = snapshot_count > 1 and _has_variance(momenta)
    freshness_active = snapshot_count > 1 and _has_variance(freshnesses)

    selected_key = str(selected_topic_id) if selected_topic_id not in (None, "") else ""

    fields: list[dict[str, Any]] = []
    for index, topic in enumerate(topics):
        if not isinstance(topic, Mapping):
            continue
        name = str(topic.get("name") or "").strip()
        if not name:
            continue
        stat = stats.get(_name_key(name), {})

        rank_candidates = [
            _positive_int(headline.get("rank"))
            for headline in topic.get("headlines") or []
            if isinstance(headline, Mapping)
        ]
        rank_candidates = [rank for rank in rank_candidates if rank]
        peak = _positive_int(stat.get("peakRank")) or (min(rank_candidates) if rank_candidates else None)

        title_count = _positive_int(stat.get("titleCount"))
        if title_count is None:
            title_count = len(topic.get("headlines") or [])

        fields.append({
            "anchor": _topic_anchor(name),
            "ridge": _ridge_for(peak),
            "bundle": _bundle_for(title_count),
            "color": TOPIC_PALETTE.get(_name_key(name)) or COLORS[index % len(COLORS)],
            "highlight": HIGHLIGHT_COLOR,
            "peakRank": peak,
            "titleCount": title_count,
            "weight": round(float(stat.get("weight") or 0.0), 3) if weight_active else 0.0,
            "momentum": round(float(stat.get("momentum") or 0.0), 3) if momentum_active else 0.0,
            "freshness": round(float(stat.get("freshness") or 0.0), 3) if freshness_active else 0.0,
            "active": bool(selected_key) and selected_key in {
                str(topic.get("id") or ""), name,
            },
        })
    return fields


def _safe_url(value: Any) -> str:
    """仅保留合法的 http/https 链接，其余返回空字符串。"""
    value = str(value or "")
    parsed = urlparse(value)
    if parsed.scheme.lower() in {"http", "https"} and parsed.netloc:
        return value
    return ""


def _positive_rank(value: Any) -> int | None:
    """从 ranks 列表 / dict / 标量中取最小正排名。"""
    if isinstance(value, list):
        ranks = [_positive_rank(item) for item in value]
        ranks = [rank for rank in ranks if rank is not None]
        return min(ranks) if ranks else None
    if isinstance(value, dict):
        return _positive_rank(value.get("rank"))
    try:
        rank = int(value)
        return rank if rank > 0 else None
    except (ValueError, TypeError):
        return None


def _field(source: Any, name: str, default: Any = "") -> Any:
    """兼容 dataclass / dict 两种后置分析结果结构。"""
    if isinstance(source, Mapping):
        return source.get(name, default)
    return getattr(source, name, default)


def _rss_groups(items: Any) -> list[dict[str, Any]]:
    """把 RSS 统计分组转换为统一的卡片数据（只保留有标题的条目）。"""
    groups: list[dict[str, Any]] = []
    for stat in items or []:
        if not isinstance(stat, Mapping):
            continue
        entries: list[dict[str, Any]] = []
        for entry in stat.get("titles", []) or []:
            if not isinstance(entry, Mapping):
                continue
            title = str(entry.get("title") or "").strip()
            if not title:
                continue
            entries.append({
                "title": title,
                "source": str(entry.get("source_name") or "RSS"),
                "time": str(entry.get("time_display") or ""),
                "url": _safe_url(entry.get("url") or entry.get("mobile_url")),
                "isNew": bool(entry.get("is_new", False)),
            })
        if entries:
            groups.append({
                "name": str(stat.get("word") or "").strip() or "RSS",
                "count": len(entries),
                "items": entries,
            })
    return groups


def _standalone_block(data: Any) -> dict[str, Any]:
    """独立展示区：平台与 RSS 订阅源统一为 {name, items[]}。"""
    data = data if isinstance(data, Mapping) else {}
    platforms: list[dict[str, Any]] = []
    for platform in data.get("platforms", []) or []:
        if not isinstance(platform, Mapping):
            continue
        items = []
        for entry in platform.get("items", []) or []:
            if not isinstance(entry, Mapping):
                continue
            title = str(entry.get("title") or "").strip()
            if not title:
                continue
            items.append({
                "title": title,
                "source": str(platform.get("name") or "独立源"),
                "url": _safe_url(entry.get("mobileUrl") or entry.get("url")),
                "rank": _positive_rank(entry.get("rank")),
                "isNew": False,
            })
        if items:
            platforms.append({
                "name": str(platform.get("name") or "独立源"),
                "items": items,
            })

    feeds: list[dict[str, Any]] = []
    for feed in data.get("rss_feeds", []) or []:
        if not isinstance(feed, Mapping):
            continue
        items = []
        for entry in feed.get("items", []) or []:
            if not isinstance(entry, Mapping):
                continue
            title = str(entry.get("title") or "").strip()
            if not title:
                continue
            items.append({
                "title": title,
                "source": str(feed.get("name") or "RSS"),
                "time": str(entry.get("published_at") or ""),
                "url": _safe_url(entry.get("url")),
                "isNew": False,
            })
        if items:
            feeds.append({
                "name": str(feed.get("name") or "RSS"),
                "items": items,
            })

    return {"platforms": platforms, "feeds": feeds}


# 5 个 AI 研判板块及其前端展示标签（顺序即展示顺序）
_AI_SECTIONS = (
    ("coreTrends", "核心热点与舆情态势", "core_trends"),
    ("sentimentControversy", "舆论风向与争议", "sentiment_controversy"),
    ("signals", "异动与弱信号", "signals"),
    ("rssInsights", "RSS 深度洞察", "rss_insights"),
    ("outlookStrategy", "研判与策略建议", "outlook_strategy"),
)


def _ai_block(result: Any) -> dict[str, Any]:
    """全局 AI 研判。

    边界：这是整份报告的 AI 分析，不能挂到单个主题上；
    「AI 热点选题决策官」结论（topic_decision）仅用于飞书推送，不进入网页界面。
    """
    if result is None:
        return {
            "available": False,
            "success": False,
            "skipped": False,
            "error": "",
            "reason": "本次报告未包含 AI 分析",
            "sections": [],
            "standaloneSummaries": [],
        }

    sections = []
    for key, label, attr in _AI_SECTIONS:
        body = str(_field(result, attr, "") or "").strip()
        if body:
            sections.append({"key": key, "label": label, "body": body})

    summaries = []
    raw_summaries = _field(result, "standalone_summaries", {}) or {}
    if isinstance(raw_summaries, Mapping):
        for source, summary in raw_summaries.items():
            if isinstance(summary, str) and summary.strip():
                summaries.append({
                    "source": str(source),
                    "summary": summary.strip(),
                })

    success = bool(_field(result, "success", False))
    skipped = bool(_field(result, "skipped", False))
    error = str(_field(result, "error", "") or "").strip()
    if sections or summaries:
        reason = ""
    elif skipped:
        reason = "本次无足够内容，AI 分析已跳过"
    elif error:
        reason = "AI 分析失败：" + error[:160]
    else:
        reason = "本次报告没有可展示的 AI 研判结果"

    return {
        "available": bool(sections or summaries),
        "success": success,
        "skipped": skipped,
        "error": error[:300],
        "reason": reason,
        "sections": sections,
        "standaloneSummaries": summaries,
        "meta": {
            "aiMode": str(_field(result, "ai_mode", "") or ""),
            "totalNews": _field(result, "total_news", 0),
            "analyzedNews": _field(result, "analyzed_news", 0),
            "includeRss": bool(_field(result, "include_rss", False)),
            "includeStandalone": bool(_field(result, "include_standalone", False)),
        },
    }


def build_orbit_payload(
    report_data: Mapping[str, Any],
    *,
    mode: str = "current",
    total_titles: int | None = None,
    generated_at: datetime | None = None,
    topic_ai_summaries: Mapping[str, str] | None = None,
    is_demo: bool = False,
    rss_items: Any = None,
    rss_new_items: Any = None,
    standalone_data: Any = None,
    ai_analysis: Any = None,
    history_file: str | Path | None = None,
) -> dict[str, Any]:
    """把 report_data 及后置分析结果转换成 ORBIT UI 的 schemaVersion=1 数据结构。

    注意：整份报告的 AI 分析不能冒充单个主题的 AI 研判。
    只有在真正生成主题级摘要后，才通过 ``topic_ai_summaries`` 传入 aiSummary；
    全局 AI 分析单独放在 ``ai`` 字段，由前端以「全局 AI 研判」展示。
    """
    topics: list[dict[str, Any]] = []
    ai_map = topic_ai_summaries or {}

    for index, stat in enumerate(report_data.get("stats", []) or []):
        if not isinstance(stat, dict):
            continue
        name = str(stat.get("word") or "").strip()
        if not name:
            continue

        headlines = []
        for item in stat.get("titles", []) or []:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            headlines.append({
                "title": title,
                "source": str(item.get("source_name") or "未知来源"),
                "url": _safe_url(item.get("mobile_url") or item.get("url")),
                "rank": _positive_rank(item.get("ranks") or []),
                "isNew": bool(item.get("is_new", False)),
            })

        topic = {
            "id": f"topic-{index + 1:02d}",
            "name": name,
            "count": len(headlines),
            "color": COLORS[index % len(COLORS)],
            "headlines": headlines,
        }
        summary = ai_map.get(name)
        if isinstance(summary, str) and summary.strip():
            topic["aiSummary"] = summary.strip()
        topics.append(topic)

    # 24 小时热度记忆：只有传入落盘路径时才写入滚动快照，纯函数调用不产生副作用
    history: dict[str, Any] | None = None
    if history_file is not None:
        history = update_history(topics, history_file, now=generated_at, mode=mode)

    hotlist_total = total_titles if total_titles is not None else report_data.get("hotlist_total")
    total_platforms = report_data.get("platform_total")
    failed = len(report_data.get("failed_ids", []) or [])
    platform_label = (
        f"{max(0, total_platforms - failed)}/{total_platforms}"
        if isinstance(total_platforms, int) and total_platforms > 0
        else "—"
    )

    return {
        "schemaVersion": 1,
        "mode": mode,
        "snapshotAt": generated_at.isoformat() if generated_at else None,
        # 文件报告是快照，不是实时流；粒子动画的实时性不等于数据实时更新
        "isLive": False,
        "isDemo": is_demo,
        "metrics": {
            "topics": len(topics),
            "hotlistMatched": sum(topic["count"] for topic in topics),
            "hotlistTotal": hotlist_total,
            "rssMatched": report_data.get("rss_matched_count"),
            "rssTotal": report_data.get("rss_total_count"),
            "platforms": platform_label,
        },
        "topics": topics,
        # 主题视觉场：稳定锚点 + 脊线高度 + 线束复杂度（不随排行重排而漂移）
        "topicFields": build_topic_fields({
            "topics": topics,
            "history": history if history is not None else {
                "windowHours": WINDOW_HOURS,
                "snapshotCount": 0,
                "topics": [],
            },
        }),
        # 后置分析报告：RSS 更新 / RSS 新增 / 独立展示区 / 全局 AI 研判
        "rss": {
            "matched": report_data.get("rss_matched_count"),
            "total": report_data.get("rss_total_count"),
            "groups": _rss_groups(rss_items),
        },
        "rssNew": {
            "groups": _rss_groups(rss_new_items),
        },
        "standalone": _standalone_block(standalone_data),
        "ai": _ai_block(ai_analysis),
        # 24 小时滚动窗口内的热度记忆（主题出现次数 / 新鲜度 / 动量）
        "history": history if history is not None else {
            "windowHours": WINDOW_HOURS,
            "snapshotCount": 0,
            "updatedAt": None,
            "totals": {"runs": 0, "topics": 0, "titles": 0},
            "topics": [],
        },
    }


def _script_json(payload: Mapping[str, Any]) -> str:
    """序列化并转义，避免标题中的 </script> 等字符串截断内联脚本。"""
    return (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def render_selfcontained_orbit_html(
    payload: Mapping[str, Any], assets_dir: str | Path
) -> str:
    """把 CSS、数据与 JavaScript 全部内联成一个离线单文件 HTML。"""
    assets = Path(assets_dir)
    html = (assets / "index.html").read_text("utf-8")
    css = (assets / "styles.css").read_text("utf-8")

    html = html.replace(
        '<link rel="stylesheet" href="styles.css" />',
        "<style>\n" + css + "\n</style>",
        1,
    )
    payload_script = (
        "<script>window.__TREND_RADAR_PAYLOAD__ = " + _script_json(payload) + ";</script>"
    )
    html = html.replace('<script src="demo-data.js"></script>', payload_script, 1)

    for filename in ("fallback-orbit.js", "orbit.js", "ui.js"):
        source = (assets / filename).read_text("utf-8")
        # 内联脚本为项目自有代码，防止意外出现的 </script 提前闭合标签
        source = re.sub(r"</script", r"<\\/script", source, flags=re.IGNORECASE)
        html = html.replace(
            f'<script src="{filename}"></script>',
            "<script>\n" + source + "\n</script>",
            1,
        )
    return html
