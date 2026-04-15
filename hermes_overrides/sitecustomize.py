"""Hermes gateway overrides for htops.

This module is loaded automatically by Python when present on PYTHONPATH.
We patch the gateway message handler so WeCom slash commands keep using the
plugin command path, while only store-operation questions are forwarded to the
htops inbound bridge. General chat remains on Hermes itself.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

from htops_router import resolve_store_aliases, should_route_to_htops
from wecom_send_mode import parse_bool_flag, parse_reply_mode, patch_wecom_reply_mode


LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(os.getenv("HETANG_ROOT_DIR", str(Path(__file__).resolve().parents[1])))
RUNTIME_ENV_PATH = Path(
    os.getenv("HETANG_RUNTIME_ENV_FILE", str(PROJECT_ROOT / ".env.runtime")),
)
_RUNTIME_ENV_CACHE: dict[str, str] | None = None
HTOPS_BRIDGE_UNAVAILABLE_REPLY = "门店数据助手暂时不可用，请稍后再试。"


def _load_runtime_env() -> dict[str, str]:
    global _RUNTIME_ENV_CACHE
    if _RUNTIME_ENV_CACHE is not None:
        return _RUNTIME_ENV_CACHE

    values: dict[str, str] = {}
    if RUNTIME_ENV_PATH.exists():
        for raw_line in RUNTIME_ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    _RUNTIME_ENV_CACHE = values
    return values


def _resolve_setting(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value:
        return value.strip()
    runtime_env = _load_runtime_env()
    runtime_value = runtime_env.get(name)
    if runtime_value:
        return runtime_value.strip()
    return default


def _resolve_bridge_url() -> str:
    explicit = _resolve_setting("HETANG_BRIDGE_URL")
    if explicit:
        return explicit.rstrip("/")
    host = _resolve_setting("HETANG_BRIDGE_HOST", "127.0.0.1")
    port = _resolve_setting("HETANG_BRIDGE_PORT", "18891")
    return f"http://{host}:{port}"


def _resolve_bridge_token() -> str:
    token = _resolve_setting("HETANG_BRIDGE_TOKEN")
    if not token:
        raise RuntimeError("Missing HETANG_BRIDGE_TOKEN for htops bridge")
    return token


def _resolve_wecom_reply_mode() -> str:
    explicit = _resolve_setting("HETANG_WECOM_REPLY_MODE")
    if explicit:
        return parse_reply_mode(explicit, "passive-text")
    force_proactive = parse_bool_flag(
        _resolve_setting("HETANG_WECOM_FORCE_PROACTIVE_REPLY", "false"),
        False,
    )
    return "proactive-send" if force_proactive else "passive-text"


def _build_inbound_payload(event: Any) -> dict[str, Any]:
    source = getattr(event, "source", None)
    chat_type = getattr(source, "chat_type", None)
    is_group = chat_type != "dm"
    payload: dict[str, Any] = {
        "request_id": str(uuid.uuid4()),
        "channel": getattr(getattr(source, "platform", None), "value", None) or "wecom",
        "account_id": getattr(source, "account_id", None),
        "sender_id": getattr(source, "user_id", None),
        "sender_name": getattr(source, "user_name", None),
        "conversation_id": getattr(source, "chat_id", None),
        "thread_id": getattr(source, "thread_id", None),
        "is_group": is_group,
        "content": getattr(event, "text", ""),
        "received_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "platform_message_id": getattr(event, "message_id", None),
    }
    if not is_group:
        payload["was_mentioned"] = True
    return payload


def _call_inbound_bridge(event: Any) -> str | None:
    payload = _build_inbound_payload(event)
    req = request.Request(
        f"{_resolve_bridge_url()}/v1/messages/inbound",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json; charset=utf-8",
            "x-htops-bridge-token": _resolve_bridge_token(),
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore").strip()
        LOGGER.warning("htops inbound bridge HTTP %s: %s", exc.code, detail or exc.reason)
        return None
    except OSError as exc:
        LOGGER.warning("htops inbound bridge unavailable: %s", exc)
        return None

    if not isinstance(body, dict) or not body.get("ok") or not body.get("handled"):
        return None

    reply = body.get("reply") if isinstance(body.get("reply"), dict) else {}
    text = reply.get("text") if isinstance(reply, dict) else None
    if isinstance(text, str) and text.strip():
        return text.strip()
    return None


def _patch_gateway() -> None:
    try:
        import gateway.run as run  # type: ignore
    except Exception:
        return

    if getattr(run, "_htops_hetang_bridge_patch", False):
        return

    original = run.GatewayRunner._handle_message

    async def _handle_message(self: Any, event: Any):
        try:
            text = getattr(event, "text", None)
            if isinstance(text, str):
                stripped = text.strip()
                if stripped and not stripped.startswith("/"):
                    source = getattr(event, "source", None)
                    platform = getattr(source, "platform", None)
                    platform_name = getattr(platform, "value", None) or str(platform or "")
                    if platform_name == "wecom":
                        if should_route_to_htops(stripped, resolve_store_aliases()):
                            LOGGER.debug("htops Hermes inbound bridge accepted text=%r", stripped)
                            bridged = _call_inbound_bridge(event)
                            if bridged:
                                return bridged
                            LOGGER.warning(
                                "htops inbound bridge fallback engaged for routed business ask: %r",
                                stripped,
                            )
                            return HTOPS_BRIDGE_UNAVAILABLE_REPLY
                        else:
                            LOGGER.debug("htops Hermes inbound bridge skipped text=%r", stripped)
        except Exception:
            LOGGER.exception("htops Hermes inbound patch failed")
        return await original(self, event)

    run.GatewayRunner._handle_message = _handle_message
    run._htops_hetang_bridge_patch = True


def _patch_wecom_reply_mode() -> None:
    try:
        import gateway.platforms.wecom as wecom  # type: ignore
    except Exception:
        return

    patch_wecom_reply_mode(
        wecom,
        reply_mode=_resolve_wecom_reply_mode(),
    )


_patch_gateway()
_patch_wecom_reply_mode()
