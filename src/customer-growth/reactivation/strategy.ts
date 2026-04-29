import { buildStoreEnvironmentContextSnapshot } from "../environment-context.js";
import {
  applyMemberActionProfileBridgeToStrategy,
  buildMemberActionProfileBridgeIndex,
  resolveMemberActionProfileBridge,
} from "../action-profile-bridge.js";
import { shiftBizDate } from "../../time.js";
import { HetangOpsStore } from "../../store.js";
import {
  buildMemberReactivationOutcomeLearningIndex,
  resolveMemberReactivationLearningEntry,
} from "./learning.js";
import type {
  CustomerOperatingProfileDailyRecord,
  EnvironmentContextSnapshot,
  HetangStoreConfig,
  MemberReactivationActionLabel,
  MemberReactivationChurnRiskLabel,
  MemberReactivationFeatureRecord,
  MemberReactivationLifecycleMomentumLabel,
  MemberReactivationOutcomeSnapshotRecord,
  MemberReactivationRevisitWindowLabel,
  MemberReactivationStrategyRecord,
  MemberReactivationTouchWindowLabel,
} from "../../types.js";

const REACTIVATION_STRATEGY_REBUILD_CHUNK_DAYS = 7;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function nudgeTouchWindowLabel(
  current: MemberReactivationTouchWindowLabel,
): MemberReactivationTouchWindowLabel {
  if (current === "best-today") {
    return "best-this-week";
  }
  if (current === "best-this-week") {
    return "wait-preferred-weekday";
  }
  return current;
}

function resolveBizWeekday(bizDate: string): string {
  const weekday = new Date(`${bizDate}T00:00:00Z`).getUTCDay();
  switch (weekday) {
    case 0:
      return "sunday";
    case 1:
      return "monday";
    case 2:
      return "tuesday";
    case 3:
      return "wednesday";
    case 4:
      return "thursday";
    case 5:
      return "friday";
    default:
      return "saturday";
  }
}

function resolveMonthPhase(bizDate: string): string {
  const day = Number(bizDate.slice(8, 10));
  if (day <= 10) {
    return "early";
  }
  if (day <= 20) {
    return "mid";
  }
  return "late";
}

function resolveLifecycleMomentum(params: {
  visitCount30d: number;
  visitCount90d: number;
  payAmount30d: number;
  payAmount90d: number;
}): {
  lifecycleMomentumScore: number;
  lifecycleMomentumLabel: MemberReactivationLifecycleMomentumLabel;
} {
  if (params.visitCount30d <= 0 && params.payAmount30d <= 0) {
    return {
      lifecycleMomentumScore: 0,
      lifecycleMomentumLabel: "stalled",
    };
  }

  const visitRatio =
    params.visitCount90d > 0 ? clamp((params.visitCount30d * 3) / params.visitCount90d, 0, 2) : 0;
  const payRatio =
    params.payAmount90d > 0 ? clamp((params.payAmount30d * 3) / params.payAmount90d, 0, 2) : 0;
  const score = round((visitRatio * 0.45 + payRatio * 0.55) / 2, 4);

  if (score >= 0.75) {
    return {
      lifecycleMomentumScore: score,
      lifecycleMomentumLabel: "accelerating",
    };
  }
  if (score >= 0.5) {
    return {
      lifecycleMomentumScore: score,
      lifecycleMomentumLabel: "stable",
    };
  }
  if (score >= 0.2) {
    return {
      lifecycleMomentumScore: score,
      lifecycleMomentumLabel: "cooling",
    };
  }
  return {
    lifecycleMomentumScore: score,
    lifecycleMomentumLabel: "stalled",
  };
}

