import { describe, expect, it, vi } from "vitest";
import {
  loadLatestCustomerSegmentSnapshot,
  renderReactivationPushMessage,
  selectTopReactivationCandidate,
} from "./reactivation-push.js";
import type {
  CustomerSegmentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationStrategyRecord,
} from "./types.js";

function buildRow(
  overrides: Partial<CustomerSegmentRecord> = {},
): CustomerSegmentRecord {
  return {
    orgId: "627149864218629",
    bizDate: "2026-04-05",
    customerIdentityKey: `member:${overrides.customerDisplayName ?? "徐先生"}`,
    customerIdentityType: "member",
    customerDisplayName: "徐先生",
    memberId: "M-001",
    memberCardNo: "C-001",
    referenceCode: "REF-001",
    memberLabel: "普通会员",
    identityStable: true,
    segmentEligible: true,
    firstBizDate: "2026-01-01",
    lastBizDate: "2026-03-05",
    daysSinceLastVisit: 31,
    visitCount30d: 0,
    visitCount90d: 4,
    payAmount30d: 0,
    payAmount90d: 1800,
    memberPayAmount90d: 1600,
    groupbuyAmount90d: 200,
    directPayAmount90d: 0,
    distinctTechCount90d: 1,
    topTechCode: "T-001",
    topTechName: "李红儿",
    topTechVisitCount90d: 3,
    topTechVisitShare90d: 0.75,
    recencySegment: "silent-31-90d",
    frequencySegment: "high-4-plus",
    monetarySegment: "high-1000-plus",
    paymentSegment: "member-only",
    techLoyaltySegment: "single-tech-loyal",
    primarySegment: "important-reactivation-member",
    tagKeys: ["reactivation"],
    rawJson: "{}",
    ...overrides,
  };
}

