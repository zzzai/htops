import { shiftBizDate } from "../../time.js";
import type {
  MemberReactivationExecutionTaskRecord,
  MemberReactivationOutcomeSnapshotRecord,
  CustomerPrimarySegment,
  MemberReactivationActionLabel,
} from "../../types.js";
import type { CustomerGrowthFollowupSummary } from "../ai/contracts.js";

type LearningCalibrationEntry = {
  sampleCount: number;
  avgOutcomeScore: number;
  bookedRate: number;
  arrivalRate: number;
  adjustmentScore: number;
};

export type MemberReactivationOutcomeLearningIndex = {
  byPrimarySegmentAndAction: Map<string, LearningCalibrationEntry>;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildLearningKey(
  primarySegment: CustomerPrimarySegment,
  recommendedActionLabel: MemberReactivationActionLabel,
): string {
  return `${primarySegment}|${recommendedActionLabel}`;
}

function resolveOutcomeLabelAndScore(task: Pick<
  MemberReactivationExecutionTaskRecord,
  "feedbackStatus" | "contacted" | "replied" | "booked" | "arrived"
>): {
  outcomeLabel: MemberReactivationOutcomeSnapshotRecord["outcomeLabel"];
  outcomeScore: number;
} {
  if (task.feedbackStatus === "closed") {
    return { outcomeLabel: "closed-lost", outcomeScore: 0.08 };
  }
  if (task.arrived) {
    return { outcomeLabel: "arrived", outcomeScore: 1 };
  }
  if (task.booked) {
    return { outcomeLabel: "booked", outcomeScore: 0.82 };
  }
  if (task.replied) {
    return { outcomeLabel: "replied", outcomeScore: 0.58 };
  }
  if (task.contacted) {
    return { outcomeLabel: "contacted-no-reply", outcomeScore: 0.32 };
  }
  return { outcomeLabel: "pending", outcomeScore: 0 };
}

function resolveNoteSignalLabels(note?: string): string[] {
  if (!note?.trim()) {
    return [];
  }
  const normalized = note.trim();
  const signals: string[] = [];
  const patterns: Array<{ label: string; regex: RegExp }> = [
    {
      label: "appointment-window",
      regex: /预约|已约|周[一二三四五六日天]|明天|后天|上午|中午|下午|晚上|到店|档期|[0-2]?\d点/u,
    },
    {
      label: "delay-objection",
      regex: /忙|改天|下次|以后|再看|再说|考虑|看情况/u,
    },
    {
      label: "price-objection",
      regex: /贵|价格|预算|优惠|折扣/u,
    },
    {
      label: "distance-objection",
      regex: /远|不方便|停车|路程/u,
    },
    {
      label: "staff-preference-mentioned",
      regex: /老师|技师|店长/u,
    },
  ];
  for (const pattern of patterns) {
    if (pattern.regex.test(normalized)) {
      signals.push(pattern.label);
    }
  }
  return signals.slice(0, 4);
}

export function buildMemberReactivationOutcomeSnapshot(params: {
  task: MemberReactivationExecutionTaskRecord;
  aiSummary?: CustomerGrowthFollowupSummary | null;
}): MemberReactivationOutcomeSnapshotRecord {
  const { outcomeLabel, outcomeScore } = resolveOutcomeLabelAndScore(params.task);
  const noteSignalLabels = resolveNoteSignalLabels(params.task.note);
  const learningJson = JSON.stringify({
    source: "reactivation-outcome-snapshot-v1",
    noteSignalLabels,
    aiSummary: params.aiSummary
      ? {
          outcomeSummary: params.aiSummary.outcomeSummary,
          objectionLabels: params.aiSummary.objectionLabels,
          nextBestAction: params.aiSummary.nextBestAction,
        }
      : undefined,
  });

  return {
    orgId: params.task.orgId,
    bizDate: params.task.bizDate,
    memberId: params.task.memberId,
    customerIdentityKey: params.task.customerIdentityKey,
    customerDisplayName: params.task.customerDisplayName,
    primarySegment: params.task.primarySegment,
    followupBucket: params.task.followupBucket,
    priorityBand: params.task.priorityBand,
    recommendedActionLabel: params.task.recommendedActionLabel,
    feedbackStatus: params.task.feedbackStatus,
    contacted: params.task.contacted,
    replied: params.task.replied,
    booked: params.task.booked,
    arrived: params.task.arrived,
    closed: params.task.feedbackStatus === "closed",
    outcomeLabel,
    outcomeScore,
    learningJson,
    updatedAt: params.task.feedbackUpdatedAt ?? params.task.updatedAt,
  };
}

export function buildMemberReactivationOutcomeLearningIndex(params: {
  snapshotRows: MemberReactivationOutcomeSnapshotRecord[];
  asOfBizDate: string;
  trailingDays?: number;
}): MemberReactivationOutcomeLearningIndex {
  const trailingDays = Math.max(7, Math.trunc(params.trailingDays ?? 90));
  const windowStartBizDate = shiftBizDate(params.asOfBizDate, -(trailingDays - 1));
  const grouped = new Map<
    string,
    Array<Pick<MemberReactivationOutcomeSnapshotRecord, "outcomeScore" | "booked" | "arrived">>
  >();

  for (const row of params.snapshotRows) {
    if (row.bizDate >= params.asOfBizDate || row.bizDate < windowStartBizDate) {
      continue;
    }
    const key = buildLearningKey(row.primarySegment, row.recommendedActionLabel);
    const current = grouped.get(key) ?? [];
    current.push({
      outcomeScore: row.outcomeScore,
      booked: row.booked,
      arrived: row.arrived,
    });
    grouped.set(key, current);
  }

  const byPrimarySegmentAndAction = new Map<string, LearningCalibrationEntry>();
  for (const [key, rows] of grouped.entries()) {
    const sampleCount = rows.length;
    const avgOutcomeScore =
      sampleCount > 0 ? round(rows.reduce((sum, row) => sum + row.outcomeScore, 0) / sampleCount, 4) : 0;
    const bookedRate =
      sampleCount > 0 ? round(rows.filter((row) => row.booked).length / sampleCount, 4) : 0;
    const arrivalRate =
      sampleCount > 0 ? round(rows.filter((row) => row.arrived).length / sampleCount, 4) : 0;
    const confidence = clamp(sampleCount / 6, 0, 1);
    const adjustmentScore =
      sampleCount >= 3
        ? round(clamp((avgOutcomeScore - 0.55) * 40 * confidence, -12, 12), 2)
        : 0;
    byPrimarySegmentAndAction.set(key, {
      sampleCount,
      avgOutcomeScore,
      bookedRate,
      arrivalRate,
      adjustmentScore,
    });
  }

  return {
    byPrimarySegmentAndAction,
  };
}

export function resolveMemberReactivationLearningEntry(params: {
  learningIndex: MemberReactivationOutcomeLearningIndex;
  primarySegment: CustomerPrimarySegment;
  recommendedActionLabel: MemberReactivationActionLabel;
}): LearningCalibrationEntry | null {
  return (
    params.learningIndex.byPrimarySegmentAndAction.get(
      buildLearningKey(params.primarySegment, params.recommendedActionLabel),
    ) ?? null
  );
}