function resolveChurnRisk(params: {
  primarySegment: MemberReactivationFeatureRecord["primarySegment"];
  daysSinceLastVisit: number;
  cycleDeviationScore: number | null;
  projectedBalanceDaysLeft: number | null;
  depletionVelocity30d: number | null;
  timePreferenceConfidenceScore: number;
  lifecycleMomentumScore: number;
}): {
  churnRiskScore: number;
  churnRiskLabel: MemberReactivationChurnRiskLabel;
} {
  let score = 0.18;
  switch (params.primarySegment) {
    case "important-reactivation-member":
      score = 0.58;
      break;
    case "sleeping-customer":
      score = 0.54;
      break;
    case "important-value-member":
      score = 0.42;
      break;
    case "potential-growth-customer":
      score = 0.42;
      break;
    case "groupbuy-retain-candidate":
      score = 0.36;
      break;
    case "active-member":
      score = 0.26;
      break;
    default:
      score = 0.18;
      break;
  }

  score += clamp(params.daysSinceLastVisit / 120, 0, 1) * 0.16;
  score += clamp((params.cycleDeviationScore ?? 0) / 3, 0, 1) * 0.16;
  score +=
    params.projectedBalanceDaysLeft !== null && params.projectedBalanceDaysLeft <= 45 ? 0.08 : 0;
  score += clamp((params.depletionVelocity30d ?? 0) / 20, 0, 1) * 0.05;
  score +=
    params.timePreferenceConfidenceScore *
    ((params.cycleDeviationScore ?? 0) > 0 ? 0.07 : 0.03);
  score -= params.lifecycleMomentumScore * 0.04;
  score = round(clamp(score, 0, 1), 4);

  if (score >= 0.82) {
    return { churnRiskScore: score, churnRiskLabel: "critical" };
  }
  if (score >= 0.62) {
    return { churnRiskScore: score, churnRiskLabel: "high" };
  }
  if (score >= 0.4) {
    return { churnRiskScore: score, churnRiskLabel: "medium" };
  }
  return { churnRiskScore: score, churnRiskLabel: "low" };
}

function resolveRevisitWindow(params: {
  daysSinceLastVisit: number;
  averageVisitGapDays90d: number | null;
  cycleDeviationScore: number | null;
  timePreferenceConfidenceScore: number;
}): {
  revisitProbability7d: number;
  revisitWindowLabel: MemberReactivationRevisitWindowLabel;
} {
  const expectedGap = params.averageVisitGapDays90d && params.averageVisitGapDays90d > 0
    ? params.averageVisitGapDays90d
    : 14;
  const ratio = params.daysSinceLastVisit / Math.max(expectedGap, 1);
  const distance = Math.abs(params.daysSinceLastVisit - expectedGap) / Math.max(expectedGap, 7);
  let probability =
    0.35 +
    clamp(1 - distance, 0, 1) * 0.3 +
    clamp((params.cycleDeviationScore ?? 0) / 3, 0, 1) * 0.2 +
    params.timePreferenceConfidenceScore * 0.15;
  probability = round(clamp(probability, 0.05, 0.98), 4);

  if (ratio >= 1.1 || (params.cycleDeviationScore ?? 0) >= 0.9) {
    return { revisitProbability7d: probability, revisitWindowLabel: "due-now" };
  }
  if (ratio >= 0.85) {
    return { revisitProbability7d: probability, revisitWindowLabel: "due-this-week" };
  }
  if (ratio >= 0.55) {
    return { revisitProbability7d: probability, revisitWindowLabel: "later-this-month" };
  }
  return { revisitProbability7d: probability, revisitWindowLabel: "not-due" };
}

