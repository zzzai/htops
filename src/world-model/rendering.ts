import type {
  CustomerOperatingProfileDailyRecord,
  EnvironmentContextSnapshot,
  HetangStoreExternalContextEntry,
} from "../types.js";
import { resolveOperatingWorldMechanisms } from "./mechanisms.js";
import { simulateOperatingWorldScenario } from "./simulator.js";
import { buildOperatingWorldStateSnapshot } from "./state.js";
import type { OperatingWorldIndustryObservation } from "./types.js";

type WorldModelCoverageLabel =
  | "门店经营事实"
  | "环境上下文"
  | "外部情报"
  | "会员/反馈样本"
  | "行业观察";

type WeeklyWorldModelAggregate = {
  revenue: number;
  customerCount: number;
  rechargeCash: number;
  addClockRate: number | null;
  pointClockRate: number | null;
  newMembers: number;
};

const WORLD_MODEL_COVERAGE_LABELS: WorldModelCoverageLabel[] = [
  "门店经营事实",
  "环境上下文",
  "外部情报",
  "会员/反馈样本",
  "行业观察",
];

function renderIndustryObservationSummary(
  observations: OperatingWorldIndustryObservation[],
  maxItems = 2,
): string {
  const uniqueSummaries = Array.from(
    new Set(
      observations
        .map((observation) => observation.summary.trim())
        .filter((summary) => summary.length > 0),
    ),
  );
  return uniqueSummaries.slice(0, maxItems).join("；");
}

function summarizeOperatingWorldCoverage(params: {
  hasStoreFacts: boolean;
  hasEnvironment: boolean;
  hasExternalContext: boolean;
  hasCustomerFeedback: boolean;
  hasIndustryObservation: boolean;
}): {
  available: WorldModelCoverageLabel[];
  missing: WorldModelCoverageLabel[];
} {
  const available: WorldModelCoverageLabel[] = [];
  if (params.hasStoreFacts) {
    available.push("门店经营事实");
  }
  if (params.hasEnvironment) {
    available.push("环境上下文");
  }
  if (params.hasExternalContext) {
    available.push("外部情报");
  }
  if (params.hasCustomerFeedback) {
    available.push("会员/反馈样本");
  }
  if (params.hasIndustryObservation) {
    available.push("行业观察");
  }

  return {
    available,
    missing: WORLD_MODEL_COVERAGE_LABELS.filter((label) => !available.includes(label)),
  };
}

function renderOperatingWorldCoverageNote(params: {
  available: WorldModelCoverageLabel[];
  missing: WorldModelCoverageLabel[];
}): string {
  const availableText = params.available.join("、");
  const missingText =
    params.missing.length > 0 ? `；仍待补齐：${params.missing.join("、")}` : "";
  return `当前世界模型主要依据：${availableText}${missingText}。仅作辅助参考，后续会继续补数完善。`;
}

function buildWeeklyStoreFactContext(params: {
  currentAggregate: WeeklyWorldModelAggregate;
  previousAggregate: WeeklyWorldModelAggregate;
}): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const customerStable =
    params.previousAggregate.customerCount <= 0 ||
    params.currentAggregate.customerCount >= params.previousAggregate.customerCount * 0.95;
  const rechargeWeakening =
    params.previousAggregate.rechargeCash > 0 &&
    params.currentAggregate.rechargeCash <= params.previousAggregate.rechargeCash * 0.85;

  if (customerStable && rechargeWeakening) {
    facts.kpi_signal_traffic_vs_recharge = "traffic-flat-recharge-down";
  }

  return facts;
}

