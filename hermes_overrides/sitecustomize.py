"""Hermes gateway overrides for htops.

This module is loaded automatically by Python when present on PYTHONPATH.
We patch the gateway message handler so WeCom slash commands keep using the
plugin command path, while only store-operation questions are forwarded to the
htops inbound bridge. General chat remains on Hermes itself.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

from htops_router import resolve_store_aliases, should_route_to_htops
from wecom_send_mode import parse_bool_flag, parse_reply_mode, patch_wecom_reply_mode


LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(os.getenv("HETANG_ROOT_DIR", str(Path(__file__).resolve().parents[1])))
HTOPS_CONFIG_PATH = Path(os.getenv("HTOPS_CONFIG_PATH", str(PROJECT_ROOT / "htops.json")))
RUNTIME_ENV_PATH = Path(
    os.getenv("HETANG_RUNTIME_ENV_FILE", str(PROJECT_ROOT / ".env.runtime")),
)
_RUNTIME_ENV_CACHE: dict[str, str] | None = None
_HTOPS_CONFIG_CACHE: dict[str, Any] | None = None
_GATEWAY_TURN_CONTEXT: contextvars.ContextVar[dict[str, str] | None] = (
    contextvars.ContextVar("htops_hermes_gateway_turn_context", default=None)
)
HTOPS_BRIDGE_UNAVAILABLE_REPLY = "门店数据助手暂时不可用，请稍后再试。"
_SIMPLE_FAST_LANE_MAX_CHARS = 24
_MODEL_IDENTITY_PATTERNS = (
    "你用的哪个模型",
    "你现在用的哪个模型",
    "你现在是什么模型",
    "你用的什么模型",
    "当前模型",
    "现在模型",
)
_GREETING_PATTERNS = ("你好", "您好", "嗨", "哈喽", "hello", "hi")
_AVAILABILITY_PATTERNS = ("在吗", "在不在", "收到吗", "收到没", "有人吗")
_APPRECIATION_PATTERNS = ("谢谢", "谢了", "thanks")
_IDENTITY_PATTERNS = (
    "你是谁",
    "你是谁啊",
    "你是谁呀",
    "你叫什么",
    "你叫啥",
    "你是干嘛的",
)
_CAPABILITY_PATTERNS = (
    "你能做什么",
    "你会什么",
    "你可以做什么",
    "能做什么",
    "能干嘛",
)
_GENERAL_LITE_MAX_CHARS = 80
_GENERAL_LITE_EXPLANATION_PATTERNS = (
    "什么是",
    "什么意思",
    "解释一下",
    "帮我解释",
    "介绍一下",
    "有什么区别",
    "区别是什么",
    "怎么理解",
    "为什么",
)
_GENERAL_LITE_COMPLEX_PATTERNS = (
    "帮我做",
    "做个",
    "写个",
    "写一段",
    "写代码",
    "写脚本",
    "生成",
    "实现",
    "开发",
    "调试",
    "修复",
    "部署",
    "h5",
    "页面",
    "前端",
    "后端",
    "接口",
    "api",
    "代码",
    "脚本",
    "sql",
)
_GENERAL_LITE_SYSTEM_PROMPT = (
    "你是荷塘AI小助手。当前处于企业微信普通问答轻量模式。"
    "只处理通用问答、解释说明、简短写作和非业务闲聊。"
    "不要调用工具，不要假装访问外部系统，不要编造门店经营数据。"
    "如果用户问门店、日报、会员、技师、营收、经营分析，请明确提示这类问题应走业务数据链路。"
    "回复直接、简洁、自然，优先给结论。"
)
_XIAOHONGSHU_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?(?:xiaohongshu\.com/[^\s\"'<>]+|xhslink\.com/[^\s\"'<>]+)",
    re.IGNORECASE,
)


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


def _extract_htops_config_candidate(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    if "stores" in raw and isinstance(raw.get("stores"), list):
        return raw
    if "aiLanes" in raw and isinstance(raw.get("aiLanes"), dict):
        return raw

    plugin_config = (
        raw.get("plugins", {})
        .get("entries", {})
        .get("hetang-ops", {})
        .get("config")
    )
    return plugin_config if isinstance(plugin_config, dict) else {}


def _load_htops_config() -> dict[str, Any]:
    global _HTOPS_CONFIG_CACHE
    if _HTOPS_CONFIG_CACHE is not None:
        return _HTOPS_CONFIG_CACHE
    try:
        raw = json.loads(HTOPS_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _HTOPS_CONFIG_CACHE = {}
        return _HTOPS_CONFIG_CACHE
    _HTOPS_CONFIG_CACHE = _extract_htops_config_candidate(raw)
    return _HTOPS_CONFIG_CACHE


def _load_htops_ai_lane_config(lane_id: str) -> dict[str, Any] | None:
    ai_lanes = _load_htops_config().get("aiLanes")
    if not isinstance(ai_lanes, dict):
        return None
    lane = ai_lanes.get(lane_id)
    return lane if isinstance(lane, dict) else None


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


def _extract_bridge_command_name(text: str) -> str | None:
    match = re.match(r"^/([a-zA-Z][\w-]*)\b", (text or "").strip())
    if not match:
        return None
    command_name = match.group(1).strip().lower()
    if command_name != "hetang":
        return None
    return command_name


def _build_command_payload(event: Any, command_name: str) -> dict[str, Any]:
    payload = _build_inbound_payload(event)
    source = getattr(event, "source", None)
    payload["command_name"] = command_name
    payload["reply_target"] = getattr(source, "chat_id", None) or getattr(source, "user_id", None)
    return payload


def _normalize_log_value(value: Any) -> str:
    if value is None:
        return "-"
    text = str(value).strip()
    return text or "-"


def _normalize_match_text(text: str) -> str:
    normalized = re.sub(r"\s+", "", text or "").strip().lower()
    return normalized.strip(",.!?;:，。！？；：")


def _is_model_identity_question(text: str) -> bool:
    normalized = _normalize_match_text(text)
    if not normalized:
        return False
    if normalized in _MODEL_IDENTITY_PATTERNS:
        return True
    return (
        "模型" in normalized
        and ("你用" in normalized or "你是" in normalized or "当前" in normalized or "现在" in normalized)
    )


def _build_gateway_turn_context(event: Any) -> dict[str, str]:
    source = getattr(event, "source", None)
    platform = getattr(getattr(source, "platform", None), "value", None)
    return {
        "platform": _normalize_log_value(platform),
        "chat_id": _normalize_log_value(getattr(source, "chat_id", None)),
        "user_id": _normalize_log_value(getattr(source, "user_id", None)),
        "thread_id": _normalize_log_value(getattr(source, "thread_id", None)),
    }


def _log_gateway_turn_route(user_message: Any, turn_route: Any) -> None:
    if not isinstance(turn_route, dict):
        return
    runtime = turn_route.get("runtime") if isinstance(turn_route.get("runtime"), dict) else {}
    route_label = turn_route.get("label")
    route_kind = "cheap" if isinstance(route_label, str) and route_label.strip() else "primary"
    turn_context = _GATEWAY_TURN_CONTEXT.get() or {}
    prompt_chars = len(str(user_message or "").strip())
    LOGGER.info(
        "hermes_gateway_model_route route=%s model=%s provider=%s prompt_chars=%s platform=%s chat_id=%s user_id=%s thread_id=%s",
        route_kind,
        _normalize_log_value(turn_route.get("model")),
        _normalize_log_value(runtime.get("provider")),
        prompt_chars,
        turn_context.get("platform", "-"),
        turn_context.get("chat_id", "-"),
        turn_context.get("user_id", "-"),
        turn_context.get("thread_id", "-"),
    )


def _log_frontdoor_lane(source: Any, lane: str, reason: str) -> None:
    LOGGER.info(
        "htops_hermes_frontdoor lane=%s reason=%s chat_id=%s user_id=%s",
        lane,
        reason,
        _normalize_log_value(getattr(source, "chat_id", None)),
        _normalize_log_value(getattr(source, "user_id", None)),
    )


def _log_command_bridge_result(source: Any, command_name: str, result: str) -> None:
    LOGGER.info(
        "htops_hermes_command_bridge command=%s result=%s chat_id=%s user_id=%s",
        command_name,
        result,
        _normalize_log_value(getattr(source, "chat_id", None)),
        _normalize_log_value(getattr(source, "user_id", None)),
    )


def _describe_wecom_socket_state(adapter: Any) -> str:
    ws = getattr(adapter, "_ws", None)
    if ws is None:
        return "none"
    if isinstance(ws, str) and ws.strip():
        return ws.strip()
    return ws.__class__.__name__


def _looks_like_background_process_notification(text: str) -> bool:
    normalized = (text or "").strip()
    return normalized.startswith("[Background process ") or normalized.startswith(
        "[SYSTEM: Background process "
    )


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


def _call_command_bridge(event: Any) -> str | None:
    text = getattr(event, "text", "")
    if not isinstance(text, str):
        return None
    command_name = _extract_bridge_command_name(text)
    if not command_name:
        return None

    payload = _build_command_payload(event, command_name)
    req = request.Request(
        f"{_resolve_bridge_url()}/v1/messages/command",
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
        LOGGER.warning("htops command bridge HTTP %s: %s", exc.code, detail or exc.reason)
        return None
    except OSError as exc:
        LOGGER.warning("htops command bridge unavailable: %s", exc)
        return None

    if not isinstance(body, dict) or not body.get("ok") or not body.get("handled"):
        return None

    reply = body.get("reply") if isinstance(body.get("reply"), dict) else {}
    text = reply.get("text") if isinstance(reply, dict) else None
    if isinstance(text, str) and text.strip():
        return text.strip()
    return None


def _resolve_turn_route_for_text(runner: Any, text: str) -> dict[str, Any] | None:
    try:
        import gateway.run as run  # type: ignore
    except Exception:
        return None

    resolve_runtime_agent_kwargs = getattr(run, "_resolve_runtime_agent_kwargs", None)
    load_gateway_config = getattr(run, "_load_gateway_config", None)
    resolve_gateway_model = getattr(run, "_resolve_gateway_model", None)
    if not callable(resolve_runtime_agent_kwargs):
        return None
    if not callable(load_gateway_config):
        return None
    if not callable(resolve_gateway_model):
        return None

    runtime_kwargs = resolve_runtime_agent_kwargs()
    if not isinstance(runtime_kwargs, dict):
        return None
    user_config = load_gateway_config()
    model = resolve_gateway_model(user_config)
    return runner._resolve_turn_agent_config(text, model, runtime_kwargs)


def _build_turn_model_reply(turn_route: dict[str, Any] | None) -> str | None:
    if not isinstance(turn_route, dict):
        return None
    model = turn_route.get("model")
    if not isinstance(model, str) or not model.strip():
        return None
    return f"这条消息当前走的是 {model.strip()}。"


def _resolve_simple_general_fast_lane(text: str) -> tuple[str | None, str | None]:
    normalized = _normalize_match_text(text)
    if not normalized or len(normalized) > _SIMPLE_FAST_LANE_MAX_CHARS:
        return None, None
    if normalized in _GREETING_PATTERNS:
        return (
            "你好，我是荷塘AI小助手。普通问题我会直接回复，门店经营数据问题我会按业务口径处理。",
            "greeting",
        )
    if normalized in _AVAILABILITY_PATTERNS:
        return (
            "在。你直接发问题就行，普通问答我会直接回，门店数据问题我会按业务口径处理。",
            "availability",
        )
    if normalized in _APPRECIATION_PATTERNS:
        return "不客气，你继续发就行。", "appreciation"
    if normalized in _IDENTITY_PATTERNS or any(
        token in normalized for token in ("你是谁", "你叫什么", "你是干嘛")
    ):
        return (
            "我是荷塘AI小助手，负责普通问答和门店经营数据协同。日报、门店、会员、技师、营收这类问题我会按业务口径处理。",
            "identity",
        )
    if normalized in _CAPABILITY_PATTERNS or any(
        token in normalized for token in ("你能做什么", "你会什么", "能做什么", "能干嘛")
    ):
        return (
            "我可以直接处理普通问答，也可以按业务口径处理门店经营数据，比如日报、会员、技师、营收、趋势和对比分析。",
            "capability",
        )
    return None, None


def _classify_general_lite_candidate(text: str) -> tuple[bool, str]:
    normalized = _normalize_match_text(text)
    if not normalized:
        return False, "empty"
    if len(normalized) > _GENERAL_LITE_MAX_CHARS:
        return False, "too-long"
    if "http://" in text.lower() or "https://" in text.lower():
        return False, "contains-url"
    if "`" in text or "\n" in text:
        return False, "structured-input"
    if any(token in normalized for token in _GENERAL_LITE_COMPLEX_PATTERNS):
        return False, "complex-request"
    if any(token in normalized for token in _GENERAL_LITE_EXPLANATION_PATTERNS):
        return True, "explanatory-question"
    if len(normalized) <= _SIMPLE_FAST_LANE_MAX_CHARS:
        return True, "short-general"
    return False, "full-hermes"


def _extract_xiaohongshu_url(text: str) -> str | None:
    match = _XIAOHONGSHU_URL_PATTERN.search(text or "")
    if not match:
        return None
    return match.group(0).rstrip(".,!?;:，。！？；：)]}】」』")


def _run_general_lite_agent_sync(
    runner: Any,
    event: Any,
    text: str,
    turn_route: dict[str, Any],
) -> str | None:
    from run_agent import AIAgent  # type: ignore

    runtime = turn_route.get("runtime")
    if not isinstance(runtime, dict):
        return None

    source = getattr(event, "source", None)
    platform = getattr(getattr(source, "platform", None), "value", None) or "unknown"
    platform_key = "cli" if platform == "local" else platform
    reasoning_loader = getattr(runner, "_load_reasoning_config", None)
    reasoning_config = reasoning_loader() if callable(reasoning_loader) else None
    lane_reasoning_mode = turn_route.get("_htops_reasoning_mode")
    if lane_reasoning_mode == "off":
        reasoning_config = None
    elif lane_reasoning_mode in ("low", "medium", "high"):
        reasoning_config = {"effort": lane_reasoning_mode}
    provider_routing = (
        runner._provider_routing if isinstance(getattr(runner, "_provider_routing", None), dict) else {}
    )

    agent = AIAgent(
        model=turn_route["model"],
        **runtime,
        max_iterations=4,
        quiet_mode=True,
        verbose_logging=False,
        enabled_toolsets=[],
        ephemeral_system_prompt=_GENERAL_LITE_SYSTEM_PROMPT,
        reasoning_config=reasoning_config,
        providers_allowed=provider_routing.get("only"),
        providers_ignored=provider_routing.get("ignore"),
        providers_order=provider_routing.get("order"),
        provider_sort=provider_routing.get("sort"),
        provider_require_parameters=provider_routing.get("require_parameters", False),
        provider_data_collection=provider_routing.get("data_collection"),
        session_id=f"wecom-general-lite-{uuid.uuid4().hex}",
        platform=platform_key,
        user_id=getattr(source, "user_id", None),
        session_db=None,
        fallback_model=None,
        skip_memory=True,
        skip_context_files=True,
        persist_session=False,
    )
    result = agent.run_conversation(
        user_message=text,
        conversation_history=None,
        task_id=f"wecom-general-lite-{uuid.uuid4().hex}",
    )
    if not isinstance(result, dict):
        return None
    reply = result.get("final_response")
    if isinstance(reply, str) and reply.strip():
        return reply.strip()
    return None


def _apply_general_lite_lane(turn_route: dict[str, Any]) -> dict[str, Any]:
    lane_config = _load_htops_ai_lane_config("general-lite")
    if not lane_config:
        return turn_route

    resolved = dict(turn_route)
    model = lane_config.get("model")
    if isinstance(model, str) and model.strip():
        resolved["model"] = model.strip()

    runtime = turn_route.get("runtime")
    resolved_runtime = dict(runtime) if isinstance(runtime, dict) else {}
    base_url = lane_config.get("baseUrl")
    if isinstance(base_url, str) and base_url.strip():
        resolved_runtime["base_url"] = base_url.strip()
    api_key = lane_config.get("apiKey")
    if isinstance(api_key, str) and api_key.strip():
        resolved_runtime["api_key"] = api_key.strip()
    if resolved_runtime:
        resolved["runtime"] = resolved_runtime

    reasoning_mode = lane_config.get("reasoningMode")
    if isinstance(reasoning_mode, str) and reasoning_mode.strip():
        resolved["_htops_reasoning_mode"] = reasoning_mode.strip().lower()

    return resolved


def _patch_gateway() -> None:
    try:
        import gateway.run as run  # type: ignore
    except Exception:
        return

    if getattr(run, "_htops_hetang_bridge_patch", False):
        return

    original = run.GatewayRunner._handle_message
    original_resolve_turn_agent_config = getattr(
        run.GatewayRunner,
        "_resolve_turn_agent_config",
        None,
    )

    async def _handle_message(self: Any, event: Any):
        token = _GATEWAY_TURN_CONTEXT.set(_build_gateway_turn_context(event))
        try:
            try:
                text = getattr(event, "text", None)
                if isinstance(text, str):
                    stripped = text.strip()
                    if stripped:
                        source = getattr(event, "source", None)
                        platform = getattr(source, "platform", None)
                        platform_name = getattr(platform, "value", None) or str(platform or "")
                        if platform_name == "wecom":
                            command_name = _extract_bridge_command_name(stripped)
                            if command_name:
                                _log_frontdoor_lane(source, "command-bridge", f"slash-{command_name}")
                                LOGGER.debug("htops Hermes command bridge accepted text=%r", stripped)
                                bridged = _call_command_bridge(event)
                                if bridged:
                                    _log_command_bridge_result(source, command_name, "handled")
                                    return bridged
                                _log_command_bridge_result(source, command_name, "fallback-unavailable")
                                LOGGER.warning(
                                    "htops command bridge fallback engaged for slash command: %r",
                                    stripped,
                                )
                                return HTOPS_BRIDGE_UNAVAILABLE_REPLY
                        if platform_name == "wecom" and not stripped.startswith("/"):
                            if _extract_xiaohongshu_url(stripped):
                                _log_frontdoor_lane(source, "xiaohongshu-bridge", "xiaohongshu-link")
                                LOGGER.debug("htops Hermes xiaohongshu bridge accepted text=%r", stripped)
                                bridged = _call_inbound_bridge(event)
                                if bridged:
                                    return bridged
                                LOGGER.warning(
                                    "htops xiaohongshu bridge fallback engaged for link message: %r",
                                    stripped,
                                )
                                return HTOPS_BRIDGE_UNAVAILABLE_REPLY
                            if should_route_to_htops(stripped, resolve_store_aliases()):
                                _log_frontdoor_lane(source, "business-bridge", "business-router")
                                LOGGER.debug("htops Hermes inbound bridge accepted text=%r", stripped)
                                bridged = _call_inbound_bridge(event)
                                if bridged:
                                    return bridged
                                LOGGER.warning(
                                    "htops inbound bridge fallback engaged for routed business ask: %r",
                                    stripped,
                                )
                                return HTOPS_BRIDGE_UNAVAILABLE_REPLY
                            LOGGER.debug("htops Hermes inbound bridge skipped text=%r", stripped)
                            turn_route = None
                            if _is_model_identity_question(stripped):
                                turn_route = _resolve_turn_route_for_text(self, stripped)
                                model_reply = _build_turn_model_reply(turn_route)
                                if model_reply:
                                    _log_frontdoor_lane(source, "model-identity", "current-model")
                                    LOGGER.info(
                                        "htops Hermes fast lane answered current-model question chat_id=%s user_id=%s",
                                        _normalize_log_value(getattr(source, "chat_id", None)),
                                        _normalize_log_value(getattr(source, "user_id", None)),
                                    )
                                    return model_reply
                            fast_reply, fast_reason = _resolve_simple_general_fast_lane(stripped)
                            if fast_reply:
                                _log_frontdoor_lane(source, "general-simple", fast_reason or "simple-general")
                                LOGGER.info(
                                    "htops Hermes fast lane answered simple general chat locally chat_id=%s user_id=%s",
                                    _normalize_log_value(getattr(source, "chat_id", None)),
                                    _normalize_log_value(getattr(source, "user_id", None)),
                                )
                                return fast_reply
                            should_use_general_lite, general_lite_reason = _classify_general_lite_candidate(
                                stripped
                            )
                            if should_use_general_lite:
                                turn_route = turn_route or _resolve_turn_route_for_text(self, stripped)
                            if should_use_general_lite and isinstance(turn_route, dict):
                                general_lite_turn_route = _apply_general_lite_lane(turn_route)
                                loop = asyncio.get_running_loop()
                                general_lite_reply = await loop.run_in_executor(
                                    None,
                                    _run_general_lite_agent_sync,
                                    self,
                                    event,
                                    stripped,
                                    general_lite_turn_route,
                                )
                                if general_lite_reply:
                                    _log_frontdoor_lane(source, "general-lite", general_lite_reason)
                                    LOGGER.info(
                                        "htops Hermes routed question to general-lite model=%s chat_id=%s user_id=%s",
                                        _normalize_log_value(general_lite_turn_route.get("model")),
                                        _normalize_log_value(getattr(source, "chat_id", None)),
                                        _normalize_log_value(getattr(source, "user_id", None)),
                                    )
                                    return general_lite_reply
                                LOGGER.warning(
                                    "htops Hermes general-lite returned empty reply; falling back to original Hermes path chat_id=%s user_id=%s",
                                    _normalize_log_value(getattr(source, "chat_id", None)),
                                    _normalize_log_value(getattr(source, "user_id", None)),
                                )
                            else:
                                _log_frontdoor_lane(source, "full-hermes", general_lite_reason)
            except Exception:
                LOGGER.exception("htops Hermes inbound patch failed")
            return await original(self, event)
        finally:
            _GATEWAY_TURN_CONTEXT.reset(token)

    def _resolve_turn_agent_config(self: Any, user_message: str, model: str, runtime_kwargs: dict):
        load_smart_model_routing = getattr(self, "_load_smart_model_routing", None)
        if callable(load_smart_model_routing):
            try:
                self._smart_model_routing = load_smart_model_routing()
            except Exception:
                LOGGER.exception("Failed to reload smart_model_routing before resolving turn model")
        turn_route = original_resolve_turn_agent_config(self, user_message, model, runtime_kwargs)
        _log_gateway_turn_route(user_message, turn_route)
        return turn_route

    run.GatewayRunner._handle_message = _handle_message
    if callable(original_resolve_turn_agent_config):
        run.GatewayRunner._resolve_turn_agent_config = _resolve_turn_agent_config
    run._htops_hetang_bridge_patch = True


def _patch_active_session_business_bypass() -> None:
    try:
        import gateway.platforms.base as base  # type: ignore
    except Exception:
        return

    if getattr(base, "_htops_wecom_business_bypass_patch", False):
        return

    original = base.BasePlatformAdapter.handle_message

    async def handle_message(self: Any, event: Any):
        try:
            handler = getattr(self, "_message_handler", None)
            if not callable(handler):
                return await original(self, event)

            source = getattr(event, "source", None)
            platform = getattr(getattr(source, "platform", None), "value", None) or str(
                getattr(source, "platform", None) or ""
            )
            text = getattr(event, "text", None)
            if platform == "wecom" and isinstance(text, str):
                stripped = text.strip()
                command_name = _extract_bridge_command_name(stripped)
                config_extra = getattr(getattr(self, "config", None), "extra", {}) or {}
                session_key = base.build_session_key(
                    source,
                    group_sessions_per_user=config_extra.get("group_sessions_per_user", True),
                    thread_sessions_per_user=config_extra.get("thread_sessions_per_user", False),
                )
                if (
                    stripped
                    and session_key in getattr(self, "_active_sessions", {})
                    and (
                        command_name is not None
                        or (
                            not stripped.startswith("/")
                            and should_route_to_htops(stripped, resolve_store_aliases())
                        )
                    )
                ):
                    interrupt_event = self._active_sessions.get(session_key)
                    if interrupt_event is not None and hasattr(interrupt_event, "set"):
                        interrupt_event.set()
                    LOGGER.info(
                        "htops Hermes active-session business bypass chat_id=%s user_id=%s",
                        _normalize_log_value(getattr(source, "chat_id", None)),
                        _normalize_log_value(getattr(source, "user_id", None)),
                    )
                    thread_meta = (
                        {"thread_id": getattr(source, "thread_id", None)}
                        if getattr(source, "thread_id", None)
                        else None
                    )
                    response = await handler(event)
                    if response:
                        await self._send_with_retry(
                            chat_id=getattr(source, "chat_id", None),
                            content=response,
                            reply_to=getattr(event, "message_id", None),
                            metadata=thread_meta,
                        )
                    return None
        except Exception:
            LOGGER.exception("htops Hermes active-session business bypass failed")
        return await original(self, event)

    base.BasePlatformAdapter.handle_message = handle_message
    base._htops_wecom_business_bypass_patch = True


def _patch_wecom_reply_mode() -> None:
    try:
        import gateway.platforms.wecom as wecom  # type: ignore
    except Exception:
        return

    patch_wecom_reply_mode(
        wecom,
        reply_mode=_resolve_wecom_reply_mode(),
    )


def _patch_wecom_background_notification_suppression() -> None:
    try:
        import gateway.platforms.wecom as wecom  # type: ignore
        from gateway.platforms.base import SendResult  # type: ignore
    except Exception:
        return

    if getattr(wecom, "_htops_wecom_background_notification_patch", False):
        return

    original = getattr(wecom.WeComAdapter, "send", None)
    if not callable(original):
        return

    async def send(
        self: Any,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        if isinstance(content, str) and _looks_like_background_process_notification(content):
            LOGGER.info(
                "htops Hermes suppressed WeCom background-process notification chat_id=%s",
                _normalize_log_value(chat_id),
            )
            return SendResult(
                success=True,
                message_id="suppressed-background-process-notification",
            )
        return await original(
            self,
            chat_id,
            content,
            reply_to=reply_to,
            metadata=metadata,
        )

    wecom.WeComAdapter.send = send
    wecom._htops_wecom_background_notification_patch = True


def _format_exception_for_log(exc: BaseException) -> str:
    detail = str(exc).strip()
    if detail:
        return detail
    return exc.__class__.__name__


def _patch_wecom_resilient_reconnect() -> None:
    try:
        import gateway.platforms.wecom as wecom  # type: ignore
    except Exception:
        return

    if getattr(wecom, "_htops_wecom_resilient_reconnect_patch", False):
        return

    adapter_cls = getattr(wecom, "WeComAdapter", None)
    if adapter_cls is None:
        return

    if not callable(getattr(adapter_cls, "_read_events", None)):
        return
    if not callable(getattr(adapter_cls, "_open_connection", None)):
        return
    if not callable(getattr(adapter_cls, "_cleanup_ws", None)):
        return

    reconnect_backoff = getattr(wecom, "RECONNECT_BACKOFF", (2, 5, 10, 30, 60))
    if not isinstance(reconnect_backoff, (list, tuple)) or not reconnect_backoff:
        reconnect_backoff = (2, 5, 10, 30, 60)

    wecom_logger = getattr(wecom, "logger", LOGGER)

    async def _listen_loop(self: Any) -> None:
        backoff_idx = 0
        while getattr(self, "_running", False):
            try:
                await self._read_events()
                backoff_idx = 0
            except asyncio.CancelledError:
                return
            except Exception as exc:
                if not getattr(self, "_running", False):
                    return

                attempt = backoff_idx + 1
                delay = reconnect_backoff[
                    min(backoff_idx, len(reconnect_backoff) - 1)
                ]
                wecom_logger.warning(
                    "[%s] WebSocket error: %s | ws_state=%s | reconnect_attempt=%s | retry_in=%s",
                    getattr(self, "name", "Wecom"),
                    _format_exception_for_log(exc),
                    _describe_wecom_socket_state(self),
                    attempt,
                    delay,
                )
                try:
                    self._fail_pending_responses(
                        RuntimeError("WeCom connection interrupted")
                    )
                except Exception:
                    wecom_logger.exception(
                        "[%s] Failed to fail pending responses after websocket error",
                        getattr(self, "name", "Wecom"),
                    )

                try:
                    await self._cleanup_ws()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    wecom_logger.exception(
                        "[%s] Cleanup failed after websocket error",
                        getattr(self, "name", "Wecom"),
                    )

                backoff_idx += 1
                if delay:
                    await asyncio.sleep(delay)

                try:
                    await self._open_connection()
                    backoff_idx = 0
                    wecom_logger.info(
                        "[%s] Reconnected | reconnect_attempt=%s | ws_state=%s",
                        getattr(self, "name", "Wecom"),
                        attempt,
                        _describe_wecom_socket_state(self),
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as reconnect_exc:
                    try:
                        await self._cleanup_ws()
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        wecom_logger.exception(
                            "[%s] Cleanup failed after reconnect failure",
                            getattr(self, "name", "Wecom"),
                        )

                    wecom_logger.warning(
                        "[%s] Reconnect failed: %s | reconnect_attempt=%s | retry_in=%s | ws_state=%s",
                        getattr(self, "name", "Wecom"),
                        _format_exception_for_log(reconnect_exc),
                        attempt,
                        delay,
                        _describe_wecom_socket_state(self),
                    )

    adapter_cls._listen_loop = _listen_loop
    wecom._htops_wecom_resilient_reconnect_patch = True


_patch_gateway()
_patch_active_session_business_bypass()
_patch_wecom_reply_mode()
_patch_wecom_background_notification_suppression()
_patch_wecom_resilient_reconnect()
