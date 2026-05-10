import { createHash } from "node:crypto";

import type {
  HetangStoreExternalContextEntry,
  HetangStoreExternalObservation,
} from "./types.js";
import type { BaiduMapPlacePoi } from "./baidu-map-client.js";

export type StoreSurroundingsProvider = "baidu_maps" | "amap" | "osm_overture";

export type StoreSurroundingsCategory = {
  key: string;
  label: string;
  query: string;
};

export type StoreSurroundingsCategoryScan = {
  categoryKey: string;
  label: string;
  query: string;
  total: number;
  pois: BaiduMapPlacePoi[];
};

export type StoreSurroundingsScanResult = {
  provider: StoreSurroundingsProvider;
  orgId: string;
  storeName: string;
  snapshotDate: string;
  capturedAt: string;
  radiusMeters: number;
  coordinateSystem: string;
  location: {
    latitude: number;
    longitude: number;
  };
  categories: StoreSurroundingsCategoryScan[];
};

export type StoreSurroundingsImportStore = {
  createStoreExternalObservationBatch: (row: {
    batchId: string;
    orgId: string;
    sourcePlatform: string;
    captureScope: string;
    captureMode: string;
    capturedAt: string;
    operatorId?: string;
    browserProfileId?: string;
    status: "captured" | "normalized" | "published" | "failed";
    rawManifestJson: string;
  }) => Promise<void>;
  insertStoreExternalObservation: (
    row: Omit<HetangStoreExternalObservation, "applicableModules" | "notForScoring" | "rawJson"> & {
      applicableModules?: string[];
      notForScoring?: boolean;
      rawJson?: string;
    },
  ) => Promise<void>;
  upsertStoreExternalContextEntry: (row: {
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
  }) => Promise<void>;
};

