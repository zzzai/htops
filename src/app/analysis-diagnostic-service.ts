import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisDiagnosticSignal,
  HetangAnalysisEvidencePack,
} from "../types.js";

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asPercent(value: number | null): string {
  if (value == null) {
    return "当前未接入/未可信";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function readSingleStoreFacts(pack: HetangAnalysisEvidencePack): {
  latestMetrics: Record<string, unknown>;
  review7d: Record<string, unknown>;
  topTechs: Record<string, unknown>[];
} {
  const facts = pack.facts ?? {};
  const latestReport =
    typeof facts.latestReport === "object" && facts.latestReport !== null ? facts.latestReport : {};
  const latestMetrics =
    typeof (latestReport as { metrics?: unknown }).metrics === "object" &&
    (latestReport as { metrics?: unknown }).metrics !== null
      ? ((latestReport as { metrics: Record<string, unknown> }).metrics ?? {})
      : {};
  const review7d =
    typeof facts.review7d === "object" && facts.review7d !== null
      ? (facts.review7d as Record<string, unknown>)
      : {};
  const topTechs = Array.isArray(facts.topTechs)
    ? facts.topTechs.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
    : [];
  return { latestMetrics, review7d, topTechs };
}

function buildPointClockRiskSignal(pack: HetangAnalysisEvidencePack): HetangAnalysisDiagnosticSignal | null {
  const { latestMetrics, review7d, topTechs } = readSingleStoreFacts(pack);
  const storePointClockRate =
    asNumber(latestMetrics.pointClockRate) ?? asNumber(review7d.pointClockRate7d);
  const topTech = topTechs[0] ?? null;
  const topTechPointClockRate = asNumber(topTech?.pointClockRate);
  if (storePointClockRate == null && topTechPointClockRate == null) {
    return null;
  }

  const severity =
    (storePointClockRate != null && storePointClockRate >= 0.4) ||
    (topTechPointClockRate != null && topTechPointClockRate >= 0.6)
      ? "high"
      : "medium";

  const evidence = [
    `门店点钟率 ${asPercent(storePointClockRate)}`,
    topTech
      ? `${String(topTech.personName ?? "头部技师")} 点钟率 ${asPercent(topTechPointClockRate)}`
      : "暂无头部技师样本",
  ];

  return {
    signalId: "point_clock_risk",
    severity,
    title: "点钟集中风险",
    finding: `门店点钟结构偏高，当前门店点钟率 ${asPercent(storePointClockRate)}。`,
    evidence,
    recommendedFocus: "优先检查点钟集中、班次承接和头部技师依赖。",
  };
}

function buildAddClockWeaknessSignal(pack: HetangAnalysisEvidencePack): HetangAnalysisDiagnosticSignal | null {
  const { latestMetrics, review7d } = readSingleStoreFacts(pack);
  const addClockRate = asNumber(latestMetrics.addClockRate) ?? asNumber(review7d.addClockRate7d);
  if (addClockRate == null || addClockRate >= 0.08) {
    return null;
  }
  return {
    signalId: "add_clock_weakness",
    severity: addClockRate < 0.05 ? "high" : "medium",
    title: "加钟承接偏弱",
    finding: `当前加钟率 ${asPercent(addClockRate)}，服务后半程承接偏弱。`,
    evidence: [`加钟率 ${asPercent(addClockRate)}`],
    recommendedFocus: "优先检查加钟话术、项目联动和离店前延钟承接。",
  };
}

function buildMemberSilenceRiskSignal(pack: HetangAnalysisEvidencePack): HetangAnalysisDiagnosticSignal | null {
  const { latestMetrics, review7d } = readSingleStoreFacts(pack);
  const sleepingMemberRate =
    asNumber(latestMetrics.sleepingMemberRate) ?? asNumber(review7d.sleepingMemberRate);
  if (sleepingMemberRate == null || sleepingMemberRate < 0.18) {
    return null;
  }
  return {
    signalId: "member_silence_risk",
    severity: sleepingMemberRate >= 0.2 ? "high" : "medium",
    title: "沉默会员压力",
    finding: `当前沉默会员率 ${asPercent(sleepingMemberRate)}，会员激活压力偏大。`,
    evidence: [`沉默会员率 ${asPercent(sleepingMemberRate)}`],
    recommendedFocus: "优先检查沉默会员召回和回访动作。",
  };
}

export function buildHetangDiagnosticBundle(
  pack: HetangAnalysisEvidencePack,
): HetangAnalysisDiagnosticBundle {
  const signals = [
    buildPointClockRiskSignal(pack),
    buildAddClockWeaknessSignal(pack),
    buildMemberSilenceRiskSignal(pack),
  ].filter((signal): signal is HetangAnalysisDiagnosticSignal => signal !== null);

  return {
    version: "v1",
    scopeType: pack.scopeType,
    storeName: pack.storeName,
    orgIds: pack.orgIds,
    question: pack.question,
    signals,
  };
}
