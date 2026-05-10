import { describe, expect, test, vi } from "vitest";

import {
  WorldPopApiError,
  WorldPopClient,
  buildCircleFeatureCollection,
  calculateCircleAreaKm2,
  resolveWorldPopDatasetProfile,
} from "./worldpop-client.js";

describe("buildCircleFeatureCollection", () => {
  test("builds a closed WGS84 polygon around a store coordinate", () => {
    const geojson = buildCircleFeatureCollection({
      latitude: 36.086407,
      longitude: 114.390299,
      radiusKm: 3,
      segments: 12,
    });

    const coordinates = geojson.features[0]!.geometry.coordinates[0]!;
    expect(geojson.type).toBe("FeatureCollection");
    expect(coordinates.length).toBe(13);
    expect(coordinates[0]).toEqual(coordinates[coordinates.length - 1]);
    expect(coordinates[0]![1]).not.toBe(36.086407);
  });
});

describe("calculateCircleAreaKm2", () => {
  test("returns circle area", () => {
    expect(calculateCircleAreaKm2(3)).toBeCloseTo(28.2743, 4);
  });
});

describe("WorldPopClient", () => {
  test("fetches synchronous population stats", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            status: "finished",
            status_code: 200,
            error: false,
            data: {
              total_population: 12345.67,
            },
          };
        },
      } as Response;
    });
    const client = new WorldPopClient({ fetchImpl });

    const result = await client.fetchPopulationStats({
      geojson: buildCircleFeatureCollection({
        latitude: 36,
        longitude: 114,
        radiusKm: 1,
        segments: 8,
      }),
      year: 2020,
    });

    expect(result.totalPopulation).toBe(12345.67);
    const url = new URL(calls[0]!);
    expect(url.origin + url.pathname).toBe("https://api.worldpop.org/v1/services/stats");
    expect(url.searchParams.get("dataset")).toBe("wpgppop");
    expect(url.searchParams.get("year")).toBe("2020");
    expect(url.searchParams.get("runasync")).toBe("false");
    expect(url.searchParams.get("geojson")).toContain("FeatureCollection");
  });

  test("throws when WorldPop returns an async task instead of data", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        async json() {
          return {
            status: "created",
            status_code: 200,
            error: false,
            taskid: "task-1",
          };
        },
      } as Response;
    });
    const client = new WorldPopClient({ fetchImpl });

    await expect(
      client.fetchPopulationStats({
        geojson: buildCircleFeatureCollection({
          latitude: 36,
          longitude: 114,
          radiusKm: 1,
          segments: 8,
        }),
      }),
    ).rejects.toMatchObject({
      name: "WorldPopApiError",
      taskId: "task-1",
    });
  });

  test("resolves a Global2 R2025A raster file from the WorldPop Hub catalog", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                id: 76798,
                popyear: 2024,
                files: [
                  "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2024/CHN/v1/1km_ua/constrained/chn_pop_2024_CN_1km_R2025A_UA_v1.tif",
                ],
                date: "2025-09-01",
                doi: "10.5258/SOTON/WP00840",
              },
              {
                id: 76799,
                popyear: "2025",
                files: [
                  "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/CHN/v1/1km_ua/constrained/chn_pop_2025_CN_1km_R2025A_UA_v1.tif",
                ],
                date: "2025-09-01",
                doi: "10.5258/SOTON/WP00840",
              },
            ],
          };
        },
      } as Response;
    });
    const client = new WorldPopClient({ fetchImpl });

    const entry = await client.fetchRasterCatalogEntry({
      alias: "G2_CN_POP_R25A_1km",
      iso3: "CHN",
      year: 2025,
    });

    expect(entry).toEqual({
      alias: "G2_CN_POP_R25A_1km",
      iso3: "CHN",
      year: 2025,
      fileUri:
        "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/CHN/v1/1km_ua/constrained/chn_pop_2025_CN_1km_R2025A_UA_v1.tif",
      catalogId: "76799",
      releaseDate: "2025-09-01",
      doi: "10.5258/SOTON/WP00840",
    });
    expect(calls).toEqual(["https://hub.worldpop.org/rest/data/pop/G2_CN_POP_R25A_1km?iso3=CHN"]);
  });

  test("throws a typed error when a raster catalog year is missing", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                popyear: 2024,
                files: ["https://example.test/chn_pop_2024.tif"],
              },
            ],
          };
        },
      } as Response;
    });
    const client = new WorldPopClient({ fetchImpl });

    await expect(
      client.fetchRasterCatalogEntry({
        alias: "G2_CN_POP_R25A_1km",
        iso3: "CHN",
        year: 2025,
      }),
    ).rejects.toMatchObject({
      name: "WorldPopApiError",
      message: expect.stringContaining("did not contain a raster file"),
    });
  });
});

describe("resolveWorldPopDatasetProfile", () => {
  test("describes the legacy stats API profile", () => {
    expect(resolveWorldPopDatasetProfile("wpgppop-2020")).toMatchObject({
      dataset: "wpgppop",
      year: 2020,
      sourceVersion: "worldpop_wpgppop_2020",
      supportsStatsApi: true,
    });
  });

  test("describes the Global2 R2025A catalog profile without pretending stats API support", () => {
    expect(resolveWorldPopDatasetProfile("global2-r2025a-2025")).toMatchObject({
      dataset: "G2_CN_POP_R25A_1km",
      year: 2025,
      sourceVersion: "worldpop_global2_r2025a_2025",
      supportsStatsApi: false,
      downloadUri: expect.stringContaining("population_G2_R2025A_v1.zip"),
    });
  });
});
