import { resolveSemanticIntent, type HetangSemanticIntentKind, type HetangSemanticLane } from "./semantic-intent.js";
import type { HetangInboundMessageAuditRecord, HetangOpsConfig } from "./types.js";
import type { CustomerProfileUtteranceSample } from "./customer-profile-route-eval-fixture-builder.js";

export type CustomerProfileSampleCoverage = "covered_exact" | "uncovered_paraphrase";

export type CustomerProfileUtteranceCoverageEntry = {
  rawText: string;
  normalizedText: string;
  count: number;
  action: "profile";
  sampleCoverage: CustomerProfileSampleCoverage;
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

function buildSampleExactTextIndex(samples: CustomerProfileUtteranceSample[]): Set<string> {
  return new Set(
    samples.flatMap((sample) => [sample.primary, ...sample.similars]).map(normalizeSampleLookupText),
  );
}

type AggregatedAuditUtterance = {
  rawText: string;
  normalizedText: string;
  count: number;
};

export function buildCustomerProfileUtteranceCoverageFromInboundAudits(params: {
  config: HetangOpsConfig;
  now: Date;
  audits: HetangInboundMessageAuditRecord[];
  samples: CustomerProfileUtteranceSample[];
}): CustomerProfileUtteranceCoverageEntry[] {
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
  const entries: CustomerProfileUtteranceCoverageEntry[] = [];

  for (const aggregatedEntry of aggregated.values()) {
    const intent = resolveSemanticIntent({
      config: params.config,
      text: aggregatedEntry.rawText,
      now: params.now,
    });

    if (intent.lane !== "query" || intent.kind !== "query" || intent.action !== "profile") {
      continue;
    }

    entries.push({
      rawText: aggregatedEntry.rawText,
      normalizedText: aggregatedEntry.normalizedText,
      count: aggregatedEntry.count,
      action: "profile",
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

export function filterCustomerProfileUtteranceCoverage(
  entries: CustomerProfileUtteranceCoverageEntry[],
  filter: "all" | "covered" | "uncovered",
): CustomerProfileUtteranceCoverageEntry[] {
  switch (filter) {
    case "covered":
      return entries.filter((entry) => entry.sampleCoverage === "covered_exact");
    case "uncovered":
      return entries.filter((entry) => entry.sampleCoverage === "uncovered_paraphrase");
    default:
      return entries;
  }
}
