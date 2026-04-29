from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("wecom_send_mode.py")
MODULE_SPEC = importlib.util.spec_from_file_location("wecom_send_mode", MODULE_PATH)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError(f"Unable to load module spec for {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(MODULE)

parse_bool_flag = MODULE.parse_bool_flag
parse_reply_mode = MODULE.parse_reply_mode
patch_wecom_reply_mode = MODULE.patch_wecom_reply_mode


class WeComSendModeTest(unittest.TestCase):
    def test_parse_bool_flag(self) -> None:
        self.assertTrue(parse_bool_flag("true"))
        self.assertTrue(parse_bool_flag("1"))
        self.assertFalse(parse_bool_flag("false", default=True))
        self.assertFalse(parse_bool_flag(None))

    def test_parse_reply_mode(self) -> None:
        self.assertEqual(parse_reply_mode("passive-text"), "passive-text")
        self.assertEqual(parse_reply_mode("proactive-send"), "proactive-send")
        self.assertEqual(parse_reply_mode("weird-mode"), "passive-text")
        self.assertEqual(parse_reply_mode(None, default="default"), "default")

    def test_passive_text_reply_uses_reply_request(self) -> None:
        class DummySendResult:
            def __init__(self, *, success: bool, error: str | None = None, message_id: str | None = None, raw_response: dict | None = None) -> None:
                self.success = success
                self.error = error
                self.message_id = message_id
                self.raw_response = raw_response

        class DummyWeComAdapter:
            MAX_MESSAGE_LENGTH = 4000
            name = "Wecom"

            def __init__(self) -> None:
                self.reply_calls: list[tuple[str, dict]] = []
                self.send_calls: list[tuple[str, str, str | None]] = []

            async def _send_reply_request(self, req_id: str, body: dict) -> dict:
                self.reply_calls.append((req_id, body))
                return {"headers": {"req_id": req_id}, "errcode": 0}

            async def send(self, chat_id: str, content: str, reply_to: str | None = None, metadata: dict | None = None) -> DummySendResult:
                self.send_calls.append((chat_id, content, reply_to))
                return DummySendResult(success=True, message_id="proactive-1")

            def _reply_req_id_for_message(self, reply_to: str | None) -> str | None:
                normalized = str(reply_to or "").strip()
                return f"req:{normalized}" if normalized else None

            def _response_error(self, response: dict) -> str | None:
                return None

            def _payload_req_id(self, response: dict) -> str | None:
                return response.get("headers", {}).get("req_id")

        module = type("DummyModule", (), {"WeComAdapter": DummyWeComAdapter, "SendResult": DummySendResult})()

        patched = patch_wecom_reply_mode(module, reply_mode="passive-text")

        self.assertTrue(patched)
        adapter = module.WeComAdapter()
        result = self._run(adapter.send("chat-1", "hello", reply_to="msg-1"))

        self.assertTrue(result.success)
        self.assertEqual(adapter.reply_calls, [("req:msg-1", {"msgtype": "text", "text": {"content": "hello"}})])
        self.assertEqual(adapter.send_calls, [])

    def test_proactive_mode_bypasses_reply_request(self) -> None:
        class DummySendResult:
            def __init__(self, *, success: bool, error: str | None = None, message_id: str | None = None, raw_response: dict | None = None) -> None:
                self.success = success
                self.error = error
                self.message_id = message_id
                self.raw_response = raw_response

        class DummyWeComAdapter:
            def __init__(self) -> None:
                self.send_calls: list[tuple[str, str, str | None]] = []

            async def send(self, chat_id: str, content: str, reply_to: str | None = None, metadata: dict | None = None) -> DummySendResult:
                self.send_calls.append((chat_id, content, reply_to))
                return DummySendResult(success=True, message_id="proactive-1")

            def _reply_req_id_for_message(self, reply_to: str | None) -> str | None:
                normalized = str(reply_to or "").strip()
                return f"req:{normalized}" if normalized else None

        class Module:
            WeComAdapter = DummyWeComAdapter
            SendResult = DummySendResult

        module = Module()
        patched = patch_wecom_reply_mode(module, reply_mode="proactive-send")

        self.assertTrue(patched)
        adapter = module.WeComAdapter()
        result = self._run(adapter.send("chat-1", "hello", reply_to="msg-1"))
        self.assertTrue(result.success)
        self.assertEqual(adapter.send_calls, [("chat-1", "hello", None)])

    @staticmethod
    def _run(awaitable):
        import asyncio

        return asyncio.run(awaitable)


if __name__ == "__main__":
    unittest.main()
