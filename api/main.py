from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
from typing import Any, Iterable

from fastapi import FastAPI, HTTPException, Query
import psycopg2
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor


app = FastAPI(title="Hetang Query API", version="2.0.0")
_connection_pool: pg_pool.SimpleConnectionPool | None = None

_CONTROL_PLANE_CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "control-plane-contract.json"
)
_SEMANTIC_OPTIMIZATION_PLAYBOOK_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "semantic-optimization-playbook.json"
)
ANALYSIS_DEAD_LETTER_STALE_AFTER_HOURS = 24.0


def load_control_plane_contract() -> dict[str, Any]:
    with _CONTROL_PLANE_CONTRACT_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def load_semantic_optimization_playbook() -> dict[str, Any]:
    with _SEMANTIC_OPTIMIZATION_PLAYBOOK_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


_CONTROL_PLANE_CONTRACT = load_control_plane_contract()
CONTROL_PLANE_CONTRACT_VERSION = _CONTROL_PLANE_CONTRACT.get("version")
SYNC_RUN_STALE_AFTER_HOURS = 4.0
AUTHORITATIVE_SCHEDULER_JOBS: list[dict[str, Any]] = [
    dict(entry)
    for entry in _CONTROL_PLANE_CONTRACT.get("scheduler_jobs", [])
    if isinstance(entry, dict)
]
AUTHORITATIVE_SERVICE_POLLERS: list[str] = [
    str(entry.get("poller"))
    for entry in _CONTROL_PLANE_CONTRACT.get("service_pollers", [])
    if isinstance(entry, dict) and entry.get("poller")
]
RUNTIME_QUERY_ENTRY_SURFACE = {
    "entry_role": "runtime_query_api",
    "access_mode": "read_only",
    "owner_surface": "admin_read_service",
    "audit_mode": "none",
    "request_dedupe": "none",
}
RUNTIME_SCHEDULER_OBSERVABILITY_STREAMS = [
    "scheduler_snapshot",
    "report_delivery_upgrade_summary",
    "legacy_poller_warning",
]
RUNTIME_QUEUE_OBSERVABILITY_STREAMS = [
    "queue_snapshot",
    "analysis_dead_letter_summary",
    "sync_execution_summary",
]
RUNTIME_SEMANTIC_QUALITY_OBSERVABILITY_STREAMS = [
    "semantic_quality_summary",
    "semantic_optimization_backlog",
    "semantic_sample_candidates",
]
_SEMANTIC_OPTIMIZATION_PLAYBOOK = load_semantic_optimization_playbook()
DEFAULT_SEMANTIC_OPTIMIZATION_PLAYBOOK_ENTRY = _SEMANTIC_OPTIMIZATION_PLAYBOOK.get(
    "default",
    {
        "owner_module": "src/semantic-intent.ts",
        "recommended_action": "补失败样本归类并收敛到 capability graph / semantic intent 主链。",
        "priority": "medium",
        "samples": [
            {
                "sample_tag": "semantic_gap_generic",
                "prompt": "五店近15天整体哪里不对",
            }
        ],
    },
)
SEMANTIC_OPTIMIZATION_PLAYBOOK = _SEMANTIC_OPTIMIZATION_PLAYBOOK.get("entries", {})


def format_legacy_poller_warning(entry: dict[str, Any]) -> str:
    details = [f"legacy poller state present: {entry.get('state_key')}"]
    if entry.get("status"):
        details.append(f"status={entry.get('status')}")
    if entry.get("last_run_at"):
        details.append(f"lastRun={entry.get('last_run_at')}")
    if entry.get("last_error"):
        details.append(f"error={entry.get('last_error')}")
    return " | ".join(details)


def format_stale_sync_run_warning(summary: dict[str, Any]) -> str:
    details = [
        f"stale sync runs present: running {normalize_int(summary.get('running_count'))}",
        f"stale {normalize_int(summary.get('stale_running_count'))}",
        f"daily {normalize_int(summary.get('daily_running_count'))}/{normalize_int(summary.get('stale_daily_running_count'))}",
        f"backfill {normalize_int(summary.get('backfill_running_count'))}/{normalize_int(summary.get('stale_backfill_running_count'))}",
    ]
    if summary.get("latest_started_at"):
        details.append(f"latest={summary.get('latest_started_at')}")
    if summary.get("latest_age_hours") is not None:
        details.append(f"age={summary.get('latest_age_hours'):.1f}h")
    return " | ".join(details)


