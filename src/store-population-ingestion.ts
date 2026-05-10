import type { HetangStoreExternalContextEntry } from "./types.js";
import { calculateCircleAreaKm2 } from "./worldpop-client.js";

type PopulationContextEntryWrite = {
  orgId: string;
  snapshotDate: string;
  contextKind: HetangStoreExternalContextEntry["contextKind"];
  metricKey: string;
  valueText?: string;
  valueNum?: number;
  valueJson?: unknown;
  unit?: string;
  truthLevel: HetangStoreExternalContextEntry["truthLevel"];
  confidence: HetangStoreExternalContextEntry["confidence"];
  sourceType: string;
  sourceLabel?: string;
  sourceUri?: string;
  applicableModules?: string[];
  notForScoring?: boolean;
  note?: string;
  rawJson?: string;
  updatedAt: string;
};

export type StorePopulationRing = {
  radiusKm: 1 | 3 | 5 | number;
  totalPopulation: number;
  rawJson?: unknown;
};

export type StorePopulationSource = {
  provider: "worldpop" | "kontur" | "ghsl";
  sourceLabel: string;
  sourceType: string;
  sourceVersion: string;
  sourceUri?: string;
};

const AI_CONTEXT_MODULES = ["analysis_explanation", "store_advice", "customer_growth_ai"];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function resolvePopulationMetricKey(kind: "count" | "density", radiusKm: number): string {
  const suffix = `${radiusKm}km`;
  return kind === "count" ? `population_count_${suffix}` : `population_density_${suffix}`;
}

export function calculatePopulationDensity(totalPopulation: number, radiusKm: number): number {
  return round(totalPopulation / calculateCircleAreaKm2(radiusKm), 2);
}

function makeEntry(params: {
  orgId: string;
  snapshotDate: string;
  source: StorePopulationSource;
  metricKey: string;
  valueNum: number;
  unit: string;
  updatedAt: string;
  note: string;
  rawJson?: unknown;
}): PopulationContextEntryWrite {
  return {
    orgId: params.orgId,
    snapshotDate: params.snapshotDate,
    contextKind: "estimated_market_context",
    metricKey: params.metricKey,
    valueNum: round(params.valueNum, 2),
    unit: params.unit,
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: params.source.sourceType,
    sourceLabel: params.source.sourceLabel,
    sourceUri: params.source.sourceUri,
    applicableModules: AI_CONTEXT_MODULES,
    notForScoring: true,
    note: params.note,
    rawJson: JSON.stringify({
      provider: params.source.provider,
      sourceVersion: params.source.sourceVersion,
      ...(
        params.rawJson === undefined
          ? {}
          : {
              raw: params.rawJson,
            }
      ),
    }),
    updatedAt: params.updatedAt,
  };
}

export function buildStorePopulationContextEntries(params: {
  orgId: string;
  snapshotDate: string;
  storeName: string;
  updatedAt: string;
  source: StorePopulationSource;
  rings: StorePopulationRing[];
}): PopulationContextEntryWrite[] {
  const rows: PopulationContextEntryWrite[] = [];
  const sortedRings = [...params.rings].sort((left, right) => left.radiusKm - right.radiusKm);
  for (const ring of sortedRings) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        source: params.source,
        metricKey: resolvePopulationMetricKey("count", ring.radiusKm),
        valueNum: ring.totalPopulation,
        unit: "person",
        updatedAt: params.updatedAt,
        note: `${params.storeName} 周边 ${ring.radiusKm}km 人口估算。`,
        rawJson: ring.rawJson,
      }),
    );
    if (ring.radiusKm === 3) {
      rows.push(
        makeEntry({
          orgId: params.orgId,
          snapshotDate: params.snapshotDate,
          source: params.source,
          metricKey: resolvePopulationMetricKey("density", ring.radiusKm),
          valueNum: calculatePopulationDensity(ring.totalPopulation, ring.radiusKm),
          unit: "person_per_km2",
          updatedAt: params.updatedAt,
          note: `${params.storeName} 周边 3km 人口密度估算。`,
          rawJson: ring.rawJson,
        }),
      );
    }
  }
  return rows;
}
