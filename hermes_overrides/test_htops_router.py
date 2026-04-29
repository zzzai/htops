from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("htops_router.py")
MODULE_SPEC = importlib.util.spec_from_file_location("htops_router", MODULE_PATH)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError(f"Unable to load module spec for {MODULE_PATH}")
MODULE = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(MODULE)

resolve_store_aliases = MODULE.resolve_store_aliases
should_route_to_htops = MODULE.should_route_to_htops


class HtopsRouterTest(unittest.TestCase):
    def test_routes_store_specific_questions_to_htops(self) -> None:
        self.assertTrue(
            should_route_to_htops(
                "迎宾店近7天经营复盘",
                store_aliases=("荷塘悦色迎宾店", "迎宾店"),
            )
        )

    def test_routes_business_domain_questions_to_htops_without_store_name(self) -> None:
        self.assertTrue(should_route_to_htops("会员召回优先级怎么排"))

    def test_does_not_route_h5_build_requests_even_with_business_terms(self) -> None:
        self.assertFalse(
            should_route_to_htops(
                "帮我做个看技师详情资料的H5页面",
                store_aliases=("荷塘悦色迎宾店", "迎宾店", "义乌店"),
            )
        )

    def test_routes_shortened_store_alias_business_questions_to_htops(self) -> None:
        self.assertTrue(
            should_route_to_htops(
                "园中园 昨天 客流量",
                store_aliases=("荷塘悦色园中园店", "园中园店"),
            )
        )
        self.assertTrue(
            should_route_to_htops(
                "园中园 昨天 到店人数",
                store_aliases=("荷塘悦色园中园店", "园中园店"),
            )
        )

    def test_routes_high_frequency_store_metrics_without_explicit_store_name(self) -> None:
        self.assertTrue(should_route_to_htops("昨天客流量多少"))
        self.assertTrue(should_route_to_htops("昨天到店人数"))
        self.assertTrue(should_route_to_htops("今日点钟率多少"))

    def test_keeps_general_chat_inside_hermes(self) -> None:
        self.assertFalse(should_route_to_htops("dvdfsvf"))
        self.assertFalse(should_route_to_htops("今天天气怎么样"))
        self.assertFalse(should_route_to_htops("你是谁"))

    def test_loads_store_aliases_from_htops_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "htops.json"
            config_path.write_text(
                json.dumps(
                    {
                        "api": {"appKey": "demo", "appSecret": "demo"},
                        "stores": [
                            {
                                "storeName": "荷塘悦色迎宾店",
                                "rawAliases": ["迎宾店", "迎宾"],
                            },
                            {
                                "storeName": "荷塘悦色义乌店",
                                "rawAliases": ["义乌店"],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            aliases = resolve_store_aliases(str(config_path))

            self.assertEqual(
                aliases,
                (
                    "荷塘悦色迎宾店",
                    "迎宾店",
                    "迎宾",
                    "荷塘悦色义乌店",
                    "义乌店",
                ),
            )


if __name__ == "__main__":
    unittest.main()