def format_active_scheduled_sync_warning(summary: dict[str, Any]) -> str:
    details = [
        f"scheduled sync wave in progress: running {normalize_int(summary.get('running_count'))}",
        f"daily {normalize_int(summary.get('daily_running_count'))}",
        f"backfill {normalize_int(summary.get('backfill_running_count'))}",
    ]
    if summary.get("latest_started_at"):
        details.append(f"latest={summary.get('latest_started_at')}")
    if summary.get("latest_age_hours") is not None:
        details.append(f"age={summary.get('latest_age_hours'):.1f}h")
    details.append("scheduled-sync lastRun updates after the current wave finishes")
    return " | ".join(details)


def should_explain_active_scheduled_sync(
    sync_execution: dict[str, Any] | None,
    scheduled_sync_poller: dict[str, Any] | None,
) -> bool:
    if not sync_execution:
        return False
    if normalize_int(sync_execution.get("running_count")) <= 0:
        return False
    if normalize_int(sync_execution.get("stale_running_count")) > 0:
        return False
    latest_started_at = parse_iso_datetime(sync_execution.get("latest_started_at"))
    last_run_at = parse_iso_datetime((scheduled_sync_poller or {}).get("last_run_at"))
    if latest_started_at is None or last_run_at is None:
        return True
    return latest_started_at > last_run_at


def summarize_detail_text(value: Any, max_length: int = 120) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    if not normalized:
        return None
    if "invalid chatid" in normalized.lower():
        return "invalid chatid"
    permission_match = re.search(
        r"permission denied for schema [a-z0-9_]+", normalized, re.IGNORECASE
    )
    if permission_match:
        return permission_match.group(0)
    not_a_view_match = re.search(r'"[^"]+" is not a view', normalized, re.IGNORECASE)
    if not_a_view_match:
        return not_a_view_match.group(0)
    if len(normalized) <= max_length:
        return normalized
    return normalized[: max_length - 3] + "..."


def resolve_dead_letter_residual_class(summary: dict[str, Any]) -> str | None:
    stale = summary.get("stale") is True
    unresolved_job_count = normalize_int(summary.get("unresolved_job_count"))
    unresolved_subscriber_count = normalize_int(summary.get("unresolved_subscriber_count"))
    invalid_chatid_subscriber_count = normalize_int(
        summary.get("invalid_chatid_subscriber_count")
    )
    subscriber_fanout_exhausted_job_count = normalize_int(
        summary.get("subscriber_fanout_exhausted_job_count")
    )
    if (
        stale
        and unresolved_subscriber_count > 0
        and invalid_chatid_subscriber_count == unresolved_subscriber_count
        and subscriber_fanout_exhausted_job_count == unresolved_job_count
    ):
        return "stale-invalid-chatid-subscriber"
    return None


def parse_iso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def compute_age_hours(observed_at: datetime, created_at: Any) -> float | None:
    created_at_dt = parse_iso_datetime(created_at)
    if created_at_dt is None:
        return None
    age_hours = max((observed_at - created_at_dt).total_seconds(), 0.0) / 3600.0
    return round(age_hours, 1)


def serialize_report_delivery_upgrade_summary(
    upgrade_rows: list[dict[str, Any]], window_start_at: str
) -> dict[str, Any]:
    upgrades = [
        {
            "org_id": str(row.get("org_id")),
            "store_name": str(row.get("store_name")),
            "biz_date": str(row.get("biz_date")),
            "alert_sent_at": row.get("alert_sent_at"),
            "upgraded_at": row.get("upgraded_at"),
        }
        for row in upgrade_rows
    ]
    return {
        "window_start_at": window_start_at,
        "recent_upgrade_count": len(upgrades),
        "recent_upgrades": upgrades,
    }


