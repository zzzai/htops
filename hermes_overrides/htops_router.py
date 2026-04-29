from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence


PROJECT_ROOT = Path(os.getenv("HETANG_ROOT_DIR", str(Path(__file__).resolve().parents[1])))
DEFAULT_CONFIG_PATH = Path(os.getenv("HTOPS_CONFIG_PATH", str(PROJECT_ROOT / "htops.json")))

STRONG_DOMAIN_TERMS = (
    "门店",
    "五店",
    "总部",
    "营收",
    "业绩",
    "经营",
    "复盘",
    "日报",
    "周报",
    "月报",
    "团购",
    "储值",
    "充值",
    "点钟",
    "加钟",
    "钟效",
    "人效",
    "排班",
    "技师",
    "等待",
    "客单",
    "风险",
    "盘子",
    "大盘",
    "开卡",
    "卡消",
)
WEAK_DOMAIN_TERMS = (
    "顾客",
    "客户",
    "会员",
    "召回",
    "唤回",
    "复购",
    "留存",
    "流失",
    "名单",
    "画像",
    "生日",
    "标签",
    "余额",
    "卡项",
)
HIGH_FREQUENCY_METRIC_TERMS = (
    "客流",
    "客流量",
    "到店",
    "到店人数",
    "消费人数",
    "客数",
    "点钟率",
    "加钟率",
    "新增会员",
    "储值",
)
BUSINESS_ASK_HINTS = (
    "多少",
    "几",
    "如何",
    "咋样",
    "怎么样",
    "波动",
    "对比",
    "排名",
    "趋势",
)
TIME_HINT_PATTERN = re.compile(
    r"(今天|今日|昨天|昨日|明天|本周|本月|上周|上月|下周|下月|近\d+[天周月年]|最近\d+[天周月年])"
)
BUILD_REQUEST_VERBS = (
    "帮我做",
    "做个",
    "做一个",
    "做一版",
    "写个",
    "写一个",
    "生成",
    "开发",
    "搭个",
    "设计个",
)
BUILD_REQUEST_ARTIFACTS = (
    "h5",
    "页面",
    "网页",
    "界面",
    "前端",
    "详情页",
    "资料页",
    "详情资料",
    "html",
)
STORE_BRAND_PREFIX_PATTERN = re.compile(r"^荷塘悦色")
STORE_SUFFIX_PATTERN = re.compile(r"店$")
MIN_SAFE_SHORT_ALIAS_CHARS = 3


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value).strip().lower()


def _dedupe_normalized(values: Sequence[str]) -> tuple[str, ...]:
    ordered: list[str] = []
    seen: set[str] = set()
    for entry in values:
        trimmed = entry.strip()
        normalized = _normalize_text(trimmed)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(trimmed)
    return tuple(ordered)


def _resolve_safe_short_alias(alias: str) -> str | None:
    if not STORE_SUFFIX_PATTERN.search(alias):
        return None
    shortened = STORE_SUFFIX_PATTERN.sub("", alias).strip()
    return shortened if len(shortened) >= MIN_SAFE_SHORT_ALIAS_CHARS else None


def _expand_store_alias_variants(aliases: Sequence[str]) -> tuple[str, ...]:
    expanded: list[str] = []
    for alias in aliases:
        trimmed = alias.strip()
        if not trimmed:
            continue
        expanded.append(trimmed)

        brandless = STORE_BRAND_PREFIX_PATTERN.sub("", trimmed).strip()
        if brandless and brandless != trimmed:
            expanded.append(brandless)
            short_brandless = _resolve_safe_short_alias(brandless)
            if short_brandless:
                expanded.append(short_brandless)
            continue

        short_alias = _resolve_safe_short_alias(trimmed)
        if short_alias:
            expanded.append(short_alias)

    return _dedupe_normalized(expanded)


def _looks_like_build_request(normalized_text: str) -> bool:
    return any(verb in normalized_text for verb in BUILD_REQUEST_VERBS) and any(
        artifact in normalized_text for artifact in BUILD_REQUEST_ARTIFACTS
    )


def _extract_config_candidate(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    if "stores" in raw and isinstance(raw.get("stores"), list):
        return raw

    plugin_config = (
        raw.get("plugins", {})
        .get("entries", {})
        .get("hetang-ops", {})
        .get("config")
    )
    return plugin_config if isinstance(plugin_config, dict) else {}


def _dedupe_preserving_order(values: Sequence[str]) -> tuple[str, ...]:
    ordered: list[str] = []
    seen: set[str] = set()
    for entry in values:
        normalized = entry.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return tuple(ordered)


@lru_cache(maxsize=8)
def resolve_store_aliases(config_path: str | None = None) -> tuple[str, ...]:
    candidate_path = Path(config_path).expanduser() if config_path else DEFAULT_CONFIG_PATH
    try:
        raw = json.loads(candidate_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ()

    config = _extract_config_candidate(raw)
    aliases: list[str] = []
    for store in config.get("stores", []):
        if not isinstance(store, dict):
            continue
        store_name = store.get("storeName")
        if isinstance(store_name, str) and store_name.strip():
            aliases.append(store_name.strip())
        raw_aliases = store.get("rawAliases")
        if isinstance(raw_aliases, list):
            aliases.extend(
                entry.strip() for entry in raw_aliases if isinstance(entry, str) and entry.strip()
            )
    return _dedupe_preserving_order(aliases)


def should_route_to_htops(text: str, store_aliases: Sequence[str] | None = None) -> bool:
    normalized_text = _normalize_text(text)
    if not normalized_text or normalized_text.startswith("/"):
        return False
    if _looks_like_build_request(normalized_text):
        return False

    aliases = store_aliases if store_aliases is not None else resolve_store_aliases()
    normalized_aliases = [
        _normalize_text(alias)
        for alias in _expand_store_alias_variants(aliases)
        if alias and alias.strip()
    ]
    if any(alias and alias in normalized_text for alias in normalized_aliases):
        return True

    if any(term in normalized_text for term in STRONG_DOMAIN_TERMS):
        return True

    if any(term in normalized_text for term in HIGH_FREQUENCY_METRIC_TERMS) and (
        TIME_HINT_PATTERN.search(normalized_text) is not None
        or any(term in normalized_text for term in BUSINESS_ASK_HINTS)
    ):
        return True

    weak_match_count = sum(1 for term in WEAK_DOMAIN_TERMS if term in normalized_text)
    if weak_match_count >= 2:
        return True

    return weak_match_count >= 1 and TIME_HINT_PATTERN.search(normalized_text) is not None
