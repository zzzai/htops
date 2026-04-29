import { resolveStoreExternalContextEntryValue } from "../store-external-context.js";
import type {
  CustomerOperatingProfileDailyRecord,
  CustomerSegmentRecord,
  EnvironmentContextSnapshot,
  HetangStoreExternalContextEntry,
  MemberReactivationOutcomeSnapshotRecord,
} from "../types.js";
import { buildCustomerProfileEvidenceState } from "./customer-profile-evidence.js";
import type {
  OperatingWorldIndustryObservation,
  OperatingWorldResearchNote,
  OperatingWorldStateSnapshot,
} from "./types.js";

function pickLatestSegment(params: {
  customerSegments: CustomerSegmentRecord[];
  customerIdentityKey?: string;
  memberId?: string;
}): CustomerSegmentRecord | undefined {
  return params.customerSegments
    .filter((segment) => {
      if (params.customerIdentityKey) {
        return segment.customerIdentityKey === params.customerIdentityKey;
      }
      if (params.memberId) {
        return segment.memberId === params.memberId;
      }
      return true;
    })
    .sort((left, right) => {
      if (left.bizDate !== right.bizDate) {
        return right.bizDate.localeCompare(left.bizDate);
      }
      return right.payAmount90d - left.payAmount90d;
    })[0];
}

function pickLatestOutcome(params: {
  outcomeSnapshots: MemberReactivationOutcomeSnapshotRecord[];
  customerIdentityKey?: string;
  memberId?: string;
}): MemberReactivationOutcomeSnapshotRecord | null {
  return (
    params.outcomeSnapshots
      .filter((snapshot) => {
        if (params.customerIdentityKey) {
          return snapshot.customerIdentityKey === params.customerIdentityKey;
        }
        if (params.memberId) {
          return snapshot.memberId === params.memberId;
        }
        return true;
      })
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt.localeCompare(left.updatedAt);
        }
        return right.bizDate.localeCompare(left.bizDate);
      })[0] ?? null
  );
}

function buildConfirmedContext(entries: HetangStoreExternalContextEntry[]): Record<string, unknown> {
  const confirmed: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.truthLevel !== "confirmed" && entry.contextKind !== "store_business_profile") {
      continue;
    }
    confirmed[entry.metricKey] = resolveStoreExternalContextEntryValue(entry);
  }
  return confirmed;
}

function buildEstimatedContext(entries: HetangStoreExternalContextEntry[]): Record<string, unknown> {
  const estimated: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.truthLevel !== "estimated" && entry.contextKind !== "estimated_market_context") {
      continue;
    }
    estimated[entry.metricKey] = resolveStoreExternalContextEntryValue(entry);
  }
  return estimated;
}

function buildResearchNotes(entries: HetangStoreExternalContextEntry[]): OperatingWorldResearchNote[] {
  return entries
    .filter((entry) => entry.truthLevel === "research_note" || entry.contextKind === "research_note")
    .map((entry) => ({
      metricKey: entry.metricKey,
      value: resolveStoreExternalContextEntryValue(entry),
      note: entry.note,
      sourceCategory: "external_context",
      truthBoundary: "soft_fact",
      updatedAt: entry.updatedAt,
      confidence: entry.confidence,
      sourceType: entry.sourceType,
      sourceLabel: entry.sourceLabel,
      sourceUri: entry.sourceUri,
    }));
}

function resolveStoreStateUpdatedAt(params: {
  assembledAt: string;
  environmentContext?: EnvironmentContextSnapshot;
  externalContextEntries: HetangStoreExternalContextEntry[];
}): string {
  const latestExternalUpdate = params.externalContextEntries
    .map((entry) => entry.updatedAt)
    .sort((left, right) => right.localeCompare(left))[0];
  return latestExternalUpdate ?? params.assembledAt;
}

