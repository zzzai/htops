import { describe, expect, it } from "vitest";

import type {
  CustomerSegmentRecord,
  EnvironmentContextSnapshot,
  HetangStoreExternalContextEntry,
  CustomerOperatingProfileDailyRecord,
  MemberReactivationOutcomeSnapshotRecord,
} from "../types.js";
import { buildOperatingWorldStateSnapshot } from "./state.js";

function buildExternalEntry(
  overrides: Partial<HetangStoreExternalContextEntry>,
): HetangStoreExternalContextEntry {
  return {
    orgId: "1001",
    snapshotDate: "2026-04-21",
    contextKind: "estimated_market_context",
    metricKey: "delivery_store_count_3km",
    valueText: "662",
    valueNum: 662,
    valueJson: undefined,
    unit: "count",
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "third_party_pdf",
    sourceLabel: "查外卖.pdf",
    sourceUri: "mdshuju/查外卖.pdf",
    applicableModules: ["store_advice", "customer_growth_ai"],
    notForScoring: true,
    note: undefined,
    rawJson: "{}",
    updatedAt: "2026-04-21T08:00:00.000Z",
    ...overrides,
  };
}

describe("buildOperatingWorldStateSnapshot", () => {
  it("assembles customer, store, market, and industry states from current owner-path inputs", () => {
    const snapshot = buildOperatingWorldStateSnapshot({
      orgId: "1001",
      bizDate: "2026-04-21",
      customerIdentityKey: "member:M-001",
      customerSegments: [
        {
          orgId: "1001",
          bizDate: "2026-04-21",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          memberId: "M-001",
          primarySegment: "important-reactivation-member",
          payAmount90d: 2480,
          visitCount90d: 6,
          tagKeys: ["important-reactivation-member"],
          rawJson: "{}",
        } as CustomerSegmentRecord,
      ],
      environmentContext: {
        orgId: "1001",
        bizDate: "2026-04-21",
        seasonTag: "spring",
        solarTerm: "guyu",
        eveningOutingLikelihood: "high",
        contextJson: "{}",
      } satisfies EnvironmentContextSnapshot,
      externalContextEntries: [
        buildExternalEntry({
          contextKind: "store_business_profile",
          metricKey: "store_format",
          valueText: "cinema_foot_bath",
          valueNum: undefined,
          truthLevel: "confirmed",
          confidence: "high",
          sourceType: "store_page_screenshot",
          notForScoring: false,
        }),
        buildExternalEntry({}),
        buildExternalEntry({
          contextKind: "research_note",
          metricKey: "seasonal_nightlife_pattern",
          valueText: "北方春季晚间饭后休闲需求偏强",
          valueNum: undefined,
          truthLevel: "research_note",
          note: "只用于经营解释",
        }),
      ],
      outcomeSnapshots: [
        {
          orgId: "1001",
          bizDate: "2026-04-20",
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
          updatedAt: "2026-04-21T09:00:00.000Z",
        } as MemberReactivationOutcomeSnapshotRecord,
      ],
      assembledAt: "2026-04-21T10:00:00.000Z",
    });

    expect(snapshot.customerState.customerIdentityKey).toBe("member:M-001");
    expect(snapshot.customerState.primarySegment).toBe("important-reactivation-member");
    expect(snapshot.customerState.recentOutcome?.outcomeLabel).toBe("booked");
    expect(snapshot.customerState.updatedAt).toBe("2026-04-21T09:00:00.000Z");

    expect(snapshot.storeState.confirmedContext).toEqual({
      store_format: "cinema_foot_bath",
    });
    expect(snapshot.storeState.environmentContext?.solarTerm).toBe("guyu");

    expect(snapshot.marketState.estimatedContext).toEqual({
      delivery_store_count_3km: 662,
    });
    expect(snapshot.marketState.researchNotes).toEqual([
      expect.objectContaining({
        metricKey: "seasonal_nightlife_pattern",
        note: "只用于经营解释",
      }),
    ]);

    expect(snapshot.industryState.sourceCategory).toBe("industry_signal");
    expect(snapshot.industryState.truthBoundary).toBe("weak_signal");
    expect(snapshot.industryState.observations).toEqual([]);
  });

  it("absorbs operating profile evidence into customer state with confidence boundaries", () => {
    const snapshot = buildOperatingWorldStateSnapshot({
      orgId: "1001",
      bizDate: "2026-04-21",
      customerIdentityKey: "member:M-001",
      memberId: "M-001",
      customerSegments: [
        {
          orgId: "1001",
          bizDate: "2026-04-21",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          memberId: "M-001",
          primarySegment: "important-reactivation-member",
          payAmount90d: 2480,
          visitCount90d: 6,
          tagKeys: ["important-reactivation-member"],
          rawJson: "{}",
        } as CustomerSegmentRecord,
      ],
      customerOperatingProfiles: [
        {
          orgId: "1001",
          bizDate: "2026-04-21",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          identityProfileJson: {},
          spendingProfileJson: {},
          serviceNeedProfileJson: {
            primary_need: "肩颈放松",
            signal_confidence: "high",
            truth_boundary: "hard_fact",
            confidence_discount: 0.05,
          },
          interactionProfileJson: {
            communication_style: "少聊天",
            signal_confidence: "medium",
            confidence_discount: 0.28,
          },
          preferenceProfileJson: {
            preferred_channel: "企微",
            preferred_channel_confidence: "low",
            preferred_channel_truth_boundary: "predicted_signal",
            preferred_channel_confidence_discount: 0.62,
            preferred_daypart: "夜场",
          },
          scenarioProfileJson: {},
          relationshipProfileJson: {
            top_tech_name: "安老师",
          },
          opportunityProfileJson: {},
          sourceSignalIds: ["sig-1"],
          updatedAt: "2026-04-21T10:00:00.000Z",
        } as CustomerOperatingProfileDailyRecord,
      ],
      assembledAt: "2026-04-21T10:00:00.000Z",
    });

    expect(snapshot.customerState.latestOperatingProfile?.memberId).toBe("M-001");
    expect(snapshot.customerState.operatingProfileEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "service_need.primary_need",
          confidenceBoundary: "confirmed",
        }),
        expect.objectContaining({
          key: "preference.preferred_channel",
          truthBoundary: "weak_signal",
          confidenceBoundary: "tentative",
        }),
      ]),
    );
  });

  it("preserves persisted environment memory fields inside store state", () => {
    const snapshot = buildOperatingWorldStateSnapshot({
      orgId: "1001",
      bizDate: "2026-04-21",
      environmentContext: {
        orgId: "1001",
        bizDate: "2026-04-21",
        holidayTag: "pre_holiday",
        holidayName: "五一前夕",
        narrativePolicy: "hint",
        environmentDisturbanceLevel: "medium",
        snapshotJson: "{}",
        collectedAt: "2026-04-22T03:00:00.000Z",
        updatedAt: "2026-04-22T03:00:00.000Z",
      } as EnvironmentContextSnapshot,
      assembledAt: "2026-04-21T10:00:00.000Z",
    });

    expect(snapshot.storeState.environmentContext?.holidayTag).toBe("pre_holiday");
    expect(snapshot.storeState.environmentContext?.narrativePolicy).toBe("hint");
    expect(snapshot.storeState.environmentContext?.environmentDisturbanceLevel).toBe("medium");
  });
});
