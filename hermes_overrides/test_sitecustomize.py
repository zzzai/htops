from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
import uuid
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace


MODULE_PATH = Path(__file__).with_name("sitecustomize.py")


class SitecustomizeBridgeFallbackTest(unittest.TestCase):
    def _load_module(self, *, route_to_htops: bool, htops_config: dict | None = None):
        injected: dict[str, types.ModuleType] = {}
        originals: dict[str, types.ModuleType | None] = {}
        env_originals: dict[str, str | None] = {}
        temp_dir: tempfile.TemporaryDirectory[str] | None = None

        if htops_config is not None:
            temp_dir = tempfile.TemporaryDirectory()
            config_path = Path(temp_dir.name) / "htops.json"
            config_path.write_text(
                json.dumps(htops_config, ensure_ascii=False),
                encoding="utf-8",
            )
            for key, value in {
                "HETANG_ROOT_DIR": temp_dir.name,
                "HTOPS_CONFIG_PATH": str(config_path),
            }.items():
                env_originals[key] = os.environ.get(key)
                os.environ[key] = value

        def install(name: str, module: types.ModuleType) -> None:
            originals[name] = sys.modules.get(name)
            sys.modules[name] = module
            injected[name] = module

        gateway_pkg = types.ModuleType("gateway")
        gateway_pkg.__path__ = []  # type: ignore[attr-defined]
        install("gateway", gateway_pkg)

        platforms_pkg = types.ModuleType("gateway.platforms")
        platforms_pkg.__path__ = []  # type: ignore[attr-defined]
        install("gateway.platforms", platforms_pkg)

        session_module = types.ModuleType("gateway.session")
        session_module.build_session_key = lambda source, **kwargs: (
            f"{getattr(getattr(source, 'platform', None), 'value', 'unknown')}:{getattr(source, 'chat_id', 'chat')}"
        )
        install("gateway.session", session_module)

        base_module = types.ModuleType("gateway.platforms.base")

        class DummyBasePlatformAdapter:
            def __init__(self, config, platform):
                self.config = config
                self.platform = platform
                self.name = str(platform)
                self._message_handler = None
                self._active_sessions = {}
                self._pending_messages = {}
                self.sent_responses = []

            async def _send_with_retry(self, chat_id, content, **kwargs):
                self.sent_responses.append(
                    {
                        "chat_id": chat_id,
                        "content": content,
                        "kwargs": kwargs,
                    }
                )

            async def handle_message(self, event):
                session_key = session_module.build_session_key(event.source)
                if session_key in self._active_sessions:
                    self._pending_messages[session_key] = event
                    self._active_sessions[session_key].set()
                    return None
                if self._message_handler:
                    return await self._message_handler(event)
                return None

        class DummyMessageType:
            TEXT = "text"
            PHOTO = "photo"

        @dataclass
        class DummySendResult:
            success: bool
            message_id: str | None = None
            error: str | None = None
            raw_response: object | None = None
            retryable: bool = False

        base_module.BasePlatformAdapter = DummyBasePlatformAdapter
        base_module.MessageType = DummyMessageType
        base_module.SendResult = DummySendResult
        base_module.build_session_key = session_module.build_session_key
        install("gateway.platforms.base", base_module)

        run_module = types.ModuleType("gateway.run")

        class DummyGatewayRunner:
            def __init__(self):
                self._smart_model_routing = {"enabled": False}
                self._provider_routing = {}
                self._fallback_model = None
                self.original_handle_calls = 0

            def _load_smart_model_routing(self):
                return {
                    "enabled": True,
                    "cheap_model": {
                      "provider": "main",
                      "model": "gpt-5.4-mini",
                    },
                }

            def _resolve_turn_agent_config(self, user_message, model, runtime_kwargs):
                route_cfg = getattr(self, "_smart_model_routing", {})
                cheap_model = (
                    route_cfg.get("cheap_model", {}).get("model")
                    if isinstance(route_cfg, dict)
                    else None
                )
                is_simple = (
                    len((user_message or "").strip()) <= 8
                    and bool(route_cfg.get("enabled"))
                    and bool(cheap_model)
                )
                selected_model = "gpt-5.4-mini" if is_simple else model
                return {
                    "model": selected_model,
                    "runtime": {
                        "provider": runtime_kwargs.get("provider"),
                        "base_url": runtime_kwargs.get("base_url"),
                    },
                    "label": (
                        "smart route → gpt-5.4-mini (main)"
                        if is_simple
                        else None
                    ),
                }

            def _load_reasoning_config(self):
                return {"effort": "low"}

            async def _handle_message(self, event):
                self.original_handle_calls += 1
                self._resolve_turn_agent_config(
                    getattr(event, "text", ""),
                    "gpt-5.4",
                    {
                        "provider": "main",
                        "base_url": "https://example.test/v1",
                    },
                )
                return "HERMES"

        run_module.GatewayRunner = DummyGatewayRunner
        run_module._resolve_runtime_agent_kwargs = lambda: {
            "provider": "main",
            "base_url": "https://example.test/v1",
            "api_key": "secret",
        }
        run_module._load_gateway_config = lambda: {"model": "gpt-5.4"}
        run_module._resolve_gateway_model = lambda user_config: "gpt-5.4"
        install("gateway.run", run_module)

        wecom_module = types.ModuleType("gateway.platforms.wecom")
        wecom_module.RECONNECT_BACKOFF = [0, 0, 0]

        class DummyWeComAdapter:
            def __init__(self):
                self.sent_payloads = []
                self.name = "Wecom"
                self._running = True
                self._ws = "connected"
                self._cleanup_calls = 0
                self._reconnect_attempts = 0
                self._pending_failures = []

            async def send(self, chat_id, content, reply_to=None, metadata=None):
                self.sent_payloads.append(
                    {
                        "chat_id": chat_id,
                        "content": content,
                        "reply_to": reply_to,
                        "metadata": metadata,
                    }
                )
                return DummySendResult(success=True, message_id="sent")

            async def _read_events(self):
                if self._ws == "connected":
                    raise RuntimeError("WeCom websocket closed")
                if self._ws == "poisoned":
                    await asyncio.Future()
                if self._ws is None:
                    raise RuntimeError("WeCom websocket is not connected")
                self._running = False

            def _fail_pending_responses(self, exc):
                self._pending_failures.append(str(exc))

            async def _cleanup_ws(self):
                self._cleanup_calls += 1
                self._ws = None

            async def _open_connection(self):
                self._reconnect_attempts += 1
                if self._reconnect_attempts == 1:
                    self._ws = "poisoned"
                    raise TimeoutError()
                self._ws = "healthy"

        wecom_module.WeComAdapter = DummyWeComAdapter
        install("gateway.platforms.wecom", wecom_module)

        router_module = types.ModuleType("htops_router")
        router_module.resolve_store_aliases = lambda: ("锦苑店",)
        router_module.should_route_to_htops = (
            lambda text, store_aliases=None: route_to_htops
        )
        install("htops_router", router_module)

        reply_mode_module = types.ModuleType("wecom_send_mode")
        reply_mode_module.parse_bool_flag = lambda value, default=False: default
        reply_mode_module.parse_reply_mode = (
            lambda value, default="passive-text": value or default
        )
        reply_mode_module.patch_wecom_reply_mode = lambda module, *, reply_mode: True
        install("wecom_send_mode", reply_mode_module)

        run_agent_module = types.ModuleType("run_agent")

        class DummyAIAgent:
            init_calls: list[dict[str, object]] = []
            run_calls: list[dict[str, object]] = []

            def __init__(self, **kwargs):
                self.kwargs = kwargs
                DummyAIAgent.init_calls.append(kwargs)

            def run_conversation(self, user_message, conversation_history=None, task_id=None):
                DummyAIAgent.run_calls.append(
                    {
                        "user_message": user_message,
                        "conversation_history": conversation_history,
                        "task_id": task_id,
                    }
                )
                return {
                    "final_response": f"FAST:{self.kwargs.get('model')}:{user_message}",
                }

        run_agent_module.AIAgent = DummyAIAgent
        install("run_agent", run_agent_module)

        module_name = f"sitecustomize_test_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(module_name, MODULE_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Unable to load module spec for {MODULE_PATH}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def cleanup() -> None:
            sys.modules.pop(module_name, None)
            for name in injected:
                original = originals.get(name)
                if original is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = original
            for key, original in env_originals.items():
                if original is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = original
            if temp_dir is not None:
                temp_dir.cleanup()

        return module, run_module.GatewayRunner, run_agent_module.AIAgent, cleanup

    def test_returns_bridge_reply_for_routed_business_message(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=True)
        try:
            module._call_inbound_bridge = lambda event: "桥接业务回答"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="锦苑店近3天的加钟数和加钟率", source=source)

            result = asyncio.run(runner_cls()._handle_message(event))

            self.assertEqual(result, "桥接业务回答")
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_routes_xiaohongshu_link_to_inbound_bridge(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            module._call_inbound_bridge = lambda event: "收到，正在读取。"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-xhs-1",
                user_id="user-xhs-1",
                user_name="User XHS 1",
                chat_type="dm",
            )
            event = SimpleNamespace(
                text="帮我看看这个 https://www.xiaohongshu.com/explore/67f123456789000000000001",
                source=source,
            )

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertEqual(result, "收到，正在读取。")
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_logs_frontdoor_lane_for_xiaohongshu_link_bridge(self) -> None:
        module, runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            module._call_inbound_bridge = lambda event: "收到，正在读取。"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-xhs-2",
                user_id="user-xhs-2",
                user_name="User XHS 2",
                chat_type="dm",
            )
            event = SimpleNamespace(
                text="https://xhslink.com/a/AbCdEfGhIjKl",
                source=source,
            )

            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                result = asyncio.run(runner_cls()._handle_message(event))

            self.assertEqual(result, "收到，正在读取。")
            joined = "\n".join(captured.output)
            self.assertIn("lane=xiaohongshu-bridge", joined)
            self.assertIn("reason=xiaohongshu-link", joined)
            self.assertIn("chat_id=chat-xhs-2", joined)
            self.assertIn("user_id=user-xhs-2", joined)
        finally:
            cleanup()

    def test_routes_wecom_hetang_slash_command_to_bridge_command_path(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            module._call_command_bridge = lambda event: "对话复盘摘要"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="/hetang review", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertEqual(result, "对话复盘摘要")
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_logs_command_bridge_handled_for_wecom_hetang_slash_command(self) -> None:
        module, runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            module._call_command_bridge = lambda event: "对话复盘摘要"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="/hetang review", source=source)

            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                result = asyncio.run(runner_cls()._handle_message(event))

            self.assertEqual(result, "对话复盘摘要")
            joined = "\n".join(captured.output)
            self.assertIn("lane=command-bridge", joined)
            self.assertIn("command=hetang", joined)
            self.assertIn("result=handled", joined)
            self.assertIn("chat_id=chat-1", joined)
            self.assertIn("user_id=user-1", joined)
        finally:
            cleanup()

    def test_returns_safe_fallback_when_bridge_is_unavailable_for_business_message(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=True)
        try:
            module._call_inbound_bridge = lambda event: None
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="锦苑店近3天的加钟数和加钟率", source=source)

            result = asyncio.run(runner_cls()._handle_message(event))

            self.assertEqual(result, module.HTOPS_BRIDGE_UNAVAILABLE_REPLY)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_keeps_complex_general_chat_on_original_hermes_when_general_lite_is_not_suitable(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            module._call_inbound_bridge = lambda event: "桥接业务回答"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="帮我做个H5页面", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertEqual(result, "HERMES")
            self.assertEqual(runner.original_handle_calls, 1)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_logs_selected_model_for_general_chat_turn(self) -> None:
        module, runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
                thread_id="thread-1",
            )
            event = SimpleNamespace(text="哈哈", source=source)

            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                result = asyncio.run(runner_cls()._handle_message(event))

            self.assertTrue(result.startswith("FAST:"))
            joined = "\n".join(captured.output)
            self.assertIn("route=cheap", joined)
            self.assertIn("model=gpt-5.4-mini", joined)
            self.assertIn("provider=main", joined)
            self.assertIn("platform=wecom", joined)
            self.assertIn("chat_id=chat-1", joined)
            self.assertIn("user_id=user-1", joined)
            self.assertIn("thread_id=thread-1", joined)
            self.assertIn("general-lite", joined)
        finally:
            cleanup()

    def test_resets_turn_context_after_bridge_short_circuit(self) -> None:
        module, runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=True)
        try:
            module._call_inbound_bridge = lambda event: "桥接业务回答"
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
                thread_id="thread-1",
            )
            event = SimpleNamespace(text="锦苑店近3天的加钟数和加钟率", source=source)

            result = asyncio.run(runner_cls()._handle_message(event))

            self.assertEqual(result, "桥接业务回答")
            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                runner_cls()._resolve_turn_agent_config(
                    "你好",
                    "gpt-5.4",
                    {
                        "provider": "main",
                        "base_url": "https://example.test/v1",
                    },
                )

            joined = "\n".join(captured.output)
            self.assertIn("platform=-", joined)
            self.assertIn("chat_id=-", joined)
            self.assertIn("user_id=-", joined)
            self.assertIn("thread_id=-", joined)
        finally:
            cleanup()

    def test_reloads_smart_model_routing_before_selecting_turn_model(self) -> None:
        module, runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            runner = runner_cls()

            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                route = runner._resolve_turn_agent_config(
                    "你好",
                    "gpt-5.4",
                    {
                        "provider": "main",
                        "base_url": "https://example.test/v1",
                    },
                )

            self.assertEqual(route["model"], "gpt-5.4-mini")
            self.assertEqual(runner._smart_model_routing["enabled"], True)
            joined = "\n".join(captured.output)
            self.assertIn("route=cheap", joined)
            self.assertIn("model=gpt-5.4-mini", joined)
        finally:
            cleanup()

    def test_returns_current_turn_model_for_wecom_model_identity_question(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="你用的哪个模型", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertIn("gpt-5.4-mini", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_returns_current_turn_model_for_wecom_model_identity_variant(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="你是哪个模型", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertIn("gpt-5.4-mini", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_answers_wecom_greeting_via_local_fast_lane(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="你好", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertIn("荷塘AI小助手", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_answers_wecom_identity_question_via_local_fast_lane(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="你是谁", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertIn("荷塘AI小助手", result)
            self.assertIn("门店经营数据", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_answers_wecom_capability_question_via_local_fast_lane(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="你能做什么", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertIn("门店经营数据", result)
            self.assertIn("普通问答", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_answers_wecom_availability_question_via_local_fast_lane(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="在吗", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertIn("直接发", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(agent_cls.init_calls, [])
        finally:
            cleanup()

    def test_routes_non_business_wecom_questions_to_general_lite_agent(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="帮我解释一下什么是 function calling", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertTrue(result.startswith("FAST:gpt-5.4:"))
            self.assertIn("function calling", result)
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(len(agent_cls.init_calls), 1)
            kwargs = agent_cls.init_calls[0]
            self.assertEqual(kwargs["enabled_toolsets"], [])
            self.assertEqual(kwargs["session_db"], None)
            self.assertEqual(kwargs["skip_memory"], True)
            self.assertEqual(kwargs["skip_context_files"], True)
            self.assertEqual(kwargs["persist_session"], False)
            self.assertIn("荷塘AI小助手", kwargs["ephemeral_system_prompt"])
        finally:
            cleanup()

    def test_prefers_general_lite_lane_model_from_htops_json_and_disables_reasoning(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(
            route_to_htops=False,
            htops_config={
                "aiLanes": {
                    "general-lite": {
                        "model": "kimi-k2.6",
                        "baseUrl": "https://lane.example.com/v1",
                        "apiKey": "lane-secret",
                        "reasoningMode": "off",
                    }
                }
            },
        )
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="帮我解释一下什么是 function calling", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertTrue(result.startswith("FAST:kimi-k2.6:"))
            self.assertEqual(runner.original_handle_calls, 0)
            self.assertEqual(len(agent_cls.init_calls), 1)
            kwargs = agent_cls.init_calls[0]
            self.assertEqual(kwargs["model"], "kimi-k2.6")
            self.assertEqual(kwargs["base_url"], "https://lane.example.com/v1")
            self.assertEqual(kwargs["api_key"], "lane-secret")
            self.assertIsNone(kwargs["reasoning_config"])
        finally:
            cleanup()

    def test_logs_frontdoor_lane_for_general_lite_questions(self) -> None:
        module, runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="帮我解释一下什么是 function calling", source=source)

            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                result = asyncio.run(runner_cls()._handle_message(event))

            self.assertTrue(result.startswith("FAST:"))
            joined = "\n".join(captured.output)
            self.assertIn("lane=general-lite", joined)
            self.assertIn("reason=explanatory-question", joined)
        finally:
            cleanup()

    def test_falls_back_to_original_hermes_when_general_lite_agent_returns_empty(self) -> None:
        module, runner_cls, agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            original_run = agent_cls.run_conversation

            def return_empty(self, user_message, conversation_history=None, task_id=None):
                return {"final_response": ""}

            agent_cls.run_conversation = return_empty
            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
            )
            event = SimpleNamespace(text="帮我解释一下什么是 function calling", source=source)

            runner = runner_cls()
            result = asyncio.run(runner._handle_message(event))

            self.assertEqual(result, "HERMES")
            self.assertEqual(runner.original_handle_calls, 1)
        finally:
            agent_cls.run_conversation = original_run
            cleanup()

    def test_bypasses_active_session_queue_for_wecom_business_messages(self) -> None:
        module, _runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=True)
        try:
            from gateway.platforms.base import BasePlatformAdapter

            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
                thread_id="thread-1",
            )
            event = SimpleNamespace(
                text="义乌店近3天加钟率多少",
                source=source,
                message_id="msg-1",
            )
            adapter = BasePlatformAdapter(
                config=SimpleNamespace(
                    extra={
                        "group_sessions_per_user": True,
                        "thread_sessions_per_user": False,
                    },
                ),
                platform=SimpleNamespace(value="wecom"),
            )
            async def _handle_business(_event):
                return "桥接业务回答"

            adapter._message_handler = _handle_business
            session_key = "wecom:chat-1"
            interrupt_event = asyncio.Event()
            adapter._active_sessions[session_key] = interrupt_event

            asyncio.run(adapter.handle_message(event))

            self.assertTrue(interrupt_event.is_set())
            self.assertEqual(adapter._pending_messages, {})
            self.assertEqual(len(adapter.sent_responses), 1)
            self.assertEqual(adapter.sent_responses[0]["content"], "桥接业务回答")
            self.assertEqual(adapter.sent_responses[0]["chat_id"], "chat-1")
            self.assertEqual(
                adapter.sent_responses[0]["kwargs"].get("metadata"),
                {"thread_id": "thread-1"},
            )
        finally:
            cleanup()

    def test_bypasses_active_session_queue_for_wecom_hetang_slash_commands(self) -> None:
        module, _runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            from gateway.platforms.base import BasePlatformAdapter

            source = SimpleNamespace(
                platform=SimpleNamespace(value="wecom"),
                chat_id="chat-1",
                user_id="user-1",
                user_name="User 1",
                chat_type="dm",
                thread_id="thread-1",
            )
            event = SimpleNamespace(
                text="/hetang review",
                source=source,
                message_id="msg-1",
            )
            adapter = BasePlatformAdapter(
                config=SimpleNamespace(
                    extra={
                        "group_sessions_per_user": True,
                        "thread_sessions_per_user": False,
                    },
                ),
                platform=SimpleNamespace(value="wecom"),
            )

            async def _handle_command(_event):
                return "对话复盘摘要"

            adapter._message_handler = _handle_command
            session_key = "wecom:chat-1"
            interrupt_event = asyncio.Event()
            adapter._active_sessions[session_key] = interrupt_event

            asyncio.run(adapter.handle_message(event))

            self.assertTrue(interrupt_event.is_set())
            self.assertEqual(adapter._pending_messages, {})
            self.assertEqual(len(adapter.sent_responses), 1)
            self.assertEqual(adapter.sent_responses[0]["content"], "对话复盘摘要")
            self.assertEqual(adapter.sent_responses[0]["chat_id"], "chat-1")
            self.assertEqual(
                adapter.sent_responses[0]["kwargs"].get("metadata"),
                {"thread_id": "thread-1"},
            )
        finally:
            cleanup()

    def test_suppresses_wecom_background_process_notifications(self) -> None:
        module, _runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            from gateway.platforms.wecom import WeComAdapter

            adapter = WeComAdapter()

            result = asyncio.run(
                adapter.send(
                    "chat-1",
                    "[Background process proc_123 is still running~ New output:\nansi-garbage]",
                    metadata={"thread_id": "thread-1"},
                )
            )

            self.assertTrue(result.success)
            self.assertEqual(result.message_id, "suppressed-background-process-notification")
            self.assertEqual(adapter.sent_payloads, [])
        finally:
            cleanup()

    def test_cleans_failed_wecom_reconnect_state_and_retries_again(self) -> None:
        module, _runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            from gateway.platforms.wecom import WeComAdapter

            adapter = WeComAdapter()

            asyncio.run(asyncio.wait_for(adapter._listen_loop(), timeout=0.2))

            self.assertEqual(adapter._reconnect_attempts, 2)
            self.assertGreaterEqual(adapter._cleanup_calls, 2)
            self.assertIn("WeCom connection interrupted", adapter._pending_failures)
            self.assertEqual(adapter._ws, "healthy")
        finally:
            cleanup()

    def test_logs_wecom_reconnect_attempt_and_backoff(self) -> None:
        module, _runner_cls, _agent_cls, cleanup = self._load_module(route_to_htops=False)
        try:
            from gateway.platforms.wecom import WeComAdapter

            adapter = WeComAdapter()

            with self.assertLogs(module.LOGGER.name, level="INFO") as captured:
                asyncio.run(asyncio.wait_for(adapter._listen_loop(), timeout=0.2))

            joined = "\n".join(captured.output)
            self.assertIn("WebSocket error:", joined)
            self.assertIn("reconnect_attempt=1", joined)
            self.assertIn("retry_in=0", joined)
            self.assertIn("Reconnect failed:", joined)
            self.assertIn("Reconnected", joined)
            self.assertIn("reconnect_attempt=2", joined)
        finally:
            cleanup()


if __name__ == "__main__":
    unittest.main()
