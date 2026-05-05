#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any
from urllib import error, request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Repo-local CrewAI sidecar wrapper for Hetang analysis",
    )
    parser.add_argument("--org", required=True, help="Store OrgId")
    parser.add_argument("--start", required=True, help="Start biz_date, YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="End biz_date, YYYY-MM-DD")
    parser.add_argument(
        "--print-context",
        action="store_true",
        help="Only print the structured analysis context",
    )
    return parser.parse_args()


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _format_money(value: Any) -> str:
    return f"{_as_float(value):.2f} 元"


def _format_count(value: Any, digits: int = 1) -> str:
    return f"{_as_float(value):.{digits}f}"


def _format_percent(value: Any, digits: int = 1) -> str:
    if value is None:
        return "当前未接入/未可信"
    return f"{_as_float(value) * 100:.{digits}f}%"


def _strip_list_marker(value: str) -> str:
    return re.sub(r"^(?:\d+[.)、]|[-*])\s*", "", value.strip())


def _extract_json_object(text: str) -> dict[str, Any] | None:
    trimmed = text.strip()
    if not trimmed:
        return None

    attempts = [trimmed]
    code_fence_match = re.fullmatch(r"```(?:json)?\s*([\s\S]*?)\s*```", trimmed)
    if code_fence_match and code_fence_match.group(1):
        attempts.append(code_fence_match.group(1).strip())

    first_brace_index = trimmed.find("{")
    last_brace_index = trimmed.rfind("}")
    if first_brace_index >= 0 and last_brace_index > first_brace_index:
        attempts.append(trimmed[first_brace_index : last_brace_index + 1])

    for attempt in attempts:
        try:
            parsed = json.loads(attempt)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _normalize_lines(values: Any) -> list[str]:
    if isinstance(values, str):
        return _normalize_lines(values.splitlines())
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = _strip_list_marker(str(item or ""))
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def _normalize_review_payload(payload: dict[str, Any], fallback_pack: dict[str, Any]) -> dict[str, Any]:
    summary = str(payload.get("summary") or "").strip()
    risks = _normalize_lines(payload.get("risks"))
    suggestions = _normalize_lines(payload.get("suggestions"))
    markdown = str(payload.get("markdown") or "").strip()
    review_mode = str(payload.get("review_mode") or payload.get("reviewMode") or "direct").strip()

    if not summary and markdown:
        first_line = next((line.strip() for line in markdown.splitlines() if line.strip()), "")
        summary = _strip_list_marker(first_line)
    if not markdown:
        markdown = build_local_fallback_payload(fallback_pack)["markdown"]

    return {
        "output_version": "v1",
        "review_mode": review_mode or "direct",
        "summary": summary,
        "risks": risks,
        "suggestions": suggestions,
        "markdown": markdown,
    }


def _load_evidence_pack_from_env() -> dict[str, Any] | None:
    raw_json = os.environ.get("HETANG_ANALYSIS_EVIDENCE_JSON", "").strip()
    raw_markdown = os.environ.get("HETANG_ANALYSIS_EVIDENCE_MARKDOWN", "").strip()

    pack: dict[str, Any] | None = None
    if raw_json:
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as error_detail:
            raise SystemExit(f"HETANG_ANALYSIS_EVIDENCE_JSON is invalid: {error_detail}") from error_detail
        if isinstance(parsed, dict):
            pack = parsed
        else:
            raise SystemExit("HETANG_ANALYSIS_EVIDENCE_JSON must decode to a JSON object")

    if pack is None and not raw_markdown:
        return None

    if pack is None:
        pack = {}

    if raw_markdown and not pack.get("markdown"):
        pack["markdown"] = raw_markdown
    pack.setdefault("packVersion", "v1")
    pack.setdefault("scopeType", "single_store")
    pack.setdefault("orgIds", [])
    pack.setdefault("storeName", "")
    pack.setdefault("question", "")
    pack.setdefault("timeFrameLabel", "")
    pack.setdefault("startBizDate", "")
    pack.setdefault("endBizDate", "")
    pack.setdefault("facts", {})
    return pack


def _load_diagnostic_bundle_from_env() -> dict[str, Any] | None:
    raw_json = os.environ.get("HETANG_ANALYSIS_DIAGNOSTIC_JSON", "").strip()
    if not raw_json:
        return None
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as error_detail:
        raise SystemExit(f"HETANG_ANALYSIS_DIAGNOSTIC_JSON is invalid: {error_detail}") from error_detail
    if not isinstance(parsed, dict):
        raise SystemExit("HETANG_ANALYSIS_DIAGNOSTIC_JSON must decode to a JSON object")
    return parsed


def _load_orchestration_plan_from_env() -> dict[str, Any] | None:
    raw_json = os.environ.get("HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON", "").strip()
    if not raw_json:
        return None
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as error_detail:
        raise SystemExit(f"HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON is invalid: {error_detail}") from error_detail
    if not isinstance(parsed, dict):
        raise SystemExit("HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON must decode to a JSON object")
    return parsed


def build_print_context(
    args: argparse.Namespace,
    evidence_pack: dict[str, Any],
    diagnostic_bundle: dict[str, Any] | None,
    orchestration_plan: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "org_id": args.org,
        "start_biz_date": args.start,
        "end_biz_date": args.end,
        "review_mode": os.environ.get("CREWAI_REVIEW_MODE", "direct").strip().lower() or "direct",
        "evidence_markdown": str(
            evidence_pack.get("markdown")
            or os.environ.get("HETANG_ANALYSIS_EVIDENCE_MARKDOWN", "")
        ),
        "evidence_pack": evidence_pack,
        "diagnostic_bundle": diagnostic_bundle,
        "orchestration_plan": orchestration_plan,
    }


def _resolve_latest_metrics(pack: dict[str, Any]) -> dict[str, Any]:
    facts = pack.get("facts")
    if isinstance(facts, dict):
        latest_report = facts.get("latestReport")
        if isinstance(latest_report, dict):
            metrics = latest_report.get("metrics")
            if isinstance(metrics, dict):
                return metrics
    return {}


def _resolve_review7d(pack: dict[str, Any]) -> dict[str, Any]:
    facts = pack.get("facts")
    if isinstance(facts, dict):
        review = facts.get("review7d")
        if isinstance(review, dict):
            return review
    return {}


def _resolve_summary30d(pack: dict[str, Any]) -> dict[str, Any]:
    facts = pack.get("facts")
    if isinstance(facts, dict):
        summary = facts.get("summary30d")
        if isinstance(summary, dict):
            return summary
    return {}


def _resolve_top_techs(pack: dict[str, Any]) -> list[dict[str, Any]]:
    facts = pack.get("facts")
    if isinstance(facts, dict):
        top_techs = facts.get("topTechs")
        if isinstance(top_techs, list):
            return [entry for entry in top_techs if isinstance(entry, dict)]
    return []


def _resolve_portfolio_reports(pack: dict[str, Any]) -> list[dict[str, Any]]:
    facts = pack.get("facts")
    if isinstance(facts, dict):
        reports = facts.get("latestReports")
        if isinstance(reports, list):
            return [entry for entry in reports if isinstance(entry, dict)]
    return []


def _resolve_portfolio_snapshots(pack: dict[str, Any]) -> list[dict[str, Any]]:
    facts = pack.get("facts")
    if isinstance(facts, dict):
        snapshots = facts.get("portfolioSnapshots")
        if isinstance(snapshots, list):
            return [entry for entry in snapshots if isinstance(entry, dict)]
    return []


def _resolve_snapshot_latest_metrics(snapshot: dict[str, Any]) -> dict[str, Any]:
    latest_report = snapshot.get("latestReport")
    if isinstance(latest_report, dict):
        metrics = latest_report.get("metrics")
        if isinstance(metrics, dict):
            return metrics
    return {}


def _resolve_snapshot_review7d(snapshot: dict[str, Any]) -> dict[str, Any]:
    review = snapshot.get("review7d")
    if isinstance(review, dict):
        return review
    return {}


def _resolve_snapshot_summary30d(snapshot: dict[str, Any]) -> dict[str, Any]:
    summary = snapshot.get("summary30d")
    if isinstance(summary, dict):
        return summary
    return {}


def _pick_portfolio_lead_snapshot(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    if not snapshots:
        return {}
    return max(
        snapshots,
        key=lambda snapshot: (
            _as_float(_resolve_snapshot_latest_metrics(snapshot).get("serviceRevenue")),
            _as_float(_resolve_snapshot_summary30d(snapshot).get("revenue30d")),
        ),
    )


def _pick_portfolio_risk_snapshot(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    if not snapshots:
        return {}
    return max(
        snapshots,
        key=lambda snapshot: (
            _as_float(_resolve_snapshot_summary30d(snapshot).get("renewalPressureIndex30d")),
            _as_float(_resolve_snapshot_summary30d(snapshot).get("sleepingMemberRate")),
            -_as_float(_resolve_snapshot_summary30d(snapshot).get("clockEffect30d")),
            -_as_float(_resolve_snapshot_summary30d(snapshot).get("revenue30d")),
        ),
    )


def _build_evidence_block(evidence_markdown: str) -> list[str]:
    normalized = evidence_markdown.strip()
    if not normalized:
        return ["证据包", "- 当前未提供证据包 markdown"]
    if normalized.startswith("证据包"):
        return normalized.splitlines()
    return ["证据包", normalized]


def _normalize_signal_entries(diagnostic_bundle: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not diagnostic_bundle:
        return []
    signals = diagnostic_bundle.get("signals")
    if not isinstance(signals, list):
        return []
    return [entry for entry in signals if isinstance(entry, dict)]


def build_local_fallback_payload(
    pack: dict[str, Any],
    diagnostic_bundle: dict[str, Any] | None = None,
    error_detail: Exception | None = None,
) -> dict[str, Any]:
    scope_type = str(pack.get("scopeType") or "single_store")
    store_name = str(pack.get("storeName") or "门店").strip() or "门店"
    timeframe = str(pack.get("timeFrameLabel") or "").strip()
    start_biz_date = str(pack.get("startBizDate") or "").strip()
    end_biz_date = str(pack.get("endBizDate") or "").strip()
    question = str(pack.get("question") or "").strip()
    evidence_markdown = str(pack.get("markdown") or "").strip()
    signals = _normalize_signal_entries(diagnostic_bundle)

    if scope_type == "portfolio":
        snapshots = _resolve_portfolio_snapshots(pack)
        report_count = len(snapshots)
        lead_snapshot = _pick_portfolio_lead_snapshot(snapshots)
        risk_snapshot = _pick_portfolio_risk_snapshot(snapshots)
        lead_metrics = _resolve_snapshot_latest_metrics(lead_snapshot)
        lead_summary30d = _resolve_snapshot_summary30d(lead_snapshot)
        risk_review7d = _resolve_snapshot_review7d(risk_snapshot)
        risk_summary30d = _resolve_snapshot_summary30d(risk_snapshot)
        lead_store_name = str(lead_snapshot.get("storeName") or store_name).strip() or store_name
        risk_store_name = str(risk_snapshot.get("storeName") or "").strip()

        if report_count == 0:
            reports = _resolve_portfolio_reports(pack)
            report_count = len(reports)
            ranked_reports = sorted(
                reports,
                key=lambda report: _as_float((report.get("metrics") or {}).get("serviceRevenue")),
                reverse=True,
            )
            lead_report = ranked_reports[0] if ranked_reports else {}
            lead_metrics = lead_report.get("metrics") if isinstance(lead_report, dict) else {}
            lead_summary30d = {}
            risk_review7d = {}
            risk_summary30d = {}
            lead_store_name = str(lead_report.get("storeName") or store_name).strip() or store_name
            risk_store_name = ""

        summary_parts = [
            f"先说结论：{store_name}{timeframe or '当前周期'}经营复盘先按证据包解读，总部视角先盯门店分层和最危险门店。"
        ]
        if report_count > 0:
            sample_label = "稳定快照样本" if snapshots else "最新日报样本"
            summary_parts.append(f"当前证据包覆盖 {report_count} 家门店的{sample_label}。")
        if isinstance(lead_metrics, dict) and lead_metrics:
            summary_parts.append(
                f"样本里营收最高门店是 {lead_store_name}，营收 {_format_money(lead_metrics.get('serviceRevenue'))}，总钟数 {_format_count(lead_metrics.get('totalClockCount'))} 个。"
            )
        elif isinstance(lead_summary30d, dict) and lead_summary30d:
            summary_parts.append(
                f"稳定样本里盘子相对更强的是 {lead_store_name}，近30天营收 {_format_money(lead_summary30d.get('revenue30d'))}，钟效 {_format_count(lead_summary30d.get('clockEffect30d'))}。"
            )
        if risk_store_name:
            summary_parts.append(
                f"当前最需要总部优先盯的是 {risk_store_name}，近30天续费压力 {_format_count(risk_summary30d.get('renewalPressureIndex30d'), 2)}、沉默会员率 {_format_percent(risk_summary30d.get('sleepingMemberRate'))}。"
            )
        summary = " ".join(summary_parts)
        risks: list[str] = []
        for signal in signals[:3]:
            title = str(signal.get("title") or "").strip()
            finding = str(signal.get("finding") or "").strip()
            if finding:
                risks.append(f"{title}: {finding}" if title else finding)
        if risk_store_name:
            risks.append(
                f"{risk_store_name} 近30天续费压力 {_format_count(risk_summary30d.get('renewalPressureIndex30d'), 2)}、沉默会员率 {_format_percent(risk_summary30d.get('sleepingMemberRate'))}，当前是总部优先处置门店。"
            )
            review_revenue7d = risk_review7d.get("revenue7d")
            review_clock_effect7d = risk_review7d.get("clockEffect7d")
            if review_revenue7d or review_clock_effect7d:
                risks.append(
                    f"{risk_store_name} 近7天营收 {_format_money(review_revenue7d)}、钟效 {_format_count(review_clock_effect7d)}，短周期承接偏弱。"
                )
        risks.append("当前总部复盘仍是证据包优先版本，尚未展开完整多门店因果诊断。")
        if not snapshots:
            risks.append("如果门店之间的数据完整度不一致，需要先按已落库日报样本做分层，再决定总部动作。")

        suggestions: list[str] = []
        for signal in signals[:3]:
            recommended_focus = str(signal.get("recommendedFocus") or "").strip()
            if recommended_focus:
                suggestions.append(recommended_focus)
        if risk_store_name:
            suggestions.append(
                f"总部先盯 {risk_store_name} 的会员回流和班次承接，今天先核对续费压力、沉默会员名单和高峰班次承接。"
            )
        if lead_store_name and risk_store_name and lead_store_name != risk_store_name:
            suggestions.append(
                f"本周抽 {lead_store_name} 和 {risk_store_name} 做对比复盘，复制强店承接动作并沉淀风险预警阈值。"
            )
        suggestions.append("总部先把证据包扩成固定模板，后续 bounded analysis 才能稳定比较多门店经营差异。")
        markdown_lines = [
            f"{store_name} {timeframe or '当前周期'}总部经营复盘",
            "",
            *_build_evidence_block(evidence_markdown),
            "",
            "结论摘要",
            f"- {summary}",
            "",
            "诊断信号",
        ]
        markdown_lines.extend(
            f"- {str(signal.get('title') or '信号')}: {str(signal.get('finding') or '').strip()}"
            for signal in signals[:3]
            if str(signal.get("finding") or "").strip()
        )
        if risk_store_name:
            markdown_lines.extend([
                "",
                "总部经营快照",
                f"- 重点门店：{risk_store_name}",
                f"- 近30天营收：{_format_money(risk_summary30d.get('revenue30d'))}",
                f"- 近30天钟效：{_format_count(risk_summary30d.get('clockEffect30d'))}",
                f"- 沉默会员率：{_format_percent(risk_summary30d.get('sleepingMemberRate'))}",
                f"- 续费压力：{_format_count(risk_summary30d.get('renewalPressureIndex30d'), 2)}",
            ])
        markdown_lines.extend([
            "",
            "风险与建议",
        ])
        markdown_lines.extend(f"- {risk}" for risk in risks)
        markdown_lines.extend(["", "店长动作建议"])
        markdown_lines.extend(
            f"{index + 1}. {suggestion}" for index, suggestion in enumerate(suggestions)
        )
        if error_detail is not None:
            markdown_lines.extend(["", "完成摘要", "- 本次使用本地 evidence-pack fallback 输出。"])
        return {
            "output_version": "v1",
            "review_mode": "evidence-local-fallback",
            "summary": summary,
            "risks": risks,
            "suggestions": suggestions,
            "markdown": "\n".join(markdown_lines),
        }

    latest_metrics = _resolve_latest_metrics(pack)
    review7d = _resolve_review7d(pack)
    summary30d = _resolve_summary30d(pack)
    top_techs = _resolve_top_techs(pack)

    review_revenue = review7d.get("revenue7d")
    review_clocks = review7d.get("totalClocks7d")
    review_clock_effect = review7d.get("clockEffect7d")
    point_clock_rate = latest_metrics.get("pointClockRate", review7d.get("pointClockRate7d"))
    add_clock_rate = latest_metrics.get("addClockRate", review7d.get("addClockRate7d"))
    sleeping_member_rate = latest_metrics.get(
        "sleepingMemberRate",
        review7d.get("sleepingMemberRate"),
    )

    summary_parts = [
        f"先说结论：{store_name}{timeframe or '当前周期'}经营复盘先按证据包解读，当前重点还是守住营收、钟数、钟效和会员承接。"
    ]
    if review_revenue or review_clocks:
        summary_parts.append(
            f"{timeframe or '当前周期'}已汇总营收 {_format_money(review_revenue)}、总钟数 {_format_count(review_clocks)} 个、钟效 {_format_money(review_clock_effect)}。"
        )
    if point_clock_rate is not None:
        summary_parts.append(f"点钟率 {_format_percent(point_clock_rate)}。")
    if add_clock_rate is not None:
        summary_parts.append(f"加钟率 {_format_percent(add_clock_rate)}。")
    summary = " ".join(summary_parts)

    risks: list[str] = []
    for signal in signals[:3]:
        title = str(signal.get("title") or "").strip()
        finding = str(signal.get("finding") or "").strip()
        if finding:
            risks.append(f"{title}: {finding}" if title else finding)
    if point_clock_rate is not None and _as_float(point_clock_rate) >= 0.35:
        risks.append(f"点钟率 {_format_percent(point_clock_rate)} 偏高，存在客流向头部技师集中的结构风险。")
    if add_clock_rate is not None and _as_float(add_clock_rate) < 0.08:
        risks.append(f"加钟率 {_format_percent(add_clock_rate)} 偏低，服务后半程承接偏弱。")
    if sleeping_member_rate is not None and _as_float(sleeping_member_rate) >= 0.18:
        risks.append(f"沉默会员率 {_format_percent(sleeping_member_rate)}，会员激活压力偏大。")
    if not risks:
        risks.append("当前未看到极端异常，但仍需盯住营收、钟数、会员转化的联动变化。")

    suggestions: list[str] = []
    for signal in signals[:3]:
        recommended_focus = str(signal.get("recommendedFocus") or "").strip()
        if recommended_focus:
            suggestions.append(recommended_focus)
    if add_clock_rate is not None:
        suggestions.append(
            f"针对当前加钟率 {_format_percent(add_clock_rate)}，今天先统一服务后半程加钟话术，优先提升基础项目的延钟承接。"
        )
    if point_clock_rate is not None:
        suggestions.append(
            f"针对当前点钟率 {_format_percent(point_clock_rate)}，本周重排高峰班次并给承接偏弱技师做带教，缓解点钟集中。"
        )
    if sleeping_member_rate is not None:
        suggestions.append(
            f"针对沉默会员率 {_format_percent(sleeping_member_rate)}，今天先抽沉默会员名单做回访，目标提升本周到店回流。"
        )
    if top_techs:
        top_tech = top_techs[0]
        suggestions.append(
            f"针对头部技师 {top_tech.get('personName') or '样本技师'}，同步复盘点钟和加钟承接动作，抽出可复制话术给全员复用。"
        )
    while len(suggestions) < 3:
        suggestions.append("今天班前会继续把营收、钟数、钟效拆开盯，先守住基础经营盘，再做增量动作。")

    thirty_day_revenue = summary30d.get("revenue30d")
    thirty_day_clock_effect = summary30d.get("clockEffect30d")
    markdown_lines = [
        f"{store_name} {timeframe or '当前周期'}经营复盘",
        "",
        *_build_evidence_block(evidence_markdown),
        "",
        "结论摘要",
        f"- {summary}",
        "",
        "经营快照",
        f"- 周期：{start_biz_date} 至 {end_biz_date}",
        f"- 问题：{question or '经营复盘'}",
        f"- 近7天营收：{_format_money(review_revenue)}",
        f"- 近7天总钟数：{_format_count(review_clocks)} 个",
        f"- 近7天钟效：{_format_money(review_clock_effect)}",
        f"- 近30天营收：{_format_money(thirty_day_revenue)}",
        f"- 近30天钟效：{_format_money(thirty_day_clock_effect)}",
        f"- 点钟率：{_format_percent(point_clock_rate)}",
        f"- 加钟率：{_format_percent(add_clock_rate)}",
        "",
        "诊断信号",
    ]
    markdown_lines.extend(
        f"- {str(signal.get('title') or '信号')}: {str(signal.get('finding') or '').strip()}"
        for signal in signals[:3]
        if str(signal.get("finding") or "").strip()
    )
    markdown_lines.extend([
        "",
        "风险与建议",
    ])
    markdown_lines.extend(f"- {risk}" for risk in risks)
    markdown_lines.extend(["", "店长动作建议"])
    markdown_lines.extend(
        f"{index + 1}. {suggestion}" for index, suggestion in enumerate(suggestions[:5])
    )
    if error_detail is not None:
        markdown_lines.extend(["", "完成摘要", "- 本次使用本地 evidence-pack fallback 输出。"])

    return {
        "output_version": "v1",
        "review_mode": "evidence-local-fallback",
        "summary": summary,
        "risks": risks[:6],
        "suggestions": suggestions[:5],
        "markdown": "\n".join(markdown_lines),
    }


def _resolve_model_name() -> str:
    return (
        os.environ.get("CREWAI_MODEL", "").strip()
        or os.environ.get("OPENAI_MODEL", "").strip()
        or "gpt-5.4"
    )


def _resolve_api_key() -> str:
    return (
        os.environ.get("CREWAI_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )


def _resolve_base_url() -> str:
    return (
        os.environ.get("CREWAI_BASE_URL", "").strip()
        or os.environ.get("OPENAI_BASE_URL", "").strip()
        or "https://api.openai.com/v1"
    )


def _resolve_chat_completions_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _read_response_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        return "".join(parts)
    return ""


def _build_diagnostic_prompt_block(diagnostic_bundle: dict[str, Any] | None) -> str:
    signals = _normalize_signal_entries(diagnostic_bundle)
    if not signals:
        return "诊断信号：\n- 当前未提供诊断信号，请仅基于证据包输出。"

    lines = ["诊断信号："]
    for index, signal in enumerate(signals[:5], start=1):
        title = str(signal.get("title") or f"信号 {index}").strip() or f"信号 {index}"
        finding = str(signal.get("finding") or "").strip() or "当前未提供诊断结论"
        evidence = str(signal.get("evidence") or "").strip()
        recommended_focus = str(signal.get("recommendedFocus") or "").strip()
        lines.append(f"{index}. {title}")
        lines.append(f"   - 发现: {finding}")
        if evidence:
            lines.append(f"   - 证据: {evidence}")
        if recommended_focus:
            lines.append(f"   - 建议聚焦: {recommended_focus}")

    return "\n".join(lines)


def _build_orchestration_prompt_block(orchestration_plan: dict[str, Any] | None) -> str:
    if not orchestration_plan:
        return "本轮编排计划：\n- 当前未提供编排计划，请按诊断信号和证据包自行收敛。"

    focus_areas = _normalize_lines(orchestration_plan.get("focusAreas"))
    priority_actions = _normalize_lines(orchestration_plan.get("priorityActions"))
    decision_steps = _normalize_lines(orchestration_plan.get("decisionSteps"))
    output_contract = _normalize_lines(orchestration_plan.get("outputContract"))

    lines = ["本轮编排计划："]
    if focus_areas:
        lines.append("- 聚焦主题:")
        lines.extend([f"  - {item}" for item in focus_areas[:3]])
    if priority_actions:
        lines.append("- 优先动作:")
        lines.extend([f"  - {item}" for item in priority_actions[:3]])
    if decision_steps:
        lines.append("- 编排步骤:")
        lines.extend([f"  - {item}" for item in decision_steps[:3]])
    if output_contract:
        lines.append("- 输出约束:")
        lines.extend([f"  - {item}" for item in output_contract[:5]])
    return "\n".join(lines)


def build_evidence_prompt(
    pack: dict[str, Any],
    diagnostic_bundle: dict[str, Any] | None = None,
    orchestration_plan: dict[str, Any] | None = None,
) -> str:
    scope_type = str(pack.get("scopeType") or "single_store")
    markdown = str(pack.get("markdown") or "").strip()
    facts = pack.get("facts") if isinstance(pack.get("facts"), dict) else {}
    question = str(pack.get("question") or "").strip() or "经营复盘"
    store_name = str(pack.get("storeName") or "门店").strip() or "门店"
    timeframe = str(pack.get("timeFrameLabel") or "当前周期").strip() or "当前周期"

    return (
        "你是何棠门店经营分析顾问。\n"
        "请只基于给定证据包输出一个 JSON 对象，不要输出 JSON 之外的任何内容。\n\n"
        "JSON 字段要求：\n"
        '1. summary: 3 到 5 句中文总结，先说结论。\n'
        '2. risks: 字符串数组，列出 3 到 6 条风险或异常。\n'
        '3. suggestions: 字符串数组，列出 3 到 5 条动作建议；每条必须包含“目标对象/人群 + 动作 + 目标变化”。\n'
        '4. markdown: 一份管理层可直接阅读的正文，必须包含这些标题：结论摘要、风险与建议、店长动作建议。\n\n'
        "约束：\n"
        "- 只能基于证据包判断，禁止编造未提供的事实。\n"
        "- 证据不足时必须明确写“当前未接入/证据不足”。\n"
        "- query 侧已经做过确定性取证，这里只能做总结、诊断和动作建议，不能改写事实。\n"
        f"- 当前 scopeType={scope_type}，问题={question}，对象={store_name}，周期={timeframe}。\n\n"
        f"{_build_diagnostic_prompt_block(diagnostic_bundle)}\n\n"
        f"{_build_orchestration_prompt_block(orchestration_plan)}\n\n"
        "证据包 markdown：\n"
        f"{markdown or '当前未提供证据包 markdown'}\n\n"
        "证据包 facts JSON：\n"
        f"{json.dumps(facts, ensure_ascii=False, indent=2)}"
    )


def call_openai_compatible(
    pack: dict[str, Any],
    diagnostic_bundle: dict[str, Any] | None = None,
    orchestration_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    api_key = _resolve_api_key()
    if not api_key:
        raise RuntimeError("missing API key")

    payload: dict[str, Any] = {
        "model": _resolve_model_name(),
        "messages": [
            {
                "role": "user",
                "content": build_evidence_prompt(pack, diagnostic_bundle, orchestration_plan),
            }
        ],
        "temperature": float(os.environ.get("CREWAI_TEMPERATURE", "0.2")),
        "max_tokens": int(os.environ.get("CREWAI_MAX_TOKENS", "1400")),
    }
    reasoning_effort = os.environ.get("CREWAI_REASONING_EFFORT", "").strip()
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort

    request_data = json.dumps(payload).encode("utf-8")
    chat_url = _resolve_chat_completions_url(_resolve_base_url())
    timeout_seconds = float(os.environ.get("CREWAI_TIMEOUT_SECONDS", "90"))
    last_error: Exception | None = None

    for attempt in range(1, 4):
        try:
            http_request = request.Request(
                chat_url,
                data=request_data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                method="POST",
            )
            with request.urlopen(http_request, timeout=timeout_seconds) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
            content = _read_response_text(response_payload)
            parsed = _extract_json_object(content)
            if not parsed:
                raise RuntimeError("model response did not contain a JSON object")
            return _normalize_review_payload(parsed, pack)
        except Exception as error_detail:
            last_error = error_detail
            should_retry = False
            if isinstance(error_detail, error.HTTPError):
                should_retry = error_detail.code in {429, 500, 502, 503, 504}
            if isinstance(error_detail, error.URLError):
                should_retry = True
            if not should_retry or attempt >= 3:
                break
            time.sleep(attempt)

    raise RuntimeError(f"model review failed: {last_error}")


def _resolve_sibling_sidecar_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "openclaw" / "tools" / "crewai-sidecar"


def _resolve_sibling_python(sidecar_dir: Path) -> str:
    unix_python = sidecar_dir / ".venv" / "bin" / "python"
    if unix_python.exists():
        return str(unix_python)
    windows_python = sidecar_dir / ".venv" / "Scripts" / "python.exe"
    if windows_python.exists():
        return str(windows_python)
    return sys.executable


def delegate_to_sibling_sidecar() -> int:
    sibling_dir = _resolve_sibling_sidecar_dir()
    sibling_script = sibling_dir / "store_review.py"
    if not sibling_script.exists():
        print(
            "No evidence pack provided and sibling openclaw CrewAI sidecar is unavailable",
            file=sys.stderr,
        )
        return 2

    result = subprocess.run(
        [_resolve_sibling_python(sibling_dir), str(sibling_script), *sys.argv[1:]],
        cwd=str(sibling_dir),
        env=os.environ.copy(),
        check=False,
    )
    return int(result.returncode or 0)


def _validate_requested_dates(args: argparse.Namespace) -> None:
    try:
        start = date.fromisoformat(args.start)
        end = date.fromisoformat(args.end)
    except ValueError as error_detail:
        raise SystemExit(f"Invalid date: {error_detail}") from error_detail
    if end < start:
        raise SystemExit("--end must be on or after --start")


def main() -> None:
    args = parse_args()
    _validate_requested_dates(args)
    evidence_pack = _load_evidence_pack_from_env()
    diagnostic_bundle = _load_diagnostic_bundle_from_env()
    orchestration_plan = _load_orchestration_plan_from_env()

    if evidence_pack is None:
        raise SystemExit(delegate_to_sibling_sidecar())

    if args.print_context:
        print(
            json.dumps(
                build_print_context(args, evidence_pack, diagnostic_bundle, orchestration_plan),
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    try:
        payload = call_openai_compatible(evidence_pack, diagnostic_bundle, orchestration_plan)
    except Exception as error_detail:
        payload = build_local_fallback_payload(evidence_pack, diagnostic_bundle, error_detail)

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
