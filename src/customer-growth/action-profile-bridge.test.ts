import { describe, expect, it } from "vitest";
import type { CustomerOperatingProfileDailyRecord } from "../types.js";
import { buildMemberActionProfileBridge } from "./action-profile-bridge.js";

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
      confidence_discount: 0.08,
    },
    interactionProfileJson: {
      communication_style: "少聊天",
      confidence_discount: 0.24,
    },
    preferenceProfileJson: {
      preferred_daypart: "夜场",
      preferred_channel: "企微",
      preferred_channel_confidence_discount: 0.15,
      preferred_tech_name: "安老师",
    },
    scenarioProfileJson: {},
    relationshipProfileJson: {
      top_tech_name: "安老师",
    },
    opportunityProfileJson: {},
    sourceSignalIds: ["sig-1"],
    updatedAt: "2026-04-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("action-profile-bridge", () => {
  it("converts operating profile snapshot into bounded action adjustments", () => {
    const bridge = buildMemberActionProfileBridge(buildProfileRow());

    expect(bridge).toMatchObject({
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
      serviceNeed: "肩颈放松",
      preferredTouchDaypart: "late-night",
      preferredChannel: "企微",
      preferredTechName: "安老师",
    });
    expect(bridge?.actionBoostScore).toBeGreaterThan(0);
    expect(bridge?.actionBoostScore).toBeLessThanOrEqual(18);
    expect(bridge?.confidenceFactor).toBeLessThan(1);
  });
});