export function renderStoreAdviceWorldModelSupplement(params: {
  orgId: string;
  bizDate: string;
  storeFactContext?: Record<string, unknown>;
  environmentContext?: EnvironmentContextSnapshot;
  externalContextEntries?: HetangStoreExternalContextEntry[];
  industryObservations?: OperatingWorldIndustryObservation[];
  customerOperatingProfiles?: CustomerOperatingProfileDailyRecord[];
}): string | null {
  const snapshot = buildOperatingWorldStateSnapshot({
    orgId: params.orgId,
    bizDate: params.bizDate,
    storeFactContext: params.storeFactContext,
    environmentContext: params.environmentContext,
    externalContextEntries: params.externalContextEntries,
    industryObservations: params.industryObservations,
    customerOperatingProfiles: params.customerOperatingProfiles,
  });
  const mechanisms = resolveOperatingWorldMechanisms(snapshot);
  if (mechanisms.length === 0) {
    return null;
  }

  const hasLateNightOpportunity = mechanisms.some(
    (entry) => entry.key === "late-night-opportunity",
  );
  const simulation = simulateOperatingWorldScenario({
    snapshot,
    kind: hasLateNightOpportunity ? "action_preview" : "explain_current_state",
    actionLabel: hasLateNightOpportunity ? "prioritize-evening-intake" : undefined,
  });
  const coverage = summarizeOperatingWorldCoverage({
    hasStoreFacts: Object.keys(snapshot.storeState.confirmedContext).length > 0,
    hasEnvironment: Boolean(snapshot.storeState.environmentContext),
    hasExternalContext:
      Object.keys(snapshot.marketState.estimatedContext).length > 0 ||
      snapshot.marketState.researchNotes.length > 0,
    hasCustomerFeedback:
      snapshot.customerState.evidence.length > 0 ||
      Boolean(snapshot.customerState.latestOperatingProfile) ||
      snapshot.customerState.operatingProfileEvidence.length > 0,
    hasIndustryObservation: snapshot.industryState.observations.length > 0,
  });

  const lines = [`世界模型补充判断：${simulation.summary}`];
  const firstCondition = simulation.requiredConditions[0];
  if (firstCondition) {
    lines.push(`补充条件：${firstCondition}`);
  }
  lines.push(renderOperatingWorldCoverageNote(coverage));
  return lines.join("\n");
}

export function buildWeeklyReportWorldModelLines(params: {
  weekEndBizDate: string;
  currentAggregate: WeeklyWorldModelAggregate;
  previousAggregate: WeeklyWorldModelAggregate;
  industryObservations?: OperatingWorldIndustryObservation[];
}): string[] {
  const storeFactContext = buildWeeklyStoreFactContext({
    currentAggregate: params.currentAggregate,
    previousAggregate: params.previousAggregate,
  });
  if (Object.keys(storeFactContext).length === 0 && (params.industryObservations?.length ?? 0) === 0) {
    return [];
  }

  const snapshot = buildOperatingWorldStateSnapshot({
    orgId: "hq-portfolio",
    bizDate: params.weekEndBizDate,
    storeFactContext,
    industryObservations: params.industryObservations,
  });
  const mechanisms = resolveOperatingWorldMechanisms(snapshot);
  const coverage = summarizeOperatingWorldCoverage({
    hasStoreFacts: Object.keys(snapshot.storeState.confirmedContext).length > 0,
    hasEnvironment: Boolean(snapshot.storeState.environmentContext),
    hasExternalContext:
      Object.keys(snapshot.marketState.estimatedContext).length > 0 ||
      snapshot.marketState.researchNotes.length > 0,
    hasCustomerFeedback: snapshot.customerState.evidence.length > 0,
    hasIndustryObservation: snapshot.industryState.observations.length > 0,
  });
  if (mechanisms.length === 0) {
    const industrySummary = renderIndustryObservationSummary(snapshot.industryState.observations);
    if (industrySummary.length > 0) {
      return [
        "- 世界模型补充：当前外部行业观察已出现变化信号，总部可据此校准组合盘判断，但不替代门店经营事实与周报主结论。",
        `- 行业态势：${industrySummary}`,
        `- 说明：${renderOperatingWorldCoverageNote(coverage)}`,
      ];
    }
    return [];
  }

  const simulation = simulateOperatingWorldScenario({
    snapshot,
    kind: "explain_current_state",
  });
  const industrySummary = renderIndustryObservationSummary(snapshot.industryState.observations);

  const lines = [`- 世界模型补充：${simulation.summary}`];
  const firstRisk = simulation.likelyRisk[0];
  if (firstRisk) {
    lines.push(`- 风险提示：${firstRisk}`);
  }
  if (industrySummary.length > 0) {
    lines.push(`- 行业态势：${industrySummary}`);
  }
  lines.push(`- 说明：${renderOperatingWorldCoverageNote(coverage)}`);
  return lines;
}