function resolveTouchWindow(params: {
  bizDate: string;
  dominantVisitWeekday: string | null;
  dominantVisitDaypart: string | null;
  dominantVisitMonthPhase: string | null;
  preferredDaypartShare90d: number | null;
  timePreferenceConfidenceScore: number;
  environmentContext?: EnvironmentContextSnapshot;
}): {
  recommendedTouchWeekday: string | null;
  recommendedTouchDaypart: string | null;
  touchWindowMatchScore: number;
  touchWindowLabel: MemberReactivationTouchWindowLabel;
} {
  const recommendedTouchWeekday = params.dominantVisitWeekday ?? null;
  const recommendedTouchDaypart = params.dominantVisitDaypart ?? null;
  if (
    params.timePreferenceConfidenceScore < 0.45 ||
    recommendedTouchWeekday === null ||
    recommendedTouchDaypart === null
  ) {
    let lowConfidenceScore = round(params.timePreferenceConfidenceScore * 0.6, 4);
    if (params.environmentContext?.badWeatherTouchPenalty === "medium") {
      lowConfidenceScore = round(clamp(lowConfidenceScore - 0.06, 0, 1), 4);
    } else if (params.environmentContext?.badWeatherTouchPenalty === "high") {
      lowConfidenceScore = round(clamp(lowConfidenceScore - 0.14, 0, 1), 4);
    }
    return {
      recommendedTouchWeekday,
      recommendedTouchDaypart,
      touchWindowMatchScore: lowConfidenceScore,
      touchWindowLabel: "low-confidence",
    };
  }

  const weekdayMatch = resolveBizWeekday(params.bizDate) === recommendedTouchWeekday;
  const monthPhaseMatch =
    params.dominantVisitMonthPhase === null ||
    resolveMonthPhase(params.bizDate) === params.dominantVisitMonthPhase;
  const score = round(
    clamp(
      params.timePreferenceConfidenceScore * 0.55 +
        (weekdayMatch ? 0.25 : 0.05) +
        (monthPhaseMatch ? 0.12 : 0.03) +
        (params.preferredDaypartShare90d ?? 0) * 0.08,
      0,
      1,
    ),
    4,
  );

  let touchWindowLabel: MemberReactivationTouchWindowLabel;
  if (weekdayMatch && monthPhaseMatch) {
    touchWindowLabel = "best-today";
  } else if (weekdayMatch) {
    touchWindowLabel = "best-this-week";
  } else {
    touchWindowLabel = "wait-preferred-weekday";
  }

  let adjustedScore = score;
  const isEveningWindow =
    recommendedTouchDaypart === "after-work" ||
    recommendedTouchDaypart === "late-night" ||
    recommendedTouchDaypart === "overnight";
  if (isEveningWindow) {
    if (params.environmentContext?.eveningOutingLikelihood === "high") {
      adjustedScore += 0.08;
    } else if (params.environmentContext?.eveningOutingLikelihood === "medium") {
      adjustedScore += 0.03;
    }
    if (params.environmentContext?.postDinnerLeisureBias === "high") {
      adjustedScore += 0.04;
    } else if (params.environmentContext?.postDinnerLeisureBias === "medium") {
      adjustedScore += 0.02;
    }
  }
  if (params.environmentContext?.badWeatherTouchPenalty === "low") {
    adjustedScore -= 0.04;
  } else if (params.environmentContext?.badWeatherTouchPenalty === "medium") {
    adjustedScore -= 0.1;
    touchWindowLabel = nudgeTouchWindowLabel(touchWindowLabel);
  } else if (params.environmentContext?.badWeatherTouchPenalty === "high") {
    adjustedScore -= 0.18;
    touchWindowLabel = nudgeTouchWindowLabel(nudgeTouchWindowLabel(touchWindowLabel));
  }

  return {
    recommendedTouchWeekday,
    recommendedTouchDaypart,
    touchWindowMatchScore: round(clamp(adjustedScore, 0, 1), 4),
    touchWindowLabel,
  };
}

