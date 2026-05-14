from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import base64
import binascii
import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any, Iterable
import urllib.error
import urllib.request

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
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
_SUPPORTED_PERSONAL_KNOWLEDGE_DOMAINS = {"brand", "marketing", "management", "book", "hxy"}
_SUPPORTED_PERSONAL_KNOWLEDGE_UPLOAD_EXTENSIONS = {
    ".pdf",
    ".epub",
    ".txt",
    ".md",
    ".markdown",
    ".docx",
    ".html",
    ".htm",
    ".pptx",
}
_PERSONAL_KNOWLEDGE_STOPWORDS = {
    "一个",
    "什么",
    "如何",
    "怎么",
    "怎样",
    "是否",
    "可以",
    "应该",
    "需要",
    "通过",
    "进行",
    "这个",
    "那个",
    "以及",
    "如果",
    "我们",
    "你们",
    "他们",
    "门店",
    "品牌",
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "your",
    "you",
    "are",
    "how",
    "what",
    "why",
}
_PERSONAL_KNOWLEDGE_LLM_TIMEOUT_SECONDS = 45


class PersonalKnowledgeChatRequest(BaseModel):
    question: str
    domain: str = "brand"
    top_k: int = 6


class PersonalKnowledgeUploadRequest(BaseModel):
    domain: str = "brand"
    file_name: str
    content_base64: str


class PersonalKnowledgeExportRequest(BaseModel):
    domain: str = "brand"
    question: str
    answer: str
    citations: list[dict[str, Any]] = []


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


def get_htops_root_dir() -> Path:
    return Path(os.getenv("HETANG_ROOT_DIR") or os.getenv("HTOPS_ROOT_DIR") or Path(__file__).resolve().parent.parent)


def resolve_personal_knowledge_domain(domain: str | None) -> str:
    normalized = (domain or "brand").strip().lower()
    if normalized not in _SUPPORTED_PERSONAL_KNOWLEDGE_DOMAINS:
        raise HTTPException(status_code=400, detail="unsupported knowledge domain")
    return normalized


def sanitize_personal_knowledge_file_name(file_name: str) -> str:
    candidate = Path(file_name).name.strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="file_name is required")
    candidate = re.sub(r"[\x00-\x1f]+", "", candidate).strip()
    if not candidate or candidate in {".", ".."}:
        raise HTTPException(status_code=400, detail="invalid file_name")
    extension = Path(candidate).suffix.lower()
    if extension not in _SUPPORTED_PERSONAL_KNOWLEDGE_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="unsupported file type")
    return candidate


def get_personal_knowledge_index_path(domain: str) -> Path:
    override = os.getenv(f"HETANG_PERSONAL_KNOWLEDGE_{domain.upper()}_INDEX")
    if override and override.strip():
        return Path(override.strip())
    return get_htops_root_dir() / "knowledge" / domain / "index.json"


def get_personal_knowledge_raw_dir(domain: str) -> Path:
    return get_htops_root_dir() / "knowledge" / domain / "raw"


def write_uploaded_personal_knowledge_file(
    domain: str,
    request: PersonalKnowledgeUploadRequest,
) -> Path:
    resolved_domain = resolve_personal_knowledge_domain(domain or request.domain)
    file_name = sanitize_personal_knowledge_file_name(request.file_name)
    try:
        payload = base64.b64decode(request.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="content_base64 is invalid") from exc
    if not payload:
        raise HTTPException(status_code=400, detail="uploaded file is empty")
    if len(payload) > int(os.getenv("HETANG_PERSONAL_KNOWLEDGE_UPLOAD_MAX_BYTES", "52428800")):
        raise HTTPException(status_code=413, detail="uploaded file is too large")
    raw_dir = get_personal_knowledge_raw_dir(resolved_domain)
    raw_dir.mkdir(parents=True, exist_ok=True)
    target_path = raw_dir / file_name
    target_path.write_bytes(payload)
    return target_path


def extract_upload_text(file_path: Path) -> str:
    extension = file_path.suffix.lower()
    if extension == ".pdf":
      raise RuntimeError("pdf rebuild requires scripts/build-personal-knowledge-index.ts")
    return file_path.read_text(encoding="utf-8")


def build_personal_knowledge_index_command(domain: str) -> list[str]:
    resolved_domain = resolve_personal_knowledge_domain(domain)
    raw_dir = get_personal_knowledge_raw_dir(resolved_domain)
    index_path = get_personal_knowledge_index_path(resolved_domain)
    root_dir = get_htops_root_dir()
    script_path = root_dir / "scripts" / "build-personal-knowledge-index.ts"
    if not script_path.exists():
        raise FileNotFoundError(str(script_path))
    node_bin = resolve_personal_knowledge_node_bin()
    return [
        node_bin,
        "--import",
        "tsx",
        str(script_path),
        "--domain",
        resolved_domain,
        "--raw-dir",
        str(raw_dir),
        "--output",
        str(index_path),
    ]


