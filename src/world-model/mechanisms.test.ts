import { describe, expect, it } from "vitest";

import type { OperatingWorldStateSnapshot } from "./types.js";
import { resolveOperatingWorldMechanisms } from "./mechanisms.js";

describe("resolveOperatingWorldMechanisms", () => {
  it("matches the first batch of operating mechanisms from a bounded world state snapshot", () => {
    const snapshot = {
      orgId: "1001",
      bizDate: "2026-04-21",
      assembledAt: "2026-04-21T10:00:00.000Z",
      customerState: {
        sourceCategory: "derived_intelligence",
        truthBoundary: "hard_fact",
        updatedAt: "2026-04-21T09:00:00.000Z",
        customerIdentityKey: "member:M-001",
        memberId: "M-001",
        customerDisplayName: "王女士",
        primarySegment: "important-reactivation-member",
        latestSegment: undefined,
        operatingProfileEvidence: [],
        recentOutcome: null,
        evidence: [],
      },
      storeState: {
        sourceCategory: "internal_fact",
        truthBoundary: "hard_fact",
        updatedAt: "2026-04-21T09:30:00.000Z",
        orgId: "1001",
        confirmedContext: {
          night_shift_capacity_gap: true,
          kpi_signal_traffic_vs_recharge: "traffic-flat-recharge-down",
        },
        environmentContext: {
          orgId: "1001",
          bizDate: "2026-04-21",
          eveningOutingLikelihood: "high",
          postDinnerLeisureBias: "high",
          solarTerm: "guyu",
        },
        evidence: [],
      },
      marketState: {
        sourceCategory: "external_context",
        truthBoundary: "soft_fact",
        updatedAt: "2026-04-21T08:00:00.000Z",
        estimatedContext: {
          competitor_count_3km: 9,
        },
        researchNotes: [
          {
            metricKey: "seasonal_nightlife_pattern",
            value: "北方春季晚间饭后休闲需求偏强",
            sourceCategory: "external_context",
            truthBoundary: "soft_fact",
            updatedAt: "2026-04-21T08:00:00.000Z",
          },
        ],
        evidence: [],
      },
      industryState: {
        sourceCategory: "industry_signal",
        truthBoundary: "weak_signal",
        updatedAt: "2026-04-21T10:00:00.000Z",
        observations: [],
      },
    } satisfies OperatingWorldStateSnapshot;

    const matches = resolveOperatingWorldMechanisms(snapshot);

    expect(matches.map((entry) => entry.key)).toEqual([
      "late-night-opportunity",
      "capacity-bottleneck",
      "high-value-reactivation-window",
      "competitor-pressure",
      "traffic-recharge-split",
    ]);
    expect(matches[0]).toMatchObject({
      label: "晚场机会窗口",
    });
    expect(matches[1]?.suggestedActions).toContain("先确认晚场技师与房态承接，再放大夜场动作。");
    expect(matches[3]?.likelyImplications).toContain("价格敏感与即时决策客群更容易被外部分流。");
  });
});