def serialize_sync_execution_summary(sync_run_row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not sync_run_row:
        return None
    return {
        "running_count": normalize_int(sync_run_row.get("running_count")),
        "stale_running_count": normalize_int(sync_run_row.get("stale_running_count")),
        "daily_running_count": normalize_int(sync_run_row.get("daily_running_count")),
        "stale_daily_running_count": normalize_int(
            sync_run_row.get("stale_daily_running_count")
        ),
        "backfill_running_count": normalize_int(sync_run_row.get("backfill_running_count")),
        "stale_backfill_running_count": normalize_int(
            sync_run_row.get("stale_backfill_running_count")
        ),
        "latest_started_at": sync_run_row.get("latest_started_at"),
        "latest_age_hours": sync_run_row.get("latest_age_hours"),
        "stale_cutoff_at": sync_run_row.get("stale_cutoff_at"),
    }


def get_database_url() -> str:
    database_url = (
        os.getenv("HETANG_QUERY_DATABASE_URL")
        or os.getenv("QUERY_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("HETANG_DATABASE_URL")
        or os.getenv("POSTGRES_DSN")
    )
    if not database_url:
        raise RuntimeError(
            "HETANG_QUERY_DATABASE_URL, QUERY_DATABASE_URL, DATABASE_URL, or HETANG_DATABASE_URL is required"
        )
    return database_url


def build_db_connection_pool() -> pg_pool.SimpleConnectionPool:
    return pg_pool.SimpleConnectionPool(
        minconn=1,
        maxconn=max(int(os.getenv("HETANG_QUERY_API_POOL_MAX", "8")), 1),
        dsn=get_database_url(),
        cursor_factory=RealDictCursor,
    )


def get_db_connection_pool() -> pg_pool.SimpleConnectionPool:
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = build_db_connection_pool()
    return _connection_pool


def close_db_connection_pool() -> None:
    global _connection_pool
    if _connection_pool is not None:
        _connection_pool.closeall()
        _connection_pool = None


def get_db_connection() -> psycopg2.extensions.connection:
    connection = get_db_connection_pool().getconn()
    connection.set_session(readonly=True, autocommit=True)
    return connection


def make_json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: make_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [make_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [make_json_safe(item) for item in value]
    return value


def normalize_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def normalize_rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def resolve_semantic_quality_lower_bound(
    window_hours: int, occurred_after: str | None
) -> str:
    window_lower_bound = (
        datetime.now(timezone.utc) - timedelta(hours=window_hours)
    ).isoformat().replace("+00:00", "Z")
    if not occurred_after:
        return window_lower_bound
    occurred_after_dt = parse_iso_datetime(occurred_after)
    if occurred_after_dt is None:
        return window_lower_bound
    window_lower_bound_dt = parse_iso_datetime(window_lower_bound)
    if window_lower_bound_dt is None:
        return occurred_after
    return max(window_lower_bound_dt, occurred_after_dt).isoformat().replace("+00:00", "Z")


def resolve_semantic_optimization_playbook_entry(failure_class: str) -> dict[str, Any]:
    return SEMANTIC_OPTIMIZATION_PLAYBOOK.get(
        failure_class, DEFAULT_SEMANTIC_OPTIMIZATION_PLAYBOOK_ENTRY
    )


def build_semantic_optimization_backlog(
    top_failure_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    backlog: list[dict[str, Any]] = []
    for row in top_failure_rows:
        failure_class = str(row.get("failure_class"))
        playbook = resolve_semantic_optimization_playbook_entry(failure_class)
        backlog.append(
            {
                "failure_class": failure_class,
                "count": normalize_int(row.get("count")),
                "owner_module": playbook["owner_module"],
                "recommended_action": playbook["recommended_action"],
                "priority": playbook["priority"],
            }
        )
    return backlog


def build_semantic_sample_candidates(
    top_failure_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for row in top_failure_rows:
        failure_class = str(row.get("failure_class"))
        count = normalize_int(row.get("count"))
        playbook = resolve_semantic_optimization_playbook_entry(failure_class)
        for sample in playbook["samples"]:
            candidates.append(
                {
                    "failure_class": failure_class,
                    "count": count,
                    "owner_module": playbook["owner_module"],
                    "sample_tag": sample["sample_tag"],
                    "prompt": sample["prompt"],
                }
            )
    return candidates


def normalize_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def release_db_connection(connection: psycopg2.extensions.connection | None) -> None:
    if connection is None:
        return
    get_db_connection_pool().putconn(connection)


def fetch_rows(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    connection: psycopg2.extensions.connection | None = None
    cursor: RealDictCursor | None = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(sql, tuple(params))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        if cursor is not None:
            cursor.close()
        release_db_connection(connection)


def fetch_one(sql: str, params: Iterable[Any] = ()) -> dict[str, Any]:
    rows = fetch_rows(sql, params)
    return rows[0] if rows else {}


def raise_database_http_error(message: str, exc: Exception) -> None:
    raise HTTPException(status_code=500, detail=message) from exc


def serialize_scheduler_snapshot(
    job_rows: list[dict[str, Any]],
    poller_rows: list[dict[str, Any]],
    upgrade_rows: list[dict[str, Any]],
    upgrade_window_start_at: str,
    sync_run_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    last_run_map = {
        str(row.get("job_type")): row.get("last_ran_at")
        for row in job_rows
        if row.get("job_type")
    }
    pollers_by_name: dict[str, dict[str, Any]] = {}
    legacy_pollers: list[dict[str, Any]] = []
    for row in poller_rows:
        state = normalize_object(row.get("state_json"))
        poller_name = state.get("poller") or row.get("state_key")
        if not isinstance(poller_name, str) or not poller_name:
            continue
        payload = {
            "poller": poller_name,
            "status": state.get("status"),
            "last_run_at": state.get("lastRunAt"),
            "last_success_at": state.get("lastSuccessAt"),
            "last_failure_at": state.get("lastFailureAt"),
            "last_duration_ms": state.get("lastDurationMs"),
            "last_result_count": state.get("lastResultCount"),
            "last_error": state.get("lastError"),
        }
        if poller_name in AUTHORITATIVE_SERVICE_POLLERS:
            pollers_by_name[poller_name] = payload
            continue
        legacy_pollers.append(
            {
                "state_key": row.get("state_key") or poller_name,
                **payload,
            }
        )
    pollers = [
        pollers_by_name.get(poller_name, {"poller": poller_name})
        for poller_name in AUTHORITATIVE_SERVICE_POLLERS
    ]
    jobs = [
        {
            **entry,
            "last_ran_at": last_run_map.get(entry["job_type"]),
        }
        for entry in AUTHORITATIVE_SCHEDULER_JOBS
    ]
    sync_execution = serialize_sync_execution_summary(sync_run_row)
    warnings = [format_legacy_poller_warning(entry) for entry in legacy_pollers]
    if sync_execution and normalize_int(sync_execution.get("stale_running_count")) > 0:
        warnings.append(format_stale_sync_run_warning(sync_execution))
    if should_explain_active_scheduled_sync(
        sync_execution,
        pollers_by_name.get("scheduled-sync"),
    ):
        warnings.append(format_active_scheduled_sync_warning(sync_execution))
    return {
        "authority": "app-service-pollers",
        "contract_version": CONTROL_PLANE_CONTRACT_VERSION,
        "entry_surface": dict(RUNTIME_QUERY_ENTRY_SURFACE),
        "observability_streams": list(RUNTIME_SCHEDULER_OBSERVABILITY_STREAMS),
        "jobs": jobs,
        "pollers": pollers,
        "legacy_pollers": legacy_pollers,
        "warnings": warnings,
        "report_delivery_upgrade_summary": serialize_report_delivery_upgrade_summary(
            upgrade_rows, upgrade_window_start_at
        ),
    }


def report_delivery_upgrade_table_exists() -> bool:
    row = fetch_one(
        "SELECT to_regclass(%s) AS relation_name",
        ("public.mart_daily_report_delivery_upgrades",),
    )
    return bool(row.get("relation_name"))


def serialize_queue_snapshot(
    status_row: dict[str, Any],
    job_delivery_row: dict[str, Any],
    subscriber_delivery_row: dict[str, Any],
    dead_letter_row: dict[str, Any],
    observed_at: datetime | None = None,
    sync_run_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    effective_observed_at = observed_at or datetime.now(timezone.utc)
    unresolved_dead_letter_count = normalize_int(
        dead_letter_row.get("unresolved_dead_letter_count")
    )
    latest_unresolved_age_hours = compute_age_hours(
        effective_observed_at, dead_letter_row.get("latest_unresolved_at")
    )
    dead_letter_summary = (
        {
            "unresolved_job_count": normalize_int(dead_letter_row.get("unresolved_job_count")),
            "unresolved_subscriber_count": normalize_int(
                dead_letter_row.get("unresolved_subscriber_count")
            ),
            "latest_unresolved_at": dead_letter_row.get("latest_unresolved_at"),
            "latest_unresolved_age_hours": latest_unresolved_age_hours,
            "stale": (
                latest_unresolved_age_hours >= ANALYSIS_DEAD_LETTER_STALE_AFTER_HOURS
                if latest_unresolved_age_hours is not None
                else None
            ),
            "latest_reason": summarize_detail_text(dead_letter_row.get("latest_reason")),
            "invalid_chatid_subscriber_count": normalize_int(
                dead_letter_row.get("invalid_chatid_subscriber_count")
            ),
            "subscriber_fanout_exhausted_job_count": normalize_int(
                dead_letter_row.get("subscriber_fanout_exhausted_job_count")
            ),
        }
        if unresolved_dead_letter_count > 0
        else None
    )
    if dead_letter_summary is not None:
        dead_letter_summary["residual_class"] = resolve_dead_letter_residual_class(
            dead_letter_summary
        )
    sync_execution = serialize_sync_execution_summary(sync_run_row)
    return {
        "entry_surface": dict(RUNTIME_QUERY_ENTRY_SURFACE),
        "observability_streams": list(RUNTIME_QUEUE_OBSERVABILITY_STREAMS),
        "analysis": {
            "pending_count": normalize_int(status_row.get("pending_count")),
            "running_count": normalize_int(status_row.get("running_count")),
            "completed_count": normalize_int(status_row.get("completed_count")),
            "failed_count": normalize_int(status_row.get("failed_count")),
            "job_delivery": {
                "pending_count": normalize_int(job_delivery_row.get("pending_count")),
                "retrying_count": normalize_int(job_delivery_row.get("retrying_count")),
                "abandoned_count": normalize_int(job_delivery_row.get("abandoned_count")),
            },
            "subscriber_delivery": {
                "pending_count": normalize_int(subscriber_delivery_row.get("pending_count")),
                "retrying_count": normalize_int(subscriber_delivery_row.get("retrying_count")),
                "abandoned_count": normalize_int(subscriber_delivery_row.get("abandoned_count")),
            },
            "unresolved_dead_letter_count": normalize_int(
                dead_letter_row.get("unresolved_dead_letter_count")
            ),
            "dead_letter_summary": dead_letter_summary,
        },
        "sync_execution": sync_execution,
    }


def serialize_semantic_quality_summary(
    summary_row: dict[str, Any],
    top_failure_rows: list[dict[str, Any]],
    top_analysis_framework_rows: list[dict[str, Any]],
    top_route_upgrade_rows: list[dict[str, Any]],
    window_hours: int,
    effective_occurred_after: str,
    effective_deploy_marker: str | None,
) -> dict[str, Any]:
    total_count = normalize_int(summary_row.get("total_count"))
    success_count = normalize_int(summary_row.get("success_count"))
    clarify_count = normalize_int(summary_row.get("clarify_count"))
    fallback_used_count = normalize_int(summary_row.get("fallback_used_count"))
    return {
        "entry_surface": dict(RUNTIME_QUERY_ENTRY_SURFACE),
        "observability_streams": list(RUNTIME_SEMANTIC_QUALITY_OBSERVABILITY_STREAMS),
        "window_hours": window_hours,
        "effective_occurred_after": effective_occurred_after,
        "effective_deploy_marker": effective_deploy_marker,
        "total_count": total_count,
        "success_count": success_count,
        "success_rate": normalize_rate(success_count, total_count),
        "clarify_count": clarify_count,
        "clarify_rate": normalize_rate(clarify_count, total_count),
        "fallback_used_count": fallback_used_count,
        "fallback_rate": normalize_rate(fallback_used_count, total_count),
        "latest_occurred_at": summary_row.get("latest_occurred_at"),
        "top_failure_classes": [
            {
                "failure_class": str(row.get("failure_class")),
                "count": normalize_int(row.get("count")),
            }
            for row in top_failure_rows
            if row.get("failure_class")
        ],
        "top_analysis_frameworks": [
            {
                "framework_id": str(row.get("analysis_framework_id")),
                "count": normalize_int(row.get("count")),
            }
            for row in top_analysis_framework_rows
            if row.get("analysis_framework_id")
        ],
        "top_route_upgrades": [
            {
                "upgrade_kind": str(row.get("route_upgrade_kind")),
                "count": normalize_int(row.get("count")),
            }
            for row in top_route_upgrade_rows
            if row.get("route_upgrade_kind")
        ],
        "optimization_backlog": build_semantic_optimization_backlog(top_failure_rows),
        "sample_candidates": build_semantic_sample_candidates(top_failure_rows),
    }


@app.get("/health")
def get_health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "hetang-query-api",
        "database_url_configured": bool(
            os.getenv("HETANG_QUERY_DATABASE_URL")
            or os.getenv("QUERY_DATABASE_URL")
            or os.getenv("DATABASE_URL")
            or os.getenv("HETANG_DATABASE_URL")
            or os.getenv("POSTGRES_DSN")
        ),
    }


@app.on_event("shutdown")
def shutdown_db_pool() -> None:
    close_db_connection_pool()


@app.get("/api/v1/kpi/daily")
def get_daily_kpi(
    store_name: str = Query(..., description="门店名称"),
    start_date: date = Query(..., description="开始日期，格式 YYYY-MM-DD"),
    end_date: date = Query(..., description="结束日期，格式 YYYY-MM-DD"),
) -> list[dict[str, Any]]:
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be greater than end_date")

    sql = """
        SELECT *
        FROM mv_store_manager_daily_kpi
        WHERE store_name = %s
          AND biz_date::date >= %s
          AND biz_date::date <= %s
        ORDER BY biz_date::date DESC;
    """

    try:
        return [make_json_safe(row) for row in fetch_rows(sql, (store_name, start_date, end_date))]
    except Exception as exc:
        raise_database_http_error("数据库查询失败，请稍后重试。", exc)


@app.get("/api/v1/store/review-7d")
def get_store_review_7d(
    store_name: str = Query(..., description="门店名称"),
) -> list[dict[str, Any]]:
    sql = """
        SELECT *
        FROM mv_store_review_7d
        WHERE store_name = %s
        ORDER BY window_end_biz_date DESC
        LIMIT 1;
    """
    try:
        return [make_json_safe(row) for row in fetch_rows(sql, (store_name,))]
    except Exception as exc:
        raise_database_http_error("查询 7 日复盘失败。", exc)


@app.get("/api/v1/store/summary-30d")
def get_store_summary_30d(
    store_name: str = Query(..., description="门店名称"),
) -> list[dict[str, Any]]:
    sql = """
        SELECT *
        FROM mv_store_summary_30d
        WHERE store_name = %s
        ORDER BY window_end_biz_date DESC
        LIMIT 1;
    """
    try:
        return [make_json_safe(row) for row in fetch_rows(sql, (store_name,))]
    except Exception as exc:
        raise_database_http_error("查询 30 日汇总失败。", exc)


@app.get("/api/v1/tech/profile-30d")
def get_tech_profile_30d(
    store_name: str = Query(..., description="门店名称"),
    limit: int = Query(10, ge=1, le=50, description="返回技师数量"),
) -> list[dict[str, Any]]:
    sql = """
        SELECT *
        FROM mv_tech_profile_30d
        WHERE store_name = %s
        ORDER BY window_end_biz_date DESC, total_clock_count_30d DESC, tech_name ASC
        LIMIT %s;
    """
    try:
        return [make_json_safe(row) for row in fetch_rows(sql, (store_name, limit))]
    except Exception as exc:
        raise_database_http_error("查询技师 30 日画像失败。", exc)


@app.get("/api/v1/runtime/scheduler")
def get_runtime_scheduler() -> dict[str, Any]:
    try:
        upgrade_window_start_at = (
            datetime.now(timezone.utc) - timedelta(days=7)
        ).isoformat().replace("+00:00", "Z")
        sync_run_stale_cutoff_at = (
            datetime.now(timezone.utc) - timedelta(hours=SYNC_RUN_STALE_AFTER_HOURS)
        ).isoformat().replace("+00:00", "Z")
        job_rows = fetch_rows(
            """
            SELECT job_type, MAX(ran_at) AS last_ran_at
            FROM scheduled_job_runs
            GROUP BY job_type
            ORDER BY job_type
            """
        )
        poller_rows = fetch_rows(
            """
            SELECT state_key, state_json
            FROM scheduled_job_state
            WHERE job_type = 'service-poller'
            ORDER BY state_key
            """
        )
        sync_run_row = fetch_one(
            """
            SELECT
              SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)::int AS running_count,
              SUM(CASE WHEN status = 'running' AND started_at < %s THEN 1 ELSE 0 END)::int AS stale_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'daily' THEN 1 ELSE 0 END)::int AS daily_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'daily' AND started_at < %s THEN 1 ELSE 0 END)::int AS stale_daily_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'backfill' THEN 1 ELSE 0 END)::int AS backfill_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'backfill' AND started_at < %s THEN 1 ELSE 0 END)::int AS stale_backfill_running_count,
              MAX(CASE WHEN status = 'running' THEN started_at ELSE NULL END) AS latest_started_at
            FROM sync_runs
            """,
            (
                sync_run_stale_cutoff_at,
                sync_run_stale_cutoff_at,
                sync_run_stale_cutoff_at,
            ),
        )
        if sync_run_row.get("latest_started_at"):
            sync_run_row["latest_age_hours"] = compute_age_hours(
                datetime.now(timezone.utc), sync_run_row.get("latest_started_at")
            )
        sync_run_row["stale_cutoff_at"] = sync_run_stale_cutoff_at
        upgrade_rows = (
            fetch_rows(
                """
                SELECT org_id, store_name, biz_date, alert_sent_at, upgraded_at
                FROM mart_daily_report_delivery_upgrades
                WHERE upgraded_at >= %s
                ORDER BY upgraded_at DESC, store_name ASC
                LIMIT 5
                """,
                (upgrade_window_start_at,),
            )
            if report_delivery_upgrade_table_exists()
            else []
        )
        return make_json_safe(
            serialize_scheduler_snapshot(
                job_rows,
                poller_rows,
                upgrade_rows,
                upgrade_window_start_at,
                sync_run_row,
            )
        )
    except Exception as exc:
        raise_database_http_error("查询调度状态失败。", exc)


@app.get("/api/v1/runtime/queues")
def get_runtime_queues() -> dict[str, Any]:
    try:
        sync_run_stale_cutoff_at = (
            datetime.now(timezone.utc) - timedelta(hours=SYNC_RUN_STALE_AFTER_HOURS)
        ).isoformat().replace("+00:00", "Z")
        status_row = fetch_one(
            """
            SELECT
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
              SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)::int AS running_count,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed_count,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed_count
            FROM analysis_jobs
            """
        )
        job_delivery_row = fetch_one(
            """
            SELECT
              SUM(
                CASE
                  WHEN delivered_at IS NULL
                   AND delivery_abandoned_at IS NULL
                   AND next_delivery_after IS NULL
                  THEN 1
                  ELSE 0
                END
              )::int AS pending_count,
              SUM(
                CASE
                  WHEN delivered_at IS NULL
                   AND delivery_abandoned_at IS NULL
                   AND next_delivery_after IS NOT NULL
                  THEN 1
                  ELSE 0
                END
              )::int AS retrying_count,
              SUM(CASE WHEN delivery_abandoned_at IS NOT NULL THEN 1 ELSE 0 END)::int AS abandoned_count
            FROM analysis_jobs
            WHERE status IN ('completed', 'failed')
              AND job_id NOT IN (
                SELECT job_id
                FROM analysis_job_subscribers
              )
            """
        )
        subscriber_delivery_row = fetch_one(
            """
            SELECT
              SUM(
                CASE
                  WHEN delivered_at IS NULL
                   AND delivery_abandoned_at IS NULL
                   AND next_delivery_after IS NULL
                  THEN 1
                  ELSE 0
                END
              )::int AS pending_count,
              SUM(
                CASE
                  WHEN delivered_at IS NULL
                   AND delivery_abandoned_at IS NULL
                   AND next_delivery_after IS NOT NULL
                  THEN 1
                  ELSE 0
                END
              )::int AS retrying_count,
              SUM(CASE WHEN delivery_abandoned_at IS NOT NULL THEN 1 ELSE 0 END)::int AS abandoned_count
            FROM analysis_job_subscribers
            """
        )
        dead_letter_row = fetch_one(
            """
            WITH unresolved AS (
              SELECT dead_letter_key, dead_letter_scope, created_at, reason
              FROM analysis_dead_letters
              WHERE resolved_at IS NULL
            ),
            latest AS (
              SELECT created_at, reason
              FROM unresolved
              ORDER BY
                created_at DESC,
                CASE WHEN dead_letter_scope = 'subscriber' THEN 0 ELSE 1 END ASC,
                dead_letter_key DESC
              LIMIT 1
            )
            SELECT
              COUNT(*)::int AS unresolved_dead_letter_count,
              SUM(
                CASE WHEN dead_letter_scope = 'job' THEN 1 ELSE 0 END
              )::int AS unresolved_job_count,
              SUM(
                CASE WHEN dead_letter_scope = 'subscriber' THEN 1 ELSE 0 END
              )::int AS unresolved_subscriber_count,
              SUM(
                CASE
                  WHEN dead_letter_scope = 'subscriber'
                    AND LOWER(reason) LIKE '%%invalid chatid%%'
                  THEN 1
                  ELSE 0
                END
              )::int AS invalid_chatid_subscriber_count,
              SUM(
                CASE
                  WHEN dead_letter_scope = 'job'
                    AND reason = 'delivery abandoned after subscriber fan-out exhaustion'
                  THEN 1
                  ELSE 0
                END
              )::int AS subscriber_fanout_exhausted_job_count,
              (SELECT created_at FROM latest) AS latest_unresolved_at,
              (SELECT reason FROM latest) AS latest_reason
            FROM unresolved
            """
        )
        sync_run_row = fetch_one(
            """
            SELECT
              SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)::int AS running_count,
              SUM(CASE WHEN status = 'running' AND started_at < %s THEN 1 ELSE 0 END)::int AS stale_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'daily' THEN 1 ELSE 0 END)::int AS daily_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'daily' AND started_at < %s THEN 1 ELSE 0 END)::int AS stale_daily_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'backfill' THEN 1 ELSE 0 END)::int AS backfill_running_count,
              SUM(CASE WHEN status = 'running' AND mode = 'backfill' AND started_at < %s THEN 1 ELSE 0 END)::int AS stale_backfill_running_count,
              MAX(CASE WHEN status = 'running' THEN started_at ELSE NULL END) AS latest_started_at
            FROM sync_runs
            """,
            (
                sync_run_stale_cutoff_at,
                sync_run_stale_cutoff_at,
                sync_run_stale_cutoff_at,
            ),
        )
        if sync_run_row.get("latest_started_at"):
            sync_run_row["latest_age_hours"] = compute_age_hours(
                datetime.now(timezone.utc), sync_run_row.get("latest_started_at")
            )
        sync_run_row["stale_cutoff_at"] = sync_run_stale_cutoff_at
        return make_json_safe(
            serialize_queue_snapshot(
                status_row,
                job_delivery_row,
                subscriber_delivery_row,
                dead_letter_row,
                datetime.now(timezone.utc),
                sync_run_row,
            )
        )
    except Exception as exc:
        raise_database_http_error("查询队列状态失败。", exc)


@app.get("/api/v1/runtime/semantic-quality")
def get_runtime_semantic_quality(
    window_hours: int = Query(24, ge=1, le=24 * 7, description="统计窗口小时数"),
    limit: int = Query(5, ge=1, le=20, description="Top 项限制"),
    occurred_after: str | None = Query(
        None,
        description="可选的 ISO 时间下界；如果提供，会与 window_hours 共同决定有效过滤下界",
    ),
    deploy_marker: str | None = Query(
        None,
        description="可选的发布批次标记；如果提供，只统计该 deploy_marker 下的语义审计",
    ),
) -> dict[str, Any]:
    try:
        since = resolve_semantic_quality_lower_bound(window_hours, occurred_after)
        effective_deploy_marker = (
            deploy_marker.strip()
            if isinstance(deploy_marker, str) and deploy_marker.strip()
            else None
        )
        where_clause = "occurred_at >= %s"
        where_params: list[object] = [since]
        if effective_deploy_marker:
            where_clause += " AND deploy_marker = %s"
            where_params.append(effective_deploy_marker)
        summary_row = fetch_one(
            f"""
            SELECT
              COUNT(*)::int AS total_count,
              COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END), 0)::int AS success_count,
              COALESCE(SUM(CASE WHEN clarification_needed THEN 1 ELSE 0 END), 0)::int AS clarify_count,
              COALESCE(SUM(CASE WHEN fallback_used THEN 1 ELSE 0 END), 0)::int AS fallback_used_count,
              MAX(occurred_at) AS latest_occurred_at
            FROM semantic_execution_audits
            WHERE {where_clause}
            """,
            tuple(where_params),
        )
        top_failure_rows = fetch_rows(
            f"""
            SELECT failure_class, COUNT(*)::int AS count
            FROM semantic_execution_audits
            WHERE {where_clause}
              AND failure_class IS NOT NULL
            GROUP BY failure_class
            ORDER BY count DESC, failure_class ASC
            LIMIT %s
            """,
            tuple([*where_params, limit]),
        )
        top_analysis_framework_rows = fetch_rows(
            f"""
            SELECT analysis_framework_id, COUNT(*)::int AS count
            FROM semantic_execution_audits
            WHERE {where_clause}
              AND analysis_framework_id IS NOT NULL
            GROUP BY analysis_framework_id
            ORDER BY count DESC, analysis_framework_id ASC
            LIMIT %s
            """,
            tuple([*where_params, limit]),
        )
        top_route_upgrade_rows = fetch_rows(
            f"""
            SELECT route_upgrade_kind, COUNT(*)::int AS count
            FROM semantic_execution_audits
            WHERE {where_clause}
              AND route_upgrade_kind IS NOT NULL
            GROUP BY route_upgrade_kind
            ORDER BY count DESC, route_upgrade_kind ASC
            LIMIT %s
            """,
            tuple([*where_params, limit]),
        )
        return make_json_safe(
            serialize_semantic_quality_summary(
                summary_row,
                top_failure_rows,
                top_analysis_framework_rows,
                top_route_upgrade_rows,
                window_hours,
                since,
                effective_deploy_marker,
            )
        )
    except Exception as exc:
        raise_database_http_error("查询语义质量状态失败。", exc)


@app.get("/api/v1/runtime/data-freshness")
def get_runtime_data_freshness() -> dict[str, Any]:
    try:
        rows = fetch_rows(
            """
            SELECT org_id, endpoint, last_success_at
            FROM endpoint_watermarks
            ORDER BY org_id, endpoint
            """
        )
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            org_id = str(row.get("org_id"))
            entry = grouped.setdefault(
                org_id,
                {
                    "org_id": org_id,
                    "endpoints": {},
                },
            )
            entry["endpoints"][str(row.get("endpoint"))] = row.get("last_success_at")
        return make_json_safe(
            {
                "org_count": len(grouped),
                "stores": list(grouped.values()),
            }
        )
    except Exception as exc:
        raise_database_http_error("查询数据新鲜度失败。", exc)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
