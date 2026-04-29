import type {
  CustomerOperatingProfileDailyRecord,
  CustomerPrimarySegment,
  CustomerSegmentRecord,
  EnvironmentContextSnapshot,
  HetangStoreExternalContextConfidence,
  MemberReactivationOutcomeSnapshotRecord,
  OperatingWorldSourceCategory,
  OperatingWorldTruthBoundary,
} from "../types.js";

export type OperatingWorldStateEvidence<T = unknown> = {
  key: string;
  sourceCategory: OperatingWorldSourceCategory;
  truthBoundary: OperatingWorldTruthBoundary;
  updatedAt: string;
  value: T;
  summary?: string;
};

export type OperatingWorldResearchNote = {
  metricKey: string;
  value: unknown;
  note?: string;
  sourceCategory: "external_context";
  truthBoundary: "soft_fact";
  updatedAt: string;
  confidence?: HetangStoreExternalContextConfidence;
  sourceType?: string;
  sourceLabel?: string;
  sourceUri?: string;
};

export type OperatingWorldIndustryObservation = {
  key: string;
  summary: string;
  sourceCategory: "industry_signal";
  truthBoundary: "weak_signal";
  updatedAt: string;
  detail?: unknown;
};

export type OperatingWorldCustomerEvidenceConfidenceBoundary =
  | "confirmed"
  | "observed"
  | "tentative";

export type OperatingWorldCustomerProfileEvidence = {
  key: string;
  label: string;
  value: string;
  sourceCategory: "derived_intelligence";
  truthBoundary: OperatingWorldTruthBoundary;
  updatedAt: string;
  confidence?: HetangStoreExternalContextConfidence;
  confidenceDiscount?: number;
  confidenceBoundary: OperatingWorldCustomerEvidenceConfidenceBoundary;
  sourceSignalIds: string[];
  summary?: string;
};

export type OperatingWorldCustomerState = {
  sourceCategory: "derived_intelligence";
  truthBoundary: "hard_fact";
  updatedAt: string;
  customerIdentityKey?: string;
  memberId?: string;
  customerDisplayName?: string;
  primarySegment?: CustomerPrimarySegment;
  latestSegment?: CustomerSegmentRecord;
  latestOperatingProfile?: CustomerOperatingProfileDailyRecord;
  operatingProfileEvidence: OperatingWorldCustomerProfileEvidence[];
  recentOutcome?: MemberReactivationOutcomeSnapshotRecord | null;
  evidence: Array<OperatingWorldStateEvidence<CustomerSegmentRecord | MemberReactivationOutcomeSnapshotRecord>>;
};

export type OperatingWorldStoreState = {
  sourceCategory: "internal_fact";
  truthBoundary: "hard_fact";
  updatedAt: string;
  orgId: string;
  confirmedContext: Record<string, unknown>;
  environmentContext?: EnvironmentContextSnapshot;
  evidence: OperatingWorldStateEvidence[];
};

export type OperatingWorldMarketState = {
  sourceCategory: "external_context";
  truthBoundary: "soft_fact";
  updatedAt: string;
  estimatedContext: Record<string, unknown>;
  researchNotes: OperatingWorldResearchNote[];
  evidence: OperatingWorldStateEvidence[];
};

export type OperatingWorldIndustryState = {
  sourceCategory: "industry_signal";
  truthBoundary: "weak_signal";
  updatedAt: string;
  observations: OperatingWorldIndustryObservation[];
};

export type OperatingWorldStateSnapshot = {
  orgId: string;
  bizDate: string;
  assembledAt: string;
  customerState: OperatingWorldCustomerState;
  storeState: OperatingWorldStoreState;
  marketState: OperatingWorldMarketState;
  industryState: OperatingWorldIndustryState;
};
