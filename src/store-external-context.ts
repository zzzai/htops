import type { HetangStoreExternalContextEntry } from "./types.js";

type StoreExternalContextModule =
  | "store_advice"
  | "analysis_explanation"
  | "customer_growth_ai"
  | (string & {});

export type StoreExternalContextAiPayload = {
  orgId: string;
  snapshotDate: string | null;
  confirmed: Record<string, unknown>;
  estimatedMarketContext: Record<string, unknown>;
  researchNotes: Array<{
    metricKey: string;
    value: unknown;
    note?: string;
    confidence: HetangStoreExternalContextEntry["confidence"];
    sourceType: string;
    sourceLabel?: string;
    sourceUri?: string;
    applicableModules: string[];
    notForScoring: boolean;
    updatedAt: string;
  }>;
  provenance: {
    confirmed: Record<
      string,
      {
        truthLevel: HetangStoreExternalContextEntry["truthLevel"];
        confidence: HetangStoreExternalContextEntry["confidence"];
        sourceType: string;
        sourceLabel?: string;
        sourceUri?: string;
        applicableModules: string[];
        notForScoring: boolean;
        updatedAt: string;
      }
    >;
    estimatedMarketContext: Record<
      string,
      {
        truthLevel: HetangStoreExternalContextEntry["truthLevel"];
        confidence: HetangStoreExternalContextEntry["confidence"];
        sourceType: string;
        sourceLabel?: string;
        sourceUri?: string;
        applicableModules: string[];
        notForScoring: boolean;
        updatedAt: string;
      }
    >;
  };
};

export type StoreExternalContextRuntime = {
  listStoreExternalContextEntries?: (params: {
    orgId: string;
    snapshotDate?: string;
  }) => Promise<HetangStoreExternalContextEntry[]>;
};

export function resolveStoreExternalContextEntryValue(entry: HetangStoreExternalContextEntry): unknown {
  if (entry.valueJson !== undefined) {
    return entry.valueJson;
  }
  if (entry.valueNum !== undefined) {
    return entry.valueNum;
  }
  if (entry.valueText !== undefined) {
    return entry.valueText;
  }
  return null;
}

function shouldIncludeEntryForModule(
  entry: HetangStoreExternalContextEntry,
  module: StoreExternalContextModule | undefined,
): boolean {
  if (!module) {
    return true;
  }
  if (entry.applicableModules.length === 0) {
    return true;
  }
  return entry.applicableModules.includes(module);
}

export function assembleStoreExternalContextForAi(params: {
  orgId: string;
  entries: HetangStoreExternalContextEntry[];
  module?: StoreExternalContextModule;
}): StoreExternalContextAiPayload {
  const filteredEntries = params.entries.filter((entry) =>
    shouldIncludeEntryForModule(entry, params.module),
  );
  const payload: StoreExternalContextAiPayload = {
    orgId: params.orgId,
    snapshotDate: filteredEntries[0]?.snapshotDate ?? null,
    confirmed: {},
    estimatedMarketContext: {},
    researchNotes: [],
    provenance: {
      confirmed: {},
      estimatedMarketContext: {},
    },
  };

  for (const entry of filteredEntries) {
    const value = resolveStoreExternalContextEntryValue(entry);
    const meta = {
      truthLevel: entry.truthLevel,
      confidence: entry.confidence,
      sourceType: entry.sourceType,
      sourceLabel: entry.sourceLabel,
      sourceUri: entry.sourceUri,
      applicableModules: entry.applicableModules,
      notForScoring: entry.notForScoring,
      updatedAt: entry.updatedAt,
    };

    if (entry.contextKind === "research_note" || entry.truthLevel === "research_note") {
      payload.researchNotes.push({
        metricKey: entry.metricKey,
        value,
        note: entry.note,
        confidence: entry.confidence,
        sourceType: entry.sourceType,
        sourceLabel: entry.sourceLabel,
        sourceUri: entry.sourceUri,
        applicableModules: entry.applicableModules,
        notForScoring: entry.notForScoring,
        updatedAt: entry.updatedAt,
      });
      continue;
    }

    if (entry.contextKind === "estimated_market_context" || entry.truthLevel === "estimated") {
      payload.estimatedMarketContext[entry.metricKey] = value;
      payload.provenance.estimatedMarketContext[entry.metricKey] = meta;
      continue;
    }

    payload.confirmed[entry.metricKey] = value;
    payload.provenance.confirmed[entry.metricKey] = meta;
  }

  return payload;
}

export async function loadStoreExternalContextForAi(params: {
  runtime: StoreExternalContextRuntime;
  orgId: string;
  snapshotDate?: string;
  module?: StoreExternalContextModule;
}): Promise<StoreExternalContextAiPayload> {
  const entries =
    (await params.runtime.listStoreExternalContextEntries?.({
      orgId: params.orgId,
      snapshotDate: params.snapshotDate,
    })) ?? [];

  return assembleStoreExternalContextForAi({
    orgId: params.orgId,
    entries,
    module: params.module,
  });
}