function resolveRecommendedAction(params: {
  primarySegment: MemberReactivationFeatureRecord["primarySegment"];
  churnRiskLabel: MemberReactivationChurnRiskLabel;
  revisitWindowLabel: MemberReactivationRevisitWindowLabel;
  lifecycleMomentumLabel: MemberReactivationLifecycleMomentumLabel;
}): MemberReactivationActionLabel {
  if (
    (params.churnRiskLabel === "critical" || params.churnRiskLabel === "high") &&
    params.revisitWindowLabel === "due-now"
  ) {
    return "immediate-1to1";
  }
  if (
    params.primarySegment === "potential-growth-customer" &&
    params.lifecycleMomentumLabel === "accelerating"
  ) {
    return "growth-nurture";
  }
  if (
    params.revisitWindowLabel === "due-this-week" ||
    params.revisitWindowLabel === "later-this-month"
  ) {
    return "scheduled-reactivation";
  }
  return "observe";
}

function resolveStrategyPriorityScore(params: {
  reactivationPriorityScore: number;
  churnRiskScore: number;
  revisitProbability7d: number;
  touchWindowMatchScore: number;
  lifecycleMomentumScore: number;
  recommendedActionLabel: MemberReactivationActionLabel;
}): number {
  let score =
    params.reactivationPriorityScore +
    params.churnRiskScore * 120 +
    params.revisitProbability7d * 85 +
    params.touchWindowMatchScore * 40 +
    params.lifecycleMomentumScore * 35;
  switch (params.recommendedActionLabel) {
    case "immediate-1to1":
      score += 25;
      break;
    case "growth-nurture":
      score += 18;
      break;
    case "scheduled-reactivation":
      score += 10;
      break;
    default:
      break;
  }
  return round(score, 1);
}

