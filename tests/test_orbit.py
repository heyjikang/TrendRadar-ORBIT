# coding=utf-8
"""ORBIT 3D 情报舱数据适配与输出隔离测试。"""

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from trendradar.report import generate_html_report
from trendradar.report.orbit import (
    build_orbit_payload,
    build_topic_fields,
    render_selfcontained_orbit_html,
)
from trendradar.report.orbit_history import update_history

ASSETS = Path(__file__).resolve().parents[1] / "trendradar" / "report" / "orbit_assets"

SAMPLE_REPORT = {
    "stats": [
        {
            "word": "AI大模型",
            "count": 2,
            "titles": [
                {
                    "title": "<script>alert(1)</script>",
                    "source_name": "example",
                    "url": "javascript:alert(2)",
                    "ranks": [3, 1],
                },
                {
                    "title": "新闻二",
                    "source_name": "test",
                    "mobile_url": "https://example.org/news",
                    "ranks": [12],
                },
            ],
        }
    ],
    "hotlist_total": 300,
    "rss_matched_count": 7,
    "rss_total_count": 20,
    "platform_total": 11,
    "failed_ids": [],
}


class OrbitPayloadTests(unittest.TestCase):
    def test_maps_topics_and_sanitizes_urls(self):
        payload = build_orbit_payload(SAMPLE_REPORT, mode="current")
        topic = payload["topics"][0]
        self.assertEqual(topic["name"], "AI大模型")
        self.assertEqual(payload["metrics"]["hotlistMatched"], 2)
        self.assertEqual(payload["metrics"]["rssMatched"], 7)
        self.assertEqual(payload["metrics"]["platforms"], "11/11")
        self.assertEqual(topic["headlines"][0]["rank"], 1)
        self.assertEqual(topic["headlines"][0]["url"], "")
        self.assertEqual(topic["headlines"][1]["url"], "https://example.org/news")
        self.assertNotIn("aiSummary", topic)
        self.assertFalse(payload["isLive"])

    def test_empty_report(self):
        payload = build_orbit_payload({"stats": []})
        self.assertEqual(payload["topics"], [])
        self.assertEqual(payload["metrics"]["hotlistMatched"], 0)

    def test_ai_summary_requires_explicit_topic_input(self):
        payload = build_orbit_payload(
            SAMPLE_REPORT, topic_ai_summaries={"AI大模型": "真实生成的主题摘要"}
        )
        self.assertEqual(payload["topics"][0]["aiSummary"], "真实生成的主题摘要")

    def test_backfill_reports_mapping(self):
        payload = build_orbit_payload(
            SAMPLE_REPORT,
            rss_items=[{
                "word": "AI",
                "titles": [
                    {"title": "RSS 标题", "source_name": "Feed", "time_display": "11-03 10:00",
                     "url": "https://example.org/rss", "is_new": True},
                    {"title": "", "url": "https://example.org/empty"},
                ],
            }],
            rss_new_items=[{
                "word": "AI",
                "titles": [{"title": "新增条目", "source_name": "Feed", "url": "javascript:alert(1)"}],
            }],
            standalone_data={
                "platforms": [{"id": "p1", "name": "平台一", "items": [
                    {"title": "独立标题", "url": "https://example.org/p", "mobileUrl": "", "rank": 4},
                ]}],
                "rss_feeds": [{"id": "f1", "name": "订阅一", "items": [
                    {"title": "订阅标题", "url": "https://example.org/f", "published_at": "11-03"},
                ]}],
            },
        )
        self.assertEqual(payload["rss"]["groups"][0]["items"][0]["title"], "RSS 标题")
        self.assertTrue(payload["rss"]["groups"][0]["items"][0]["isNew"])
        self.assertEqual(payload["rssNew"]["groups"][0]["items"][0]["url"], "")
        self.assertEqual(payload["standalone"]["platforms"][0]["items"][0]["rank"], 4)
        self.assertEqual(payload["standalone"]["feeds"][0]["items"][0]["time"], "11-03")

    def test_ai_block_excludes_topic_decision(self):
        class Result:
            core_trends = "核心趋势内容"
            sentiment_controversy = ""
            signals = "弱信号 <b>不应被当作 HTML</b>"
            rss_insights = ""
            outlook_strategy = "策略建议"
            standalone_summaries = {"平台一": "独立源概括"}
            topic_decision = "选题决策结论"
            success = True
            skipped = False
            error = ""
            ai_mode = "current"
            total_news = 100
            analyzed_news = 60
            include_rss = True
            include_standalone = True

        payload = build_orbit_payload(SAMPLE_REPORT, ai_analysis=Result())
        ai = payload["ai"]
        self.assertTrue(ai["available"])
        self.assertEqual([section["key"] for section in ai["sections"]],
                         ["coreTrends", "signals", "outlookStrategy"])
        self.assertEqual(ai["standaloneSummaries"][0]["source"], "平台一")
        self.assertNotIn("topic_decision", ai)
        self.assertNotIn("选题决策结论", str(payload))

    def test_ai_block_unavailable_reason(self):
        payload = build_orbit_payload(SAMPLE_REPORT)
        ai = payload["ai"]
        self.assertFalse(ai["available"])
        self.assertEqual(ai["sections"], [])
        self.assertTrue(ai["reason"])


