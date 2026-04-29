export type CustomerGrowthAiModule =
  | "profileInsight"
  | "tagAdvisor"
  | "strategyAdvisor"
  | "followupSummarizer";

export type CustomerGrowthProfileInsight = {
  profileNarrative?: string;
  highValueSignals?: string[];
  riskSignals?: string[];
  missingFacts?: string[];
};

export type CustomerGrowthTagAdvisor = {
  softTags?: string[];
  tagHypotheses?: string[];
  tagReasons?: string[];
};

export type CustomerGrowthStrategyAdvisor = {
  contactAngle?: string;
  talkingPoints?: string[];
  offerGuardrails?: string[];
  doNotPushFlags?: string[];
};

export type CustomerGrowthFollowupSummary = {
  outcomeSummary?: string;
  objectionLabels?: string[];
  nextBestAction?: string;
  followupDraft?: string;
};

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalStringList(value: unknown, limit = 6): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => optionalString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, limit);
  return normalized.length > 0 ? normalized : undefined;
}

function hasAnyDefinedValue(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => {
    if (Array.isArray(entry)) {
      return entry.length > 0;
    }
    return entry !== undefined && entry !== null;
  });
}

export function normalizeCustomerGrowthProfileInsight(
  value: Record<string, unknown> | null,
): CustomerGrowthProfileInsight | null {
  if (!value) {
    return null;
  }
  const normalized: CustomerGrowthProfileInsight = {
    profileNarrative: optionalString(value.profileNarrative),
    highValueSignals: optionalStringList(value.highValueSignals),
    riskSignals: optionalStringList(value.riskSignals),
    missingFacts: optionalStringList(value.missingFacts),
  };
  return hasAnyDefinedValue(normalized as Record<string, unknown>) ? normalized : null;
}

export function normalizeCustomerGrowthTagAdvisor(
  value: Record<string, unknown> | null,
): CustomerGrowthTagAdvisor | null {
  if (!value) {
    return null;
  }
  const normalized: CustomerGrowthTagAdvisor = {
    softTags: optionalStringList(value.softTags),
    tagHypotheses: optionalStringList(value.tagHypotheses),
    tagReasons: optionalStringList(value.tagReasons),
  };
  return hasAnyDefinedValue(normalized as Record<string, unknown>) ? normalized : null;
}

export function normalizeCustomerGrowthStrategyAdvisor(
  value: Record<string, unknown> | null,
): CustomerGrowthStrategyAdvisor | null {
  if (!value) {
    return null;
  }
  const normalized: CustomerGrowthStrategyAdvisor = {
    contactAngle: optionalString(value.contactAngle),
    talkingPoints: optionalStringList(value.talkingPoints),
    offerGuardrails: optionalStringList(value.offerGuardrails),
    doNotPushFlags: optionalStringList(value.doNotPushFlags),
  };
  return hasAnyDefinedValue(normalized as Record<string, unknown>) ? normalized : null;
}

export function normalizeCustomerGrowthFollowupSummary(
  value: Record<string, unknown> | null,
): CustomerGrowthFollowupSummary | null {
  if (!value) {
    return null;
  }
  const normalized: CustomerGrowthFollowupSummary = {
    outcomeSummary: optionalString(value.outcomeSummary),
    objectionLabels: optionalStringList(value.objectionLabels),
    nextBestAction: optionalString(value.nextBestAction),
    followupDraft: optionalString(value.followupDraft),
  };
  return hasAnyDefinedValue(normalized as Record<string, unknown>) ? normalized : null;
}
