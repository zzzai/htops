import { describe, expect, it } from "vitest";

import {
  buildMemberReactivationQueueForBizDate,
  rebuildMemberReactivationQueueForDateRange,
  resolveMemberReactivationPriorityBand,
} from "./reactivation-queue.js";
import type {
  EnvironmentContextSnapshot,
  MemberReactivationFeatureRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
} from "./types.js";

function buildFeatureRow(
  overrides: Partial<MemberReactivationFeatureRecord> = {},
): MemberReactivationFeatureRecord {
  return {
    orgId: "1005",
    bizDate: "2026-04-09",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    memberCardNo: "YB001",
    referenceCode: "YB001",
    primarySegment: "important-reactivation-member",
    daysSinceLastVisit: 36,
    visitCount30d: 0,
    visitCount90d: 5,
    payAmount30d: 0,
    payAmount90d: 4680,
    memberPayAmount30d: 0,
    memberPayAmount90d: 4680,
    rechargeTotal30d: 0,
    rechargeTotal90d: 1200,
    rechargeCount30d: 0,
    rechargeCount90d: 1,
    daysSinceLastRecharge: 34,
    currentStoredBalanceInferred: 680,
    storedBalance7dAgo: 820,
    storedBalance30dAgo: 1280,
    storedBalance90dAgo: 2160,
    storedBalanceDelta7d: -140,
    storedBalanceDelta30d: -600,
    storedBalanceDelta90d: -1480,
    depletionVelocity30d: 20,
    projectedBalanceDaysLeft: 34,
    rechargeToMemberPayRatio90d: 0.2564,
    dominantVisitDaypart: "after-work",
    preferredDaypartShare90d: 0.8,
    dominantVisitWeekday: "thursday",
    preferredWeekdayShare90d: 0.6,
    dominantVisitMonthPhase: "early",
    preferredMonthPhaseShare90d: 0.6,
    weekendVisitShare90d: 0.2,
    lateNightVisitShare90d: 0.1,
    overnightVisitShare90d: 0,
    averageVisitGapDays90d: 9,
    visitGapStddevDays90d: 1.8,
    cycleDeviationScore: 1.4,
    timePreferenceConfidenceScore: 0.72,
    trajectoryConfidenceScore: 0.91,
    reactivationPriorityScore: 760,
    featureJson: "{}",
    ...overrides,
  };
}

function buildStrategyRow(
  overrides: Partial<MemberReactivationStrategyRecord> = {},
): MemberReactivationStrategyRecord {
  return {
    orgId: "1005",
    bizDate: "2026-04-09",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    primarySegment: "important-reactivation-member",
    reactivationPriorityScore: 760,
    churnRiskScore: 0.88,
    churnRiskLabel: "critical",
    revisitProbability7d: 0.81,
    revisitWindowLabel: "due-now",
    recommendedTouchWeekday: "thursday",
    recommendedTouchDaypart: "after-work",
    touchWindowMatchScore: 0.9,
    touchWindowLabel: "best-today",
    lifecycleMomentumScore: 0.12,
    lifecycleMomentumLabel: "cooling",
    recommendedActionLabel: "immediate-1to1",
    strategyPriorityScore: 980,
    strategyJson: "{}",
    ...overrides,
  };
}

