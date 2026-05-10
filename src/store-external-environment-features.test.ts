import { describe, expect, test } from "vitest";

import {
  buildStoreExternalEnvironmentFeatureEntries,
  classifyCompetitorPressureBand,
  normalizeScore,
} from "./store-external-environment-features.js";
import type { HetangStoreExternalContextEntry } from "./types.js";

function entry(metricKey: string, valueNum: number): HetangStoreExternalContextEntry {
  return {
    orgId: "store-1",
    snapshotDate: "2026-05-09",
    contextKind: "estimated_market_context",
    metricKey,
    valueNum,
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "baidu_maps_place_api",
    sourceLabel: "Baidu Maps Place API",
    applicableModules: ["analysis_explanation", "store_advice"],
    notForScoring: true,
    rawJson: "{}",
    updatedAt: "2026-05-09T10:00:00.000Z",
  };
}

describe("normalizeScore", () => {
  test("caps weighted values into a 0-100 range", () => {
    expect(normalizeScore(0, 100)).toBe(0);
    expect(normalizeScore(50, 100)).toBe(50);
    expect(normalizeScore(250, 100)).toBe(100);
  });
});

describe("classifyCompetitorPressureBand", () => {
  test("classifies competitor pressure from count", () => {
    expect(classifyCompetitorPressureBand(null)).toBe("unknown");
    expect(classifyCompetitorPressureBand(30)).toBe("low");
    expect(classifyCompetitorPressureBand(75)).toBe("medium");
    expect(classifyCompetitorPressureBand(120)).toBe("high");
  });
});

describe("buildStoreExternalEnvironmentFeatureEntries", () => {
  test("derives external environment features from POI context", () => {
    const result = buildStoreExternalEnvironmentFeatureEntries({
      orgId: "store-1",
      snapshotDate: "2026-05-09",
      storeName: "测试店",
      updatedAt: "2026-05-09T11:00:00.000Z",
      entries: [
        entry("catering_poi_count_3km", 94),
        entry("hotel_poi_count_3km", 55),
        entry("shopping_poi_count_3km", 142),
        entry("entertainment_poi_count_3km", 72),
        entry("transport_poi_count_3km", 101),
        entry("competitor_poi_count_3km", 114),
        entry("office_poi_count_3km", 98),
        entry("residential_poi_count_3km", 50),
      ],
    });

    expect(result.map((row) => row.metricKey)).toEqual([
      "commercial_vitality_score_3km",
      "night_consumption_support_score_3km",
      "transport_access_score_3km",
      "competitor_pressure_band_3km",
      "competitor_pressure_score_3km",
      "office_demand_proxy_score_3km",
      "residential_demand_proxy_score_3km",
      "external_environment_summary_3km",
    ]);
    expect(result.find((row) => row.metricKey === "competitor_pressure_band_3km")).toMatchObject({
      valueText: "high",
      truthLevel: "estimated",
      confidence: "medium",
      sourceType: "derived_external_environment_features",
      notForScoring: true,
    });
    expect(result.find((row) => row.metricKey === "external_environment_summary_3km")?.valueJson).toMatchObject({
      poiCounts: {
        competitor: 114,
        catering: 94,
      },
      bands: {
        competitorPressure: "high",
      },
    });
  });

  test("uses population for derived scores and summaries without overwriting source population metrics", () => {
    const result = buildStoreExternalEnvironmentFeatureEntries({
      orgId: "store-1",
      snapshotDate: "2026-05-09",
      storeName: "测试店",
      updatedAt: "2026-05-09T11:00:00.000Z",
      entries: [
        entry("population_count_3km", 120000),
        entry("population_density_3km", 4244),
        entry("nearby_residential_price_estimated", 9200),
      ],
    });

    expect(result.find((row) => row.metricKey === "population_count_3km")).toBeUndefined();
    expect(result.find((row) => row.metricKey === "population_density_3km")).toBeUndefined();
    expect(result.find((row) => row.metricKey === "residential_demand_proxy_score_3km")).toMatchObject({
      valueNum: 53.1,
      sourceType: "derived_external_environment_features",
    });
    expect(result.find((row) => row.metricKey === "external_environment_summary_3km")?.valueJson).toMatchObject({
      population: {
        count3km: 120000,
        density3km: 4244,
      },
    });
    expect(result.find((row) => row.metricKey === "housing_price_band")).toMatchObject({
      valueText: "mid",
    });
  });
});
