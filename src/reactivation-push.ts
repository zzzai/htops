import {
  resolveFollowUpBucket,
  resolveFollowUpBucketLabel,
  resolveFollowUpPriorityScore,
  resolveFollowUpReason,
  shouldIncludeFollowUpCandidate,
  type FollowUpBucketKey,
} from "./customer-query.js";
import { shiftBizDate } from "./time.js";
import type {
  CustomerSegmentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationStrategyRecord,
} from "./types.js";

const CUSTOMER_SNAPSHOT_LOOKBACK_DAYS = 7;
const MIN_MEMBER_LINKED_SNAPSHOT_RATIO = 0.6;

export type ReactivationPushRuntime = {
  listCustomerSegments: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listMemberReactivationFeatures?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationFeatureRecord[]>;
  listMemberReactivationStrategies?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationStrategyRecord[]>;
};

export type ReactivationPushCandidate = {
  row: CustomerSegmentRecord;
  bucketKey: FollowUpBucketKey;
  bucketLabel: string;
  score: number;
  reason: string;
  strategy?: MemberReactivationStrategyRecord;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function countMemberLinkedRows(rows: CustomerSegmentRecord[]): number {
  return rows.reduce((count, row) => count + (row.memberId ? 1 : 0), 0);
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function sanitizeDisplayName(value: string | undefined): string {
  return (value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/[\s)）】]+$/u, "")
    .trim();
}

function looksMachineLikeDisplayName(value: string, memberId?: string): boolean {
  if (!value) {
    return true;
  }
  if (memberId && value === memberId) {
    return true;
  }
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) ||
    /^[0-9a-f]{24,}$/iu.test(value)
  );
}

function resolveCandidateDisplayName(row: CustomerSegmentRecord): string {
  const displayName = sanitizeDisplayName(row.customerDisplayName);
  if (displayName && !looksMachineLikeDisplayName(displayName, row.memberId)) {
    return displayName;
  }
  const memberCardNo = sanitizeDisplayName(row.memberCardNo);
  if (memberCardNo) {
    return `会员卡${memberCardNo}`;
  }
  const referenceCode = sanitizeDisplayName(row.referenceCode);
  if (referenceCode) {
    return `会员${referenceCode}`;
  }
  if (row.memberId) {
    return `会员${row.memberId.slice(-6)}`;
  }
  return "该会员";
}

function sortCandidates(
  rows: CustomerSegmentRecord[],
  featureRows: MemberReactivationFeatureRecord[] = [],
  strategyRows: MemberReactivationStrategyRecord[] = [],
): ReactivationPushCandidate[] {
  const featureByMemberId = new Map(
    featureRows.map((row) => [row.memberId, row] as const),
  );
  const strategyByMemberId = new Map(
    strategyRows.map((row) => [row.memberId, row] as const),
  );
  return rows
    .map((row) => {
      const bucketKey = resolveFollowUpBucket(row);
      if (!bucketKey) {
        return null;
      }
      const feature = row.memberId ? featureByMemberId.get(row.memberId) : undefined;
      const strategy = row.memberId ? strategyByMemberId.get(row.memberId) : undefined;
      return {
        row,
        bucketKey,
        bucketLabel: resolveFollowUpBucketLabel(bucketKey),
        score:
          strategy?.strategyPriorityScore ??
          feature?.reactivationPriorityScore ??
          resolveFollowUpPriorityScore(row),
        reason: resolveFollowUpReason(row),
        strategy,
      };
    })
    .filter((entry): entry is ReactivationPushCandidate => entry !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.row.payAmount90d - left.row.payAmount90d ||
        right.row.daysSinceLastVisit - left.row.daysSinceLastVisit ||
        left.row.customerDisplayName.localeCompare(right.row.customerDisplayName),
    );
}

function resolveHeadline(params: {
  storeName: string;
  candidate: ReactivationPushCandidate;
}): string {
  const { storeName, candidate } = params;
  const { row } = candidate;

  switch (candidate.bucketKey) {
    case "high-value-reactivation":
      return `${storeName}召回预警｜${resolveCandidateDisplayName(row)}已沉默${row.daysSinceLastVisit}天，今天先跟进`;
    case "potential-growth":
      return `${storeName}成长转化｜${resolveCandidateDisplayName(row)}近90天已来${row.visitCount90d}次，今天再推一步`;
    case "groupbuy-retention":
      return `${storeName}团购承接｜${resolveCandidateDisplayName(row)}正处转化窗口，今天先跟进`;
    default:
      return `${storeName}会员跟进｜${resolveCandidateDisplayName(row)}今天先跟进`;
  }
}

function resolveAction(candidate: ReactivationPushCandidate): string {
  switch (candidate.bucketKey) {
    case "high-value-reactivation":
      if (candidate.row.topTechName) {
        return `客服今天先围绕 ${sanitizeDisplayName(candidate.row.topTechName)} 做1对1邀约，优先约回熟悉技师档期，不先发通用券。`;
      }
      return "客服今天先做1对1召回电话，优先约回固定时段，不先发通用券。";
    case "potential-growth":
      if (candidate.row.topTechName) {
        return `客服今天趁热约下一次到店，可结合 ${sanitizeDisplayName(candidate.row.topTechName)} 的熟悉服务推进项目升级或储值转化。`;
      }
      return "客服今天趁热约下一次到店，优先推动第二次消费而不是只做泛关怀。";
    case "groupbuy-retention":
      return "客服今天围绕首单体验做回访，优先推动开卡或储值承接，不只停留在团购复到店。";
    default:
      return "客服今天先人工回访，确认下次到店时间和主诉求。";
  }
}

