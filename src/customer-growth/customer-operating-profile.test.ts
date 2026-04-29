import { describe, expect, it } from "vitest";

import { buildCustomerOperatingProfilesDaily } from "./customer-operating-profile.js";
import type {
  CustomerOperatingSignalRecord,
  CustomerSegmentRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
} from "../types.js";

function buildMember(
  overrides: Partial<MemberCurrentRecord> = {},
): MemberCurrentRecord {
  return {
    orgId: "1005",
    memberId: "M-001",
    name: "王女士",
    phone: "13800000001",
    storedAmount: 1280,
    consumeAmount: 8620,
    createdTime: "2024-05-18 10:00:00",
    lastConsumeTime: "2026-04-18 22:16:00",
    silentDays: 3,
    rawStoreName: "迎宾店",
    rawJson: "{}",
    ...overrides,
  };
}

function buildSegment(
  overrides: Partial<CustomerSegmentRecord> = {},
): CustomerSegmentRecord {
  return {
    orgId: "1005",
    bizDate: "2026-04-21",
    customerIdentityKey: "member:M-001",
    customerIdentityType: "member",
    customerDisplayName: "王女士",
    memberId: "M-001",
    memberCardNo: "YB001",
    referenceCode: "YB001",
    memberLabel: "金卡",
    identityStable: true,
    segmentEligible: true,
    firstBizDate: "2024-05-18",
    lastBizDate: "2026-04-18",
    daysSinceLastVisit: 3,
    visitCount30d: 4,
    visitCount90d: 11,
    payAmount30d: 1180,
    payAmount90d: 3680,
    memberPayAmount90d: 3400,
    groupbuyAmount90d: 0,
    directPayAmount90d: 280,
    distinctTechCount90d: 2,
    topTechCode: "T-018",
    topTechName: "安老师",
    topTechVisitCount90d: 7,
    topTechVisitShare90d: 0.64,
    recencySegment: "active-7d",
    frequencySegment: "high-4-plus",
    monetarySegment: "high-1000-plus",
    paymentSegment: "mixed-member-nonmember",
    techLoyaltySegment: "single-tech-loyal",
    primarySegment: "important-value-member",
    tagKeys: ["important-value-member", "identity-stable"],
    rawJson: "{}",
    ...overrides,
  };
}

function buildFeature(
  overrides: Partial<MemberReactivationFeatureRecord> = {},
): MemberReactivationFeatureRecord {
  return {
    orgId: "1005",
    bizDate: "2026-04-21",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    customerDisplayName: "王女士",
    memberCardNo: "YB001",
    referenceCode: "YB001",
    primarySegment: "important-value-member",
    daysSinceLastVisit: 3,
    visitCount30d: 4,
    visitCount90d: 11,
    payAmount30d: 1180,
    payAmount90d: 3680,
    memberPayAmount30d: 1080,
    memberPayAmount90d: 3400,
    rechargeTotal30d: 500,
    rechargeTotal90d: 1500,
    rechargeCount30d: 1,
    rechargeCount90d: 2,
    daysSinceLastRecharge: 17,
    currentStoredBalanceInferred: 1280,
    storedBalance7dAgo: 1580,
    storedBalance30dAgo: 2120,
    storedBalance90dAgo: 3380,
    storedBalanceDelta7d: -300,
    storedBalanceDelta30d: -840,
    storedBalanceDelta90d: -2100,
    depletionVelocity30d: 28,
    projectedBalanceDaysLeft: 46,
    rechargeToMemberPayRatio90d: 0.44,
    dominantVisitDaypart: "night",
    preferredDaypartShare90d: 0.72,
    dominantVisitWeekday: "friday",
    preferredWeekdayShare90d: 0.38,
    dominantVisitMonthPhase: "late",
    preferredMonthPhaseShare90d: 0.47,
    weekendVisitShare90d: 0.58,
    lateNightVisitShare90d: 0.31,
    overnightVisitShare90d: 0.05,
    averageVisitGapDays90d: 8.4,
    visitGapStddevDays90d: 2.1,
    cycleDeviationScore: 0.68,
    timePreferenceConfidenceScore: 0.76,
    trajectoryConfidenceScore: 0.8,
    reactivationPriorityScore: 612,
    featureJson: "{}",
    ...overrides,
  };
}