def resolve_personal_knowledge_node_bin() -> str:
    explicit_node_bin = os.getenv("HETANG_PERSONAL_KNOWLEDGE_NODE_BIN", "").strip()
    if explicit_node_bin:
        return explicit_node_bin
    node_bin = os.getenv("HETANG_NODE_BIN", "").strip()
    if node_bin and (Path(node_bin).is_absolute() and Path(node_bin).exists() or not Path(node_bin).is_absolute()):
        return node_bin
    return "node"


def rebuild_personal_knowledge_index_with_typescript(domain: str) -> dict[str, Any]:
    resolved_domain = resolve_personal_knowledge_domain(domain)
    raw_dir = get_personal_knowledge_raw_dir(resolved_domain)
    index_path = get_personal_knowledge_index_path(resolved_domain)
    raw_dir.mkdir(parents=True, exist_ok=True)
    command = build_personal_knowledge_index_command(resolved_domain)
    try:
        completed = subprocess.run(
            command,
            cwd=str(get_htops_root_dir()),
            capture_output=True,
            text=True,
            check=True,
            timeout=int(os.getenv("HETANG_PERSONAL_KNOWLEDGE_REBUILD_TIMEOUT_SECONDS", "600")),
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"knowledge index rebuild failed: {(exc.stderr or exc.stdout or str(exc)).strip()}",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="knowledge index rebuild timed out") from exc
    index_payload = load_personal_knowledge_index(resolved_domain) if index_path.exists() else {}
    sources = index_payload.get("sources")
    chunks = index_payload.get("chunks")
    skipped_files = index_payload.get("skippedFiles")
    return {
        "domain": resolved_domain,
        "builder": "typescript",
        "source_count": len(sources) if isinstance(sources, list) else 0,
        "chunk_count": len(chunks) if isinstance(chunks, list) else 0,
        "skipped_count": len(skipped_files) if isinstance(skipped_files, list) else 0,
        "index_path": str(index_path),
        "stdout": completed.stdout.strip(),
    }


def rebuild_personal_knowledge_index_python_fallback(domain: str) -> dict[str, Any]:
    resolved_domain = resolve_personal_knowledge_domain(domain)
    raw_dir = get_personal_knowledge_raw_dir(resolved_domain)
    index_path = get_personal_knowledge_index_path(resolved_domain)
    raw_dir.mkdir(parents=True, exist_ok=True)
    sources: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []
    skipped_files: list[dict[str, Any]] = []
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    root_dir = get_htops_root_dir()
    for file_path in sorted(raw_dir.iterdir(), key=lambda path: path.name):
        if not file_path.is_file() and not file_path.is_symlink():
            continue
        if file_path.suffix.lower() not in _SUPPORTED_PERSONAL_KNOWLEDGE_UPLOAD_EXTENSIONS:
            skipped_files.append({"fileName": file_path.name, "reason": "unsupported_file_type"})
            continue
        try:
            text = extract_upload_text(file_path)
        except Exception:
            skipped_files.append({"fileName": file_path.name, "reason": "text_extraction_failed"})
            continue
        normalized_text = " ".join(text.split()).strip()
        if not normalized_text:
            skipped_files.append({"fileName": file_path.name, "reason": "empty_text"})
            continue
        stat = file_path.stat()
        relative_path = str(file_path.relative_to(root_dir))
        source_id = f"{resolved_domain}:{relative_path}:{stat.st_size}"
        title = file_path.stem.replace("_", " ").strip()
        sources.append(
            {
                "sourceId": source_id,
                "domain": resolved_domain,
                "title": title,
                "relativePath": relative_path,
                "fileName": file_path.name,
                "fileSize": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            }
        )
        chunk_size = 1200
        overlap = 160
        start = 0
        chunk_index = 0
        while start < len(normalized_text):
            end = min(start + chunk_size, len(normalized_text))
            chunk_text = normalized_text[start:end].strip()
            if chunk_text:
                chunks.append(
                    {
                        "chunkId": f"{source_id}:{chunk_index}",
                        "sourceId": source_id,
                        "domain": resolved_domain,
                        "title": title,
                        "relativePath": relative_path,
                        "chunkIndex": chunk_index,
                        "text": chunk_text,
                        "keywords": extract_personal_knowledge_keywords(f"{title} {chunk_text}"),
                    }
                )
                chunk_index += 1
            if end >= len(normalized_text):
                break
            start = max(end - overlap, start + 1)
    index_payload = {
        "version": "personal-knowledge-index.v1",
        "generatedAt": generated_at,
        "rootDir": str(root_dir),
        "rawDir": str(raw_dir),
        "domains": [resolved_domain],
        "sources": sources,
        "chunks": chunks,
        "skippedFiles": skipped_files,
    }
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "domain": resolved_domain,
        "builder": "python-fallback",
        "source_count": len(sources),
        "chunk_count": len(chunks),
        "skipped_count": len(skipped_files),
        "index_path": str(index_path),
    }


def rebuild_personal_knowledge_index(domain: str) -> dict[str, Any]:
    try:
        return rebuild_personal_knowledge_index_with_typescript(domain)
    except FileNotFoundError:
        return rebuild_personal_knowledge_index_python_fallback(domain)


