import { resolveSemanticIntent, type HetangSemanticIntentKind, type HetangSemanticLane } from "./semantic-intent.js";
import type { HetangInboundMessageAuditRecord, HetangOpsConfig } from "./types.js";
import type {
  TrendRiskAdviceAction,
  TrendRiskAdviceUtteranceSample,
} from "./trend-risk-advice-route-eval-fixture-builder.js";

export type TrendRiskAdviceSampleCoverage = "covered_exact" | "uncovered_paraphrase";

export type TrendRiskAdviceUtteranceCoverageEntry = {
  rawText: string;
  normalizedText: string;
  count: number;
  action: TrendRiskAdviceAction;
  sampleCoverage: TrendRiskAdviceSampleCoverage;
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

function buildSampleExactTextIndex(samples: TrendRiskAdviceUtteranceSample[]): Set<string> {
  return new Set(
    samples.flatMap((sample) => [sample.primary, ...sample.similars]).map(normalizeSampleLookupText),
  );
}

type AggregatedAuditUtterance = {
  rawText: string;
  normalizedText: string;
  count: number;
};

function isTrendRiskAdviceAction(value: string | undefined): value is TrendRiskAdviceAction {
  return value === "trend" || value === "anomaly" || value === "risk" || value === "advice";
}

export function buildTrendRiskAdviceUtteranceCoverageFromInboundAudits(params: {
  config: HetangOpsConfig;
  now: Date;
  audits: HetangInboundMessageAuditRecord[];
  samples: TrendRiskAdviceUtteranceSample[];
}): TrendRiskAdviceUtteranceCoverageEntry[] {
  const aggregated = new Map<string, AggregatedAuditUtterance>();
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
  const entries: TrendRiskAdviceUtteranceCoverageEntry[] = [];

  for (const aggregatedEntry of aggregated.values()) {
    const intent = resolveSemanticIntent({
      config: params.config,
      text: aggregatedEntry.rawText,
      now: params.now,
    });

    if (intent.lane !== "query" || intent.kind !== "query" || !isTrendRiskAdviceAction(intent.action)) {
      continue;
    }

    entries.push({
      rawText: aggregatedEntry.rawText,
      normalizedText: aggregatedEntry.normalizedText,
      count: aggregatedEntry.count,
      action: intent.action,
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

export function filterTrendRiskAdviceUtteranceCoverage(
  entries: TrendRiskAdviceUtteranceCoverageEntry[],
  filter: "all" | "covered" | "uncovered",
): TrendRiskAdviceUtteranceCoverageEntry[] {
  switch (filter) {
    case "covered":
      return entries.filter((entry) => entry.sampleCoverage === "covered_exact");
    case "uncovered":
      return entries.filter((entry) => entry.sampleCoverage === "uncovered_paraphrase");
    default:
      return entries;
  }
}
