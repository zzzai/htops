import { describe, expect, it, vi } from "vitest";

import { captureCustomerServiceObservation } from "./observation-capture.js";
import type { CustomerServiceObservationRecord } from "../types.js";

function buildObservation(
  overrides: Partial<CustomerServiceObservationRecord> = {},
): CustomerServiceObservationRecord {
  return {
    observationId: "obs-existing",
    orgId: "1001",
    memberId: "M-001",
    customerIdentityKey: "member:M-001",
    sourceRole: "store_manager",
    sourceType: "staff_observed",
    observerId: "manager-1",
    batchId: "batch-existing",
    signalDomain: "service_need",
    signalKey: "primary_need",
    valueText: "腰背放松",
    confidence: "medium",
    truthBoundary: "observed_fact",
    observedAt: "2026-04-21T10:00:00.000Z",
    rawNote: "原有备注",
    rawJson: "{}",
    updatedAt: "2026-04-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("captureCustomerServiceObservation", () => {
  it("creates a capture batch, writes the observation, and republishes member signals", async () => {
    const store = {
      createCustomerServiceObservationBatch: vi.fn().mockResolvedValue(undefined),
      insertCustomerServiceObservation: vi.fn().mockResolvedValue(undefined),
      listCustomerServiceObservations: vi.fn().mockResolvedValue([
        buildObservation(),
        buildObservation({
          observationId: "obs-new",
          valueText: "肩颈放松",
          observedAt: "2026-04-21T12:00:00.000Z",
          rawNote: "新记录备注",
        }),
      ]),
      upsertCustomerOperatingSignal: vi.fn().mockResolvedValue(undefined),
    };

    const result = await captureCustomerServiceObservation({
      store,
      orgId: "1001",
      memberId: "M-001",
      signalDomain: "service_need",
      signalKey: "primary_need",
      valueText: "肩颈放松",
      rawNote: "新记录备注",
      observerId: "manager-1",
      observedAt: "2026-04-21T12:00:00.000Z",
      updatedAt: "2026-04-21T12:00:00.000Z",
      createId: (() => {
        const ids = ["batch-new", "obs-new"];
        return () => ids.shift() ?? "id-fallback";
      })(),
    });

    expect(store.createCustomerServiceObservationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-new",
        orgId: "1001",
        sourceRole: "store_manager",
        collectionSurface: "command_surface",
        captureMode: "manual_single",
        status: "captured",
      }),
    );
    expect(store.insertCustomerServiceObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        observationId: "obs-new",
        customerIdentityKey: "member:M-001",
        signalDomain: "service_need",
        signalKey: "primary_need",
        valueText: "肩颈放松",
        sourceRole: "store_manager",
        sourceType: "staff_observed",
        confidence: "medium",
        truthBoundary: "observed_fact",
      }),
    );
    expect(store.listCustomerServiceObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        memberId: "M-001",
        customerIdentityKey: "member:M-001",
      }),
    );
    expect(store.upsertCustomerOperatingSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signalDomain: "service_need",
        signalKey: "primary_need",
        valueText: "肩颈放松",
        customerIdentityKey: "member:M-001",
      }),
    );
    expect(result).toMatchObject({
      batchId: "batch-new",
      observationId: "obs-new",
      customerIdentityKey: "member:M-001",
      publishedSignalCount: 1,
    });
  });
});