def load_personal_knowledge_index(domain: str) -> dict[str, Any]:
    index_path = get_personal_knowledge_index_path(domain)
    if not index_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"knowledge index not found for domain={domain}; run scripts/build-personal-knowledge-index.ts first",
        )
    try:
        with index_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="failed to load knowledge index") from exc
    return payload if isinstance(payload, dict) else {}


def load_json_file_if_exists(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def get_hxy_structured_dir(root_dir: Path | None = None) -> Path:
    resolved_root = root_dir or get_htops_root_dir()
    return resolved_root / "knowledge" / "hxy" / "structured"


def build_hxy_project_brain_context_results(root_dir: Path | None = None) -> list[dict[str, Any]]:
    structured_dir = get_hxy_structured_dir(root_dir)
    results: list[dict[str, Any]] = []
    master_plan = load_json_file_if_exists(structured_dir / "brand-master-plan.json")
    if master_plan:
        sections = master_plan.get("sections")
        section_text = ""
        if isinstance(sections, list):
            section_lines: list[str] = []
            for section in sections[:7]:
                if not isinstance(section, dict):
                    continue
                content = section.get("content")
                content_text = "；".join(str(item) for item in content[:4]) if isinstance(content, list) else ""
                section_lines.append(f"{section.get('title') or section.get('key')}: {content_text}")
            section_text = "\n".join(section_lines)
        methodology = master_plan.get("methodology_principles")
        methodology_text = ""
        if isinstance(methodology, list):
            methodology_text = "\n".join(
                f"{item.get('label')}: {item.get('application')}"
                for item in methodology[:4]
                if isinstance(item, dict)
            )
        risks = master_plan.get("risks")
        risk_text = "\n".join(str(item) for item in risks[:3]) if isinstance(risks, list) else ""
        results.append(
            {
                "sourceId": "hxy-brand-master-plan",
                "domain": "hxy",
                "title": "HXY 品牌策划全案 v1",
                "relativePath": "knowledge/hxy/structured/brand-master-plan.json",
                "chunkIndex": 0,
                "score": 1000,
                "text": "\n".join(
                    item
                    for item in [
                        str(master_plan.get("executive_summary") or ""),
                        methodology_text,
                        section_text,
                        risk_text,
                    ]
                    if item
                ),
            }
        )
    execution_playbook = load_json_file_if_exists(structured_dir / "execution-playbook.json")
    if execution_playbook:
        surface_lines: list[str] = []
        surfaces = execution_playbook.get("surfaces")
        if isinstance(surfaces, list):
            for surface in surfaces[:4]:
                if not isinstance(surface, dict):
                    continue
                copy_blocks = surface.get("copy_blocks")
                copy_text = "、".join(str(item) for item in copy_blocks[:4]) if isinstance(copy_blocks, list) else ""
                action_steps = surface.get("action_steps")
                action_text = "；".join(str(item) for item in action_steps[:3]) if isinstance(action_steps, list) else ""
                do_not_say = surface.get("do_not_say")
                do_not_say_text = "；".join(str(item) for item in do_not_say[:3]) if isinstance(do_not_say, list) else ""
                surface_lines.append(
                    f"{surface.get('label') or surface.get('key')}: 目标：{surface.get('objective') or ''} 文案：{copy_text} 动作：{action_text} 禁用：{do_not_say_text}"
                )
        results.append(
            {
                "sourceId": "hxy-execution-playbook",
                "domain": "hxy",
                "title": "HXY 终端执行手册 v1",
                "relativePath": "knowledge/hxy/structured/execution-playbook.json",
                "chunkIndex": 0,
                "score": 995,
                "text": "\n".join(
                    item
                    for item in [
                        str(execution_playbook.get("positioning_guardrail") or ""),
                        "\n".join(surface_lines),
                    ]
                    if item
                ),
            }
        )
    store_model = load_json_file_if_exists(structured_dir / "store-model.json")
    if store_model:
        caveats = store_model.get("caveats")
        caveat_text = "；".join(str(item) for item in caveats[:3]) if isinstance(caveats, list) else ""
        results.append(
            {
                "sourceId": "hxy-store-model",
                "domain": "hxy",
                "title": "HXY 小店模型 v1",
                "relativePath": "knowledge/hxy/structured/store-model.json",
                "chunkIndex": 0,
                "score": 992,
                "text": "\n".join(
                    [
                        f"月总营收：{store_model.get('monthly_revenue')}",
                        f"月净现金流：{store_model.get('monthly_net_cashflow')}",
                        f"回本周期：{store_model.get('payback_months')}",
                        f"边界：{caveat_text}",
                    ]
                ),
            }
        )
    validation_matrix = load_json_file_if_exists(structured_dir / "pilot-validation-matrix.json")
    if validation_matrix:
        item_lines: list[str] = []
        items = validation_matrix.get("items")
        if isinstance(items, list):
            for item in items[:7]:
                if not isinstance(item, dict):
                    continue
                item_lines.append(
                    f"{item.get('label') or item.get('key')}: 假设：{item.get('hypothesis') or ''} 证据：{item.get('evidence_source') or ''}"
                )
        results.append(
            {
                "sourceId": "hxy-pilot-validation-matrix",
                "domain": "hxy",
                "title": "HXY 样板验证矩阵 v1",
                "relativePath": "knowledge/hxy/structured/pilot-validation-matrix.json",
                "chunkIndex": 0,
                "score": 991,
                "text": "\n".join(item_lines),
            }
        )
    osi_contract = load_json_file_if_exists(structured_dir / "osi-contract.json")
    if osi_contract:
        domains = osi_contract.get("domains")
        domain_lines: list[str] = []
        if isinstance(domains, list):
            for domain in domains[:5]:
                if not isinstance(domain, dict):
                    continue
                boundaries = domain.get("answer_boundaries")
                boundary_text = "；".join(str(item) for item in boundaries[:3]) if isinstance(boundaries, list) else ""
                metrics = domain.get("validation_metrics")
                metric_text = "、".join(str(item.get("label") or item.get("key")) for item in metrics[:4] if isinstance(item, dict)) if isinstance(metrics, list) else ""
                domain_lines.append(
                    f"{domain.get('label') or domain.get('domain')}: {domain.get('purpose') or ''} 边界：{boundary_text} 验证：{metric_text}"
                )
        results.append(
            {
                "sourceId": "hxy-osi-contract",
                "domain": "hxy",
                "title": "HXY OSI 合同 v1",
                "relativePath": "knowledge/hxy/structured/osi-contract.json",
                "chunkIndex": 0,
                "score": 990,
                "text": "\n".join(domain_lines),
            }
        )
    return results


def extract_personal_knowledge_keywords(value: str) -> list[str]:
    normalized = value.lower()
    tokens: set[str] = set()
    for token in re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9-]{2,}", normalized):
        if token in _PERSONAL_KNOWLEDGE_STOPWORDS:
            continue
        if re.fullmatch(r"[\u4e00-\u9fff]+", token):
            tokens.add(token)
            for index in range(0, max(len(token) - 1, 0)):
                bigram = token[index : index + 2]
                if bigram and bigram not in _PERSONAL_KNOWLEDGE_STOPWORDS:
                    tokens.add(bigram)
        else:
            tokens.add(token)
    return list(tokens)


