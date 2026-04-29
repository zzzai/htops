import { describe, expect, it } from "vitest";

import type {
  CustomerSegmentRecord,
  EnvironmentContextSnapshot,
  MemberReactivationOutcomeSnapshotRecord,
} from "../types.js";
import type { OperatingWorldStateSnapshot } from "./types.js";

describe("world-model types", () => {
  it("supports a typed operating world snapshot with state-level provenance", () => {
    const snapshot = {
      orgId: "1001",
      bizDate: "2026-04-21",
      assembledAt: "2026-04-21T10:00:00.000Z",
      customerState: {
        sourceCategory: "derived_intelligence",
        truthBoundary: "hard_fact",
        updatedAt: "2026-04-21T10:00:00.000Z",
        customerIdentityKey: "member:M-001",
        memberId: "M-001",
        customerDisplayName: "王女士",
        primarySegment: "important-reactivation-member",
        latestSegment: {} as CustomerSegmentRecord,
        operatingProfileEvidence: [],
        recentOutcome: {} as MemberReactivationOutcomeSnapshotRecord,
        evidence: [
          {
            key: "latest-segment",
            sourceCategory: "derived_intelligence",
            truthBoundary: "hard_fact",
            updatedAt: "2026-04-21T09:00:00.000Z",
            value: {} as CustomerSegmentRecord,
          },
        ],
      },
      storeState: {
        sourceCategory: "internal_fact",
        truthBoundary: "hard_fact",
        updatedAt: "2026-04-21T10:00:00.000Z",
        orgId: "1001",
        confirmedContext: {
          store_format: "cinema_foot_bath",
        },
        environmentContext: {} as EnvironmentContextSnapshot,
        evidence: [],
      },
      marketState: {
        sourceCategory: "external_context",
        truthBoundary: "soft_fact",
        updatedAt: "2026-04-21T10:00:00.000Z",
        estimatedContext: {
          delivery_store_count_3km: 662,
        },
        researchNotes: [
          {
            metricKey: "seasonal_nightlife_pattern",
            value: "北方春季晚间饭后休闲需求偏强",
            note: "只用于经营解释",
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

    expect(snapshot.customerState.sourceCategory).toBe("derived_intelligence");
    expect(snapshot.customerState.truthBoundary).toBe("hard_fact");
    expect(snapshot.marketState.truthBoundary).toBe("soft_fact");
    expect(snapshot.industryState.sourceCategory).toBe("industry_signal");
    expect(snapshot.industryState.truthBoundary).toBe("weak_signal");
  });
});
