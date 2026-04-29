import { randomUUID } from "node:crypto";

import { buildCustomerOperatingSignals } from "./customer-observation.js";
import type {
  CustomerObservationSourceRole,
  CustomerObservationSourceType,
  CustomerObservationTruthBoundary,
  CustomerOperatingSignalRecord,
  CustomerServiceObservationBatch,
  CustomerServiceObservationRecord,
  HetangStoreExternalContextConfidence,
} from "../types.js";

export type CustomerServiceObservationCaptureStore = {
  createCustomerServiceObservationBatch: (row: CustomerServiceObservationBatch) => Promise<void>;
  insertCustomerServiceObservation: (
    row: Omit<CustomerServiceObservationRecord, "rawJson"> & { rawJson?: string },
  ) => Promise<void>;
  listCustomerServiceObservations: (params: {
    orgId: string;
    memberId?: string;
    customerIdentityKey?: string;
    signalDomain?: string;
    limit?: number;
  }) => Promise<CustomerServiceObservationRecord[]>;
  upsertCustomerOperatingSignal: (row: CustomerOperatingSignalRecord) => Promise<void>;
};

export type CustomerServiceObservationCaptureResult = {
  batchId: string;
  observationId: string;
  customerIdentityKey: string;
  publishedSignalCount: number;
  publishedSignals: CustomerOperatingSignalRecord[];
};

function resolveCustomerIdentityKey(memberId: string): string {
  return memberId.startsWith("member:") ? memberId : `member:${memberId}`;
}

export async function captureCustomerServiceObservation(params: {
  store: CustomerServiceObservationCaptureStore;
  orgId: string;
  memberId: string;
  signalDomain: string;
  signalKey: string;
  valueText: string;
  rawNote?: string;
  observerId?: string;
  operatorId?: string;
  sourceRole?: CustomerObservationSourceRole;
  sourceType?: CustomerObservationSourceType;
  confidence?: HetangStoreExternalContextConfidence;
  truthBoundary?: CustomerObservationTruthBoundary;
  observedAt?: string;
  updatedAt?: string;
  validTo?: string;
  createId?: () => string;
}): Promise<CustomerServiceObservationCaptureResult> {
  const createId = params.createId ?? randomUUID;
  const observedAt = params.observedAt ?? new Date().toISOString();
  const updatedAt = params.updatedAt ?? observedAt;
  const sourceRole = params.sourceRole ?? "store_manager";
  const sourceType = params.sourceType ?? "staff_observed";
  const confidence = params.confidence ?? "medium";
  const truthBoundary = params.truthBoundary ?? "observed_fact";
  const customerIdentityKey = resolveCustomerIdentityKey(params.memberId);
  const batchId = createId();
  const observationId = createId();

  await params.store.createCustomerServiceObservationBatch({
    batchId,
    orgId: params.orgId,
    sourceRole,
    collectionSurface: "command_surface",
    captureMode: "manual_single",
    capturedAt: observedAt,
    operatorId: params.operatorId ?? params.observerId,
    status: "captured",
    rawManifestJson: JSON.stringify({
      memberId: params.memberId,
      customerIdentityKey,
      signalDomain: params.signalDomain,
      signalKey: params.signalKey,
      valueText: params.valueText,
    }),
  });

  await params.store.insertCustomerServiceObservation({
    observationId,
    orgId: params.orgId,
    memberId: params.memberId,
    customerIdentityKey,
    sourceRole,
    sourceType,
    observerId: params.observerId,
    batchId,
    signalDomain: params.signalDomain,
    signalKey: params.signalKey,
    valueText: params.valueText,
    confidence,
    truthBoundary,
    observedAt,
    validTo: params.validTo,
    rawNote: params.rawNote,
    rawJson: JSON.stringify({
      source: "command_surface",
      note: params.rawNote ?? null,
    }),
    updatedAt,
  });

  const observations = await params.store.listCustomerServiceObservations({
    orgId: params.orgId,
    memberId: params.memberId,
    customerIdentityKey,
    limit: 500,
  });
  const publishedSignals = buildCustomerOperatingSignals({
    asOfDate: observedAt.slice(0, 10),
    updatedAt,
    observations,
  }).filter((signal) => signal.customerIdentityKey === customerIdentityKey);

  for (const signal of publishedSignals) {
    await params.store.upsertCustomerOperatingSignal(signal);
  }

  return {
    batchId,
    observationId,
    customerIdentityKey,
    publishedSignalCount: publishedSignals.length,
    publishedSignals,
  };
}
