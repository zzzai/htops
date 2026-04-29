import { buildStoreEnvironmentContextSnapshot } from "../environment-context.js";
import {
  buildMemberActionProfileBridgeIndex,
  resolveMemberActionProfileBridge,
} from "../action-profile-bridge.js";
import {
  resolveBirthdayBoostScore,
  resolveBirthdayMonthDay,
  resolveBirthdayReasonLabel,
  resolveNextBirthdayOccurrence,
} from "../birthday-utils.js";
import { shiftBizDate } from "../../time.js";
import { HetangOpsStore } from "../../store.js";
import type {
  CustomerOperatingProfileDailyRecord,
  CustomerPrimarySegment,
  EnvironmentContextSnapshot,
  HetangStoreConfig,
  MemberReactivationActionLabel,
  MemberDailySnapshotRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationFollowupBucket,
  MemberReactivationPriorityBand,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
} from "../../types.js";

const REACTIVATION_QUEUE_REBUILD_CHUNK_DAYS = 7;

type ReactivationBandCounts = {
  p0: number;
  p1: number;
  p2: number;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)}元`;
}

function resolveFallbackActionLabel(
  primarySegment: CustomerPrimarySegment,
): MemberReactivationActionLabel {
  if (primarySegment === "potential-growth-customer") {
    return "growth-nurture";
  }
  if (primarySegment === "groupbuy-retain-candidate") {
    return "scheduled-reactivation";
  }
  return "observe";
}

export function resolveReactivationFollowupBucket(
  primarySegment: CustomerPrimarySegment,
): MemberReactivationFollowupBucket {
  switch (primarySegment) {
    case "potential-growth-customer":
    case "active-member":
      return "potential-growth";
    case "groupbuy-retain-candidate":
      return "groupbuy-retention";
    default:
      return "high-value-reactivation";
  }
}

function resolveRelativeBandCounts(total: number): ReactivationBandCounts {
  if (total <= 0) {
    return { p0: 0, p1: 0, p2: 0 };
  }
  const p0 = Math.min(total, Math.max(1, Math.ceil(total * 0.15)));
  const remainingAfterP0 = total - p0;
  const p1 =
    remainingAfterP0 <= 0
      ? 0
      : Math.min(remainingAfterP0, Math.max(1, Math.ceil(total * 0.2)));
  const remainingAfterP1 = remainingAfterP0 - p1;
  let p2 =
    remainingAfterP1 <= 0
      ? 0
      : Math.min(remainingAfterP1, Math.max(1, Math.ceil(total * 0.35)));
  if (total >= 4 && p0 + p1 + p2 >= total) {
    p2 = Math.max(1, total - p0 - p1 - 1);
  }
  return { p0, p1, p2 };
}

function estimateDailyTouchCapacity(params: {
  storeConfig?: Pick<HetangStoreConfig, "customerGrowth" | "roomCount" | "operatingHoursPerDay">;
}): number | null {
  const override = params.storeConfig?.customerGrowth?.reactivationCapacity?.dailyTouchCapacity;
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.max(1, Math.trunc(override));
  }
  const roomCount = params.storeConfig?.roomCount;
  const operatingHoursPerDay = params.storeConfig?.operatingHoursPerDay;
  if (
    roomCount === undefined ||
    !Number.isFinite(roomCount) ||
    roomCount <= 0 ||
    operatingHoursPerDay === undefined ||
    !Number.isFinite(operatingHoursPerDay) ||
    operatingHoursPerDay <= 0
  ) {
    return null;
  }
  return Math.max(4, Math.round(roomCount * 0.35 + operatingHoursPerDay * 0.25));
}

function resolveCapacityBandCounts(params: {
  total: number;
  dailyTouchCapacity: number;
}): ReactivationBandCounts {
  const actionableCapacity = Math.max(
    1,
    Math.min(params.total, Math.trunc(params.dailyTouchCapacity)),
  );
  if (actionableCapacity <= 1) {
    return { p0: 1, p1: 0, p2: 0 };
  }
  const p0 = Math.max(1, Math.ceil(actionableCapacity * 0.2));
  const remainingAfterP0 = actionableCapacity - p0;
  if (remainingAfterP0 <= 0) {
    return { p0, p1: 0, p2: 0 };
  }
  const p1 = Math.min(remainingAfterP0, Math.max(1, Math.ceil(actionableCapacity * 0.25)));
  const p2 = Math.max(0, actionableCapacity - p0 - p1);
  return { p0, p1, p2 };
}

function resolveBandCounts(params: {
  total: number;
  storeConfig?: Pick<HetangStoreConfig, "customerGrowth" | "roomCount" | "operatingHoursPerDay">;
}): ReactivationBandCounts {
  const dailyTouchCapacity = estimateDailyTouchCapacity({
    storeConfig: params.storeConfig,
  });
  if (dailyTouchCapacity === null) {
    return resolveRelativeBandCounts(params.total);
  }
  return resolveCapacityBandCounts({
    total: params.total,
    dailyTouchCapacity,
  });
}

export function resolveMemberReactivationPriorityBand(params: {
  rows: Array<
    Pick<MemberReactivationQueueRecord, "memberId" | "strategyPriorityScore"> &
      Partial<Pick<MemberReactivationQueueRecord, "executionPriorityScore">>
  >;
  memberId: string;
  storeConfig?: Pick<HetangStoreConfig, "customerGrowth" | "roomCount" | "operatingHoursPerDay">;
}): MemberReactivationPriorityBand {
  const ordered = [...params.rows].sort(
    (left, right) =>
      (right.executionPriorityScore ?? right.strategyPriorityScore) -
        (left.executionPriorityScore ?? left.strategyPriorityScore) ||
      left.memberId.localeCompare(right.memberId),
  );
  const index = ordered.findIndex((row) => row.memberId === params.memberId);
  if (index < 0 || ordered.length === 0) {
    return "P3";
  }
  const counts = resolveBandCounts({
    total: ordered.length,
    storeConfig: params.storeConfig,
  });
  if (index < counts.p0) {
    return "P0";
  }
  if (index < counts.p0 + counts.p1) {
    return "P1";
  }
  if (index < counts.p0 + counts.p1 + counts.p2) {
    return "P2";
  }
  return "P3";
}

function resolveReasonSummary(params: {
  feature: MemberReactivationFeatureRecord;
  strategy: MemberReactivationStrategyRecord;
  topTechName?: string | null;
  actionProfileBridge?: {
    serviceNeed?: string;
    preferredTechName?: string;
  } | null;
  birthdayWindowDays?: number | null;
  environmentContext?: EnvironmentContextSnapshot;
}): string {
  const parts = [
    `已沉默${params.feature.daysSinceLastVisit}天`,
    `近90天消费${formatCurrency(params.feature.payAmount90d)}`,
  ];
  const birthdayReasonLabel = resolveBirthdayReasonLabel(params.birthdayWindowDays ?? null);
  if (birthdayReasonLabel) {
    parts.push(birthdayReasonLabel);
  }
  if (params.feature.projectedBalanceDaysLeft !== null && params.feature.projectedBalanceDaysLeft <= 45) {
    parts.push(`预计余额约${Math.round(params.feature.projectedBalanceDaysLeft)}天内见底`);
  }
  if (params.topTechName) {
    parts.push(`优先联系熟悉技师${params.topTechName}`);
  } else if (params.actionProfileBridge?.preferredTechName) {
    parts.push(`优先联系熟悉技师${params.actionProfileBridge.preferredTechName}`);
  } else if (params.strategy.recommendedActionLabel === "immediate-1to1") {
    parts.push("优先一对一人工召回");
  }
  if (params.actionProfileBridge?.serviceNeed) {
    parts.push(`当前服务诉求偏${params.actionProfileBridge.serviceNeed}`);
  }
  if (
    params.environmentContext?.eveningOutingLikelihood === "high" &&
    params.environmentContext?.postDinnerLeisureBias === "high"
  ) {
    parts.push("当前晚间休闲需求偏强");
  }
  return `${parts.join("，")}。`;
}

function resolveTouchAdviceSummary(params: {
  strategy: MemberReactivationStrategyRecord;
  actionProfileBridge?: {
    serviceNeed?: string;
    preferredChannel?: string;
    preferredTechName?: string;
  } | null;
  environmentContext?: EnvironmentContextSnapshot;
}): string {
  const touchWindow =
    params.strategy.recommendedTouchWeekday && params.strategy.recommendedTouchDaypart
      ? `${params.strategy.recommendedTouchWeekday} ${params.strategy.recommendedTouchDaypart}`
      : params.strategy.recommendedTouchWeekday ??
        params.strategy.recommendedTouchDaypart ??
        "本周合适时段";
  let summary: string;
  switch (params.strategy.touchWindowLabel) {
    case "best-today":
      summary = `建议${touchWindow}联系，今天就是最好窗口。`;
      break;
    case "best-this-week":
      summary = `建议${touchWindow}联系，本周命中较好窗口。`;
      break;
    case "wait-preferred-weekday":
      summary = `建议等到${touchWindow}再联系，匹配对方习惯更稳。`;
      break;
    default:
      summary = `建议${touchWindow}联系，当前时间偏好置信度一般。`;
      break;
  }
  if (params.actionProfileBridge?.preferredChannel) {
    if (params.actionProfileBridge.preferredChannel === "企微") {
      summary += " 优先企微1对1短消息触达。";
    } else {
      summary += ` 优先${params.actionProfileBridge.preferredChannel}触达。`;
    }
  }
  if (params.actionProfileBridge?.serviceNeed) {
    summary += ` 话术围绕${params.actionProfileBridge.serviceNeed}切入。`;
  }
  if (params.actionProfileBridge?.preferredTechName) {
    summary += ` 优先带出${params.actionProfileBridge.preferredTechName}的服务记忆。`;
  }
  if (
    params.environmentContext?.badWeatherTouchPenalty === "medium" ||
    params.environmentContext?.badWeatherTouchPenalty === "high"
  ) {
    summary += " 今天天气一般，别强推即时到店。";
  }
  return summary;
}

export function buildMemberReactivationQueueForBizDate(params: {
  orgId: string;
  bizDate: string;
  featureRows: MemberReactivationFeatureRecord[];
  strategyRows: MemberReactivationStrategyRecord[];
  operatingProfileRows?: CustomerOperatingProfileDailyRecord[];
  topTechByMemberId?: Map<string, string>;
  birthdayMonthDayByMemberId?: Map<string, string>;
  environmentContext?: EnvironmentContextSnapshot;
  storeConfig?: Pick<HetangStoreConfig, "customerGrowth" | "roomCount" | "operatingHoursPerDay">;
}): MemberReactivationQueueRecord[] {
  const strategyByMemberId = new Map(
    params.strategyRows.map((row) => [row.memberId, row] as const),
  );
  const actionProfileBridgeIndex = buildMemberActionProfileBridgeIndex(
    params.operatingProfileRows ?? [],
  );
  const provisional = params.featureRows
    .map((feature) => {
      const strategy =
        strategyByMemberId.get(feature.memberId) ??
        ({
          orgId: feature.orgId,
          bizDate: feature.bizDate,
          memberId: feature.memberId,
          customerIdentityKey: feature.customerIdentityKey,
          customerDisplayName: feature.customerDisplayName,
          primarySegment: feature.primarySegment,
          reactivationPriorityScore: feature.reactivationPriorityScore,
          churnRiskScore: 0,
          churnRiskLabel: "low",
          revisitProbability7d: 0,
          revisitWindowLabel: "later-this-month",
          recommendedTouchWeekday: feature.dominantVisitWeekday ?? null,
          recommendedTouchDaypart: feature.dominantVisitDaypart ?? null,
          touchWindowMatchScore: 0,
          touchWindowLabel: "low-confidence",
          lifecycleMomentumScore: 0,
          lifecycleMomentumLabel: "stable",
          recommendedActionLabel: resolveFallbackActionLabel(feature.primarySegment),
          strategyPriorityScore: feature.reactivationPriorityScore,
          strategyJson: "{}",
        } satisfies MemberReactivationStrategyRecord);
      return {
        feature,
        strategy,
        birthdayMonthDay: params.birthdayMonthDayByMemberId?.get(feature.memberId) ?? null,
      };
    })
    .sort(
      (left, right) =>
        (right.strategy.strategyPriorityScore +
          resolveBirthdayBoostScore({
            primarySegment: right.feature.primarySegment,
            birthdayWindowDays: resolveNextBirthdayOccurrence({
              bizDate: params.bizDate,
              birthdayMonthDay: right.birthdayMonthDay,
            }).birthdayWindowDays,
          })) -
          (left.strategy.strategyPriorityScore +
            resolveBirthdayBoostScore({
              primarySegment: left.feature.primarySegment,
              birthdayWindowDays: resolveNextBirthdayOccurrence({
                bizDate: params.bizDate,
                birthdayMonthDay: left.birthdayMonthDay,
              }).birthdayWindowDays,
            })) ||
        right.feature.payAmount90d - left.feature.payAmount90d ||
        right.feature.daysSinceLastVisit - left.feature.daysSinceLastVisit ||
        left.feature.memberId.localeCompare(right.feature.memberId),
    );

  return provisional.map(({ feature, strategy, birthdayMonthDay }, index) => {
    const { nextBirthdayBizDate, birthdayWindowDays } = resolveNextBirthdayOccurrence({
      bizDate: params.bizDate,
      birthdayMonthDay,
    });
    const birthdayBoostScore = resolveBirthdayBoostScore({
      primarySegment: feature.primarySegment,
      birthdayWindowDays,
    });
    const executionPriorityScore = strategy.strategyPriorityScore + birthdayBoostScore;
    const topTechName = params.topTechByMemberId?.get(feature.memberId) ?? null;
    const priorityBand = resolveMemberReactivationPriorityBand({
      rows: provisional.map((entry) => ({
        memberId: entry.feature.memberId,
        strategyPriorityScore: entry.strategy.strategyPriorityScore,
        executionPriorityScore:
          entry.strategy.strategyPriorityScore +
          resolveBirthdayBoostScore({
            primarySegment: entry.feature.primarySegment,
            birthdayWindowDays: resolveNextBirthdayOccurrence({
              bizDate: params.bizDate,
              birthdayMonthDay: entry.birthdayMonthDay,
            }).birthdayWindowDays,
          }),
      })),
      memberId: feature.memberId,
      storeConfig: params.storeConfig,
    });
    const actionProfileBridge = resolveMemberActionProfileBridge({
      bridgeIndex: actionProfileBridgeIndex,
      memberId: feature.memberId,
      customerIdentityKey: feature.customerIdentityKey,
    });
    const reasonSummary = resolveReasonSummary({
      feature,
      strategy,
      topTechName,
      actionProfileBridge,
      birthdayWindowDays,
      environmentContext: params.environmentContext,
    });
    const touchAdviceSummary = resolveTouchAdviceSummary({
      strategy,
      actionProfileBridge,
      environmentContext: params.environmentContext,
    });
    return {
      orgId: params.orgId,
      bizDate: params.bizDate,
      memberId: feature.memberId,
      customerIdentityKey: feature.customerIdentityKey,
      customerDisplayName: feature.customerDisplayName,
      memberCardNo: feature.memberCardNo,
      referenceCode: feature.referenceCode,
      primarySegment: feature.primarySegment,
      followupBucket: resolveReactivationFollowupBucket(feature.primarySegment),
      reactivationPriorityScore: feature.reactivationPriorityScore,
      strategyPriorityScore: strategy.strategyPriorityScore,
      executionPriorityScore,
      priorityBand,
      priorityRank: index + 1,
      churnRiskLabel: strategy.churnRiskLabel,
      churnRiskScore: strategy.churnRiskScore,
      revisitWindowLabel: strategy.revisitWindowLabel,
      recommendedActionLabel: strategy.recommendedActionLabel,
      recommendedTouchWeekday: strategy.recommendedTouchWeekday,
      recommendedTouchDaypart: strategy.recommendedTouchDaypart,
      touchWindowLabel: strategy.touchWindowLabel,
      reasonSummary,
      touchAdviceSummary,
      daysSinceLastVisit: feature.daysSinceLastVisit,
      visitCount90d: feature.visitCount90d,
      payAmount90d: feature.payAmount90d,
      currentStoredBalanceInferred: feature.currentStoredBalanceInferred,
      projectedBalanceDaysLeft: feature.projectedBalanceDaysLeft,
      birthdayMonthDay,
      nextBirthdayBizDate,
      birthdayWindowDays,
      birthdayBoostScore,
      topTechName,
      queueJson: JSON.stringify({
        priorityBand,
        priorityRank: index + 1,
        executionPriorityScore,
        reasonSummary,
        touchAdviceSummary,
        churnRiskLabel: strategy.churnRiskLabel,
        revisitWindowLabel: strategy.revisitWindowLabel,
        dailyTouchCapacity: estimateDailyTouchCapacity({
          storeConfig: params.storeConfig,
        }),
        birthdayMonthDay,
        nextBirthdayBizDate,
        birthdayWindowDays,
        birthdayBoostScore,
        operatingProfileBridge: actionProfileBridge
          ? {
              serviceNeed: actionProfileBridge.serviceNeed ?? null,
              preferredChannel: actionProfileBridge.preferredChannel ?? null,
              preferredTechName: actionProfileBridge.preferredTechName ?? null,
              confidenceFactor: actionProfileBridge.confidenceFactor,
              actionBoostScore: actionProfileBridge.actionBoostScore,
            }
          : null,
      }),
      updatedAt: new Date().toISOString(),
    };
  });
}

function resolveBirthdayMonthDayFromSnapshot(
  row: Pick<MemberDailySnapshotRecord, "rawJson">,
): string | null {
  return resolveBirthdayMonthDay(row.rawJson);
}

async function rebuildMemberReactivationQueueChunk(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  storeConfig?: Pick<
    HetangStoreConfig,
    "orgId" | "storeName" | "customerGrowth" | "roomCount" | "operatingHoursPerDay"
  >;
}): Promise<number> {
  const [featureRows, strategyRows, memberSnapshots] = await Promise.all([
    params.store.listMemberReactivationFeaturesByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    ),
    params.store.listMemberReactivationStrategiesByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    ),
    params.store.listMemberDailySnapshotsByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    ),
  ]);
  const featureRowsByBizDate = new Map<string, MemberReactivationFeatureRecord[]>();
  const strategyRowsByBizDate = new Map<string, MemberReactivationStrategyRecord[]>();
  const birthdayMonthDayByBizDate = new Map<string, Map<string, string>>();
  for (const row of featureRows) {
    const current = featureRowsByBizDate.get(row.bizDate) ?? [];
    current.push(row);
    featureRowsByBizDate.set(row.bizDate, current);
  }
  for (const row of strategyRows) {
    const current = strategyRowsByBizDate.get(row.bizDate) ?? [];
    current.push(row);
    strategyRowsByBizDate.set(row.bizDate, current);
  }
  for (const row of memberSnapshots) {
    const birthdayMonthDay = resolveBirthdayMonthDayFromSnapshot(row);
    if (!birthdayMonthDay) {
      continue;
    }
    const current = birthdayMonthDayByBizDate.get(row.bizDate) ?? new Map<string, string>();
    current.set(row.memberId, birthdayMonthDay);
    birthdayMonthDayByBizDate.set(row.bizDate, current);
  }

  let rewrittenDays = 0;
  for (
    let bizDate = params.startBizDate;
    bizDate <= params.endBizDate;
    bizDate = shiftBizDate(bizDate, 1)
  ) {
    const segments = await params.store.listCustomerSegments(params.orgId, bizDate);
    const operatingProfileRows = params.store.listCustomerOperatingProfilesDaily
      ? await params.store.listCustomerOperatingProfilesDaily(params.orgId, bizDate)
      : [];
    const topTechByMemberId = new Map<string, string>();
    for (const row of segments) {
      if (row.memberId && row.topTechName) {
        topTechByMemberId.set(row.memberId, row.topTechName);
      }
    }
    const environmentContext = buildStoreEnvironmentContextSnapshot({
      bizDate,
      storeConfig: params.storeConfig,
    });
    const rows = buildMemberReactivationQueueForBizDate({
      orgId: params.orgId,
      bizDate,
      featureRows: featureRowsByBizDate.get(bizDate) ?? [],
      strategyRows: strategyRowsByBizDate.get(bizDate) ?? [],
      operatingProfileRows,
      topTechByMemberId,
      birthdayMonthDayByMemberId: birthdayMonthDayByBizDate.get(bizDate),
      environmentContext,
      storeConfig: params.storeConfig,
    });
    await params.store.replaceMemberReactivationQueue(
      params.orgId,
      bizDate,
      rows,
      new Date().toISOString(),
      { refreshViews: false },
    );
    rewrittenDays += 1;
  }
  return rewrittenDays;
}

export async function rebuildMemberReactivationQueueForDateRange(params: {
  store: HetangOpsStore;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  refreshViews?: boolean;
  storeConfig?: Pick<
    HetangStoreConfig,
    "orgId" | "storeName" | "customerGrowth" | "roomCount" | "operatingHoursPerDay"
  >;
}): Promise<number> {
  let rebuiltDays = 0;
  for (let chunkStartBizDate = params.startBizDate; chunkStartBizDate <= params.endBizDate; ) {
    let chunkEndBizDate = shiftBizDate(chunkStartBizDate, REACTIVATION_QUEUE_REBUILD_CHUNK_DAYS - 1);
    if (chunkEndBizDate > params.endBizDate) {
      chunkEndBizDate = params.endBizDate;
    }
    rebuiltDays += await rebuildMemberReactivationQueueChunk({
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
