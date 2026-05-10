import { describe, expect, test } from "vitest";

import {
  calculatePopulationInRadiusFromRaster,
  resolveRasterWindowForCircle,
  type PopulationRasterGrid,
} from "./worldpop-raster-stats.js";

function buildTestRaster(values: number[][], noData?: number): PopulationRasterGrid {
  return {
    width: values[0]?.length ?? 0,
    height: values.length,
    origin: [0, values.length],
    resolution: [1, -1],
    noData,
    async readWindow(window) {
      const [minX, minY, maxX, maxY] = window;
      const rows: number[] = [];
      for (let y = minY; y < maxY; y += 1) {
        for (let x = minX; x < maxX; x += 1) {
          rows.push(values[y]![x]!);
        }
      }
      return Float64Array.from(rows);
    },
  };
}

describe("resolveRasterWindowForCircle", () => {
  test("clamps the radius window to raster bounds", () => {
    const raster = buildTestRaster([
      [0, 1, 2, 3, 4],
      [10, 11, 12, 13, 14],
      [20, 21, 22, 23, 24],
      [30, 31, 32, 33, 34],
      [40, 41, 42, 43, 44],
    ]);

    expect(
      resolveRasterWindowForCircle({
        raster,
        latitude: 2.5,
        longitude: 2.5,
        radiusKm: 120,
      }),
    ).toEqual([1, 1, 4, 4]);
  });
});

describe("calculatePopulationInRadiusFromRaster", () => {
  test("sums valid pixel populations whose centers fall inside the store radius", async () => {
    const raster = buildTestRaster([
      [0, 1, 2, 3, 4],
      [10, 11, 12, 13, 14],
      [20, 21, 22, 23, 24],
      [30, 31, 32, 33, 34],
      [40, 41, 42, 43, 44],
    ]);

    const result = await calculatePopulationInRadiusFromRaster({
      raster,
      latitude: 2.5,
      longitude: 2.5,
      radiusKm: 120,
    });

    expect(result.totalPopulation).toBe(110);
    expect(result.includedPixels).toBe(5);
    expect(result.window).toEqual([1, 1, 4, 4]);
  });

  test("ignores nodata, negative, and non-finite raster values", async () => {
    const raster = buildTestRaster(
      [
        [0, 1, 2, 3, 4],
        [10, 11, -9999, 13, 14],
        [20, -3, 22, 23, 24],
        [30, 31, Number.NaN, 33, 34],
        [40, 41, 42, 43, 44],
      ],
      -9999,
    );

    const result = await calculatePopulationInRadiusFromRaster({
      raster,
      latitude: 2.5,
      longitude: 2.5,
      radiusKm: 120,
    });

    expect(result.totalPopulation).toBe(45);
    expect(result.includedPixels).toBe(2);
  });
});
