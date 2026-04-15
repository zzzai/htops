export type RouteCompareEvent = {
  routingMode?: string;
  baseRoutingMode?: string;
  effectiveRoutingMode?: string;
  semanticCanaryApplied?: boolean;
  frontDoorPrechecks?: {
    groupNoop?: boolean;
    routingControlsResolved?: boolean;
    bindingLookupCompleted?: boolean;
    bindingPresent?: boolean;
    semanticIntentResolved?: boolean;
    legacyCompareRouteResolved?: boolean;
    effectiveRoutingMode?: string;
  };
  frontDoorDecision?: string;
  rawText?: string;
  effectiveText?: string;
  legacyRoute?: string | null;
  semanticRoute?: string | null;
  selectedLane?: string | null;
  legacyCapabilityId?: string | null;
  selectedCapabilityId?: string | null;
  legacyMetaQueryProbeOutcome?: string | null;
  semanticMetaQueryProbeOutcome?: string | null;
  clarificationNeeded?: boolean;
  replyGuardIntervened?: boolean;
  latencyMs?: number;
};

export type RouteCompareSummary = {
  total: number;
  routeMatchCount: number;
  routeDiffCount: number;
  routeAccuracyPercent: number | null;
  capabilityDiffCount: number;
  capabilityAccuracyPercent: number | null;
  replyGuardInterventionCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  topRouteDiffs: Array<{ key: string; count: number }>;
  frontDoorDecisions: Array<{ key: string; count: number }>;
};

function ratioPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Math.round(((numerator / denominator) * 1000)) / 10;
}

function percentile(sortedValues: number[], ratio: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * ratio) - 1),
  );
  return sortedValues[index] ?? null;
}

function countEntries(values: string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export function extractRouteCompareEvent(line: string): RouteCompareEvent | null {
  const marker = "hetang-ops: route-compare ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const rawJson = line.slice(markerIndex + marker.length).trim();
  if (!rawJson.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawJson) as RouteCompareEvent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeRouteCompareEvents(events: RouteCompareEvent[]): RouteCompareSummary {
  const latencies = events
    .map((event) => event.latencyMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  const routeDiffs = events
    .filter((event) => (event.legacyRoute ?? null) !== (event.semanticRoute ?? null))
    .map((event) => `${event.legacyRoute ?? "null"} -> ${event.semanticRoute ?? "null"}`);
  const frontDoorDecisions = events
    .map((event) => event.frontDoorDecision)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const routeMatchCount = events.filter(
    (event) => (event.legacyRoute ?? null) === (event.semanticRoute ?? null),
  ).length;
  const capabilityMatchCount = events.filter(
    (event) => (event.legacyCapabilityId ?? null) === (event.selectedCapabilityId ?? null),
  ).length;

  return {
    total: events.length,
    routeMatchCount,
    routeDiffCount: routeDiffs.length,
    routeAccuracyPercent: ratioPercent(routeMatchCount, events.length),
    capabilityDiffCount: events.length - capabilityMatchCount,
    capabilityAccuracyPercent: ratioPercent(capabilityMatchCount, events.length),
    replyGuardInterventionCount: events.filter((event) => event.replyGuardIntervened === true)
      .length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    topRouteDiffs: countEntries(routeDiffs).slice(0, 10),
    frontDoorDecisions: countEntries(frontDoorDecisions).slice(0, 10),
  };
}

export function renderRouteCompareSummary(summary: RouteCompareSummary): string {
  const lines = [
    `samples=${summary.total}`,
    `route_match=${summary.routeMatchCount}`,
    `route_diff=${summary.routeDiffCount}`,
    `route_accuracy_pct=${summary.routeAccuracyPercent ?? "n/a"}`,
    `capability_diff=${summary.capabilityDiffCount}`,
    `capability_accuracy_pct=${summary.capabilityAccuracyPercent ?? "n/a"}`,
    `reply_guard_intervened=${summary.replyGuardInterventionCount}`,
    `latency_p50_ms=${summary.latencyP50Ms ?? "n/a"}`,
    `latency_p95_ms=${summary.latencyP95Ms ?? "n/a"}`,
  ];
  if (summary.frontDoorDecisions.length > 0) {
    lines.push("front_door_decisions:");
    for (const entry of summary.frontDoorDecisions) {
      lines.push(`- ${entry.key}: ${entry.count}`);
    }
  }
  if (summary.topRouteDiffs.length > 0) {
    lines.push("top_route_diffs:");
    for (const entry of summary.topRouteDiffs) {
      lines.push(`- ${entry.key}: ${entry.count}`);
    }
  }
  return lines.join("\n");
}