export function buildOperatingWorldStateSnapshot(params: {
  orgId: string;
  bizDate: string;
  customerIdentityKey?: string;
  memberId?: string;
  storeFactContext?: Record<string, unknown>;
  customerSegments?: CustomerSegmentRecord[];
  environmentContext?: EnvironmentContextSnapshot;
  externalContextEntries?: HetangStoreExternalContextEntry[];
  outcomeSnapshots?: MemberReactivationOutcomeSnapshotRecord[];
  customerOperatingProfiles?: CustomerOperatingProfileDailyRecord[];
  industryObservations?: OperatingWorldIndustryObservation[];
  assembledAt?: string;
}): OperatingWorldStateSnapshot {
  const assembledAt = params.assembledAt ?? new Date().toISOString();
  const customerSegments = params.customerSegments ?? [];
  const externalContextEntries = params.externalContextEntries ?? [];
  const outcomeSnapshots = params.outcomeSnapshots ?? [];
  const customerOperatingProfiles = params.customerOperatingProfiles ?? [];
  const industryObservations = params.industryObservations ?? [];
  const storeFactContext = params.storeFactContext ?? {};

  const latestSegment = pickLatestSegment({
    customerSegments,
    customerIdentityKey: params.customerIdentityKey,
    memberId: params.memberId,
  });
  const recentOutcome = pickLatestOutcome({
    outcomeSnapshots,
    customerIdentityKey: params.customerIdentityKey ?? latestSegment?.customerIdentityKey,
    memberId: params.memberId ?? latestSegment?.memberId,
  });
  const customerProfileEvidenceState = buildCustomerProfileEvidenceState({
    customerOperatingProfiles,
    customerIdentityKey: params.customerIdentityKey ?? latestSegment?.customerIdentityKey,
    memberId: params.memberId ?? latestSegment?.memberId,
  });

  const customerUpdatedAt =
    recentOutcome?.updatedAt ??
    customerProfileEvidenceState.latestOperatingProfile?.updatedAt ??
    params.environmentContext?.bizDate ??
    latestSegment?.bizDate ??
    assembledAt;

  return {
    orgId: params.orgId,
    bizDate: params.bizDate,
    assembledAt,
    customerState: {
      sourceCategory: "derived_intelligence",
      truthBoundary: "hard_fact",
      updatedAt: customerUpdatedAt,
      customerIdentityKey: latestSegment?.customerIdentityKey ?? params.customerIdentityKey,
      memberId: latestSegment?.memberId ?? params.memberId,
      customerDisplayName: latestSegment?.customerDisplayName ?? recentOutcome?.customerDisplayName,
      primarySegment: latestSegment?.primarySegment ?? recentOutcome?.primarySegment,
      latestSegment,
      latestOperatingProfile: customerProfileEvidenceState.latestOperatingProfile,
      operatingProfileEvidence: customerProfileEvidenceState.operatingProfileEvidence,
      recentOutcome,
      evidence: [
        ...(latestSegment
          ? [
              {
                key: "latest-segment",
                sourceCategory: "derived_intelligence" as const,
                truthBoundary: "hard_fact" as const,
                updatedAt: `${latestSegment.bizDate}T00:00:00.000Z`,
                value: latestSegment,
              },
            ]
          : []),
        ...(recentOutcome
          ? [
              {
                key: "recent-outcome",
                sourceCategory: "execution_feedback" as const,
                truthBoundary: "hard_fact" as const,
                updatedAt: recentOutcome.updatedAt,
                value: recentOutcome,
              },
            ]
          : []),
      ],
    },
    storeState: {
      sourceCategory: "internal_fact",
      truthBoundary: "hard_fact",
      updatedAt: resolveStoreStateUpdatedAt({
        assembledAt,
        environmentContext: params.environmentContext,
        externalContextEntries,
      }),
      orgId: params.orgId,
      confirmedContext: {
        ...storeFactContext,
        ...buildConfirmedContext(externalContextEntries),
      },
      environmentContext: params.environmentContext,
      evidence: [
        ...Object.entries(storeFactContext).map(([key, value]) => ({
          key,
          sourceCategory: "internal_fact" as const,
          truthBoundary: "hard_fact" as const,
          updatedAt: assembledAt,
          value,
        })),
        ...(params.environmentContext
          ? [
              {
                key: "environment-context",
                sourceCategory: "environment_context" as const,
                truthBoundary: "soft_fact" as const,
                updatedAt: `${params.environmentContext.bizDate}T00:00:00.000Z`,
                value: params.environmentContext,
              },
            ]
          : []),
      ],
    },
    marketState: {
      sourceCategory: "external_context",
      truthBoundary: "soft_fact",
      updatedAt: resolveStoreStateUpdatedAt({
        assembledAt,
        environmentContext: params.environmentContext,
        externalContextEntries,
      }),
      estimatedContext: buildEstimatedContext(externalContextEntries),
      researchNotes: buildResearchNotes(externalContextEntries),
      evidence: externalContextEntries.map((entry) => ({
        key: entry.metricKey,
        sourceCategory: "external_context" as const,
        truthBoundary: "soft_fact" as const,
        updatedAt: entry.updatedAt,
        value: resolveStoreExternalContextEntryValue(entry),
      })),
    },
    industryState: {
      sourceCategory: "industry_signal",
      truthBoundary: "weak_signal",
      updatedAt:
        industryObservations
          .map((entry) => entry.updatedAt)
          .sort((left, right) => right.localeCompare(left))[0] ?? assembledAt,
      observations: industryObservations,
    },
  };
}
