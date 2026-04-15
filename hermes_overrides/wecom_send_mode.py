from __future__ import annotations

import logging
from typing import Any


LOGGER = logging.getLogger(__name__)
VALID_REPLY_MODES = {"passive-text", "proactive-send", "default"}


def parse_bool_flag(value: str | None, default: bool = False) -> bool:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return default
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def parse_reply_mode(value: str | None, default: str = "passive-text") -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return default
    if normalized in VALID_REPLY_MODES:
        return normalized
    return default


def patch_wecom_reply_mode(wecom_module: Any, *, reply_mode: str) -> bool:
    adapter_cls = getattr(wecom_module, "WeComAdapter", None)
    if adapter_cls is None:
        return False
    if getattr(adapter_cls, "_htops_force_proactive_reply_patch", False):
        return True

    normalized_mode = parse_reply_mode(reply_mode)
    original_send = adapter_cls.send
    original_lookup = adapter_cls._reply_req_id_for_message

    async def _send(
        self: Any,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        del metadata
        normalized_reply_to = str(reply_to or "").strip()
        if normalized_mode == "proactive-send" and normalized_reply_to:
            LOGGER.info(
                "htops Hermes WeCom reply patch: forcing proactive send for reply target"
            )
            return await original_send(self, chat_id, content, reply_to=None, metadata=None)

        if normalized_mode == "passive-text" and normalized_reply_to:
            reply_req_id = original_lookup(self, normalized_reply_to)
            if reply_req_id:
                LOGGER.info(
                    "htops Hermes WeCom reply patch: using passive text reply for reply target"
                )
                try:
                    response = await self._send_reply_request(
                        reply_req_id,
                        {
                            "msgtype": "text",
                            "text": {
                                "content": str(content or "")[: getattr(self, "MAX_MESSAGE_LENGTH", 4000)]
                            },
                        },
                    )
                except Exception as exc:
                    LOGGER.error("[%s] Send failed: %s", getattr(self, "name", "Wecom"), exc)
                    return wecom_module.SendResult(success=False, error=str(exc))

                error = self._response_error(response)
                if error:
                    return wecom_module.SendResult(success=False, error=error)

                return wecom_module.SendResult(
                    success=True,
                    message_id=self._payload_req_id(response),
                    raw_response=response,
                )

        return await original_send(self, chat_id, content, reply_to=reply_to, metadata=None)

    adapter_cls.send = _send
    adapter_cls._htops_force_proactive_reply_patch = True
    adapter_cls._htops_force_proactive_reply_enabled = normalized_mode == "proactive-send"
    adapter_cls._htops_reply_mode = normalized_mode
    return True