function resolveTechLine(candidate: ReactivationPushCandidate): string {
  if (!candidate.row.topTechName) {
    return "主服务技师暂未稳定，先由客服承接并补齐偏好。";
  }
  const share =
    candidate.row.topTechVisitShare90d && Number.isFinite(candidate.row.topTechVisitShare90d)
      ? `｜近90天服务占比 ${Math.round(candidate.row.topTechVisitShare90d * 100)}%`
      : "";
  return `${sanitizeDisplayName(candidate.row.topTechName)}${share}`;
}

function resolveStrategyLine(candidate: ReactivationPushCandidate): string | null {
  const strategy = candidate.strategy;
  if (!strategy) {
    return null;
  }
  const touchWindow =
    strategy.recommendedTouchWeekday && strategy.recommendedTouchDaypart
      ? `${strategy.recommendedTouchWeekday} / ${strategy.recommendedTouchDaypart}`
      : strategy.recommendedTouchWeekday ?? strategy.recommendedTouchDaypart ?? "待补窗口";
  return `- 策略判断：流失风险 ${strategy.churnRiskLabel}｜回店窗口 ${strategy.revisitWindowLabel}｜触达建议 ${touchWindow}｜动作 ${strategy.recommendedActionLabel}`;
}

export async function loadLatestCustomerSegmentSnapshot(params: {
  runtime: ReactivationPushRuntime;
  orgId: string;
  targetBizDate: string;
}): Promise<{ bizDate: string; rows: CustomerSegmentRecord[] }> {
  const snapshots: Array<{
    bizDate: string;
    rows: CustomerSegmentRecord[];
    memberLinkedCount: number;
  }> = [];
  for (let offset = 0; offset <= CUSTOMER_SNAPSHOT_LOOKBACK_DAYS; offset += 1) {
    const bizDate = shiftBizDate(params.targetBizDate, -offset);
    const rows = await params.runtime.listCustomerSegments({
      orgId: params.orgId,
      bizDate,
    });
    snapshots.push({
      bizDate,
      rows,
      memberLinkedCount: countMemberLinkedRows(rows),
    });
  }

  const nonEmptySnapshots = snapshots.filter((snapshot) => snapshot.rows.length > 0);
  if (nonEmptySnapshots.length === 0) {
    return {
      bizDate: params.targetBizDate,
      rows: [],
    };
  }

  const maxMemberLinkedCount = nonEmptySnapshots.reduce(
    (currentMax, snapshot) => Math.max(currentMax, snapshot.memberLinkedCount),
    0,
  );
  if (maxMemberLinkedCount <= 0) {
    const latestNonEmpty = nonEmptySnapshots[0]!;
    return {
      bizDate: latestNonEmpty.bizDate,
      rows: latestNonEmpty.rows,
    };
  }

  const minAcceptableMemberLinkedCount = Math.max(
    1,
    Math.floor(maxMemberLinkedCount * MIN_MEMBER_LINKED_SNAPSHOT_RATIO),
  );
  const latestStableSnapshot =
    nonEmptySnapshots.find(
      (snapshot) => snapshot.memberLinkedCount >= minAcceptableMemberLinkedCount,
    ) ?? nonEmptySnapshots[0]!;
  return {
    bizDate: latestStableSnapshot.bizDate,
    rows: latestStableSnapshot.rows,
  };
}

export function selectTopReactivationCandidate(
  rows: CustomerSegmentRecord[],
  featureRows: MemberReactivationFeatureRecord[] = [],
  strategyRows: MemberReactivationStrategyRecord[] = [],
): ReactivationPushCandidate | null {
  const preferred = sortCandidates(
    rows.filter(shouldIncludeFollowUpCandidate),
    featureRows,
    strategyRows,
  );
  if (preferred.length > 0) {
    return preferred[0] ?? null;
  }
  const fallback = sortCandidates(rows, featureRows, strategyRows);
  return fallback[0] ?? null;
}

export function renderReactivationPushMessage(params: {
  storeName: string;
  snapshotBizDate: string;
  candidate: ReactivationPushCandidate;
}): string {
  const { candidate } = params;
  const { row } = candidate;
  const latestVisit = row.lastBizDate ?? "未识别到最近到店日期";
  const strategyLine = resolveStrategyLine(candidate);

  return [
    resolveHeadline({
      storeName: params.storeName,
      candidate,
    }),
    `- 经营分层：${candidate.bucketLabel}`,
    `- 最近到店：${latestVisit}｜近90天到店 ${row.visitCount90d} 次｜近90天支付 ${formatCurrency(row.payAmount90d)}`,
    `- 主服务技师：${resolveTechLine(candidate)}`,
    ...(strategyLine ? [strategyLine] : []),
    `- 优先原因：${candidate.reason}`,
    `- 今日动作：${resolveAction(candidate)}`,
    `- 快照日期：${params.snapshotBizDate}`,
  ].join("\n");
}
