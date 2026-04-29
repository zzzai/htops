import type { OperatingWorldStateSnapshot } from "./types.js";

export type OperatingWorldMechanismKey =
  | "late-night-opportunity"
  | "capacity-bottleneck"
  | "high-value-reactivation-window"
  | "competitor-pressure"
  | "traffic-recharge-split";

export type OperatingWorldMechanismMatch = {
  key: OperatingWorldMechanismKey;
  label: string;
  description: string;
  evidenceKeys: string[];
  likelyImplications: string[];
  suggestedActions: string[];
};

function hasHighEveningDemand(snapshot: OperatingWorldStateSnapshot): boolean {
  return (
    snapshot.storeState.environmentContext?.eveningOutingLikelihood === "high" ||
    snapshot.storeState.environmentContext?.postDinnerLeisureBias === "high"
  );
}

function hasCapacityGap(snapshot: OperatingWorldStateSnapshot): boolean {
  return snapshot.storeState.confirmedContext.night_shift_capacity_gap === true;
}

function isHighValueReactivationWindow(snapshot: OperatingWorldStateSnapshot): boolean {
  return (
    snapshot.customerState.primarySegment === "important-reactivation-member" &&
    snapshot.customerState.recentOutcome?.outcomeLabel !== "arrived" &&
    snapshot.customerState.recentOutcome?.outcomeLabel !== "closed-lost"
  );
}

function hasCompetitorPressure(snapshot: OperatingWorldStateSnapshot): boolean {
  const competitorCount = Number(snapshot.marketState.estimatedContext.competitor_count_3km ?? 0);
  return Number.isFinite(competitorCount) && competitorCount >= 5;
}

function hasTrafficRechargeSplit(snapshot: OperatingWorldStateSnapshot): boolean {
  const signal = String(snapshot.storeState.confirmedContext.kpi_signal_traffic_vs_recharge ?? "");
  return signal.includes("traffic-flat-recharge-down");
}

export function resolveOperatingWorldMechanisms(
  snapshot: OperatingWorldStateSnapshot,
): OperatingWorldMechanismMatch[] {
  const matches: OperatingWorldMechanismMatch[] = [];

  if (hasHighEveningDemand(snapshot)) {
    matches.push({
      key: "late-night-opportunity",
      label: "晚场机会窗口",
      description: "当前晚饭后和夜场需求偏强，门店存在晚场放大机会。",
      evidenceKeys: ["environment.eveningOutingLikelihood", "environment.postDinnerLeisureBias"],
      likelyImplications: ["晚场预约、饭后承接、熟客回流动作更容易产生反馈。"],
      suggestedActions: ["优先把高价值老客和熟悉技师匹配到晚饭后与夜场时段。"],
    });
  }

  if (hasCapacityGap(snapshot)) {
    matches.push({
      key: "capacity-bottleneck",
      label: "供给承接瓶颈",
      description: "需求存在，但晚场供给或房态承接可能不足。",
      evidenceKeys: ["store.night_shift_capacity_gap"],
      likelyImplications: ["放量动作可能先转化成排队、等房或技师承接不足。"],
      suggestedActions: ["先确认晚场技师与房态承接，再放大夜场动作。"],
    });
  }

  if (isHighValueReactivationWindow(snapshot)) {
    matches.push({
      key: "high-value-reactivation-window",
      label: "高价值沉默客召回窗口",
      description: "当前存在值得优先跟进的高价值沉默客。",
      evidenceKeys: ["customer.primarySegment", "customer.recentOutcome"],
      likelyImplications: ["一对一跟进和熟悉技师召回更容易形成预约。"],
      suggestedActions: ["优先给高价值沉默客安排熟悉技师和明确到店窗口。"],
    });
  }

  if (hasCompetitorPressure(snapshot)) {
    matches.push({
      key: "competitor-pressure",
      label: "竞对分流压力",
      description: "周边竞对密度偏高，外部分流压力不可忽视。",
      evidenceKeys: ["market.competitor_count_3km"],
      likelyImplications: ["价格敏感与即时决策客群更容易被外部分流。"],
      suggestedActions: ["不要只打价格，优先强调熟悉技师、晚场承接和复购体验差异。"],
    });
  }

  if (hasTrafficRechargeSplit(snapshot)) {
    matches.push({
      key: "traffic-recharge-split",
      label: "客流与储值分化",
      description: "当前客流未必先掉，但储值和会员转化链路已经走弱。",
      evidenceKeys: ["store.kpi_signal_traffic_vs_recharge"],
      likelyImplications: ["表面客流稳定，但会员沉淀和长期价值可能在走弱。"],
      suggestedActions: ["把经营动作从单纯拉客，切到储值转化、熟客沉淀和复购承接。"],
    });
  }

  return matches;
}
