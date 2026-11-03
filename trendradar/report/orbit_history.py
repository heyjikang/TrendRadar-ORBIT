# coding=utf-8
"""ORBIT 24 小时热度记忆。

每次运行只向 ``rolling.json`` 追加一份瘦身快照（主题名、条数、标题、最佳名次），
再按滚动窗口聚合成「持续在榜」的热度，供光球的数据图层和左栏记忆区块消费。

边界：
- 不保存整页 HTML，只保存聚合所需的必要字段；
- 文件体积与快照数量都有硬上限，24 小时以外的快照自动淘汰；
- 与上一次快照完全相同时只更新时间戳，避免重复运行把出现次数刷高。
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping

WINDOW_HOURS = 24
MAX_SNAPSHOTS = 96
MAX_FILE_BYTES = 900 * 1024
MAX_HISTORY_TOPICS = 16
MAX_TITLES_PER_TOPIC = 24
RECENT_SNAPSHOTS = 6


def _as_aware(value: datetime | None) -> datetime:
    """统一为带时区的时间，避免 naive / aware 混算报错。"""
    if value is None:
        return datetime.now().astimezone()
    if value.tzinfo is None:
        return value.astimezone()
    return value


def _parse_at(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return _as_aware(parsed)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def _load(path: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return []
    snapshots = raw.get("snapshots") if isinstance(raw, Mapping) else raw
    if not isinstance(snapshots, list):
        return []
    return [item for item in snapshots if isinstance(item, Mapping)]


def _write(path: Path, snapshots: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(
        {"version": 1, "snapshots": snapshots},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    path.write_text(body, "utf-8")


def make_snapshot(
    topics: Iterable[Mapping[str, Any]], at: datetime, mode: str = "current"
) -> dict[str, Any]:
    """把 ORBIT payload 里的主题裁剪成可长期保存的瘦身快照。"""
    entries: list[dict[str, Any]] = []
    for topic in topics or []:
        if not isinstance(topic, Mapping):
            continue
        name = str(topic.get("name") or "").strip()
        if not name:
            continue
        titles: list[dict[str, str]] = []
        peak: int | None = None
        for headline in list(topic.get("headlines") or [])[:MAX_TITLES_PER_TOPIC]:
            if not isinstance(headline, Mapping):
                continue
            title = str(headline.get("title") or "").strip()
            if not title:
                continue
            titles.append({
                "t": title[:120],
                "s": str(headline.get("source") or "")[:32],
            })
            rank = headline.get("rank")
            if isinstance(rank, int) and rank > 0 and (peak is None or rank < peak):
                peak = rank
        if not titles:
            continue
        entries.append({
            "name": name[:40],
            "count": len(titles),
            "peak": peak,
            "titles": titles,
        })
    return {"at": _iso(at), "mode": str(mode or ""), "topics": entries}


def _signature(snapshot: Mapping[str, Any]) -> str:
    """主题名 + 标题集合的指纹，用于识别重复运行。"""
    parts: list[str] = []
    for topic in snapshot.get("topics") or []:
        if not isinstance(topic, Mapping):
            continue
        parts.append(str(topic.get("name") or ""))
        for title in topic.get("titles") or []:
            if isinstance(title, Mapping):
                parts.append(str(title.get("t") or ""))
    digest = hashlib.sha1("\u0001".join(parts).encode("utf-8")).hexdigest()
    return digest


def _prune(
    snapshots: list[dict[str, Any]], now: datetime
) -> list[dict[str, Any]]:
    """按时间窗口、快照数量与文件体积三重上限淘汰旧数据。"""
    horizon = now - timedelta(hours=WINDOW_HOURS)
    kept: list[dict[str, Any]] = []
    for snapshot in snapshots:
        at = _parse_at(snapshot.get("at"))
        if at is None or at < horizon or at > now + timedelta(minutes=5):
            continue
        kept.append(snapshot)
    kept.sort(key=lambda item: str(item.get("at") or ""))
    if len(kept) > MAX_SNAPSHOTS:
        kept = kept[-MAX_SNAPSHOTS:]
    while len(kept) > 1:
        # 按 UTF-8 实际字节数判断，中文标题不会被低估为「1 字节 1 字符」
        size = len(
            json.dumps(
                {"version": 1, "snapshots": kept}, ensure_ascii=False
            ).encode("utf-8")
        )
        if size <= MAX_FILE_BYTES:
            break
        kept.pop(0)
    return kept


def _aggregate(snapshots: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    """聚合出每个主题在窗口内的出现次数、新鲜度与动量。"""
    total = len(snapshots)
    recent_start = max(0, total - RECENT_SNAPSHOTS)
    window = timedelta(hours=WINDOW_HOURS)
    topics: dict[str, dict[str, Any]] = {}
    all_titles: set[str] = set()

    for index, snapshot in enumerate(snapshots):
        at = _parse_at(snapshot.get("at"))
        for topic in snapshot.get("topics") or []:
            if not isinstance(topic, Mapping):
                continue
            name = str(topic.get("name") or "").strip()
            if not name:
                continue
            item = topics.setdefault(name, {
                "name": name,
                "appearances": 0,
                "recentAppearances": 0,
                "firstSeen": at,
                "lastSeen": at,
                "peakRank": None,
                "titles": set(),
            })
            item["appearances"] += 1
            if index >= recent_start:
                item["recentAppearances"] += 1
            if at is not None:
                if item["firstSeen"] is None or at < item["firstSeen"]:
                    item["firstSeen"] = at
                if item["lastSeen"] is None or at > item["lastSeen"]:
                    item["lastSeen"] = at
            peak = topic.get("peak")
            if isinstance(peak, int) and peak > 0:
                if item["peakRank"] is None or peak < item["peakRank"]:
                    item["peakRank"] = peak
            for title in topic.get("titles") or []:
                if isinstance(title, Mapping):
                    text = str(title.get("t") or "").strip()
                    if text:
                        item["titles"].add(text)
                        all_titles.add(text)

    max_appearances = max((item["appearances"] for item in topics.values()), default=1)
    result: list[dict[str, Any]] = []
    for item in topics.values():
        last_seen = item["lastSeen"]
        if last_seen is None:
            freshness = 0.0
        else:
            freshness = 1.0 - min(1.0, max(0.0, (now - last_seen) / window))
        result.append({
            "name": item["name"],
            "appearances": item["appearances"],
            "ratio": round(item["appearances"] / total, 3) if total else 0.0,
            "recentAppearances": item["recentAppearances"],
            "momentum": round(
                item["recentAppearances"] / max(1, min(RECENT_SNAPSHOTS, total)), 3
            ),
            "freshness": round(freshness, 3),
            "weight": round(item["appearances"] / max(1, max_appearances), 3),
            "firstSeen": _iso(item["firstSeen"]) if item["firstSeen"] else None,
            "lastSeen": _iso(last_seen) if last_seen else None,
            "peakRank": item["peakRank"],
            "titleCount": len(item["titles"]),
        })

    result.sort(
        key=lambda entry: (entry["appearances"], entry["lastSeen"] or ""),
        reverse=True,
    )
    return {
        "windowHours": WINDOW_HOURS,
        "snapshotCount": total,
        "updatedAt": _iso(now),
        "totals": {
            "runs": total,
            "topics": len(result),
            "titles": len(all_titles),
        },
        "topics": result[:MAX_HISTORY_TOPICS],
    }


def update_history(
    topics: Iterable[Mapping[str, Any]],
    path: str | Path,
    *,
    now: datetime | None = None,
    mode: str = "current",
) -> dict[str, Any]:
    """写入本次快照并返回 24 小时聚合结果。"""
    moment = _as_aware(now)
    target = Path(path)
    snapshots = _load(target)
    snapshot = make_snapshot(topics, moment, mode=mode)

    if snapshot["topics"]:
        signature = _signature(snapshot)
        if snapshots and _signature(snapshots[-1]) == signature:
            snapshots[-1]["at"] = snapshot["at"]
            snapshots[-1]["mode"] = snapshot["mode"]
        else:
            snapshots.append(dict(snapshot, signature=signature))
        snapshots = _prune(snapshots, moment)
        _write(target, snapshots)

    return _aggregate(snapshots, moment)
