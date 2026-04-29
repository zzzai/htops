import type {
  CustomerObservationTruthBoundary,
  CustomerOperatingScoringScope,
  CustomerOperatingSignalRecord,
  CustomerServiceObservationRecord,
  HetangStoreExternalContextConfidence,
} from "../types.js";

const CONFIDENCE_WEIGHTS: Record<HetangStoreExternalContextConfidence, number> = {
  high: 1,
  medium: 0.65,
  low: 0.35,
};

const CONFIDENCE_DISCOUNTS: Record<HetangStoreExternalContextConfidence, number> = {
  high: 0,
  medium: 0.35,
  low: 0.65,
};

const TRUTH_WEIGHTS: Record<CustomerObservationTruthBoundary, number> = {
  hard_fact: 1,
  observed_fact: 0.8,
  inferred_label: 0.55,
  predicted_signal: 0.35,
};

const SOURCE_TYPE_WEIGHTS: Record<CustomerServiceObservationRecord["sourceType"], number> = {
  self_reported: 1,
  staff_observed: 0.9,
  system_fact: 0.95,
  system_inferred: 0.7,
};

const TRUTH_PRIORITY: CustomerObservationTruthBoundary[] = [
  "hard_fact",
  "observed_fact",
  "inferred_label",
  "predicted_signal",
];