describe("reactivation-push", () => {
  it("promotes members with stronger inferred stored-value reactivation signal", () => {
    const rows = [
      buildRow({
        customerDisplayName: "王女士",
        customerIdentityKey: "member:王女士",
        memberId: "M-001",
        primarySegment: "important-value-member",
        daysSinceLastVisit: 18,
        payAmount90d: 1400,
      }),
      buildRow({
        customerDisplayName: "李先生",
        customerIdentityKey: "member:李先生",
        memberId: "M-002",
        primarySegment: "important-reactivation-member",
        daysSinceLastVisit: 35,
        payAmount90d: 1100,
      }),
    ];
    const features: MemberReactivationFeatureRecord[] = [
      {
        orgId: "627149864218629",
        bizDate: "2026-04-05",
        memberId: "M-001",
        customerIdentityKey: "member:王女士",
        customerDisplayName: "王女士",
        memberCardNo: "C-101",
        referenceCode: "REF-101",
        primarySegment: "important-value-member",
        daysSinceLastVisit: 18,
        visitCount30d: 1,
        visitCount90d: 4,
        payAmount30d: 360,
        payAmount90d: 1400,
        memberPayAmount30d: 360,
        memberPayAmount90d: 1200,
        rechargeTotal30d: 0,
        rechargeTotal90d: 0,
        rechargeCount30d: 0,
        rechargeCount90d: 0,
        daysSinceLastRecharge: null,
        currentStoredBalanceInferred: 980,
        storedBalance7dAgo: 1410,
        storedBalance30dAgo: 1680,
        storedBalance90dAgo: 2120,
        storedBalanceDelta7d: -430,
        storedBalanceDelta30d: -700,
        storedBalanceDelta90d: -1140,
        depletionVelocity30d: 23.3333,
        projectedBalanceDaysLeft: 42,
        rechargeToMemberPayRatio90d: 0,
        dominantVisitDaypart: "after-work",
        preferredDaypartShare90d: 0.75,
        dominantVisitWeekday: "friday",
        preferredWeekdayShare90d: 0.5,
        dominantVisitMonthPhase: "early",
        preferredMonthPhaseShare90d: 0.5,
        weekendVisitShare90d: 0.25,
        lateNightVisitShare90d: 0,
        overnightVisitShare90d: 0,
        averageVisitGapDays90d: 9,
        visitGapStddevDays90d: 2.1,
        cycleDeviationScore: 1.1,
        timePreferenceConfidenceScore: 0.68,
        trajectoryConfidenceScore: 0.9,
        reactivationPriorityScore: 742.5,
        featureJson: "{}",
      },
      {
        orgId: "627149864218629",
        bizDate: "2026-04-05",
        memberId: "M-002",
        customerIdentityKey: "member:李先生",
        customerDisplayName: "李先生",
        memberCardNo: "C-002",
        referenceCode: "REF-002",
        primarySegment: "important-reactivation-member",
        daysSinceLastVisit: 35,
        visitCount30d: 0,
        visitCount90d: 3,
        payAmount30d: 0,
        payAmount90d: 1100,
        memberPayAmount30d: 0,
        memberPayAmount90d: 900,
        rechargeTotal30d: 0,
        rechargeTotal90d: 300,
        rechargeCount30d: 0,
        rechargeCount90d: 1,
        daysSinceLastRecharge: 70,
        currentStoredBalanceInferred: 120,
        storedBalance7dAgo: 120,
        storedBalance30dAgo: 240,
        storedBalance90dAgo: 360,
        storedBalanceDelta7d: 0,
        storedBalanceDelta30d: -120,
        storedBalanceDelta90d: -240,
        depletionVelocity30d: 4,
        projectedBalanceDaysLeft: 30,
        rechargeToMemberPayRatio90d: 0.3333,
        dominantVisitDaypart: "late-night",
        preferredDaypartShare90d: 0.34,
        dominantVisitWeekday: "saturday",
        preferredWeekdayShare90d: 0.34,
        dominantVisitMonthPhase: "late",
        preferredMonthPhaseShare90d: 0.34,
        weekendVisitShare90d: 0.67,
        lateNightVisitShare90d: 0.34,
        overnightVisitShare90d: 0,
        averageVisitGapDays90d: 12,
        visitGapStddevDays90d: 5,
        cycleDeviationScore: 0.4,
        timePreferenceConfidenceScore: 0.34,
        trajectoryConfidenceScore: 0.85,
        reactivationPriorityScore: 611.2,
        featureJson: "{}",
      },
    ];

    const selected = selectTopReactivationCandidate(rows, features);

    expect(selected?.row.customerDisplayName).toBe("王女士");
    expect(selected?.score).toBe(742.5);
  });

  it("uses the strategy priority score when next-stage strategy rows are available", () => {
    const rows = [
      buildRow({
        customerDisplayName: "王女士",
        customerIdentityKey: "member:王女士",
        memberId: "M-001",
        primarySegment: "important-reactivation-member",
      }),
      buildRow({
        customerDisplayName: "李先生",
        customerIdentityKey: "member:李先生",
        memberId: "M-002",
        primarySegment: "potential-growth-customer",
        daysSinceLastVisit: 9,
        payAmount90d: 880,
      }),
    ];
    const features: MemberReactivationFeatureRecord[] = [
      {
        orgId: "627149864218629",
        bizDate: "2026-04-05",
        memberId: "M-001",
        customerIdentityKey: "member:王女士",
        customerDisplayName: "王女士",
        memberCardNo: "C-001",
        referenceCode: "REF-001",
        primarySegment: "important-reactivation-member",
        daysSinceLastVisit: 31,
        visitCount30d: 0,
        visitCount90d: 4,
        payAmount30d: 0,
        payAmount90d: 1800,
        memberPayAmount30d: 0,
        memberPayAmount90d: 1600,
        rechargeTotal30d: 0,
        rechargeTotal90d: 0,
        rechargeCount30d: 0,
        rechargeCount90d: 0,
        daysSinceLastRecharge: null,
        currentStoredBalanceInferred: 220,
        storedBalance7dAgo: 260,
        storedBalance30dAgo: 420,
        storedBalance90dAgo: 620,
        storedBalanceDelta7d: -40,
        storedBalanceDelta30d: -200,
        storedBalanceDelta90d: -400,
        depletionVelocity30d: 6.6667,
        projectedBalanceDaysLeft: 33,
        rechargeToMemberPayRatio90d: 0,
        dominantVisitDaypart: "after-work",
        preferredDaypartShare90d: 0.6,
        dominantVisitWeekday: "thursday",
        preferredWeekdayShare90d: 0.5,
        dominantVisitMonthPhase: "early",
        preferredMonthPhaseShare90d: 0.5,
        weekendVisitShare90d: 0.25,
        lateNightVisitShare90d: 0,
        overnightVisitShare90d: 0,
        averageVisitGapDays90d: 8,
        visitGapStddevDays90d: 2,
        cycleDeviationScore: 1.4,
        timePreferenceConfidenceScore: 0.55,
        trajectoryConfidenceScore: 0.88,
        reactivationPriorityScore: 742.5,
        featureJson: "{}",
      },
      {
        orgId: "627149864218629",
        bizDate: "2026-04-05",
        memberId: "M-002",
        customerIdentityKey: "member:李先生",
        customerDisplayName: "李先生",
        memberCardNo: "C-002",
        referenceCode: "REF-002",
        primarySegment: "potential-growth-customer",
        daysSinceLastVisit: 9,
        visitCount30d: 2,
        visitCount90d: 2,
        payAmount30d: 520,
        payAmount90d: 880,
        memberPayAmount30d: 280,
        memberPayAmount90d: 280,
        rechargeTotal30d: 0,
        rechargeTotal90d: 0,
        rechargeCount30d: 0,
        rechargeCount90d: 0,
        daysSinceLastRecharge: null,
        currentStoredBalanceInferred: 80,
        storedBalance7dAgo: 80,
        storedBalance30dAgo: 100,
        storedBalance90dAgo: 100,
        storedBalanceDelta7d: 0,
        storedBalanceDelta30d: -20,
        storedBalanceDelta90d: -20,
        depletionVelocity30d: 0.6667,
        projectedBalanceDaysLeft: 120,
        rechargeToMemberPayRatio90d: 0,
        dominantVisitDaypart: "afternoon",
        preferredDaypartShare90d: 1,
        dominantVisitWeekday: "saturday",
        preferredWeekdayShare90d: 0.5,
        dominantVisitMonthPhase: "early",
        preferredMonthPhaseShare90d: 1,
        weekendVisitShare90d: 0.5,
        lateNightVisitShare90d: 0,
        overnightVisitShare90d: 0,
        averageVisitGapDays90d: 10,
        visitGapStddevDays90d: 0,
        cycleDeviationScore: 0,
        timePreferenceConfidenceScore: 0.85,
        trajectoryConfidenceScore: 0.65,
        reactivationPriorityScore: 611.2,
        featureJson: "{}",
      },
    ];
    const strategies: MemberReactivationStrategyRecord[] = [
      {
        orgId: "627149864218629",
        bizDate: "2026-04-05",
        memberId: "M-001",
        customerIdentityKey: "member:王女士",
        customerDisplayName: "王女士",
        primarySegment: "important-reactivation-member",
        reactivationPriorityScore: 742.5,
        churnRiskScore: 0.74,
        churnRiskLabel: "high",
        revisitProbability7d: 0.68,
        revisitWindowLabel: "due-now",
        recommendedTouchWeekday: "thursday",
        recommendedTouchDaypart: "after-work",
        touchWindowMatchScore: 0.78,
        touchWindowLabel: "wait-preferred-weekday",
        lifecycleMomentumScore: 0.32,
        lifecycleMomentumLabel: "cooling",
        recommendedActionLabel: "immediate-1to1",
        strategyPriorityScore: 828.4,
        strategyJson: "{}",
      },
      {
        orgId: "627149864218629",
        bizDate: "2026-04-05",
        memberId: "M-002",
        customerIdentityKey: "member:李先生",
        customerDisplayName: "李先生",
        primarySegment: "potential-growth-customer",
        reactivationPriorityScore: 611.2,
        churnRiskScore: 0.46,
        churnRiskLabel: "medium",
        revisitProbability7d: 0.74,
        revisitWindowLabel: "due-this-week",
        recommendedTouchWeekday: "saturday",
        recommendedTouchDaypart: "afternoon",
        touchWindowMatchScore: 0.92,
        touchWindowLabel: "best-today",
        lifecycleMomentumScore: 0.81,
        lifecycleMomentumLabel: "accelerating",
        recommendedActionLabel: "growth-nurture",
        strategyPriorityScore: 861.7,
        strategyJson: "{}",
      },
    ];

    const selected = selectTopReactivationCandidate(rows, features, strategies);

    expect(selected?.row.customerDisplayName).toBe("李先生");
    expect(selected?.score).toBe(861.7);
  });

  it("prefers the strongest high-value reactivation candidate for scheduled recall pushes", () => {
    const candidates = [
      buildRow(),
      buildRow({
        customerDisplayName: "王女士",
        customerIdentityKey: "member:王女士",
        primarySegment: "potential-growth-customer",
        visitCount90d: 3,
        payAmount90d: 900,
        daysSinceLastVisit: 8,
        lastBizDate: "2026-03-28",
      }),
    ];

    const selected = selectTopReactivationCandidate(candidates);

    expect(selected?.row.customerDisplayName).toBe("徐先生");
    expect(selected?.bucketLabel).toBe("高价值待唤回");
  });

  it("renders an operating-style alert headline instead of a generic profile title", () => {
    const candidate = selectTopReactivationCandidate([
      buildRow({
        customerDisplayName: "徐先生 )",
        customerIdentityKey: "member:徐先生 )",
      }),
    ]);
    expect(candidate).not.toBeNull();

    const message = renderReactivationPushMessage({
      storeName: "园中园店",
      snapshotBizDate: "2026-04-05",
      candidate: candidate!,
    });

    expect(message).toContain("园中园店召回预警｜徐先生已沉默31天，今天先跟进");
    expect(message).toContain("- 经营分层：高价值待唤回");
    expect(message).toContain("- 今日动作：客服今天先围绕 李红儿 做1对1邀约");
    expect(message).not.toContain("顾客画像");
    expect(message).not.toContain("徐先生 )");
  });

  it("falls back to a readable member label when the display name is machine-like", () => {
    const candidate = selectTopReactivationCandidate([
      buildRow({
        customerDisplayName: "7cee5b5b-78c1-4880-956a-fc6daa9a3cd8",
        customerIdentityKey: "member:7cee5b5b-78c1-4880-956a-fc6daa9a3cd8",
        memberId: "7cee5b5b-78c1-4880-956a-fc6daa9a3cd8",
        memberCardNo: "YB888",
        referenceCode: "YB888",
      }),
    ]);
    expect(candidate).not.toBeNull();

    const message = renderReactivationPushMessage({
      storeName: "园中园店",
      snapshotBizDate: "2026-04-05",
      candidate: candidate!,
    });

    expect(message).toContain("园中园店召回预警｜会员卡YB888已沉默31天，今天先跟进");
    expect(message).not.toContain("7cee5b5b-78c1-4880-956a-fc6daa9a3cd8");
  });

  it("looks back up to seven days to find the latest usable segment snapshot", async () => {
    const listCustomerSegments = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildRow({ bizDate: "2026-04-03" })])
      .mockResolvedValue([]);

    const snapshot = await loadLatestCustomerSegmentSnapshot({
      runtime: {
        listCustomerSegments,
      },
      orgId: "627149864218629",
      targetBizDate: "2026-04-05",
    });

    expect(snapshot.bizDate).toBe("2026-04-03");
    expect(snapshot.rows).toHaveLength(1);
    expect(listCustomerSegments).toHaveBeenNthCalledWith(1, {
      orgId: "627149864218629",
      bizDate: "2026-04-05",
    });
    expect(listCustomerSegments).toHaveBeenNthCalledWith(2, {
      orgId: "627149864218629",
      bizDate: "2026-04-04",
    });
    expect(listCustomerSegments).toHaveBeenNthCalledWith(3, {
      orgId: "627149864218629",
      bizDate: "2026-04-03",
    });
    expect(listCustomerSegments).toHaveBeenNthCalledWith(4, {
      orgId: "627149864218629",
      bizDate: "2026-04-02",
    });
  });

  it("skips collapsed member-linked snapshots and falls back to the latest stable day", async () => {
    const collapsedDay = [
      buildRow({
        bizDate: "2026-04-05",
        customerDisplayName: "匿名顾客A",
        customerIdentityKey: "anon:A",
        customerIdentityType: "display-name",
        memberId: undefined,
        memberCardNo: undefined,
        referenceCode: undefined,
      }),
      buildRow({
        bizDate: "2026-04-05",
        customerDisplayName: "徐先生",
        customerIdentityKey: "member:徐先生",
        memberId: "M-001",
      }),
    ];
    const stableDay = Array.from({ length: 5 }, (_value, index) =>
      buildRow({
        bizDate: "2026-04-04",
        customerDisplayName: `会员${index + 1}`,
        customerIdentityKey: `member:${index + 1}`,
        memberId: `M-00${index + 1}`,
        memberCardNo: `C-00${index + 1}`,
        referenceCode: `REF-00${index + 1}`,
      }),
    );
    const listCustomerSegments = vi
      .fn()
      .mockResolvedValueOnce(collapsedDay)
      .mockResolvedValueOnce(stableDay)
      .mockResolvedValue([]);

    const snapshot = await loadLatestCustomerSegmentSnapshot({
      runtime: {
        listCustomerSegments,
      },
      orgId: "627149864218629",
      targetBizDate: "2026-04-05",
    });

    expect(snapshot.bizDate).toBe("2026-04-04");
    expect(snapshot.rows).toHaveLength(5);
    expect(snapshot.rows.every((row) => row.memberId)).toBe(true);
  });
});
