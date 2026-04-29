from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import (
    close_db_connection_pool,
    fetch_rows,
    get_runtime_semantic_quality,
    get_runtime_queues,
    make_json_safe,
    serialize_semantic_quality_summary,
    serialize_queue_snapshot,
    serialize_scheduler_snapshot,
)


class MainTests(unittest.TestCase):
    def tearDown(self) -> None:
        close_db_connection_pool()

    def test_make_json_safe_normalizes_decimal_and_dates_recursively(self) -> None:
        payload = {
            "amount": Decimal("123.45"),
            "biz_date": date(2026, 4, 3),
            "nested": {
                "updated_at": datetime(2026, 4, 4, 8, 30, 15),
                "items": [Decimal("1.2"), {"closed_at": date(2026, 4, 2)}],
            },
        }

        self.assertEqual(
            make_json_safe(payload),
            {
                "amount": 123.45,
                "biz_date": "2026-04-03",
                "nested": {
                    "updated_at": "2026-04-04T08:30:15",
                    "items": [1.2, {"closed_at": "2026-04-02"}],
                },
            },
        )

    def test_serialize_scheduler_snapshot_merges_registry_with_last_runs_and_pollers(self) -> None:
        payload = serialize_scheduler_snapshot(
            [
                {"job_type": "sync", "last_ran_at": "2026-04-07T03:16:00+08:00"},
                {"job_type": "send-midday-brief", "last_ran_at": "2026-04-07T12:00:10+08:00"},
            ],
            [
                {
                    "state_key": "scheduled-sync",
                    "state_json": {
                        "poller": "scheduled-sync",
                        "status": "ok",
                        "lastRunAt": "2026-04-07T12:00:00+08:00",
                    },
                },
                {
                    "state_key": "scheduled-delivery",
                    "state_json": {
                        "poller": "scheduled-delivery",
                        "status": "ok",
                        "lastRunAt": "2026-04-07T12:00:10+08:00",
                    },
                },
                {
                    "state_key": "scheduled",
                    "state_json": {
                        "poller": "scheduled",
                        "status": "ok",
                        "lastRunAt": "2026-04-07T11:59:10+08:00",
                    },
                },
            ],
            [
                {
                    "org_id": "1001",
                    "store_name": "迎宾店",
                    "biz_date": "2026-04-07",
                    "alert_sent_at": "2026-04-07T01:00:00+08:00",
                    "upgraded_at": "2026-04-07T03:20:00+08:00",
                }
            ],
            "2026-03-31T00:00:00+08:00",
        )

        self.assertEqual(payload["authority"], "app-service-pollers")
        self.assertEqual(payload["contract_version"], "2026-04-16.control-plane.v1")
        self.assertEqual(
            payload["entry_surface"],
            {
                "entry_role": "runtime_query_api",
                "access_mode": "read_only",
                "owner_surface": "admin_read_service",
                "audit_mode": "none",
                "request_dedupe": "none",
            },
        )
        self.assertEqual(
            payload["observability_streams"],
            [
                "scheduler_snapshot",
                "report_delivery_upgrade_summary",
                "legacy_poller_warning",
            ],
        )
        self.assertTrue(any(job["job_type"] == "nightly-history-backfill" for job in payload["jobs"]))
        self.assertEqual(payload["jobs"][0]["job_type"], "sync")
        self.assertEqual(payload["jobs"][0]["last_ran_at"], "2026-04-07T03:16:00+08:00")
        self.assertEqual(
            next(
                job for job in payload["jobs"] if job["job_type"] == "run-customer-history-catchup"
            ),
            {
                "job_type": "run-customer-history-catchup",
                "label": "顾客历史补齐",
                "orchestrator": "sync",
                "surface_role": "conditional",
                "surface_note": "仅在夜间原始事实完成后继续补顾客派生层；pending 不代表主链异常",
                "last_ran_at": None,
            },
        )
        self.assertEqual(
            [poller["poller"] for poller in payload["pollers"]],
            ["scheduled-sync", "scheduled-delivery", "analysis"],
        )
        self.assertEqual(
            payload["legacy_pollers"],
            [
                {
                    "state_key": "scheduled",
                    "poller": "scheduled",
                    "status": "ok",
                    "last_run_at": "2026-04-07T11:59:10+08:00",
                    "last_success_at": None,
                    "last_failure_at": None,
                    "last_duration_ms": None,
                    "last_result_count": None,
                    "last_error": None,
                }
            ],
        )
        self.assertEqual(
            payload["warnings"],
            [
                "legacy poller state present: scheduled | status=ok | lastRun=2026-04-07T11:59:10+08:00"
            ],
        )
        self.assertEqual(
            payload["report_delivery_upgrade_summary"],
            {
                "window_start_at": "2026-03-31T00:00:00+08:00",
                "recent_upgrade_count": 1,
                "recent_upgrades": [
                    {
                        "org_id": "1001",
                        "store_name": "迎宾店",
                        "biz_date": "2026-04-07",
                        "alert_sent_at": "2026-04-07T01:00:00+08:00",
                        "upgraded_at": "2026-04-07T03:20:00+08:00",
                    }
                ],
            },
        )

    def test_serialize_scheduler_snapshot_parses_json_strings_from_db(self) -> None:
        payload = serialize_scheduler_snapshot(
            [],
            [
                {
                    "state_key": "analysis",
                    "state_json": (
                        '{"poller":"analysis","status":"ok","lastRunAt":"2026-04-07T13:20:02.842Z"}'
                    ),
                },
            ],
            [],
            "2026-03-31T00:00:00+08:00",
        )

        analysis = next(
            poller for poller in payload["pollers"] if poller.get("poller") == "analysis"
        )

        self.assertEqual(analysis["status"], "ok")
        self.assertEqual(analysis["last_run_at"], "2026-04-07T13:20:02.842Z")

    def test_serialize_scheduler_snapshot_surfaces_stale_sync_run_warnings(self) -> None:
        payload = serialize_scheduler_snapshot(
            [],
            [],
            [],
            "2026-03-31T00:00:00+08:00",
            {
                "running_count": 3,
                "stale_running_count": 2,
                "daily_running_count": 2,
                "stale_daily_running_count": 1,
                "backfill_running_count": 1,
                "stale_backfill_running_count": 1,
                "latest_started_at": "2026-04-17T02:58:35.583Z",
                "latest_age_hours": 8.1,
                "stale_cutoff_at": "2026-04-17T03:05:00.000Z",
            },
        )

        self.assertIn(
            "stale sync runs present: running 3 | stale 2 | daily 2/1 | backfill 1/1 | latest=2026-04-17T02:58:35.583Z | age=8.1h",
            payload["warnings"],
        )

    def test_serialize_scheduler_snapshot_explains_active_sync_wave_when_last_run_is_previous_completion(self) -> None:
        payload = serialize_scheduler_snapshot(
            [],
            [
                {
                    "state_key": "scheduled-sync",
                    "state_json": {
                        "poller": "scheduled-sync",
                        "status": "ok",
                        "lastRunAt": "2026-04-16T18:59:52.583Z",
                        "lastSuccessAt": "2026-04-16T18:59:52.583Z",
                        "lastResultCount": 0,
                    },
                }
            ],
            [],
            "2026-03-31T00:00:00+08:00",
            {
                "running_count": 1,
                "stale_running_count": 0,
                "daily_running_count": 1,
                "stale_daily_running_count": 0,
                "backfill_running_count": 0,
                "stale_backfill_running_count": 0,
                "latest_started_at": "2026-04-17T03:43:37.088Z",
                "latest_age_hours": 0.1,
                "stale_cutoff_at": "2026-04-16T23:46:54.323203Z",
            },
        )

        self.assertIn(
            "scheduled sync wave in progress: running 1 | daily 1 | backfill 0 | latest=2026-04-17T03:43:37.088Z | age=0.1h | scheduled-sync lastRun updates after the current wave finishes",
            payload["warnings"],
        )

    def test_serialize_queue_snapshot_normalizes_runtime_counts(self) -> None:
        payload = serialize_queue_snapshot(
            {
                "pending_count": 2,
                "running_count": 1,
                "completed_count": 8,
                "failed_count": 3,
            },
            {
                "pending_count": 1,
                "retrying_count": 2,
                "abandoned_count": 1,
            },
            {
                "pending_count": 4,
                "retrying_count": 1,
                "abandoned_count": 2,
            },
            {
                "unresolved_dead_letter_count": 5,
                "unresolved_job_count": 2,
                "unresolved_subscriber_count": 3,
                "latest_unresolved_at": "2026-04-13T07:57:31.354Z",
                "invalid_chatid_subscriber_count": 3,
                "subscriber_fanout_exhausted_job_count": 2,
                "latest_reason": (
                    "[2026-04-13T07:57:31.987Z] [AiBotSDK] [WARN] Reply ack error: "
                    "reqId=aibot_send_msg_1776067051878_c14a5fe1, errcode=93006, "
                    "errmsg=invalid chatid, hint: [1776067052074153311952067], "
                    "from ip: 115.57.50.24, more info at "
                    "https://open.work.weixin.qq.com/devtool/query?e=93006\n"
                    "[object Object]\n"
                ),
            },
            datetime.fromisoformat("2026-04-16T11:00:00+00:00"),
            {
                "running_count": 3,
                "stale_running_count": 2,
                "daily_running_count": 2,
                "stale_daily_running_count": 1,
                "backfill_running_count": 1,
                "stale_backfill_running_count": 1,
                "latest_started_at": "2026-04-17T02:58:35.583Z",
                "latest_age_hours": 8.0,
                "stale_cutoff_at": "2026-04-16T23:00:00+00:00",
            },
        )

        self.assertEqual(payload["analysis"]["pending_count"], 2)
        self.assertEqual(payload["analysis"]["running_count"], 1)
        self.assertEqual(payload["analysis"]["job_delivery"]["retrying_count"], 2)
        self.assertEqual(payload["analysis"]["subscriber_delivery"]["abandoned_count"], 2)
        self.assertEqual(payload["analysis"]["unresolved_dead_letter_count"], 5)
        self.assertEqual(
            payload["entry_surface"],
            {
                "entry_role": "runtime_query_api",
                "access_mode": "read_only",
                "owner_surface": "admin_read_service",
                "audit_mode": "none",
                "request_dedupe": "none",
            },
        )
        self.assertEqual(
            payload["observability_streams"],
            ["queue_snapshot", "analysis_dead_letter_summary", "sync_execution_summary"],
        )
        self.assertEqual(
            payload["sync_execution"],
            {
                "running_count": 3,
                "stale_running_count": 2,
                "daily_running_count": 2,
                "stale_daily_running_count": 1,
                "backfill_running_count": 1,
                "stale_backfill_running_count": 1,
                "latest_started_at": "2026-04-17T02:58:35.583Z",
                "latest_age_hours": 8.0,
                "stale_cutoff_at": "2026-04-16T23:00:00+00:00",
            },
        )
        self.assertEqual(
            payload["analysis"]["dead_letter_summary"],
            {
                "unresolved_job_count": 2,
                "unresolved_subscriber_count": 3,
                "latest_unresolved_at": "2026-04-13T07:57:31.354Z",
                "latest_unresolved_age_hours": 75.0,
                "stale": True,
                "latest_reason": "invalid chatid",
                "invalid_chatid_subscriber_count": 3,
                "subscriber_fanout_exhausted_job_count": 2,
                "residual_class": "stale-invalid-chatid-subscriber",
            },
        )

    def test_get_runtime_queues_excludes_subscriber_jobs_from_job_delivery_counts(self) -> None:
        captured_sql: list[str] = []

        def fake_fetch_one(sql: str, params=()):
            captured_sql.append(sql)
            if "FROM analysis_jobs" in sql and "status = 'pending'" in sql:
                return {
                    "pending_count": 0,
                    "running_count": 0,
                    "completed_count": 0,
                    "failed_count": 1,
                }
            if "FROM analysis_jobs" in sql and "job_id NOT IN" in sql:
                return {
                    "pending_count": 0,
                    "retrying_count": 0,
                    "abandoned_count": 0,
                }
            if "FROM analysis_job_subscribers" in sql:
                return {
                    "pending_count": 0,
                    "retrying_count": 0,
                    "abandoned_count": 1,
                }
            return {
                "unresolved_dead_letter_count": 0,
                "unresolved_job_count": 0,
                "unresolved_subscriber_count": 0,
            }

        with patch("main.fetch_one", side_effect=fake_fetch_one):
            payload = get_runtime_queues()

        self.assertEqual(payload["analysis"]["job_delivery"]["abandoned_count"], 0)
        self.assertEqual(payload["analysis"]["subscriber_delivery"]["abandoned_count"], 1)
        self.assertEqual(payload["entry_surface"]["entry_role"], "runtime_query_api")
        self.assertTrue(
            any(
                "job_id NOT IN" in sql and "analysis_job_subscribers" in sql
                for sql in captured_sql
            )
        )

    def test_serialize_semantic_quality_summary_builds_backlog_and_samples(self) -> None:
        payload = serialize_semantic_quality_summary(
            {
                "total_count": 12,
                "success_count": 7,
                "clarify_count": 3,
                "fallback_used_count": 2,
                "latest_occurred_at": "2026-04-18T03:03:43.153Z",
            },
            [
                {"failure_class": "generic_unmatched", "count": 4},
                {"failure_class": "clarify_missing_metric", "count": 3},
            ],
            [{"analysis_framework_id": "store_operations_diagnosis_v1", "count": 2}],
            [{"route_upgrade_kind": "metric_to_advice", "count": 3}],
            24,
            "2026-04-18T03:00:00Z",
            "serving:serving-20260418040000",
        )

        self.assertEqual(payload["window_hours"], 24)
        self.assertEqual(payload["effective_occurred_after"], "2026-04-18T03:00:00Z")
        self.assertEqual(payload["effective_deploy_marker"], "serving:serving-20260418040000")
        self.assertEqual(payload["success_rate"], 7 / 12)
        self.assertEqual(
            payload["observability_streams"],
            [
                "semantic_quality_summary",
                "semantic_optimization_backlog",
                "semantic_sample_candidates",
            ],
        )
        self.assertEqual(
            payload["optimization_backlog"],
            [
                {
                    "failure_class": "generic_unmatched",
                    "count": 4,
                    "owner_module": "src/semantic-intent.ts",
                    "recommended_action": "补老板式开放问法和经营口语入口，避免经营问题被归到 generic unmatched。",
                    "priority": "high",
                },
                {
                    "failure_class": "clarify_missing_metric",
                    "count": 3,
                    "owner_module": "src/capability-graph.ts",
                    "recommended_action": "补 capability contract 的 required_slots / allow-default 策略，减少缺指标歧义。",
                    "priority": "medium",
                },
            ],
        )
        self.assertEqual(
            payload["sample_candidates"],
            [
                {
                    "failure_class": "generic_unmatched",
                    "count": 4,
                    "owner_module": "src/semantic-intent.ts",
                    "sample_tag": "boss_open_guidance",
                    "prompt": "哪个门店须重点关注",
                },
                {
                    "failure_class": "clarify_missing_metric",
                    "count": 3,
                    "owner_module": "src/capability-graph.ts",
                    "sample_tag": "metric_slot_gap",
                    "prompt": "义乌店昨天盘里收了多少",
                },
            ],
        )

    def test_get_runtime_semantic_quality_queries_summary_and_top_lists(self) -> None:
        captured_fetch_rows: list[tuple[str, tuple[object, ...]]] = []

        def fake_fetch_one(sql: str, params=()):
            self.assertIn("FROM semantic_execution_audits", sql)
            self.assertEqual(len(params), 1)
            return {
                "total_count": 10,
                "success_count": 6,
                "clarify_count": 2,
                "fallback_used_count": 1,
                "latest_occurred_at": "2026-04-18T03:03:43.153Z",
            }

        def fake_fetch_rows(sql: str, params=()):
            captured_fetch_rows.append((sql, tuple(params)))
            if "GROUP BY failure_class" in sql:
                return [{"failure_class": "entry_unresolved", "count": 3}]
            if "GROUP BY analysis_framework_id" in sql:
                return [{"analysis_framework_id": "store_profit_diagnosis_v1", "count": 2}]
            if "GROUP BY route_upgrade_kind" in sql:
                return [{"route_upgrade_kind": "metric_to_advice", "count": 1}]
            return []

        with patch("main.fetch_one", side_effect=fake_fetch_one), patch(
            "main.fetch_rows", side_effect=fake_fetch_rows
        ):
            payload = get_runtime_semantic_quality(window_hours=24, limit=5)

        self.assertEqual(payload["total_count"], 10)
        self.assertEqual(payload["success_count"], 6)
        self.assertEqual(payload["top_failure_classes"], [{"failure_class": "entry_unresolved", "count": 3}])
        self.assertEqual(
            payload["optimization_backlog"],
            [
                {
                    "failure_class": "entry_unresolved",
                    "count": 3,
                    "owner_module": "src/semantic-intent.ts",
                    "recommended_action": "补 semantic front door 的兜底分类与 owner-surface 落点，减少 entry unresolved。",
                    "priority": "high",
                }
            ],
        )
        self.assertEqual(
            payload["sample_candidates"],
            [
                {
                    "failure_class": "entry_unresolved",
                    "count": 3,
                    "owner_module": "src/semantic-intent.ts",
                    "sample_tag": "entry_unresolved",
                    "prompt": "五店近15天整体哪里不对",
                }
            ],
        )
        self.assertEqual(len(captured_fetch_rows), 3)
        self.assertTrue(all(len(params) == 2 for _, params in captured_fetch_rows))
        self.assertIsNone(payload["effective_deploy_marker"])

    def test_get_runtime_semantic_quality_uses_explicit_occurred_after_and_deploy_marker_when_provided(self) -> None:
        captured_fetch_one: list[tuple[str, tuple[object, ...]]] = []
        captured_fetch_rows: list[tuple[str, tuple[object, ...]]] = []
        occurred_after = "2026-04-18T03:00:00.000Z"
        deploy_marker = "serving:serving-20260418040000"

        def fake_fetch_one(sql: str, params=()):
            captured_fetch_one.append((sql, tuple(params)))
            return {
                "total_count": 2,
                "success_count": 1,
                "clarify_count": 1,
                "fallback_used_count": 0,
                "latest_occurred_at": "2026-04-18T03:03:43.153Z",
            }

        def fake_fetch_rows(sql: str, params=()):
            captured_fetch_rows.append((sql, tuple(params)))
            return []

        with patch("main.fetch_one", side_effect=fake_fetch_one), patch(
            "main.fetch_rows", side_effect=fake_fetch_rows
        ):
            payload = get_runtime_semantic_quality(
                window_hours=24,
                limit=5,
                occurred_after=occurred_after,
                deploy_marker=deploy_marker,
            )

        self.assertEqual(payload["total_count"], 2)
        self.assertEqual(
            captured_fetch_one[0][1],
            ("2026-04-18T03:00:00Z", deploy_marker),
        )
        self.assertTrue(
            all(
                params[0] == "2026-04-18T03:00:00Z" and params[1] == deploy_marker
                for _, params in captured_fetch_rows
            )
        )
        self.assertEqual(payload["effective_deploy_marker"], deploy_marker)

    @patch.dict("os.environ", {"HETANG_QUERY_DATABASE_URL": "postgresql://demo"}, clear=False)
    def test_fetch_rows_reuses_connection_pool_and_returns_connection(self) -> None:
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"store_name": "迎宾店"}]
        connection = MagicMock()
        connection.cursor.return_value = cursor
        fake_pool = MagicMock()
        fake_pool.getconn.return_value = connection

        with patch("main.build_db_connection_pool", return_value=fake_pool) as build_pool:
            first = fetch_rows("select 1")
            second = fetch_rows("select 1")

        self.assertEqual(first, [{"store_name": "迎宾店"}])
        self.assertEqual(second, [{"store_name": "迎宾店"}])
        self.assertEqual(build_pool.call_count, 1)
        self.assertEqual(fake_pool.getconn.call_count, 2)
        self.assertEqual(fake_pool.putconn.call_count, 2)
        connection.set_session.assert_called_with(readonly=True, autocommit=True)


if __name__ == "__main__":
    unittest.main()