export function buildMemberReactivationStrategiesForBizDate(params: {
  orgId: string;
  bizDate: string;
  featureRows: MemberReactivationFeatureRecord[];
  operatingProfileRows?: CustomerOperatingProfileDailyRecord[];
  environmentContext?: EnvironmentContextSnapshot;
  outcomeSnapshotRows?: MemberReactivationOutcomeSnapshotRecord[];
}): MemberReactivationStrategyRecord[] {
  const learningIndex = buildMemberReactivationOutcomeLearningIndex({
    snapshotRows: params.outcomeSnapshotRows ?? [],
    asOfBizDate: params.bizDate,
  });
  const actionProfileBridgeIndex = buildMemberActionProfileBridgeIndex(
    params.operatingProfileRows ?? [],
  );
  return params.featureRows
    .filter((row) => row.bizDate === params.bizDate)
    .map((row) => {
      const { lifecycleMomentumScore, lifecycleMomentumLabel } = resolveLifecycleMomentum({
        visitCount30d: row.visitCount30d,
        visitCount90d: row.visitCount90d,
        payAmount30d: row.payAmount30d,
        payAmount90d: row.payAmount90d,
      });
      const { churnRiskScore, churnRiskLabel } = resolveChurnRisk({
        primarySegment: row.primarySegment,
        daysSinceLastVisit: row.daysSinceLastVisit,
        cycleDeviationScore: row.cycleDeviationScore,
        projectedBalanceDaysLeft: row.projectedBalanceDaysLeft,
        depletionVelocity30d: row.depletionVelocity30d,
        timePreferenceConfidenceScore: row.timePreferenceConfidenceScore,
        lifecycleMomentumScore,
      });
      const { revisitProbability7d, revisitWindowLabel } = resolveRevisitWindow({
        daysSinceLastVisit: row.daysSinceLastVisit,
        averageVisitGapDays90d: row.averageVisitGapDays90d,
        cycleDeviationScore: row.cycleDeviationScore,
        timePreferenceConfidenceScore: row.timePreferenceConfidenceScore,
      });
      const {
        recommendedTouchWeekday,
        recommendedTouchDaypart,
        touchWindowMatchScore,
        touchWindowLabel,
      } = resolveTouchWindow({
        bizDate: params.bizDate,
        dominantVisitWeekday: row.dominantVisitWeekday,
        dominantVisitDaypart: row.dominantVisitDaypart,
        dominantVisitMonthPhase: row.dominantVisitMonthPhase,
        preferredDaypartShare90d: row.preferredDaypartShare90d,
        timePreferenceConfidenceScore: row.timePreferenceConfidenceScore,
        environmentContext: params.environmentContext,
      });
      const recommendedActionLabel = resolveRecommendedAction({
        primarySegment: row.primarySegment,
        churnRiskLabel,
        revisitWindowLabel,
        lifecycleMomentumLabel,
      });
      const baseStrategyPriorityScore = resolveStrategyPriorityScore({
        reactivationPriorityScore: row.reactivationPriorityScore,
        churnRiskScore,
        revisitProbability7d,
        touchWindowMatchScore,
        lifecycleMomentumScore,
        recommendedActionLabel,
      });
      const learningCalibration = resolveMemberReactivationLearningEntry({
        learningIndex,
        primarySegment: row.primarySegment,
        recommendedActionLabel,
      });
      const actionProfileBridge = resolveMemberActionProfileBridge({
        bridgeIndex: actionProfileBridgeIndex,
        memberId: row.memberId,
        customerIdentityKey: row.customerIdentityKey,
      });
      const bridgedStrategy = applyMemberActionProfileBridgeToStrategy({
        bizDate: params.bizDate,
        recommendedTouchWeekday,
        recommendedTouchDaypart,
        touchWindowMatchScore,
        touchWindowLabel,
        baseStrategyPriorityScore: round(
          baseStrategyPriorityScore + (learningCalibration?.adjustmentScore ?? 0),
          1,
        ),
        bridge: actionProfileBridge,
      });

      return {
        orgId: params.orgId,
        bizDate: params.bizDate,
        memberId: row.memberId,
        customerIdentityKey: row.customerIdentityKey,
        customerDisplayName: row.customerDisplayName,
        primarySegment: row.primarySegment,
        reactivationPriorityScore: row.reactivationPriorityScore,
        churnRiskScore,
        churnRiskLabel,
        revisitProbability7d,
        revisitWindowLabel,
        recommendedTouchWeekday,
        recommendedTouchDaypart: bridgedStrategy.recommendedTouchDaypart,
        touchWindowMatchScore: bridgedStrategy.touchWindowMatchScore,
        touchWindowLabel: bridgedStrategy.touchWindowLabel,
        lifecycleMomentumScore,
        lifecycleMomentumLabel,
        recommendedActionLabel,
        strategyPriorityScore: bridgedStrategy.strategyPriorityScore,
        strategyJson: JSON.stringify({
          source: "reactivation-strategy-v1",
          inputs: {
            reactivationPriorityScore: row.reactivationPriorityScore,
            daysSinceLastVisit: row.daysSinceLastVisit,
            averageVisitGapDays90d: row.averageVisitGapDays90d,
            cycleDeviationScore: row.cycleDeviationScore,
            timePreferenceConfidenceScore: row.timePreferenceConfidenceScore,
          },
          outputs: {
            churnRiskLabel,
            revisitWindowLabel,
            touchWindowLabel: bridgedStrategy.touchWindowLabel,
            lifecycleMomentumLabel,
            recommendedActionLabel,
          },
          operatingProfileBridge: actionProfileBridge
            ? {
                serviceNeed: actionProfileBridge.serviceNeed ?? null,
                preferredTouchDaypart: actionProfileBridge.preferredTouchDaypart,
                preferredChannel: actionProfileBridge.preferredChannel ?? null,
                preferredTechName: actionProfileBridge.preferredTechName ?? null,
                confidenceFactor: actionProfileBridge.confidenceFactor,
                confidenceDiscount: actionProfileBridge.confidenceDiscount,
                actionBoostScore: actionProfileBridge.actionBoostScore,
                reasonTags: actionProfileBridge.reasonTags,
                touchHints: actionProfileBridge.touchHints,
              }
            : null,
          learningCalibration: learningCalibration
            ? {
                sampleCount: learningCalibration.sampleCount,
                avgOutcomeScore: learningCalibration.avgOutcomeScore,
                bookedRate: learningCalibration.bookedRate,
                arrivalRate: learningCalibration.arrivalRate,
                adjustmentScore: learningCalibration.adjustmentScore,
              }
            : null,
          environmentContext: params.environmentContext
            ? {
                seasonTag: params.environmentContext.seasonTag ?? null,
                solarTerm: params.environmentContext.solarTerm ?? null,
                holidayTag: params.environmentContext.holidayTag ?? null,
                weatherTag: params.environmentContext.weatherTag ?? null,
                temperatureBand: params.environmentContext.temperatureBand ?? null,
                postDinnerLeisureBias: params.environmentContext.postDinnerLeisureBias ?? null,
                eveningOutingLikelihood: params.environmentContext.eveningOutingLikelihood ?? null,
                badWeatherTouchPenalty: params.environmentContext.badWeatherTouchPenalty ?? null,
              }
            : null,
        }),
      } satisfies MemberReactivationStrategyRecord;
    })
    .sort(
      (left, right) =>
        right.strategyPriorityScore - left.strategyPriorityScore ||
        right.reactivationPriorityScore - left.reactivationPriorityScore ||
        left.memberId.localeCompare(right.memberId),
    );
}

