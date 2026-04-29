import { describe, expect, it } from "vitest";

import {
  buildMemberReactivationOutcomeLearningIndex,
  buildMemberReactivationOutcomeSnapshot,
} from "./learning.js";
import type {
  MemberReactivationExecutionTaskRecord,
  MemberReactivationOutcomeSnapshotRecord,
} from "../../types.js";

function buildExecutionTask(
  overrides: Partial<MemberReactivationExecutionTaskRecord> = {},
): MemberReactivationExecutionTaskRecord {
  return {
    orgId: "1005",
    bizDate: "2026-04-18",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    memberCardNo: "YB001",
    referenceCode: "YB001",
    primarySegment: "important-reactivation-member",
    followupBucket: "high-value-reactivation",
    reactivationPriorityScore: 760,
    strategyPriorityScore: 980,
    executionPriorityScore: 1040,
    priorityBand: "P0",
    priorityRank: 1,
    churnRiskLabel: "critical",
    churnRiskScore: 0.88,
    revisitWindowLabel: "due-now",
    recommendedActionLabel: "immediate-1to1",
    recommendedTouchWeekday: "friday",
    recommendedTouchDaypart: "after-work",
    touchWindowLabel: "best-today",
    reasonSummary: "已沉默36天，近90天消费4680.00元，优先一对一召回。",
    touchAdviceSummary: "建议周五 after-work 联系。",
    daysSinceLastVisit: 36,
    visitCount90d: 5,
    payAmount90d: 4680,
    currentStoredBalanceInferred: 680,
    projectedBalanceDaysLeft: 34,
    birthdayMonthDay: "04-20",
    nextBirthdayBizDate: "2026-04-20",
    birthdayWindowDays: 2,
    birthdayBoostScore: 20,
    topTechName: "安老师",
    queueJson: "{}",
    updatedAt: "2026-04-18T09:00:00+08:00",
    feedbackStatus: "booked",
    followedBy: "店长A",
    followedAt: "2026-04-18T15:20:00+08:00",
    contacted: true,
    replied: true,
    booked: true,
    arrived: false,
    note: "客户说周六下午可以来，中午前再确认一下。",
    feedbackUpdatedAt: "2026-04-18T15:21:00+08:00",
    ...overrides,
  };
}

function buildOutcomeSnapshot(
  overrides: Partial<MemberReactivationOutcomeSnapshotRecord> = {},
): MemberReactivationOutcomeSnapshotRecord {
  return {
    orgId: "1005",
    bizDate: "2026-04-10",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    primarySegment: "important-reactivation-member",
    followupBucket: "high-value-reactivation",
    priorityBand: "P0",
    recommendedActionLabel: "immediate-1to1",
    feedbackStatus: "booked",
    contacted: true,
    replied: true,
    booked: true,
    arrived: false,
    closed: false,
    outcomeLabel: "booked",
    outcomeScore: 0.82,
    learningJson: "{}",
    updatedAt: "2026-04-10T15:21:00+08:00",
    ...overrides,
  };
}

describe("reactivation learning", () => {
  it("normalizes an execution task into a bounded outcome snapshot", () => {
    const snapshot = buildMemberReactivationOutcomeSnapshot({
      task: buildExecutionTask(),
      aiSummary: {
        outcomeSummary: "客户已约周六下午到店，但仍需中午前再确认一次。",
        objectionLabels: ["需二次确认最终时间"],
      },
    });

    expect(snapshot).toMatchObject({
      memberId: "M-001",
      feedbackStatus: "booked",
      outcomeLabel: "booked",
      outcomeScore: 0.82,
      closed: false,
    });
    expect(JSON.parse(snapshot.learningJson)).toMatchObject({
      noteSignalLabels: ["appointment-window"],
      aiSummary: {
        outcomeSummary: "客户已约周六下午到店，但仍需中午前再确认一次。",
        objectionLabels: ["需二次确认最终时间"],
      },
    });
  });

  it("builds learning calibration only from recent historical outcomes and keeps it bounded", () => {
    const learning = buildMemberReactivationOutcomeLearningIndex({
      asOfBizDate: "2026-04-18",
      snapshotRows: [
        buildOutcomeSnapshot({
          bizDate: "2026-04-10",
          memberId: "M-001",
          outcomeScore: 1,
          outcomeLabel: "arrived",
          feedbackStatus: "arrived",
          arrived: true,
          learningJson: "{}",
        }),
        buildOutcomeSnapshot({
          bizDate: "2026-04-11",
          memberId: "M-002",
          outcomeScore: 0.82,
          outcomeLabel: "booked",
          learningJson: "{}",
        }),
        buildOutcomeSnapshot({
          bizDate: "2026-04-12",
          memberId: "M-003",
          outcomeScore: 0.82,
          outcomeLabel: "booked",
          learningJson: "{}",
        }),
        buildOutcomeSnapshot({
          bizDate: "2026-04-13",
          memberId: "M-004",
          outcomeScore: 0.82,
          outcomeLabel: "booked",
          learningJson: "{}",
        }),
      ],
    });

    const entry = learning.byPrimarySegmentAndAction.get(
      "important-reactivation-member|immediate-1to1",
    );

    expect(entry).toMatchObject({
      sampleCount: 4,
      bookedRate: 1,
      arrivalRate: 0.25,
    });
    expect(entry?.adjustmentScore).toBeGreaterThan(0);
    expect(entry?.adjustmentScore).toBeLessThanOrEqual(12);
  });
});
