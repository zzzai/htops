import { createHash } from "node:crypto";
import type {
  HetangExternalEventCandidate,
  HetangExternalEventCard,
  HetangExternalSourceConfig,
} from "../types.js";

const DEFAULT_BUCKET_HOURS = 12;

export type ExternalClusterOptions = {
  bucketHours?: number;
};

export type ClusteredExternalEvent = {
  eventKey: string;
  timeBucket: string;
  candidateIds: string[];
  sourceIds: string[];
  card: HetangExternalEventCard;
};

function normalizePart(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parseTime(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

function buildTimeBucket(
  eventAt: string | undefined,
  publishedAt: string,
  bucketHours: number,
): { bucket: string; referenceTime: Date | null } {
  const parsedEventTime = parseTime(eventAt);
  const parsedPublishedTime = parseTime(publishedAt);
  const referenceTime = parsedEventTime ?? parsedPublishedTime;
  if (!referenceTime) {
    return {
      bucket: "unknown",
      referenceTime: null,
    };
  }
  const bucketMs = Math.max(1, Math.floor(bucketHours)) * 60 * 60 * 1000;
  const bucketStart = Math.floor(referenceTime.getTime() / bucketMs) * bucketMs;
  return {
    bucket: new Date(bucketStart).toISOString().slice(0, 13),
    referenceTime,
  };
}

export function buildExternalEventKey(
  candidate: Pick<
    HetangExternalEventCandidate,
    "entity" | "action" | "object" | "eventAt" | "publishedAt"
  >,
  options: ExternalClusterOptions = {},
): { eventKey: string; timeBucket: string } {
  const bucketHours = options.bucketHours ?? DEFAULT_BUCKET_HOURS;
  const { bucket } = buildTimeBucket(candidate.eventAt, candidate.publishedAt, bucketHours);
  const eventKey = [
    normalizePart(candidate.entity),
    normalizePart(candidate.action),
    normalizePart(candidate.object),
    bucket,
  ].join("|");
  return {
    eventKey,
    timeBucket: bucket,
  };
}

function stableCandidateOrder(
  candidates: HetangExternalEventCandidate[],
): HetangExternalEventCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftTime = parseTime(left.publishedAt)?.getTime() ?? 0;
    const rightTime = parseTime(right.publishedAt)?.getTime() ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.candidateId.localeCompare(right.candidateId);
  });
}

function strongestTier(
  sources: Array<Pick<HetangExternalSourceConfig, "tier">>,
): HetangExternalSourceConfig["tier"] {
  const rank: Record<HetangExternalSourceConfig["tier"], number> = {
    s: 0,
    a: 1,
    b: 2,
    blocked: 3,
  };
  return sources.reduce(
    (best, current) => (rank[current.tier] < rank[best] ? current.tier : best),
    sources[0]?.tier ?? "b",
  );
}

function buildCardId(eventKey: string): string {
  return `event-${createHash("sha1").update(eventKey).digest("hex").slice(0, 12)}`;
}

export function clusterExternalCandidates(
  candidates: HetangExternalEventCandidate[],
  options: ExternalClusterOptions = {},
): ClusteredExternalEvent[] {
  const groups = new Map<string, HetangExternalEventCandidate[]>();
  const buckets = new Map<string, string>();
  for (const candidate of candidates) {
    const { eventKey, timeBucket } = buildExternalEventKey(candidate, options);
    const safeEventKey =
      timeBucket === "unknown" ? `${eventKey}|candidate:${candidate.candidateId}` : eventKey;
    const existing = groups.get(safeEventKey) ?? [];
    existing.push(candidate);
    groups.set(safeEventKey, existing);
    buckets.set(safeEventKey, timeBucket);
  }

  const clustered: ClusteredExternalEvent[] = [];
  for (const [eventKey, group] of groups.entries()) {
    const ordered = stableCandidateOrder(group);
    const representative =
      [...ordered].sort((left, right) => right.score - left.score)[0] ?? ordered[0];
    if (!representative) {
      continue;
    }
    const sourceMap = new Map<string, HetangExternalSourceConfig>();
    for (const candidate of ordered) {
      const existing = sourceMap.get(candidate.sourceId);
      if (!existing) {
        sourceMap.set(candidate.sourceId, {
          sourceId: candidate.sourceId,
          tier: candidate.tier,
        });
        continue;
      }
      const winner = strongestTier([existing, { tier: candidate.tier }]);
      sourceMap.set(candidate.sourceId, {
        sourceId: candidate.sourceId,
        tier: winner,
      });
    }
    const sources = [...sourceMap.values()].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    );
    const sourceIds = sources.map((source) => source.sourceId);
    const candidateIds = ordered.map((entry) => entry.candidateId);
    const publishedAt =
      [...ordered]
        .map((entry) => parseTime(entry.publishedAt))
        .filter((entry): entry is Date => entry !== null)
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString() ?? representative.publishedAt;
    const eventAt =
      [...ordered]
        .map((entry) => parseTime(entry.eventAt))
        .filter((entry): entry is Date => entry !== null)
        .sort((left, right) => left.getTime() - right.getTime())[0]
        ?.toISOString() ?? representative.eventAt;
    const score = Math.max(...ordered.map((entry) => entry.score));

    clustered.push({
      eventKey,
      timeBucket: buckets.get(eventKey) ?? "",
      candidateIds,
      sourceIds,
      card: {
        cardId: buildCardId(eventKey),
        entity: representative.entity,
        action: representative.action,
        object: representative.object,
        theme: representative.theme,
        eventAt,
        publishedAt,
        sources,
        summary: representative.summary,
        score,
      },
    });
  }

  return clustered.sort((left, right) => {
    const publishedDiff = right.card.publishedAt.localeCompare(left.card.publishedAt);
    if (publishedDiff !== 0) {
      return publishedDiff;
    }
    if (right.card.score !== left.card.score) {
      return right.card.score - left.card.score;
    }
    return left.eventKey.localeCompare(right.eventKey);
  });
}