describe("reactivation-queue", () => {
  it("assigns stable daily priority bands from same-day relative ranking", () => {
    const rows = [
      { memberId: "M-001", strategyPriorityScore: 980 },
      { memberId: "M-002", strategyPriorityScore: 860 },
      { memberId: "M-003", strategyPriorityScore: 720 },
      { memberId: "M-004", strategyPriorityScore: 580 },
    ] satisfies Array<Pick<MemberReactivationQueueRecord, "memberId" | "strategyPriorityScore">>;

    expect(resolveMemberReactivationPriorityBand({ rows, memberId: "M-001" })).toBe("P0");
    expect(resolveMemberReactivationPriorityBand({ rows, memberId: "M-002" })).toBe("P1");
    expect(resolveMemberReactivationPriorityBand({ rows, memberId: "M-003" })).toBe("P2");
    expect(resolveMemberReactivationPriorityBand({ rows, memberId: "M-004" })).toBe("P3");
  });

  it("caps actionable priority bands by configured daily touch capacity", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      memberId: `M-${String(index + 1).padStart(3, "0")}`,
      strategyPriorityScore: 1000 - index * 10,
    })) satisfies Array<Pick<MemberReactivationQueueRecord, "memberId" | "strategyPriorityScore">>;

    expect(
      resolveMemberReactivationPriorityBand({
        rows,
        memberId: "M-001",
        storeConfig: {
          customerGrowth: {
            reactivationCapacity: {
              dailyTouchCapacity: 4,
            },
          },
        },
      }),
    ).toBe("P0");
    expect(
      resolveMemberReactivationPriorityBand({
        rows,
        memberId: "M-002",
        storeConfig: {
          customerGrowth: {
            reactivationCapacity: {
              dailyTouchCapacity: 4,
            },
          },
        },
      }),
    ).toBe("P1");
    expect(
      resolveMemberReactivationPriorityBand({
        rows,
        memberId: "M-003",
        storeConfig: {
          customerGrowth: {
            reactivationCapacity: {
              dailyTouchCapacity: 4,
            },
          },
        },
      }),
    ).toBe("P2");
    expect(
      resolveMemberReactivationPriorityBand({
        rows,
        memberId: "M-005",
        storeConfig: {
          customerGrowth: {
            reactivationCapacity: {
              dailyTouchCapacity: 4,
            },
          },
        },
      }),
    ).toBe("P3");
  });

  it("builds actionable queue rows with reason and touch summaries", () => {
    const queue = buildMemberReactivationQueueForBizDate({
      orgId: "1005",
      bizDate: "2026-04-09",
      featureRows: [
        buildFeatureRow(),
        buildFeatureRow({
          memberId: "M-002",
          customerIdentityKey: "member:M-002",
          customerDisplayName: "李女士",
          memberCardNo: "YB002",
          referenceCode: "YB002",
          primarySegment: "potential-growth-customer",
          daysSinceLastVisit: 11,
          visitCount30d: 2,
          visitCount90d: 4,
          payAmount30d: 680,
          payAmount90d: 1260,
          memberPayAmount30d: 680,
          memberPayAmount90d: 1260,
          currentStoredBalanceInferred: 120,
          depletionVelocity30d: 6,
          projectedBalanceDaysLeft: 52,
          dominantVisitDaypart: "afternoon",
          dominantVisitWeekday: "saturday",
          dominantVisitMonthPhase: "mid",
          reactivationPriorityScore: 690,
        }),
      ],
      strategyRows: [
        buildStrategyRow(),
        buildStrategyRow({
          memberId: "M-002",
          customerIdentityKey: "member:M-002",
          customerDisplayName: "李女士",
          primarySegment: "potential-growth-customer",
          reactivationPriorityScore: 690,
          churnRiskScore: 0.52,
          churnRiskLabel: "medium",
          revisitProbability7d: 0.64,
          revisitWindowLabel: "due-this-week",
          recommendedTouchWeekday: "saturday",
          recommendedTouchDaypart: "afternoon",
          touchWindowMatchScore: 0.76,
          touchWindowLabel: "best-this-week",
          lifecycleMomentumScore: 0.74,
          lifecycleMomentumLabel: "accelerating",
          recommendedActionLabel: "growth-nurture",
          strategyPriorityScore: 820,
        }),
      ],
      topTechByMemberId: new Map([
        ["M-001", "安老师"],
        ["M-002", "小雅"],
      ]),
    });

    expect(queue).toHaveLength(2);
    expect(queue[0]).toEqual(
      expect.objectContaining({
        memberId: "M-001",
        priorityBand: "P0",
        followupBucket: "high-value-reactivation",
        recommendedActionLabel: "immediate-1to1",
      }),
    );
    expect(queue[0]?.reasonSummary).toContain("已沉默36天");
    expect(queue[0]?.reasonSummary).toContain("近90天消费4680.00元");
    expect(queue[0]?.reasonSummary).toContain("安老师");
    expect(queue[0]?.touchAdviceSummary).toContain("thursday");
    expect(queue[0]?.touchAdviceSummary).toContain("after-work");

    expect(queue[1]).toEqual(
      expect.objectContaining({
        memberId: "M-002",
        priorityBand: "P1",
        followupBucket: "potential-growth",
        recommendedActionLabel: "growth-nurture",
      }),
    );
  });

  it("gives upcoming birthdays a modest execution boost without replacing the base model", () => {
    const queue = buildMemberReactivationQueueForBizDate({
      orgId: "1005",
      bizDate: "2026-04-09",
      featureRows: [
        buildFeatureRow({
          memberId: "M-010",
          customerIdentityKey: "member:M-010",
          customerDisplayName: "高分但非生日",
          memberCardNo: "YB010",
          referenceCode: "YB010",
          reactivationPriorityScore: 720,
        }),
        buildFeatureRow({
          memberId: "M-011",
          customerIdentityKey: "member:M-011",
          customerDisplayName: "生日待召回",
          memberCardNo: "YB011",
          referenceCode: "YB011",
          reactivationPriorityScore: 715,
        }),
      ],
      strategyRows: [
        buildStrategyRow({
          memberId: "M-010",
          customerIdentityKey: "member:M-010",
          customerDisplayName: "高分但非生日",
          strategyPriorityScore: 930,
        }),
        buildStrategyRow({
          memberId: "M-011",
          customerIdentityKey: "member:M-011",
          customerDisplayName: "生日待召回",
          strategyPriorityScore: 910,
        }),
      ],
      birthdayMonthDayByMemberId: new Map([
        ["M-010", "09-30"],
        ["M-011", "04-10"],
      ]),
    });

    expect(queue[0]).toEqual(
      expect.objectContaining({
        memberId: "M-011",
        priorityBand: "P0",
        birthdayMonthDay: "04-10",
        nextBirthdayBizDate: "2026-04-10",
        birthdayWindowDays: 1,
      }),
    );
    expect(queue[0]?.birthdayBoostScore).toBeGreaterThan(0);
    expect(queue[0]?.executionPriorityScore).toBeGreaterThan(queue[0]?.strategyPriorityScore ?? 0);
    expect(queue[0]?.reasonSummary).toContain("1天后生日");

    expect(queue[1]).toEqual(
      expect.objectContaining({
        memberId: "M-010",
        birthdayMonthDay: "09-30",
      }),
    );
    expect(queue[1]?.birthdayBoostScore).toBe(0);
    expect(queue[1]?.executionPriorityScore).toBe(queue[1]?.strategyPriorityScore);
  });

  it("adds environment-aware reason and touch hints when context is provided", () => {
    const environmentContext = {
      bizDate: "2026-04-09",
      seasonTag: "spring",
      isWeekend: false,
      holidayTag: "workday",
      postDinnerLeisureBias: "high",
      eveningOutingLikelihood: "high",
      badWeatherTouchPenalty: "medium",
    } satisfies EnvironmentContextSnapshot;

    const queue = buildMemberReactivationQueueForBizDate({
      orgId: "1005",
      bizDate: "2026-04-09",
      featureRows: [buildFeatureRow()],
      strategyRows: [buildStrategyRow()],
      topTechByMemberId: new Map([["M-001", "安老师"]]),
      environmentContext,
    });

    expect(queue[0]?.reasonSummary).toContain("晚间休闲需求偏强");
    expect(queue[0]?.touchAdviceSummary).toContain("天气");
  });

  it("uses store-level daily touch capacity when building queue rows", () => {
    const queue = buildMemberReactivationQueueForBizDate({
      orgId: "1005",
      bizDate: "2026-04-09",
      featureRows: Array.from({ length: 6 }, (_, index) =>
        buildFeatureRow({
          memberId: `M-${String(index + 1).padStart(3, "0")}`,
          customerIdentityKey: `member:M-${String(index + 1).padStart(3, "0")}`,
          customerDisplayName: `顾客${index + 1}`,
          memberCardNo: `YB${String(index + 1).padStart(3, "0")}`,
          referenceCode: `YB${String(index + 1).padStart(3, "0")}`,
          reactivationPriorityScore: 760 - index * 20,
        }),
      ),
      strategyRows: Array.from({ length: 6 }, (_, index) =>
        buildStrategyRow({
          memberId: `M-${String(index + 1).padStart(3, "0")}`,
          customerIdentityKey: `member:M-${String(index + 1).padStart(3, "0")}`,
          customerDisplayName: `顾客${index + 1}`,
          strategyPriorityScore: 980 - index * 30,
        }),
      ),
      storeConfig: {
        customerGrowth: {
          reactivationCapacity: {
            dailyTouchCapacity: 3,
          },
        },
      },
    });

    expect(queue[0]?.priorityBand).toBe("P0");
    expect(queue[1]?.priorityBand).toBe("P1");
    expect(queue[2]?.priorityBand).toBe("P2");
    expect(queue[3]?.priorityBand).toBe("P3");
    expect(queue[5]?.priorityBand).toBe("P3");
  });

  it("rebuilds queue rows with inferred environment summaries from store facts", async () => {
    const replacedRows: Array<{ reasonSummary: string }> = [];

    const fakeStore = {
      listMemberReactivationFeaturesByDateRange: async () => [
        buildFeatureRow({
          bizDate: "2026-04-18",
          dominantVisitWeekday: "saturday",
          dominantVisitDaypart: "late-night",
          preferredDaypartShare90d: 0.84,
        }),
      ],
      listMemberReactivationStrategiesByDateRange: async () => [
        buildStrategyRow({
          bizDate: "2026-04-18",
          recommendedTouchWeekday: "saturday",
          recommendedTouchDaypart: "late-night",
        }),
      ],
      listMemberDailySnapshotsByDateRange: async () => [],
      listCustomerSegments: async () => [],
      replaceMemberReactivationQueue: async (
        _orgId: string,
        _bizDate: string,
        rows: Array<{ reasonSummary: string }>,
      ) => {
        replacedRows.push(...rows);
      },
    } as const;

    await rebuildMemberReactivationQueueForDateRange({
      store: fakeStore as never,
      orgId: "1005",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
      storeConfig: {
        orgId: "1005",
        storeName: "迎宾店",
        roomCount: 24,
        operatingHoursPerDay: 15,
      },
    });

    expect(replacedRows[0]?.reasonSummary).toContain("晚间休闲需求偏强");
  });
  it("injects operating profile hints into queue summaries without changing the segment bucket", () => {
    const queue = buildMemberReactivationQueueForBizDate({
      orgId: "1005",
      bizDate: "2026-04-09",
      featureRows: [buildFeatureRow()],
      strategyRows: [
        buildStrategyRow({
          recommendedTouchDaypart: null,
          touchWindowLabel: "low-confidence",
        }),
      ],
      operatingProfileRows: [
        {
          orgId: "1005",
          bizDate: "2026-04-09",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          identityProfileJson: {},
          spendingProfileJson: {},
          serviceNeedProfileJson: {
            primary_need: "肩颈放松",
            confidence_discount: 0.1,
          },
          interactionProfileJson: {
            communication_style: "少聊天",
            confidence_discount: 0.18,
          },
          preferenceProfileJson: {
            preferred_daypart: "夜场",
            preferred_channel: "企微",
            preferred_tech_name: "安老师",
          },
          scenarioProfileJson: {},
          relationshipProfileJson: {
            top_tech_name: "安老师",
          },
          opportunityProfileJson: {},
          sourceSignalIds: ["sig-1"],
          updatedAt: "2026-04-09T12:00:00.000Z",
        },
      ],
      topTechByMemberId: new Map([["M-001", "安老师"]]),
    });

    expect(queue[0]?.primarySegment).toBe("important-reactivation-member");
    expect(queue[0]?.followupBucket).toBe("high-value-reactivation");
    expect(queue[0]?.reasonSummary).toContain("肩颈放松");
    expect(queue[0]?.touchAdviceSummary).toContain("企微");
    expect(queue[0]?.queueJson).toContain("\"operatingProfileBridge\"");
  });

});
