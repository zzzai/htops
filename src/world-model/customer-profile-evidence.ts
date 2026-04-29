import type { CustomerOperatingProfileDailyRecord } from "../types.js";
import type {
  OperatingWorldCustomerEvidenceConfidenceBoundary,
  OperatingWorldCustomerProfileEvidence,
} from "./types.js";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function pickLatestOperatingProfile(params: {
  customerOperatingProfiles: CustomerOperatingProfileDailyRecord[];
  customerIdentityKey?: string;
  memberId?: string;
}): CustomerOperatingProfileDailyRecord | undefined {
  return params.customerOperatingProfiles
    .filter((row) => {
      if (params.memberId) {
        return row.memberId === params.memberId;
      }
      if (params.customerIdentityKey) {
        return row.customerIdentityKey === params.customerIdentityKey;
      }
      return true;
    })
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }
      return right.bizDate.localeCompare(left.bizDate);
    })[0];
}

function resolveTruthBoundary(params: {
  rawTruthBoundary?: string;
  confidenceDiscount?: number;
  preferWeakSignal?: boolean;
}): OperatingWorldCustomerProfileEvidence["truthBoundary"] {
  if (params.rawTruthBoundary === "hard_fact") {
    return "hard_fact";
  }
  if (params.rawTruthBoundary === "predicted_signal" || params.rawTruthBoundary === "inferred_label") {
    return "weak_signal";
  }
  if (params.preferWeakSignal === true) {
    return "weak_signal";
  }
  if ((params.confidenceDiscount ?? 0) >= 0.55) {
    return "weak_signal";
  }
  return "soft_fact";
}

function resolveConfidenceBoundary(params: {
  truthBoundary: OperatingWorldCustomerProfileEvidence["truthBoundary"];
  confidenceDiscount?: number;
}): OperatingWorldCustomerEvidenceConfidenceBoundary {
  if (params.truthBoundary === "hard_fact" && (params.confidenceDiscount ?? 0) <= 0.15) {
    return "confirmed";
  }
  if (params.truthBoundary === "weak_signal" || (params.confidenceDiscount ?? 0) >= 0.5) {
    return "tentative";
  }
  return "observed";
}

function pushEvidence(params: {
  output: OperatingWorldCustomerProfileEvidence[];
  profile: CustomerOperatingProfileDailyRecord;
  key: string;
  label: string;
  value?: string;
  confidence?: string;
  confidenceDiscount?: number;
  rawTruthBoundary?: string;
  preferWeakSignal?: boolean;
}): void {
  if (!params.value) {
    return;
  }
  const confidenceDiscount = round(clamp(params.confidenceDiscount ?? 0, 0, 0.9), 4);
  const truthBoundary = resolveTruthBoundary({
    rawTruthBoundary: params.rawTruthBoundary,
    confidenceDiscount,
    preferWeakSignal: params.preferWeakSignal,
  });
  params.output.push({
    key: params.key,
    label: params.label,
    value: params.value,
    sourceCategory: "derived_intelligence",
    truthBoundary,
    updatedAt: params.profile.updatedAt,
    confidence:
      params.confidence === "high" || params.confidence === "medium" || params.confidence === "low"
        ? params.confidence
        : undefined,
    confidenceDiscount,
    confidenceBoundary: resolveConfidenceBoundary({
      truthBoundary,
      confidenceDiscount,
    }),
    sourceSignalIds: params.profile.sourceSignalIds,
    summary: params.label + "：" + params.value,
  });
}

export function buildCustomerProfileEvidenceState(params: {
  customerOperatingProfiles: CustomerOperatingProfileDailyRecord[];
  customerIdentityKey?: string;
  memberId?: string;
}): {
  latestOperatingProfile?: CustomerOperatingProfileDailyRecord;
  operatingProfileEvidence: OperatingWorldCustomerProfileEvidence[];
} {
  const latestOperatingProfile = pickLatestOperatingProfile(params);
  if (!latestOperatingProfile) {
    return {
      latestOperatingProfile: undefined,
      operatingProfileEvidence: [],
    };
  }

  const serviceNeedProfile = asObject(latestOperatingProfile.serviceNeedProfileJson);
  const interactionProfile = asObject(latestOperatingProfile.interactionProfileJson);
  const preferenceProfile = asObject(latestOperatingProfile.preferenceProfileJson);
  const relationshipProfile = asObject(latestOperatingProfile.relationshipProfileJson);
  const evidence: OperatingWorldCustomerProfileEvidence[] = [];

  pushEvidence({
    output: evidence,
    profile: latestOperatingProfile,
    key: "service_need.primary_need",
    label: "服务诉求",
    value: readText(serviceNeedProfile, "primary_need"),
    confidence: readText(serviceNeedProfile, "signal_confidence"),
    confidenceDiscount: readNumber(serviceNeedProfile, "confidence_discount"),
    rawTruthBoundary: readText(serviceNeedProfile, "truth_boundary"),
  });
  pushEvidence({
    output: evidence,
    profile: latestOperatingProfile,
    key: "interaction.communication_style",
    label: "互动风格",
    value: readText(interactionProfile, "communication_style"),
    confidence: readText(interactionProfile, "signal_confidence"),
    confidenceDiscount: readNumber(interactionProfile, "confidence_discount"),
  });
  pushEvidence({
    output: evidence,
    profile: latestOperatingProfile,
    key: "preference.preferred_daypart",
    label: "时段偏好",
    value: readText(preferenceProfile, "preferred_daypart"),
    confidenceDiscount: readNumber(preferenceProfile, "confidence_discount"),
  });
  pushEvidence({
    output: evidence,
    profile: latestOperatingProfile,
    key: "preference.preferred_channel",
    label: "触达偏好",
    value: readText(preferenceProfile, "preferred_channel"),
    confidence: readText(preferenceProfile, "preferred_channel_confidence"),
    confidenceDiscount: readNumber(preferenceProfile, "preferred_channel_confidence_discount"),
    rawTruthBoundary: readText(preferenceProfile, "preferred_channel_truth_boundary"),
    preferWeakSignal: true,
  });
  pushEvidence({
    output: evidence,
    profile: latestOperatingProfile,
    key: "relationship.top_tech_name",
    label: "技师关系",
    value:
      readText(preferenceProfile, "preferred_tech_name") ??
      readText(relationshipProfile, "top_tech_name"),
    confidenceDiscount: readNumber(preferenceProfile, "confidence_discount"),
  });

  return {
    latestOperatingProfile,
    operatingProfileEvidence: evidence,
  };
}