async function rebuildMemberReactivationStrategyChunk(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  storeConfig?: Pick<HetangStoreConfig, "orgId" | "storeName" | "roomCount" | "operatingHoursPerDay">;
}): Promise<number> {
  const featureRows = await params.store.listMemberReactivationFeaturesByDateRange(
    params.orgId,
    params.startBizDate,
    params.endBizDate,
  );
  const outcomeSnapshotRows =
    await params.store.listMemberReactivationOutcomeSnapshotsByDateRange(
      params.orgId,
      shiftBizDate(params.startBizDate, -89),
      params.endBizDate,
    );

  let rebuiltDays = 0;
  for (
    let bizDate = params.startBizDate;
    bizDate <= params.endBizDate;
    bizDate = shiftBizDate(bizDate, 1)
  ) {
    const environmentContext = buildStoreEnvironmentContextSnapshot({
      bizDate,
      storeConfig: params.storeConfig,
    });
    const operatingProfileRows = params.store.listCustomerOperatingProfilesDaily
      ? await params.store.listCustomerOperatingProfilesDaily(params.orgId, bizDate)
      : [];
    const rows = buildMemberReactivationStrategiesForBizDate({
      orgId: params.orgId,
      bizDate,
      featureRows,
      operatingProfileRows,
      environmentContext,
      outcomeSnapshotRows,
    });
    await params.store.replaceMemberReactivationStrategies(
      params.orgId,
      bizDate,
      rows,
      new Date().toISOString(),
      { refreshViews: false },
    );
    rebuiltDays += 1;
  }
  return rebuiltDays;
}

export async function rebuildMemberReactivationStrategiesForDateRange(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  refreshViews?: boolean;
  storeConfig?: Pick<HetangStoreConfig, "orgId" | "storeName" | "roomCount" | "operatingHoursPerDay">;
}): Promise<number> {
  let rebuiltDays = 0;
  for (let chunkStartBizDate = params.startBizDate; chunkStartBizDate <= params.endBizDate; ) {
    let chunkEndBizDate = shiftBizDate(chunkStartBizDate, REACTIVATION_STRATEGY_REBUILD_CHUNK_DAYS - 1);
    if (chunkEndBizDate > params.endBizDate) {
      chunkEndBizDate = params.endBizDate;
    }
    rebuiltDays += await rebuildMemberReactivationStrategyChunk({
      store: params.store,
      orgId: params.orgId,
      startBizDate: chunkStartBizDate,
      endBizDate: chunkEndBizDate,
      storeConfig: params.storeConfig,
    });
    chunkStartBizDate = shiftBizDate(chunkEndBizDate, 1);
  }
  return rebuiltDays;
}
