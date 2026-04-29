import { describe, expect, it } from "vitest";

import { buildCustomerOperatingSignals } from "./customer-observation.js";
import type { CustomerServiceObservationRecord } from "../types.js";

function buildObservation(
  overrides: Partial<CustomerServiceObservationRecord> = {},
): CustomerServiceObservationRecord {
  return {
    observationId: "obs-1",
    orgId: "1005",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    sourceRole: "technician",
    sourceType: "staff_observed",
    observerId: "T-018",
    batchId: "batch-1",
    signalDomain: "service_need",
    signalKey: "primary_need",
    valueText: "肩颈放松",
    confidence: "medium",
    truthBoundary: "observed_fact",
    observedAt: "2026-04-20T21:00:00.000Z",
    rawNote: "默认测试 observation",
    rawJson: "{}",
    updatedAt: "2026-04-20T21:05:00.000Z",
    ...overrides,
  };
}

describe("customer observation normalization", () => {
  it("builds stable operating signals from active observations and keeps confidence discount explicit", () => {
    const signals = buildCustomerOperatingSignals({
      asOfDate: "2026-04-21",
      updatedAt: "2026-04-21T23:00:00.000Z",
      observations: [
        buildObservation({
          observationId: "svc-1",
          sourceType: "self_reported",
          confidence: "high",
          truthBoundary: "hard_fact",
          signalDomain: "service_need",
          signalKey: "primary_need",
          valueText: "肩颈放松",
        }),
        buildObservation({
          observationId: "svc-2",
          signalDomain: "service_need",
          signalKey: "primary_need",
          valueText: "肩颈放松",
        }),
        buildObservation({
          observationId: "interaction-1",
          signalDomain: "interaction_style",
          signalKey: "communication_style",
          valueText: "少聊天",
          confidence: "medium",
          truthBoundary: "observed_fact",
        }),
        buildObservation({
          observationId: "interaction-2",
          signalDomain: "interaction_style",
          signalKey: "communication_style",
          valueText: "爱聊天",
          confidence: "low",
          truthBoundary: "predicted_signal",
        }),
        buildObservation({
          observationId: "time-1",
          signalDomain: "time_preference",
          signalKey: "preferred_daypart",
          valueText: "夜场",
          sourceType: "system_fact",
          confidence: "medium",
          truthBoundary: "hard_fact",
          observedAt: "2026-04-19T13:00:00.000Z",
        }),
        buildObservation({
          observationId: "time-2",
          signalDomain: "time_preference",
          signalKey: "preferred_daypart",
          valueText: "夜场",
          sourceType: "self_reported",
          confidence: "low",
          truthBoundary: "observed_fact",
          observedAt: "2026-04-20T13:00:00.000Z",
        }),
        buildObservation({
          observationId: "time-expired",
          signalDomain: "time_preference",
          signalKey: "preferred_daypart",
          valueText: "午后",
          sourceType: "self_reported",
          confidence: "high",
          truthBoundary: "hard_fact",
          validTo: "2026-04-10",
        }),
        buildObservation({
          observationId: "tech-1",
          signalDomain: "tech_preference",
          signalKey: "preferred_tech_code",
          valueText: "T-018",
          valueJson: { techName: "安老师" },
          sourceType: "self_reported",
          confidence: "high",
          truthBoundary: "hard_fact",
        }),
        buildObservation({
          observationId: "tech-2",
          signalDomain: "tech_preference",
          signalKey: "preferred_tech_code",
          valueText: "T-018",
          sourceType: "system_inferred",
          confidence: "low",
          truthBoundary: "predicted_signal",
        }),
        buildObservation({
          observationId: "contact-1",
          signalDomain: "contact_preference",
          signalKey: "preferred_channel",
          valueText: "企微",
          sourceRole: "customer_service",
          sourceType: "self_reported",
          confidence: "medium",
          truthBoundary: "observed_fact",
        }),
        buildObservation({
          observationId: "contact-2",
          signalDomain: "contact_preference",
          signalKey: "preferred_channel",
          valueText: "电话",
          sourceRole: "front_desk",
          sourceType: "staff_observed",
          confidence: "low",
          truthBoundary: "predicted_signal",
        }),
      ],
    });

    expect(signals).toHaveLength(5);

    const signalMap = new Map(
      signals.map((signal) => [signal.signalDomain + "|" + signal.signalKey, signal]),
    );

    expect(signalMap.get("service_need|primary_need")).toMatchObject({
      valueText: "肩颈放松",
      confidence: "high",
      truthBoundary: "hard_fact",
      scoringScope: "profile_allowed",
      supportCount: 2,
      sourceObservationIds: ["svc-1", "svc-2"],
    });

    expect(signalMap.get("interaction_style|communication_style")).toMatchObject({
      valueText: "少聊天",
      confidence: "medium",
      truthBoundary: "observed_fact",
      scoringScope: "action_only",
      supportCount: 1,
      sourceObservationIds: ["interaction-1"],
    });
    expect(signalMap.get("interaction_style|communication_style")?.valueJson).toMatchObject({
      confidence_discount: 0.35,
    });

    expect(signalMap.get("time_preference|preferred_daypart")).toMatchObject({
      valueText: "夜场",
      confidence: "medium",
      supportCount: 2,
      sourceObservationIds: ["time-1", "time-2"],
    });
    expect(signalMap.get("time_preference|preferred_daypart")?.sourceObservationIds).not.toContain(
      "time-expired",
    );

    expect(signalMap.get("tech_preference|preferred_tech_code")).toMatchObject({
      valueText: "T-018",
      confidence: "medium",
      truthBoundary: "hard_fact",
      scoringScope: "action_only",
      supportCount: 2,
      sourceObservationIds: ["tech-1", "tech-2"],
    });

    expect(signalMap.get("contact_preference|preferred_channel")).toMatchObject({
      valueText: "企微",
      confidence: "medium",
      supportCount: 1,
      sourceObservationIds: ["contact-1"],
    });
    expect(signalMap.get("contact_preference|preferred_channel")?.valueJson).toMatchObject({
      confidence_discount: 0.35,
    });
  });
});