class OrbitHistoryTests(unittest.TestCase):
    TOPICS = [{
        "name": "AI大模型",
        "headlines": [
            {"title": "新闻一", "source": "示例", "rank": 2},
            {"title": "新闻二", "source": "示例", "rank": 7},
        ],
    }]

    @staticmethod
    def _at(day: int, hour: int, minute: int = 0) -> datetime:
        tz = timezone(timedelta(hours=8))
        return datetime(2026, 11, day, hour, minute, tzinfo=tz)

    def test_dedupes_identical_runs_and_accumulates_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "orbit" / "history" / "rolling.json"
            first = update_history(self.TOPICS, target, now=self._at(3, 9))
            self.assertEqual(first["snapshotCount"], 1)
            self.assertEqual(first["topics"][0]["appearances"], 1)

            # 内容完全相同的重复运行只刷新时间戳，不虚增出现次数
            again = update_history(self.TOPICS, target, now=self._at(3, 9, 10))
            self.assertEqual(again["snapshotCount"], 1)
            self.assertEqual(again["topics"][0]["appearances"], 1)

            changed = [{
                "name": "AI大模型",
                "headlines": [{"title": "新闻三", "source": "示例", "rank": 1}],
            }]
            third = update_history(changed, target, now=self._at(3, 9, 20))
            self.assertEqual(third["snapshotCount"], 2)
            top = third["topics"][0]
            self.assertEqual(top["appearances"], 2)
            self.assertEqual(top["recentAppearances"], 2)
            self.assertEqual(top["peakRank"], 1)
            self.assertGreater(top["momentum"], 0)
            self.assertGreater(top["freshness"], 0.9)
            self.assertEqual(third["totals"]["titles"], 3)
            raw = json.loads(target.read_text("utf-8"))
            self.assertEqual(len(raw["snapshots"]), 2)

    def test_prune_drops_snapshots_outside_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "rolling.json"
            update_history(self.TOPICS, target, now=self._at(3, 9))
            # 25 小时后旧快照必须被窗口淘汰，只剩本次
            later = update_history(
                [{"name": "金融宏观", "headlines": [{"title": "新标题", "rank": 5}]}],
                target,
                now=self._at(4, 10),
            )
            self.assertEqual(later["snapshotCount"], 1)
            self.assertEqual([item["name"] for item in later["topics"]], ["金融宏观"])
            raw = json.loads(target.read_text("utf-8"))
            self.assertEqual(len(raw["snapshots"]), 1)

    def test_payload_history_is_empty_without_file(self):
        payload = build_orbit_payload(SAMPLE_REPORT)
        history = payload["history"]
        self.assertEqual(history["windowHours"], 24)
        self.assertEqual(history["snapshotCount"], 0)
        self.assertEqual(history["topics"], [])
        self.assertEqual(history["totals"]["titles"], 0)

    def test_payload_writes_history_when_file_given(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "orbit" / "history" / "rolling.json"
            payload = build_orbit_payload(
                SAMPLE_REPORT, history_file=target, generated_at=self._at(3, 9)
            )
            self.assertTrue(target.exists())
            history = payload["history"]
            self.assertEqual(history["snapshotCount"], 1)
            self.assertEqual(history["topics"][0]["name"], "AI大模型")
            self.assertEqual(history["topics"][0]["appearances"], 1)
            self.assertEqual(history["topics"][0]["peakRank"], 1)
            self.assertEqual(history["totals"]["titles"], 2)


class OrbitHtmlTests(unittest.TestCase):
    def test_selfcontained_html_escapes_script_breakout(self):
        html = render_selfcontained_orbit_html(build_orbit_payload(SAMPLE_REPORT), ASSETS)
        self.assertIn("\\u003cscript\\u003e", html)
        self.assertNotIn('"javascript:alert(2)"', html)
        # 资源全部内联，不依赖同目录脚本或公网 CDN
        self.assertNotIn('src="orbit.js"', html)
        self.assertNotIn('href="styles.css"', html)
        self.assertIn("getContext('webgl2'", html)
        # WebGL2 不可用时的 Canvas 降级仍在包内
        self.assertIn("createTrendRadarFallback", html)

    def test_selfcontained_html_includes_report_views(self):
        payload = build_orbit_payload(
            SAMPLE_REPORT,
            ai_analysis={"success": True, "core_trends": "<img src=x onerror=alert(1)>"},
        )
        html = render_selfcontained_orbit_html(payload, ASSETS)
        self.assertIn('data-view="rss"', html)
        self.assertIn("全局 AI 研判", html)
        self.assertIn("ai-overlay", html)
        # AI 文本以纯文本注入，不产生可执行标签
        self.assertNotIn("<img src=x", html)


class OrbitReportIsolationTests(unittest.TestCase):
    def test_orbit_output_does_not_overwrite_original_report(self):
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                generate_html_report(
                    stats=[{"word": "主题", "count": 1, "percentage": 1.0, "titles": [{
                        "title": "标题", "source_name": "来源", "time_display": "",
                        "count": 1, "ranks": [1], "rank_threshold": 3,
                        "url": "https://example.org", "mobile_url": "",
                        "is_new": False, "rank_timeline": [],
                    }]}],
                    total_titles=1,
                    mode="daily",
                    output_dir="output",
                    date_folder="2026-11-03",
                    time_filename="09-19",
                    render_html_func=lambda *args: "<html>ORIGINAL</html>",
                    render_orbit_func=lambda *args: "<html>ORBIT</html>",
                )
            finally:
                os.chdir(cwd)

            output = Path(tmp) / "output"
            self.assertEqual((output / "html" / "latest" / "daily.html").read_text("utf-8"), "<html>ORIGINAL</html>")
            self.assertEqual((output / "index.html").read_text("utf-8"), "<html>ORIGINAL</html>")
            self.assertEqual((Path(tmp) / "index.html").read_text("utf-8"), "<html>ORIGINAL</html>")
            self.assertEqual((output / "html" / "orbit" / "daily.html").read_text("utf-8"), "<html>ORBIT</html>")
            self.assertEqual(
                (output / "html" / "orbit" / "archive" / "2026-11-03" / "09-19.html").read_text("utf-8"),
                "<html>ORBIT</html>",
            )


class OrbitTopicFieldTests(unittest.TestCase):
    """主题视觉场适配器：锚点稳定、强弱只来自真实差异。"""

    TOPICS = [
        {"id": "topic-01", "name": "金融宏观", "headlines": [{"rank": 1}]},
        {"id": "topic-02", "name": "智能汽车", "headlines": [{"rank": 3}]},
        {"id": "topic-03", "name": "中国科技", "headlines": [{"rank": 11}, {"rank": 12}]},
    ]

    def test_anchor_is_unit_vector(self):
        fields = build_topic_fields(self.TOPICS)
        for field in fields:
            anchor = field["anchor"]
            self.assertEqual(len(anchor), 3)
            norm = sum(value * value for value in anchor) ** 0.5
            self.assertAlmostEqual(norm, 1.0, places=3)

    def test_anchor_stable_across_topic_order(self):
        forward = {f["color"]: f["anchor"] for f in build_topic_fields(self.TOPICS)}
        shuffled = {f["color"]: f["anchor"] for f in build_topic_fields(list(reversed(self.TOPICS)))}
        self.assertEqual(forward, shuffled)

    def test_ridge_follows_peak_rank_within_bounds(self):
        fields = {f["color"]: f for f in build_topic_fields(self.TOPICS)}
        first, last = fields["#F274B7"], fields["#60DDE6"]
        self.assertEqual(first["peakRank"], 1)
        self.assertEqual(last["peakRank"], 11)
        self.assertGreater(first["ridge"], last["ridge"])
        for field in fields.values():
            self.assertGreaterEqual(field["ridge"], 0.02)
            self.assertLessEqual(field["ridge"], 0.05)

    def test_bundle_only_when_multiple_titles(self):
        single = build_topic_fields([{"name": "金融宏观", "headlines": [{"rank": 1}]}])[0]
        multi = build_topic_fields([{"name": "中国科技", "headlines": [{"rank": 1}, {"rank": 2}]}])[0]
        self.assertEqual(single["bundle"], 0.0)
        self.assertGreater(multi["bundle"], 0.0)

    def test_single_snapshot_does_not_fake_strength(self):
        history = {
            "snapshotCount": 1,
            "topics": [{
                "name": "金融宏观", "weight": 1.0, "momentum": 1.0, "freshness": 1.0,
                "peakRank": 1, "titleCount": 1,
            }],
        }
        field = build_topic_fields({"topics": self.TOPICS, "history": history})[0]
        self.assertEqual(field["weight"], 0.0)
        self.assertEqual(field["momentum"], 0.0)
        self.assertEqual(field["freshness"], 0.0)
        self.assertEqual(field["peakRank"], 1)
        self.assertEqual(field["titleCount"], 1)

    def test_weight_activates_when_statistics_differ(self):
        history = {
            "snapshotCount": 3,
            "topics": [
                {"name": "金融宏观", "weight": 3.0, "momentum": 2.0, "freshness": 0.9},
                {"name": "智能汽车", "weight": 1.0, "momentum": 0.5, "freshness": 0.4},
            ],
        }
        fields = build_topic_fields({"topics": self.TOPICS, "history": history})
        self.assertGreater(fields[0]["weight"], 0.0)
        self.assertGreater(fields[0]["momentum"], fields[1]["momentum"])

    def test_active_follows_selection(self):
        fields = build_topic_fields(self.TOPICS, selected_topic_id="topic-02")
        self.assertEqual([f["active"] for f in fields], [False, True, False])
        by_name = build_topic_fields(self.TOPICS, selected_topic_id="中国科技")
        self.assertTrue(by_name[2]["active"])

    def test_payload_exposes_topic_fields(self):
        payload = build_orbit_payload(SAMPLE_REPORT)
        self.assertEqual(len(payload["topicFields"]), 1)
        self.assertEqual(payload["topicFields"][0]["peakRank"], 1)
        self.assertFalse(payload["topicFields"][0]["active"])


if __name__ == "__main__":
    unittest.main()
