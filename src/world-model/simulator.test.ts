import { describe, expect, it } from "vitest";

import type { OperatingWorldStateSnapshot } from "./types.js";
import { simulateOperatingWorldScenario } from "./simulator.js";

function buildSnapshot(): OperatingWorldStateSnapshot {
  return {
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
      recentOutcome: {
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
      },
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
  };
}

describe("simulateOperatingWorldScenario", () => {
  it("supports explain_current_state, counterfactual, and action_preview outputs", () => {
    const snapshot = buildSnapshot();

    const explanation = simulateOperatingWorldScenario({
      snapshot,
      kind: "explain_current_state",
    });
    const counterfactual = simulateOperatingWorldScenario({
      snapshot,
      kind: "counterfactual",
      actionLabel: "increase-night-shift-capacity",
    });
    const preview = simulateOperatingWorldScenario({
      snapshot,
      kind: "action_preview",
      actionLabel: "scale-night-shift-reactivation",
    });

    expect(explanation).toMatchObject({
      kind: "explain_current_state",
      confidenceBand: "medium",
    });
    expect(explanation.summary).toContain("当前更像是");
    expect(explanation.likelyUpside.length).toBeGreaterThan(0);
    expect(explanation.likelyRisk.length).toBeGreaterThan(0);
    expect(explanation.requiredConditions.length).toBeGreaterThan(0);
    expect(explanation.matchedMechanismKeys).toContain("late-night-opportunity");

    expect(counterfactual).toMatchObject({
      kind: "counterfactual",
      confidenceBand: "medium",
    });
    expect(counterfactual.summary).toContain("如果补上晚场承接");
    expect(counterfactual.likelyUpside).toContain("高价值老客的预约承接空间会更大。");
    expect(counterfactual.likelyRisk).toContain("如果竞对同时加大价格动作，单纯补容量不一定转成稳定储值。");
    expect(counterfactual.requiredConditions).toContain("必须先补晚场技师排班或房态容量，否则动作会卡在承接侧。");

    expect(preview).toMatchObject({
      kind: "action_preview",
      confidenceBand: "medium",
    });
    expect(preview.summary).toContain("当前适合放大晚场召回");
    expect(preview.likelyUpside).toContain("高价值沉默客更容易形成预约反馈。");
    expect(preview.likelyRisk).toContain("如果不先确认承接，动作会先放大排队和体验风险。");
    expect(preview.requiredConditions).toContain("先锁定熟悉技师和可承接时段，再扩大触达。");
    expect(preview.matchedMechanismKeys).toContain("high-value-reactivation-window");
  });
});