type WeightedObservation = {
  observation: CustomerServiceObservationRecord;
  valueKey: string;
  weight: number;
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeDateToken(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function parseDayStart(value: string): number | null {
  const timestamp = Date.parse(`${normalizeDateToken(value)}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveRecencyWeight(observedAt: string, asOfDate: string): number {
  const observedDay = parseDayStart(observedAt);
  const asOfDay = parseDayStart(asOfDate);
  if (observedDay === null || asOfDay === null) {
    return 1;
  }
  const days = Math.max(0, Math.floor((asOfDay - observedDay) / 86_400_000));
  if (days <= 14) {
    return 1;
  }
  if (days <= 60) {
    return 0.9;
  }
  return 0.75;
}

function isActiveObservation(
  observation: CustomerServiceObservationRecord,
  asOfDate: string,
): boolean {
  if (!observation.validTo) {
    return true;
  }
  return normalizeDateToken(observation.validTo) >= normalizeDateToken(asOfDate);
}

function buildObservationValueKey(observation: CustomerServiceObservationRecord): string {
  if (observation.valueText !== undefined) {
    return `text:${observation.valueText}`;
  }
  if (observation.valueNum !== undefined) {
    return `num:${observation.valueNum}`;
  }
  return `json:${JSON.stringify(observation.valueJson ?? null)}`;
}

function resolveObservationWeight(
  observation: CustomerServiceObservationRecord,
  asOfDate: string,
): number {
  return round(
    CONFIDENCE_WEIGHTS[observation.confidence] *
      TRUTH_WEIGHTS[observation.truthBoundary] *
      SOURCE_TYPE_WEIGHTS[observation.sourceType] *
      resolveRecencyWeight(observation.observedAt, asOfDate),
  );
}

function resolveWinningTruthBoundary(
  observations: CustomerServiceObservationRecord[],
): CustomerObservationTruthBoundary {
  for (const boundary of TRUTH_PRIORITY) {
    if (observations.some((observation) => observation.truthBoundary === boundary)) {
      return boundary;
    }
  }
  return "predicted_signal";
}

function resolveSignalConfidence(totalWeight: number): HetangStoreExternalContextConfidence {
  if (totalWeight >= 1.2) {
    return "high";
  }
  if (totalWeight >= 0.35) {
    return "medium";
  }
  return "low";
}

function resolveScoringScope(params: {
  truthBoundary: CustomerObservationTruthBoundary;
  totalWeight: number;
}): CustomerOperatingScoringScope {
  if (params.truthBoundary === "hard_fact" && params.totalWeight >= 1.2) {
    return "profile_allowed";
  }
  if (params.totalWeight >= 0.35) {
    return "action_only";
  }
  return "none";
}

function resolveLatestObservedAt(observations: CustomerServiceObservationRecord[]): string {
  return observations.reduce(
    (latest, observation) => (observation.observedAt > latest ? observation.observedAt : latest),
    observations[0]?.observedAt ?? "",
  );
}

function resolveValidTo(observations: CustomerServiceObservationRecord[]): string | undefined {
  const validToValues = observations
    .map((observation) => observation.validTo)
    .filter((value): value is string => Boolean(value))
    .sort();
  return validToValues.length > 0 ? validToValues[validToValues.length - 1] : undefined;
}

function resolveValueJson(params: {
  chosenObservation: CustomerServiceObservationRecord;
  confidence: HetangStoreExternalContextConfidence;
  supportCount: number;
  totalWeight: number;
}): Record<string, unknown> {
  const raw = params.chosenObservation.valueJson;
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  return {
    ...base,
    confidence_discount: CONFIDENCE_DISCOUNTS[params.confidence],
    support_count: params.supportCount,
    aggregate_weight: round(params.totalWeight),
  };
}

export function buildCustomerOperatingSignals(params: {
  asOfDate: string;
  updatedAt: string;
  observations: CustomerServiceObservationRecord[];
}): CustomerOperatingSignalRecord[] {
  const grouped = new Map<string, WeightedObservation[]>();

  for (const observation of params.observations) {
    if (!isActiveObservation(observation, params.asOfDate)) {
      continue;
    }
    const groupKey = `${observation.signalDomain}|${observation.signalKey}`;
    const entry: WeightedObservation = {
      observation,
      valueKey: buildObservationValueKey(observation),
      weight: resolveObservationWeight(observation, params.asOfDate),
    };
    const items = grouped.get(groupKey);
    if (items) {
      items.push(entry);
    } else {
      grouped.set(groupKey, [entry]);
    }
  }

  const signals: CustomerOperatingSignalRecord[] = [];

  for (const [groupKey, items] of grouped.entries()) {
    const candidates = new Map<string, WeightedObservation[]>();
    for (const item of items) {
      const existing = candidates.get(item.valueKey);
      if (existing) {
        existing.push(item);
      } else {
        candidates.set(item.valueKey, [item]);
      }
    }

    let winningItems: WeightedObservation[] | null = null;
    let winningScore = -1;
    let winningLatestObservedAt = "";
    for (const candidateItems of candidates.values()) {
      const score = round(candidateItems.reduce((sum, item) => sum + item.weight, 0));
      const latestObservedAt = candidateItems.reduce(
        (latest, item) =>
          item.observation.observedAt > latest ? item.observation.observedAt : latest,
        "",
      );
      if (
        score > winningScore ||
        (score === winningScore && candidateItems.length > (winningItems?.length ?? 0)) ||
        (score === winningScore &&
          candidateItems.length === (winningItems?.length ?? 0) &&
          latestObservedAt > winningLatestObservedAt)
      ) {
        winningItems = candidateItems;
        winningScore = score;
        winningLatestObservedAt = latestObservedAt;
      }
    }
    if (!winningItems || winningItems.length === 0) {
      continue;
    }

    const chosenItems = [...winningItems];
    const chosenObservations = chosenItems.map((item) => item.observation);
    const totalWeight = round(chosenItems.reduce((sum, item) => sum + item.weight, 0));
    const confidence = resolveSignalConfidence(totalWeight);
    const truthBoundary = resolveWinningTruthBoundary(chosenObservations);
    const scoringScope = resolveScoringScope({
      truthBoundary,
      totalWeight,
    });
    const chosenObservation = [...chosenItems]
      .sort(
        (left, right) =>
          right.weight - left.weight ||
          right.observation.observedAt.localeCompare(left.observation.observedAt),
      )[0].observation;
    const orgId = chosenObservation.orgId;
    const customerIdentityKey = chosenObservation.customerIdentityKey;
    const signalId = `${orgId}|${customerIdentityKey}|${groupKey}`;

    signals.push({
      signalId,
      orgId,
      memberId: chosenObservation.memberId,
      customerIdentityKey,
      signalDomain: chosenObservation.signalDomain,
      signalKey: chosenObservation.signalKey,
      valueNum: chosenObservation.valueNum,
      valueText: chosenObservation.valueText,
      valueJson: resolveValueJson({
        chosenObservation,
        confidence,
        supportCount: chosenItems.length,
        totalWeight,
      }),
      confidence,
      truthBoundary,
      scoringScope,
      sourceObservationIds: chosenItems.map((item) => item.observation.observationId),
      supportCount: chosenItems.length,
      observedAt: resolveLatestObservedAt(chosenObservations),
      validTo: resolveValidTo(chosenObservations),
      updatedAt: params.updatedAt,
    });
  }

  return signals.sort(
    (left, right) =>
      left.signalDomain.localeCompare(right.signalDomain) ||
      left.signalKey.localeCompare(right.signalKey),
  );
}
