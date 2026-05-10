import { describe, expect, test } from "vitest";

import {
  buildStorePopulationContextEntries,
  calculatePopulationDensity,
  resolvePopulationMetricKey,
} from "./store-population-ingestion.js";

describe("resolvePopulationMetricKey", () => {
  test("uses km suffix", () => {
    expect(resolvePopulationMetricKey("count", 1)).toBe("population_count_1km");
    expect(resolvePopulationMetricKey("count", 3)).toBe("population_count_3km");
    expect(resolvePopulationMetricKey("density", 3)).toBe("population_density_3km");
  });
});

describe("calculatePopulationDensity", () => {
  test("returns people per km2", () => {
    expect(calculatePopulationDensity(120000, 3)).toBeCloseTo(4244.13, 2);
  });
});

describe("buildStorePopulationContextEntries", () => {
  test("builds AI-safe population context entries", () => {
    const entries = buildStorePopulationContextEntries({
      orgId: "store-1",
      snapshotDate: "2026-05-09",
      storeName: "测试店",
      updatedAt: "2026-05-09T11:00:00.000Z",
      source: {
        provider: "worldpop",
        sourceLabel: "WorldPop wpgppop 2020",
        sourceType: "worldpop_stats_api",
        sourceVersion: "worldpop_wpgppop_2020",
      },
      rings: [
        { radiusKm: 1, totalPopulation: 12000 },
        { radiusKm: 3, totalPopulation: 120000 },
        { radiusKm: 5, totalPopulation: 260000 },
      ],
    });

    expect(entries.map((entry) => entry.metricKey)).toEqual([
      "population_count_1km",
      "population_count_3km",
      "population_density_3km",
      "population_count_5km",
    ]);
    expect(entries[0]).toMatchObject({
      contextKind: "estimated_market_context",
      metricKey: "population_count_1km",
      valueNum: 12000,
      unit: "person",
      truthLevel: "estimated",
      confidence: "medium",
      sourceType: "worldpop_stats_api",
      sourceLabel: "WorldPop wpgppop 2020",
      notForScoring: true,
    });
    expect(entries.find((entry) => entry.metricKey === "population_density_3km")).toMatchObject({
      valueNum: 4244.13,
      unit: "person_per_km2",
    });
  });
});
