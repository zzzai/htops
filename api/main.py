from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import json
import os
from typing import Any, Iterable

from fastapi import FastAPI, HTTPException, Query
import psycopg2
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor


app = FastAPI(title="Hetang Query API", version="2.0.0")
_connection_pool: pg_pool.SimpleConnectionPool | None = None

AUTHORITATIVE_SCHEDULER_JOBS: list[dict[str, str]] = [
    {
        "job_type": "sync",
        "label": "夜间同步",
        "orchestrator": "sync",
    },
    {
        "job_type": "run-customer-history-catchup",
        "label": "顾客历史补齐",
        "orchestrator": "sync",
    },
    {
        "job_type": "build-report",
        "label": "日报构建",
        "orchestrator": "sync",
    },
    {
        "job_type": "build-external-brief",
        "label": "外部情报简报",
        "orchestrator": "sync",
    },
    {
        "job_type": "send-report",
        "label": "日报投递",
        "orchestrator": "delivery",
    },
    {
        "job_type": "send-midday-brief",
        "label": "午报投递",
        "orchestrator": "delivery",
    },
    {
        "job_type": "send-reactivation-push",
        "label": "唤回推送",
        "orchestrator": "delivery",
    },
]


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
) -> dict[str, Any]:
    last_run_map = {
        str(row.get("job_type")): row.get("last_ran_at")
        for row in job_rows
        if row.get("job_type")
    }
    pollers = []
    for row in poller_rows:
        state = normalize_object(row.get("state_json"))
        pollers.append(
            {
                "poller": state.get("poller") or row.get("state_key"),
                "status": state.get("status"),
                "last_run_at": state.get("lastRunAt"),
                "last_success_at": state.get("lastSuccessAt"),
                "last_failure_at": state.get("lastFailureAt"),
                "last_duration_ms": state.get("lastDurationMs"),
                "last_result_count": state.get("lastResultCount"),
                "last_error": state.get("lastError"),
            }
        )
    jobs = [
        {
            **entry,
            "last_ran_at": last_run_map.get(entry["job_type"]),
        }
        for entry in AUTHORITATIVE_SCHEDULER_JOBS
    ]
    return {
        "authority": "app-service-pollers",
        "jobs": jobs,
        "pollers": pollers,
    }


def serialize_queue_snapshot(
    status_row: dict[str, Any],
    job_delivery_row: dict[str, Any],
    subscriber_delivery_row: dict[str, Any],
    dead_letter_row: dict[str, Any],
) -> dict[str, Any]:
    return {
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
        }
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
        return make_json_safe(serialize_scheduler_snapshot(job_rows, poller_rows))
    except Exception as exc:
        raise_database_http_error("查询调度状态失败。", exc)


@app.get("/api/v1/runtime/queues")
def get_runtime_queues() -> dict[str, Any]:
    try:
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
            SELECT COUNT(*)::int AS unresolved_dead_letter_count
            FROM analysis_dead_letters
            WHERE resolved_at IS NULL
            """
        )
        return make_json_safe(
            serialize_queue_snapshot(
                status_row,
                job_delivery_row,
                subscriber_delivery_row,
                dead_letter_row,
            )
        )
    except Exception as exc:
        raise_database_http_error("查询队列状态失败。", exc)


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
