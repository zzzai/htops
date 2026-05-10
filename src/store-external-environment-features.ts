import type { HetangStoreExternalContextEntry } from "./types.js";

type ExternalEnvironmentFeatureEntryWrite = {
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

type ExternalEnvironmentInputMetrics = {
  catering: number | null;
  hotel: number | null;
  shopping: number | null;
  entertainment: number | null;
  transport: number | null;
  competitor: number | null;
  office: number | null;
  residential: number | null;
  populationCount: number | null;
  populationDensity: number | null;
  nearbyResidentialPrice: number | null;
};

const AI_CONTEXT_MODULES = ["analysis_explanation", "store_advice", "customer_growth_ai"];

function readNumber(entries: HetangStoreExternalContextEntry[], metricKey: string): number | null {
  const value = entries.find((entry) => entry.metricKey === metricKey)?.valueNum;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeScore(value: number | null, benchmark: number): number | null {
  if (value === null || !Number.isFinite(value) || benchmark <= 0) {
    return null;
  }
  return round(Math.max(0, Math.min((value / benchmark) * 100, 100)), 1);
}

export function classifyCompetitorPressureBand(value: number | null): "low" | "medium" | "high" | "unknown" {
  if (value === null) {
    return "unknown";
  }
  if (value >= 100) {
    return "high";
  }
  if (value >= 60) {
    return "medium";
  }
  return "low";
}

function classifyHousingPriceBand(value: number | null): "low" | "mid" | "high" | "unknown" {
  if (value === null) {
    return "unknown";
  }
  if (value >= 13000) {
    return "high";
  }
  if (value >= 7000) {
    return "mid";
  }
  return "low";
}

function weightedScore(items: Array<[number | null, number]>, benchmark: number): number | null {
  let value = 0;
  let weight = 0;
  for (const [item, itemWeight] of items) {
    if (item === null) {
      continue;
    }
    value += item * itemWeight;
    weight += itemWeight;
  }
  if (weight === 0) {
    return null;
  }
  return normalizeScore(value / weight, benchmark);
}

function extractInputMetrics(entries: HetangStoreExternalContextEntry[]): ExternalEnvironmentInputMetrics {
  return {
    catering: readNumber(entries, "catering_poi_count_3km"),
    hotel: readNumber(entries, "hotel_poi_count_3km"),
    shopping: readNumber(entries, "shopping_poi_count_3km"),
    entertainment: readNumber(entries, "entertainment_poi_count_3km"),
    transport: readNumber(entries, "transport_poi_count_3km"),
    competitor: readNumber(entries, "competitor_poi_count_3km"),
    office: readNumber(entries, "office_poi_count_3km"),
    residential: readNumber(entries, "residential_poi_count_3km"),
    populationCount: readNumber(entries, "population_count_3km"),
    populationDensity: readNumber(entries, "population_density_3km"),
    nearbyResidentialPrice: readNumber(entries, "nearby_residential_price_estimated"),
  };
}

function makeEntry(params: {
  orgId: string;
  snapshotDate: string;
  metricKey: string;
  updatedAt: string;
  valueNum?: number | null;
  valueText?: string;
  valueJson?: unknown;
  unit?: string;
  note?: string;
  rawJson?: string;
}): ExternalEnvironmentFeatureEntryWrite {
  return {
    orgId: params.orgId,
    snapshotDate: params.snapshotDate,
    contextKind: "estimated_market_context",
    metricKey: params.metricKey,
    valueNum: params.valueNum ?? undefined,
    valueText: params.valueText,
    valueJson: params.valueJson,
    unit: params.unit,
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "derived_external_environment_features",
    sourceLabel: "External Environment Feature Layer",
    applicableModules: AI_CONTEXT_MODULES,
    notForScoring: true,
    note: params.note,
    rawJson: params.rawJson,
    updatedAt: params.updatedAt,
  };
}

export function buildStoreExternalEnvironmentFeatureEntries(params: {
  orgId: string;
  snapshotDate: string;
  storeName: string;
  updatedAt: string;
  entries: HetangStoreExternalContextEntry[];
}): ExternalEnvironmentFeatureEntryWrite[] {
  const input = extractInputMetrics(params.entries);
  const commercialVitalityScore = weightedScore(
    [
      [input.catering, 0.25],
      [input.shopping, 0.25],
      [input.entertainment, 0.2],
      [input.hotel, 0.15],
      [input.office, 0.15],
    ],
    150,
  );
  const nightConsumptionSupportScore = weightedScore(
    [
      [input.catering, 0.28],
      [input.entertainment, 0.28],
      [input.hotel, 0.2],
      [input.transport, 0.14],
      [input.shopping, 0.1],
    ],
    120,
  );
  const transportAccessScore = normalizeScore(input.transport, 120);
  const competitorPressureBand = classifyCompetitorPressureBand(input.competitor);
  const competitorPressureScore = normalizeScore(input.competitor, 140);
  const officeDemandProxyScore = normalizeScore(input.office, 120);
  const residentialDemandProxyScore =
    input.populationDensity !== null
      ? normalizeScore(input.populationDensity, 8000)
      : normalizeScore(input.residential, 80);
  const housingPriceBand = classifyHousingPriceBand(input.nearbyResidentialPrice);

  const rows: ExternalEnvironmentFeatureEntryWrite[] = [];
  if (commercialVitalityScore !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "commercial_vitality_score_3km",
        valueNum: commercialVitalityScore,
        unit: "score_0_100",
        updatedAt: params.updatedAt,
        note: "由餐饮、购物、娱乐、酒店、办公 POI 派生的周边商业活力分。",
      }),
    );
  }
  if (nightConsumptionSupportScore !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "night_consumption_support_score_3km",
        valueNum: nightConsumptionSupportScore,
        unit: "score_0_100",
        updatedAt: params.updatedAt,
        note: "由餐饮、娱乐、酒店、交通等 POI 派生的晚间消费支撑分。",
      }),
    );
  }
  if (transportAccessScore !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "transport_access_score_3km",
        valueNum: transportAccessScore,
        unit: "score_0_100",
        updatedAt: params.updatedAt,
        note: "由交通节点 POI 派生的交通便利度。",
      }),
    );
  }
  rows.push(
    makeEntry({
      orgId: params.orgId,
      snapshotDate: params.snapshotDate,
      metricKey: "competitor_pressure_band_3km",
      valueText: competitorPressureBand,
      updatedAt: params.updatedAt,
      note: "由周边足浴/按摩/养生相关 POI 派生的竞品压力分层。",
    }),
  );
  if (competitorPressureScore !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "competitor_pressure_score_3km",
        valueNum: competitorPressureScore,
        unit: "score_0_100",
        updatedAt: params.updatedAt,
        note: "由周边足浴/按摩/养生相关 POI 派生的竞品压力分。",
      }),
    );
  }
  if (officeDemandProxyScore !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "office_demand_proxy_score_3km",
        valueNum: officeDemandProxyScore,
        unit: "score_0_100",
        updatedAt: params.updatedAt,
        note: "由写字楼、公司企业、产业园 POI 派生的商务客群代理分。",
      }),
    );
  }
  if (residentialDemandProxyScore !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "residential_demand_proxy_score_3km",
        valueNum: residentialDemandProxyScore,
        unit: "score_0_100",
        updatedAt: params.updatedAt,
        note: "由住宅 POI 或人口密度派生的社区客群代理分。",
      }),
    );
  }
  if (input.nearbyResidentialPrice !== null) {
    rows.push(
      makeEntry({
        orgId: params.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "housing_price_band",
        valueText: housingPriceBand,
        updatedAt: params.updatedAt,
        note: "由周边住宅价格估算派生的消费力弱信号，仅用于解释。",
      }),
    );
  }

  rows.push(
    makeEntry({
      orgId: params.orgId,
      snapshotDate: params.snapshotDate,
      metricKey: "external_environment_summary_3km",
      valueJson: {
        storeName: params.storeName,
        poiCounts: {
          catering: input.catering,
          hotel: input.hotel,
          shopping: input.shopping,
          entertainment: input.entertainment,
          transport: input.transport,
          competitor: input.competitor,
          office: input.office,
          residential: input.residential,
        },
        population: {
          count3km: input.populationCount,
          density3km: input.populationDensity,
        },
        housing: {
          nearbyResidentialPriceEstimated: input.nearbyResidentialPrice,
          priceBand: housingPriceBand,
        },
        scores: {
          commercialVitality: commercialVitalityScore,
          nightConsumptionSupport: nightConsumptionSupportScore,
          transportAccess: transportAccessScore,
          competitorPressure: competitorPressureScore,
          officeDemandProxy: officeDemandProxyScore,
          residentialDemandProxy: residentialDemandProxyScore,
        },
        bands: {
          competitorPressure: competitorPressureBand,
        },
      },
      unit: "json",
      updatedAt: params.updatedAt,
      note: "门店外部环境第一阶段汇总，供经营解释和主动洞察使用。",
    }),
  );

  return rows;
}
