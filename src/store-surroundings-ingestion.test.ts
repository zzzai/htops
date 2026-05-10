import { describe, expect, test } from "vitest";

import {
  DEFAULT_STORE_SURROUNDINGS_CATEGORIES,
  buildStoreSurroundingsContextEntries,
  buildStoreSurroundingsObservationRows,
  radiusMetricSuffix,
  resolveStoreSurroundingsCategories,
} from "./store-surroundings-ingestion.js";
import type { StoreSurroundingsScanResult } from "./store-surroundings-ingestion.js";

function sampleScan(): StoreSurroundingsScanResult {
  return {
    provider: "baidu_maps",
    orgId: "store-1",
    storeName: "荷塘悦色测试店",
    snapshotDate: "2026-05-09",
    capturedAt: "2026-05-09T01:00:00.000Z",
    radiusMeters: 3000,
    coordinateSystem: "bd09ll",
    location: {
      latitude: 36.1,
      longitude: 114.3,
    },
    categories: [
      {
        categoryKey: "catering",
        label: "餐饮",
        query: "餐饮$饭店$美食",
        total: 120,
        pois: [
          {
            uid: "poi-1",
            name: "测试餐厅",
            latitude: 36.11,
            longitude: 114.31,
            distanceMeters: 280,
            tags: ["餐饮", "中餐"],
            raw: {
              uid: "poi-1",
              name: "测试餐厅",
            },
          },
        ],
      },
      {
        categoryKey: "hotel",
        label: "酒店",
        query: "酒店$宾馆",
        total: 35,
        pois: [],
      },
    ],
  };
}

describe("radiusMetricSuffix", () => {
  test("uses km suffix for exact kilometer radii", () => {
    expect(radiusMetricSuffix(3000)).toBe("3km");
    expect(radiusMetricSuffix(1500)).toBe("1500m");
  });
});

describe("resolveStoreSurroundingsCategories", () => {
  test("returns configured categories by key and rejects unknown keys", () => {
    expect(resolveStoreSurroundingsCategories(["catering", "hotel"]).map((entry) => entry.key)).toEqual([
      "catering",
      "hotel",
    ]);
    expect(() => resolveStoreSurroundingsCategories(["unknown"])).toThrow("Unsupported surroundings category");
    expect(resolveStoreSurroundingsCategories().length).toBe(DEFAULT_STORE_SURROUNDINGS_CATEGORIES.length);
  });
});

describe("buildStoreSurroundingsObservationRows", () => {
  test("builds observation rows without leaking provider credentials", () => {
    const rows = buildStoreSurroundingsObservationRows({
      scan: sampleScan(),
      batchId: "batch-1",
      createObservationId: (key) => `obs:${key}`,
    });

    expect(rows.map((row) => row.metricKey)).toEqual([
      "catering_poi_count_3km",
      "catering_poi_sample_3km",
      "hotel_poi_count_3km",
      "hotel_poi_sample_3km",
      "surroundings_poi_mix_3km",
    ]);
    expect(rows[0]).toMatchObject({
      observationId: "obs:store-1:2026-05-09:3000:catering:count",
      sourcePlatform: "baidu_maps",
      metricDomain: "external_surroundings",
      valueNum: 120,
      unit: "count",
      truthLevel: "estimated",
      confidence: "medium",
      batchId: "batch-1",
      notForScoring: true,
    });
    expect(JSON.stringify(rows)).not.toContain("ak=");
    expect(JSON.stringify(rows)).not.toContain("secret");
  });
});

describe("buildStoreSurroundingsContextEntries", () => {
  test("publishes AI-safe external context entries for explanation", () => {
    const rows = buildStoreSurroundingsContextEntries(sampleScan());

    expect(rows.map((row) => row.metricKey)).toEqual([
      "catering_poi_count_3km",
      "hotel_poi_count_3km",
      "surroundings_poi_mix_3km",
    ]);
    expect(rows[0]).toMatchObject({
      orgId: "store-1",
      snapshotDate: "2026-05-09",
      contextKind: "estimated_market_context",
      metricKey: "catering_poi_count_3km",
      valueNum: 120,
      sourceType: "baidu_maps_place_api",
      sourceLabel: "Baidu Maps Place API",
      applicableModules: ["analysis_explanation", "store_advice", "customer_growth_ai"],
      notForScoring: true,
    });
  });
});
