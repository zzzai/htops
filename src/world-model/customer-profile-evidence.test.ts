import { describe, expect, it } from "vitest";
import type { CustomerOperatingProfileDailyRecord } from "../types.js";
import { buildCustomerProfileEvidenceState } from "./customer-profile-evidence.js";

function buildProfileRow(
  overrides: Partial<CustomerOperatingProfileDailyRecord> = {},
): CustomerOperatingProfileDailyRecord {
  return {
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
      preferred_daypart: "夜场",
      preferred_channel: "企微",
      preferred_channel_confidence: "low",
      preferred_channel_truth_boundary: "predicted_signal",
      preferred_channel_confidence_discount: 0.62,
      preferred_tech_name: "安老师",
    },
    scenarioProfileJson: {},
    relationshipProfileJson: {
      top_tech_name: "安老师",
    },
    opportunityProfileJson: {},
    sourceSignalIds: ["sig-1", "sig-2", "sig-3"],
    updatedAt: "2026-04-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("customer profile evidence", () => {
  it("builds world-model customer evidence with explicit confidence boundaries", () => {
    const state = buildCustomerProfileEvidenceState({
      customerOperatingProfiles: [buildProfileRow()],
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
    });

    expect(state.latestOperatingProfile).toMatchObject({
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
    });
    expect(state.operatingProfileEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "service_need.primary_need",
          label: "服务诉求",
          value: "肩颈放松",
          truthBoundary: "hard_fact",
          confidenceBoundary: "confirmed",
        }),
        expect.objectContaining({
          key: "interaction.communication_style",
          label: "互动风格",
          value: "少聊天",
          truthBoundary: "soft_fact",
          confidenceBoundary: "observed",
        }),
        expect.objectContaining({
          key: "preference.preferred_channel",
          label: "触达偏好",
          value: "企微",
          truthBoundary: "weak_signal",
          confidenceBoundary: "tentative",
        }),
        expect.objectContaining({
          key: "relationship.top_tech_name",
          label: "技师关系",
          value: "安老师",
          truthBoundary: "soft_fact",
        }),
      ]),
    );
  });
});
