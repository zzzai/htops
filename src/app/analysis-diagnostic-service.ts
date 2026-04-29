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

function asCurrency(value: number | null): string {
  if (value == null) {
    return "当前未接入/未可信";
  }
  return `${value.toFixed(1)}`;
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

function readPortfolioFacts(pack: HetangAnalysisEvidencePack): Array<{
  storeName: string;
  serviceRevenue: number | null;
  clockEffect: number | null;
  sleepingMemberRate: number | null;
  renewalPressureIndex: number | null;
}> {
  const facts = pack.facts ?? {};
  const portfolioSnapshots = Array.isArray(facts.portfolioSnapshots)
    ? facts.portfolioSnapshots.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
    : [];
  if (portfolioSnapshots.length > 0) {
    return portfolioSnapshots
      .map((entry) => {
        const latestReport =
          typeof entry.latestReport === "object" && entry.latestReport !== null
            ? (entry.latestReport as Record<string, unknown>)
            : {};
        const latestMetrics =
          typeof latestReport.metrics === "object" && latestReport.metrics !== null
            ? (latestReport.metrics as Record<string, unknown>)
            : {};
        const review7d =
          typeof entry.review7d === "object" && entry.review7d !== null
            ? (entry.review7d as Record<string, unknown>)
            : {};
        const summary30d =
          typeof entry.summary30d === "object" && entry.summary30d !== null
            ? (entry.summary30d as Record<string, unknown>)
            : {};
        const storeName =
          typeof entry.storeName === "string" && entry.storeName.trim().length > 0
            ? entry.storeName.trim()
            : "未知门店";
        return {
          storeName,
          serviceRevenue:
            asNumber(summary30d.revenue30d) ??
            asNumber(review7d.revenue7d) ??
            asNumber(latestMetrics.serviceRevenue),
          clockEffect:
            asNumber(summary30d.clockEffect30d) ??
            asNumber(review7d.clockEffect7d) ??
            asNumber(latestMetrics.clockEffect),
          sleepingMemberRate:
            asNumber(summary30d.sleepingMemberRate) ??
            asNumber(review7d.sleepingMemberRate) ??
            asNumber(latestMetrics.sleepingMemberRate),
          renewalPressureIndex:
            asNumber(summary30d.renewalPressureIndex30d) ??
            asNumber(review7d.renewalPressureIndex30d),
        };
      })
      .filter(
        (entry) =>
          entry.serviceRevenue !== null ||
          entry.clockEffect !== null ||
          entry.sleepingMemberRate !== null ||
          entry.renewalPressureIndex !== null,
      );
  }
  const latestReports = Array.isArray(facts.latestReports)
    ? facts.latestReports.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
    : [];

  return latestReports
    .map((report) => {
      const metrics =
        typeof report.metrics === "object" && report.metrics !== null
          ? (report.metrics as Record<string, unknown>)
          : {};
      const storeName =
        typeof report.storeName === "string" && report.storeName.trim().length > 0
          ? report.storeName.trim()
          : "未知门店";
      return {
        storeName,
        serviceRevenue: asNumber(metrics.serviceRevenue),
        clockEffect: asNumber(metrics.clockEffect),
        sleepingMemberRate: asNumber(metrics.sleepingMemberRate),
        renewalPressureIndex: null,
      };
    })
    .filter(
      (entry) =>
        entry.serviceRevenue !== null ||
        entry.clockEffect !== null ||
        entry.sleepingMemberRate !== null ||
        entry.renewalPressureIndex !== null,
    );
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

function buildPortfolioStoreRiskSignal(
  pack: HetangAnalysisEvidencePack,
): HetangAnalysisDiagnosticSignal | null {
  const reports = readPortfolioFacts(pack);
  if (reports.length === 0) {
    return null;
  }
  const weakest = [...reports].sort((left, right) => {
    const sleepingDiff = (right.sleepingMemberRate ?? -1) - (left.sleepingMemberRate ?? -1);
    if (sleepingDiff !== 0) {
      return sleepingDiff;
    }
    const clockEffectDiff = (left.clockEffect ?? Number.POSITIVE_INFINITY) -
      (right.clockEffect ?? Number.POSITIVE_INFINITY);
    if (clockEffectDiff !== 0) {
      return clockEffectDiff;
    }
    return (left.serviceRevenue ?? Number.POSITIVE_INFINITY) -
      (right.serviceRevenue ?? Number.POSITIVE_INFINITY);
  })[0];
  if (!weakest) {
    return null;
  }

  const severity =
    (weakest.sleepingMemberRate ?? 0) >= 0.22 ||
    (weakest.clockEffect ?? Number.POSITIVE_INFINITY) <= 70 ||
    (weakest.renewalPressureIndex ?? 0) >= 1.3
      ? "high"
      : "medium";

  return {
    signalId: "portfolio_store_risk",
    severity,
    title: "重点门店风险",
    finding:
      `${weakest.storeName}沉默会员率 ${asPercent(weakest.sleepingMemberRate)}，` +
      `钟效 ${asCurrency(weakest.clockEffect)}，` +
      `续充压力 ${weakest.renewalPressureIndex?.toFixed(2) ?? "N/A"}，当前最需要总部优先盯。`,
    evidence: [
      `${weakest.storeName} 沉默会员率 ${asPercent(weakest.sleepingMemberRate)}`,
      `${weakest.storeName} 钟效 ${asCurrency(weakest.clockEffect)}`,
      `${weakest.storeName} 续充压力 ${weakest.renewalPressureIndex?.toFixed(2) ?? "N/A"}`,
    ],
    recommendedFocus: `总部先盯${weakest.storeName}的会员回流和班次承接，先止住风险扩散。`,
  };
}

function buildPortfolioRevenueGapSignal(
  pack: HetangAnalysisEvidencePack,
): HetangAnalysisDiagnosticSignal | null {
  const reports = readPortfolioFacts(pack).filter((entry) => entry.serviceRevenue !== null);
  if (reports.length < 2) {
    return null;
  }
  const sorted = [...reports].sort(
    (left, right) => (right.serviceRevenue ?? 0) - (left.serviceRevenue ?? 0),
  );
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (!top?.serviceRevenue || !bottom?.serviceRevenue || top.storeName === bottom.storeName) {
    return null;
  }
  const gapRatio = (top.serviceRevenue - bottom.serviceRevenue) / top.serviceRevenue;
  if (!Number.isFinite(gapRatio) || gapRatio < 0.2) {
    return null;
  }

  return {
    signalId: "portfolio_revenue_gap",
    severity: gapRatio >= 0.35 ? "high" : "medium",
    title: "门店营收分化",
    finding:
      `${top.storeName}与${bottom.storeName}营收差距 ${(gapRatio * 100).toFixed(1)}%，` +
      "五店表现分层明显。",
    evidence: [
      `${top.storeName} 营收 ${asCurrency(top.serviceRevenue)}`,
      `${bottom.storeName} 营收 ${asCurrency(bottom.serviceRevenue)}`,
    ],
    recommendedFocus: `总部复盘${bottom.storeName}客流承接和点钟结构，同时复制${top.storeName}有效做法。`,
  };
}

export function buildHetangDiagnosticBundle(
  pack: HetangAnalysisEvidencePack,
): HetangAnalysisDiagnosticBundle {
  const signals =
    pack.scopeType === "portfolio"
      ? [buildPortfolioStoreRiskSignal(pack), buildPortfolioRevenueGapSignal(pack)].filter(
          (signal): signal is HetangAnalysisDiagnosticSignal => signal !== null,
        )
      : [
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
