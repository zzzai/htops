import { resolveMetricIntent, type HetangSupportedMetricKey } from "./metric-query.js";
import { resolveSemanticIntent, type HetangSemanticIntentKind, type HetangSemanticLane } from "./semantic-intent.js";
import type { MetricUserUtteranceSample } from "./metric-route-eval-fixture-builder.js";
import type { HetangInboundMessageAuditRecord, HetangOpsConfig } from "./types.js";

export type MetricUtteranceSampleCoverage = "covered_exact" | "uncovered_paraphrase";

export type MetricUtteranceCoverageEntry = {
  rawText: string;
  normalizedText: string;
  count: number;
  metricKeys: HetangSupportedMetricKey[];
  sampleCoverage: MetricUtteranceSampleCoverage;
  lane: HetangSemanticLane;
  intentKind: HetangSemanticIntentKind;
  capabilityId?: string;
};

function normalizeAuditText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeSampleLookupText(value: string): string {
  return value.trim().replace(/[\s，,、；;：:。.!！？?]/gu, "");
}

type AggregatedAuditMetricUtterance = {
  rawText: string;
  normalizedText: string;
  count: number;
};

function buildSampleExactTextIndex(samples: MetricUserUtteranceSample[]): Set<string> {
  return new Set(
    samples.flatMap((sample) => [sample.primary, ...sample.similars]).map(normalizeSampleLookupText),
  );
}

export function buildMetricUtteranceCoverageFromInboundAudits(params: {
  config: HetangOpsConfig;
  now: Date;
  audits: HetangInboundMessageAuditRecord[];
  samples: MetricUserUtteranceSample[];
}): MetricUtteranceCoverageEntry[] {
  const aggregated = new Map<string, AggregatedAuditMetricUtterance>();
  for (const audit of params.audits) {
    const rawText = normalizeAuditText(audit.effectiveContent?.trim() || audit.content.trim());
    if (!rawText) {
      continue;
    }
    const normalizedText = normalizeAuditText(rawText);
    const existing = aggregated.get(normalizedText);
    if (existing) {
      existing.count += 1;
      continue;
    }
    aggregated.set(normalizedText, {
      rawText,
      normalizedText,
      count: 1,
    });
  }

  const sampleExactTextIndex = buildSampleExactTextIndex(params.samples);
  const entries: MetricUtteranceCoverageEntry[] = [];

  for (const aggregatedEntry of aggregated.values()) {
    const resolution = resolveMetricIntent(aggregatedEntry.rawText);
    if (resolution.supported.length === 0) {
      continue;
    }

    const intent = resolveSemanticIntent({
      config: params.config,
      text: aggregatedEntry.rawText,
      now: params.now,
    });

    if (intent.lane !== "query" || intent.kind !== "query" || intent.action !== "summary") {
      continue;
    }

    entries.push({
      rawText: aggregatedEntry.rawText,
      normalizedText: aggregatedEntry.normalizedText,
      count: aggregatedEntry.count,
      metricKeys: resolution.supported.map((entry) => entry.key),
      sampleCoverage: sampleExactTextIndex.has(normalizeSampleLookupText(aggregatedEntry.rawText))
        ? "covered_exact"
        : "uncovered_paraphrase",
      lane: intent.lane,
      intentKind: intent.kind,
      capabilityId: intent.capabilityId,
    });
  }

  return entries.sort((left, right) => right.count - left.count || left.rawText.localeCompare(right.rawText, "zh-Hans-CN"));
}

export function filterMetricUtteranceCoverage(
  entries: MetricUtteranceCoverageEntry[],
  filter: "all" | "covered" | "uncovered",
): MetricUtteranceCoverageEntry[] {
  switch (filter) {
    case "covered":
      return entries.filter((entry) => entry.sampleCoverage === "covered_exact");
    case "uncovered":
      return entries.filter((entry) => entry.sampleCoverage === "uncovered_paraphrase");
    default:
      return entries;
  }
}