type StoreSurroundingsContextEntryWrite = {
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

const AI_CONTEXT_MODULES = ["analysis_explanation", "store_advice", "customer_growth_ai"];

export const DEFAULT_STORE_SURROUNDINGS_CATEGORIES: StoreSurroundingsCategory[] = [
  { key: "catering", label: "餐饮", query: "餐饮$饭店$美食" },
  { key: "hotel", label: "酒店住宿", query: "酒店$宾馆$住宿" },
  { key: "shopping", label: "购物零售", query: "购物$商场$超市$便利店" },
  { key: "entertainment", label: "休闲娱乐", query: "休闲娱乐$KTV$电影院$酒吧" },
  { key: "transport", label: "交通节点", query: "地铁站$公交站$停车场" },
  { key: "competitor", label: "竞品足浴按摩", query: "足浴$足疗$按摩$养生" },
  { key: "office", label: "办公商务", query: "写字楼$公司企业$产业园" },
  { key: "residential", label: "住宅社区", query: "住宅区$小区" },
];

function stableHash(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function radiusMetricSuffix(radiusMeters: number): string {
  if (radiusMeters % 1000 === 0) {
    return `${radiusMeters / 1000}km`;
  }
  return `${radiusMeters}m`;
}

export function resolveStoreSurroundingsCategories(keys?: string[]): StoreSurroundingsCategory[] {
  if (!keys || keys.length === 0) {
    return DEFAULT_STORE_SURROUNDINGS_CATEGORIES;
  }
  const byKey = new Map(DEFAULT_STORE_SURROUNDINGS_CATEGORIES.map((entry) => [entry.key, entry]));
  return keys.map((key) => {
    const category = byKey.get(key);
    if (!category) {
      throw new Error(`Unsupported surroundings category: ${key}`);
    }
    return category;
  });
}

function sourceTypeForProvider(provider: StoreSurroundingsProvider): string {
  switch (provider) {
    case "baidu_maps":
      return "baidu_maps_place_api";
    case "amap":
      return "amap_place_api";
    case "osm_overture":
      return "osm_overture_open_data";
  }
}

function sourceLabelForProvider(provider: StoreSurroundingsProvider): string {
  switch (provider) {
    case "baidu_maps":
      return "Baidu Maps Place API";
    case "amap":
      return "Amap Official API";
    case "osm_overture":
      return "OSM / Overture Maps";
  }
}

function sanitizePoiForPersistence(poi: BaiduMapPlacePoi): Record<string, unknown> {
  return {
    uid: poi.uid,
    name: poi.name,
    address: poi.address,
    city: poi.city,
    district: poi.district,
    latitude: poi.latitude,
    longitude: poi.longitude,
    distanceMeters: poi.distanceMeters,
    type: poi.type,
    tags: poi.tags,
    overallRating: poi.overallRating,
  };
}

function buildPoiMix(scan: StoreSurroundingsScanResult): Record<string, number> {
  return Object.fromEntries(scan.categories.map((category) => [category.categoryKey, category.total]));
}

export function buildStoreSurroundingsObservationRows(params: {
  scan: StoreSurroundingsScanResult;
  batchId: string;
  createObservationId?: (key: string) => string;
}): Array<
  Omit<HetangStoreExternalObservation, "applicableModules" | "notForScoring" | "rawJson"> & {
    applicableModules?: string[];
    notForScoring?: boolean;
    rawJson?: string;
  }
> {
  const suffix = radiusMetricSuffix(params.scan.radiusMeters);
  const createObservationId =
    params.createObservationId ??
    ((key: string) => `surroundings-${stableHash([params.scan.provider, key])}`);
  const common = {
    orgId: params.scan.orgId,
    snapshotDate: params.scan.snapshotDate,
    sourcePlatform: params.scan.provider,
    metricDomain: "external_surroundings",
    truthLevel: "estimated" as const,
    confidence: "medium" as const,
    sourceLabel: sourceLabelForProvider(params.scan.provider),
    batchId: params.batchId,
    applicableModules: AI_CONTEXT_MODULES,
    notForScoring: true,
    updatedAt: params.scan.capturedAt,
  };
  const rows: ReturnType<typeof buildStoreSurroundingsObservationRows> = [];

  for (const category of params.scan.categories) {
    const baseKey = `${params.scan.orgId}:${params.scan.snapshotDate}:${params.scan.radiusMeters}:${category.categoryKey}`;
    rows.push({
      ...common,
      observationId: createObservationId(`${baseKey}:count`),
      metricKey: `${category.categoryKey}_poi_count_${suffix}`,
      valueNum: category.total,
      unit: "count",
      valueJson: {
        categoryKey: category.categoryKey,
        label: category.label,
        query: category.query,
        radiusMeters: params.scan.radiusMeters,
        coordinateSystem: params.scan.coordinateSystem,
      },
      rawJson: JSON.stringify({
        categoryKey: category.categoryKey,
        total: category.total,
        radiusMeters: params.scan.radiusMeters,
        provider: params.scan.provider,
      }),
    });
    rows.push({
      ...common,
      observationId: createObservationId(`${baseKey}:sample`),
      metricKey: `${category.categoryKey}_poi_sample_${suffix}`,
      valueJson: {
        categoryKey: category.categoryKey,
        label: category.label,
        radiusMeters: params.scan.radiusMeters,
        pois: category.pois.slice(0, 20).map(sanitizePoiForPersistence),
      },
      unit: "poi_list",
      rawJson: JSON.stringify({
        categoryKey: category.categoryKey,
        pois: category.pois.slice(0, 20).map(sanitizePoiForPersistence),
      }),
    });
  }

  rows.push({
    ...common,
    observationId: createObservationId(`${params.scan.orgId}:${params.scan.snapshotDate}:${params.scan.radiusMeters}:mix`),
    metricKey: `surroundings_poi_mix_${suffix}`,
    valueJson: {
      radiusMeters: params.scan.radiusMeters,
      mix: buildPoiMix(params.scan),
    },
    unit: "json",
    rawJson: JSON.stringify({
      radiusMeters: params.scan.radiusMeters,
      mix: buildPoiMix(params.scan),
    }),
  });

  return rows;
}

export function buildStoreSurroundingsContextEntries(
  scan: StoreSurroundingsScanResult,
): StoreSurroundingsContextEntryWrite[] {
  const suffix = radiusMetricSuffix(scan.radiusMeters);
  const common = {
    orgId: scan.orgId,
    snapshotDate: scan.snapshotDate,
    contextKind: "estimated_market_context" as const,
    truthLevel: "estimated" as const,
    confidence: "medium" as const,
    sourceType: sourceTypeForProvider(scan.provider),
    sourceLabel: sourceLabelForProvider(scan.provider),
    applicableModules: AI_CONTEXT_MODULES,
    notForScoring: true,
    updatedAt: scan.capturedAt,
  };
  const entries: StoreSurroundingsContextEntryWrite[] = scan.categories.map((category) => ({
    ...common,
    metricKey: `${category.categoryKey}_poi_count_${suffix}`,
    valueNum: category.total,
    unit: "count",
    note: `${scan.storeName} 周边 ${scan.radiusMeters} 米内 ${category.label} POI 估算数量。`,
    rawJson: JSON.stringify({
      provider: scan.provider,
      categoryKey: category.categoryKey,
      query: category.query,
      radiusMeters: scan.radiusMeters,
      coordinateSystem: scan.coordinateSystem,
      capturedAt: scan.capturedAt,
    }),
  }));

  entries.push({
    ...common,
    metricKey: `surroundings_poi_mix_${suffix}`,
    valueJson: buildPoiMix(scan),
    unit: "json",
    note: `${scan.storeName} 周边 ${scan.radiusMeters} 米商业配套结构。`,
    rawJson: JSON.stringify({
      provider: scan.provider,
      radiusMeters: scan.radiusMeters,
      coordinateSystem: scan.coordinateSystem,
      capturedAt: scan.capturedAt,
      mix: buildPoiMix(scan),
    }),
  });

  return entries;
}

export async function persistStoreSurroundingsScan(params: {
  store: StoreSurroundingsImportStore;
  scan: StoreSurroundingsScanResult;
  batchId?: string;
}): Promise<{
  batchId: string;
  observationCount: number;
  contextEntryCount: number;
}> {
  const batchId =
    params.batchId ??
    `store-surroundings-${stableHash([
      params.scan.provider,
      params.scan.orgId,
      params.scan.snapshotDate,
      String(params.scan.radiusMeters),
      params.scan.capturedAt,
    ])}`;
  await params.store.createStoreExternalObservationBatch({
    batchId,
    orgId: params.scan.orgId,
    sourcePlatform: params.scan.provider,
    captureScope: `store_surroundings:${params.scan.radiusMeters}m`,
    captureMode: "api",
    capturedAt: params.scan.capturedAt,
    status: "normalized",
    rawManifestJson: JSON.stringify({
      provider: params.scan.provider,
      orgId: params.scan.orgId,
      storeName: params.scan.storeName,
      snapshotDate: params.scan.snapshotDate,
      radiusMeters: params.scan.radiusMeters,
      coordinateSystem: params.scan.coordinateSystem,
      location: params.scan.location,
      categories: params.scan.categories.map((category) => ({
        categoryKey: category.categoryKey,
        label: category.label,
        query: category.query,
        total: category.total,
        sampleSize: category.pois.length,
      })),
    }),
  });

  const observations = buildStoreSurroundingsObservationRows({ scan: params.scan, batchId });
  for (const row of observations) {
    await params.store.insertStoreExternalObservation(row);
  }

  const contextEntries = buildStoreSurroundingsContextEntries(params.scan);
  for (const row of contextEntries) {
    await params.store.upsertStoreExternalContextEntry(row);
  }

  return {
    batchId,
    observationCount: observations.length,
    contextEntryCount: contextEntries.length,
  };
}