function buildSignal(
  overrides: Partial<CustomerOperatingSignalRecord> = {},
): CustomerOperatingSignalRecord {
  return {
    signalId: "signal-1",
    orgId: "1005",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    signalDomain: "service_need",
    signalKey: "primary_need",
    valueText: "肩颈放松",
    valueJson: { confidence_discount: 0 },
    confidence: "high",
    truthBoundary: "hard_fact",
    scoringScope: "profile_allowed",
    sourceObservationIds: ["obs-1"],
    supportCount: 1,
    observedAt: "2026-04-20T22:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

describe("customer operating profile daily", () => {
  it("builds a daily operating snapshot from member facts, segment, reactivation feature and normalized signals", () => {
    const rows = buildCustomerOperatingProfilesDaily({
      orgId: "1005",
      bizDate: "2026-04-21",
      updatedAt: "2026-04-21T10:00:00.000Z",
      currentMembers: [buildMember()],
      customerSegments: [buildSegment()],
      reactivationFeatures: [buildFeature()],
      operatingSignals: [
        buildSignal(),
        buildSignal({
          signalId: "signal-2",
          signalDomain: "interaction_style",
          signalKey: "communication_style",
          valueText: "少聊天",
          confidence: "medium",
          truthBoundary: "observed_fact",
          scoringScope: "action_only",
          sourceObservationIds: ["obs-2"],
          valueJson: { confidence_discount: 0.35 },
        }),
        buildSignal({
          signalId: "signal-3",
          signalDomain: "time_preference",
          signalKey: "preferred_daypart",
          valueText: "夜场",
          confidence: "medium",
          truthBoundary: "hard_fact",
          scoringScope: "action_only",
          sourceObservationIds: ["obs-3"],
        }),
        buildSignal({
          signalId: "signal-4",
          signalDomain: "tech_preference",
          signalKey: "preferred_tech_code",
          valueText: "T-018",
          valueJson: { techName: "安老师", confidence_discount: 0.35 },
          confidence: "medium",
          truthBoundary: "hard_fact",
          scoringScope: "action_only",
          sourceObservationIds: ["obs-4"],
        }),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: "1005",
      bizDate: "2026-04-21",
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
      customerDisplayName: "王女士",
      sourceSignalIds: ["signal-1", "signal-2", "signal-3", "signal-4"],
      updatedAt: "2026-04-21T10:00:00.000Z",
    });

    expect(rows[0]?.identityProfileJson).toMatchObject({
      member_name: "王女士",
      phone: "13800000001",
      member_label: "金卡",
      identity_stable: true,
    });
    expect(rows[0]?.spendingProfileJson).toMatchObject({
      primary_segment: "important-value-member",
      pay_amount_90d: 3680,
      current_stored_amount: 1280,
      projected_balance_days_left: 46,
    });
    expect(rows[0]?.serviceNeedProfileJson).toMatchObject({
      primary_need: "肩颈放松",
      signal_confidence: "high",
    });
    expect(rows[0]?.interactionProfileJson).toMatchObject({
      communication_style: "少聊天",
      confidence_discount: 0.35,
    });
    expect(rows[0]?.preferenceProfileJson).toMatchObject({
      preferred_daypart: "夜场",
      preferred_tech_code: "T-018",
      preferred_tech_name: "安老师",
    });
    expect(rows[0]?.scenarioProfileJson).toMatchObject({
      dominant_visit_daypart: "night",
      dominant_visit_weekday: "friday",
      preferred_daypart_share_90d: 0.72,
    });
    expect(rows[0]?.relationshipProfileJson).toMatchObject({
      top_tech_name: "安老师",
      tech_loyalty_segment: "single-tech-loyal",
      top_tech_visit_share_90d: 0.64,
    });
    expect(rows[0]?.opportunityProfileJson).toMatchObject({
      days_since_last_visit: 3,
      reactivation_priority_score: 612,
      cycle_deviation_score: 0.68,
      trajectory_confidence_score: 0.8,
    });
  });
});