def search_personal_knowledge_index(
    index_payload: dict[str, Any],
    question: str,
    domain: str,
    top_k: int = 6,
) -> list[dict[str, Any]]:
    query_keywords = set(extract_personal_knowledge_keywords(question))
    if not query_keywords:
        return []
    scored: list[dict[str, Any]] = []
    chunks = index_payload.get("chunks")
    if not isinstance(chunks, list):
        return []
    for raw_chunk in chunks:
        if not isinstance(raw_chunk, dict):
            continue
        if str(raw_chunk.get("domain")) != domain:
            continue
        chunk_keywords = set(str(keyword) for keyword in raw_chunk.get("keywords", []))
        title = str(raw_chunk.get("title") or "")
        score = 0
        for keyword in query_keywords:
            if keyword in chunk_keywords:
                score += 2 if len(keyword) >= 3 else 1
            if keyword and keyword in title:
                score += 1
        if score <= 0:
            continue
        if domain == "brand":
            score += score_brand_knowledge_chunk(title, str(raw_chunk.get("text") or ""), chunk_keywords, query_keywords)
        scored.append(
            {
                "sourceId": raw_chunk.get("sourceId"),
                "domain": domain,
                "title": title,
                "relativePath": raw_chunk.get("relativePath"),
                "chunkIndex": normalize_int(raw_chunk.get("chunkIndex")),
                "score": score,
                "text": str(raw_chunk.get("text") or ""),
            }
        )
    scored.sort(key=lambda item: (-normalize_int(item.get("score")), normalize_int(item.get("chunkIndex"))))
    return scored[: max(1, min(top_k, 12))]


def should_merge_brand_theory_for_hxy(question: str) -> bool:
    terms = [
        "华与华",
        "品牌策划",
        "品牌战略",
        "品牌定位",
        "超级符号",
        "购买理由",
        "品牌承诺",
        "口号",
        "slogan",
        "终端",
        "传播成本",
    ]
    return any(term.lower() in question.lower() for term in terms)


