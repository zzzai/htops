import {
  resolveBirthdayBoostScore,
  resolveBirthdayMonthDay,
  resolveBirthdayReasonLabel,
  resolveNextBirthdayOccurrence,
} from "./birthday-utils.js";
import { shiftBizDate } from "./time.js";
import { HetangOpsStore } from "./store.js";
import type {
  CustomerPrimarySegment,
  MemberReactivationActionLabel,
  MemberDailySnapshotRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationFollowupBucket,
  MemberReactivationPriorityBand,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
} from "./types.js";

const REACTIVATION_QUEUE_REBUILD_CHUNK_DAYS = 7;

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

function resolveBandCounts(total: number): {
  p0: number;
  p1: number;
  p2: number;
} {
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

export function resolveMemberReactivationPriorityBand(params: {
  rows: Array<
    Pick<MemberReactivationQueueRecord, "memberId" | "strategyPriorityScore"> &
      Partial<Pick<MemberReactivationQueueRecord, "executionPriorityScore">>
  >;
  memberId: string;
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
  const counts = resolveBandCounts(ordered.length);
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
  birthdayWindowDays?: number | null;
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
  } else if (params.strategy.recommendedActionLabel === "immediate-1to1") {
    parts.push("优先一对一人工召回");
  }
  return `${parts.join("，")}。`;
}

function resolveTouchAdviceSummary(params: {
  strategy: MemberReactivationStrategyRecord;
}): string {
  const touchWindow =
    params.strategy.recommendedTouchWeekday && params.strategy.recommendedTouchDaypart
      ? `${params.strategy.recommendedTouchWeekday} ${params.strategy.recommendedTouchDaypart}`
      : params.strategy.recommendedTouchWeekday ??
        params.strategy.recommendedTouchDaypart ??
        "本周合适时段";
  switch (params.strategy.touchWindowLabel) {
    case "best-today":
      return `建议${touchWindow}联系，今天就是最好窗口。`;
    case "best-this-week":
      return `建议${touchWindow}联系，本周命中较好窗口。`;
    case "wait-preferred-weekday":
      return `建议等到${touchWindow}再联系，匹配对方习惯更稳。`;
    default:
      return `建议${touchWindow}联系，当前时间偏好置信度一般。`;
  }
}

export function buildMemberReactivationQueueForBizDate(params: {
  orgId: string;
  bizDate: string;
  featureRows: MemberReactivationFeatureRecord[];
  strategyRows: MemberReactivationStrategyRecord[];
  topTechByMemberId?: Map<string, string>;
  birthdayMonthDayByMemberId?: Map<string, string>;
}): MemberReactivationQueueRecord[] {
  const strategyByMemberId = new Map(
    params.strategyRows.map((row) => [row.memberId, row] as const),
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
    });
    const reasonSummary = resolveReasonSummary({
      feature,
      strategy,
      topTechName,
      birthdayWindowDays,
    });
    const touchAdviceSummary = resolveTouchAdviceSummary({
      strategy,
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
        birthdayMonthDay,
        nextBirthdayBizDate,
        birthdayWindowDays,
        birthdayBoostScore,
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
    const topTechByMemberId = new Map<string, string>();
    for (const row of segments) {
      if (row.memberId && row.topTechName) {
        topTechByMemberId.set(row.memberId, row.topTechName);
      }
    }
    const rows = buildMemberReactivationQueueForBizDate({
      orgId: params.orgId,
      bizDate,
      featureRows: featureRowsByBizDate.get(bizDate) ?? [],
      strategyRows: strategyRowsByBizDate.get(bizDate) ?? [],
      topTechByMemberId,
      birthdayMonthDayByMemberId: birthdayMonthDayByBizDate.get(bizDate),
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
    });
    chunkStartBizDate = shiftBizDate(chunkEndBizDate, 1);
  }
  return rebuiltDays;
}
