from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import subprocess
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import (
    CONTROL_PLANE_CONTRACT_VERSION,
    PersonalKnowledgeUploadRequest,
    build_hxy_project_brain_context_results,
    build_personal_knowledge_llm_headers,
    build_brand_knowledge_search_query,
    build_cross_domain_personal_knowledge_results,
    build_personal_knowledge_llm_request,
    close_db_connection_pool,
    extract_anthropic_messages_text,
    extract_openai_responses_message,
    fetch_rows,
    build_personal_knowledge_index_command,
    load_claude_personal_knowledge_llm_config,
    normalize_claude_personal_knowledge_model,
    rebuild_personal_knowledge_index,
    render_brand_knowledge_chat,
    render_hxy_knowledge_chat,
    render_personal_knowledge_chat_with_llm,
    render_personal_knowledge_chat,
    render_personal_knowledge_export_plan,
    resolve_personal_knowledge_domain,
    sanitize_personal_knowledge_file_name,
    search_personal_knowledge_index,
    write_uploaded_personal_knowledge_file,
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

    def test_search_personal_knowledge_index_ranks_chunks_and_citations(self) -> None:
        payload = search_personal_knowledge_index(
            {
                "version": "personal-knowledge-index.v1",
                "sources": [
                    {
                        "sourceId": "s1",
                        "domain": "marketing",
                        "title": "华与华超级符号案例集",
                    }
                ],
                "chunks": [
                    {
                        "chunkId": "c1",
                        "sourceId": "s1",
                        "domain": "marketing",
                        "title": "华与华超级符号案例集",
                        "relativePath": "knowledge/marketing/raw/华与华超级符号案例集.pdf",
                        "chunkIndex": 0,
                        "text": "超级符号是降低传播成本的品牌资产，要落到门头、包装、话语和员工动作。",
                        "keywords": ["超级符号", "品牌资产", "传播成本", "门头"],
                    },
                    {
                        "chunkId": "c2",
                        "sourceId": "s2",
                        "domain": "marketing",
                        "title": "增长黑客",
                        "relativePath": "knowledge/marketing/raw/增长黑客.pdf",
                        "chunkIndex": 0,
                        "text": "增长实验通过数据反馈优化获客和留存。",
                        "keywords": ["增长实验", "获客", "留存"],
                    },
                ],
            },
            "门店品牌超级符号",
            "marketing",
            1,
        )

        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["title"], "华与华超级符号案例集")
        self.assertGreater(payload[0]["score"], 0)

    def test_render_personal_knowledge_chat_returns_grounded_answer(self) -> None:
        payload = render_personal_knowledge_chat(
            "如何设计门店超级符号",
            "marketing",
            [
                {
                    "sourceId": "s1",
                    "title": "华与华超级符号案例集",
                    "relativePath": "knowledge/marketing/raw/华与华超级符号案例集.pdf",
                    "chunkIndex": 0,
                    "score": 4,
                    "text": "超级符号是降低传播成本的品牌资产，要落到门头、包装、话语和员工动作。",
                }
            ],
        )

        self.assertIn("基于 marketing 书库", payload["answer"])
        self.assertEqual(payload["citations"][0]["title"], "华与华超级符号案例集")
        self.assertLessEqual(len(payload["citations"][0]["snippet"]), 180)

    def test_brand_marketing_management_book_and_hxy_domains_are_supported(self) -> None:
        self.assertEqual(resolve_personal_knowledge_domain("brand"), "brand")
        self.assertEqual(resolve_personal_knowledge_domain("marketing"), "marketing")
        self.assertEqual(resolve_personal_knowledge_domain("management"), "management")
        self.assertEqual(resolve_personal_knowledge_domain("book"), "book")
        self.assertEqual(resolve_personal_knowledge_domain("hxy"), "hxy")

    def test_render_brand_knowledge_chat_requires_book_citations(self) -> None:
        payload = render_brand_knowledge_chat(
            "用华与华理论做荷塘悦色品牌策划",
            [
                {
                    "sourceId": "s1",
                    "title": "华与华超级符号案例集",
                    "relativePath": "knowledge/brand/raw/华与华超级符号案例集.pdf",
                    "chunkIndex": 0,
                    "score": 8,
                    "text": "超级符号是降低品牌传播成本的核心资产，要把品牌承诺变成人人看得懂、记得住、能复述的符号。",
                },
                {
                    "sourceId": "s2",
                    "title": "华与华方法",
                    "relativePath": "knowledge/brand/raw/华与华方法.pdf",
                    "chunkIndex": 12,
                    "score": 5,
                    "text": "品牌策划要把购买理由、视觉符号、货架呈现和终端动作统一起来，形成可重复的经营动作。",
                },
            ],
        )

        self.assertIn("品牌策划回答", payload["answer"])
        self.assertIn("引用来源", payload["answer"])
        self.assertIn("《华与华超级符号案例集》", payload["answer"])
        self.assertEqual(payload["citations"][0]["relativePath"], "knowledge/brand/raw/华与华超级符号案例集.pdf")

    def test_hxy_brand_strategy_questions_merge_project_and_brand_evidence(self) -> None:
        index_by_domain = {
            "hxy": {
                "chunks": [
                    {
                        "sourceId": "hxy1",
                        "domain": "hxy",
                        "title": "荷小悦_品牌策划全案",
                        "relativePath": "knowledge/hxy/raw/荷小悦_品牌策划全案.docx",
                        "chunkIndex": 0,
                        "score": 0,
                        "text": "荷小悦定位社区泡脚按摩小店，主打草本真现煮，按出真功夫。",
                        "keywords": ["荷小悦", "定位", "社区", "泡脚", "按摩", "草本", "小店"],
                    }
                ]
            },
            "brand": {
                "chunks": [
                    {
                        "sourceId": "brand1",
                        "domain": "brand",
                        "title": "华与华方法",
                        "relativePath": "knowledge/brand/raw/华与华方法.epub",
                        "chunkIndex": 3,
                        "score": 0,
                        "text": "品牌策划要明确购买理由、品牌承诺、超级符号、终端动作和传播成本。",
                        "keywords": ["品牌策划", "购买理由", "品牌承诺", "超级符号", "终端动作", "传播成本"],
                    }
                ]
            },
        }

        results = build_cross_domain_personal_knowledge_results(
            domain="hxy",
            question="用华与华方法优化荷小悦品牌定位和超级符号",
            top_k=6,
            load_index=lambda domain: index_by_domain[domain],
        )

        self.assertEqual({result["domain"] for result in results}, {"hxy", "brand"})
        self.assertEqual(results[0]["domain"], "hxy")
        self.assertTrue(any(result["title"] == "华与华方法" for result in results))

    def test_hxy_project_brain_context_results_prepend_structured_project_brain(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            structured_dir = root / "knowledge" / "hxy" / "structured"
            structured_dir.mkdir(parents=True)
            (structured_dir / "brand-master-plan.json").write_text(
                json.dumps(
                    {
                        "version": "hxy-brand-master-plan.v1",
                        "executive_summary": "荷小悦是社区泡脚按摩小店，核心是家门口、真实有效、价格不心疼、能复购。",
                        "methodology_principles": [
                            {
                                "label": "购买理由",
                                "application": "真实有效、价格不心疼、离家近可信。",
                            }
                        ],
                        "sections": [
                            {
                                "title": "终端执行",
                                "content": ["门头突出草本现煮，按出真功夫。"],
                            }
                        ],
                        "risks": ["社区小店定位与银发健康科技平台不能同时作为当前主定位。"],
                    }
                ),
                encoding="utf-8",
            )
            (structured_dir / "osi-contract.json").write_text(
                json.dumps(
                    {
                        "version": "hxy-osi-contract.v1",
                        "domains": [
                            {
                                "label": "品牌定位 OSI",
                                "purpose": "拆开当前定位和远期愿景。",
                                "answer_boundaries": ["当前主定位、融资叙事、远期平台愿景必须分开表达。"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (structured_dir / "execution-playbook.json").write_text(
                json.dumps(
                    {
                        "version": "hxy-execution-playbook.v1",
                        "positioning_guardrail": "当前经营只讲社区泡脚按摩小店。",
                        "surfaces": [
                            {
                                "label": "门头/门店",
                                "objective": "让路过的人立刻知道荷小悦卖什么。",
                                "copy_blocks": ["草本真现煮，按出真功夫"],
                                "action_steps": ["门头只保留品牌名、品类和一句购买理由。"],
                                "do_not_say": ["我们是大健康生态平台。"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (structured_dir / "store-model.json").write_text(
                json.dumps(
                    {
                        "version": "hxy-store-model.v1",
                        "monthly_revenue": 142760,
                        "monthly_net_cashflow": 36467.2,
                        "payback_months": 5,
                        "caveats": ["这是样板店假设模型，不是已审计财务报表。"],
                    }
                ),
                encoding="utf-8",
            )
            (structured_dir / "pilot-validation-matrix.json").write_text(
                json.dumps(
                    {
                        "version": "hxy-pilot-validation-matrix.v1",
                        "items": [
                            {
                                "label": "套餐选择率",
                                "hypothesis": "三层菜单能让招牌款成为主销套餐。",
                                "evidence_source": "收银流水、套餐订单明细",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            deliverable_dir = root / "projects" / "hxy" / "deliverables"
            deliverable_dir.mkdir(parents=True)
            (deliverable_dir / "hxy-terminal-material-pack-v1.md").write_text(
                "\n".join(
                    [
                        "# 荷小悦终端物料包 v1",
                        "## 1. 门头与海报",
                        "- 草本真现煮，按出真功夫",
                        "## 2. 价格菜单",
                        "- 基础款",
                        "- 招牌款",
                        "- 尊享款",
                        "## 3. 技师服务话术卡",
                        "- 今天先帮你把这里放松开。",
                        "## 4. 私域跟进模板",
                        "- 今天护理建议已记录。",
                    ]
                ),
                encoding="utf-8",
            )

            results = build_hxy_project_brain_context_results(root)

        self.assertEqual(
            [result["sourceId"] for result in results],
            [
                "hxy-brand-master-plan",
                "hxy-terminal-material-pack",
                "hxy-execution-playbook",
                "hxy-store-model",
                "hxy-pilot-validation-matrix",
                "hxy-osi-contract",
            ],
        )
        self.assertIn("社区泡脚按摩小店", results[0]["text"])
        self.assertIn("技师服务话术卡", results[1]["text"])
        self.assertIn("今天护理建议已记录", results[1]["text"])
        self.assertIn("草本真现煮，按出真功夫", results[2]["text"])
        self.assertIn("月净现金流：36467.2", results[3]["text"])
        self.assertIn("套餐选择率", results[4]["text"])
        self.assertIn("当前主定位、融资叙事、远期平台愿景必须分开表达", results[5]["text"])

    def test_hxy_chat_template_uses_project_brain_context_before_raw_sources(self) -> None:
        payload = render_hxy_knowledge_chat(
            "荷小悦品牌定位怎么做",
            [
                {
                    "sourceId": "hxy-brand-master-plan",
                    "domain": "hxy",
                    "title": "HXY 品牌策划全案 v1",
                    "relativePath": "knowledge/hxy/structured/brand-master-plan.json",
                    "chunkIndex": 0,
                    "score": 1000,
                    "text": "荷小悦是社区泡脚按摩小店，核心是家门口、真实有效、价格不心疼、能复购。",
                },
                {
                    "sourceId": "brand1",
                    "domain": "brand",
                    "title": "华与华方法",
                    "relativePath": "knowledge/brand/raw/华与华方法.epub",
                    "chunkIndex": 3,
                    "score": 8,
                    "text": "购买理由、超级符号和终端动作要统一。",
                },
            ],
        )

        self.assertIn("HXY 项目大脑回答", payload["answer"])
        self.assertIn("社区泡脚按摩小店", payload["answer"])
        self.assertIn("项目大脑", payload["answer"])
        self.assertEqual(payload["citations"][0]["sourceId"], "hxy-brand-master-plan")

    def test_render_personal_knowledge_chat_with_llm_uses_citations_when_configured(self) -> None:
        results = [
            {
                "sourceId": "s1",
                "title": "华与华方法",
                "relativePath": "knowledge/brand/raw/华与华方法.epub",
                "chunkIndex": 0,
                "score": 8,
                "text": "品牌策划要明确购买理由、品牌承诺、超级符号、终端动作和传播成本。",
            }
        ]
        with patch.dict(
            os.environ,
            {
                "HETANG_PERSONAL_KNOWLEDGE_AI_BASE_URL": "https://example.test/v1",
                "HETANG_PERSONAL_KNOWLEDGE_AI_API_KEY": "test-key",
                "HETANG_PERSONAL_KNOWLEDGE_AI_MODEL": "test-model",
            },
        ):
            with patch("main.call_personal_knowledge_llm") as call_llm:
                call_llm.return_value = "基于引用，荷塘悦色应先定义购买理由，再统一超级符号。"

                payload = render_personal_knowledge_chat_with_llm("brand", "给荷塘悦色做品牌策划", results)

        call_llm.assert_called_once()
        self.assertIn("基于引用", payload["answer"])
        self.assertEqual(payload["answer_source"], "llm")
        self.assertEqual(payload["citations"][0]["title"], "华与华方法")

    def test_render_personal_knowledge_chat_with_llm_falls_back_without_config(self) -> None:
        results = [
            {
                "sourceId": "s1",
                "title": "华与华方法",
                "relativePath": "knowledge/brand/raw/华与华方法.epub",
                "chunkIndex": 0,
                "score": 8,
                "text": "品牌策划要明确购买理由、品牌承诺、超级符号、终端动作和传播成本。",
            }
        ]
        with patch.dict(
            os.environ,
            {"HETANG_PERSONAL_KNOWLEDGE_CLAUDE_DIR": "/tmp/missing-claude-config"},
            clear=True,
        ):
            payload = render_personal_knowledge_chat_with_llm("brand", "给荷塘悦色做品牌策划", results)

        self.assertEqual(payload["answer_source"], "template")
        self.assertIn("品牌策划回答", payload["answer"])
        self.assertEqual(payload["citations"][0]["title"], "华与华方法")

    def test_extract_openai_responses_message_reads_output_text(self) -> None:
        self.assertEqual(
            extract_openai_responses_message(
                {
                    "output": [
                        {
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "基于书籍证据的综合回答",
                                }
                            ]
                        }
                    ]
                }
            ),
            "基于书籍证据的综合回答",
        )

    def test_extract_anthropic_messages_text_reads_content_blocks(self) -> None:
        self.assertEqual(
            extract_anthropic_messages_text(
                {
                    "content": [
                        {"type": "text", "text": "基于书籍证据"},
                        {"type": "text", "text": "结合模型综合判断"},
                    ]
                }
            ),
            "基于书籍证据\n结合模型综合判断",
        )

    def test_load_claude_personal_knowledge_llm_config_reads_settings_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            claude_dir = Path(temp_dir)
            (claude_dir / "settings.json").write_text(
                json.dumps(
                    {
                        "env": {
                            "ANTHROPIC_AUTH_TOKEN": "test-token",
                            "ANTHROPIC_BASE_URL": "https://claude.example.test",
                        },
                        "model": "opus[1m]",
                        "effortLevel": "xhigh",
                    }
                ),
                encoding="utf-8",
            )

            config = load_claude_personal_knowledge_llm_config(claude_dir)

        self.assertEqual(config["base_url"], "https://claude.example.test")
        self.assertEqual(config["model"], "claude-opus-4-6")
        self.assertEqual(config["wire_api"], "anthropic_messages")
        self.assertEqual(config["api_key"], "test-token")
        self.assertEqual(config["auth_type"], "bearer")
        self.assertEqual(config["effort_level"], "xhigh")

    def test_normalize_claude_personal_knowledge_model_maps_code_aliases(self) -> None:
        self.assertEqual(normalize_claude_personal_knowledge_model("opus[1m]"), "claude-opus-4-6")
        self.assertEqual(
            normalize_claude_personal_knowledge_model("claude-opus-4-6[1m]"),
            "claude-opus-4-6",
        )
        self.assertEqual(
            normalize_claude_personal_knowledge_model("claude-haiku-4-5-20251001"),
            "claude-haiku-4-5-20251001",
        )

    def test_build_personal_knowledge_llm_request_uses_anthropic_messages(self) -> None:
        request_url, request_payload = build_personal_knowledge_llm_request(
            {
                "base_url": "https://claude.example.test",
                "model": "opus[1m]",
                "wire_api": "anthropic_messages",
                "effort_level": "xhigh",
            },
            "brand",
            "给荷塘悦色做品牌策划",
            [
                {
                    "title": "华与华方法",
                    "relativePath": "knowledge/brand/raw/华与华方法.epub",
                    "chunkIndex": 3,
                    "text": "品牌策划要明确购买理由、品牌承诺、超级符号、终端动作和传播成本。",
                }
            ],
        )

        self.assertEqual(request_url, "https://claude.example.test/v1/messages")
        self.assertEqual(request_payload["model"], "opus[1m]")
        self.assertIn("xhigh", request_payload["system"])
        self.assertEqual(request_payload["messages"][0]["role"], "user")
        self.assertIn("华与华方法", request_payload["messages"][0]["content"])

    def test_build_personal_knowledge_llm_request_labels_cross_domain_evidence(self) -> None:
        _, request_payload = build_personal_knowledge_llm_request(
            {
                "base_url": "https://claude.example.test",
                "model": "claude-opus-4-6",
                "wire_api": "anthropic_messages",
            },
            "hxy",
            "用华与华方法优化荷小悦品牌",
            [
                {
                    "domain": "hxy",
                    "title": "荷小悦_品牌策划全案",
                    "relativePath": "knowledge/hxy/raw/荷小悦_品牌策划全案.docx",
                    "chunkIndex": 0,
                    "text": "荷小悦定位社区泡脚按摩小店。",
                },
                {
                    "domain": "brand",
                    "title": "华与华方法",
                    "relativePath": "knowledge/brand/raw/华与华方法.epub",
                    "chunkIndex": 3,
                    "text": "品牌策划要明确购买理由、品牌承诺和超级符号。",
                },
            ],
        )

        content = request_payload["messages"][0]["content"]
        self.assertIn("知识域：hxy", content)
        self.assertIn("知识域：brand", content)

    def test_hxy_llm_request_includes_project_brain_assets(self) -> None:
        _, request_payload = build_personal_knowledge_llm_request(
            {
                "base_url": "https://claude.example.test",
                "model": "claude-opus-4-6",
                "wire_api": "anthropic_messages",
            },
            "hxy",
            "荷小悦样板店如何落地",
            [
                {
                    "domain": "hxy",
                    "sourceId": "hxy-execution-playbook",
                    "title": "HXY 终端执行手册 v1",
                    "relativePath": "knowledge/hxy/structured/execution-playbook.json",
                    "chunkIndex": 0,
                    "text": "门头/门店：文案：草本真现煮，按出真功夫。",
                },
                {
                    "domain": "hxy",
                    "sourceId": "hxy-store-model",
                    "title": "HXY 小店模型 v1",
                    "relativePath": "knowledge/hxy/structured/store-model.json",
                    "chunkIndex": 0,
                    "text": "月净现金流：36467.2。回本周期：5。",
                },
                {
                    "domain": "hxy",
                    "sourceId": "hxy-pilot-validation-matrix",
                    "title": "HXY 样板验证矩阵 v1",
                    "relativePath": "knowledge/hxy/structured/pilot-validation-matrix.json",
                    "chunkIndex": 0,
                    "text": "套餐选择率：证据：收银流水、套餐订单明细。",
                },
            ],
        )

        content = request_payload["messages"][0]["content"]
        self.assertIn("项目结构化资产与书籍证据", content)
        self.assertIn("HXY 终端执行手册 v1", content)
        self.assertIn("月净现金流：36467.2", content)
        self.assertIn("套餐选择率", content)
        self.assertIn("样板店验证", content)

    def test_hxy_llm_request_includes_terminal_material_pack_for_storefront_menu_script_and_private_domain(self) -> None:
        _, request_payload = build_personal_knowledge_llm_request(
            {
                "base_url": "https://claude.example.test",
                "model": "claude-opus-4-6",
                "wire_api": "anthropic_messages",
            },
            "hxy",
            "荷小悦门头菜单技师话术私域怎么落地",
            [
                {
                    "domain": "hxy",
                    "sourceId": "hxy-terminal-material-pack",
                    "title": "HXY 终端物料包 v1",
                    "relativePath": "projects/hxy/deliverables/hxy-terminal-material-pack-v1.md",
                    "chunkIndex": 0,
                    "text": "门头与海报：草本真现煮，按出真功夫。价格菜单：基础款、招牌款、尊享款。技师服务话术卡：今天先帮你把这里放松开。私域跟进模板：今天护理建议已记录。",
                },
                {
                    "domain": "brand",
                    "sourceId": "brand-method",
                    "title": "华与华方法",
                    "relativePath": "knowledge/brand/raw/华与华方法.epub",
                    "chunkIndex": 12,
                    "text": "品牌策划要把购买理由、视觉符号、货架呈现和终端动作统一起来。",
                },
            ],
        )

        content = request_payload["messages"][0]["content"]
        self.assertIn("HXY 终端物料包 v1", content)
        self.assertIn("技师服务话术卡", content)
        self.assertIn("私域跟进模板", content)
        self.assertIn("知识域：brand", content)

    def test_build_personal_knowledge_llm_headers_adds_anthropic_version(self) -> None:
        headers = build_personal_knowledge_llm_headers(
            {
                "api_key": "test-token",
                "wire_api": "anthropic_messages",
                "auth_type": "bearer",
            }
        )

        self.assertEqual(headers["authorization"], "Bearer test-token")
        self.assertEqual(headers["anthropic-version"], "2023-06-01")

    def test_brand_search_query_expands_brand_planning_terms(self) -> None:
        query = build_brand_knowledge_search_query("给荷塘悦色做品牌策划框架")

        self.assertIn("超级符号", query)
        self.assertIn("品牌资产", query)
        self.assertIn("定位", query)

    def test_brand_search_prioritizes_methodology_terms_over_loose_case_matches(self) -> None:
        results = search_personal_knowledge_index(
            {
                "chunks": [
                    {
                        "sourceId": "case",
                        "domain": "brand",
                        "title": "华与华超级符号案例集",
                        "relativePath": "knowledge/brand/raw/case.pdf",
                        "chunkIndex": 0,
                        "text": "某小说 app 有用户流失问题，需要通过榜单提升阅读留存。",
                        "keywords": ["华与华", "案例", "品牌"],
                    },
                    {
                        "sourceId": "method",
                        "domain": "brand",
                        "title": "华与华方法",
                        "relativePath": "knowledge/brand/raw/method.epub",
                        "chunkIndex": 0,
                        "text": "品牌策划要明确购买理由、品牌承诺、超级符号、终端动作和传播成本。",
                        "keywords": ["品牌策划", "购买理由", "品牌承诺", "超级符号", "终端动作", "传播成本"],
                    },
                ]
            },
            build_brand_knowledge_search_query("给荷塘悦色做品牌策划框架"),
            "brand",
            2,
        )

        self.assertEqual(results[0]["title"], "华与华方法")

    def test_brand_search_prefers_method_books_when_scores_are_close(self) -> None:
        results = search_personal_knowledge_index(
            {
                "chunks": [
                    {
                        "sourceId": "case",
                        "domain": "brand",
                        "title": "华与华超级符号案例集",
                        "relativePath": "knowledge/brand/raw/case.pdf",
                        "chunkIndex": 0,
                        "text": "品牌传播活动案例。",
                        "keywords": ["华与华", "品牌", "传播", "活动", "案例"],
                    },
                    {
                        "sourceId": "method",
                        "domain": "brand",
                        "title": "超级符号原理",
                        "relativePath": "knowledge/brand/raw/symbol.epub",
                        "chunkIndex": 0,
                        "text": "购买理由和超级符号要降低传播成本。",
                        "keywords": ["购买理由", "超级符号", "传播成本"],
                    },
                ]
            },
            build_brand_knowledge_search_query("品牌策划框架"),
            "brand",
            2,
        )

        self.assertEqual(results[0]["title"], "超级符号原理")

    def test_brand_search_penalizes_low_signal_design_story_chunks(self) -> None:
        results = search_personal_knowledge_index(
            {
                "chunks": [
                    {
                        "sourceId": "story",
                        "domain": "brand",
                        "title": "华与华方法",
                        "relativePath": "knowledge/brand/raw/method.epub",
                        "chunkIndex": 57,
                        "text": "这个封面不是根据书房收藏书柜设计的，能不能再弄一个内封，外面的销售用，里面的收藏用。",
                        "keywords": ["品牌", "华与华", "设计", "销售"],
                    },
                    {
                        "sourceId": "method",
                        "domain": "brand",
                        "title": "华与华方法",
                        "relativePath": "knowledge/brand/raw/method.epub",
                        "chunkIndex": 12,
                        "text": "品牌策划要把购买理由、品牌承诺、超级符号、终端动作和传播成本统一起来。",
                        "keywords": ["品牌策划", "购买理由", "品牌承诺", "超级符号", "终端动作", "传播成本"],
                    },
                ]
            },
            build_brand_knowledge_search_query("基于华与华书籍引用，给荷塘悦色做品牌策划框架"),
            "brand",
            2,
        )

        self.assertEqual(results[0]["chunkIndex"], 12)

    def test_upload_sanitizes_file_name_and_rebuilds_text_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"HETANG_ROOT_DIR": temp_dir}):
                saved_path = write_uploaded_personal_knowledge_file(
                    "management",
                    PersonalKnowledgeUploadRequest(
                        domain="management",
                        file_name="../店长管理.md",
                        content_base64=base64.b64encode(
                            "店长管理要把目标、动作、检查和反馈形成闭环。".encode("utf-8")
                        ).decode("ascii"),
                    ),
                )
                self.assertEqual(saved_path.name, "店长管理.md")

                summary = rebuild_personal_knowledge_index("management")
                self.assertEqual(summary["source_count"], 1)
                self.assertGreater(summary["chunk_count"], 0)

    def test_rebuild_personal_knowledge_index_uses_ts_builder_for_pdf_and_epub(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"HETANG_ROOT_DIR": temp_dir}):
                Path(temp_dir, "scripts").mkdir()
                Path(temp_dir, "scripts", "build-personal-knowledge-index.ts").write_text(
                    "// test builder",
                    encoding="utf-8",
                )
                Path(temp_dir, "knowledge", "brand", "raw").mkdir(parents=True)
                Path(temp_dir, "knowledge", "brand", "raw", "华与华方法.epub").write_bytes(b"fake epub")

                command = build_personal_knowledge_index_command("brand")
                self.assertEqual(command[:3], ["node", "--import", "tsx"])
                self.assertIn("--domain", command)
                self.assertIn("brand", command)

                with patch("main.subprocess.run") as run:
                    run.return_value = subprocess.CompletedProcess(command, 0, stdout="ok", stderr="")
                    summary = rebuild_personal_knowledge_index("brand")

                run.assert_called_once()
                self.assertEqual(summary["domain"], "brand")
                self.assertEqual(summary["builder"], "typescript")

    def test_build_personal_knowledge_index_command_ignores_invalid_node_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(
                os.environ,
                {"HETANG_ROOT_DIR": temp_dir, "HETANG_NODE_BIN": "/missing/node"},
            ):
                Path(temp_dir, "scripts").mkdir()
                Path(temp_dir, "scripts", "build-personal-knowledge-index.ts").write_text(
                    "// test builder",
                    encoding="utf-8",
                )

                command = build_personal_knowledge_index_command("brand")

        self.assertEqual(command[0], "node")

    def test_sanitize_personal_knowledge_file_name_rejects_unsupported_files(self) -> None:
        self.assertEqual(sanitize_personal_knowledge_file_name("../华与华.md"), "华与华.md")
        with self.assertRaises(Exception):
            sanitize_personal_knowledge_file_name("installer.apk")

    def test_render_personal_knowledge_export_plan_returns_markdown_with_citations(self) -> None:
        payload = render_personal_knowledge_export_plan(
            domain="brand",
            question="给荷塘悦色做品牌策划",
            answer="品牌策划回答\n一、书籍依据\n二、可落地策划框架",
            citations=[
                {
                    "title": "华与华超级符号案例集",
                    "relativePath": "knowledge/brand/raw/华与华超级符号案例集.pdf",
                    "chunkIndex": 0,
                    "score": 8,
                }
            ],
        )

        self.assertTrue(payload["file_name"].endswith(".md"))
        self.assertIn("# 荷塘个人知识助手导出", payload["markdown"])
        self.assertIn("华与华超级符号案例集", payload["markdown"])

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
        self.assertEqual(payload["contract_version"], CONTROL_PLANE_CONTRACT_VERSION)
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
        occurred_after = "2999-04-18T03:00:00.000Z"
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
            ("2999-04-18T03:00:00Z", deploy_marker),
        )
        self.assertTrue(
            all(
                params[0] == "2999-04-18T03:00:00Z" and params[1] == deploy_marker
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