def build_cross_domain_personal_knowledge_results(
    domain: str,
    question: str,
    top_k: int,
    load_index: Any = load_personal_knowledge_index,
) -> list[dict[str, Any]]:
    resolved_domain = resolve_personal_knowledge_domain(domain)
    primary_index = load_index(resolved_domain)
    primary_results = search_personal_knowledge_index(
        primary_index,
        question,
        resolved_domain,
        max(3, min(top_k, 8)),
    )
    if resolved_domain != "hxy" or not should_merge_brand_theory_for_hxy(question):
        return primary_results[: max(1, min(top_k, 12))]

    try:
        brand_index = load_index("brand")
    except HTTPException:
        return primary_results[: max(1, min(top_k, 12))]
    brand_results = search_personal_knowledge_index(
        brand_index,
        build_brand_knowledge_search_query(question),
        "brand",
        max(2, min(top_k, 6)),
    )
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for result in [*primary_results[: max(2, top_k // 2)], *brand_results, *primary_results]:
        key = (str(result.get("sourceId") or ""), normalize_int(result.get("chunkIndex")))
        if key in seen:
            continue
        seen.add(key)
        merged.append(result)
        if len(merged) >= max(1, min(top_k, 12)):
            break
    return merged


def prepend_hxy_project_brain_context(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for result in [*build_hxy_project_brain_context_results(), *results]:
        key = (str(result.get("sourceId") or ""), normalize_int(result.get("chunkIndex")))
        if key in seen:
            continue
        seen.add(key)
        merged.append(result)
    return merged


def score_brand_knowledge_chunk(
    title: str,
    text: str,
    chunk_keywords: set[str],
    query_keywords: set[str],
) -> int:
    bonus = 0
    method_title_terms = ["方法", "原理", "使用说明书", "品牌的起源", "定位"]
    case_title_terms = ["案例集"]
    if any(term in title for term in method_title_terms):
        bonus += 6
    if any(term in title for term in case_title_terms):
        bonus -= 3
    strong_terms = [
        "购买理由",
        "品牌承诺",
        "超级符号",
        "传播成本",
        "交易成本",
        "终端",
        "定位",
        "品牌资产",
    ]
    for term in strong_terms:
        if term in text or term in chunk_keywords:
            bonus += 2
    if "品牌策划" in query_keywords and ("方法" in title or "原理" in title):
        bonus += 4
    return bonus


def render_personal_knowledge_chat(
    question: str,
    domain: str,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    citations = [
        {
            "sourceId": result.get("sourceId"),
            "title": result.get("title"),
            "relativePath": result.get("relativePath"),
            "chunkIndex": result.get("chunkIndex"),
            "score": result.get("score"),
            "snippet": str(result.get("text") or "")[:180],
        }
        for result in results[:5]
    ]
    if not citations:
        return {
            "answer": "\n".join(
                [
                    f"当前 {domain} 书库没有检索到足够依据。",
                    "建议先补充对应书籍，或把问题拆成更明确的概念、场景、动作目标。",
                ]
            ),
            "citations": [],
        }
    evidence_lines = [
        f"{index + 1}. 《{result.get('title')}》相关片段提示：{str(result.get('text') or '')[:120]}"
        for index, result in enumerate(results[:3])
    ]
    return {
        "answer": "\n".join(
            [
                f"基于 {domain} 书库，当前问题可以先按“方法论 -> 场景 -> 动作 -> 反馈”处理。",
                "",
                "可执行建议：",
                *evidence_lines,
                "",
                "落地时不要只复述书中概念，要把它转成目标客群、触点、话术、活动机制和验证指标。",
            ]
        ),
        "citations": citations,
    }


def render_brand_knowledge_chat(
    question: str,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    citations = [
        {
            "sourceId": result.get("sourceId"),
            "title": result.get("title"),
            "relativePath": result.get("relativePath"),
            "chunkIndex": result.get("chunkIndex"),
            "score": result.get("score"),
            "snippet": str(result.get("text") or "")[:180],
        }
        for result in results[:5]
    ]
    if not citations:
        return {
            "answer": "\n".join(
                [
                    "当前 brand 书库没有检索到足够书籍依据。",
                    "本入口只做“基于书籍引用回答”，所以不会凭空生成品牌策划结论。",
                    "请先把华与华、品牌策划相关书籍放入 knowledge/brand/raw，并重建索引。",
                ]
            ),
            "citations": [],
        }

    evidence_lines = [
        f"{index + 1}. 《{result.get('title')}》：{str(result.get('text') or '')[:130]}"
        for index, result in enumerate(results[:3])
    ]
    citation_lines = [
        f"[{index + 1}] 《{citation.get('title')}》 chunk {citation.get('chunkIndex')} · {citation.get('relativePath')}"
        for index, citation in enumerate(citations)
    ]
    return {
        "answer": "\n".join(
            [
                "品牌策划回答（基于本地书籍引用）",
                f"问题：{question}",
                "",
                "一、书籍依据",
                *evidence_lines,
                "",
                "二、可落地策划框架",
                "1. 先提炼品牌承诺：用一句顾客能复述的话说明“为什么选荷塘悦色”。",
                "2. 再确定超级符号：把品牌承诺落到门头、空间、员工动作、话术、团购页面和私域触达。",
                "3. 然后设计购买理由：围绕目标客群、核心场景、价格锚点、服务差异和复购理由展开。",
                "4. 最后接经营闭环：用到店客流、团购二访、储值转化、复购和口碑反馈验证策划是否有效。",
                "",
                "三、引用来源",
                *citation_lines,
            ]
        ),
        "citations": citations,
    }


def render_hxy_knowledge_chat(
    question: str,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    citations = [
        {
            "sourceId": result.get("sourceId"),
            "title": result.get("title"),
            "relativePath": result.get("relativePath"),
            "chunkIndex": result.get("chunkIndex"),
            "score": result.get("score"),
            "snippet": str(result.get("text") or "")[:180],
        }
        for result in results[:5]
    ]
    if not citations:
        return {
            "answer": "\n".join(
                [
                    "当前 hxy 项目知识库没有检索到足够依据。",
                    "请先生成 HXY 项目大脑资料，或补充 knowledge/hxy/raw 后重建索引。",
                ]
            ),
            "citations": [],
        }
    project_brain = next(
        (result for result in results if str(result.get("sourceId") or "").startswith("hxy-brand-master-plan")),
        results[0],
    )
    theory_titles = [
        f"《{result.get('title')}》"
        for result in results
        if str(result.get("domain") or "") == "brand"
    ][:3]
    return {
        "answer": "\n".join(
            [
                "HXY 项目大脑回答（项目知识 + 品牌理论引用）",
                f"问题：{question}",
                "",
                "一、项目大脑结论",
                str(project_brain.get("text") or "")[:700],
                "",
                "二、当前执行原则",
                "1. 当前经营先讲社区泡脚按摩小店，不把银发健康科技平台当前置主定位。",
                "2. 门头、菜单、技师话术、私域触达必须统一到购买理由和终端动作。",
                "3. 产品价格、单店财务、客群判断必须进入样板店验证。",
                "",
                "三、书籍/理论依据",
                "；".join(theory_titles) if theory_titles else "本次未合并到品牌理论书籍依据。",
            ]
        ),
        "citations": citations,
    }


def resolve_personal_knowledge_llm_config() -> dict[str, Any] | None:
    base_url = os.getenv("HETANG_PERSONAL_KNOWLEDGE_AI_BASE_URL", "").strip()
    api_key = os.getenv("HETANG_PERSONAL_KNOWLEDGE_AI_API_KEY", "").strip()
    model = os.getenv("HETANG_PERSONAL_KNOWLEDGE_AI_MODEL", "").strip()
    wire_api = os.getenv("HETANG_PERSONAL_KNOWLEDGE_AI_WIRE_API", "").strip()
    auth_type = os.getenv("HETANG_PERSONAL_KNOWLEDGE_AI_AUTH_TYPE", "").strip()
    effort_level = os.getenv("HETANG_PERSONAL_KNOWLEDGE_AI_EFFORT_LEVEL", "").strip()
    if not base_url or not api_key or not model:
        claude_config = load_claude_personal_knowledge_llm_config()
        base_url = base_url or str(claude_config.get("base_url") or "")
        api_key = api_key or str(claude_config.get("api_key") or "")
        model = model or str(claude_config.get("model") or "")
        wire_api = wire_api or str(claude_config.get("wire_api") or "")
        auth_type = auth_type or str(claude_config.get("auth_type") or "")
        effort_level = effort_level or str(claude_config.get("effort_level") or "")
    if not base_url or not api_key or not model:
        return None
    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "model": model,
        "wire_api": wire_api or "chat",
        "auth_type": auth_type or "bearer",
        "effort_level": effort_level,
        "timeout_seconds": int(
            os.getenv(
                "HETANG_PERSONAL_KNOWLEDGE_AI_TIMEOUT_SECONDS",
                str(_PERSONAL_KNOWLEDGE_LLM_TIMEOUT_SECONDS),
            )
        ),
    }


def load_claude_personal_knowledge_llm_config(
    claude_dir: Path | None = None,
) -> dict[str, Any]:
    resolved_claude_dir = claude_dir or Path(
        os.getenv("HETANG_PERSONAL_KNOWLEDGE_CLAUDE_DIR", "/root/.claude")
    )
    settings_path = resolved_claude_dir / "settings.json"
    if not settings_path.exists():
        return {}
    try:
        settings_payload = json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(settings_payload, dict):
        return {}
    env_payload = settings_payload.get("env")
    if not isinstance(env_payload, dict):
        env_payload = {}
    return {
        "base_url": str(env_payload.get("ANTHROPIC_BASE_URL") or "").strip(),
        "wire_api": "anthropic_messages",
        "model": normalize_claude_personal_knowledge_model(settings_payload.get("model")),
        "api_key": str(env_payload.get("ANTHROPIC_AUTH_TOKEN") or "").strip(),
        "auth_type": "bearer",
        "effort_level": str(settings_payload.get("effortLevel") or "").strip(),
    }


def normalize_claude_personal_knowledge_model(model: Any) -> str:
    model_name = str(model or "").strip()
    if model_name == "opus[1m]":
        return "claude-opus-4-6"
    if model_name.endswith("[1m]"):
        return model_name.removesuffix("[1m]")
    return model_name


def build_personal_knowledge_grounding_prompt(
    domain: str,
    question: str,
    results: list[dict[str, Any]],
) -> str:
    evidence_blocks = []
    for index, result in enumerate(results[:5], start=1):
        evidence_blocks.append(
            "\n".join(
                [
                    f"[{index}] 知识域：{result.get('domain') or domain}",
                    f"资料名：{result.get('title') or '未知资料'}",
                    f"路径：{result.get('relativePath') or '-'}",
                    f"chunk：{result.get('chunkIndex')}",
                    f"摘录：{str(result.get('text') or '')[:900]}",
                ]
            )
        )
    evidence_label = "项目结构化资产与书籍证据" if domain == "hxy" else "书籍证据"
    task_rules = [
        "1. 必须使用中文。",
        "2. 先给结论，再给可执行步骤。",
        "3. 不允许编造书外事实；证据不足时明确说明不足。",
        "4. 回答中用 [1] [2] 标注对应证据。",
    ]
    if domain == "hxy":
        task_rules.extend(
            [
                "5. 优先使用 HXY OSI、品牌全案、终端执行手册、小店模型和样板验证矩阵。",
                "6. 再用华与华/营销/管理书籍提升判断，不得让外部理论覆盖项目事实。",
                "7. 如果是落地问题，输出：核心判断、门店动作、数据/财务假设、样板店验证、风险边界。",
            ]
        )
    else:
        task_rules.append(
            "5. 如果是品牌策划问题，输出：核心判断、品牌承诺、购买理由、超级符号/终端动作、验证指标。"
        )
    return "\n\n".join(
        [
            f"知识域：{domain}",
            f"用户问题：{question}",
            f"{evidence_label}：",
            *evidence_blocks,
            "",
            f"请基于上述{evidence_label}回答。要求：",
            *task_rules,
        ]
    )


def extract_openai_chat_message(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""
    message = first_choice.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        return str(content).strip() if content else ""
    text = first_choice.get("text")
    return str(text).strip() if text else ""


def extract_openai_responses_message(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    output = payload.get("output")
    if not isinstance(output, list):
        return ""
    parts: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for content_item in content:
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
    return "\n".join(parts).strip()


def extract_anthropic_messages_text(payload: dict[str, Any]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            parts.append(text.strip())
    return "\n".join(parts).strip()


def build_personal_knowledge_llm_request(config: dict[str, Any], domain: str, question: str, results: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    wire_api = str(config.get("wire_api") or "chat").strip().lower()
    grounding_prompt = build_personal_knowledge_grounding_prompt(domain, question, results)
    if wire_api == "anthropic_messages":
        effort_level = str(config.get("effort_level") or "").strip()
        reasoning_line = (
            f"当前推理强度配置：{effort_level}。"
            if effort_level
            else "当前推理强度配置：默认。"
        )
        return (
            f"{config['base_url']}/v1/messages",
            {
                "model": config["model"],
                "max_tokens": 2200,
                "temperature": 0.2,
                "system": (
                    "你是个人知识助手。你必须结合模型的综合推理能力和用户提供的本地书籍证据作答，"
                    "保留 [1] [2] 这种引用编号；不要编造没有证据支撑的书籍内容。"
                    f"{reasoning_line}"
                ),
                "messages": [
                    {
                        "role": "user",
                        "content": grounding_prompt,
                    }
                ],
            },
        )
    if wire_api == "responses":
        return (
            f"{config['base_url']}/responses",
            {
                "model": config["model"],
                "reasoning": {"effort": "high"},
                "input": [
                    {
                        "role": "system",
                        "content": "你是个人知识助手，必须结合模型推理能力与用户提供的书籍证据作答，并保留引用编号。",
                    },
                    {
                        "role": "user",
                        "content": grounding_prompt,
                    },
                ],
            },
        )
    return (
        f"{config['base_url']}/chat/completions",
        {
            "model": config["model"],
            "temperature": 0.2,
            "messages": [
                {
                    "role": "system",
                    "content": "你是个人知识助手，只能基于用户提供的书籍证据回答，并必须保留引用编号。",
                },
                {
                    "role": "user",
                    "content": grounding_prompt,
                },
            ],
        },
    )


def build_personal_knowledge_llm_headers(config: dict[str, Any]) -> dict[str, str]:
    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {config['api_key']}",
    }
    if str(config.get("wire_api") or "").lower() == "anthropic_messages":
        headers["anthropic-version"] = "2023-06-01"
    return headers


def call_personal_knowledge_llm(
    domain: str,
    question: str,
    results: list[dict[str, Any]],
) -> str | None:
    config = resolve_personal_knowledge_llm_config()
    if config is None or not results:
        return None
    request_url, request_payload = build_personal_knowledge_llm_request(
        config, domain, question, results
    )
    request = urllib.request.Request(
        request_url,
        data=json.dumps(request_payload, ensure_ascii=False).encode("utf-8"),
        headers=build_personal_knowledge_llm_headers(config),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config["timeout_seconds"]) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    wire_api = str(config.get("wire_api") or "").lower()
    if wire_api == "responses":
        answer = extract_openai_responses_message(payload)
    elif wire_api == "anthropic_messages":
        answer = extract_anthropic_messages_text(payload)
    else:
        answer = extract_openai_chat_message(payload)
    return answer or None


def render_personal_knowledge_chat_with_llm(
    domain: str,
    question: str,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    template_payload = (
        render_brand_knowledge_chat(question, results)
        if domain == "brand"
        else render_hxy_knowledge_chat(question, results)
        if domain == "hxy"
        else render_personal_knowledge_chat(question, domain, results)
    )
    llm_answer = call_personal_knowledge_llm(domain, question, results)
    if not llm_answer:
        return {**template_payload, "answer_source": "template"}
    return {
        **template_payload,
        "answer": llm_answer,
        "answer_source": "llm",
    }


def build_brand_knowledge_search_query(question: str) -> str:
    expansion_terms = [
        "华与华",
        "超级符号",
        "品牌资产",
        "定位",
        "购买理由",
        "品牌承诺",
        "传播成本",
        "终端",
        "门头",
        "包装",
        "口号",
    ]
    normalized_question = question.strip()
    missing_terms = [term for term in expansion_terms if term not in normalized_question]
    return " ".join([normalized_question, *missing_terms]).strip()


def render_personal_knowledge_export_plan(
    domain: str,
    question: str,
    answer: str,
    citations: list[dict[str, Any]],
) -> dict[str, Any]:
    safe_domain = resolve_personal_knowledge_domain(domain)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    citation_lines = []
    for index, citation in enumerate(citations, start=1):
        citation_lines.append(
            f"{index}. 《{citation.get('title', '未知书籍')}》 chunk {citation.get('chunkIndex', '-')} · {citation.get('relativePath', '-')}"
        )
    markdown = "\n".join(
        [
            "# 荷塘个人知识助手导出",
            "",
            f"- 知识域：{safe_domain}",
            f"- 问题：{question}",
            f"- 导出时间：{timestamp}",
            "",
            "## 回答",
            "",
            answer.strip(),
            "",
            "## 引用来源",
            "",
            *(citation_lines or ["暂无引用"]),
            "",
        ]
    )
    return {
        "file_name": f"knowledge-{safe_domain}-{timestamp}.md",
        "markdown": markdown,
    }


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


@app.get("/", response_class=HTMLResponse)
def personal_knowledge_home() -> FileResponse:
    page_path = get_htops_root_dir() / "docs" / "personal-knowledge-chat.html"
    if not page_path.exists():
        raise HTTPException(status_code=404, detail="personal knowledge chat page not found")
    return FileResponse(page_path)


@app.get("/knowledge", response_class=HTMLResponse)
def personal_knowledge_chat_page() -> FileResponse:
    return personal_knowledge_home()


@app.on_event("shutdown")
def shutdown_db_pool() -> None:
    close_db_connection_pool()


@app.get("/api/v1/personal-knowledge/sources")
def get_personal_knowledge_sources(
    domain: str = Query("brand", description="Knowledge domain"),
) -> dict[str, Any]:
    resolved_domain = resolve_personal_knowledge_domain(domain)
    index_payload = load_personal_knowledge_index(resolved_domain)
    sources = index_payload.get("sources")
    chunks = index_payload.get("chunks")
    skipped_files = index_payload.get("skippedFiles")
    return make_json_safe(
        {
            "domain": resolved_domain,
            "generated_at": index_payload.get("generatedAt"),
            "source_count": len(sources) if isinstance(sources, list) else 0,
            "chunk_count": len(chunks) if isinstance(chunks, list) else 0,
            "skipped_count": len(skipped_files) if isinstance(skipped_files, list) else 0,
            "sources": sources if isinstance(sources, list) else [],
        }
    )


@app.post("/api/v1/personal-knowledge/chat")
def post_personal_knowledge_chat(request: PersonalKnowledgeChatRequest) -> dict[str, Any]:
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
    domain = resolve_personal_knowledge_domain(request.domain)
    index_payload = load_personal_knowledge_index(domain)
    if domain == "brand":
        results = search_personal_knowledge_index(
            index_payload,
            build_brand_knowledge_search_query(question),
            domain,
            request.top_k,
        )
    else:
        results = build_cross_domain_personal_knowledge_results(domain, question, request.top_k)
        if domain == "hxy":
            results = prepend_hxy_project_brain_context(results)
    rendered = render_personal_knowledge_chat_with_llm(domain, question, results)
    return make_json_safe(
        {
            "ok": True,
            "domain": domain,
            "question": question,
            "answer": rendered["answer"],
            "answer_source": rendered.get("answer_source", "template"),
            "citations": rendered["citations"],
            "index_generated_at": index_payload.get("generatedAt"),
        }
    )


@app.post("/api/v1/personal-knowledge/upload")
def post_personal_knowledge_upload(request: PersonalKnowledgeUploadRequest) -> dict[str, Any]:
    domain = resolve_personal_knowledge_domain(request.domain)
    saved_path = write_uploaded_personal_knowledge_file(domain, request)
    summary = rebuild_personal_knowledge_index(domain)
    return make_json_safe(
        {
            "ok": True,
            "domain": domain,
            "file_name": saved_path.name,
            "relative_path": str(saved_path.relative_to(get_htops_root_dir())),
            "index": summary,
        }
    )


@app.post("/api/v1/personal-knowledge/export")
def post_personal_knowledge_export(request: PersonalKnowledgeExportRequest) -> dict[str, Any]:
    payload = render_personal_knowledge_export_plan(
        domain=request.domain,
        question=request.question,
        answer=request.answer,
        citations=request.citations,
    )
    return make_json_safe({"ok": True, **payload})


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
